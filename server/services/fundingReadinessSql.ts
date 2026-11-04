import { sql } from "drizzle-orm";
import { documents, clientVault, invoices } from "@shared/schema";

// Same human/AI precedence and BOL aliases used by documentClassification /
// checklistType. Read-only eligibility evidence; never a funding transition.
const classification = sql`CASE WHEN ${documents.classificationSource}='agent'
  THEN coalesce(nullif(${documents.finalDocumentType},''),nullif(${documents.documentType},''),'other')
  ELSE coalesce(nullif(${documents.aiDocumentType},''),nullif(${documents.candidateDocumentType},''),
    nullif(${documents.finalDocumentType},''),nullif(${documents.documentType},''),'other') END`;
export const fundingReadinessSql = sql`(
  EXISTS (SELECT 1 FROM ${documents} WHERE ${documents.invoiceId}=${invoices.id} AND ${classification}='rate_confirmation')
  AND EXISTS (SELECT 1 FROM ${documents} WHERE ${documents.invoiceId}=${invoices.id}
    AND ${classification} IN ('bol','bill_of_lading','bol_pod','pod','proof_of_delivery'))
  AND EXISTS (SELECT 1 FROM ${clientVault} WHERE ${clientVault.id}=${invoices.bankAccountId} AND ${clientVault.isActive}=true)
)`;
