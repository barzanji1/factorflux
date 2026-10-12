import crypto from "crypto";
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  clients,
  eventLedger,
  fundingReceipts,
  invoices,
  s3CleanupQueue,
  type FundingReceipt,
} from "../../shared/schema";
import { uploadToS3, deleteFromS3Strict, downloadFromS3, getSignedDownloadUrl } from "./s3Service";
import { sendEmailTracked } from "../emailService";

export type FundingReceiptTx = {
  execute: (...args: any[]) => any;
  select: (...args: any[]) => any;
  insert: (...args: any[]) => any;
};

export interface FundingReceiptSnapshot {
  invoiceId: number;
  receiptNo?: string;
  version?: number;
  invoiceNumber: string;
  carrierId: number;
  carrierName?: string | null;
  carrierEmail?: string | null;
  brokerId?: number | null;
  invoiceAmount: string | number;
  advancePct: string | number;
  feeAmount: string | number;
  reserveAmount: string | number;
  netFunded: string | number;
  paymentMethod: "ach" | "wire" | "check";
  paymentReference?: string | null;
  fundedAt: Date;
  fundedByUserId: string;
  issuedByUserId?: string;
  createdAt?: Date;
}

export interface IssuedFundingReceipt {
  receipt: FundingReceipt;
  pdf: Buffer;
}

const money = (value: string | number) => Number(value).toFixed(2);
const logoCandidates = [
  path.resolve(process.cwd(), "client/public/images/ff-logo-emboss.png"),
  path.resolve(process.cwd(), "dist/public/images/ff-logo-emboss.png"),
  path.resolve(process.cwd(), "server/assets/tpf-logo.png"),
  path.resolve(process.cwd(), "dist/tpf-logo.png"),
];

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

async function auditHash(tx: FundingReceiptTx, invoiceId: number): Promise<string> {
  const rows = await tx.select().from(eventLedger)
    .where(and(eq(eventLedger.entityType, "invoice"), eq(eventLedger.entityId, invoiceId)))
    .orderBy(eventLedger.id);
  const canonicalRows = rows.map((row: any) => canonicalize(row));
  return crypto.createHash("sha256")
    .update(JSON.stringify(canonicalRows))
    .digest("hex");
}

async function nextNumber(tx: FundingReceiptTx, sequence: string): Promise<number> {
  const result = await tx.execute(sql.raw(`SELECT nextval('${sequence}') AS value`));
  const value = result?.rows?.[0]?.value ?? result?.[0]?.value;
  if (value === undefined) throw new Error(`Unable to allocate ${sequence}`);
  return Number(value);
}

async function allocateReceiptIdentity(
  tx: FundingReceiptTx,
  snapshot: FundingReceiptSnapshot,
): Promise<{ id: number; receiptNo: string; version: number; createdAt: Date }> {
  const id = await nextNumber(tx, "funding_receipts_id_seq");
  const createdAt = snapshot.createdAt ?? new Date();
  if (snapshot.receiptNo) {
    const latest = snapshot.version === undefined
      ? await tx.select({ version: fundingReceipts.version })
        .from(fundingReceipts)
        .where(eq(fundingReceipts.receiptNo, snapshot.receiptNo))
        .orderBy(desc(fundingReceipts.version))
        .limit(1)
      : [];
    return {
      id,
      receiptNo: snapshot.receiptNo,
      version: snapshot.version ?? ((latest[0]?.version ?? 0) + 1),
      createdAt,
    };
  }
  const sequence = await nextNumber(tx, "funding_receipt_no_seq");
  return {
    id,
    receiptNo: `FR-${createdAt.getUTCFullYear()}-${String(sequence).padStart(6, "0")}`,
    version: 1,
    createdAt,
  };
}

