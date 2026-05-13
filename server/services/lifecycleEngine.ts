/**
 * Invoice Lifecycle Engine
 * ────────────────────────────────────────────────────────────────────────────
 * Defines all valid status transitions, guard functions (blocking rules), and
 * side effects (auto-created downstream records). Every transition is
 * deterministic, auditable, and role-gated. Admins can force-override
 * warning-level blockers but never error-level blockers.
 */

import { db } from "../db";
import { storage } from "../storage";
import {
  invoices,
  documents,
  payouts,
  paymentApplicationLines,
  exceptions,
  invoiceStatusHistory,
  eventLedger,
  creditChecks,
} from "../../shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { advanceInvoiceStage, type FactoringStage } from "./invoiceStage";
import { guardDocsForReview, guardDocsForApproval } from "./docValidation";
import { triggerBrokerFollowUp } from "./brokerFollowUpEngine";

// ─── Blocker types ────────────────────────────────────────────────────────────

export interface BlockerInfo {
  code: string;
  message: string;
  /** error = hard block, even admins cannot override.
   *  warning = soft block, admins may force through. */
  severity: "error" | "warning";
}

// ─── Internal context ─────────────────────────────────────────────────────────

interface Ctx {
  invoiceId: number;
  invoice: typeof invoices.$inferSelect;
  actorId: string;
  actorRole: string;
  reason?: string;
  force?: boolean;
}

type Guard      = (ctx: Ctx) => Promise<BlockerInfo | null>;
type SideEffect = (ctx: Ctx) => Promise<void>;

// ─── Transition definition ────────────────────────────────────────────────────

