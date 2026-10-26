export interface DumpStatementInvoice {
  invoiceId: number;
  invoiceNumber: string;
  loadNumber: string | null;
  carrier: string;
  amount: string;
  balance: string;
  fundedAt: string;
}
export interface DumpStatementTrigger {
  invoiceId: number;
  fundedAt: string;
  dueAt: string;
}
/** Coalesce missed intervals into the latest funded-date milestone, not a burst
 * of historical emails. A consolidated statement can satisfy several triggers. */
export function dumpStatementDueAt(fundedAt: Date, intervalDays: number, now: Date, lastSentAt?: Date | null): Date | null {
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) throw new Error("Invalid statement interval.");
  const period = intervalDays * 86_400_000;
  const elapsed = Math.floor((now.getTime() - fundedAt.getTime()) / period);
  if (elapsed < 1) return null;
  const due = new Date(fundedAt.getTime() + elapsed * period);
  return !lastSentAt || due > lastSentAt ? due : null;
}
export const isDumpLoad = (type: string | null) => type === "dump_truck_ticket" || type === "dump";