export function buildFundingReceiptPdf(
  receipt: Pick<FundingReceipt, "id" | "receiptNo" | "version" | "invoiceId" | "carrierId" | "brokerId" |
    "invoiceAmount" | "advancePct" | "feeAmount" | "reserveAmount" | "netFunded" | "paymentMethod" |
    "paymentReference" | "fundedAt" | "fundedByUserId" | "s3Key" | "auditHash" | "createdAt">,
  invoiceNumber: string,
  carrierName?: string | null,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 48, info: {
      Title: `Funding Receipt ${receipt.receiptNo} v${receipt.version}`,
      Author: "FactorFlux",
    } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const logoPath = logoCandidates.find(candidate => fs.existsSync(candidate));
    if (logoPath) doc.image(logoPath, 48, 38, { fit: [135, 58] });
    doc.font("Helvetica-Bold").fontSize(22).text("Funding Receipt", 48, 115);
    doc.font("Helvetica").fontSize(10).fillColor("#555")
      .text(`Receipt ${receipt.receiptNo} · Version ${receipt.version}`, 48, 145);
    doc.moveTo(48, 165).lineTo(564, 165).strokeColor("#cbd5e1").stroke();
    doc.fillColor("#111").font("Helvetica-Bold").fontSize(10);
    const rows: Array<[string, string]> = [
      ["Receipt ID", String(receipt.id)],
      ["Invoice", `${invoiceNumber} (#${receipt.invoiceId})`],
      ["Carrier", `${carrierName || `Carrier #${receipt.carrierId}`} (#${receipt.carrierId})`],
      ["Broker", receipt.brokerId == null ? "—" : `Broker #${receipt.brokerId}`],
      ["Invoice amount", `$${money(receipt.invoiceAmount)}`],
      ["Advance percentage", `${money(receipt.advancePct)}%`],
      ["Fee amount", `$${money(receipt.feeAmount)}`],
      ["Reserve amount", `$${money(receipt.reserveAmount)}`],
      ["Net funded", `$${money(receipt.netFunded)}`],
      ["Payment method", receipt.paymentMethod.toUpperCase()],
      ["Payment reference", receipt.paymentReference || "pending"],
      ["Funded at", receipt.fundedAt.toISOString()],
      ["Funded by user", receipt.fundedByUserId],
      ["S3 key", receipt.s3Key],
      ["Audit hash", receipt.auditHash],
      ["Created at", receipt.createdAt.toISOString()],
    ];
    let y = 195;
    for (const [label, value] of rows) {
      doc.text(label, 60, y, { width: 145 });
      doc.font("Helvetica").text(value, 215, y, { width: 330 });
      doc.font("Helvetica-Bold");
      y += 24;
    }
    doc.font("Helvetica").fontSize(8).fillColor("#64748b")
      .text("This receipt is an immutable funding record. A later payment reference creates a new receipt version.", 48, 730, { width: 516 });
    doc.end();
  });
}

export async function issueFundingReceiptVersion(
  tx: FundingReceiptTx,
  snapshot: FundingReceiptSnapshot,
): Promise<IssuedFundingReceipt> {
  await tx.execute(sql`select pg_advisory_xact_lock(706017, ${snapshot.invoiceId})`);
  const identity = await allocateReceiptIdentity(tx, snapshot);
  const hash = await auditHash(tx, snapshot.invoiceId);
  const receiptData = {
    id: identity.id,
    receiptNo: identity.receiptNo,
    invoiceId: snapshot.invoiceId,
    version: identity.version,
    carrierId: snapshot.carrierId,
    brokerId: snapshot.brokerId ?? null,
    invoiceAmount: money(snapshot.invoiceAmount),
    advancePct: money(snapshot.advancePct),
    feeAmount: money(snapshot.feeAmount),
    reserveAmount: money(snapshot.reserveAmount),
    netFunded: money(snapshot.netFunded),
    paymentMethod: snapshot.paymentMethod,
    paymentReference: snapshot.paymentReference ?? null,
    fundedAt: snapshot.fundedAt,
    fundedByUserId: snapshot.fundedByUserId,
    s3Key: `receipts/${snapshot.invoiceId}/${identity.receiptNo}-v${identity.version}.pdf`,
    auditHash: hash,
    createdAt: identity.createdAt,
  } satisfies typeof fundingReceipts.$inferInsert;
  const pdf = await buildFundingReceiptPdf(receiptData as FundingReceipt, snapshot.invoiceNumber, snapshot.carrierName);
  await uploadToS3(pdf, receiptData.s3Key, "application/pdf");
  try {
    const [receipt] = await tx.insert(fundingReceipts).values(receiptData).returning();
    await tx.insert(eventLedger).values({
      entityType: "invoice",
      entityId: snapshot.invoiceId,
      eventType: "receipt_issued",
      actorType: "user",
      actorId: snapshot.issuedByUserId ?? snapshot.fundedByUserId,
      payloadJson: {
        receiptId: receipt.id,
        receiptNo: receipt.receiptNo,
        version: receipt.version,
        s3Key: receipt.s3Key,
        auditHash: receipt.auditHash,
      },
    });
    return { receipt, pdf };
  } catch (error) {
    await cleanupFundingReceiptObject(receiptData.s3Key, "receipt_insert_failed");
    throw error;
  }
}

