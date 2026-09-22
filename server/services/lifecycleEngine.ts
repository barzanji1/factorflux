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
  eventLedger,
  creditChecks,
  clients,
  clientVault,
} from "../../shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { advanceInvoiceStage, STAGE_META, type FactoringStage } from "./invoiceStage";
import { guardDocsForReview, guardDocsForApproval } from "./docValidation";
import { triggerBrokerFollowUp } from "./brokerFollowUpEngine";
import { sendEmailTracked } from "../emailService";
import {
  compensateFundingReceiptUpload,
  issueInitialFundingReceipt,
  sendFundingReceiptEmail,
  type IssuedFundingReceipt,
} from "./fundingReceiptService";
import { decryptVault } from "./vaultCrypto";

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
  paymentMethod?: "ach" | "wire" | "check";
  bankAccountVaultId?: number;
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
  requiredRole: "any" | "agent" | "manager_or_admin" | "admin";
  /** Agent-only actions must be performed by the invoice's submitting agent. */
  submitterOnly?: boolean;
  variant: "primary" | "secondary" | "danger";
  requiresReason?: boolean;
  guards: Guard[];
  sideEffects: SideEffect[];
}

/**
 * Database statuses remain deliberately stable for downstream collections,
 * payout, and chargeback integrations.  API consumers should use this label
 * when presenting the simplified factoring workflow.
 */
export const INVOICE_DISPLAY_STATUS: Record<string, string> = {
  draft: "Draft",
  submitted: "Pending Review",
  docs_pending: "Documents Required",
  under_review: "Under Review",
  approved: "Approved for Funding",
  rejected: "Rejected",
  funded: "Funded",
  settled: "Settled",
  paid: "Collected",
  held: "On Hold",
};

export function getInvoiceDisplayStatus(status: string | null | undefined) {
  return INVOICE_DISPLAY_STATUS[status ?? ""] ?? "Unknown";
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

/** Funding is never permitted without the two core freight documents. */
const guardHasFundingDocs: Guard = async ({ invoiceId }) => {
  const docs = await db.select({ documentType: documents.documentType }).from(documents)
    .where(eq(documents.invoiceId, invoiceId));
  const types = new Set(docs.map((document) => document.documentType));
  const missing = [
    !types.has("rate_confirmation") ? "rate confirmation" : null,
    !(types.has("bill_of_lading") || types.has("bol")) ? "bill of lading" : null,
  ].filter(Boolean);
  return missing.length
    ? { code: "missing_funding_docs", message: `Cannot fund without: ${missing.join(", ")}`, severity: "error" }
    : null;
};

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
  if (invoice.brokerId) {
    const [cc] = await db.select({ id: creditChecks.id }).from(creditChecks)
      .where(and(
        eq(creditChecks.entityType, "broker"),
        eq(creditChecks.entityId, invoice.brokerId),
        eq(creditChecks.status, "declined"),
      )).limit(1);
    return cc ? { code: "credit_declined", message: "Broker has a declined credit check — review before approving", severity: "warning" } : null;
  }
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

/** Write one canonical structured status-change audit event. */
function fxSetStatus(newStatus: string): SideEffect {
  return async ({ invoiceId, actorId, invoice, reason }) => {
    const statusUpdate: any = { status: newStatus as any, updatedAt: new Date() };
    if (newStatus === "submitted" && !invoice.submittedAt) statusUpdate.submittedAt = new Date();
    // Do not overwrite the original funding date on any later transition.
    if (newStatus === "approved") {
      statusUpdate.approvedBy = actorId;
      statusUpdate.approvedAt = new Date();
    }
    if (newStatus === "funded" && !invoice.fundedAt) statusUpdate.fundedAt = new Date();
    await db.transaction(async tx => {
      const [updated] = await tx.update(invoices)
        .set(statusUpdate)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.status, invoice.status)))
        .returning({ id: invoices.id });
      if (!updated) throw new Error(`Invoice status changed before "${newStatus}" could be applied`);
      await tx.insert(eventLedger).values({
        entityType: "invoice", entityId: invoiceId, eventType: "invoice_status_changed",
        actorType: "user", actorId,
        payloadJson: {
          from: invoice.status,
          to: newStatus,
          reason: reason ?? null,
          label: newStatus === "approved" ? "Invoice approved" : `Invoice status changed to ${newStatus}`,
        },
      });
    });
  };
}

