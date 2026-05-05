import { db } from "../db";
import {
  invoices,
  invoiceStatusHistory,
  eventLedger,
  documents,
  payouts,
  collections,
  paymentApplicationLines,
  cashApplications,
  exceptions,
  clients,
  debtors,
} from "../../shared/schema";
import { eq, and, desc } from "drizzle-orm";

// ─── Stage definitions ─────────────────────────────────────────────────────

export const FACTORING_STAGES = [
  "document_intake",
  "verification",
  "approval",
  "advance",
  "collections",
  "payment_receipt",
  "reconciliation",
  "final_settlement",
] as const;

export type FactoringStage = (typeof FACTORING_STAGES)[number];

export const STAGE_META: Record<
  FactoringStage,
  { label: string; description: string; color: string; step: number }
> = {
  document_intake:  { label: "Document Intake",    description: "Receiving and organizing carrier documents",        color: "slate",   step: 1 },
  verification:     { label: "Verification",        description: "Verifying docs, credit, and broker authority",     color: "amber",   step: 2 },
  approval:         { label: "Approval",            description: "Factor review and funding decision",               color: "blue",    step: 3 },
  advance:          { label: "Advance",             description: "Advance payment sent to carrier",                  color: "violet",  step: 4 },
  collections:      { label: "Collections",         description: "Collecting payment from broker/debtor",            color: "orange",  step: 5 },
  payment_receipt:  { label: "Payment Receipt",     description: "Payment received from broker/debtor",              color: "teal",    step: 6 },
  reconciliation:   { label: "Reconciliation",      description: "Matching payment to outstanding balance",          color: "indigo",  step: 7 },
  final_settlement: { label: "Final Settlement",    description: "Reserve released — invoice fully settled",         color: "emerald", step: 8 },
};

// ─── Stage derivation from invoice status ─────────────────────────────────

export function stageFromInvoiceStatus(status: string): FactoringStage {
  switch (status) {
    case "submitted":
    case "docs_pending":
      return "document_intake";
    case "under_review":
      return "verification";
    case "approved":
      return "approval";
    case "funded":
      return "advance";
    case "settled":
    case "paid":
      return "final_settlement";
    default:
      return "document_intake";
  }
}

// ─── Advance the factoring stage ──────────────────────────────────────────

export async function advanceInvoiceStage(
  invoiceId: number,
  newStage: FactoringStage,
  actorId: string,
  reason?: string,
): Promise<void> {
  const [inv] = await db
    .select({ id: invoices.id, factoringStage: invoices.factoringStage })
    .from(invoices)
    .where(eq(invoices.id, invoiceId));

  if (!inv) return;

  const currentStage = (inv.factoringStage ?? "document_intake") as FactoringStage;
  const currentStep  = STAGE_META[currentStage]?.step ?? 0;
  const newStep      = STAGE_META[newStage]?.step ?? 0;

  // Only advance forward, never go backwards
  if (newStep <= currentStep) return;

  await db
    .update(invoices)
    .set({ factoringStage: newStage, updatedAt: new Date() })
    .where(eq(invoices.id, invoiceId));

  // Write to event ledger for timeline
  await db.insert(eventLedger).values({
    entityType: "invoice",
    entityId: invoiceId,
    eventType: "stage_advanced",
    actorType: "user",
    actorId,
    payloadJson: {
      from: currentStage,
      to: newStage,
      fromLabel: STAGE_META[currentStage]?.label,
      toLabel: STAGE_META[newStage]?.label,
      reason: reason ?? null,
    },
  });
}

// ─── Full invoice detail (all related records) ────────────────────────────

export async function getInvoiceDetail(invoiceId: number) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return null;

  const [client] = inv.clientId
    ? await db.select().from(clients).where(eq(clients.id, inv.clientId))
    : [null];

  const [debtor] = inv.debtorId
    ? await db.select().from(debtors).where(eq(debtors.id, inv.debtorId))
    : [null];

  const [payout] = await db.select().from(payouts).where(eq(payouts.invoiceId, invoiceId));

  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.invoiceId, invoiceId))
    .orderBy(desc(documents.createdAt));

  const invCollections = await db
    .select()
    .from(collections)
    .where(eq(collections.invoiceId, invoiceId))
    .orderBy(desc(collections.createdAt));

  const cashAppLines = await db
    .select()
    .from(paymentApplicationLines)
    .where(eq(paymentApplicationLines.invoiceId, invoiceId))
    .orderBy(desc(paymentApplicationLines.createdAt));

  const invExceptions = await db
    .select()
    .from(exceptions)
    .where(and(eq(exceptions.entityType, "invoice"), eq(exceptions.entityId, invoiceId)))
    .orderBy(desc(exceptions.createdAt));

  const statusHistory = await db
    .select()
    .from(invoiceStatusHistory)
    .where(eq(invoiceStatusHistory.invoiceId, invoiceId))
    .orderBy(desc(invoiceStatusHistory.createdAt));

  return {
    ...inv,
    client: client ?? null,
    debtor: debtor ?? null,
    payout: payout ?? null,
    documents: docs,
    collections: invCollections,
    cashAppLines,
    exceptions: invExceptions,
    statusHistory,
  };
}

// ─── Unified invoice timeline ─────────────────────────────────────────────

