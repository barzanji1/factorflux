import { and, desc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  invoices, clients, brokers, users, tasks, followUps, brokerFollowUps, brokerFollowUpReminders,
  documents, docExtractionJobs, eventLedger, notifications, emailLog,
  complianceIntegrationRuns, paymentApplicationLines, carrierPortalUsers,
} from "../../shared/schema";
import { runInvoicePreflight, type InvoicePreflightAlert } from "./invoicePreflight";

export type DashboardViewer = { id: string; role: "employee" | "manager" | "admin" };
type Store = typeof db;
const closed = new Set(["paid", "settled"]);
const day = 86_400_000;
const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
const name = (first: string | null, last: string | null) => [first, last].filter(Boolean).join(" ") || "Staff member";
const owner = sql<string | null>`coalesce(${invoices.assignedTo}, ${clients.assignedProcessor}, ${invoices.submittedBy})`;

export function invoiceWork(
  invoice: { status: string; fundedAt: Date | null; createdAt: Date | null; brokerConfirmationStatus: string; outstanding?: number },
  failedOcr: boolean, unacknowledged: string[], now: Date, manager: boolean,
) {
  const date = invoice.fundedAt ?? invoice.createdAt;
  const ageDays = date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / day)) : null;
  const ageBasis = invoice.fundedAt ? "funded" : "created";
  const actions: string[] = [];
  if (closed.has(invoice.status)) return { ageDays, ageBasis, actions };
  if (invoice.status === "docs_pending") actions.push("Complete missing documents");
  if (["submitted", "under_review"].includes(invoice.status)) actions.push(manager ? "Review invoice" : "Await manager review");
  if (invoice.status === "rejected") actions.push("Correct rejected invoice");
  if (invoice.status === "held") actions.push(manager ? "Review hold" : "Resolve hold requirements");
  if (invoice.status === "draft") actions.push("Complete and submit invoice");
  if (invoice.status === "approved") actions.push(manager ? "Fund approved invoice" : "Await manager funding");
  const openBalance = invoice.outstanding === undefined || invoice.outstanding > 0;
  const receivable = invoice.status === "funded" || (invoice.status === "held" && !!invoice.fundedAt);
  if (receivable && openBalance && ["pending", "sent"].includes(invoice.brokerConfirmationStatus)) actions.push("Follow up on broker receipt confirmation");
  if (receivable && openBalance && invoice.brokerConfirmationStatus === "disputed") {
    actions.push(manager ? "Review broker receipt dispute" : "Escalate broker receipt dispute");
  }
  if (receivable && openBalance && invoice.fundedAt && ageDays !== null && ageDays >= 30) {
    const bucket = ageDays >= 90 ? 90 : ageDays >= 60 ? 60 : 30;
    actions.push(`${bucket}+ days unpaid — ${bucket === 90 ? "escalate collection" : "follow up on payment"}`);
  }
  if (failedOcr) actions.push("Retry failed document extraction");
  for (const code of unacknowledged) actions.push(`Review preflight alert: ${code}`);
  return { ageDays, ageBasis, actions };
}

export function unacknowledgedCodes(snapshot: unknown, current: InvoicePreflightAlert[], acknowledgements: Set<string>) {
  const saved = snapshot && typeof snapshot === "object" ? snapshot as Record<string, unknown> : {};
  const previous = Array.isArray(saved.alerts) ? saved.alerts as InvoicePreflightAlert[] : [];
  const savedAcks = Array.isArray(saved.acknowledgements)
    ? new Set(saved.acknowledgements.map(a => a && typeof a === "object" ? String((a as Record<string, unknown>).code) : "")) : new Set<string>();
  const merged = new Map(previous.map(alert => [alert.code, alert]));
  for (const alert of current) merged.set(alert.code, alert);
  return [...merged.values()].filter(alert => {
    if (alert.severity !== "ack") return false;
    const original = previous.find(a => a.code === alert.code);
    // Acknowledging an older, materially different alert does not clear today's.
    return !(original?.message === alert.message && (savedAcks.has(alert.code) || acknowledgements.has(alert.code)));
  }).map(a => a.code);
}

