import {
  buildCarrierFinancialSummary, type CarrierFinancialAging,
  type CarrierFinancialInvoice, type CarrierFinancialPayment, type CarrierFinancialSummary,
} from "./carrier-financial";

export const BROKER_CREDIT_GRADES = ["F", "D", "C", "B", "A"] as const;
export interface BrokerCreditPoint {
  grade: string;
  score: number;
  calculatedAt: string | Date;
}
export interface BrokerFinancialSummary {
  totalInvoiced: number;
  openAr: number;
  averageDaysToPay: number | null;
  chargebackCount: number;
  creditGrade: string | null;
  months: CarrierFinancialSummary["months"];
  aging: CarrierFinancialSummary["aging"];
  creditHistory: { date: string; grade: string; gradeValue: number; score: number }[];
}

/** Same funded-date AR and cash-payment semantics as the carrier charts. */
export function buildBrokerFinancialSummary(
  invoices: CarrierFinancialInvoice[],
  payments: CarrierFinancialPayment[],
  receivables: CarrierFinancialAging[],
  history: BrokerCreditPoint[],
  creditGrade: string | null,
  now = new Date(),
): BrokerFinancialSummary {
  const base = buildCarrierFinancialSummary(invoices, payments, receivables, now);
  const issued = invoices.filter(row => {
    const date = row.invoiceDate || row.createdAt;
    return !["draft", "rejected"].includes(row.status) && (!date || new Date(date) <= now);
  });
  return {
    totalInvoiced: issued.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) / 100,
    openAr: base.openAr,
    averageDaysToPay: base.averageDaysToPay,
    chargebackCount: invoices.filter(row => row.chargebackStatus === "charged").length,
    creditGrade,
    months: base.months,
    aging: base.aging,
    creditHistory: history.filter(row => BROKER_CREDIT_GRADES.includes(row.grade as typeof BROKER_CREDIT_GRADES[number])
      && Number.isFinite(new Date(row.calculatedAt).getTime()) && new Date(row.calculatedAt) <= now)
      .sort((a, b) => new Date(a.calculatedAt).getTime() - new Date(b.calculatedAt).getTime())
      .map(row => ({
        date: new Date(row.calculatedAt).toISOString(), grade: row.grade,
        gradeValue: BROKER_CREDIT_GRADES.indexOf(row.grade as typeof BROKER_CREDIT_GRADES[number]) + 1,
        score: Number(row.score),
      })),
  };
}
