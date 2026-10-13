import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { clients, eventLedger, invoices, notifications } from "../../shared/schema";
import { getDocumentCompleteness } from "./docValidation";

/**
 * All upload/classification paths converge here. Serialize on the invoice so
 * concurrent completions cannot produce duplicate transitions or notifications.
 * The missing-doc list is derived from linked documents, never stored separately.
 */
export async function refreshInvoiceDocumentRequirements(invoiceId: number, database = db) {
  return database.transaction(async tx => {
    const [invoice] = await tx.select().from(invoices)
      .where(eq(invoices.id, invoiceId)).for("update");
    if (!invoice || invoice.status !== "docs_pending") {
      return { advanced: false, status: invoice?.status, missingDocs: [] as string[] };
    }

    const completeness = await getDocumentCompleteness(invoiceId, tx);
    const missingDocs = completeness.rules.filter(entry => entry.rule.required && !entry.uploaded)
      .map(entry => entry.rule.label);
    if (missingDocs.length) return { advanced: false, status: invoice.status, missingDocs };

    const [updated] = await tx.update(invoices)
      .set({ status: "under_review", factoringStage: "verification", updatedAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.status, "docs_pending")))
      .returning();
    if (!updated) return { advanced: false, status: invoice.status, missingDocs };

    const reason = "all required documents received";
    await tx.insert(eventLedger).values({
      entityType: "invoice", entityId: invoiceId, eventType: "invoice_status_changed",
      actorType: "system", actorId: "system",
      payloadJson: { from: "docs_pending", to: "under_review", reason,
        label: "All required documents received", fromStage: invoice.factoringStage, toStage: "verification" },
    });

    const [carrier] = invoice.assignedTo ? [] : await tx.select({ assignedProcessor: clients.assignedProcessor })
      .from(clients).where(eq(clients.id, invoice.clientId)).limit(1);
    const processorId = invoice.assignedTo ?? carrier?.assignedProcessor;
    if (processorId) await tx.insert(notifications).values({
      userId: processorId, type: "info",
      title: "Invoice ready for review",
      message: `Invoice ${invoice.invoiceNumber}: ${reason}.`,
      entityType: "invoice", entityId: invoiceId, actionUrl: `/invoices/${invoiceId}`,
    });
    return { advanced: true, status: updated.status, missingDocs };
  });
}