interface TransitionDef {
  id: string;
  from: string[];
  to: string;
  label: string;
  description: string;
  requiredRole: "any" | "manager_or_admin" | "admin";
  variant: "primary" | "secondary" | "danger";
  requiresReason?: boolean;
  guards: Guard[];
  sideEffects: SideEffect[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARDS
// ─────────────────────────────────────────────────────────────────────────────

const guardHasClient: Guard = async ({ invoice }) =>
  invoice.clientId ? null
    : { code: "no_client", message: "No carrier/client assigned to this invoice", severity: "error" };

const guardHasAmount: Guard = async ({ invoice }) =>
  invoice.amount && parseFloat(invoice.amount) > 0 ? null
    : { code: "no_amount", message: "Invoice amount must be greater than zero", severity: "error" };

const guardHasAnyDocument: Guard = async ({ invoiceId }) => {
  const [doc] = await db.select({ id: documents.id }).from(documents)
    .where(eq(documents.invoiceId, invoiceId)).limit(1);
  return doc ? null : { code: "no_documents", message: "At least one document must be uploaded before submitting", severity: "error" };
};

// guardHasRequiredDocs and guardHasApprovalDocs now delegate to DB-driven rules
// from docValidation.ts so admins can configure the checklist without code changes.
const guardHasRequiredDocs: Guard = (ctx) => guardDocsForReview(ctx);
const guardHasApprovalDocs: Guard = (ctx) => guardDocsForApproval(ctx);

const guardNoOpenCriticalExceptions: Guard = async ({ invoiceId }) => {
  const [exc] = await db.select({ id: exceptions.id }).from(exceptions)
    .where(and(
      eq(exceptions.entityType, "invoice"),
      eq(exceptions.entityId, invoiceId),
      inArray(exceptions.severity, ["critical", "high"]),
      inArray(exceptions.status, ["open", "under_review"]),
    )).limit(1);
  return exc ? { code: "open_exceptions", message: "Invoice has open critical/high exceptions — resolve them first", severity: "error" } : null;
};

const guardNoDeclinedCreditCheck: Guard = async ({ invoice }) => {
  if (!invoice.debtorId) return null;
  const [cc] = await db.select({ id: creditChecks.id }).from(creditChecks)
    .where(and(
      eq(creditChecks.entityType, "debtor"),
      eq(creditChecks.entityId, invoice.debtorId),
      eq(creditChecks.status, "declined"),
    )).limit(1);
  return cc ? { code: "credit_declined", message: "Debtor has a declined credit check — review before approving", severity: "warning" } : null;
};

const guardNoExistingPayout: Guard = async ({ invoiceId }) => {
  const [p] = await db.select({ id: payouts.id }).from(payouts)
    .where(eq(payouts.invoiceId, invoiceId)).limit(1);
  return p ? { code: "payout_exists", message: "A payout record already exists for this invoice", severity: "error" } : null;
};

const guardHasPaymentApplied: Guard = async ({ invoiceId }) => {
  const [line] = await db.select({ id: paymentApplicationLines.id }).from(paymentApplicationLines)
    .where(eq(paymentApplicationLines.invoiceId, invoiceId)).limit(1);
  return line ? null
    : { code: "no_payment", message: "No payment has been applied to this invoice yet — settle anyway?", severity: "warning" };
};

const guardHasReason: Guard = async ({ reason }) =>
  reason && reason.trim().length >= 3 ? null
    : { code: "reason_required", message: "A reason is required for this action (minimum 3 characters)", severity: "error" };

// ─────────────────────────────────────────────────────────────────────────────
// SIDE EFFECTS
// ─────────────────────────────────────────────────────────────────────────────

/** Write status change + audit trail */
function fxSetStatus(newStatus: string): SideEffect {
  return async ({ invoiceId, actorId, invoice, reason }) => {
    await db.update(invoices)
      .set({ status: newStatus as any, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    await db.insert(invoiceStatusHistory).values({
      invoiceId, oldStatus: invoice.status, newStatus, changedBy: actorId,
      reason: reason ?? null,
    });
    await db.insert(eventLedger).values({
      entityType: "invoice", entityId: invoiceId, eventType: "status_changed",
      actorType: "user", actorId,
      payloadJson: { from: invoice.status, to: newStatus, reason: reason ?? null },
    });
  };
}

/** Advance factoring lifecycle stage */
function fxStage(stage: FactoringStage): SideEffect {
  return async ({ invoiceId, actorId, reason }) =>
    advanceInvoiceStage(invoiceId, stage, actorId, reason);
}

/** Create activity log entry */
function fxActivity(type: string, desc: (ctx: Ctx) => string): SideEffect {
  return async (ctx) => {
    await storage.createActivity({
      userId: ctx.actorId, type, description: desc(ctx),
      entityType: "invoice", entityId: ctx.invoiceId,
    });
  };
}

/** Notify invoice submitter (if different from actor) */
function fxNotify(title: (ctx: Ctx) => string, msg: (ctx: Ctx) => string): SideEffect {
  return async (ctx) => {
    if (ctx.invoice.submittedBy && ctx.invoice.submittedBy !== ctx.actorId) {
      storage.createNotification({
        userId: ctx.invoice.submittedBy,
        title: title(ctx), message: msg(ctx), type: "info",
        entityType: "invoice", entityId: ctx.invoiceId,
        actionUrl: `/invoices/${ctx.invoiceId}`,
      } as any).catch(() => {});
    }
  };
}

/** Auto-downgrade to docs_pending if required docs are missing after submission */
const fxCheckDocsAutoDowngrade: SideEffect = async ({ invoiceId, actorId }) => {
  const docs = await db.select({ documentType: documents.documentType }).from(documents)
    .where(eq(documents.invoiceId, invoiceId));
  const types = new Set(docs.map(d => d.documentType));
  if (!types.has("rate_confirmation") || !types.has("bill_of_lading")) {
    await db.update(invoices).set({ status: "docs_pending", updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
    await db.insert(invoiceStatusHistory).values({
      invoiceId, oldStatus: "submitted", newStatus: "docs_pending", changedBy: actorId,
      reason: "Auto-flagged: missing rate confirmation or bill of lading",
    });
    await db.insert(eventLedger).values({
      entityType: "invoice", entityId: invoiceId, eventType: "auto_docs_pending",
      actorType: "system", actorId,
      payloadJson: { reason: "Missing rate_confirmation or bill_of_lading after submission" },
    });
  }
};

/** Auto-create payout record on funding */
const fxCreatePayout: SideEffect = async ({ invoiceId, actorId }) => {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return;
  let settings = await storage.getPayoutSettings();
  if (!settings) settings = await storage.upsertPayoutSettings({ advanceRate: "90.00", feeRate: "3.00" });
  const invoiceAmount = parseFloat(inv.amount);
  const advanceRate   = parseFloat(settings.advanceRate);
  const feeRate       = parseFloat(settings.feeRate);
  const advanceAmount = +(invoiceAmount * advanceRate / 100).toFixed(2);
  const feeAmount     = +(invoiceAmount * feeRate  / 100).toFixed(2);
  const reserveAmount = +(invoiceAmount - advanceAmount).toFixed(2);
  const netPayout     = +(advanceAmount - feeAmount).toFixed(2);
  await storage.createPayout({
    invoiceId, clientId: inv.clientId,
    invoiceAmount: String(invoiceAmount), advanceRate: String(advanceRate), feeRate: String(feeRate),
    advanceAmount: String(advanceAmount), feeAmount: String(feeAmount),
    reserveAmount: String(reserveAmount), netPayout: String(netPayout),
    paymentStatus: "pending_advance",
    notes: "Auto-created by lifecycle engine on invoice funding",
    createdBy: actorId,
  });
};

/** Mark payout complete + release reserve on final payment */
const fxReleaseReserve: SideEffect = async ({ invoiceId }) => {
  const [p] = await db.select().from(payouts).where(eq(payouts.invoiceId, invoiceId));
  if (p && p.paymentStatus !== "complete") {
    await storage.updatePayout(p.id, { paymentStatus: "complete", reserveReleasedAt: new Date() } as any);
  }
};

/** Create rejection exception record */
const fxCreateRejectionException: SideEffect = async ({ invoiceId, actorId, reason, invoice }) => {
  await storage.createException({
    type: "other", severity: "high",
    entityType: "invoice", entityId: invoiceId, entityRef: invoice.invoiceNumber,
    title: `Invoice rejected: ${invoice.invoiceNumber}`,
    description: reason ?? "Invoice was rejected during review",
    status: "open", createdBy: actorId,
  } as any);
};

// ─────────────────────────────────────────────────────────────────────────────
// TRANSITION DEFINITIONS  (ordered — only eligible transitions are shown)
// ─────────────────────────────────────────────────────────────────────────────

export const TRANSITION_DEFS: TransitionDef[] = [
  // ── 1. Submit draft ───────────────────────────────────────────────────────
  {
    id: "submit",
    from: ["draft"],
    to: "submitted",
    label: "Submit for Review",
    description: "Submit this invoice to begin the factoring review process",
    requiredRole: "any",
    variant: "primary",
    guards: [guardHasClient, guardHasAmount, guardHasAnyDocument],
    sideEffects: [
      fxSetStatus("submitted"),
      fxCheckDocsAutoDowngrade,
      fxStage("document_intake"),
      fxActivity("invoice_submitted", ctx => `Invoice ${ctx.invoice.invoiceNumber} submitted for review`),
    ],
  },

  // ── 2. Request missing documents ──────────────────────────────────────────
  {
    id: "request_docs",
    from: ["submitted"],
    to: "docs_pending",
    label: "Request Missing Docs",
    description: "Flag this invoice as needing additional documents before review can begin",
    requiredRole: "manager_or_admin",
    variant: "secondary",
    requiresReason: true,
    guards: [],
    sideEffects: [
      fxSetStatus("docs_pending"),
      fxActivity("docs_requested", ctx => `Documents requested for ${ctx.invoice.invoiceNumber}: ${ctx.reason}`),
      fxNotify(
        ctx => `Documents Needed — ${ctx.invoice.invoiceNumber}`,
        ctx => `Additional documents are required before your invoice can be reviewed: ${ctx.reason}`,
      ),
    ],
  },

  // ── 3. Begin review ───────────────────────────────────────────────────────
  {
    id: "start_review",
    from: ["submitted", "docs_pending"],
    to: "under_review",
    label: "Begin Review",
    description: "Move invoice into active review — rate confirmation and bill of lading required",
    requiredRole: "manager_or_admin",
    variant: "primary",
    guards: [guardHasRequiredDocs],
    sideEffects: [
      fxSetStatus("under_review"),
      fxStage("verification"),
      fxActivity("invoice_under_review", ctx => `Invoice ${ctx.invoice.invoiceNumber} moved to under review`),
    ],
  },

  // ── 4. Approve ────────────────────────────────────────────────────────────
  {
    id: "approve",
    from: ["under_review"],
    to: "approved",
    label: "Approve Invoice",
    description: "Approve this invoice for funding",
    requiredRole: "manager_or_admin",
    variant: "primary",
    guards: [guardHasApprovalDocs, guardNoOpenCriticalExceptions, guardNoDeclinedCreditCheck],
    sideEffects: [
      fxSetStatus("approved"),
      fxStage("approval"),
      fxActivity("invoice_approved", ctx => `Invoice ${ctx.invoice.invoiceNumber} approved`),
      fxNotify(
        ctx => `Invoice Approved — ${ctx.invoice.invoiceNumber}`,
        ctx => `Your invoice ${ctx.invoice.invoiceNumber} has been approved and is ready for funding`,
      ),
    ],
  },

  // ── 5. Reject ─────────────────────────────────────────────────────────────
  {
    id: "reject",
    from: ["under_review"],
    to: "rejected",
    label: "Reject Invoice",
    description: "Reject this invoice and notify the submitter — creates an exception record",
    requiredRole: "manager_or_admin",
    variant: "danger",
    requiresReason: true,
    guards: [guardHasReason],
    sideEffects: [
      fxSetStatus("rejected"),
      fxCreateRejectionException,
      fxActivity("invoice_rejected", ctx => `Invoice ${ctx.invoice.invoiceNumber} rejected: ${ctx.reason}`),
      fxNotify(
        ctx => `Invoice Rejected — ${ctx.invoice.invoiceNumber}`,
        ctx => `Your invoice ${ctx.invoice.invoiceNumber} was rejected: ${ctx.reason}`,
      ),
    ],
  },

  // ── 6. Fund ───────────────────────────────────────────────────────────────
  {
    id: "fund",
    from: ["approved"],
    to: "funded",
    label: "Fund Invoice",
    description: "Create payout record and fund this invoice — auto-calculates advance, fee, and reserve",
    requiredRole: "manager_or_admin",
    variant: "primary",
    guards: [guardNoExistingPayout],
    sideEffects: [
      fxSetStatus("funded"),
      fxCreatePayout,
      fxStage("advance"),
      fxActivity("invoice_funded", ctx => `Invoice ${ctx.invoice.invoiceNumber} funded — payout record auto-created`),
      fxNotify(
        ctx => `Invoice Funded — ${ctx.invoice.invoiceNumber}`,
        ctx => `Invoice ${ctx.invoice.invoiceNumber} has been funded. Your advance payment is being processed.`,
      ),
      // Auto-trigger broker follow-up: invoice is now collections-ready
      async ({ invoiceId, actorId }) => {
        triggerBrokerFollowUp(invoiceId, actorId, "funded", "auto").catch(() => {});
      },
    ],
  },

  // ── 7. Settle ─────────────────────────────────────────────────────────────
  {
    id: "settle",
    from: ["funded"],
    to: "settled",
    label: "Mark as Settled",
    description: "Mark invoice settled after debtor/broker payment received",
    requiredRole: "manager_or_admin",
    variant: "primary",
    guards: [guardHasPaymentApplied],
    sideEffects: [
      fxSetStatus("settled"),
      fxStage("final_settlement"),
      fxActivity("invoice_settled", ctx => `Invoice ${ctx.invoice.invoiceNumber} settled`),
    ],
  },

  // ── 8. Mark paid + release reserve ───────────────────────────────────────
  {
    id: "mark_paid",
    from: ["settled"],
    to: "paid",
    label: "Mark Paid & Release Reserve",
    description: "Mark fully paid and release carrier reserve — this is the final lifecycle action",
    requiredRole: "manager_or_admin",
    variant: "primary",
    guards: [],
    sideEffects: [
      fxSetStatus("paid"),
      fxReleaseReserve,
      fxStage("final_settlement"),
      fxActivity("invoice_paid", ctx => `Invoice ${ctx.invoice.invoiceNumber} fully paid — reserve released`),
      fxNotify(
        ctx => `Invoice Paid — ${ctx.invoice.invoiceNumber}`,
        ctx => `Invoice ${ctx.invoice.invoiceNumber} is fully paid and your reserve has been released.`,
      ),
    ],
  },

  // ── 9. Reopen rejected ────────────────────────────────────────────────────
  {
    id: "reopen",
    from: ["rejected"],
    to: "draft",
    label: "Reopen for Editing",
    description: "Reopen a rejected invoice so it can be corrected and resubmitted",
    requiredRole: "any",
    variant: "secondary",
    guards: [],
    sideEffects: [
      fxSetStatus("draft"),
      fxActivity("invoice_reopened", ctx => `Invoice ${ctx.invoice.invoiceNumber} reopened for editing`),
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

export interface AvailableTransition {
  id: string;
  label: string;
  description: string;
  to: string;
  variant: "primary" | "secondary" | "danger";
  blocked: boolean;       // hard-blocked (errors present)
  warnOnly: boolean;      // only soft warnings, admin can force
  blockers: BlockerInfo[];
  requiresReason: boolean;
}

export interface TransitionResult {
  success: boolean;
  invoice?: any;
  blockers?: BlockerInfo[];
  error?: string;
}

/** Return all valid transitions for the current invoice + actor role, with blocker info. */
export async function getAvailableTransitions(
  invoiceId: number,
  actorRole: string,
): Promise<AvailableTransition[]> {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) return [];

  const ctx: Ctx = { invoiceId, invoice, actorId: "", actorRole };
  const result: AvailableTransition[] = [];

  for (const def of TRANSITION_DEFS) {
    if (!def.from.includes(invoice.status)) continue;
    if (def.requiredRole === "manager_or_admin" && actorRole !== "manager" && actorRole !== "admin") continue;
    if (def.requiredRole === "admin" && actorRole !== "admin") continue;

    const blockers: BlockerInfo[] = [];
    for (const guard of def.guards) {
      const b = await guard(ctx);
      if (b) blockers.push(b);
    }
    const hasErrors   = blockers.some(b => b.severity === "error");
    const hasWarnings = blockers.some(b => b.severity === "warning");

    result.push({
      id: def.id, label: def.label, description: def.description, to: def.to,
      variant: def.variant,
      blocked:  hasErrors,
      warnOnly: !hasErrors && hasWarnings,
      blockers,
      requiresReason: def.requiresReason ?? false,
    });
  }
  return result;
}

/** Execute a transition — runs guards, then side effects, returns result. */
export async function performTransition(
  invoiceId: number,
  transitionId: string,
  actorId: string,
  actorRole: string,
  reason?: string,
  force?: boolean,
): Promise<TransitionResult> {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) return { success: false, error: "Invoice not found" };

  const def = TRANSITION_DEFS.find(d => d.id === transitionId);
  if (!def) return { success: false, error: `Unknown transition: ${transitionId}` };
  if (!def.from.includes(invoice.status))
    return { success: false, error: `Cannot perform "${def.label}" when invoice status is "${invoice.status}"` };
  if (def.requiredRole === "manager_or_admin" && actorRole !== "manager" && actorRole !== "admin")
    return { success: false, error: "Insufficient permissions for this action" };
  if (def.requiredRole === "admin" && actorRole !== "admin")
    return { success: false, error: "Only admins can perform this action" };

  const ctx: Ctx = { invoiceId, invoice, actorId, actorRole, reason, force };

  // Run guards
  const blockers: BlockerInfo[] = [];
  for (const guard of def.guards) {
    const b = await guard(ctx);
    if (b) blockers.push(b);
  }

  const hardBlockers = blockers.filter(b => b.severity === "error");
  if (hardBlockers.length > 0)
    return { success: false, blockers: hardBlockers, error: "Transition blocked by validation rules" };

  const softBlockers = blockers.filter(b => b.severity === "warning");
  if (softBlockers.length > 0 && !force)
    return { success: false, blockers: softBlockers, error: "Transition has warnings — use admin override to proceed" };

  // Execute side effects
  for (const fx of def.sideEffects) {
    try { await fx(ctx); }
    catch (err) { console.error(`[lifecycle] side-effect error in ${transitionId}:`, err); }
  }

  const [updated] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  return { success: true, invoice: updated };
}
