import { db } from "../db";
import {
  invoices,
  invoiceStatusHistory,
  invoiceNotes,
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
  activities,
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
    documentType: doc.documentType, finalDocumentType: doc.finalDocumentType,
    status: doc.status, sourceChannel: doc.sourceChannel, uploadedBy: doc.uploadedBy,
    createdAt: doc.createdAt,
    uploader: doc.uploadedBy ? documentUploaderMap.get(doc.uploadedBy) ?? null : null,
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
  const invoiceNoteRows = await db.select().from(invoiceNotes)
    .where(eq(invoiceNotes.invoiceId, invoiceId)).orderBy(desc(invoiceNotes.createdAt));
  const noteAuthorIds = invoiceNoteRows.map(note => note.createdBy).filter(Boolean) as string[];
  const noteAuthors = noteAuthorIds.length
    ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(users).where(inArray(users.id, noteAuthorIds))
    : [];
  const noteAuthorMap = new Map(noteAuthors.map(user => [user.id, user]));
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
      notes: invoiceNoteRows.map(note => ({ ...note, createdByUser: noteAuthorMap.get(note.createdBy) ?? null })),
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
        actorId: payout.advancePaidBy ?? payout.createdBy,
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

  const notes = await db.select().from(invoiceNotes).where(eq(invoiceNotes.invoiceId, invoiceId));
  for (const note of notes) {
    events.push({
      id: `note-${note.id}`,
      timestamp: note.createdAt,
      category: "collection",
      title: "Invoice note added",
      description: note.body,
      actorId: note.createdBy,
      meta: { noteId: note.id },
    });
  }

  const followUps = await db.select().from(brokerFollowUps).where(eq(brokerFollowUps.invoiceId, invoiceId));
  const followUpIds = followUps.map(followUp => followUp.id);
  const reminderRows = followUpIds.length
    ? await db.select().from(brokerFollowUpReminders).where(inArray(brokerFollowUpReminders.followUpId, followUpIds))
    : [];
  const followUpById = new Map(followUps.map(followUp => [followUp.id, followUp]));
  for (const followUp of followUps) {
    events.push({
      id: `followup-${followUp.id}`,
      timestamp: followUp.sentAt ?? followUp.createdAt,
      category: "collection",
      title: `Broker follow-up ${followUp.status}`,
      description: followUp.subject,
      actorId: followUp.sentBy,
      meta: { followUpId: followUp.id, status: followUp.status, body: followUp.body },
    });
  }
  for (const reminder of reminderRows) {
    const parentFollowUp = followUpById.get(reminder.followUpId);
    events.push({
      id: `followup-reminder-${reminder.id}`,
      timestamp: reminder.actualSendAt ?? reminder.scheduledSendAt,
      category: "collection",
      title: `Broker reminder ${reminder.status}`,
      description: reminder.subject,
      actorId: reminder.editedBy ?? parentFollowUp?.sentBy ?? null,
      meta: {
        reminderId: reminder.id, followUpId: reminder.followUpId,
        scheduledSendAt: reminder.scheduledSendAt, actualSendAt: reminder.actualSendAt,
        body: reminder.body, status: reminder.status, deliveryStatus: reminder.deliveryStatus,
        editedBy: reminder.editedBy,
        actorType: reminder.editedBy || parentFollowUp?.sentBy ? "user" : "system",
      },
    });
  }

  const chargebackEvents = await db.select().from(invoiceChargebackEvents).where(eq(invoiceChargebackEvents.invoiceId, invoiceId));
  for (const event of chargebackEvents) {
    events.push({
      id: `chargeback-${event.id}`,
      timestamp: event.createdAt,
      category: "system",
      title: `Chargeback ${event.eventType.replace(/_/g, " ")}`,
      description: event.reason ?? event.eventType.replace(/_/g, " "),
      actorId: event.actorId,
      meta: { extensionDate: event.extensionDate, metadata: event.metadata },
    });
  }

  const refunds = await db.select().from(invoiceRefunds).where(eq(invoiceRefunds.invoiceId, invoiceId));
  for (const refund of refunds) {
    events.push({
      id: `refund-${refund.id}`,
      timestamp: refund.refundDate,
      category: "payment",
      title: `Refund recorded: $${refund.amount}`,
      description: `${refund.method}${refund.reference ? ` · ${refund.reference}` : ""}`,
      actorId: refund.createdBy,
      meta: { refundId: refund.id, amount: refund.amount, method: refund.method },
    });
  }

  const activityRows = await db.select().from(activities).where(and(eq(activities.entityType, "invoice"), eq(activities.entityId, invoiceId)));
  for (const activity of activityRows) {
    events.push({
      id: `activity-${activity.id}`,
      timestamp: activity.createdAt,
      category: "system",
      title: activity.type.replace(/_/g, " "),
      description: activity.description,
      actorId: activity.userId,
      meta: activity.metadata as Record<string, unknown> | undefined,
    });
  }

  // Sort newest first
  const sorted = events.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return tb - ta;
  });
  const actorIds = Array.from(new Set(sorted.map(event => event.actorId).filter(Boolean))) as string[];
  if (!actorIds.length) return sorted;
  const actorRows = await db.select({
    id: users.id,
    name: sql<string>`concat_ws(' ', ${users.firstName}, ${users.lastName})`,
    email: users.email,
  }).from(users).where(inArray(users.id, actorIds));
  const actorMap = new Map(actorRows.map(actor => [actor.id, actor]));
  return sorted.map(event => ({ ...event, actor: event.actorId ? actorMap.get(event.actorId) ?? null : null }));
}
