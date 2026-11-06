import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import express from "express";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../db";
import {
  ENTITY_NOTE_TYPES, activities, brokers, brokerFollowUps, carrierPortalUsers, carrierSubmissions, clients,
  documents, entityNotes, eventLedger, invoices, loads, payouts, tasks, users,
} from "../../shared/schema";
import { entityNoteCreate, entityNoteInput, entityNoteTarget, listEntityNotes, mutateEntityNote, type EntityNoteType } from "./entityNotes";
import { getInvoiceTimeline } from "./invoiceStage";
import { registerEntityNoteRoutes } from "../routes/entityNotes";
import { registerDumpStatementRoutes } from "../routes/dumpStatements";

after(() => pool.end());
test("first invoice notes load migrates legacy text once, preserves creator and never resurrects deleted imports (rollback)", async () => {
  const rollback = new Error("ROLLBACK_LEGACY_NOTES");
  await assert.rejects(db.transaction(async tx => {
    const tag = randomUUID();
    const author = { id: `legacy-author-${tag}`, role: "employee" };
    await tx.insert(users).values({ ...author, firstName: "Legacy", lastName: "Fixture", status: "active", isTestAccount: true });
    const [carrier] = await tx.insert(clients).values({ name: `Legacy QA ${tag}`, status: "new_client", dataOrigin: "pilot" }).returning();
    const [invoice] = await tx.insert(invoices).values({
      invoiceNumber: `LEGACY-${tag}`, loadId: null, clientId: carrier.id, amount: "100",
      submittedBy: author.id, notes: "Original invoice context",
    }).returning();
    const [note] = await listEntityNotes("invoice", invoice.id, tx);
    assert.equal(note.noteText, invoice.notes);
    assert.equal(note.userId, author.id);
    assert.equal(+note.createdAt, +invoice.createdAt!);
    assert.equal((await listEntityNotes("invoice", invoice.id, tx)).length, 1);
    const [source] = await tx.select().from(invoices).where(eq(invoices.id, invoice.id));
    assert.equal(source.notes, null);
    const events = await tx.select().from(eventLedger).where(and(eq(eventLedger.entityType, "invoice"), eq(eventLedger.entityId, invoice.id)));
    assert.equal(events.length, 1);
    assert.ok(!JSON.stringify(events).includes(invoice.notes!));
    await mutateEntityNote("edit", { noteText: "Updated context" }, author, note.id, tx);
    assert.equal((await listEntityNotes("invoice", invoice.id, tx))[0].noteText, "Updated context");
    await mutateEntityNote("delete", {}, author, note.id, tx);
    assert.deepEqual(await listEntityNotes("invoice", invoice.id, tx), []);
    // Simulate the older SQL migration having copied a note but kept the source.
    await tx.update(invoices).set({ notes: "Updated context" }).where(eq(invoices.id, invoice.id));
    assert.deepEqual(await listEntityNotes("invoice", invoice.id, tx), []);
    const all = await tx.select().from(entityNotes).where(and(eq(entityNotes.entityType, "invoice"), eq(entityNotes.entityId, invoice.id)));
    assert.equal(all.length, 1, "already imported, even if soft-deleted: no duplicate");
    const [unknown] = await tx.insert(invoices).values({
      invoiceNumber: `UNKNOWN-${tag}`, loadId: null, clientId: carrier.id, amount: "100", notes: "No recorded creator",
    }).returning();
    assert.equal((await listEntityNotes("invoice", unknown.id, tx))[0].userId, null);
    throw rollback;
  }), error => error === rollback);
});
test("one notes API: all ten entities, ownership, soft deletion, audit/timeline privacy and HTTP permissions (rollback)", async () => {
  const rollback = new Error("ROLLBACK_ENTITY_NOTES");
  await assert.rejects(db.transaction(async tx => {
    const tag = randomUUID();
    const author = { id: `notes-author-${tag}`, role: "employee" };
    const other = { id: `notes-other-${tag}`, role: "employee" };
    const manager = { id: `notes-manager-${tag}`, role: "manager" };
    const admin = { id: `notes-admin-${tag}`, role: "admin" };
    for (const actor of [author, other, manager, admin]) await tx.insert(users).values({
      ...actor, firstName: actor === author ? "Author" : "Other", lastName: "Fixture", status: "active", isTestAccount: true,
    });
    const [carrier] = await tx.insert(clients).values({ name: `Note QA ${tag}`, status: "new_client", dataOrigin: "pilot" }).returning();
    const [invoice] = await tx.insert(invoices).values({
      invoiceNumber: `NOTE-${tag}`, loadId: null, clientId: carrier.id, amount: "100", status: "docs_pending",
    }).returning();
    const [broker] = await tx.insert(brokers).values({ name: `Note Broker ${tag}`, contactPerson: "Fixture",
      email: "notes-fixture@example.test", phone: "0000000000", dataOrigin: "pilot" }).returning();
    const [document] = await tx.insert(documents).values({ filename: `${tag}.pdf`, originalName: "fixture.pdf",
      mimeType: "application/pdf", size: 10, documentType: "other", uploadedBy: author.id }).returning();
    const [followup] = await tx.insert(brokerFollowUps).values({ invoiceId: invoice.id, subject: "Fixture", body: "Fixture" }).returning();
    const [task] = await tx.insert(tasks).values({ title: "Fixture", type: "task", createdBy: author.id }).returning();
    const [portalUser] = await tx.insert(carrierPortalUsers).values({ email: `${tag}@example.test`,
      passwordHash: "invalid-fixture-hash-not-a-real-account", companyName: "Fixture", carrierId: carrier.id }).returning();
    const [submission] = await tx.insert(carrierSubmissions).values({ portalUserId: portalUser.id, carrierId: carrier.id }).returning();
    const [load] = await tx.insert(loads).values({ id: 2_000_000_000 + randomInt(1_000_000), loadNumber: tag, clientId: carrier.id }).returning();
    const [payout] = await tx.insert(payouts).values({ invoiceId: invoice.id, clientId: carrier.id, invoiceAmount: "100",
      advanceRate: "90", feeRate: "2", advanceAmount: "90", feeAmount: "2", reserveAmount: "10", netPayout: "88" }).returning();
    const targets: Record<EntityNoteType, number> = { invoice: invoice.id, carrier: carrier.id, broker: broker.id, document: document.id,
      chargeback: invoice.id, followup: followup.id, task: task.id, submission: submission.id, load: load.id, payout: payout.id };
    const created = [];
    for (const entityType of ENTITY_NOTE_TYPES) {
      const note = await mutateEntityNote("create", { entityType, entityId: targets[entityType], noteText: ` Private ${entityType} context ` }, author, undefined, tx);
      assert.equal(note.noteText, `Private ${entityType} context`);
      const rows = await listEntityNotes(entityType, targets[entityType], tx);
      assert.deepEqual(rows.map(row => row.id), [note.id]);
      assert.equal(rows[0].author?.firstName, "Author");
      created.push(note);
    }
    const note = created[0];
    await assert.rejects(mutateEntityNote("edit", { noteText: "stolen" }, other, note.id, tx), /Only the author/);
    await assert.rejects(mutateEntityNote("edit", { noteText: "manager edit" }, manager, note.id, tx), /Only the author/);
    await assert.rejects(mutateEntityNote("edit", { noteText: "admin edit" }, admin, note.id, tx), /Only the author/);
    await assert.rejects(mutateEntityNote("delete", {}, other, note.id, tx), /Only the author/);
    const edited = await mutateEntityNote("edit", { noteText: "Corrected private context" }, author, note.id, tx);
    assert.ok(edited.editedAt);
    assert.equal(+edited.createdAt, +note.createdAt);
    await mutateEntityNote("delete", {}, manager, note.id, tx);
    assert.equal((await listEntityNotes("invoice", invoice.id, tx)).length, 0);
    assert.equal((await listEntityNotes("chargeback", invoice.id, tx)).length, 1, "same numeric ID, separate namespace");
    const [retained] = await tx.select().from(entityNotes).where(eq(entityNotes.id, note.id));
    assert.ok(retained.deletedAt);
    assert.equal(retained.noteText, "Corrected private context");
    await assert.rejects(mutateEntityNote("edit", { noteText: "resurrect" }, author, note.id, tx), /Note not found/);
    await mutateEntityNote("delete", {}, admin, created[1].id, tx);
    await mutateEntityNote("delete", {}, author, created[2].id, tx);
    const audit = await tx.select().from(activities).where(eq(activities.userId, author.id));
    assert.equal(audit.filter(row => row.type.endsWith("_added")).length, 10);
    assert.ok(!JSON.stringify(audit).includes("private context"));
    await tx.insert(eventLedger).values({ entityType: "invoice", entityId: invoice.id, eventType: "invoice_note_added",
      actorType: "user", actorId: author.id, payloadJson: { noteId: note.id, body: "HISTORIC PRIVATE BODY" } });
    const timeline = await getInvoiceTimeline(invoice.id, tx);
    assert.ok(timeline.some(event => event.title === "Note edited by Author Fixture"));
    assert.ok(!JSON.stringify(timeline).includes("HISTORIC") && !JSON.stringify(timeline).includes("private context"));
    assert.ok(timeline.every(event => event.meta?.noteId));
    assert.equal(entityNoteInput.safeParse({ noteText: " " }).success, false);
    assert.equal(entityNoteInput.safeParse({ noteText: "x".repeat(10001) }).success, false);
    assert.equal(entityNoteCreate.safeParse({ entityType: "invoice", entityId: invoice.id, noteText: "OK", userId: manager.id }).success, false);
    assert.equal(entityNoteTarget.safeParse({ entityType: "invalid", entityId: 1 }).success, false);
    assert.equal(entityNoteTarget.safeParse({ entityType: "broker", entityId: -1 }).success, false);
    await assert.rejects(listEntityNotes("task", 2147483647, tx), /Entity not found/);
    const [before] = await tx.select().from(entityNotes).where(eq(entityNotes.id, created[3].id));
    const failure = new Error("Simulated ledger failure");
    const brokenStore = {
      ...tx,
      transaction: (callback: any) => tx.transaction(async nested => callback(new Proxy(nested, {
        get(target, key) {
          if (key === "insert") return (table: unknown) => { if (table === eventLedger) throw failure; return target.insert(table as any); };
          const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
        },
      }))),
    };
    await assert.rejects(mutateEntityNote("edit", { noteText: "must roll back" }, author, created[3].id, brokenStore as any), error => error === failure);
    const [afterFailure] = await tx.select().from(entityNotes).where(eq(entityNotes.id, created[3].id));
    assert.equal(afterFailure.noteText, before.noteText);
    const noAudit = await tx.select().from(activities).where(and(eq(activities.userId, author.id), eq(activities.entityId, document.id), eq(activities.type, "entity_note_edited")));
    assert.equal(noAudit.length, 0, "audit and note both roll back if timeline fails");

    const app = express(); app.use(express.json());
    const auth: express.RequestHandler = (req: any, res, next) => {
      req.user = [author, other, manager, admin].find(actor => actor.id === req.get("x-fixture-actor"));
      if (!req.user) return void res.status(401).json({ message: "Unauthorized" });
      next();
    };
    registerEntityNoteRoutes(app, auth, tx);
    registerDumpStatementRoutes(app, auth, tx);
    const server = app.listen(0);
    await new Promise<void>(resolve => server.on("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}/api/notes`;
    const headers = { "x-fixture-actor": author.id, "Content-Type": "application/json" };
    try {
      assert.equal((await fetch(`${base}?entityType=task&entityId=${task.id}`)).status, 401);
      assert.equal((await fetch(`${base}?entityType=invalid&entityId=1`, { headers })).status, 400);
      const add = await fetch(base, { method: "POST", headers, body: JSON.stringify({ entityType: "task", entityId: task.id, noteText: "HTTP note" }) });
      assert.equal(add.status, 201);
      const httpNote = await add.json();
      assert.equal((await fetch(`${base}/${httpNote.id}`, { method: "PATCH",
        headers: { ...headers, "x-fixture-actor": manager.id }, body: '{"noteText":"Manager cannot edit"}' })).status, 403);
      assert.equal((await fetch(`${base}/${httpNote.id}`, { method: "PATCH", headers, body: '{"noteText":"HTTP edited"}' })).status, 200);
      assert.equal((await fetch(`${base}/${httpNote.id}`, { method: "DELETE",
        headers: { ...headers, "x-fixture-actor": manager.id } })).status, 200);
      assert.equal((await fetch(`${base}/invalid`, { method: "DELETE", headers })).status, 400);
      const read = await fetch(`${base}?entityType=task&entityId=${task.id}`, { headers: { "x-fixture-actor": other.id } });
      assert.equal(read.status, 200, "all authenticated staff can read");
      assert.equal((await read.json()).length, 1);
      const brokerHistory = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/brokers/${broker.id}/statement-history`, { headers });
      assert.equal(brokerHistory.status, 200);
      const brokerEvents = await brokerHistory.json();
      assert.equal(brokerEvents.length, 2);
      assert.ok(brokerEvents.some((event: any) => event.label === "Note added by Author Fixture" && event.noteId === created[2].id));
      assert.ok(brokerEvents.every((event: any) => event.status === "note" && event.downloadUrl === null));
      assert.ok(!JSON.stringify(brokerEvents).includes("Private broker context"));
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    throw rollback;
  }), error => error === rollback);
});
