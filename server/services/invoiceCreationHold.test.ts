import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../db";
import { clients, documents, documentRules, eventLedger, invoices, notifications, users } from "../../shared/schema";
import { optionalLumperSchema, lumperTotalSchema, requireLumperReceipt, HOLD_REASONS } from "../../shared/invoice-creation-options";
import { creationHoldFields, resolveCreationHold, getHoldRecipients, recordCreationHold, releaseHeldInvoice } from "./invoiceCreationHold";
after(() => pool.end());

test("lumper accepts omitted, empty and null, without converting false text to true", () => {
  for (const value of [undefined, null, ""]) assert.equal(optionalLumperSchema.parse(value), null);
  for (const value of [false, "false", "no"]) assert.equal(optionalLumperSchema.parse(value), false);
  for (const value of [true, "true", "yes"]) assert.equal(optionalLumperSchema.parse(value), true);
  assert.equal(optionalLumperSchema.safeParse("garbage").success, false);
});

test("creation hold requires a supported reason and recipients only when held", () => {
  assert.deepEqual(creationHoldFields({}, "agent"), {});
  assert.deepEqual(creationHoldFields({ holdReason: "unused" }, "agent"), {});
  assert.throws(() => creationHoldFields({ holdForManagerReview: true, holdReason: "" }, "agent"));
  assert.throws(() => creationHoldFields({ holdForManagerReview: true, holdReason: "Missing docs", heldFor: [] }, "agent"));
  assert.throws(() => creationHoldFields({ holdForManagerReview: true, holdReason: "Missing docs", heldFor: ["someone-else"] }, "agent"));
  for (const holdReason of HOLD_REASONS) assert.equal(creationHoldFields({ holdForManagerReview: true, holdReason, heldFor: ["managers"] }, "agent").heldReason, holdReason);
  assert.throws(() => creationHoldFields({ holdForManagerReview: "false" }, "agent"));
});

test("Jess resolves only to the confirmed active full-name match and deduplicates Managers", async () => {
  const makeDirectory = (staff: { id: string; firstName: string; lastName: string; role: string; status: string }[]) => ({
    select: () => ({ from: () => ({ where: async () => staff.filter(user => user.status === "active") }) }),
  }) as unknown as Pick<typeof db, "select">;
  const confirmed = { id: "confirmed-reviewer", firstName: " Jesabel ", lastName: " AGOSTINA ", role: "manager", status: "active" };
  const otherStaff = [
    { id: "unrelated-nickname", firstName: "Jess", lastName: "Other", role: "employee", status: "active" },
    { id: "unrelated-first-name", firstName: "Jesabel", lastName: "Other", role: "manager", status: "active" },
    { ...confirmed, id: "inactive-reviewer", status: "inactive" },
  ];
  const directory = makeDirectory([confirmed, ...otherStaff]);
  const option = (await getHoldRecipients(directory)).find(option => option.value === "jess");
  assert.equal(option?.available, true);
  assert.deepEqual(option?.recipientIds, [confirmed.id]);
  const input = { holdForManagerReview: true, holdReason: "Missing docs", heldFor: ["jess"] };
  const fields = await resolveCreationHold(input, "creator", directory);
  assert.deepEqual("heldRecipientIds" in fields ? fields.heldRecipientIds : [], [confirmed.id]);
  const grouped = await resolveCreationHold({ ...input, heldFor: ["managers", "jess"] }, "creator", directory);
  assert.deepEqual("heldRecipientIds" in grouped ? [...grouped.heldRecipientIds].sort() : [],
    [confirmed.id, "unrelated-first-name"].sort());
  await assert.rejects(resolveCreationHold(input, "creator", makeDirectory(otherStaff)), /No active staff/);
  await assert.rejects(resolveCreationHold(input, "creator", makeDirectory([confirmed, { ...confirmed, id: "duplicate" }])),
    /Multiple active staff match/);
});

test("receipt enforcement and separate nonnegative lumper totals", () => {
  for (const value of [true, "yes", "true"]) assert.throws(() => requireLumperReceipt(value, false), /Lumper Receipt is required/);
  requireLumperReceipt(true, true);
  for (const value of [false, "no", "", null, undefined]) requireLumperReceipt(value, false);
  for (const value of ["", null, undefined]) assert.equal(lumperTotalSchema.parse(value), null);
  assert.equal(lumperTotalSchema.parse("125.50"), "125.50");
  assert.equal(lumperTotalSchema.parse(0), "0.00");
  for (const value of ["-1", "-0.1", "abc", "1.234", 1.234, 100000000]) assert.equal(lumperTotalSchema.safeParse(value).success, false);
});

