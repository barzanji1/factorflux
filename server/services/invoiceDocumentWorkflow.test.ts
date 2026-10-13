import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../db";
import { clients, documents, documentRules, eventLedger, invoices, notifications, users } from "../../shared/schema";
import { documentClassification } from "../../shared/document-display";
import { getDocumentCompleteness } from "./docValidation";
import { refreshInvoiceDocumentRequirements } from "./invoiceDocumentWorkflow";

after(() => pool.end());

test("AI type beats upload placeholders; explicit staff overrides remain authoritative", () => {
  const doc = { documentType: "other", finalDocumentType: "other", candidateDocumentType: "other", aiDocumentType: "rate_confirmation" };
  assert.equal(documentClassification(doc), "rate_confirmation");
  assert.equal(documentClassification({ ...doc, classificationSource: "agent" }), "other");
  assert.equal(documentClassification({ ...doc, classificationSource: "agent", finalDocumentType: "bill_of_lading" }), "bill_of_lading");
});

test("linked AI documents update missing list, auto-advance once, audit and notify atomically (rolled back)", async () => {
  const rollback = new Error("rollback isolated document workflow fixtures");
  await assert.rejects(db.transaction(async tx => {
    const suffix = randomUUID();
    const [processor] = await tx.insert(users).values({
      id: `doc-flow-${suffix}`, email: `doc-flow-${suffix}@example.invalid`,
      firstName: "Document", lastName: "Fixture", role: "employee",
    }).returning();
    const [carrier] = await tx.insert(clients).values({
      name: `Document workflow fixture ${suffix}`, status: "new_client", assignedProcessor: processor.id,
    }).returning();
    // Use isolated, rollback-only rules so local configuration does not change
    // this regression's meaning and cannot be changed by the regression.
    await tx.update(documentRules).set({ active: false });
    for (const [documentType, label] of [["rate_confirmation", "Rate Confirmation"], ["bill_of_lading", "Bill of Lading"]]) {
      await tx.insert(documentRules).values({ documentType, label, required: true, requiredForStage: "start_review", active: true })
        .onConflictDoUpdate({ target: documentRules.documentType, set: { label, required: true, requiredForStage: "start_review", active: true } });
    }
    const [invoice] = await tx.insert(invoices).values({
      invoiceNumber: `DOC-FLOW-${suffix}`, clientId: carrier.id, loadId: null,
      amount: "100.00", status: "docs_pending",
    }).returning();
    const base = {
      filename: `${suffix}.pdf`, originalName: "fixture.pdf", mimeType: "application/pdf", size: 1,
      uploadedBy: processor.id, invoiceId: invoice.id, loadId: null, documentType: "other" as const,
      finalDocumentType: "other" as const, classificationSource: "ai" as const, status: "processed" as const,
    };
    await tx.insert(documents).values({ ...base, aiDocumentType: "rate_confirmation" });
    const [bol] = await tx.insert(documents).values({ ...base, filename: `bol-${suffix}.pdf`, aiDocumentType: "other" }).returning();
    const before = await getDocumentCompleteness(invoice.id, tx);
    assert.deepEqual(before.missingForReview, ["Bill of Lading"]);
    assert.equal(before.canStartReview, false);
    const executor = tx as unknown as typeof db;
    assert.deepEqual(await refreshInvoiceDocumentRequirements(invoice.id, executor),
      { advanced: false, status: "docs_pending", missingDocs: ["Bill of Lading"] });

    await tx.update(documents).set({ aiDocumentType: "bill_of_lading" }).where(eq(documents.id, bol.id));
    const complete = await getDocumentCompleteness(invoice.id, tx);
    assert.equal(complete.completenessPercent, 100);
    assert.deepEqual(complete.missingForReview, []);
    assert.equal(complete.canApprove, true);
    await tx.insert(documentRules).values({
      documentType: "commercial_invoice", label: "Freight Invoice", required: true, requiredForStage: "approve", active: true,
    }).onConflictDoUpdate({ target: documentRules.documentType, set: {
      label: "Freight Invoice", required: true, requiredForStage: "approve", active: true,
    } });
    assert.deepEqual((await getDocumentCompleteness(invoice.id, tx)).missingForApproval, ["Freight Invoice"]);
    assert.equal((await refreshInvoiceDocumentRequirements(invoice.id, executor)).advanced, false, "waits for every configured required type");
    await tx.insert(documents).values({ ...base, filename: `invoice-${suffix}.pdf`, aiDocumentType: "carrier_invoice" });
    assert.equal((await refreshInvoiceDocumentRequirements(invoice.id, executor)).advanced, true);
    assert.equal((await refreshInvoiceDocumentRequirements(invoice.id, executor)).advanced, false);
    const [current] = await tx.select().from(invoices).where(eq(invoices.id, invoice.id));
    assert.equal(current.status, "under_review", "never automatically approves");
    assert.equal(current.factoringStage, "verification");
    const events = await tx.select().from(eventLedger).where(and(eq(eventLedger.entityType, "invoice"), eq(eventLedger.entityId, invoice.id)));
    assert.equal(events.length, 1);
    assert.equal(events[0].actorType, "system");
    assert.equal(events[0].actorId, "system");
    assert.equal((events[0].payloadJson as { reason: string }).reason, "all required documents received");
    const notices = await tx.select().from(notifications).where(and(eq(notifications.entityType, "invoice"), eq(notifications.entityId, invoice.id)));
    assert.equal(notices.length, 1);
    assert.equal(notices[0].userId, processor.id, "carrier assigned processor fallback");
    assert.equal(notices[0].actionUrl, `/invoices/${invoice.id}`);

    // Reclassification to Other must be reflected immediately by the same list;
    // existing under-review invoices are not auto-approved or moved backwards.
    await tx.update(documents).set({ finalDocumentType: "other", classificationSource: "agent" }).where(eq(documents.id, bol.id));
    assert.deepEqual((await getDocumentCompleteness(invoice.id, tx)).missingForReview, ["Bill of Lading"]);
    assert.equal((await refreshInvoiceDocumentRequirements(invoice.id, executor)).advanced, false);

    const [otherProcessor] = await tx.insert(users).values({
      id: `doc-flow-other-${suffix}`, firstName: "Other", lastName: "Fixture", role: "employee",
    }).returning();
    const [second] = await tx.insert(invoices).values({
      invoiceNumber: `DOC-FLOW-OTHER-${suffix}`, clientId: carrier.id, loadId: null,
      amount: "100.00", status: "docs_pending", assignedTo: otherProcessor.id,
    }).returning();
    for (const aiDocumentType of ["rate_confirmation", "bill_of_lading", "invoice"]) {
      await tx.insert(documents).values({ ...base, invoiceId: second.id, filename: `${aiDocumentType}-${suffix}.pdf`, aiDocumentType });
    }
    const notificationFailure = new Error("injected notification failure");
    const failingDatabase = {
      transaction: (work: Parameters<typeof db.transaction>[0]) => tx.transaction(async inner => {
        const insert = inner.insert.bind(inner);
        const proxy = new Proxy(inner, { get(target, property, receiver) {
          if (property === "insert") return (table: Parameters<typeof inner.insert>[0]) => {
            if (table === notifications) throw notificationFailure;
            return insert(table);
          };
          return Reflect.get(target, property, receiver);
        } });
        return work(proxy);
      }),
    } as unknown as typeof db;
    await assert.rejects(refreshInvoiceDocumentRequirements(second.id, failingDatabase), error => error === notificationFailure);
    const [unchanged] = await tx.select().from(invoices).where(eq(invoices.id, second.id));
    assert.equal(unchanged.status, "docs_pending", "notification failure rolls back status");
    assert.equal((await tx.select().from(eventLedger).where(and(eq(eventLedger.entityType, "invoice"), eq(eventLedger.entityId, second.id)))).length, 0, "notification failure rolls back audit");
    await refreshInvoiceDocumentRequirements(second.id, executor);
    const [directNotice] = await tx.select().from(notifications).where(eq(notifications.entityId, second.id));
    assert.equal(directNotice.userId, otherProcessor.id, "invoice assignment takes precedence over carrier processor");
    throw rollback;
  }), error => error === rollback);
});