async function mapBounded<T, R>(items: T[], map: (item: T) => Promise<R>, concurrency = 4) {
  const result: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) { const index = next++; if (index >= items.length) break; result[index] = await map(items[index]); }
  }));
  return result;
}

const entityHref = (type: string, id: number) =>
  type === "invoice" ? `/invoices/${id}` : type === "client" ? `/clients/${id}` : type === "document" ? `/documents?documentId=${id}` : null;

export async function readAgentDashboard(viewer: DashboardViewer, store: Store = db, now = new Date()) {
  const manager = viewer.role === "manager" || viewer.role === "admin";
  // Explicit invoice assignment wins; legacy rows retain their existing
  // carrier-processor / submitter ownership rather than disappearing.
  const scoped = manager ? undefined : eq(owner, viewer.id);
  const [staff, invoiceRows, failedDocs, ledger, personalTasks, legacyFollowUps, brokerTasks, noticeRows] = await Promise.all([
    store.select({ id: users.id, first: users.firstName, last: users.lastName }).from(users)
      .where(manager ? and(eq(users.status, "active"), eq(users.isTestAccount, false)) : eq(users.id, viewer.id))
      .orderBy(users.firstName, users.lastName, users.id),
    store.select({ invoice: {
      id: invoices.id, invoiceNumber: invoices.invoiceNumber, status: invoices.status, clientId: invoices.clientId,
      brokerId: invoices.brokerId, loadNumber: invoices.loadNumber, amount: invoices.amount,
      createdAt: invoices.createdAt, fundedAt: invoices.fundedAt, brokerConfirmationStatus: invoices.brokerConfirmationStatus,
    }, applied: sql<string>`coalesce((select sum(${paymentApplicationLines.appliedAmount} + case when ${paymentApplicationLines.varianceType} = 'write_off' then abs(coalesce(${paymentApplicationLines.variance},0)) else 0 end) from ${paymentApplicationLines} where ${paymentApplicationLines.invoiceId} = ${invoices.id}), 0)`,
      agentId: owner, carrierName: clients.name, brokerName: brokers.name }).from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id)).leftJoin(brokers, eq(invoices.brokerId, brokers.id))
      .where(and(notInArray(invoices.status, ["paid", "settled"]), scoped)).orderBy(invoices.createdAt, invoices.id),
    latestFailedDocuments(store),
    store.select({ id: eventLedger.id, type: eventLedger.eventType, entityType: eventLedger.entityType,
      entityId: eventLedger.entityId, when: eventLedger.createdAt, first: users.firstName, last: users.lastName,
      invoiceNumber: invoices.invoiceNumber }).from(eventLedger).leftJoin(users, eq(eventLedger.actorId, users.id))
      .leftJoin(invoices, and(eq(eventLedger.entityType, "invoice"), eq(eventLedger.entityId, invoices.id)))
      .where(and(eq(eventLedger.actorType, "user"), isNotNull(eventLedger.actorId), or(isNull(users.id), eq(users.isTestAccount, false))))
      .orderBy(desc(eventLedger.createdAt), desc(eventLedger.id)).limit(20),
    store.select({ id: tasks.id, title: tasks.title, status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate,
      carrierName: clients.name, invoiceId: tasks.confirmationInvoiceId }).from(tasks).leftJoin(clients, eq(tasks.clientId, clients.id))
      .where(and(eq(tasks.assignedTo, viewer.id), ne(tasks.status, "completed"),
        or(inArray(tasks.type, ["followup", "call"]), isNotNull(tasks.confirmationInvoiceId)))),
    store.select({ id: followUps.id, title: followUps.title, status: followUps.status, priority: followUps.priority,
      dueDate: followUps.dueDate, carrierName: clients.name }).from(followUps).innerJoin(clients, eq(followUps.clientId, clients.id))
      .where(and(eq(clients.assignedProcessor, viewer.id), ne(followUps.status, "completed"))),
    store.select({ id: brokerFollowUps.id, title: brokerFollowUps.subject, status: brokerFollowUps.status,
      invoiceId: brokerFollowUps.invoiceId, carrierName: clients.name,
      dueDate: sql<Date | null>`coalesce((select min(r.scheduled_send_at) from broker_follow_up_reminders r where r.follow_up_id = ${brokerFollowUps.id} and r.status in ('scheduled','sending')), ${brokerFollowUps.createdAt})` })
      .from(brokerFollowUps).innerJoin(invoices, eq(brokerFollowUps.invoiceId, invoices.id)).innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(ne(brokerFollowUps.status, "acknowledged"),
        eq(sql`coalesce(${invoices.assignedFollowupAgentId}, ${owner})`, viewer.id))),
    store.select({ invoiceId: notifications.entityId, metadata: notifications.metadata, when: notifications.createdAt })
      .from(notifications).where(and(eq(notifications.entityType, "invoice"), scoped
        ? inArray(notifications.entityId, store.select({ id: invoices.id }).from(invoices).innerJoin(clients, eq(invoices.clientId, clients.id)).where(scoped))
        : undefined)),
  ]);

  const ids = invoiceRows.map(row => row.invoice.id);
  const snapshots = ids.length ? await store.selectDistinctOn([eventLedger.entityId], {
    id: eventLedger.entityId, payload: eventLedger.payloadJson, when: eventLedger.createdAt,
  }).from(eventLedger).where(and(eq(eventLedger.entityType, "invoice"), eq(eventLedger.eventType, "invoice_preflight"), inArray(eventLedger.entityId, ids)))
    .orderBy(eventLedger.entityId, desc(eventLedger.createdAt), desc(eventLedger.id)) : [];
  const ackRows = ids.length ? (await store.execute<{ invoice_id: number; alert_code: string; acked_at: Date }>(
    sql`select invoice_id, alert_code, acked_at from invoice_alert_acks where invoice_id in (${sql.join(ids.map(id => sql`${id}`), sql`,`)})`)).rows : [];
  const snapshotMap = new Map(snapshots.map(s => [s.id, s]));
  const failedInvoiceIds = new Set(failedDocs.map(d => d.invoiceId).filter((id): id is number => id !== null));
  const groups = new Map<string | null, { agentId: string | null; agentName: string; items: QueueItem[] }>(
    staff.map(s => [s.id, { agentId: s.id, agentName: name(s.first, s.last), items: [] }]));
  const items = await mapBounded(invoiceRows, async row => {
    const saved = snapshotMap.get(row.invoice.id);
    const acked = new Set(ackRows.filter(a => a.invoice_id === row.invoice.id && saved?.when && new Date(a.acked_at) >= saved.when).map(a => a.alert_code));
    // Current checks are DB-only; no OCR, FMCSA lookups, emails or mutations are
    // initiated by viewing the dashboard. Already-funded rows use their saved
    // intake snapshot rather than re-running intake checks after funding.
    const current = !row.invoice.fundedAt ? (await runInvoicePreflight({
      carrierId: row.invoice.clientId, brokerId: row.invoice.brokerId, invoiceNumber: row.invoice.invoiceNumber,
      loadNumber: row.invoice.loadNumber, amount: row.invoice.amount,
      excludeInvoiceId: row.invoice.id,
    }, store)).alerts : [];
    for (const notice of noticeRows.filter(n => n.invoiceId === row.invoice.id)) {
      try {
        const meta = JSON.parse(notice.metadata ?? "{}") as Record<string, unknown>;
        const savedAlerts = saved?.payload && typeof saved.payload === "object"
          ? (saved.payload as { alerts?: InvoicePreflightAlert[] }).alerts : [];
        if (meta.severity === "ack" && typeof meta.code === "string" && meta.acknowledged !== true
          && !current.some(a => a.code === meta.code) && !savedAlerts?.some(a => a.code === meta.code)) {
          current.push({ code: meta.code, severity: "ack", title: "Preflight alert", message: String(meta.message ?? meta.code) });
        }
      } catch { /* Old non-JSON notification metadata is not a preflight acknowledgement. */ }
    }
    const work = invoiceWork({ ...row.invoice, outstanding: Math.max(0, Number(row.invoice.amount) - Number(row.applied)) }, failedInvoiceIds.has(row.invoice.id),
      unacknowledgedCodes(saved?.payload, current, acked), now, manager);
    // A blocking current check is actionable too, even if it is not ack-able.
    for (const alert of current.filter(a => a.severity === "block")) work.actions.push(`Preflight blocked: ${alert.title}`);
    return { agentId: row.agentId, item: { id: row.invoice.id, invoiceNumber: row.invoice.invoiceNumber,
      carrierName: row.carrierName, brokerName: row.brokerName ?? "No broker assigned", status: row.invoice.status,
      ...work, href: `/invoices/${row.invoice.id}` } };
  });
  for (const { agentId, item } of items) {
    if (!item.actions.length) continue;
    if (!groups.has(agentId)) groups.set(agentId, { agentId, agentName: agentId ? "Inactive / former staff" : "Unassigned", items: [] });
    groups.get(agentId)!.items.push(item);
  }
  for (const group of groups.values()) group.items.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1) || a.id - b.id);
  const followUpItems = [
    ...personalTasks.map(t => ({ id: `task:${t.id}`, source: "task", title: t.title, carrierName: t.carrierName, status: t.status,
      priority: t.priority, dueDate: iso(t.dueDate), href: t.invoiceId ? `/invoices/${t.invoiceId}` : `/tasks?taskId=${t.id}` })),
    ...legacyFollowUps.map(t => ({ id: `follow_up:${t.id}`, source: "follow_up", title: t.title, carrierName: t.carrierName,
      status: t.status, priority: t.priority, dueDate: iso(t.dueDate), href: `/follow-up?followupId=${t.id}` })),
    ...brokerTasks.map(t => ({ id: `broker_follow_up:${t.id}`, source: "broker_follow_up", title: t.title, carrierName: t.carrierName,
      status: t.status, priority: "medium", dueDate: iso(t.dueDate), href: `/invoices/${t.invoiceId}` })),
  ].sort((a, b) => (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity) || a.id.localeCompare(b.id));
  const alerts = await systemAlerts(store, failedDocs);
  return {
    generatedAt: now.toISOString(), viewer, queueGroups: [...groups.values()], followUps: followUpItems,
    activity: ledger.map(e => ({ id: e.id, who: name(e.first, e.last), action: `${e.type.replace(/[_.-]/g, " ")} · ${e.entityType} ${e.invoiceNumber ?? `#${e.entityId}`}`,
      when: iso(e.when), href: entityHref(e.entityType, e.entityId) })), ...alerts,
  };
}

