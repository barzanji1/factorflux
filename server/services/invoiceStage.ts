import { db } from "../db";
import {
  invoices,
  invoiceStatusHistory,
  invoiceChargebackEvents,
  invoiceRefunds,
  eventLedger,
  documents,
  payouts,
  collections,
  paymentApplicationLines,
  cashApplications,
  exceptions,
  clients,
  debtors,
  brokers,
  brokerBranches,
  drivers,
  loads,
  users,
  clientVault,
  brokerFollowUps,
  brokerFollowUpReminders,
  creditChecks,
} from "../../shared/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { decryptVault } from "./vaultCrypto";

// ─── Stage definitions ─────────────────────────────────────────────────────

export const FACTORING_STAGES = [
  "document_intake",
  "verification",
  "advance",
  "approval",
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
    advance:          { label: "Advance",             description: "Advance payment sent to carrier",                  color: "violet",  step: 3 },
    approval:         { label: "Approval",            description: "Internal factor review and funding decision",      color: "blue",    step: 4 },
  collections:      { label: "Collections",         description: "Collecting payment from broker/debtor",            color: "orange",  step: 5 },
  payment_receipt:  { label: "Payment Receipt",     description: "Payment received from broker/debtor",              color: "teal",    step: 6 },
  reconciliation:   { label: "Reconciliation",      description: "Matching payment to outstanding balance",          color: "indigo",  step: 7 },
  final_settlement: { label: "Final Settlement",    description: "Reserve released — invoice fully settled",         color: "emerald", step: 8 },
};

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
    ? await db.select({
      id: clients.id, name: clients.name, preferredName: clients.preferredName,
      email: clients.email, phone: clients.phone, address: clients.address,
      city: clients.city, state: clients.state, zipCode: clients.zipCode,
      contactPerson: clients.contactPerson, mcNumber: clients.mcNumber,
      dotNumber: clients.dotNumber, creditLimit: clients.creditLimit,
      status: clients.status, assignedProcessor: clients.assignedProcessor,
    }).from(clients).where(eq(clients.id, inv.clientId))
    : [null];

  const [debtor] = inv.debtorId
    ? await db.select().from(debtors).where(eq(debtors.id, inv.debtorId))
    : [null];
  const [broker] = inv.brokerId
    ? await db.select().from(brokers).where(eq(brokers.id, inv.brokerId))
    : [null];
  const [branch] = inv.branchId
    ? await db.select().from(brokerBranches).where(eq(brokerBranches.id, inv.branchId))
    : [null];
  const [driver] = inv.driverId
    ? await db.select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
      status: drivers.status,
    }).from(drivers).where(eq(drivers.id, inv.driverId))
    : [null];
  const load = inv.loadId
    ? (await db.select().from(loads).where(eq(loads.id, inv.loadId)).limit(1))[0] ?? null
    : null;
  const [assignedProcessor] = client?.assignedProcessor
    ? await db.select({
      id: users.id, firstName: users.firstName, lastName: users.lastName,
      email: users.email, profileImageUrl: users.profileImageUrl, role: users.role,
    }).from(users).where(eq(users.id, client.assignedProcessor)).limit(1)
    : [null];

  const [payout] = await db.select().from(payouts).where(eq(payouts.invoiceId, invoiceId));

  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.invoiceId, invoiceId))
    .orderBy(desc(documents.createdAt));
  const documentUploaderIds = docs.map(doc => doc.uploadedBy).filter(Boolean) as string[];
  const documentUploaders = documentUploaderIds.length
    ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users).where(inArray(users.id, documentUploaderIds))
    : [];
  const documentUploaderMap = new Map(documentUploaders.map(user => [user.id, user]));
  const documentsWithMetadata = docs.map(doc => ({
    id: doc.id, originalName: doc.originalName, mimeType: doc.mimeType, size: doc.size,
    originalSize: doc.originalSize, compressedSize: doc.compressedSize,
    documentType: doc.documentType, finalDocumentType: doc.finalDocumentType,
    candidateDocumentType: doc.candidateDocumentType, aiDocumentType: doc.aiDocumentType,
    status: doc.status, sourceChannel: doc.sourceChannel, uploadedBy: doc.uploadedBy,
    createdAt: doc.createdAt,
    uploader: doc.uploadedBy ? documentUploaderMap.get(doc.uploadedBy) ?? null : null,
    uploadedByUser: doc.uploadedBy ? documentUploaderMap.get(doc.uploadedBy) ?? null : null,
    viewUrl: `/api/documents/${doc.id}/view`,
    downloadUrl: `/api/documents/${doc.id}/download`,
  }));

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
  const cashApplicationIds = cashAppLines.map(line => line.cashApplicationId);
  const cashApplicationsForInvoice = cashApplicationIds.length
    ? await db.select().from(cashApplications).where(inArray(cashApplications.id, cashApplicationIds))
    : [];
  const cashApplicationMap = new Map(cashApplicationsForInvoice.map(application => [application.id, application]));
  const appliedTotal = cashAppLines.reduce((total, line) => total + Number(line.appliedAmount || 0), 0);
  const invoiceAmount = Number(inv.amount || 0);
  const shortPayLine = cashAppLines.find(line => line.varianceType === "short_pay");

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
  const brokerFollowupRows = await db.select().from(brokerFollowUps)
    .where(eq(brokerFollowUps.invoiceId, invoiceId)).orderBy(desc(brokerFollowUps.createdAt));
  const followUpIds = brokerFollowupRows.map(followUp => followUp.id);
  const reminderRows = followUpIds.length
    ? await db.select().from(brokerFollowUpReminders).where(inArray(brokerFollowUpReminders.followUpId, followUpIds))
    : [];
  const remindersByFollowUp = new Map<number, typeof reminderRows>();
  for (const reminder of reminderRows) {
    const existing = remindersByFollowUp.get(reminder.followUpId) ?? [];
    existing.push(reminder);
    remindersByFollowUp.set(reminder.followUpId, existing);
  }
  const chargebackEvents = await db.select().from(invoiceChargebackEvents)
    .where(eq(invoiceChargebackEvents.invoiceId, invoiceId)).orderBy(desc(invoiceChargebackEvents.createdAt));
  const chargebackActorIds = chargebackEvents.map(event => event.actorId).filter(Boolean) as string[];
  const chargebackActors = chargebackActorIds.length
    ? await db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    }).from(users).where(inArray(users.id, chargebackActorIds))
    : [];
  const chargebackActorMap = new Map(chargebackActors.map(user => [user.id, user]));
  const refunds = await db.select().from(invoiceRefunds)
    .where(eq(invoiceRefunds.invoiceId, invoiceId)).orderBy(desc(invoiceRefunds.refundDate));
  const refundAuthorIds = refunds.map(refund => refund.createdBy).filter(Boolean) as string[];
  const refundAuthors = refundAuthorIds.length
    ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users).where(inArray(users.id, refundAuthorIds))
    : [];
  const refundAuthorMap = new Map(refundAuthors.map(user => [user.id, user]));

  const relatedBrokerInvoices = (broker?.id || debtor?.id)
    ? await db.select().from(invoices).where(and(
      broker?.id
        ? eq(invoices.brokerId, broker.id)
        : eq(invoices.debtorId, debtor!.id),
    )).orderBy(desc(invoices.invoiceDate), desc(invoices.createdAt))
    : [];
  const relatedBrokerInvoiceIds = relatedBrokerInvoices.map(row => row.id);
  const relatedBrokerLines = relatedBrokerInvoiceIds.length
    ? await db.select().from(paymentApplicationLines).where(inArray(paymentApplicationLines.invoiceId, relatedBrokerInvoiceIds))
    : [];
  const relatedBrokerApplied = new Map<number, number>();
  for (const line of relatedBrokerLines) relatedBrokerApplied.set(line.invoiceId, (relatedBrokerApplied.get(line.invoiceId) ?? 0) + Number(line.appliedAmount || 0));
  const brokerHistory = relatedBrokerInvoices.map(row => {
    const applied = relatedBrokerApplied.get(row.id) ?? 0;
    const balance = ["paid", "settled"].includes(row.status) ? 0 : Math.max(0, Number(row.amount) - applied);
    return { id: row.id, invoiceNumber: row.invoiceNumber, invoiceDate: row.invoiceDate, amount: row.amount, status: row.status, appliedAmount: applied.toFixed(2), balance: balance.toFixed(2) };
  });
  const openBrokerStatuses = new Set(["submitted", "docs_pending", "under_review", "approved", "funded", "held"]);
  const brokerCurrentAr = brokerHistory.reduce(
    (sum, row) => sum + (openBrokerStatuses.has(row.status) ? Number(row.balance) : 0), 0,
  ).toFixed(2);
  const carrierInvoiceRows = await db.select().from(invoices)
    .where(eq(invoices.clientId, inv.clientId))
    .orderBy(desc(invoices.invoiceDate), desc(invoices.createdAt));
  const carrierInvoices = carrierInvoiceRows.map(row => ({
    id: row.id, invoiceNumber: row.invoiceNumber, invoiceDate: row.invoiceDate,
    dueDate: row.dueDate, amount: row.amount, status: row.status,
    fundedAt: row.fundedAt, createdAt: row.createdAt, isCurrent: row.id === invoiceId,
  }));
  const vaultEntries = await db.select().from(clientVault)
    .where(and(eq(clientVault.clientId, inv.clientId), eq(clientVault.dataType, "bank_account")));
  const maskBankAccount = (entry: typeof vaultEntries[number]) => {
    let data: any = {};
    try { data = JSON.parse(decryptVault(entry.encryptedData)); } catch { /* malformed legacy vault values remain masked */ }
    const digits = String(data.accountNumber ?? "").replace(/\D/g, "");
    return { id: entry.id, label: entry.label, bankName: data.bankName || "Bank", accountType: data.accountType || null, paymentType: data.paymentType || null, lastFour: digits.slice(-4).padStart(4, "•"), isActive: entry.isActive };
  };
  const allMaskedBankAccounts = vaultEntries.map(maskBankAccount);
  const maskedBankAccounts = allMaskedBankAccounts.filter(account => account.isActive);
  const latestCreditCheck = (broker?.id || debtor?.id)
    ? (await db.select().from(creditChecks).where(and(
      eq(creditChecks.entityType, broker?.id ? "broker" : "debtor"),
      eq(creditChecks.entityId, broker?.id ?? debtor!.id),
    )).orderBy(desc(creditChecks.createdAt)).limit(1))[0] ?? null
    : null;
  const fundedHistory = statusHistory.find(history => history.newStatus === "funded");
  const paymentActorId = payout?.advancePaidBy ?? fundedHistory?.changedBy ?? payout?.createdBy ?? null;
  const fundedActor = paymentActorId
    ? (await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users).where(eq(users.id, paymentActorId)).limit(1))[0] ?? null
    : null;
  const fundedAt = payout?.advancePaidAt ?? fundedHistory?.createdAt ?? null;
  const paidPayoutStatuses = ["advance_paid", "reserve_pending", "reserve_released", "complete"];
  const paymentSent = !!payout?.advancePaidAt && paidPayoutStatuses.includes(payout.paymentStatus);
  const timeline = await getInvoiceTimeline(invoiceId);

  return {
    ...inv,
    client: client ?? null,
    debtor: debtor ?? null,
    // Canonical broker relation first; legacy debtor remains available above.
    broker: broker ?? debtor ?? null,
    branch: branch ?? null,
    driver: driver ?? null,
    payout: payout ?? null,
    documents: documentsWithMetadata,
    collections: invCollections,
    cashAppLines,
    exceptions: invExceptions,
    statusHistory,
    load,
    assignedProcessorUser: assignedProcessor ?? null,
    selectedBankAccount: inv.bankAccountId ? allMaskedBankAccounts.find(account => account.id === inv.bankAccountId) ?? null : null,
    paperwork: documentsWithMetadata,
    brokerHistory: {
      invoices: brokerHistory,
      totals: {
        billed: brokerHistory.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2),
        applied: brokerHistory.reduce((sum, row) => sum + Number(row.appliedAmount || 0), 0).toFixed(2),
        outstanding: brokerHistory.reduce((sum, row) => sum + Number(row.balance || 0), 0).toFixed(2),
      },
      credit: {
        creditLimit: broker?.creditLimit ?? debtor?.creditLimit ?? null,
        currentAr: brokerCurrentAr,
        latestCheck: latestCreditCheck,
      },
    },
    carrierInvoices: {
      invoices: carrierInvoices,
      bankAccounts: maskedBankAccounts,
    },
    collectionsDetail: {
      collections: invCollections,
      brokerFollowUps: brokerFollowupRows.map(followUp => ({
        ...followUp,
        deliveryStatus: followUp.status,
        reminders: (remindersByFollowUp.get(followUp.id) ?? []).map(reminder => ({
          id: reminder.id, sequenceNumber: reminder.sequenceNumber,
          scheduledSendAt: reminder.scheduledSendAt, actualSendAt: reminder.actualSendAt,
          subject: reminder.subject, body: reminder.body, status: reminder.status,
          deliveryStatus: reminder.deliveryStatus, editedBy: reminder.editedBy,
        })),
      })),
    },
    chargeback: {
      status: inv.chargebackStatus,
      chargebackDate: inv.chargebackDate,
      extension: inv.chargebackExtensionDate ? {
        date: inv.chargebackExtensionDate, reason: inv.chargebackExtensionReason, by: inv.chargebackExtendedBy, at: inv.chargebackExtendedAt,
      } : null,
      history: chargebackEvents.map(event => ({
        ...event,
        actor: event.actorId ? chargebackActorMap.get(event.actorId) ?? null : null,
      })),
      refunds: refunds.map(refund => ({ ...refund, createdByUser: refundAuthorMap.get(refund.createdBy) ?? null })),
      refundedAmount: refunds.reduce((sum, refund) => sum + Number(refund.amount || 0), 0).toFixed(2),
    },
    cash: {
      applications: cashAppLines.map(line => ({ ...line, application: cashApplicationMap.get(line.cashApplicationId) ?? null })),
      appliedTotal: appliedTotal.toFixed(2),
      outstanding: Math.max(0, invoiceAmount - appliedTotal).toFixed(2),
      shortPay: shortPayLine ? { amount: Math.max(0, invoiceAmount - appliedTotal).toFixed(2), reason: shortPayLine.varianceReason, lineId: shortPayLine.id } : (appliedTotal > 0 && appliedTotal < invoiceAmount ? { amount: (invoiceAmount - appliedTotal).toFixed(2), reason: null, lineId: null } : null),
    },
    payoutDetail: payout ? {
      record: payout,
      calculation: { invoiceAmount: payout.invoiceAmount, advanceRate: payout.advanceRate, advanceAmount: payout.advanceAmount, feeRate: payout.feeRate, feeAmount: payout.feeAmount, reserveAmount: payout.reserveAmount, netPayout: payout.netPayout },
      funding: { status: payout.paymentStatus, fundedDate: fundedAt, fundedBy: fundedActor, paymentSent },
    } : null,
    timeline,
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