export const issueInitialFundingReceipt = issueFundingReceiptVersion;

export async function listFundingReceipts(invoiceId: number, tx: FundingReceiptTx = db): Promise<FundingReceipt[]> {
  return tx.select().from(fundingReceipts)
    .where(eq(fundingReceipts.invoiceId, invoiceId))
    .orderBy(desc(fundingReceipts.version));
}

export async function getFundingReceipt(receiptNo: string, version?: number, tx: FundingReceiptTx = db): Promise<FundingReceipt | null> {
  const rows = await tx.select().from(fundingReceipts).where(
    version === undefined
      ? eq(fundingReceipts.receiptNo, receiptNo)
      : and(eq(fundingReceipts.receiptNo, receiptNo), eq(fundingReceipts.version, version)),
  ).orderBy(desc(fundingReceipts.version)).limit(1);
  return rows[0] ?? null;
}

export async function getFundingReceiptDownloadUrl(receipt: FundingReceipt): Promise<string> {
  return getSignedDownloadUrl(receipt.s3Key, `${receipt.receiptNo}-v${receipt.version}.pdf`, 15 * 60);
}

/** Call when the owning transaction rolls back after the object was uploaded. */
export async function compensateFundingReceiptUpload(receipt: Pick<FundingReceipt, "s3Key">): Promise<void> {
  await cleanupFundingReceiptObject(receipt.s3Key, "receipt_transaction_rolled_back");
}

async function cleanupFundingReceiptObject(s3Key: string, reason: string): Promise<void> {
  try {
    await deleteFromS3Strict(s3Key);
  } catch (error) {
    await db.insert(s3CleanupQueue).values({
      s3Key,
      reason,
      lastError: error instanceof Error ? error.message : String(error),
    }).onConflictDoUpdate({
      target: s3CleanupQueue.s3Key,
      set: {
        reason,
        lastError: error instanceof Error ? error.message : String(error),
        resolvedAt: null,
        updatedAt: new Date(),
      },
    });
  }
}

export async function sendFundingReceiptEmail(
  receipt: FundingReceipt,
  invoiceNumber: string,
  carrierEmail: string | null | undefined,
  pdf?: Buffer,
): Promise<{ success: boolean; messageId?: string }> {
  if (!carrierEmail) return { success: false };
  const attachment = pdf ?? await downloadFromS3(receipt.s3Key);
  return sendEmailTracked({
    to: carrierEmail,
    emailLog: { entityType: "invoice", entityId: receipt.invoiceId, templateName: "funding_receipt" },
    subject: `Funding receipt for invoice ${invoiceNumber}`,
    text: `Attached is funding receipt ${receipt.receiptNo}, version ${receipt.version}, for invoice ${invoiceNumber}.`,
    attachments: [{
      content: attachment.toString("base64"),
      filename: `${receipt.receiptNo}-v${receipt.version}.pdf`,
      type: "application/pdf",
      disposition: "attachment",
      s3Key: receipt.s3Key,
    }],
  });
}