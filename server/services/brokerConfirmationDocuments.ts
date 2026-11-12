import { and, asc, eq, inArray } from "drizzle-orm";
import { documents } from "../../shared/schema";
import type { ConfirmationStore } from "./brokerConfirmationService";
import { BROKER_PAPERWORK_TYPES, brokerPaperworkLinks } from "./brokerConfirmationPresentation";

export async function brokerInvoicePaperwork(store: ConfirmationStore, invoiceId: number, token: string) {
  const rows = await store.select({
    id: documents.id, originalName: documents.originalName, documentType: documents.documentType,
  }).from(documents).where(and(eq(documents.invoiceId, invoiceId),
    inArray(documents.documentType, [...BROKER_PAPERWORK_TYPES]))).orderBy(asc(documents.id));
  return brokerPaperworkLinks(token, rows);
}