test("agent-created hold notifies managers, audits, releases by doc readiness and preserves approved holds (rollback)", async () => {
  const rollback = new Error("rollback hold fixtures");
  await assert.rejects(db.transaction(async tx => {
    const tag = randomUUID();
    const ids = ["employee", "manager", "admin", "inactive-manager", "selected-staff"].map(role => `hold-${role}-${tag}`);
    await tx.insert(users).values(ids.map((id, index) => ({
      id, firstName: index === 4 ? "Mia" : "Hold", lastName: `Fixture${index}`,
      role: (index === 0 || index === 4 ? "employee" : index === 2 ? "admin" : "manager") as "employee" | "admin" | "manager",
      status: index === 3 ? "inactive" as const : "active" as const,
    })));
    // Resolve only synthetic staff; never rename/deactivate real accounts for tests.
    const fixtureDirectory = {
      select: () => ({ from: () => ({ where: async () => [
        { id: ids[0], firstName: "Hold", role: "employee" },
        { id: ids[1], firstName: "Hold", role: "manager" },
        { id: ids[2], firstName: "Hold", role: "admin" },
        { id: ids[4], firstName: "Mia", role: "employee" },
      ] }) }),
    } as unknown as Pick<typeof tx, "select">;
    const [carrier] = await tx.insert(clients).values({ name: `Hold fixture ${tag}`, status: "new_client" }).returning();
    await tx.update(documentRules).set({ active: false });
    await tx.insert(documentRules).values({ documentType: "bill_of_lading", label: "Bill of Lading", required: true, active: true, requiredForStage: "start_review" })
      .onConflictDoUpdate({ target: documentRules.documentType, set: { active: true, required: true, requiredForStage: "start_review" } });
    const [held] = await tx.insert(invoices).values({
      invoiceNumber: `HOLD-${tag}`, clientId: carrier.id, loadId: null, amount: "100", lumper: null,
      submittedBy: ids[0], lumperTotal: "45.50",
      ...await resolveCreationHold({ holdForManagerReview: true, holdReason: "Missing docs", heldFor: ["managers", "mia"] }, ids[0], fixtureDirectory),
    }).returning();
    await recordCreationHold(tx, held, { id: ids[0], firstName: "Agent", lastName: "Fixture" });
    assert.equal(held.status, "held");
    assert.equal(held.heldReason, "Missing docs");
    assert.equal(held.amount, "100.00");
    assert.equal(held.lumperTotal, "45.50");
    assert.deepEqual(held.heldFor, ["managers", "mia"]);
    const notices = await tx.select().from(notifications).where(and(eq(notifications.entityType, "invoice"), eq(notifications.entityId, held.id), inArray(notifications.userId, ids)));
    assert.deepEqual(notices.map(notice => notice.userId).sort(), [ids[1], ids[2], ids[4]].sort());
    assert(notices[0].message.includes(`Agent Fixture held invoice HOLD-${tag} for Hold fixture ${tag} — Missing docs`));
    assert.equal((await getHoldRecipients(fixtureDirectory)).find(option => option.value === "jess")?.available, false);
    await assert.rejects(resolveCreationHold({ holdForManagerReview: true, holdReason: "Missing docs", heldFor: ["jess"] }, ids[0], fixtureDirectory), /No active staff/);
    const targeted = await resolveCreationHold({ holdForManagerReview: true, holdReason: "Missing docs", heldFor: ["mia", "mia"] }, ids[0], fixtureDirectory);
    assert.deepEqual("heldRecipientIds" in targeted ? targeted.heldRecipientIds : [], [ids[4]]);
    const [staffOnlyHold] = await tx.insert(invoices).values({
      invoiceNumber: `HOLD-TARGETED-${tag}`, clientId: carrier.id, loadId: null, amount: "200",
      submittedBy: ids[0], ...targeted,
    }).returning();
    await recordCreationHold(tx, staffOnlyHold, { id: ids[0] });
    const staffOnlyNotices = await tx.select().from(notifications)
      .where(and(eq(notifications.entityType, "invoice"), eq(notifications.entityId, staffOnlyHold.id)));
    assert.deepEqual(staffOnlyNotices.map(notice => notice.userId), [ids[4]], "named-only hold never notifies unselected managers");
    const [event] = await tx.select().from(eventLedger).where(and(eq(eventLedger.entityType, "invoice"), eq(eventLedger.entityId, held.id)));
    assert.equal(event.actorId, ids[0]);
    assert.equal((event.payloadJson as { reason: string }).reason, "Missing docs");
    assert.deepEqual((event.payloadJson as { heldFor: string[] }).heldFor, ["managers", "mia"]);
    assert(event.createdAt);
    const executor = tx as unknown as typeof db;
    const pending = await releaseHeldInvoice(held.id, ids[1], "Reviewed hold", executor);
    assert.equal(pending.status, "docs_pending");
    assert.equal(pending.heldReason, null);
    assert.deepEqual(pending.heldFor, []);
    assert.deepEqual(pending.heldRecipientIds, []);
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