/** Advance factoring lifecycle stage */
function fxStage(stage: FactoringStage): SideEffect {
  return async ({ invoiceId, actorId, reason }) =>
    advanceInvoiceStage(invoiceId, stage, actorId, reason);
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
  const hasBillOfLading = types.has("bill_of_lading") || types.has("bol");
  if (!types.has("rate_confirmation") || !hasBillOfLading) {
    await db.transaction(async tx => {
      const [updated] = await tx.update(invoices)
        .set({ status: "docs_pending", updatedAt: new Date() })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "submitted")))
        .returning({ id: invoices.id });
      if (!updated) return;
      await tx.insert(eventLedger).values({
        entityType: "invoice", entityId: invoiceId, eventType: "invoice_status_changed",
        actorType: "system", actorId,
        payloadJson: {
          from: "submitted",
          to: "docs_pending",
          reason: "Missing rate confirmation or bill of lading after submission",
          label: "Documents pending",
        },
      });
    });
  }
};

/** Auto-create payout record on funding */
const fxCreatePayout: SideEffect = async ({ invoiceId, actorId, paymentMethod, bankAccountVaultId }) => {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return;
  const client = await storage.getClient(inv.clientId);
  const invoiceAmount = parseFloat(inv.amount);
  const advanceRate   = parseFloat(client?.advanceRate ?? "80.00");
  const feeRate       = parseFloat(client?.factoringFeeRate ?? "3.00");
  const advanceAmount = +(invoiceAmount * advanceRate / 100).toFixed(2);
  const feeAmount     = +(invoiceAmount * feeRate  / 100).toFixed(2);
  const reserveAmount = +(invoiceAmount - advanceAmount).toFixed(2);
  const netPayout     = +(advanceAmount - feeAmount).toFixed(2);
  await storage.createPayout({
    invoiceId, clientId: inv.clientId,
    invoiceAmount: String(invoiceAmount), advanceRate: String(advanceRate), feeRate: String(feeRate),
    advanceAmount: String(advanceAmount), feeAmount: String(feeAmount),
    reserveAmount: String(reserveAmount), netPayout: String(netPayout),
    paymentMethod: paymentMethod ?? "ach",
    bankAccountVaultId,
    paymentStatus: "advance_paid",
    advancePaidAt: new Date(),
    advancePaidBy: actorId,
    notes: "Auto-created by lifecycle engine on invoice funding",
    createdBy: actorId,
  });
};

const money = (value: string | number) =>
  Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Send carrier confirmation after the payout snapshot has been created. */