type TimelineEventFormat = {
  category: TimelineEvent["category"];
  title: (payload: Record<string, unknown>) => string;
  description: (payload: Record<string, unknown>) => string;
};

const timelineText = (value: unknown, fallback = "—") =>
  value === null || value === undefined || value === "" ? fallback : String(value);

const withTimelineReason = (description: string, payload: Record<string, unknown>) =>
  payload.reason ? `${description}. Reason: ${String(payload.reason)}` : description;

const statusChangedFormat: TimelineEventFormat = {
  category: "status",
  title: payload => timelineText(payload.label, `Status changed to ${timelineText(payload.to ?? payload.newStatus)}`),
  description: payload => withTimelineReason(
    `Invoice status updated from ${timelineText(payload.from ?? payload.oldStatus)} → ${timelineText(payload.to ?? payload.newStatus)}`,
    payload,
  ),
};

const invoiceTimelineEventFormats: Record<string, TimelineEventFormat> = {
  invoice_status_changed: statusChangedFormat,
  status_changed: statusChangedFormat,
  "invoice.status_changed": statusChangedFormat,
  "invoice.created": {
    category: "status",
    title: payload => `Invoice created${payload.status ? ` as ${payload.status}` : ""}`,
    description: payload => payload.invoiceNumber
      ? `Invoice ${payload.invoiceNumber} was created`
      : "Invoice record created",
  },
  "invoice.updated": {
    category: "system",
    title: payload => Object.prototype.hasOwnProperty.call(payload, "assignedTo")
      ? (payload.assignedTo ? "Invoice assigned" : "Invoice unassigned")
      : "Invoice updated",
    description: payload => Object.prototype.hasOwnProperty.call(payload, "assignedTo")
      ? (payload.assignedTo
          ? `Invoice assigned to ${timelineText(payload.assignedTo)}`
          : "Invoice assignment removed")
      : `Invoice fields updated: ${Object.keys(payload).filter(key => key !== "updatedAt").join(", ") || "record details"}`,
  },
  stage_advanced: {
    category: "stage",
    title: payload => `Stage advanced: ${timelineText(payload.fromLabel ?? payload.from)} → ${timelineText(payload.toLabel ?? payload.to)}`,
    description: payload => withTimelineReason(
      `Factoring stage moved to ${timelineText(payload.toLabel ?? payload.to)}`,
      payload,
    ),
  },
  auto_docs_pending: {
    category: "status",
    title: () => "Documents marked pending",
    description: payload => timelineText(payload.reason, "Required invoice documents are missing"),
  },
  invoice_note_added: {
    category: "collection",
    title: () => "Note added",
    description: () => "View the note in the Notes section",
  },
  invoice_note_edited: {
    category: "collection",
    title: () => "Note edited",
    description: () => "View the updated note in the Notes section",
  },
  invoice_note_deleted: {
    category: "collection",
    title: () => "Note deleted",
    description: () => "The note was removed from the Notes section",
  },
  invoice_aging_alert_triggered: {
    category: "system",
    title: payload => `${timelineText(payload.alertType, "Invoice aging")} alert triggered`,
    description: payload => `Invoice reached ${timelineText(payload.days, "the configured")} aging days`,
  },
  invoice_aging_alert_acknowledged: {
    category: "system",
    title: payload => `${timelineText(payload.alertType, "Invoice aging")} alert acknowledged`,
    description: () => "Invoice aging alert acknowledged",
  },
  chargeback_scheduled: {
    category: "system",
    title: () => "Chargeback scheduled",
    description: payload => `Chargeback scheduled after ${timelineText(payload.days)} days${payload.broker ? ` for ${payload.broker}` : ""}`,
  },
  chargeback_applied: {
    category: "system",
    title: () => "Chargeback applied",
    description: payload => `Chargeback applied after ${timelineText(payload.days)} days${payload.broker ? ` for ${payload.broker}` : ""}`,
  },
  chargeback_warning_sent: {
    category: "system",
    title: payload => `${timelineText(payload.thresholdDays, "80")}-day chargeback warning sent`,
    description: payload => `Broker notified of $${timelineText(payload.amountDue)} outstanding after ${timelineText(payload.agedDays)} days. Agent follow-up task created.`,
  },
  chargeback_warning_failed: {
    category: "system",
    title: () => "Chargeback warning delivery failed",
    description: payload => timelineText(payload.error, "Delivery could not be confirmed. Check Email Log and the assigned follow-up."),
  },
  chargeback_extended: {
    category: "system",
    title: () => "Chargeback extended",
    description: payload => withTimelineReason(
      `Chargeback extended to ${payload.extensionDate ? new Date(String(payload.extensionDate)).toLocaleDateString("en-US") : "a later date"}`,
      payload,
    ),
  },
  chargeback_refunded: {
    category: "payment",
    title: () => "Chargeback refunded",
    description: payload => withTimelineReason(
      `$${timelineText(payload.amount, "0")} returned to ${timelineText(payload.carrierName, "carrier")} on ${payload.refundDate ? String(payload.refundDate).slice(0, 10) : "the recorded date"}${payload.reference ? `, payment ref ${payload.reference}` : ""}`,
      payload,
    ),
  },
  funding_email_sent: {
    category: "payout",
    title: () => "Funding confirmation sent",
    description: payload => `Funding confirmation emailed to ${timelineText(payload.recipient, "the carrier")}`,
  },
  funding_email_failed: {
    category: "payout",
    title: () => "Funding confirmation failed",
    description: payload => `Funding confirmation could not be sent to ${timelineText(payload.recipient, "the carrier")}`,
  },
  funding_email_skipped: {
    category: "payout",
    title: () => "Funding confirmation skipped",
    description: payload => timelineText(payload.reason, "The carrier has no email address on file"),
  },
  payout_created: {
    category: "payout",
    title: () => "Payout record created",
    description: payload => `Net payout ${timelineText(payload.netPayout)}${payload.paymentStatus ? ` · ${payload.paymentStatus}` : ""}`,
  },
  receipt_issued: {
    category: "payout",
    title: payload => `Funding receipt ${timelineText(payload.receiptNo)} issued`,
    description: payload => `Receipt version ${timelineText(payload.version, "1")} is available for download`,
  },
  payment_reference_set: {
    category: "payout",
    title: () => "Payment reference recorded",
    description: payload => `Funding payment reference set to ${timelineText(payload.to)}`,
  },
  funding_receipt_email_sent: {
    category: "payout",
    title: () => "Funding receipt emailed",
    description: payload => `Funding receipt emailed to ${timelineText(payload.recipient, "the carrier")}`,
  },
  funding_receipt_email_failed: {
    category: "payout",
    title: () => "Funding receipt email failed",
    description: payload => `Funding receipt could not be emailed to ${timelineText(payload.recipient, "the carrier")}`,
  },
  doc_confirmed: {
    category: "document",
    title: payload => `${timelineText(payload.documentType, "Invoice document").replace(/_/g, " ")} confirmed`,
    description: payload => `Document review completed${payload.completenessPercent !== undefined ? ` · ${payload.completenessPercent}% complete` : ""}`,
  },
  document_requirements_overridden: {
    category: "document",
    title: () => "Document requirements overridden",
    description: payload => withTimelineReason("Invoice document requirements were overridden", payload),
  },
  broker_followup_reminder_edited: {
    category: "collection",
    title: () => "Broker follow-up reminder edited",
    description: () => "A scheduled broker follow-up reminder was updated",
  },
  broker_followup_triggered: {
    category: "collection",
    title: payload => `Broker follow-up ${payload.triggerType === "auto" ? "automatically triggered" : "triggered"}`,
    description: payload => timelineText(payload.subject, "Broker follow-up sequence started"),
  },
};

