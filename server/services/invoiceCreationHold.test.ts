import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { clients, documents, documentRules, eventLedger, invoices, notifications, users } from "../../shared/schema";
import { optionalLumperSchema } from "../../shared/invoice-creation-options";
import { creationHoldFields, recordCreationHold, releaseHeldInvoice } from "./invoiceCreationHold";
after(() => pool.end());

test("lumper accepts omitted, empty and null, without converting false text to true", () => {
  for (const value of [undefined, null, ""]) assert.equal(optionalLumperSchema.parse(value), null);
  for (const value of [false, "false", "no"]) assert.equal(optionalLumperSchema.parse(value), false);
  for (const value of [true, "true", "yes"]) assert.equal(optionalLumperSchema.parse(value), true);
  assert.equal(optionalLumperSchema.safeParse("garbage").success, false);
});

test("creation hold defaults off, accepts an optional reason and ignores reasons when not held", () => {
  assert.deepEqual(creationHoldFields({}, "agent"), {});
  assert.deepEqual(creationHoldFields({ holdReason: "unused" }, "agent"), {});
  assert.equal(creationHoldFields({ holdForManagerReview: true, holdReason: "" }, "agent").heldReason, null);
  assert.equal(creationHoldFields({ holdForManagerReview: true, holdReason: " verify rate con " }, "agent").heldReason, "verify rate con");
  assert.throws(() => creationHoldFields({ holdForManagerReview: "false" }, "agent"));
});

test("agent-created hold notifies managers, audits, releases by doc readiness and preserves approved holds (rollback)", async () => {
  const rollback = new Error("rollback hold fixtures");
  await assert.rejects(db.transaction(async tx => {
    const tag = randomUUID();
    const ids = ["employee", "manager", "admin", "inactive-manager"].map(role => `hold-${role}-${tag}`);
    await tx.insert(users).values(ids.map((id, index) => ({
      id, firstName: "Hold", lastName: `Fixture${index}`,
      role: (index === 0 ? "employee" : index === 2 ? "admin" : "manager") as "employee" | "admin" | "manager",
      status: index === 3 ? "inactive" as const : "active" as const,
    })));
    const [carrier] = await tx.insert(clients).values({ name: `Hold fixture ${tag}`, status: "new_client" }).returning();
    await tx.update(documentRules).set({ active: false });
    await tx.insert(documentRules).values({ documentType: "bill_of_lading", label: "Bill of Lading", required: true, active: true, requiredForStage: "start_review" })
      .onConflictDoUpdate({ target: documentRules.documentType, set: { active: true, required: true, requiredForStage: "start_review" } });
    const [held] = await tx.insert(invoices).values({
      invoiceNumber: `HOLD-${tag}`, clientId: carrier.id, loadId: null, amount: "100", lumper: null,
      submittedBy: ids[0], ...creationHoldFields({ holdForManagerReview: true, holdReason: "Verify rate con" }, ids[0]),
    }).returning();
    await recordCreationHold(tx, held, { id: ids[0], firstName: "Agent", lastName: "Fixture" });
    assert.equal(held.status, "held");
    assert.equal(held.heldReason, "Verify rate con");
    const notices = await tx.select().from(notifications).where(and(eq(notifications.entityType, "invoice"), eq(notifications.entityId, held.id), inArray(notifications.userId, ids)));
    assert.deepEqual(notices.map(notice => notice.userId).sort(), [ids[1], ids[2]].sort());
    assert(notices[0].message.includes(`Agent Fixture held invoice HOLD-${tag} for Hold fixture ${tag} — Verify rate con`));
    const [event] = await tx.select().from(eventLedger).where(and(eq(eventLedger.entityType, "invoice"), eq(eventLedger.entityId, held.id)));
    assert.equal(event.actorId, ids[0]);
    assert.equal((event.payloadJson as { reason: string }).reason, "Verify rate con");
    assert(event.createdAt);
    const executor = tx as unknown as typeof db;
    const pending = await releaseHeldInvoice(held.id, ids[1], "Reviewed hold", executor);
    assert.equal(pending.status, "docs_pending");
    assert.equal(pending.heldReason, null);
    await assert.rejects(releaseHeldInvoice(held.id, ids[1], undefined, executor), /not on hold/);
    await tx.update(invoices).set({ status: "held", previousStatus: "submitted" }).where(eq(invoices.id, held.id));
    await tx.insert(documents).values({
      invoiceId: held.id, filename: `${tag}.pdf`, originalName: "fixture.pdf", mimeType: "application/pdf", size: 1,
      documentType: "other", aiDocumentType: "bill_of_lading", uploadedBy: ids[0],
    });
    assert.equal((await releaseHeldInvoice(held.id, ids[1], undefined, executor)).status, "under_review");
    await tx.update(invoices).set({ status: "held", previousStatus: "approved" }).where(eq(invoices.id, held.id));
    assert.equal((await releaseHeldInvoice(held.id, ids[1], undefined, executor)).status, "approved");
    throw rollback;
  }), error => error === rollback);
});