const fxSendFundingConfirmation: SideEffect = async ({ invoiceId, actorId }) => {
  try {
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
    const [payout] = await db.select().from(payouts).where(eq(payouts.invoiceId, invoiceId));
    if (!inv || !payout) return;
    const carrier = await storage.getClient(inv.clientId);
    if (!carrier?.email) {
      await db.insert(eventLedger).values({
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "funding_email_skipped",
        actorType: "system",
        actorId,
        payloadJson: { reason: "Carrier has no email on file" },
      });
      return;
    }

    let bankName = "Selected bank";
    let lastFour = "••••";
    if (payout.bankAccountVaultId) {
      const account = await storage.getVaultEntry(payout.bankAccountVaultId);
      if (account) {
        try {
          const data = JSON.parse(decryptVault(account.encryptedData));
          bankName = data.bankName || account.label || bankName;
          const digits = String(data.accountNumber || "").replace(/\D/g, "");
          if (digits) lastFour = digits.slice(-4);
        } catch { bankName = account.label || bankName; }
      }
    }

    const method = payout.paymentMethod === "wire" ? "Wire" : "ACH";
    const availability = method === "Wire"
      ? "Same day if processed before 1:15 PM MST"
      : "Next business day";
    const subject = `Invoice ${inv.invoiceNumber} Funded — Your Advance is on the Way`;
    const text = `Hi ${carrier.name},

Great news! Your invoice has been processed and your advance payment is on its way.

Invoice Details:
- Invoice #: ${inv.invoiceNumber}
- Load #: ${inv.loadNumber || "N/A"}
- Gross Invoice Amount: ${money(payout.invoiceAmount)}
- Advance Rate: ${Number(payout.advanceRate).toFixed(2)}%
- Advance Amount: ${money(payout.advanceAmount)}
- Factoring Fee: ${money(payout.feeAmount)}
- Reserve Held: ${money(payout.reserveAmount)}
- Net to You: ${money(payout.netPayout)}
- Payment Method: ${method}
- Bank Account: ${bankName} ending in ${lastFour}

Estimated Availability:
- ${method}: ${availability}

If you have any questions, contact us at:
Email: dosh@truckingprosfinancial.com
Phone: 385-495-4962

Thank you for choosing Trucking Pros Financial.

Trucking Pros Financial Team`;

    const result = await sendEmailTracked({
      from: "dosh@truckingprosfinancial.com",
      replyTo: "dosh@truckingprosfinancial.com",
      to: carrier.email,
      subject,
      text,
    });
    await db.insert(eventLedger).values({
      entityType: "invoice", entityId: invoiceId,
      eventType: result.success ? "funding_email_sent" : "funding_email_failed",
      actorType: "system", actorId,
      payloadJson: { recipient: carrier.email, messageId: result.messageId ?? null, paymentMethod: method },
    });
    if (result.success) {
      await storage.createNotification({
        userId: actorId,
        title: "Funding email sent",
        message: `Confirmation sent to ${carrier.name} for invoice ${inv.invoiceNumber}.`,
        type: "success", entityType: "invoice", entityId: invoiceId,
        actionUrl: `/invoices/${invoiceId}`,
      } as any);
    }
  } catch (error: any) {
    console.error("[funding-email] unexpected error:", error?.message ?? error);
  }
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
    from: ["draft", "rejected"],
    to: "submitted",
    label: "Submit for Funding",
    description: "Submit this invoice to the manager funding queue",
    requiredRole: "agent",
    submitterOnly: true,
    variant: "primary",
    guards: [guardHasClient, guardHasAmount, guardHasRequiredDocs],
    sideEffects: [
      fxSetStatus("submitted"),
      fxCheckDocsAutoDowngrade,
      fxStage("document_intake"),
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
      fxNotify(
        ctx => `Invoice Approved — ${ctx.invoice.invoiceNumber}`,
        ctx => `Your invoice ${ctx.invoice.invoiceNumber} has been approved and is ready for funding`,
      ),
    ],
  },

  // ── 5. Reject ─────────────────────────────────────────────────────────────
  {
    id: "reject",
    from: ["submitted", "docs_pending", "under_review"],
    to: "rejected",
    label: "Reject Invoice",
    description: "Reject this invoice and notify the submitter — creates an exception record",
    requiredRole: "manager_or_admin",
    variant: "danger",
    requiresReason: true,
    guards: [guardHasReason],
    sideEffects: [
      fxSetStatus("rejected"),
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
    guards: [guardNoExistingPayout, guardHasFundingDocs],
    sideEffects: [
      fxCreatePayout,
      fxSetStatus("funded"),
      fxSendFundingConfirmation,
      // Funding completes Advance; Approval is the next active lifecycle stage.
      fxStage("approval"),
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

  // ── 7. Record collection ──────────────────────────────────────────────────
  {
    id: "settle",
    from: ["funded"],
    to: "paid",
    label: "Mark Collected",
    description: "Record receipt of the debtor or broker payment",
    requiredRole: "manager_or_admin",
    variant: "primary",
    guards: [guardHasPaymentApplied],
    sideEffects: [
      fxSetStatus("paid"),
      fxStage("collections"),
    ],
  },

  // ── 8. Final settlement + reserve release ────────────────────────────────
  {
    id: "mark_paid",
    from: ["paid"],
    to: "settled",
    label: "Settle Invoice",
    description: "Complete settlement and release the carrier reserve",
    requiredRole: "manager_or_admin",
    variant: "primary",
    guards: [],
    sideEffects: [
      fxSetStatus("settled"),
      fxReleaseReserve,
      fxStage("final_settlement"),
      fxNotify(
        ctx => `Invoice Settled — ${ctx.invoice.invoiceNumber}`,
        ctx => `Invoice ${ctx.invoice.invoiceNumber} is settled and your reserve has been released.`,
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
    requiredRole: "agent",
    submitterOnly: true,
    variant: "secondary",
    guards: [],
    sideEffects: [
      fxSetStatus("draft"),
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
  actorId?: string,
): Promise<AvailableTransition[]> {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) return [];

  const ctx: Ctx = { invoiceId, invoice, actorId: actorId ?? "", actorRole };
  const result: AvailableTransition[] = [];

  for (const def of TRANSITION_DEFS) {
    if (!def.from.includes(invoice.status)) continue;
    if (def.requiredRole === "agent" && actorRole !== "employee") continue;
    if (def.submitterOnly && invoice.submittedBy !== ctx.actorId) continue;
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

/**
 * Funding is the one lifecycle transition that creates records in several
 * tables. Keep these mandatory writes on the same transaction client so a
 * partial payout can never leave an invoice looking funded (or vice versa).
 */
async function executeFundTransaction(
  invoiceId: number,
  actorId: string,
  paymentMethod: "ach" | "wire" | "check" | undefined,
  bankAccountVaultId: number,
) {
  let issuedReceipt: IssuedFundingReceipt | null = null;
  try {
    return await db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status !== "approved") throw new Error(`Cannot fund invoice when status is "${invoice.status}"`);

    const [account] = await tx.select({
      id: clientVault.id,
      clientId: clientVault.clientId,
      dataType: clientVault.dataType,
      isActive: clientVault.isActive,
    }).from(clientVault).where(eq(clientVault.id, bankAccountVaultId));
    if (!account || account.clientId !== invoice.clientId || account.dataType !== "bank_account" || !account.isActive) {
      throw new Error("The selected bank account is not available for this carrier");
    }

    const [client] = await tx.select({
      advanceRate: clients.advanceRate,
      factoringFeeRate: clients.factoringFeeRate,
      name: clients.name,
      email: clients.email,
    }).from(clients).where(eq(clients.id, invoice.clientId));
    const invoiceAmount = parseFloat(invoice.amount);
    const advanceRate = parseFloat(client?.advanceRate ?? "80.00");
    const feeRate = parseFloat(client?.factoringFeeRate ?? "3.00");
    const advanceAmount = +(invoiceAmount * advanceRate / 100).toFixed(2);
    const feeAmount = +(invoiceAmount * feeRate / 100).toFixed(2);
    const reserveAmount = +(invoiceAmount - advanceAmount).toFixed(2);
    const netPayout = +(advanceAmount - feeAmount).toFixed(2);

    await tx.insert(payouts).values({
      invoiceId,
      clientId: invoice.clientId,
      invoiceAmount: String(invoiceAmount),
      advanceRate: String(advanceRate),
      feeRate: String(feeRate),
      advanceAmount: String(advanceAmount),
      feeAmount: String(feeAmount),
      reserveAmount: String(reserveAmount),
      netPayout: String(netPayout),
      paymentMethod: paymentMethod ?? "ach",
      bankAccountVaultId,
      paymentStatus: "advance_paid",
      advancePaidAt: new Date(),
      advancePaidBy: actorId,
      notes: "Auto-created by lifecycle engine on invoice funding",
      createdBy: actorId,
    });

    const currentStage = (invoice.factoringStage ?? "document_intake") as FactoringStage;
    const stageAdvances = (STAGE_META.approval?.step ?? 0) > (STAGE_META[currentStage]?.step ?? 0);
    const [updated] = await tx.update(invoices).set({
      status: "funded",
      fundedAt: invoice.fundedAt ?? new Date(),
      factoringStage: stageAdvances ? "approval" : invoice.factoringStage,
      updatedAt: new Date(),
    }).where(and(eq(invoices.id, invoiceId), eq(invoices.status, "approved"))).returning();
    if (!updated) throw new Error("Invoice status could not be updated");

    await tx.insert(eventLedger).values({
      entityType: "invoice",
      entityId: invoiceId,
      eventType: "invoice_status_changed",
      actorType: "user",
      actorId,
      payloadJson: {
        from: invoice.status,
        to: "funded",
        reason: null,
        label: "Invoice funded",
      },
    });
    if (stageAdvances) {
      await tx.insert(eventLedger).values({
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "stage_advanced",
        actorType: "user",
        actorId,
        payloadJson: {
          from: currentStage,
          to: "approval",
          fromLabel: STAGE_META[currentStage]?.label,
          toLabel: STAGE_META.approval.label,
          reason: null,
        },
      });
    }
    issuedReceipt = await issueInitialFundingReceipt(tx as any, {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      carrierId: invoice.clientId,
      carrierName: client?.name,
      carrierEmail: client?.email,
      brokerId: invoice.brokerId,
      invoiceAmount,
      advancePct: advanceRate,
      feeAmount,
      reserveAmount,
      netFunded: netPayout,
      paymentMethod: paymentMethod ?? "ach",
      paymentReference: invoice.paymentReference,
      fundedAt: updated.fundedAt ?? new Date(),
      fundedByUserId: actorId,
    });
    return {
      invoice: updated,
      receiptIssue: issuedReceipt,
      carrierEmail: client?.email ?? null,
      invoiceNumber: invoice.invoiceNumber,
    };
    });
  } catch (error) {
    const uploaded = issuedReceipt as IssuedFundingReceipt | null;
    if (uploaded) await compensateFundingReceiptUpload(uploaded.receipt);
    throw error;
  }
}

/** Execute a transition — runs guards, then side effects, returns result. */
export async function performTransition(
  invoiceId: number,
  transitionId: string,
  actorId: string,
  actorRole: string,
  reason?: string,
  force?: boolean,
  paymentMethod?: "ach" | "wire" | "check",
  bankAccountVaultId?: number,
): Promise<TransitionResult> {
  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!invoice) return { success: false, error: "Invoice not found" };

  const def = TRANSITION_DEFS.find(d => d.id === transitionId);
  if (!def) return { success: false, error: `Unknown transition: ${transitionId}` };
  if (!def.from.includes(invoice.status))
    return { success: false, error: `Cannot perform "${def.label}" when invoice status is "${invoice.status}"` };
  if (def.requiredRole === "agent" && actorRole !== "employee")
    return { success: false, error: "Only agents can perform this action" };
  if (def.submitterOnly && invoice.submittedBy !== actorId)
    return { success: false, error: "Only the submitting agent can perform this action" };
  if (def.requiredRole === "manager_or_admin" && actorRole !== "manager" && actorRole !== "admin")
    return { success: false, error: "Insufficient permissions for this action" };
  if (def.requiredRole === "admin" && actorRole !== "admin")
    return { success: false, error: "Only admins can perform this action" };

  if (transitionId === "fund") {
    if (!bankAccountVaultId) return { success: false, error: "A carrier bank account is required" };
    const account = await storage.getVaultEntry(bankAccountVaultId);
    if (!account || account.clientId !== invoice.clientId || account.dataType !== "bank_account" || !account.isActive) {
      return { success: false, error: "The selected bank account is not available for this carrier" };
    }
  }
  const ctx: Ctx = { invoiceId, invoice, actorId, actorRole, reason, force, paymentMethod, bankAccountVaultId };

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
  if (softBlockers.length > 0 && force && actorRole !== "admin")
    return { success: false, blockers: softBlockers, error: "Only admins can override transition warnings" };

  if (transitionId === "fund") {
    try {
      const funded = await executeFundTransaction(invoiceId, actorId, paymentMethod, bankAccountVaultId!);
      const receiptDelivery = await sendFundingReceiptEmail(
        funded.receiptIssue.receipt,
        funded.invoiceNumber,
        funded.carrierEmail,
        funded.receiptIssue.pdf,
      ).catch(err => {
        console.error("[funding-receipt] email failed:", err);
        return { success: false, messageId: undefined };
      });
      await db.insert(eventLedger).values({
        entityType: "invoice",
        entityId: invoiceId,
        eventType: receiptDelivery.success ? "funding_receipt_email_sent" : "funding_receipt_email_failed",
        actorType: "system",
        actorId,
        payloadJson: {
          receiptNo: funded.receiptIssue.receipt.receiptNo,
          version: funded.receiptIssue.receipt.version,
          recipient: funded.carrierEmail,
          messageId: receiptDelivery.messageId ?? null,
        },
      }).catch(err => console.error("[funding-receipt] email audit failed:", err));
      // Email, notifications, activity, and follow-up work are deliberately
      // post-commit and non-blocking. The first, second, and fourth fund
      // effects are the transaction-owned payout/status/stage effects.
      const postCommitEffects = def.sideEffects.filter((_fx, index) => ![0, 1, 3].includes(index));
      void Promise.all(postCommitEffects.map(async (fx) => {
        try { await fx(ctx); }
        catch (err) { console.error(`[lifecycle] post-commit side-effect error in ${transitionId}:`, err); }
      }));
      return { success: true, invoice: funded.invoice };
    } catch (err) {
      console.error("[lifecycle] fund transaction rolled back:", err);
      return { success: false, error: err instanceof Error ? err.message : "Funding transaction failed" };
    }
  }

  // Execute side effects
  for (let index = 0; index < def.sideEffects.length; index += 1) {
    const fx = def.sideEffects[index];
    try { await fx(ctx); }
    catch (err) {
      console.error(`[lifecycle] side-effect error in ${transitionId}:`, err);
      if (index === 0) {
        return { success: false, error: err instanceof Error ? err.message : "Invoice status transition failed" };
      }
    }
  }

  const [updated] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  return { success: true, invoice: updated };
}
