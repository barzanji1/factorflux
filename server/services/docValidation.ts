/**
 * Document Validation Service
 * ────────────────────────────────────────────────────────────────────────────
 * Checks which required documents are present for an invoice at each
 * lifecycle stage. Also seeds the default freight-factoring document rules
 * on first run. Guards exported here are used by the lifecycle engine.
 */

import { db } from "../db";
import {
  documentRules,
  invoiceDocReviews,
  documents,
} from "../../shared/schema";
import { eq, asc, desc } from "drizzle-orm";
import type {
  DocumentRule,
  InvoiceDocReview,
} from "../../shared/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocRuleStatus {
  rule: DocumentRule;
  uploaded: boolean;
  document?: {
    id: number;
    originalName: string;
    status: string;
    createdAt: Date | null;
  };
}

export interface DocCompleteness {
  rules: DocRuleStatus[];
  completenessPercent: number;
  missingForReview: string[];
  missingForApproval: string[];
  canStartReview: boolean;
  canApprove: boolean;
  reviews: InvoiceDocReview[];
}

function checklistType(type: string): string {
  if (type === "bill_of_lading") return "bol";
  if (type === "invoice") return "commercial_invoice";
  if (type === "proof_of_delivery") return "pod";
  return type;
}

// ─── Core function ────────────────────────────────────────────────────────────

export async function getDocumentCompleteness(invoiceId: number): Promise<DocCompleteness> {
  const [rules, docs, reviews] = await Promise.all([
    db.select().from(documentRules)
      .where(eq(documentRules.active, true))
      .orderBy(asc(documentRules.sortOrder)),
    db.select({
      id: documents.id,
      documentType: documents.documentType,
      originalName: documents.originalName,
      status: documents.status,
      createdAt: documents.createdAt,
    }).from(documents).where(eq(documents.invoiceId, invoiceId)),
    db.select().from(invoiceDocReviews)
      .where(eq(invoiceDocReviews.invoiceId, invoiceId))
      .orderBy(desc(invoiceDocReviews.createdAt)),
  ]);

  const docsByType = new Map<string, (typeof docs)[number]>(
    docs.map(d => [checklistType(d.documentType as string), d]),
  );

  const ruleStatuses: DocRuleStatus[] = rules.map(rule => ({
    rule,
    uploaded: docsByType.has(checklistType(rule.documentType)),
    document: docsByType.get(checklistType(rule.documentType)),
  }));

  const required = ruleStatuses.filter(r => r.rule.required);
  const uploaded = required.filter(r => r.uploaded);
  const completenessPercent =
    required.length === 0 ? 100 : Math.round((uploaded.length / required.length) * 100);

  const missingForReview = ruleStatuses
    .filter(r => r.rule.required && r.rule.requiredForStage === "start_review" && !r.uploaded)
    .map(r => r.rule.label);

  const missingForApproval = ruleStatuses
    .filter(r => r.rule.required && r.rule.requiredForStage === "approve" && !r.uploaded)
    .map(r => r.rule.label);

  return {
    rules: ruleStatuses,
    completenessPercent,
    missingForReview,
    missingForApproval,
    canStartReview: missingForReview.length === 0,
    canApprove: missingForReview.length === 0 && missingForApproval.length === 0,
    reviews,
  };
}

// ─── Guards (called by lifecycle engine) ─────────────────────────────────────

type Ctx = { invoiceId: number };

export async function guardDocsForReview(ctx: Ctx): Promise<{ code: string; message: string; severity: "error" | "warning" } | null> {
  const rules = await db.select().from(documentRules)
    .where(eq(documentRules.active, true));
  const reviewRules = rules.filter(r => r.required && r.requiredForStage === "start_review");
  if (!reviewRules.length) return null;

  const docs = await db.select({ documentType: documents.documentType }).from(documents)
    .where(eq(documents.invoiceId, ctx.invoiceId));
  const types = new Set<string>(docs.map(d => checklistType(d.documentType as string)));
  const missing = reviewRules.filter(r => !types.has(checklistType(r.documentType))).map(r => r.label);

  return missing.length === 0 ? null : {
    code: "missing_review_docs",
    message: `Missing documents required to begin review: ${missing.join(", ")}`,
    severity: "error",
  };
}

export async function guardDocsForApproval(ctx: Ctx): Promise<{ code: string; message: string; severity: "error" | "warning" } | null> {
  const rules = await db.select().from(documentRules)
    .where(eq(documentRules.active, true));
  const approveRules = rules.filter(r => r.required && r.requiredForStage === "approve");
  if (!approveRules.length) return null;

  const docs = await db.select({ documentType: documents.documentType }).from(documents)
    .where(eq(documents.invoiceId, ctx.invoiceId));
  const types = new Set<string>(docs.map(d => checklistType(d.documentType as string)));
  const missing = approveRules.filter(r => !types.has(checklistType(r.documentType))).map(r => r.label);

  return missing.length === 0 ? null : {
    code: "missing_approval_docs",
    message: `Missing documents required for approval: ${missing.join(", ")}`,
    severity: "error",
  };
}

// ─── Seed default freight-factoring document rules ────────────────────────────

export async function seedDocumentRules(): Promise<void> {
  const [existing] = await db.select({ id: documentRules.id }).from(documentRules).limit(1);
  if (existing) {
    // Commercial invoices and PODs remain visible checklist items, but they
    // must not block review, approval, or required-document completeness.
    await db.update(documentRules)
      .set({ required: false })
      .where(eq(documentRules.documentType, "invoice"));
    await db.update(documentRules)
      .set({ required: false })
      .where(eq(documentRules.documentType, "proof_of_delivery"));
    return;
  }

  await db.insert(documentRules).values([
    {
      documentType: "rate_confirmation",
      label: "Rate Confirmation",
      description: "Signed rate confirmation from broker/shipper confirming load details and agreed rate",
      required: true,
      requiredForStage: "start_review",
      sortOrder: 1,
      active: true,
    },
    {
      documentType: "bill_of_lading",
      label: "Bill of Lading (BOL)",
      description: "Signed BOL confirming pickup and delivery of the freight shipment",
      required: true,
      requiredForStage: "start_review",
      sortOrder: 2,
      active: true,
    },
    {
      documentType: "invoice",
      label: "Commercial Invoice",
      description: "Carrier invoice issued to the broker or debtor for the completed load",
      required: false,
      requiredForStage: "approve",
      sortOrder: 3,
      active: true,
    },
    {
      documentType: "proof_of_delivery",
      label: "Proof of Delivery (POD)",
      description: "Signed delivery receipt confirming successful delivery to the consignee",
      required: false,
      requiredForStage: "approve",
      sortOrder: 4,
      active: true,
    },
  ]);

  console.log("[docValidation] Default document rules seeded");
}
