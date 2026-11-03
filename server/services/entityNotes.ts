import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  ENTITY_NOTE_TYPES, activities, brokerFollowUps, brokers, carrierSubmissions, clients, documents,
  entityNotes, eventLedger, invoices, loads, payouts, tasks, users,
} from "../../shared/schema";

export type EntityNoteStore = Pick<typeof db, "select" | "insert" | "update" | "transaction">;
export type EntityNoteType = typeof ENTITY_NOTE_TYPES[number];
export class EntityNoteError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
export const entityNoteTarget = z.object({
  entityType: z.enum(ENTITY_NOTE_TYPES), entityId: z.coerce.number().int().positive(),
}).strict();
export const entityNoteInput = z.object({ noteText: z.string().trim().min(1).max(10000) }).strict();
export const entityNoteCreate = entityNoteTarget.extend({ noteText: entityNoteInput.shape.noteText });
export type NoteActor = { id: string; role: string };

async function requireEntity(entityType: EntityNoteType, entityId: number, store: Pick<typeof db, "select">) {
  // Chargebacks are invoice-backed. The Follow-ups page expands broker_follow_ups.
  const table = ({
    invoice: invoices, carrier: clients, broker: brokers, document: documents, chargeback: invoices,
    followup: brokerFollowUps, task: tasks, submission: carrierSubmissions, load: loads, payout: payouts,
  } as const)[entityType];
  const [entity] = await store.select({ id: table.id }).from(table).where(eq(table.id, entityId)).limit(1);
  if (!entity) throw new EntityNoteError(404, "Entity not found");
}

export async function listEntityNotes(entityType: EntityNoteType, entityId: number, store: EntityNoteStore = db) {
  await requireEntity(entityType, entityId, store);
  const rows = await store.select({
    note: entityNotes,
    author: { id: users.id, firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl },
  }).from(entityNotes).leftJoin(users, eq(users.id, entityNotes.userId))
    .where(and(eq(entityNotes.entityType, entityType), eq(entityNotes.entityId, entityId), isNull(entityNotes.deletedAt)))
    .orderBy(desc(entityNotes.createdAt), desc(entityNotes.id));
  return rows.map(({ note, author }) => ({ ...note, author }));
}

export async function mutateEntityNote(
  action: "create" | "edit" | "delete", input: unknown, actor: NoteActor,
  noteId?: number, store: EntityNoteStore = db,
) {
  const value = action === "create" ? entityNoteCreate.parse(input) : action === "edit" ? entityNoteInput.parse(input) : null;
  return store.transaction(async tx => {
    const at = new Date();
    let note;
    if (action === "create") {
      const { entityType, entityId, noteText } = value as z.infer<typeof entityNoteCreate>;
      await requireEntity(entityType, entityId, tx);
      [note] = await tx.insert(entityNotes).values({ entityType, entityId, noteText, userId: actor.id, updatedAt: at }).returning();
    } else {
      const [existing] = await tx.select().from(entityNotes)
        .where(and(eq(entityNotes.id, noteId!), isNull(entityNotes.deletedAt))).for("update");
      if (!existing) throw new EntityNoteError(404, "Note not found");
      const author = existing.userId === actor.id;
      if (!author && (action === "edit" || !["admin", "manager"].includes(actor.role))) {
        throw new EntityNoteError(403, action === "edit" ? "Only the author can edit this note" : "Only the author or a manager can delete this note");
      }
      [note] = await tx.update(entityNotes).set(action === "delete"
        ? { deletedAt: at, updatedAt: at } : { noteText: value!.noteText, editedAt: at, updatedAt: at })
        .where(and(eq(entityNotes.id, existing.id), isNull(entityNotes.deletedAt))).returning();
    }
    const verb = action === "create" ? "added" : action === "edit" ? "edited" : "deleted";
    const eventType = note.entityType === "invoice" ? `invoice_note_${verb}` : `entity_note_${verb}`;
    // The Admin Audit Log uses activities; timelines use event_ledger. Both are atomic
    // with the note mutation and reference the note rather than duplicating its text.
    await tx.insert(activities).values({
      userId: actor.id, type: eventType, description: `Note ${verb}`,
      entityType: note.entityType, entityId: note.entityId, metadata: { noteId: note.id, noteAction: action },
    });
    await tx.insert(eventLedger).values({
      entityType: note.entityType, entityId: note.entityId, eventType,
      actorType: "user", actorId: actor.id, payloadJson: { noteId: note.id, noteAction: action },
    });
    return note;
  });
}
