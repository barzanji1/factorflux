import { eq } from "drizzle-orm";
import { db } from "../db";
import { cashApplications, invoices, paymentApplicationLines } from "../../shared/schema";
import { buildCarrierFinancialSummary } from "../../shared/carrier-financial";
import { getConfirmationAgingRows } from "./brokerConfirmationService";

export async function readCarrierFinancial(carrierId: number, now = new Date()) {
  const [invoiceRows, payments, receivables] = await Promise.all([
    db.select({
      id: invoices.id, amount: invoices.amount, status: invoices.status,
      invoiceDate: invoices.invoiceDate, createdAt: invoices.createdAt,
      fundedAt: invoices.fundedAt, loadType: invoices.loadType, chargebackStatus: invoices.chargebackStatus,
    }).from(invoices).where(eq(invoices.clientId, carrierId)),
    db.select({
      invoiceId: paymentApplicationLines.invoiceId, amount: paymentApplicationLines.appliedAmount,
      paymentDate: cashApplications.paymentDate,
    }).from(paymentApplicationLines)
      .innerJoin(invoices, eq(paymentApplicationLines.invoiceId, invoices.id))
      .innerJoin(cashApplications, eq(paymentApplicationLines.cashApplicationId, cashApplications.id))
      .where(eq(invoices.clientId, carrierId)),
    getConfirmationAgingRows(eq(invoices.clientId, carrierId), db, now),
  ]);
  return buildCarrierFinancialSummary(invoiceRows, payments, receivables, now);
}