type QueueItem = { id: number; invoiceNumber: string; carrierName: string; brokerName: string; status: string;
  ageDays: number | null; ageBasis: string; actions: string[]; href: string };
type FailedDocument = { id: number; invoiceId: number | null; name: string; error: string | null; when: Date | null };

export function fmcsaAuthorityHealth(run?: {
  status: string; activeCount: number | null; failureCount: number | null;
  completedAt: Date | null; startedAt: Date;
}) {
  return {
    state: !run ? "not_run" as const
      : run.status === "failed" ? "failed" as const
      : (run.failureCount ?? 0) > 0 ? "warning" as const : "healthy" as const,
    active: run?.activeCount ?? null,
    failed: run?.failureCount ?? 0,
    lastChecked: run ? iso(run.completedAt ?? run.startedAt) : null,
    href: "/fmcsa-authority" as const,
  };
}

async function latestFailedDocuments(store: Store): Promise<FailedDocument[]> {
  const latest = store.selectDistinctOn([docExtractionJobs.documentId], {
    documentId: docExtractionJobs.documentId, status: docExtractionJobs.status, error: docExtractionJobs.errorMessage, when: docExtractionJobs.createdAt,
  }).from(docExtractionJobs).orderBy(docExtractionJobs.documentId, desc(docExtractionJobs.id)).as("latest_ocr");
  return store.select({ id: documents.id, invoiceId: documents.invoiceId, name: documents.originalName,
    error: latest.error, when: sql<Date | null>`coalesce(${latest.when}, ${documents.createdAt})` }).from(documents)
    .leftJoin(latest, eq(latest.documentId, documents.id))
    .where(or(eq(latest.status, "failed"), and(isNull(latest.documentId), eq(documents.status, "failed"))));
}