export function formatInvoiceTimelineEvent(eventType: string, payload: Record<string, unknown>) {
  const brokerDeliveryStatus = eventType.startsWith("broker_followup_delivery_")
    ? eventType.slice("broker_followup_delivery_".length).replace(/_/g, " ")
    : null;
  if (brokerDeliveryStatus) {
    return {
      category: "collection" as const,
      title: `Broker follow-up ${brokerDeliveryStatus}`,
      description: payload.email
        ? `Broker follow-up delivery update for ${payload.email}`
        : "Broker follow-up delivery status updated",
    };
  }
  const format = invoiceTimelineEventFormats[eventType];
  if (format) {
    return {
      category: format.category,
      title: format.title(payload),
      description: format.description(payload),
    };
  }
  return {
    category: "system" as const,
    title: eventType.replace(/[._]/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()),
    description: "Invoice event recorded",
  };
}

export async function getInvoiceTimeline(invoiceId: number, store: Pick<typeof db, "select"> = db): Promise<TimelineEvent[]> {
  const ledgerEvents = await store
    .select()
    .from(eventLedger)
    .where(and(eq(eventLedger.entityType, "invoice"), eq(eventLedger.entityId, invoiceId)))
    .orderBy(desc(eventLedger.createdAt), desc(eventLedger.id));

  const events = ledgerEvents.map((event): TimelineEvent => {
    const payload = (event.payloadJson as Record<string, unknown>) ?? {};
    const formatted = formatInvoiceTimelineEvent(event.eventType, payload);
    const noteAction = ({ invoice_note_added: "add", invoice_note_edited: "edit", invoice_note_deleted: "delete" } as Record<string, string>)[event.eventType];
    return {
      id: `ledger-${event.id}`,
      timestamp: event.createdAt,
      category: formatted.category,
      title: formatted.title,
      description: formatted.description,
      actorId: event.actorId,
      meta: noteAction
        ? { noteId: payload.noteId, noteAction, actorType: event.actorType }
        : { ...payload, actorType: event.actorType },
    };
  });
  const actorIds = Array.from(new Set(events.map(event => event.actorId).filter(id => id && id !== "system"))) as string[];
  if (!actorIds.length) return events;
  const actorRows = await store.select({
    id: users.id,
    name: sql<string>`concat_ws(' ', ${users.firstName}, ${users.lastName})`,
    email: users.email,
  }).from(users).where(inArray(users.id, actorIds));
  const actorMap = new Map(actorRows.map(actor => [actor.id, actor]));
  return events.map(event => {
    const actor = event.actorId ? actorMap.get(event.actorId) ?? null : null;
    return { ...event, actor, title: event.meta?.noteAction ? `${event.title} by ${actor?.name?.trim() || (event.actorId === "system" ? "System" : "Former staff member")}` : event.title };
  });
}
