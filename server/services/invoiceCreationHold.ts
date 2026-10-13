import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { clients, eventLedger, invoices, notifications, users } from "../../shared/schema";
import { invoiceCreationHoldSchema } from "../../shared/invoice-creation-options";
import { getDocumentCompleteness } from "./docValidation";

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Actor = { id: string; firstName?: string | null; lastName?: string | null; name?: string | null };

export function creationHoldFields(input: unknown, actorId: string) {
  const options = invoiceCreationHoldSchema.parse(input);
  if (!options.holdForManagerReview) return {};
  return {
    status: "held" as const, previousStatus: "submitted",
    heldReason: options.holdReason || null, heldBy: actorId, heldAt: new Date(),
  };
}

export async function recordCreationHold(tx: Executor, invoice: typeof invoices.$inferSelect, actor: Actor) {
  if (invoice.status !== "held") return;
  const [carrier] = await tx.select({ name: clients.name }).from(clients).where(eq(clients.id, invoice.clientId)).limit(1);
  const managers = await tx.select({ id: users.id }).from(users)
    .where(and(inArray(users.role, ["manager", "admin"]), eq(users.status, "active")));
  const agentName = [actor.firstName, actor.lastName].filter(Boolean).join(" ") || actor.name || actor.id;
  await tx.insert(eventLedger).values({
    entityType: "invoice", entityId: invoice.id, eventType: "invoice_status_changed",
    actorType: "user", actorId: actor.id,
    payloadJson: { from: null, to: "held", reason: invoice.heldReason, label: "Invoice placed on hold during creation", heldAt: invoice.heldAt?.toISOString() },
  });
  if (managers.length) await tx.insert(notifications).values(managers.map(manager => ({
    userId: manager.id, type: "warning" as const, title: "Invoice held for manager review",
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
      heldReason: null, heldAt: null, heldBy: null, heldNotes: null, previousStatus: null, updatedAt: new Date(),
    }).where(and(eq(invoices.id, id), eq(invoices.status, "held"))).returning();
    if (!updated) throw new Error("Invoice is no longer on hold");
    await tx.insert(eventLedger).values({
      entityType: "invoice", entityId: id, eventType: "invoice_status_changed", actorType: "user", actorId: releasedBy,
      payloadJson: { from: "held", to: restoreStatus, reason: releaseNote || "Released from hold", holdReason: existing.heldReason, label: "Invoice released from hold" },
    });
    return updated;
  });
}
