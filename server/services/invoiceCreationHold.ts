import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { clients, eventLedger, invoices, notifications, users } from "../../shared/schema";
import { HOLD_TARGETS, invoiceCreationHoldSchema } from "../../shared/invoice-creation-options";
import { getDocumentCompleteness } from "./docValidation";

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = { id: string; firstName?: string | null; lastName?: string | null; name?: string | null };

export function creationHoldFields(input: unknown, actorId: string) {
  const options = invoiceCreationHoldSchema.parse(input);
  if (!options.holdForManagerReview) return {};
  return {
    status: "held" as const, previousStatus: "submitted",
    heldReason: options.holdReason || null, heldBy: actorId, heldAt: new Date(),
    heldFor: [...new Set(options.heldFor)],
  };
}

export async function getHoldRecipients(database: Pick<Executor, "select"> = db) {
  const staff = await database.select({ id: users.id, firstName: users.firstName, role: users.role })
    .from(users).where(eq(users.status, "active"));
  const matches = HOLD_TARGETS.map(target => {
    const candidates = target.value === "managers"
      ? staff.filter(user => ["admin", "manager"].includes(user.role ?? ""))
      : staff.filter(user => (user.firstName ?? "").trim().toLowerCase() === target.value);
    // Never guess among same-name staff or silently notify an unrelated account.
    const available = target.value === "managers" ? candidates.length > 0 : candidates.length === 1;
    return { ...target, available, recipientIds: available ? candidates.map(user => user.id) : [],
      ...(!available ? { unavailableReason: candidates.length ? "Multiple active staff match; resolve the staff name first." : "No active staff account found." } : {}) };
  });
  return matches;
}

export async function resolveCreationHold(input: unknown, actorId: string, database: Pick<Executor, "select"> = db) {
  const fields = creationHoldFields(input, actorId);
  if (!fields.heldFor) return fields;
  const options = await getHoldRecipients(database);
  const selected = options.filter(option => fields.heldFor.includes(option.value));
  const unavailable = selected.find(option => !option.available);
  if (unavailable) throw Object.assign(new Error(`${unavailable.label}: ${unavailable.unavailableReason}`), { status: 400 });
  return { ...fields, heldRecipientIds: [...new Set(selected.flatMap(option => option.recipientIds))] };
}

export async function recordCreationHold(tx: Executor, invoice: typeof invoices.$inferSelect, actor: Actor) {
  if (invoice.status !== "held") return;
  const [carrier] = await tx.select({ name: clients.name }).from(clients).where(eq(clients.id, invoice.clientId)).limit(1);
  const agentName = [actor.firstName, actor.lastName].filter(Boolean).join(" ") || actor.name || actor.id;
  await tx.insert(eventLedger).values({
    entityType: "invoice", entityId: invoice.id, eventType: "invoice_status_changed",
    actorType: "user", actorId: actor.id,
    payloadJson: { from: null, to: "held", reason: invoice.heldReason, heldFor: invoice.heldFor, recipientIds: invoice.heldRecipientIds, label: "Invoice placed on hold during creation", heldAt: invoice.heldAt?.toISOString() },
  });
  if (invoice.heldRecipientIds.length) await tx.insert(notifications).values(invoice.heldRecipientIds.map(userId => ({
    userId, type: "warning" as const, title: "Invoice held for your review",
    message: `${agentName} held invoice ${invoice.invoiceNumber} for ${carrier?.name ?? "carrier"} — ${invoice.heldReason || "No reason provided"}`,
    entityType: "invoice", entityId: invoice.id, actionUrl: "/held",
  })));
}

/** Preserve approved/funded hold behavior; intake holds return to review, never approval. */
export async function releaseHeldInvoice(id: number, releasedBy: string, releaseNote?: string, database = db) {
  return database.transaction(async tx => {
    const [existing] = await tx.select().from(invoices).where(eq(invoices.id, id)).for("update");
    if (!existing) throw new Error(`Invoice ${id} not found`);
    if (existing.status !== "held") throw new Error(`Invoice ${id} is not on hold`);
    let restoreStatus = (existing.previousStatus ?? "submitted") as typeof invoices.$inferSelect.status;
    if (["submitted", "docs_pending", "under_review"].includes(restoreStatus)) {
      const completeness = await getDocumentCompleteness(id, tx);
      restoreStatus = completeness.rules.some(entry => entry.rule.required && !entry.uploaded) ? "docs_pending" : "under_review";
    }
    const [updated] = await tx.update(invoices).set({
      status: restoreStatus,
      ...(restoreStatus === "docs_pending" ? { factoringStage: "document_intake" as const } :
        restoreStatus === "under_review" ? { factoringStage: "verification" as const } : {}),
      heldReason: null, heldFor: [], heldRecipientIds: [], heldAt: null, heldBy: null, heldNotes: null, previousStatus: null, updatedAt: new Date(),
    }).where(and(eq(invoices.id, id), eq(invoices.status, "held"))).returning();
    if (!updated) throw new Error("Invoice is no longer on hold");
    await tx.insert(eventLedger).values({
      entityType: "invoice", entityId: id, eventType: "invoice_status_changed", actorType: "user", actorId: releasedBy,
      payloadJson: { from: "held", to: restoreStatus, reason: releaseNote || "Released from hold", holdReason: existing.heldReason, label: "Invoice released from hold" },
    });
    return updated;
  });
}
