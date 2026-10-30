import { AGING_COLUMNS, agingBucket } from "./aging-report";
import { displayLoadType, LOAD_TYPES, LOAD_TYPE_LABELS } from "./load-types";

export interface CarrierFinancialInvoice {
  id: number;
  amount: string | number;
  status: string;
  invoiceDate: Date | string | null;
  createdAt: Date | string | null;
  fundedAt: Date | string | null;
  loadType: string | null;
  chargebackStatus: string;
}
export interface CarrierFinancialPayment {
  invoiceId: number;
  amount: string | number;
  paymentDate: Date | string;
}
export interface CarrierFinancialAging {
  outstanding: number;
  ageDays: number;
}
export interface CarrierFinancialSummary {
  totalFunded: number;
  openAr: number;
  averageDaysToPay: number | null;
  chargebackRate: number;
  months: { month: string; invoices: number; averageDaysToPay: number | null; paidInvoices: number }[];
  revenue: { type: string; label: string; amount: number }[];
  aging: { bucket: string; amount: number }[];
}

const dateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
});
function calendar(value: Date | string) {
  const parts = dateParts.formatToParts(new Date(value));
  const get = (name: string) => parts.find(part => part.type === name)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
const round = (n: number) => Math.round(n * 100) / 100;
const cents = (n: string | number) => Math.round(Number(n) * 100);

/** Read-only chart projection. Cash, not write-offs, determines full-payment DSO. */
export function buildCarrierFinancialSummary(
  invoices: CarrierFinancialInvoice[],
  payments: CarrierFinancialPayment[],
  receivables: CarrierFinancialAging[],
  now = new Date(),
): CarrierFinancialSummary {
  const today = calendar(now);
  const [year, month] = today.split("-").map(Number);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 6 + index, 1));
    return { month: date.toISOString().slice(0, 7), invoices: 0, averageDaysToPay: null as number | null, paidInvoices: 0 };
  });
  const monthly = new Map(months.map(row => [row.month, row]));
  const funded = invoices.filter(invoice => invoice.fundedAt && new Date(invoice.fundedAt) <= now);
  const revenue = LOAD_TYPES.map(type => ({ type, label: LOAD_TYPE_LABELS[type], amount: 0 }));
  for (const invoice of funded) {
    revenue.find(row => row.type === displayLoadType(invoice.loadType))!.amount += cents(invoice.amount);
  }
  for (const invoice of invoices) {
    const basis = invoice.invoiceDate || invoice.createdAt;
    if (!basis || ["draft", "rejected"].includes(invoice.status) || new Date(basis) > now) continue;
    const row = monthly.get(calendar(basis).slice(0, 7));
    if (row) row.invoices++;
  }
  const paymentsByInvoice = new Map<number, CarrierFinancialPayment[]>();
  for (const payment of payments) {
    if (new Date(payment.paymentDate) > now) continue;
    const rows = paymentsByInvoice.get(payment.invoiceId) ?? [];
    rows.push(payment);
    paymentsByInvoice.set(payment.invoiceId, rows);
  }
  let daysTotal = 0;
  let paidCount = 0;
  const monthlyDays = new Map<string, number>();
  for (const invoice of funded) {
    let cash = 0;
    const events = (paymentsByInvoice.get(invoice.id) ?? []).sort((a, b) =>
      new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime());
    for (const event of events) {
      cash += cents(event.amount);
      if (cash < cents(invoice.amount) || cents(invoice.amount) <= 0) continue;
      const paidDay = calendar(event.paymentDate);
      const days = Math.max(0, Math.round((Date.parse(paidDay) - Date.parse(calendar(invoice.fundedAt!))) / 86400000));
      daysTotal += days;
      paidCount++;
      const row = monthly.get(paidDay.slice(0, 7));
      if (row) {
        row.paidInvoices++;
        monthlyDays.set(row.month, (monthlyDays.get(row.month) ?? 0) + days);
      }
      break;
    }
  }
  for (const row of months) {
    row.averageDaysToPay = row.paidInvoices ? round((monthlyDays.get(row.month) ?? 0) / row.paidInvoices) : null;
  }
  const aging = AGING_COLUMNS.map(({ key, label }) => ({ key, bucket: label, amount: 0 }));
  for (const row of receivables) {
    const bucket = agingBucket(row.ageDays);
    const target = aging.find(value => value.key === bucket);
    if (target) target.amount += cents(row.outstanding);
  }
  return {
    totalFunded: round(funded.reduce((sum, invoice) => sum + cents(invoice.amount), 0) / 100),
    openAr: round(receivables.reduce((sum, row) => sum + cents(row.outstanding), 0) / 100),
    averageDaysToPay: paidCount ? round(daysTotal / paidCount) : null,
    chargebackRate: funded.length ? round(funded.filter(row => row.chargebackStatus === "charged").length / funded.length * 100) : 0,
    months,
    revenue: revenue.map(row => ({ ...row, amount: row.amount / 100 })),
    aging: aging.map(row => ({ ...row, amount: row.amount / 100 })),
  };
}