export interface TimelineEvent {
  id: string;
  timestamp: Date | string | null;
  category: "status" | "stage" | "document" | "payout" | "payment" | "collection" | "exception" | "system";
  title: string;
  description: string;
  actorId?: string | null;
  meta?: Record<string, unknown>;
}

export async function getInvoiceTimeline(invoiceId: number): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  // 1. Status history
  const history = await db
    .select()
    .from(invoiceStatusHistory)
    .where(eq(invoiceStatusHistory.invoiceId, invoiceId));

  for (const h of history) {
    events.push({
      id: `status-${h.id}`,
      timestamp: h.createdAt,
      category: "status",
      title: `Status changed to ${h.newStatus}`,
      description: h.reason ?? `Invoice status updated from ${h.oldStatus ?? "—"} → ${h.newStatus}`,
      actorId: h.changedBy,
      meta: { oldStatus: h.oldStatus, newStatus: h.newStatus },
    });
  }

  // 2. Event ledger (stage advances, etc.)
  const ledgerEvents = await db
    .select()
    .from(eventLedger)
    .where(and(eq(eventLedger.entityType, "invoice"), eq(eventLedger.entityId, invoiceId)));

  for (const e of ledgerEvents) {
    const payload = (e.payloadJson as Record<string, unknown>) ?? {};
    const isStage = e.eventType === "stage_advanced";
    events.push({
      id: `ledger-${e.id}`,
      timestamp: e.createdAt,
      category: isStage ? "stage" : "system",
      title: isStage
        ? `Stage advanced: ${payload.fromLabel} → ${payload.toLabel}`
        : e.eventType.replace(/_/g, " "),
      description: isStage
        ? (payload.reason as string) ?? `Factoring stage moved to ${payload.toLabel}`
        : JSON.stringify(payload),
      actorId: e.actorId,
      meta: payload,
    });
  }

  // 3. Documents uploaded for this invoice
  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.invoiceId, invoiceId));

  for (const d of docs) {
    events.push({
      id: `doc-${d.id}`,
      timestamp: d.createdAt,
      category: "document",
      title: `Document uploaded: ${d.documentType.replace(/_/g, " ")}`,
      description: d.originalName,
      actorId: d.uploadedBy,
      meta: { documentType: d.documentType, filename: d.filename },
    });
  }

  // 4. Payout record for this invoice
  const [payout] = await db.select().from(payouts).where(eq(payouts.invoiceId, invoiceId));
  if (payout) {
    events.push({
      id: `payout-created-${payout.id}`,
      timestamp: payout.createdAt,
      category: "payout",
      title: "Payout record created",
      description: `Net payout: $${payout.netPayout} | Advance: $${payout.advanceAmount} | Fee: $${payout.feeAmount}`,
      actorId: payout.createdBy,
      meta: { payoutId: payout.id, netPayout: payout.netPayout, status: payout.paymentStatus },
    });
    if (payout.advancePaidAt) {
      events.push({
        id: `payout-advance-${payout.id}`,
        timestamp: payout.advancePaidAt,
        category: "payout",
        title: "Advance payment sent to carrier",
        description: `$${payout.advanceAmount} disbursed`,
        meta: { payoutId: payout.id },
      });
    }
    if (payout.reserveReleasedAt) {
      events.push({
        id: `payout-reserve-${payout.id}`,
        timestamp: payout.reserveReleasedAt,
        category: "payout",
        title: "Reserve released",
        description: `$${payout.reserveAmount} reserve released to carrier`,
        meta: { payoutId: payout.id },
      });
    }
  }

  // 5. Cash application lines
  const lines = await db
    .select()
    .from(paymentApplicationLines)
    .where(eq(paymentApplicationLines.invoiceId, invoiceId));

  for (const l of lines) {
    events.push({
      id: `cashapp-${l.id}`,
      timestamp: l.createdAt,
      category: "payment",
      title: `Payment applied: $${l.appliedAmount}`,
      description: `${l.varianceType.replace(/_/g, " ")} — Invoice amount $${l.invoiceAmount}`,
      meta: { appliedAmount: l.appliedAmount, varianceType: l.varianceType },
    });
  }

  // 6. Collections for this invoice
  const invCollections = await db
    .select()
    .from(collections)
    .where(eq(collections.invoiceId, invoiceId));

  for (const c of invCollections) {
    events.push({
      id: `coll-${c.id}`,
      timestamp: c.createdAt,
      category: "collection",
      title: `Collection opened: $${c.amount}`,
      description: c.description,
      meta: { collectionId: c.id, status: c.status, priority: c.priority },
    });
  }

  // 7. Exceptions for this invoice
  const invExceptions = await db
    .select()
    .from(exceptions)
    .where(and(eq(exceptions.entityType, "invoice"), eq(exceptions.entityId, invoiceId)));

  for (const e of invExceptions) {
    events.push({
      id: `exc-${e.id}`,
      timestamp: e.createdAt,
      category: "exception",
      title: `Exception: ${e.title}`,
      description: e.description ?? e.type.replace(/_/g, " "),
      meta: { exceptionId: e.id, type: e.type, severity: e.severity, status: e.status },
    });
  }

  // Sort newest first
  return events.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });
}