async function systemAlerts(store: Store, failedDocs: FailedDocument[]) {
  const [runs, bounced, unverified, pendingPortal] = await Promise.all([
    store.select({
      id: complianceIntegrationRuns.id, activeCount: complianceIntegrationRuns.activeCount,
      status: complianceIntegrationRuns.status,
      failureCount: complianceIntegrationRuns.failureCount, startedAt: complianceIntegrationRuns.startedAt,
      completedAt: complianceIntegrationRuns.completedAt,
    }).from(complianceIntegrationRuns)
      .where(inArray(complianceIntegrationRuns.status, ["completed", "failed"]))
      .orderBy(desc(complianceIntegrationRuns.startedAt), desc(complianceIntegrationRuns.id)).limit(1),
    store.select({ id: emailLog.id, subject: emailLog.subject, to: emailLog.toAddresses, error: emailLog.error, when: emailLog.statusUpdatedAt })
      .from(emailLog).where(eq(emailLog.status, "bounced")).orderBy(desc(emailLog.statusUpdatedAt), desc(emailLog.id)),
    store.select({ id: clients.id, name: clients.name, when: clients.createdAt }).from(clients)
      .where(eq(clients.status, "new_client")).orderBy(desc(clients.createdAt), desc(clients.id)),
    store.select({ id: carrierPortalUsers.id, carrierId: carrierPortalUsers.carrierId, name: carrierPortalUsers.companyName,
      when: carrierPortalUsers.createdAt }).from(carrierPortalUsers).where(eq(carrierPortalUsers.status, "pending")),
  ]);
  const fmcsaAuthority = fmcsaAuthorityHealth(runs[0]);
  const all: DashboardAlert[] = [
    ...bounced.map(e => ({ id: `email:${e.id}`, kind: "email_bounced" as const, title: `Bounced email: ${e.subject}`,
      detail: `${e.to.join(", ")} — ${e.error ?? "Check the recipient address."}`, when: iso(e.when), href: `/email-log?emailId=${e.id}` })),
    ...failedDocs.map(d => ({ id: `document:${d.id}`, kind: "ocr_failed" as const, title: `Document extraction failed: ${d.name}`,
      detail: d.error ?? "Open Documents and retry extraction.", when: iso(d.when), href: `/documents?documentId=${d.id}` })),
    ...unverified.map(c => ({ id: `carrier:${c.id}`, kind: "unverified_carrier" as const, title: `Unverified carrier: ${c.name}`,
      detail: "New client awaiting onboarding verification.", when: iso(c.when), href: `/clients/${c.id}` })),
    ...pendingPortal.filter(p => !unverified.some(c => c.id === p.carrierId)).map(p => ({
      id: `carrier_portal:${p.id}`, kind: "unverified_carrier" as const, title: `Unverified carrier registration: ${p.name}`,
      detail: "Portal registration awaiting administrative approval.", when: iso(p.when),
      href: p.carrierId ? `/clients/${p.carrierId}` : "/admin",
    })),
  ];
  all.sort((a, b) => (b.when ? Date.parse(b.when) : 0) - (a.when ? Date.parse(a.when) : 0) || a.id.localeCompare(b.id));
  const alertCounts = { email_bounced: 0, ocr_failed: 0, unverified_carrier: 0 };
  const shown = { ...alertCounts };
  for (const alert of all) alertCounts[alert.kind]++;
  return { alerts: all.filter(a => shown[a.kind]++ < 100), alertCounts, systemHealth: { fmcsaAuthority } };
}
type DashboardAlert = { id: string; kind: "email_bounced" | "ocr_failed" | "unverified_carrier";
  title: string; detail: string; when: string | null; href: string };
