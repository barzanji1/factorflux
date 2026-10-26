import type { InvoicePreflightAlert } from "./invoicePreflight";
const closed = new Set(["paid", "settled"]);
export function invoiceWork(
  invoice: { status: string; fundedAt: Date | null; createdAt: Date | null; brokerConfirmationStatus: string; outstanding?: number },
  failedOcr: boolean, unacknowledged: string[], now: Date, manager: boolean,
) {
  const date = invoice.fundedAt ?? invoice.createdAt;
  const ageDays = date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000)) : null;
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
  if (receivable && openBalance && invoice.brokerConfirmationStatus === "disputed")
    actions.push(manager ? "Review broker receipt dispute" : "Escalate broker receipt dispute");
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
    return !(original?.message === alert.message && (savedAcks.has(alert.code) || acknowledgements.has(alert.code)));
  }).map(a => a.code);
}
export function fmcsaAuthorityHealth(run?: {
  status: string; activeCount: number | null; failureCount: number | null; completedAt: Date | null; startedAt: Date;
}) {
  return {
    state: !run ? "not_run" as const : run.status === "failed" ? "failed" as const
      : (run.failureCount ?? 0) > 0 ? "warning" as const : "healthy" as const,
    active: run?.activeCount ?? null, failed: run?.failureCount ?? 0,
    lastChecked: run ? new Date(run.completedAt ?? run.startedAt).toISOString() : null, href: "/fmcsa-authority" as const,
  };
}
