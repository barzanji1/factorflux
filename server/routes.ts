import type { Express } from "express";
import { registerOcrIntakeRoutes } from "./routes/ocrIntake";
import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { encryptVault, decryptVault } from "./services/vaultCrypto";
import {
  uploadToS3,
  uploadDocumentToS3,
  getSignedViewUrl,
  getSignedDownloadUrl,
  deleteFromS3,
  deleteFromS3Strict,
  downloadToTemp,
} from "./services/s3Service";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { eq, and, asc, desc, sql, count, ilike, or, inArray, notInArray, gt, gte, lte, lt, isNull, ne } from "drizzle-orm";

import { storage } from "./storage";
import { registerBrokerConfirmationRoutes } from "./routes/brokerConfirmation";
import { registerEmailLogRoutes } from "./routes/emailLog";
import { registerAgentDashboardRoutes } from "./routes/agentDashboard";
import { brokerConfirmationService, getConfirmationAgingRows, getConfirmationInvoiceScope, fundedAgeDays } from "./services/brokerConfirmationService";
import { firestore } from "./firebase";
import {
  upsertClientMirror,
  addClientActivityLog,
} from "./services/firestore-records";
import { deleteClientMirror } from "./services/firestore-record";
import { db } from "./db";
import { LOAD_TYPES } from "@shared/load-types";
import {
  getFmcsaKeyStatus,
  saveConfiguredFmcsaWebKey,
} from "./services/fmcsa/settings";
import { queryByDot, queryByMc } from "./services/fmcsa";
import { createFmcsaHistoryHandler } from "./services/fmcsa/historyRoute";
import { ClientEmailError, clientEmailSchema, sendClientEmail } from "./services/clientEmail";
import { SYSTEM_EMAIL_FROM, SYSTEM_EMAIL_REPLY_TO } from "./emailConfig";
import {
  assertChatMembership, chatMessageSelection, ChatMessageError,
  createChatMessage, getChatThread, getMentionStaff,
} from "./services/chatMessaging";
import {
  ChatChannelNameConflict,
  createChatChannelSchema,
  createPublicChatChannel,
  ensureDefaultChatChannels,
} from "./services/chatChannels";

import {
  insertClientSchema,
  insertLoadSchema,
  insertInvoiceSchema,
  insertFuelAdvanceSchema,
  insertFollowUpSchema,
  insertCollectionSchema,
  insertClientVaultSchema,
  insertTaskSchema,
  insertBrokerSchema,
  insertBrokerBranchSchema,
  insertBrokerFollowUpSchema,
  insertBrokerFollowUpReminderSchema,
  insertLockboxEntrySchema,
  brokerFollowUpReminders,
  brokerFollowUpTemplates,
  insertBrokerFollowUpTemplateSchema,
  workflowConfigs,
  users,
  users as userTable,
  tasks,
  clients,
  clientVault,
  brokers,
  brokerCreditScores,
  brokerBranches,
  fuelAdvances,
  invoices,
  invoiceNotes,
  invoiceChargebackEvents,
  invoiceRefunds,
  payouts,
  fundingReceipts,
  docRequirements,
  activities,
  docExtractionJobs,
  docExtractionResults,
  docFieldCandidates,
  docReviews,
  documents as documentsTable,
  eventLedger,
  loads,
  brokerFollowUps,
  invoiceAgingAlerts,
  notifications,
  calendarEvents,
  insertCalendarEventSchema,
  debtors,
  paymentApplicationLines,
  cashApplications,
  exceptions,
  dispatchers,
  insertDispatcherSchema,
  drivers,
  trucks,
  insertTruckSchema,
  bankTransfers,
  insertBankTransferSchema,
  payrollEntries,
  payrollDeductions,
  insertPayrollEntrySchema,
  insertPayrollDeductionSchema,
  bulkInvoiceBatches,
  bulkInvoiceItems,
  insertBulkInvoiceBatchSchema,
  insertBulkInvoiceItemSchema,
  releaseLetters,
  insertReleaseLetterSchema,
  aiChatLogs,
  timeEntries,
  expenses,
  insertExpenseSchema,
  carrierPortalUsers,
  portalChats,
  portalChatMessages,
  carrierSubmissions,
  carrierSubmissionAlertAcks,
  carrierSubmissionPreflightEvents,
  carrierSubmissionDocs,
  writtenWarnings,
  chatChannels,
  clientEmailLogs,
  chatMembers,
  chatMessages,
  tickets,
  ticketComments,
  s3CleanupQueue,
  ALL_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
} from "@shared/schema";
import Anthropic from "@anthropic-ai/sdk";
import { triggerBrokerFollowUp, processScheduledReminders, suppressCadence, invalidateTemplateCache } from "./services/brokerFollowUpEngine";
import { jobQueue } from "./services/jobQueue";
import { classifyDocumentAI, reviewDocumentType } from "./services/aiClassifier";
import { recalculateAllBrokerCredit, recalculateBrokerCredit, recalculateBrokerCreditSafe } from "./services/brokerCreditEngine";
import {
  authenticateCurrentUser,
  requirePermission,
  requireAnyPermission,
  auditAuthorizationDenial,
  DENIED_MESSAGE,
} from "./middleware/requirePermission";

import { sendEmail } from "./emailService";
import {
  advanceInvoiceStage,
  getInvoiceDetail,
  getInvoiceTimeline,
} from "./services/invoiceStage";
import {
  getAvailableTransitions,
  performTransition,
  getInvoiceDisplayStatus,
} from "./services/lifecycleEngine";
import { getDocumentCompleteness, checklistType } from "./services/docValidation";
import { refreshInvoiceDocumentRequirements } from "./services/invoiceDocumentWorkflow";
import { documentClassification } from "../shared/document-display";
import {
  compensateFundingReceiptUpload,
  getFundingReceipt,
  getFundingReceiptDownloadUrl,
  issueFundingReceiptVersion,
  listFundingReceipts,
  sendFundingReceiptEmail,
  type IssuedFundingReceipt,
} from "./services/fundingReceiptService";
import { expandCalendarEvent } from "./services/calendarScheduler";
import { runInvoicePreflight } from "./services/invoicePreflight";
import { getIntakeSnapshot, parseIntakeIds } from "./services/ocrIntakeSnapshot";
import { IntakeError } from "./services/ocrIntakeMapping";
import { reusableIntakePaperwork } from "./services/ocrIntakePaperwork";
import { getInvoiceOcrAlerts } from "./services/invoiceOcrAlerts";
import { DOCUMENT_UPLOAD_LIMIT, documentSizeMetadata } from "./services/documentCompression";

const escapeHtml = (value: unknown): string => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: DOCUMENT_UPLOAD_LIMIT,
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|tiff|tif|heic|heif|docx?|xlsx?|msword|officedocument|ms-excel/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    }

    cb(new Error("Only PDF, image, Word, and Excel documents are allowed"));
  },
});
const carrierUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.ceil(134.22 * 1024 * 1024) },
  fileFilter: (_req, file, cb) => {
    const allowedExtensions = new Set([".pdf", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".heif"]);
    const allowedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/tiff", "image/heic", "image/heif"]);
    if (allowedExtensions.has(path.extname(file.originalname).toLowerCase()) && allowedMimeTypes.has(file.mimetype.toLowerCase())) {
      return cb(null, true);
    }
    cb(new Error("Only PDF, JPEG, PNG, and TIFF files are allowed"));
  },
});
const rateConUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOCUMENT_UPLOAD_LIMIT },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === ".pdf" && file.mimetype.toLowerCase() === "application/pdf") {
      return cb(null, true);
    }
    cb(new Error("Rate confirmation must be a PDF"));
  },
});

const hasAllowedCarrierDocumentSignature = (file: Express.Multer.File) => {
  const bytes = file.buffer;
  const isPdf = bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isTiff = bytes.length >= 4 && (
    bytes.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00]))
    || bytes.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
  );
  const isHeif = bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp"
    && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(bytes.subarray(8, 12).toString("ascii"));
  return isPdf || isJpeg || isPng || isTiff || isHeif;
};

function handleCarrierUpload(req: any, res: any, next: any) {
  carrierUpload.single("file")(req, res, (err: any) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "File too large. Maximum size is 135MB." });
    }
    return res.status(400).json({ message: err.message || "File upload rejected." });
  });
}

function handleUpload(field: string) {
  return (req: any, res: any, next: any) => {
    upload.single(field)(req, res, (err: any) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: "File too large. Maximum upload size is 135MB." });
      }
      return res.status(400).json({ message: err.message || "File upload rejected." });
    });
  };
}
function handleOcrIntakeUpload(req: any, res: any, next: any) {
  multer({ storage: multer.memoryStorage(), limits: { fileSize: DOCUMENT_UPLOAD_LIMIT, files: 8 } })
    .array("files", 8)(req, res, (error: any) => {
      if (!error) return next();
      res.status(400).json({ message: error.code === "LIMIT_FILE_SIZE" ?
        "Each intake PDF must be 135MB or smaller." : "Upload up to eight PDFs using the files field." });
    });
}

// Invoice intake uses one bounded memory-storage parser for all four paperwork
// slots. Keeping this separate from handleUpload avoids changing the limits or
// file types accepted by existing upload endpoints.
function handleInvoicePaperworkUpload(req: any, res: any, next: any) {
  const paperworkUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: DOCUMENT_UPLOAD_LIMIT, files: 4 },
    fileFilter: (_req, file, cb) => {
      const isPdf = file.mimetype.toLowerCase() === "application/pdf"
        && path.extname(file.originalname).toLowerCase() === ".pdf";
      if (isPdf) cb(null, true);
      else cb(new Error("Invoice paperwork must be a PDF"));
    },
  }).fields([
    { name: "rateConfirmation", maxCount: 1 },
    { name: "billOfLading", maxCount: 1 },
    { name: "lumperReceipt", maxCount: 1 },
    { name: "other", maxCount: 1 },
  ]);

  paperworkUpload(req, res, (err: any) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Each paperwork file must be 135MB or smaller." });
    }
    return res.status(400).json({ message: err.message || "Invoice paperwork upload rejected." });
  });
}

function sanitizeOriginalName(name: string) {
  return name
    .normalize("NFKC")
    .replace(/[^\w.\- ()]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

async function queueS3Cleanup(key: string, reason: string, error: unknown) {
  const lastError = error instanceof Error ? error.message : String(error);
  try {
    await db.insert(s3CleanupQueue).values({
      s3Key: key,
      reason,
      lastError,
    }).onConflictDoUpdate({
      target: s3CleanupQueue.s3Key,
      set: {
        reason,
        lastError,
        updatedAt: new Date(),
        resolvedAt: null,
      },
    });
  } catch (queueError) {
    // Cleanup failures must remain observable without leaking object contents
    // or credentials. The original key is intentionally not logged.
    console.error("[S3 cleanup] Could not enqueue cleanup retry:", queueError instanceof Error ? queueError.message : "unknown error");
  }
}

async function cleanupS3KeyWithRetry(key: string, reason: string) {
  try {
    await deleteFromS3Strict(key);
    return true;
  } catch (error) {
    await queueS3Cleanup(key, reason, error);
    return false;
  }
}

let s3CleanupProcessorStarted = false;
async function processS3CleanupQueue() {
  try {
    const pending = await db.select().from(s3CleanupQueue)
      .where(isNull(s3CleanupQueue.resolvedAt))
      .orderBy(s3CleanupQueue.createdAt)
      .limit(25);
    for (const item of pending) {
      try {
        await deleteFromS3Strict(item.s3Key);
        await db.update(s3CleanupQueue).set({
          resolvedAt: new Date(),
          updatedAt: new Date(),
          lastError: null,
        }).where(eq(s3CleanupQueue.id, item.id));
      } catch (error) {
        await db.update(s3CleanupQueue).set({
          attempts: sql`${s3CleanupQueue.attempts} + 1`,
          updatedAt: new Date(),
          lastError: error instanceof Error ? error.message : String(error),
        }).where(eq(s3CleanupQueue.id, item.id));
      }
    }
  } catch (error) {
    console.warn("[S3 cleanup] Queue processor unavailable:", error instanceof Error ? error.message : "unknown error");
  }
}

function startS3CleanupProcessor() {
  if (s3CleanupProcessorStarted) return;
  s3CleanupProcessorStarted = true;
  void processS3CleanupQueue();
  const timer = setInterval(() => { void processS3CleanupQueue(); }, 5 * 60 * 1000);
  timer.unref?.();
}

function sanitizeClientResponse(client: any, userRole?: string) {
  const canViewOwnerIdentity = userRole === "manager" || userRole === "admin";
  return {
    ...client,
    owners: (client.owners as any[] ?? []).map(owner => {
      const { ssn: _ssn, ...withoutSsn } = owner;
      if (canViewOwnerIdentity) return { ...withoutSsn, ssn: owner.ssn ? "" : null };
      const { idNumber: _idNumber, idState: _idState, ...safeOwner } = withoutSsn;
      return safeOwner;
    }),
    bankAccountEncrypted: undefined,
    abaRoutingEncrypted: undefined,
    hasBankAccount: !!client.bankAccountEncrypted,
    hasAbaRouting: !!client.abaRoutingEncrypted,
  };
}

const assignmentUserFields = {
  id: users.id,
  name: sql<string>`concat_ws(' ', ${users.firstName}, ${users.lastName})`,
  firstName: users.firstName,
  lastName: users.lastName,
  profileImageUrl: users.profileImageUrl,
  role: users.role,
};

function parseListPagination(req: any) {
  const pageValue = Number.parseInt(String(req.query.page ?? "1"), 10);
  const limitValue = Number.parseInt(String(req.query.limit ?? "50"), 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;
  const limit = Number.isFinite(limitValue) ? Math.min(200, Math.max(1, limitValue)) : 50;
  return { page, limit, offset: (page - 1) * limit };
}

function buildDocumentMetadata(document: any) {
  return {
    documentId: document.id,
    filePath: `/api/documents/${document.id}/view`,
    downloadPath: `/api/documents/${document.id}/download`,
    originalName: document.originalName,
    mimeType: document.mimeType,
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  startS3CleanupProcessor();
  // Auto-grant "earl" permission to all existing admin users who don't have it
  try {
    const adminUsers = await db.select().from(users).where(eq(users.role, "admin"));
    for (const adminUser of adminUsers) {
      const perms = await storage.getUserPermissions(adminUser.id);
      if (!perms.includes("earl")) {
        const newPerms = perms.length > 0 ? [...perms, "earl"] : [...(ROLE_DEFAULT_PERMISSIONS.admin as string[])];
        await storage.setUserPermissions(adminUser.id, newPerms, "system");
      }
    }
    console.log("[startup] Earl permission seeded for admin users");
  } catch (err: any) {
    console.warn("[startup] Could not seed earl permission (non-fatal):", err?.message);
  }

  const requireAuth = authenticateCurrentUser;

  const requireAdmin = (req: any, res: any, next: any) => {
    authenticateCurrentUser(req, res, async () => {
      if (req.user.role === "admin") return next();
      // A manager may be delegated the admin module, but employee accounts
      // remain ineligible for administrative endpoints regardless of toggles.
      if (req.user.role === "manager" && String(req.originalUrl || "").split("?")[0].startsWith("/api/admin")) {
        return requirePermission("admin")(req, res, next);
      }
      await auditAuthorizationDenial(req, req.user, "admin");
      return res.status(403).json({ message: "Admin access required" });
    });
  };

  const requireManagerOrAdmin = (req: any, res: any, next: any) => {
    authenticateCurrentUser(req, res, async () => {
      if (req.user.role !== "manager" && req.user.role !== "admin") {
        await auditAuthorizationDenial(req, req.user, "manager_or_admin");
        return res.status(403).json({ message: "Manager or admin access required" });
      }
      next();
    });
  };

  // Resolve canonical broker/branch references in one place. Legacy debtor-only
  // invoices remain untouched, while every new broker-linked write gets an
  // authoritative branch snapshot from the database.
  const resolveInvoiceBrokerBranch = async (
    input: Record<string, any>,
    current?: typeof invoices.$inferSelect,
  ) => {
    const hasBroker = Object.prototype.hasOwnProperty.call(input, "brokerId");
    const hasBranch = Object.prototype.hasOwnProperty.call(input, "branchId");
    const hasBranchName = Object.prototype.hasOwnProperty.call(input, "branchName");
    if (!hasBroker && !hasBranch && !hasBranchName) return input;

    const currentBrokerId = current?.brokerId ?? null;
    const currentBranchId = current?.branchId ?? null;
    let brokerId = hasBroker ? input.brokerId ?? null : currentBrokerId;
    let branchId = hasBranch ? input.branchId ?? null : currentBranchId;

    // Switching brokers without explicitly selecting a branch cannot retain a
    // branch from the previous broker.
    if (hasBroker && brokerId !== currentBrokerId && !hasBranch) branchId = null;
    if (hasBroker && brokerId == null) branchId = null;

    if (brokerId != null) {
      const [broker] = await db.select({ id: brokers.id, status: brokers.status })
        .from(brokers).where(eq(brokers.id, brokerId)).limit(1);
      if (!broker) throw Object.assign(new Error("Broker not found"), { status: 400 });
      if (broker.status !== "active") throw Object.assign(new Error("Broker is not active"), { status: 400 });
    }

    if (branchId != null) {
      if (brokerId == null) throw Object.assign(new Error("brokerId is required when branchId is supplied"), { status: 400 });
      const [branch] = await db.select({
        id: brokerBranches.id,
        branchName: brokerBranches.branchName,
        status: brokerBranches.status,
      }).from(brokerBranches).where(and(
        eq(brokerBranches.id, branchId),
        eq(brokerBranches.brokerId, brokerId),
      )).limit(1);
      if (!branch) throw Object.assign(new Error("Branch not found for broker"), { status: 400 });
      if (branch.status !== "active") throw Object.assign(new Error("Branch is not active"), { status: 400 });
      input.branchName = branch.branchName;
    } else if (hasBroker || hasBranch || (currentBrokerId != null && hasBranchName)) {
      input.branchName = null;
    }

    if (hasBroker) input.brokerId = brokerId;
    if (hasBranch || (hasBroker && brokerId !== currentBrokerId)) input.branchId = branchId;
    return input;
  };

  const requireReportsPermission = requirePermission("reports");

  const requireModulePermission = requirePermission;

  const employeeCanAccessInvoice = async (req: any, invoiceId: number) => {
    if (req.user?.role !== "employee") return true;
    const invoice = await storage.getInvoice(invoiceId);
    return !!invoice && (invoice.submittedBy === req.user.id || invoice.assignedFollowupAgentId === req.user.id);
  };

  const employeeCanAccessDocument = async (req: any, documentId: number) => {
    if (req.user?.role !== "employee") return true;
    const document = await storage.getDocument(documentId);
    return !!document?.invoiceId && employeeCanAccessInvoice(req, document.invoiceId);
  };

  const employeeCanModifyInvoice = async (req: any, invoiceId: number) => {
    if (req.user?.role !== "employee") return true;
    const invoice = await storage.getInvoice(invoiceId);
    return !!invoice && invoice.submittedBy === req.user.id
      && ["draft", "rejected", "submitted", "docs_pending"].includes(invoice.status);
  };

  const employeeCanModifyDocument = async (req: any, documentId: number) => {
    if (req.user?.role !== "employee") return true;
    const document = await storage.getDocument(documentId);
    return !!document?.invoiceId && employeeCanModifyInvoice(req, document.invoiceId);
  };

  const isPrivilegedUser = (req: any) => req.user?.role === "manager" || req.user?.role === "admin";
  const runPreflightForInvoice = async (input: Record<string, any>, dbClient: any = db) => {
    const result = await runInvoicePreflight({
    carrierId: Number(input.carrierId ?? input.clientId),
    brokerId: input.brokerId == null ? undefined : Number(input.brokerId),
    invoiceNumber: input.invoiceNumber == null ? undefined : String(input.invoiceNumber),
    loadNumber: input.loadNumber == null ? undefined : String(input.loadNumber),
    amount: input.amount == null ? undefined : Number(input.amount),
    serviceDate: input.serviceDate ?? input.invoiceDate ?? input.date ?? undefined,
    ...(input.excludeInvoiceId == null ? {} : { excludeInvoiceId: Number(input.excludeInvoiceId) }),
    } as any, dbClient);
    const ids = parseIntakeIds(input.ocrDocumentIds);
    if (ids.length) {
      if (!input.ocrActor) throw new IntakeError("OCR intake requires an authenticated owner");
      const snapshot = await getIntakeSnapshot(ids, input.ocrActor, dbClient);
      if (snapshot.status !== "completed") throw new IntakeError(snapshot.error || "Wait for all intake documents to finish extraction", 409);
      result.alerts.push(...snapshot.alerts);
    }
    return result;
  };
  const getNextInvoiceNumberInTransaction = async (tx: any) => {
    const result = await tx.execute(sql`SELECT nextval('invoices_internal_number_seq'::regclass)::text AS sequence`);
    const sequence = String(result.rows[0]?.sequence ?? "");
    if (!/^\d+$/.test(sequence)) throw new Error("Failed to allocate an internal invoice number.");
    return `INV${sequence.padStart(3, "0")}`;
  };
  const getPortalSubmissionNearDuplicateAlerts = async (
    input: { carrierId: number; brokerId: number; amount: number },
    dbClient: any = db,
  ) => {
    const settingsResult = await dbClient.execute(sql`SELECT rules, near_amount_tolerance, near_service_date_days FROM invoice_preflight_settings LIMIT 1`);
    const settings: any = settingsResult.rows[0];
    if (settings?.rules?.DUPLICATE_NEAR === false) return [];
    const toleranceValue = Number(settings?.near_amount_tolerance ?? 1);
    const tolerance = Number.isFinite(toleranceValue) ? toleranceValue : 1;
    const windowDaysValue = Number(settings?.near_service_date_days ?? 3);
    const windowDays = Number.isFinite(windowDaysValue) && windowDaysValue >= 0 ? windowDaysValue : 3;
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const candidates = await dbClient.select({
      id: carrierSubmissions.id,
      amount: carrierSubmissions.amount,
      submittedAt: carrierSubmissions.submittedAt,
      invoiceNumber: carrierSubmissions.invoiceNumber,
      loadNumber: carrierSubmissions.loadNumber,
    }).from(carrierSubmissions).where(and(
      eq(carrierSubmissions.carrierId, input.carrierId),
      eq(carrierSubmissions.brokerId, input.brokerId),
      inArray(carrierSubmissions.status, ["submitted", "under_review", "approved", "funded"]),
      gte(carrierSubmissions.submittedAt, windowStart),
      lte(carrierSubmissions.submittedAt, now),
    ));
    return candidates
      .filter((candidate: any) => Number.isFinite(Number(candidate.amount))
        && Math.abs(Number(candidate.amount) - input.amount) <= tolerance)
      .map((candidate: any) => ({
        code: "DUPLICATE_NEAR",
        severity: "block",
        title: "Possible near-duplicate portal submission",
        message: `Portal submission ${candidate.id} has the same carrier and broker, a similar amount, and was submitted within the last ${windowDays} days.`,
        link: `/portal/submissions/${candidate.id}`,
      }));
  };

  const getPreflightDecision = (alerts: any[], acknowledgements: any, user: any, overrideNearDuplicate: boolean) => {
    const ackSchema = z.array(z.object({
      code: z.string().trim().min(1).max(120),
      reason: z.string().trim().max(2000).optional(),
    }).strict()).max(100);
    const parsedAcks = ackSchema.safeParse(acknowledgements ?? []);
    if (!parsedAcks.success) {
      return { accepted: false, acknowledgements: [], nearOverride: false, invalidAcknowledgements: true, missingAckCodes: [] as string[] };
    }
    const acks = parsedAcks.data;
    const ackCodes = acks.map((ack) => ack.code);
    const distinctAckCodes = new Set(ackCodes);
    const requiredAckCodes = new Set(alerts.filter((alert: any) => alert.severity === "ack").map((alert: any) => String(alert.code)));
    const invalidAckCodes = ackCodes.some((code) => !requiredAckCodes.has(code)) || distinctAckCodes.size !== ackCodes.length;
    if (invalidAckCodes) {
      return { accepted: false, acknowledgements: acks, nearOverride: false, invalidAcknowledgements: true, missingAckCodes: [] as string[] };
    }
    const nearOverride = overrideNearDuplicate && isPrivilegedUser({ user })
      && alerts.some((alert: any) => alert.code === "DUPLICATE_NEAR" && alert.severity === "block");
    const missingAckCodes = Array.from(requiredAckCodes).filter((code) => !distinctAckCodes.has(code));
    const blocked = alerts.some((alert: any) =>
      alert.severity === "block" && !(alert.code === "DUPLICATE_NEAR" && nearOverride),
    );
    return {
      accepted: !blocked && missingAckCodes.length === 0,
      acknowledgements: acks,
      nearOverride,
      invalidAcknowledgements: false,
      missingAckCodes,
    };
  };

  const recordInvoicePreflight = async (
    invoiceId: number,
    userId: string,
    alerts: any[],
    acknowledgements: any[],
    nearOverride = false,
    executor: any = db,
  ) => {
    for (const alert of alerts.filter((item: any) => item.severity === "ack")) {
      const acknowledgement = acknowledgements.find((item: any) => String(item?.code) === String(alert.code));
      if (!acknowledgement) continue;
      await executor.execute(sql`
        INSERT INTO invoice_alert_acks (invoice_id, alert_code, user_id, reason, acked_at)
        VALUES (${invoiceId}, ${String(alert.code)}, ${userId}, ${acknowledgement.reason ? String(acknowledgement.reason) : null}, NOW())
      `);
    }
    await executor.insert(eventLedger).values({
      entityType: "invoice",
      entityId: invoiceId,
      eventType: "invoice_preflight",
      actorType: "user",
      actorId: userId,
      payloadJson: { alerts, acknowledgements, nearDuplicateOverride: nearOverride },
    });
    if (nearOverride) {
      await executor.insert(eventLedger).values({
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "invoice_preflight_near_duplicate_override",
        actorType: "user",
        actorId: userId,
        payloadJson: { alerts: alerts.filter((alert: any) => alert.code === "DUPLICATE_NEAR") },
      });
    }
  };
  const canAccessAssignedRecord = (req: any, assignedProcessor: string | null | undefined) =>
    isPrivilegedUser(req) || assignedProcessor === req.user?.id;
  const getAssignedProcessorUser = async (assignedProcessor: string | null | undefined) => {
    if (!assignedProcessor) return null;
    const [user] = await db.select(assignmentUserFields).from(users).where(eq(users.id, assignedProcessor)).limit(1);
    return user ? { ...user, name: user.name || null } : null;
  };
  const enrichClientAssignment = async (client: any) => ({
    ...client,
    assignedProcessorUser: await getAssignedProcessorUser(client.assignedProcessor),
  });
  const enrichBrokerAssignment = async (broker: any) => ({
    ...broker,
    assignedProcessorUser: await getAssignedProcessorUser(broker.assignedProcessor),
  });
  const enrichAssignments = async (rows: any[]) => {
    const ids = Array.from(new Set<string>(
      rows.map(row => row.assignedProcessor).filter((id): id is string => typeof id === "string" && id.length > 0),
    ));
    if (!ids.length) return rows.map(row => ({ ...row, assignedProcessorUser: null }));
    const assignedUsers = await db.select(assignmentUserFields).from(users).where(inArray(users.id, ids));
    const userMap = new Map(assignedUsers.map(user => [user.id, { ...user, name: user.name || null }]));
    return rows.map(row => ({ ...row, assignedProcessorUser: row.assignedProcessor ? userMap.get(row.assignedProcessor) ?? null : null }));
  };
  const validateAssignedProcessor = async (assignedProcessor: unknown) => {
    if (assignedProcessor == null || assignedProcessor === "") return null;
    if (typeof assignedProcessor !== "string") throw Object.assign(new Error("Invalid assigned processor"), { status: 400 });
    const [user] = await db.select({ id: users.id }).from(users).where(and(
      eq(users.id, assignedProcessor),
      eq(users.status, "active"),
      inArray(users.role, ["employee", "manager", "admin"]),
    )).limit(1);
    if (!user) throw Object.assign(new Error("Assigned processor must be an active employee, manager, or admin"), { status: 400 });
    return assignedProcessor;
  };
  const canAccessClient = async (req: any, id: number | null | undefined) => {
    if (isPrivilegedUser(req)) return true;
    if (id == null) return false;
    const [client] = await db.select({ assignedProcessor: clients.assignedProcessor }).from(clients).where(eq(clients.id, id)).limit(1);
    return !!client && canAccessAssignedRecord(req, client.assignedProcessor);
  };
  const canAccessBroker = async (req: any, id: number) => {
    if (isPrivilegedUser(req)) return true;
    const [broker] = await db.select({ assignedProcessor: brokers.assignedProcessor }).from(brokers).where(eq(brokers.id, id)).limit(1);
    return !!broker && canAccessAssignedRecord(req, broker.assignedProcessor);
  };
  const assignedCarrierScope = async (req: any, column: any) => {
    if (isPrivilegedUser(req)) return undefined;
    const assigned = await db.select({ id: clients.id }).from(clients).where(eq(clients.assignedProcessor, req.user.id));
    return assigned.length ? inArray(column, assigned.map(row => row.id)) : sql`false`;
  };

  const withInvoiceDisplayStatus = (invoice: any) => ({
    ...invoice,
    displayStatus: getInvoiceDisplayStatus(invoice?.status),
  });

  const requireDevelopment = (_req: any, res: any, next: any) => {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ message: "Not found" });
    }
    next();
  };

  const testDocumentDate = () => new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());

  const streamTestPdf = (
    res: any,
    filename: string,
    title: string,
    subtitle: string,
    fields: Array<[string, string]>,
  ) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54, info: { Title: title, Author: "Trucking Pros Financial" } });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    doc.pipe(res);

    doc.rect(0, 0, 612, 112).fill("#098b9f");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(24).text("TRUCKING PROS FINANCIAL", 54, 34);
    doc.font("Helvetica").fontSize(10).text("FactorFlux Test Document", 54, 68);

    doc.fillColor("#1a1a1a").font("Helvetica-Bold").fontSize(22).text(title, 54, 145, { align: "center" });
    doc.fillColor("#5a5a5a").font("Helvetica").fontSize(10).text(subtitle, 54, 176, { align: "center" });

    let y = 220;
    fields.forEach(([label, value], index) => {
      const fill = index % 2 === 0 ? "#f1f5f5" : "#ffffff";
      doc.rect(54, y, 504, 38).fill(fill).strokeColor("#b5b5b5").stroke();
      doc.fillColor("#444444").font("Helvetica-Bold").fontSize(10).text(label.toUpperCase(), 68, y + 13, { width: 150 });
      doc.fillColor("#111111").font("Helvetica").fontSize(11).text(value, 220, y + 12, { width: 320 });
      y += 38;
    });

    doc.moveDown(3);
    doc.fillColor("#666666").font("Helvetica-Oblique").fontSize(9)
      .text("SAMPLE DOCUMENT — FOR TESTING PURPOSES ONLY", 54, 704, { align: "center", width: 504 });
    doc.end();
  };

  // ─── Health check — must be first, no auth, always 200 ───────────────────
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", ts: Date.now() });
  });

  // Apply a single permission gate to route groups whose handlers historically
  // only checked authentication. Public authentication and carrier/portal
  // callbacks are intentionally excluded before this protected API boundary.
  const publicApiPath = (pathname: string) =>
    /^\/api\/broker-(?:confirm|dispute)\/[^/]+$/.test(pathname)
    || pathname === "/api/webhooks/resend"
    || pathname === "/api/auth/login"
    || pathname === "/api/auth/logout"
    || pathname === "/api/auth/verify"
    || pathname.startsWith("/api/portal/")
    || pathname === "/api/portal"
    || pathname.startsWith("/api/portal-chat/")
    || pathname.startsWith("/api/carrier/register")
    || pathname.startsWith("/api/carrier-registration/");
  const permissionGroups: Array<[string, string]> = [
    ["/api/agent-dashboard", "all_authenticated"],
    ["/api/email-log", "all_authenticated"],
    ["/api/confirmation-follow-ups", "followups"],
    ["/api/broker-confirmation-settings", "factoring"],
    ["/api/firebase-test", "admin"],
    ["/api/firebase-clients", "carriers"],
    ["/api/version-check", "settings"],
    ["/api/time-tracking", "payroll"],
    ["/api/notifications", "dashboard"],
    ["/api/payout-settings", "payments"],
    ["/api/carrier-chat", "chat"],
    ["/api/document-rules", "rules"],
    ["/api/load-documents", "documents"],
    ["/api/doc-field-candidates", "documents"],
    ["/api/workflow-config", "workflow_builder"],
    ["/api/broker-follow-up-reminders", "followups"],
    ["/api/broker-follow-up-templates", "followups"],
    ["/api/broker-follow-ups", "followups"],
    ["/api/follow-up-clients", "followups"],
    ["/api/follow-ups", "followups"],
    ["/api/portal-submissions", "portal_submissions"],
    ["/api/carrier-portal", "portal_submissions"],
    ["/api/bulk-invoices", "bulk_invoices"],
    ["/api/release-letters", "release_letters"],
    ["/api/bank-transfers", "bank_transfers"],
    ["/api/fuel-card-applications", "fuel_advance"],
    ["/api/fuel-advances", "fuel_advance"],
    ["/api/cash-applications", "payments"],
    ["/api/credit-checks", "cb_reviews"],
    ["/api/settings/fmcsa-key", "mc_check"],
    ["/api/fmcsa", "mc_check"],
    ["/api/authority-checks", "mc_check"],
    ["/api/authority-alerts", "mc_check"],
    ["/api/ach-settings", "payments"],
    ["/api/bulk-sms", "bulk_sms"],
    ["/api/calendar", "calendar"],
    ["/api/ai/chat", "earl"],
    ["/api/ai/actions", "earl"],
    ["/api/payouts", "payments"],
    ["/api/exceptions", "payments"],
    ["/api/payments", "payments"],
    ["/api/activities", "logs"],
    ["/api/held", "held"],
    ["/api/collections", "followups"],
    ["/api/audit", "logs"],
    ["/api/dispatchers", "dispatchers"],
    ["/api/trucks", "trucks"],
    ["/api/drivers", "trucks"],
    ["/api/payroll", "payroll"],
    ["/api/reports", "reports"],
    ["/api/follow-ups", "followups"],
    ["/api/followups", "followups"],
    ["/api/loads", "factoring"],
    ["/api/downloads", "documents"],
    ["/api/download", "documents"],
    ["/api/documents", "documents"],
    ["/api/invoices", "invoices"],
    ["/api/tasks", "tasks"],
    ["/api/debtors", "factoring"],
    ["/api/client-email", "client_email"],
    ["/api/clients", "carriers"],
    ["/api/carriers", "carriers"],
    ["/api/brokers", "brokers"],
    ["/api/tickets", "tickets"],
    ["/api/expenses", "expenses"],
    ["/api/vault", "vault"],
    ["/api/lockbox", "lockbox"],
    ["/api/messages", "carriers"],
    ["/api/warnings", "invoices"],
    ["/api/chat", "chat"],
    ["/api/dashboard", "dashboard"],
    ["/api/desktop", "settings"],
    ["/api/support", "help"],
    ["/api/search", "dashboard"],
    ["/api/user", "settings"],
    ["/api/users", "chat"],
    ["/api/email", "admin"],
    ["/api/test", "admin"],
    ["/api/admin", "admin"],
  ];
  app.use("/api", (req: any, res: any, next: any) => {
    const pathname = String(req.originalUrl || "").split("?")[0];
    if (publicApiPath(pathname)) return next();
    // The default staff workbench must not fail because its bell polls an old
    // dashboard-module endpoint. These GET handlers always use req.user.id;
    // mutation permissions and access to anyone else's notifications stay unchanged.
    if (req.method === "GET" && ["/api/notifications", "/api/notifications/unread-count"].includes(pathname)) {
      return requireAuth(req, res, next);
    }
    if (req.method === "GET" && /^\/api\/clients\/\d+\/email-log$/.test(pathname)) {
      return requireAnyPermission(["carriers", "client_email"])(req, res, next);
    }
    if (pathname === "/api/carrier-chat" || pathname.startsWith("/api/carrier-chat/")) {
      return requireAnyPermission(["chat", "portal_submissions"])(req, res, next);
    }
    // Invoice reads are shared by the factoring and invoice modules, while
    // lifecycle/funding mutations and queues belong exclusively to factoring.
    if (pathname === "/api/invoices" || pathname.startsWith("/api/invoices/")) {
      const factoringOnly = /^\/api\/invoices\/(?:funding(?:\/|$)|[^/]+\/(?:transition|available-transitions|approve|override-approve|extend-chargeback|hold|release|chargeback\/refunds)|aging-alerts(?:\/|$)|chargebacks(?:\/|$))/.test(pathname);
      if (factoringOnly) return requirePermission("factoring")(req, res, next);
      if (/^\/api\/invoices\/[^/]+\/broker-confirmation(?:\/|$)/.test(pathname)) {
        return requireAnyPermission(["invoices", "factoring"])(req, res, next);
      }
      if (req.method === "GET" && /^\/api\/invoices(?:\/[^/]+\/detail)?$/.test(pathname)) {
        return requireAnyPermission(["invoices", "factoring"])(req, res, next);
      }
    }
    const group = permissionGroups.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    if (group?.[1] === "all_authenticated") return requireAuth(req, res, next);
    return (group ? requirePermission(group[1]) : requireAuth)(req, res, next);
  });

  // Bearer confirmation tokens never appear in invoice JSON or Earl payloads.
  const previousJsonReplacer = app.get("json replacer");
  app.set("json replacer", function(this: unknown, key: string, value: unknown) {
    if (key === "brokerConfirmationToken") return undefined;
    return typeof previousJsonReplacer === "function" ? previousJsonReplacer.call(this, key, value) : value;
  });
  registerBrokerConfirmationRoutes(app, { requireAuth, requireManagerOrAdmin, canAccessInvoice: employeeCanAccessInvoice });
  registerEmailLogRoutes(app, { requireAuth, requireManagerOrAdmin });
  registerAgentDashboardRoutes(app, requireAuth);

  app.get("/api/test/generate-rate-con", requireAdmin, requireDevelopment, (_req, res) => {
    streamTestPdf(
      res,
      "TEST-001-rate-confirmation.pdf",
      "RATE CONFIRMATION",
      "Load tender and carrier rate agreement",
      [
        ["Broker", "TPF Test Broker"],
        ["Carrier", "TPF Test Carrier"],
        ["Load Number", "TEST-001"],
        ["Origin", "Chicago, IL"],
        ["Destination", "Dallas, TX"],
        ["Rate", "$85,000.00"],
        ["Payment Terms", "Net 30"],
        ["Date", testDocumentDate()],
      ],
    );
  });

  app.get("/api/test/generate-bol", requireAdmin, requireDevelopment, (_req, res) => {
    streamTestPdf(
      res,
      "TEST-001-bill-of-lading.pdf",
      "BILL OF LADING",
      "Non-negotiable freight shipping document",
      [
        ["Carrier", "TPF Test Carrier"],
        ["Load Number", "TEST-001"],
        ["Shipper", "ABC Warehouse, Chicago, IL"],
        ["Consignee", "XYZ Distribution, Dallas, TX"],
        ["Commodity", "General Freight"],
        ["Weight", "42,000 lbs"],
        ["Date", testDocumentDate()],
      ],
    );
  });

  // Auth
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      const dbUser = await storage.getUserByEmail(username);
      if (!dbUser) {
        console.warn(`[login] No user found for email: ${username}`);
        return res.status(401).json({ message: "No account found with that email address." });
      }
      if (!dbUser.password) {
        console.warn(`[login] User ${username} has no password set`);
        return res.status(401).json({ message: "This account has no password set. Contact your administrator." });
      }

      const isValid = await bcrypt.compare(password, dbUser.password);
      if (!isValid) {
        console.warn(`[login] Invalid password for user: ${username}`);
        return res.status(401).json({ message: "Incorrect password. Please try again." });
      }

      if ((dbUser as any).status === "suspended") {
        return res.status(403).json({ message: "Your account has been suspended. Contact your administrator." });
      }
      if ((dbUser as any).status === "inactive") {
        return res.status(403).json({ message: "This account has been deactivated." });
      }

      const sessionUser = {
        id: dbUser.id,
        username: dbUser.email || dbUser.id,
        name: `${dbUser.firstName || ""} ${dbUser.lastName || ""}`.trim(),
        role: dbUser.role,
        firstName: dbUser.firstName || "",
        lastName: dbUser.lastName || "",
        verified: dbUser.verified ?? false,
        profileImageUrl: dbUser.profileImageUrl || "",
      };
      (req.session as any).user = sessionUser;
      return res.json({ success: true, user: sessionUser });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/auth/verify", requireAuth, async (req: any, res) => {
    const sessionUser = (req.session as any)?.user;
    if (!sessionUser) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    // Refresh profileImageUrl from DB so sidebar/header always show the latest image
    try {
      const dbUser = await storage.getUser(sessionUser.id);
      if (dbUser) {
        sessionUser.profileImageUrl = dbUser.profileImageUrl || "";
        (req.session as any).user = sessionUser;
      }
    } catch {}
    return res.json({ user: sessionUser });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ message: "Logout failed" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get("/api/auth/user", requireAuth, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.id);

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.get("/api/firebase-test", async (_req, res) => {
    if (!firestore) {
      return res.status(503).json({ error: "Firestore not configured — FIREBASE_SERVICE_ACCOUNT not set." });
    }
    try {
      const testRef = firestore.collection("test").doc("ping");

      await testRef.set({
        message: "firebase working",
        timestamp: new Date().toISOString(),
      });

      const snap = await testRef.get();
      return res.json(snap.data());
    } catch (err) {
      console.error("Firebase test failed:", err);
      return res.status(500).json({ error: "Firebase failed" });
    }
  });

  // Profile
  app.get("/api/user/profile", requireAuth, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.id);
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json(user);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.patch("/api/user/profile", requireAuth, async (req: any, res) => {
    try {
      const validUpdates = [
        "firstName",
        "lastName",
        "phone",
        "jobTitle",
        "department",
        "bio",
        "location",
        "timezone",
        "language",
        "emailNotifications",
        "smsNotifications",
        "desktopNotifications",
        "startTime",
        "endTime",
        "workDays",
        "theme",
        "dateFormat",
        "timeFormat",
      ];

      const filteredUpdates = Object.keys(req.body)
        .filter((key) => validUpdates.includes(key))
        .reduce((obj: any, key) => {
          obj[key] = req.body[key];
          return obj;
        }, {});

      await storage.updateUserProfile(req.user.id, filteredUpdates);

      res.json({
        message: "Profile updated successfully",
        success: true,
      });
    } catch (error) {
      console.error("Error updating user profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  app.post("/api/user/profile-image", requireAuth, handleUpload("profileImage"), async (req: any, res) => {
    try {
      const userId = req.user.id;

      if (!req.file) {
        return res.status(400).json({ message: "No image file provided" });
      }

      // Memory storage gives us a buffer — write it to disk with a unique name
      const ext = path.extname(req.file.originalname).toLowerCase() || ".jpg";
      const filename = `profile-${crypto.randomUUID()}${ext}`;
      const uploadsDir = path.resolve(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);

      const profileImageUrl = `/uploads/${filename}`;
      await storage.updateUserProfile(userId, { profileImageUrl });

      // Update session immediately so auth context reflects the new image without re-login
      if ((req.session as any).user) {
        (req.session as any).user.profileImageUrl = profileImageUrl;
      }

      res.json({ message: "Profile image updated successfully", profileImageUrl });
    } catch (error) {
      console.error("Error uploading profile image:", error);
      res.status(500).json({ message: "Failed to upload profile image" });
    }
  });

  // Support
  app.post("/api/support/contact", requireAuth, async (req, res) => {
    try {
      const contactSchema = z.object({
        name: z.string().trim().min(1, "Name is required"),
        email: z.string().trim().email("Valid email is required"),
        subject: z.string().trim().min(1, "Subject is required"),
        message: z.string().trim().min(1, "Message is required"),
      });

      const { name, email, subject, message } = contactSchema.parse(req.body);

      const supportEmail = "dosh@truckingprosfinancial.com";
      const FROM = "Support@Truckingprosfinancial.com";

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 24px;">
          <h2 style="margin-bottom: 16px; color: #111827;">New FactorFlux Help Message</h2>
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin-bottom: 16px;">
            <p style="margin: 0 0 8px;"><strong>Name:</strong> ${name}</p>
            <p style="margin: 0 0 8px;"><strong>Email:</strong> ${email}</p>
            <p style="margin: 0 0 8px;"><strong>Subject:</strong> ${subject}</p>
          </div>
          <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px;">
            <p style="margin: 0 0 10px;"><strong>Message:</strong></p>
            <p style="white-space: pre-wrap; margin: 0; color: #374151;">${message}</p>
          </div>
        </div>
      `;

      const text = `
New FactorFlux Help Message

Name: ${name}
Email: ${email}
Subject: ${subject}

Message:
${message}
      `.trim();

      const sent = await sendEmail({
        to: supportEmail,
        subject: `[FactorFlux Help] ${subject} — from ${name}`,
        text,
        html,
      });

      if (!sent) {
        return res.status(500).json({
          error: "Message could not be sent right now.",
        });
      }

      res.status(200).json({
        success: true,
        message: "Message sent successfully.",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: error.errors[0]?.message || "Invalid form data.",
        });
      }

      console.error("Contact support route error:", error);
      res.status(500).json({
        error: "Failed to send message.",
      });
    }
  });

  app.post("/api/support/messages", requireAuth, async (req, res) => {
    try {
      const contactSchema = z.object({
        name: z.string().trim().min(1, "Name is required"),
        email: z.string().trim().email("Valid email is required"),
        subject: z.string().trim().min(1, "Subject is required"),
        message: z.string().trim().min(1, "Message is required"),
      });

      const { name, email, subject, message } = contactSchema.parse(req.body);

      await storage.createSupportMessage({
        name,
        email,
        subject,
        message,
      });

      const FROM = "Support@Truckingprosfinancial.com";

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 24px;">
          <h2 style="margin-bottom: 16px; color: #111827;">New FactorFlux Help Message</h2>
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin-bottom: 16px;">
            <p style="margin: 0 0 8px;"><strong>Name:</strong> ${name}</p>
            <p style="margin: 0 0 8px;"><strong>Email:</strong> ${email}</p>
            <p style="margin: 0 0 8px;"><strong>Subject:</strong> ${subject}</p>
          </div>
          <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px;">
            <p style="margin: 0 0 10px;"><strong>Message:</strong></p>
            <p style="white-space: pre-wrap; margin: 0; color: #374151;">${message}</p>
          </div>
        </div>
      `;

      const text = `
New FactorFlux Help Message

Name: ${name}
Email: ${email}
Subject: ${subject}

Message:
${message}
      `.trim();

      await sendEmail({
        to: "dosh@truckingprosfinancial.com",
        subject: `[FactorFlux Help] ${subject} — from ${name}`,
        text,
        html,
      });

      res.status(200).json({
        success: true,
        message: "Message sent successfully.",
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: error.errors[0]?.message || "Invalid form data.",
        });
      }

      console.error("Support message route error:", error);
      res.status(500).json({
        error: "Failed to save message.",
      });
    }
  });

  app.get("/api/support/messages", requireAuth, async (_req, res) => {
    try {
      const messages = await storage.getSupportMessages();
      res.json(messages);
    } catch (error) {
      console.error("Error fetching support messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  // ─── Tickets ───────────────────────────────────────────────────────────────
  const ticketCategories = ["billing", "technical", "carrier", "broker", "document", "payroll", "other"] as const;
  const ticketPriorities = ["low", "medium", "high", "urgent"] as const;
  const ticketStatuses = ["open", "in-progress", "pending", "resolved", "closed"] as const;
  const ticketIdSchema = z.coerce.number().int().positive();
  const ticketCreateSchema = z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(10000),
    category: z.enum(ticketCategories),
    priority: z.enum(ticketPriorities).default("medium"),
    assignedTo: z.string().trim().min(1).nullable().optional(),
    carrierId: z.coerce.number().int().positive().nullable().optional(),
    brokerId: z.coerce.number().int().positive().nullable().optional(),
    invoiceId: z.coerce.number().int().positive().nullable().optional(),
  });
  const ticketPatchSchema = z.object({
    status: z.enum(ticketStatuses).optional(),
    priority: z.enum(ticketPriorities).optional(),
    assignedTo: z.string().trim().min(1).nullable().optional(),
    resolution: z.string().trim().max(10000).nullable().optional(),
  }).strict();
  const ticketCommentSchema = z.object({ comment: z.string().trim().min(1).max(10000) });
  const canSeeTicket = (user: any, ticket: any) =>
    user.role !== "employee" || ticket.submittedBy === user.id || ticket.assignedTo === user.id;
  const getTicket = async (id: number) => {
    const rows = await db.select().from(tickets).where(eq(tickets.id, id));
    return rows[0];
  };
  const ensureAssignableUser = async (userId: string | null | undefined) => {
    if (!userId) return true;
    const [candidate] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    return Boolean(candidate);
  };
  const ensureLinkedRecordsExist = async (input: { carrierId?: number | null; brokerId?: number | null; invoiceId?: number | null }) => {
    const [carrier, broker, invoice] = await Promise.all([
      input.carrierId ? db.select({ id: clients.id }).from(clients).where(eq(clients.id, input.carrierId)) : Promise.resolve([{ id: null }]),
      input.brokerId ? db.select({ id: brokers.id }).from(brokers).where(eq(brokers.id, input.brokerId)) : Promise.resolve([{ id: null }]),
      input.invoiceId ? db.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, input.invoiceId)) : Promise.resolve([{ id: null }]),
    ]);
    if (input.carrierId && !carrier[0]) return "Carrier was not found";
    if (input.brokerId && !broker[0]) return "Broker was not found";
    if (input.invoiceId && !invoice[0]) return "Invoice was not found";
    return null;
  };

  app.get("/api/tickets", requireAuth, requireModulePermission("tickets"), async (req: any, res) => {
    try {
      const filters: any[] = [];
      const user = req.user;
      if (user.role === "employee") filters.push(or(eq(tickets.submittedBy, user.id), eq(tickets.assignedTo, user.id)));
      if (req.query.status) {
        if (!ticketStatuses.includes(String(req.query.status) as any)) return res.status(400).json({ message: "Invalid status filter" });
        filters.push(eq(tickets.status, String(req.query.status) as any));
      }
      if (req.query.priority) {
        if (!ticketPriorities.includes(String(req.query.priority) as any)) return res.status(400).json({ message: "Invalid priority filter" });
        filters.push(eq(tickets.priority, String(req.query.priority) as any));
      }
      if (req.query.category) {
        if (!ticketCategories.includes(String(req.query.category) as any)) return res.status(400).json({ message: "Invalid category filter" });
        filters.push(eq(tickets.category, String(req.query.category) as any));
      }
      if (req.query.assignedTo) filters.push(eq(tickets.assignedTo, String(req.query.assignedTo)));
      if (req.query.from) {
        const date = new Date(String(req.query.from));
        if (Number.isNaN(date.getTime())) return res.status(400).json({ message: "Invalid from date" });
        filters.push(gte(tickets.createdAt, date));
      }
      if (req.query.to) {
        const date = new Date(String(req.query.to));
        if (Number.isNaN(date.getTime())) return res.status(400).json({ message: "Invalid to date" });
        date.setUTCDate(date.getUTCDate() + 1);
        filters.push(lt(tickets.createdAt, date));
      }
      const rows = await db.select().from(tickets).where(filters.length ? and(...filters) : undefined).orderBy(desc(tickets.createdAt));
      const enriched = await Promise.all(rows.map(async (ticket) => {
        const [submitted, assigned, carrier, broker, invoice] = await Promise.all([
          db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(eq(users.id, ticket.submittedBy)),
          ticket.assignedTo ? db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(eq(users.id, ticket.assignedTo)) : [],
          ticket.carrierId ? db.select({ name: clients.name }).from(clients).where(eq(clients.id, ticket.carrierId)) : [],
          ticket.brokerId ? db.select({ name: brokers.name }).from(brokers).where(eq(brokers.id, ticket.brokerId)) : [],
          ticket.invoiceId ? db.select({ invoiceNumber: invoices.invoiceNumber }).from(invoices).where(eq(invoices.id, ticket.invoiceId)) : [],
        ]);
        const name = (person: any) => person ? `${person.firstName || ""} ${person.lastName || ""}`.trim() || person.email : null;
        return {
          ...ticket,
          submittedByName: name(submitted[0]),
          assignedToName: name(assigned[0]),
          carrierName: carrier[0]?.name ?? null,
          brokerName: broker[0]?.name ?? null,
          invoiceNumber: invoice[0]?.invoiceNumber ?? null,
        };
      }));
      res.json(enriched);
    } catch (error) {
      console.error("Ticket list error:", error);
      res.status(500).json({ message: "Failed to fetch tickets" });
    }
  });

  app.get("/api/tickets/summary", requireAuth, requireModulePermission("tickets"), async (req: any, res) => {
    try {
      const scope = req.user.role === "employee"
        ? or(eq(tickets.submittedBy, req.user.id), eq(tickets.assignedTo, req.user.id))
        : undefined;
      const rows = await db.select({
        status: tickets.status,
        resolvedAt: tickets.resolvedAt,
      }).from(tickets).where(scope);
      const today = new Date();
      const sameDay = (value: Date | null) => value && value.getFullYear() === today.getFullYear()
        && value.getMonth() === today.getMonth() && value.getDate() === today.getDate();
      res.json({
        open: rows.filter(row => row.status === "open").length,
        inProgress: rows.filter(row => row.status === "in-progress").length,
        pending: rows.filter(row => row.status === "pending").length,
        resolvedToday: rows.filter(row => sameDay(row.resolvedAt)).length,
      });
    } catch {
      res.status(500).json({ message: "Failed to fetch ticket summary" });
    }
  });

  app.get("/api/tickets/:id", requireAuth, requireModulePermission("tickets"), async (req: any, res) => {
    try {
      const id = ticketIdSchema.parse(req.params.id);
      const ticket = await getTicket(id);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      if (!canSeeTicket(req.user, ticket)) return res.status(403).json({ message: "You do not have access to this ticket" });
      const comments = await db.select().from(ticketComments).where(eq(ticketComments.ticketId, id)).orderBy(ticketComments.createdAt);
      const [submitted, assigned, carrier, broker, invoice] = await Promise.all([
        db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(eq(users.id, ticket.submittedBy)),
        ticket.assignedTo ? db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(eq(users.id, ticket.assignedTo)) : [],
        ticket.carrierId ? db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, ticket.carrierId)) : [],
        ticket.brokerId ? db.select({ id: brokers.id, name: brokers.name }).from(brokers).where(eq(brokers.id, ticket.brokerId)) : [],
        ticket.invoiceId ? db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber }).from(invoices).where(eq(invoices.id, ticket.invoiceId)) : [],
      ]);
      const name = (person: any) => person ? `${person.firstName || ""} ${person.lastName || ""}`.trim() || person.email : null;
      const commentsWithNames = await Promise.all(comments.map(async comment => {
        const [author] = await db.select({ firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(eq(users.id, comment.userId));
        return { ...comment, authorName: name(author) };
      }));
      res.json({
        ...ticket,
        submittedByName: name(submitted[0]),
        assignedToName: name(assigned[0]),
        carrier: carrier[0] ?? null,
        broker: broker[0] ?? null,
        invoice: invoice[0] ?? null,
        comments: commentsWithNames,
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid ticket id" });
      res.status(500).json({ message: "Failed to fetch ticket" });
    }
  });

  app.post("/api/tickets", requireAuth, requireModulePermission("tickets"), async (req: any, res) => {
    try {
      const input = ticketCreateSchema.parse(req.body);
      if (input.assignedTo && req.user.role === "employee") return res.status(403).json({ message: "Only managers and admins can assign tickets" });
      if (!(await ensureAssignableUser(input.assignedTo))) return res.status(400).json({ message: "Assigned agent was not found" });
      const linkedRecordError = await ensureLinkedRecordsExist(input);
      if (linkedRecordError) return res.status(400).json({ message: linkedRecordError });
      if (input.invoiceId && !(await employeeCanAccessInvoice(req, input.invoiceId))) {
        return res.status(403).json({ message: "You do not have access to the linked invoice" });
      }
      const created = await db.transaction(async (tx) => {
        // Transaction-scoped advisory lock makes number allocation safe across workers.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(481923)`);
        const [last] = await tx.select({ max: sql<number>`coalesce(max(substring(${tickets.ticketNumber} from 5)::integer), 0)` }).from(tickets);
        const number = Number(last?.max ?? 0) + 1;
        const [row] = await tx.insert(tickets).values({
          ...input,
          ticketNumber: `TKT-${String(number).padStart(4, "0")}`,
          submittedBy: req.user.id,
          assignedTo: input.assignedTo ?? null,
          carrierId: input.carrierId ?? null,
          brokerId: input.brokerId ?? null,
          invoiceId: input.invoiceId ?? null,
        }).returning();
        return row;
      });
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message || "Invalid ticket data" });
      console.error("Ticket create error:", error);
      res.status(500).json({ message: "Failed to create ticket" });
    }
  });

  app.patch("/api/tickets/:id", requireAuth, requireModulePermission("tickets"), async (req: any, res) => {
    try {
      const id = ticketIdSchema.parse(req.params.id);
      const input = ticketPatchSchema.parse(req.body);
      const ticket = await getTicket(id);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      if (!canSeeTicket(req.user, ticket)) return res.status(403).json({ message: "You do not have access to this ticket" });
      if (input.assignedTo !== undefined && req.user.role === "employee") return res.status(403).json({ message: "Only managers and admins can assign tickets" });
      if (!(await ensureAssignableUser(input.assignedTo))) return res.status(400).json({ message: "Assigned agent was not found" });
      const nextStatus = input.status ?? ticket.status;
      const nextResolution = input.resolution !== undefined ? input.resolution : ticket.resolution;
      if ((nextStatus === "resolved" || nextStatus === "closed") && !nextResolution?.trim()) {
        return res.status(400).json({ message: "Resolution is required when resolving or closing a ticket" });
      }
      const updates: any = { ...input, updatedAt: new Date() };
      if (input.status !== undefined) updates.resolvedAt = (nextStatus === "resolved" || nextStatus === "closed") ? (ticket.resolvedAt ?? new Date()) : null;
      const updateScope = req.user.role === "employee"
        ? and(eq(tickets.id, id), or(eq(tickets.submittedBy, req.user.id), eq(tickets.assignedTo, req.user.id)))
        : eq(tickets.id, id);
      const [updated] = await db.update(tickets).set(updates).where(updateScope).returning();
      if (!updated) return res.status(403).json({ message: "You no longer have access to this ticket" });
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message || "Invalid ticket update" });
      res.status(500).json({ message: "Failed to update ticket" });
    }
  });

  app.post("/api/tickets/:id/comments", requireAuth, requireModulePermission("tickets"), async (req: any, res) => {
    try {
      const id = ticketIdSchema.parse(req.params.id);
      const ticket = await getTicket(id);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      if (!canSeeTicket(req.user, ticket)) return res.status(403).json({ message: "You do not have access to this ticket" });
      const { comment: commentText } = ticketCommentSchema.parse(req.body);
      const [comment] = await db.insert(ticketComments).values({ ticketId: id, userId: req.user.id, comment: commentText }).returning();
      res.status(201).json(comment);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message || "Invalid comment" });
      res.status(500).json({ message: "Failed to add comment" });
    }
  });

  app.delete("/api/tickets/:id", requireAdmin, requireModulePermission("tickets"), async (req: any, res) => {
    try {
      const id = ticketIdSchema.parse(req.params.id);
      const deleted = await db.delete(tickets).where(eq(tickets.id, id)).returning({ id: tickets.id });
      if (!deleted.length) return res.status(404).json({ message: "Ticket not found" });
      res.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid ticket id" });
      res.status(500).json({ message: "Failed to delete ticket" });
    }
  });

  // Client/Carrier messaging
  app.post("/api/messages/send", requireAuth, async (req: any, res) => {
    try {
      const bodySchema = z.object({
        clientId: z.number().int().positive(),
        subject: z.string().trim().min(1, "Subject is required"),
        messageType: z.enum(["request_documents", "payment_notice", "general_inquiry", "follow_up"]),
        body: z.string().trim().min(1, "Message body is required"),
      });

      const { clientId, subject, messageType, body } = bodySchema.parse(req.body);
      const userId = req.session?.user?.id || req.user?.id;

      const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
      if (!client) return res.status(404).json({ error: "Client not found" });

      let emailStatus: "sent" | "failed" = "failed";
      let emailError = "";

      if (client.email) {
        const messageTypeLabel: Record<string, string> = {
          request_documents: "Document Request",
          payment_notice: "Payment Notice",
          general_inquiry: "General Inquiry",
          follow_up: "Follow Up",
        };

        const html = `
          <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;">
            <div style="background:#1e40af;color:#fff;border-radius:12px 12px 0 0;padding:20px 24px;">
              <h2 style="margin:0;font-size:20px;">Trucking Pros Financial</h2>
              <p style="margin:4px 0 0;opacity:.8;font-size:13px;">${messageTypeLabel[messageType] || messageType}</p>
            </div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
              <p style="color:#374151;font-size:15px;margin:0 0 16px;">Dear ${client.name},</p>
              <div style="white-space:pre-wrap;color:#111827;font-size:15px;line-height:1.6;">${body}</div>
              <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />
              <p style="color:#9ca3af;font-size:12px;margin:0;">Trucking Pros Financial &bull; Support@Truckingprosfinancial.com &bull; 385-495-4962</p>
            </div>
          </div>
        `;

        const sent = await sendEmail({
          to: client.email,
          emailLog: { entityType: "carrier", entityId: client.id, templateName: "carrier_notice" },
          subject,
          text: body,
          html,
        });
        emailStatus = sent ? "sent" : "failed";
        if (!sent) emailError = "Resend did not confirm sending";
      } else {
        emailError = "Client has no email address on file";
      }

      const logged = await storage.createClientMessage({
        clientId,
        sentBy: userId,
        subject,
        messageType,
        body,
        status: emailStatus,
      });

      if (emailStatus === "failed") {
        return res.status(207).json({
          success: false,
          error: emailError || "Email could not be delivered",
          message: logged,
        });
      }

      res.status(200).json({ success: true, message: logged });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors[0]?.message || "Invalid request" });
      }
      console.error("Client message send error:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  app.get("/api/messages", requireAuth, async (req, res) => {
    try {
      const clientId = req.query.clientId ? Number(req.query.clientId) : undefined;
      const messages = await storage.getClientMessages(clientId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching client messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  // Admin — User Management
  const adminUserOutput = (user: any) => {
    const { password: _password, ...safeUser } = user;
    return safeUser;
  };

  app.get("/api/admin/users", requireAdmin, async (_req: any, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      res.json(allUsers.map(adminUserOutput));
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/admin/users", requireAdmin, async (req: any, res) => {
    try {
      const schema = z.object({
        firstName: z.string().trim().min(1, "First name required"),
        lastName: z.string().trim().min(1, "Last name required"),
        email: z.string().trim().email("Valid email required"),
        role: z.enum(["employee", "manager", "admin"]),
        password: z.string().min(6, "Password must be at least 6 characters"),
      });
      const { firstName, lastName, email, role, password } = schema.parse(req.body);
      const adminUser = req.user;

      // Check for duplicate email
      const existing = await storage.getUserByEmail(email);
      if (existing) return res.status(409).json({ error: "An account with this email already exists" });

      const id = `agent-${Date.now()}`;
      const passwordHash = await bcrypt.hash(password, 10);

      const newUser = await storage.createAgent({
        id,
        firstName,
        lastName,
        email,
        role,
        password: passwordHash,
        createdBy: adminUser.id,
      });

      // Send welcome email
      const welcomeHtml = `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;">
          <div style="background:#1e40af;color:#fff;border-radius:12px 12px 0 0;padding:20px 24px;">
            <h2 style="margin:0;">Welcome to FactorFlux</h2>
            <p style="margin:4px 0 0;opacity:.8;font-size:13px;">Trucking Pros Financial</p>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
            <p>Hi ${firstName},</p>
            <p>Your FactorFlux account has been created. Here are your login credentials:</p>
            <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0;">
              <p style="margin:0 0 8px;"><strong>Login URL:</strong> ${req.protocol}://${req.get("host")}/login</p>
              <p style="margin:0 0 8px;"><strong>Email:</strong> ${email}</p>
              <p style="margin:0;"><strong>Temporary Password:</strong> ${password}</p>
            </div>
            <p>Please log in and change your password as soon as possible.</p>
            <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;" />
            <p style="color:#9ca3af;font-size:12px;margin:0;">Trucking Pros Financial · Support@Truckingprosfinancial.com</p>
          </div>
        </div>
      `;
      await sendEmail({
        to: email,
        subject: "Your FactorFlux Account Has Been Created",
        text: `Welcome to FactorFlux!\n\nEmail: ${email}\nTemporary Password: ${password}\n\nPlease log in at ${req.protocol}://${req.get("host")}/login`,
        html: welcomeHtml,
      });

      // Seed default permissions for the new user
      await storage.seedDefaultPermissions(id, role, adminUser.id);

      await storage.createActivity({
        userId: adminUser.id,
        type: "user_created",
        entityType: "user",
        entityId: 0,
        description: `Created new agent account: ${firstName} ${lastName} (${email}) with role: ${role}`,
      });

      res.status(201).json(adminUserOutput(newUser));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0]?.message });
      console.error("Error creating agent:", error);
      res.status(500).json({ error: "Failed to create agent" });
    }
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req: any, res) => {
    try {
      const adminUser = req.user;
      const { id } = req.params;
      const schema = z.object({
        firstName: z.string().trim().min(1).optional(),
        lastName: z.string().trim().min(1).optional(),
        email: z.string().trim().email().optional(),
        role: z.enum(["employee", "manager", "admin"]).optional(),
        status: z.enum(["active", "suspended", "inactive"]).optional(),
      });
      const updates = schema.parse(req.body);

      // Guard: admin cannot suspend/deactivate their own account
      if (id === adminUser.id && updates.status && updates.status !== "active") {
        return res.status(400).json({ error: "You cannot suspend your own account" });
      }

      const updatedUser = await storage.updateUserProfile(id, updates as any);

      await storage.createActivity({
        userId: adminUser.id,
        type: "user_updated",
        entityType: "user",
        entityId: 0,
        description: `Updated user ${id}: ${JSON.stringify(updates)}`,
      });

      res.json(adminUserOutput(updatedUser));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors[0]?.message });
      console.error("Error updating user:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req: any, res) => {
    try {
      const adminUser = req.user;
      const { id } = req.params;

      if (id === adminUser.id) {
        return res.status(400).json({ error: "You cannot delete your own account." });
      }

      await storage.deleteUser(id);

      await storage.createActivity({
        userId: adminUser.id,
        type: "user_deleted",
        entityType: "user",
        entityId: 0,
        description: `Deleted user account: ${id}`,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // ─── Permission routes ────────────────────────────────────────────────────

  // Current user's own permissions (no admin required)
  app.get("/api/auth/permissions", requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      // Admin and manager roles get all permissions
      if (req.user?.role === "admin") {
        return res.json({ permissions: [...ALL_PERMISSIONS] });
      }
      const perms = await storage.getUserPermissions(userId);
      // If no permissions seeded yet, fall back to role defaults
      if (perms.length === 0 && req.user?.role) {
        const defaults = ROLE_DEFAULT_PERMISSIONS[req.user.role] ?? ROLE_DEFAULT_PERMISSIONS.employee;
        return res.json({ permissions: defaults });
      }
      res.json({ permissions: perms.filter((permission) => permission !== "__none__") });
    } catch (err) {
      console.error("Error fetching own permissions:", err);
      res.status(500).json({ message: "Failed to fetch permissions" });
    }
  });

  app.get("/api/admin/users/:id/permissions", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const perms = await storage.getUserPermissions(id);
      res.json({ permissions: perms.filter((permission) => permission !== "__none__") });
    } catch (err) {
      console.error("Error fetching user permissions:", err);
      res.status(500).json({ message: "Failed to fetch user permissions" });
    }
  });

  app.put("/api/admin/users/:id/permissions", requireAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { permissions } = req.body;
      if (!Array.isArray(permissions)) {
        return res.status(400).json({ message: "permissions must be an array" });
      }
      const valid = permissions.filter((p) => (ALL_PERMISSIONS as readonly string[]).includes(p));
      await storage.setUserPermissions(id, valid, req.user.id);
      res.json({ permissions: valid });
    } catch (err) {
      console.error("Error saving user permissions:", err);
      res.status(500).json({ message: "Failed to save user permissions" });
    }
  });

  // Legacy role-only patch (kept for backwards compat)
  app.patch("/api/admin/users/:id/role", requireAdmin, async (req: any, res) => {
    const { id } = req.params;
    const { role } = req.body;
    const validRoles = ["employee", "manager", "admin"];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    const updatedUser = await storage.updateUserProfile(id, { role } as any);
    res.json(updatedUser);
  });

  // Dashboard / Activities
  app.get("/api/dashboard/stats", requireAuth, async (_req: any, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard statistics" });
    }
  });

  app.get("/api/dashboard/recent-activities", requireAuth, async (_req: any, res) => {
    try {
      const activities = await storage.getActivities(10);
      res.json(activities);
    } catch (error) {
      console.error("Error fetching recent activities:", error);
      res.status(500).json({ message: "Failed to fetch recent activities" });
    }
  });

  app.get("/api/activities", requireAuth, async (_req: any, res) => {
    try {
      const activities = await storage.getActivities();
      res.json(activities);
    } catch (error) {
      console.error("Error fetching all activities:", error);
      res.status(500).json({ message: "Failed to fetch activities" });
    }
  });

  app.delete("/api/activities", requireAuth, async (req: any, res) => {
    try {
      await storage.clearActivities();

      await storage.createActivity({
        userId: req.user.id,
        type: "activities_reset",
        entityType: "system",
        entityId: 0,
        description: "Reset all recent activity history",
      });

      res.json({ message: "Activities cleared successfully" });
    } catch (error) {
      console.error("Error clearing activities:", error);
      res.status(500).json({ message: "Failed to clear activities" });
    }
  });

  // Documents
  app.get("/api/documents", requireAuth, async (req: any, res) => {
    try {
      const { load, invoice, entityType, entityId } = req.query;
      let documents;

      if (entityType && entityId) {
        documents = await storage.getDocumentsByEntity(
          entityType as string,
          parseInt(entityId as string, 10)
        );
      } else if (load) {
        documents = await storage.getDocumentsByLoad(parseInt(load as string, 10));
      } else if (invoice) {
        documents = await storage.getDocumentsByInvoice(parseInt(invoice as string, 10));
      } else {
        documents = await storage.getDocuments();
      }

      if (req.user.role === "employee") {
        const ownedInvoices = new Set(
          (await storage.getInvoices()).filter(invoice => invoice.submittedBy === req.user.id).map(invoice => invoice.id),
        );
        documents = documents.filter(document => !!document.invoiceId && ownedInvoices.has(document.invoiceId));
      }
      const jobs = documents.length ? await db.selectDistinctOn([docExtractionJobs.documentId])
        .from(docExtractionJobs)
        .where(inArray(docExtractionJobs.documentId, documents.map(document => document.id)))
        .orderBy(docExtractionJobs.documentId, desc(docExtractionJobs.id)) : [];
      const latestJobs = new Map(jobs.map(job => [job.documentId, job]));
      res.json(documents.map(document => ({ ...document, ocrJob: latestJobs.get(document.id) ?? null })));
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  app.get("/api/invoices/:id/documents", requireAuth, async (req: any, res) => {
    try {
      const invoiceId = parseInt(req.params.id, 10);
      if (Number.isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });
      if (!await employeeCanAccessInvoice(req, invoiceId)) return res.status(403).json({ message: "You may only access documents for your own invoices" });
      const docs = await storage.getDocumentsByInvoice(invoiceId);
      res.json(docs);
    } catch (error) {
      console.error("Error fetching invoice documents:", error);
      res.status(500).json({ message: "Failed to fetch invoice documents" });
    }
  });

  app.patch("/api/documents/:id/document-type", requireAuth, async (req: any, res) => {
    try {
      if (req.user.role !== "manager" && req.user.role !== "admin") return res.status(403).json({ message: "Manager or admin access required" });
      const id = parseInt(req.params.id, 10);
      const validTypes = [
        "rate_confirmation", "bill_of_lading", "bol", "lumper_receipt",
        "commercial_invoice", "invoice", "pod", "noa", "release_letter", "receipt", "other",
      ];
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid document ID" });
      if (!validTypes.includes(req.body.documentType)) {
        return res.status(400).json({ message: "Invalid document type" });
      }

      const document = await storage.updateDocument(id, {
        documentType: req.body.documentType,
        finalDocumentType: req.body.documentType,
        classificationSource: "agent",
      } as any);
      if (!document) return res.status(404).json({ message: "Document not found" });
      res.json(document);
    } catch (error) {
      console.error("Error updating document type:", error);
      res.status(500).json({ message: "Failed to update document type" });
    }
  });

  registerOcrIntakeRoutes(app, requireAuth, handleOcrIntakeUpload, cleanupS3KeyWithRetry);

  app.post("/api/invoices/:id/documents", requireAuth, handleUpload("file"), async (req: any, res) => {
    try {
      const invoiceId = parseInt(req.params.id, 10);
      if (Number.isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });
      if (!await employeeCanModifyInvoice(req, invoiceId)) return res.status(403).json({ message: "Documents can only be changed on your own draft or correction-required invoices" });

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { documentType, sourceChannel } = req.body;
      const fileUuid = crypto.randomUUID();
      const s3Key = await uploadDocumentToS3(req.file, `documents/${fileUuid}`);
      const processedOriginalName = sanitizeOriginalName(req.file.originalname);
      // Write to /tmp for OCR pipeline (ephemeral, not uploads/)
      const tmpPath = path.join("/tmp", fileUuid);
      fs.writeFileSync(tmpPath, req.file.buffer);

      const documentData = {
        filename: fileUuid,
        originalName: processedOriginalName,
        mimeType: req.file.mimetype,
        size: req.file.size,
        ...documentSizeMetadata(req.file),
        s3Key,
        documentType: (documentType as any) || "other",
        loadId: null,
        invoiceId,
        uploadedBy: req.user.id,
        sourceChannel: (sourceChannel as any) || "manual",
        status: "processing" as const,
      };

      const document = await storage.createDocument(documentData);

      await storage.createActivity({
        userId: req.user.id,
        type: "document_uploaded",
        description: `Uploaded document: ${document.originalName}`,
        entityType: "document",
        entityId: document.id,
        metadata: buildDocumentMetadata(document),
      });

      setTimeout(async () => {
        try { await storage.updateDocument(document.id, { status: "processed" }); } catch {}
      }, 2000);

      res.status(201).json({ ...document, ...buildDocumentMetadata(document) });
    } catch (error) {
      console.error("Error uploading invoice document:", error);
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  app.get("/api/documents/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!await employeeCanAccessDocument(req, id)) return res.status(403).json({ message: "You may only access documents for your own invoices" });
      const document = await storage.getDocument(id);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      res.json(document);
    } catch (error) {
      console.error("Error fetching document:", error);
      res.status(500).json({ message: "Failed to fetch document" });
    }
  });

  app.post("/api/documents/upload", requireAuth, handleUpload("file"), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { documentType, loadId, invoiceId, sourceChannel } = req.body;
      if (invoiceId && !await employeeCanModifyInvoice(req, Number(invoiceId))) {
        return res.status(403).json({ message: "Documents can only be changed on your own draft or correction-required invoices" });
      }

      const fileUuid = crypto.randomUUID();
      const s3Key = await uploadDocumentToS3(req.file, `documents/${fileUuid}`);
      const processedMimeType = req.file.mimetype;
      const processedOriginalName = sanitizeOriginalName(req.file.originalname);
      // Write to /tmp for OCR pipeline (ephemeral, not uploads/)
      const tmpPath = path.join("/tmp", fileUuid);
      fs.writeFileSync(tmpPath, req.file.buffer);

      const documentData = {
        filename: fileUuid,
        originalName: processedOriginalName,
        mimeType: processedMimeType,
        size: req.file.size,
        ...documentSizeMetadata(req.file),
        s3Key,
        documentType: documentType || "other",
        loadId: loadId && loadId !== "undefined" ? parseInt(loadId, 10) : null,
        invoiceId: invoiceId && invoiceId !== "undefined" ? parseInt(invoiceId, 10) : null,
        uploadedBy: req.user.id,
        sourceChannel: sourceChannel || "manual",
        status: "processing" as const,
      };

      const document = await storage.createDocument(documentData);

      await storage.createActivity({
        userId: req.user.id,
        type: "document_uploaded",
        description: `Uploaded document: ${document.originalName}`,
        entityType: "document",
        entityId: document.id,
        metadata: buildDocumentMetadata(document),
      });

      setTimeout(async () => {
        try {
          await storage.updateDocument(document.id, { status: "processed" });
        } catch (error) {
          console.error("Error updating document status:", error);
        }
      }, 2000);

      res.status(201).json({
        ...document,
        ...buildDocumentMetadata(document),
      });
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  app.delete("/api/documents/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);

      if (Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      if (!await employeeCanModifyDocument(req, id)) return res.status(403).json({ message: "Documents can only be changed on your own draft or correction-required invoices" });

      const document = await storage.getDocument(id);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      await storage.deleteDocument(id);

      try {
        if ((document as any).s3Key) {
          await deleteFromS3((document as any).s3Key);
        } else {
          const filePath = path.join("uploads", document.filename);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      } catch (fileError) {
        console.warn("Could not delete file:", fileError);
      }

      await storage.createActivity({
        userId: req.user.id,
        type: "document_deleted",
        description: `Deleted document: ${document.originalName}`,
        entityType: "document",
        entityId: document.id,
      });

      res.json({ message: "Document deleted successfully" });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  app.get("/api/documents/:id/download", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!await employeeCanAccessDocument(req, id)) return res.status(403).json({ message: "You may only download documents for your own invoices" });
      const document = await storage.getDocument(id);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      if ((document as any).s3Key) {
        const url = await getSignedDownloadUrl((document as any).s3Key, document.originalName);
        return res.redirect(url);
      }

      // Local fallback for legacy files
      let filePath = path.resolve(process.cwd(), "uploads", document.filename);
      if (!fs.existsSync(filePath)) {
        filePath = path.resolve(process.cwd(), "uploads", `${document.filename}.pdf`);
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ message: "File not found on disk" });
        }
      }

      const stats = fs.statSync(filePath);
      res.setHeader("Content-Type", document.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${document.originalName}"`);
      res.setHeader("Content-Length", stats.size.toString());
      res.setHeader("Cache-Control", "no-cache");
      const fileStream = fs.createReadStream(filePath);
      fileStream.on("error", (error) => {
        console.error("Error streaming file:", error);
        if (!res.headersSent) res.status(500).json({ message: "Error streaming file" });
      });
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error downloading document:", error);
      res.status(500).json({ message: "Failed to download document" });
    }
  });

  app.get("/api/documents/:id/view", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!await employeeCanAccessDocument(req, id)) return res.status(403).json({ message: "You may only view documents for your own invoices" });
      const document = await storage.getDocument(id);

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      if ((document as any).s3Key) {
        const url = await getSignedViewUrl((document as any).s3Key);
        return res.redirect(url);
      }

      // Local fallback for legacy files
      let filePath = path.resolve(process.cwd(), "uploads", document.filename);
      if (!fs.existsSync(filePath)) {
        filePath = path.resolve(process.cwd(), "uploads", `${document.filename}.pdf`);
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ message: "File not found on disk" });
        }
      }

      res.setHeader("Content-Type", document.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename="${document.originalName}"`);
      const fileStream = fs.createReadStream(filePath);
      fileStream.on("error", (error) => {
        console.error("Error streaming file:", error);
        if (!res.headersSent) res.status(500).json({ message: "Error streaming file" });
      });
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error viewing document:", error);
      res.status(500).json({ message: "Failed to view document" });
    }
  });

  // Clients
  app.get("/api/client-email/config", requireModulePermission("client_email"), (_req, res) => {
    res.json({ from: SYSTEM_EMAIL_FROM, replyTo: SYSTEM_EMAIL_REPLY_TO });
  });

  app.get("/api/client-email/clients", requireModulePermission("client_email"), async (req: any, res) => {
    try {
      const rows = await db.select({ id: clients.id, name: clients.name, email: clients.email }).from(clients)
        .where(isPrivilegedUser(req) ? undefined : eq(clients.assignedProcessor, req.user.id)).orderBy(clients.name);
      res.json(rows);
    } catch {
      res.status(500).json({ message: "Could not load accessible email clients" });
    }
  });

  app.post("/api/client-email/send", requireModulePermission("client_email"), async (req: any, res) => {
    try {
      const input = clientEmailSchema.parse(req.body);
      const client = await storage.getClient(input.clientId);
      if (!client) return res.status(404).json({ message: "Client not found" });
      if (!canAccessAssignedRecord(req, client.assignedProcessor)) {
        return res.status(403).json({ message: "You can only email clients assigned to you" });
      }
      const agentName = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.name || "Staff member";
      const log = await sendClientEmail(input, client, { id: req.user.id, name: agentName });
      res.status(201).json(log);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message || "Invalid email" });
      if (error instanceof ClientEmailError) return res.status(error.statusCode).json({ message: error.message });
      // Never send if the durable pre-send log could not be written.
      res.status(503).json({ message: "The email could not be logged. Sending was not started; try again later." });
    }
  });

  app.get("/api/clients/:id/email-log", requireAuth, async (req: any, res) => {
    try {
      const clientId = z.coerce.number().int().positive().parse(req.params.id);
      const client = await storage.getClient(clientId);
      if (!client) return res.status(404).json({ message: "Client not found" });
      if (!canAccessAssignedRecord(req, client.assignedProcessor)) {
        return res.status(403).json({ message: "You can only view communications for clients assigned to you" });
      }
      res.json(await db.select().from(clientEmailLogs).where(eq(clientEmailLogs.clientId, clientId))
        .orderBy(desc(clientEmailLogs.createdAt), desc(clientEmailLogs.id)));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid client ID" });
      res.status(500).json({ message: "Could not load client email history" });
    }
  });

  app.get("/api/clients", requireAuth, async (_req: any, res) => {
    try {
      const q = typeof _req.query.q === "string" ? _req.query.q.trim() : "";
      const all = _req.query.all === "true";
      const clientSearchDocument = sql`(
        coalesce(${clients.name}, '') || ' ' ||
        coalesce(${clients.preferredName}, '') || ' ' ||
        coalesce(${clients.email}, '') || ' ' ||
        coalesce(${clients.phone}, '') || ' ' ||
        coalesce(${clients.contactPerson}, '') || ' ' ||
        coalesce(${clients.city}, '') || ' ' ||
        coalesce(${clients.state}, '') || ' ' ||
        coalesce(${clients.mcNumber}, '') || ' ' ||
        coalesce(${clients.dotNumber}, '')
      )`;
      const conditions: any[] = [];
      if (q) conditions.push(ilike(clientSearchDocument, `%${q}%`));
      if (_req.user.role === "employee" || _req.query.processor === "me") {
        conditions.push(eq(clients.assignedProcessor, _req.user.id));
      }
      const where = conditions.length ? and(...conditions) : undefined;
      if (all) {
        const rows = await db.select().from(clients).where(where).orderBy(clients.name);
        const enriched = await enrichAssignments(rows);
        return res.json(enriched.map(client => sanitizeClientResponse(client, _req.user.role)));
      }
      const { page, limit, offset } = parseListPagination(_req);
      const [{ total }] = await db.select({ total: count() }).from(clients).where(where);
      const rows = await db.select().from(clients).where(where).orderBy(clients.name).limit(limit).offset(offset);
      const enriched = await enrichAssignments(rows);
      res.json({ data: enriched.map(client => sanitizeClientResponse(client, _req.user.role)), total: Number(total), page, totalPages: Math.ceil(Number(total) / limit) });
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  app.get("/api/clients/search", requireAuth, async (req: any, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== "string") return res.status(400).json({ message: "Search query is required" });
      const results = await storage.searchClients(q);
      const visibleResults = results.filter(client => canAccessAssignedRecord(req, client.assignedProcessor));
      const enriched = await enrichAssignments(visibleResults);
      res.json(enriched.map(client => sanitizeClientResponse(client, req.user.role)));
    } catch (error) {
      console.error("Error searching clients:", error);
      res.status(500).json({ message: "Failed to search clients" });
    }
  });

  app.get("/api/clients/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid client id" });
      const client = await storage.getClient(id);
      if (!client) return res.status(404).json({ message: "Client not found" });
      if (!canAccessAssignedRecord(req, client.assignedProcessor)) return res.status(403).json({ message: "You can only access carriers assigned to you" });
      res.json(sanitizeClientResponse(await enrichClientAssignment(client), req.user.role));
    } catch (error) {
      console.error("Error fetching client:", error);
      res.status(500).json({ message: "Failed to fetch client" });
    }
  });

  app.get("/api/clients/:id/documents", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const clientId = Number(req.params.id);
      if (!Number.isInteger(clientId)) return res.status(400).json({ message: "Invalid carrier id" });
      const rows = await db.select().from(documentsTable).where(eq(documentsTable.clientId, clientId)).orderBy(desc(documentsTable.createdAt));
      res.json(rows.map(document => ({ ...document, ...buildDocumentMetadata(document) })));
    } catch (error) {
      console.error("Error fetching carrier documents:", error);
      res.status(500).json({ message: "Failed to fetch carrier documents" });
    }
  });

  app.post("/api/clients/:id/documents", requireManagerOrAdmin, handleCarrierUpload, async (req: any, res) => {
    try {
      const clientId = Number(req.params.id);
      if (!Number.isInteger(clientId)) return res.status(400).json({ message: "Invalid carrier id" });
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      if (!hasAllowedCarrierDocumentSignature(req.file)) {
        return res.status(400).json({ message: "File contents do not match an allowed PDF or image format" });
      }
      const [exists] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId)).limit(1);
      if (!exists) return res.status(404).json({ message: "Carrier not found" });
      const documentCategory = String(req.body.documentCategory || "").trim();
      if (!documentCategory) return res.status(400).json({ message: "Document category is required" });
      const fileUuid = crypto.randomUUID();
      const s3Key = await uploadDocumentToS3(req.file, `clients/${clientId}/${fileUuid}`);
      const document = await storage.createDocument({
        filename: fileUuid, originalName: sanitizeOriginalName(req.file.originalname),
        mimeType: req.file.mimetype, size: req.file.size, s3Key,
        ...documentSizeMetadata(req.file),
        documentType: "carrier_setup", clientId, loadId: null, invoiceId: null,
        documentCategory, uploadedBy: req.user.id, sourceChannel: "manual", status: "processed",
      } as any);
      await storage.createActivity({
        userId: req.user.id, type: "carrier_document_uploaded",
        description: `Uploaded ${documentCategory} for carrier ${clientId}`,
        entityType: "client", entityId: clientId, metadata: buildDocumentMetadata(document),
      } as any);
      res.status(201).json({ ...document, ...buildDocumentMetadata(document) });
    } catch (error) {
      console.error("Error uploading carrier document:", error);
      res.status(500).json({ message: "Failed to upload carrier document" });
    }
  });

  app.post("/api/clients", requireAuth, async (req: any, res) => {
    try {
      const { bankAccountNumber, abaRouting, owners = [], ...raw } = req.body;
      if (Object.prototype.hasOwnProperty.call(raw, "assignedProcessor")) {
        raw.assignedProcessor = await validateAssignedProcessor(raw.assignedProcessor);
      }
      const secureOwners = Array.isArray(owners) ? owners.slice(0, 3).map((owner: any) => ({
        ...owner, ssn: owner.ssn ? encryptVault(String(owner.ssn)) : null,
      })) : [];
      const clientData = insertClientSchema.parse({
        ...raw, owners: secureOwners,
        ...(req.user.role === "employee" ? { assignedProcessor: req.user.id } : {}),
        bankAccountEncrypted: bankAccountNumber ? encryptVault(String(bankAccountNumber)) : null,
        abaRoutingEncrypted: abaRouting ? encryptVault(String(abaRouting)) : null,
      });
      const client = await storage.createClient(clientData);

      try {
        await upsertClientMirror(client);
        await addClientActivityLog(client.id, {
          type: "client_created",
          message: `Client ${client.name} was created`,
        });
      } catch (fsErr) {
        console.error(`[FIRESTORE] sync failed for new client id=${client.id}:`, fsErr);
      }

      await storage.createActivity({
        userId: req.user.id,
        type: "client_created",
        description: `Created new client: ${client.name}`,
        entityType: "client",
        entityId: client.id,
      });

      res.status(201).json(sanitizeClientResponse(await enrichClientAssignment(client), req.user.role));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid client data",
          errors: error.errors,
        });
      }

      console.error("Error creating client:", error);
      res.status(500).json({ message: "Failed to create client" });
    }
  });

  app.get("/api/firebase-clients", requireManagerOrAdmin, async (_req: any, res) => {
    if (!firestore) {
      return res.status(503).json({ error: "Firestore not configured — FIREBASE_SERVICE_ACCOUNT not set." });
    }
    try {
      const snap = await firestore.collection("clients").get();
      const data = snap.docs.map((doc) => doc.data());
      res.json(data);
    } catch (error) {
      console.error("Failed to fetch firebase clients:", error);
      res.status(500).json({ error: "Failed to fetch firebase clients" });
    }
  });

  // Keep client updates in one handler so PUT and PATCH have identical
  // validation, redaction, encryption, authorization, and audit behavior.
  const updateClientHandler = async (req: any, res: any) => {
    try {
      const id = parseInt(req.params.id, 10);

      if (Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid client id" });
      }
      if (
        req.user?.role === "employee" &&
        Object.prototype.hasOwnProperty.call(req.body, "cargoType")
      ) {
        return res.status(403).json({ message: "Manager or admin access required to change carrier cargo type" });
      }

      const { bankAccountNumber, abaRouting, owners, ...raw } = req.body;
      const existingClient = await storage.getClient(id);
      if (!existingClient) {
        return res.status(404).json({ message: "Client not found" });
      }
      if (!canAccessAssignedRecord(req, existingClient.assignedProcessor)) {
        return res.status(403).json({ message: "You can only edit carriers assigned to you" });
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "assignedProcessor")) {
        return res.status(403).json({ message: "Use the assignment endpoint to change the assigned processor" });
      }
      const existingOwners = (existingClient?.owners as any[] | null) ?? [];
      const updatePayload = { ...raw };
      if (raw.onboardingProfile && Array.isArray(raw.onboardingProfile.messages)) {
        const existingProfile = {
          ...((existingClient.onboardingData as Record<string, any> | null) ?? {}),
          ...((existingClient.onboardingProfile as Record<string, any> | null) ?? {}),
        };
        const existingMessages = Array.isArray(existingProfile.messages) ? existingProfile.messages : [];
        const author = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.name || req.user.email || "Staff";
        const messages = raw.onboardingProfile.messages
          .filter((message: any) => typeof message?.message === "string" && message.message.trim())
          .map((message: any) => {
            const unchanged = existingMessages.find((existing: any) =>
              existing?.message === message.message &&
              existing?.author === message.author &&
              existing?.timestamp === message.timestamp
            );
            return unchanged ?? {
              message: message.message.trim(),
              author,
              timestamp: new Date().toISOString(),
            };
          });
        updatePayload.onboardingProfile = { ...raw.onboardingProfile, messages };
      }
      const secureOwners = Array.isArray(owners) ? owners.slice(0, 3).map((owner: any, index: number) => ({
        ...owner, ssn: owner.ssn ? encryptVault(String(owner.ssn)) : existingOwners[index]?.ssn ?? null,
      })) : undefined;
      const clientData = insertClientSchema.partial().parse({
        ...updatePayload,
        ...(secureOwners ? { owners: secureOwners } : {}),
        ...(bankAccountNumber ? { bankAccountEncrypted: encryptVault(String(bankAccountNumber)) } : {}),
        ...(abaRouting ? { abaRoutingEncrypted: encryptVault(String(abaRouting)) } : {}),
      });
      const client = await storage.updateClient(id, clientData);

      try {
        await upsertClientMirror(client);
        await addClientActivityLog(client.id, {
          type: "client_updated",
          message: `Client ${client.name} was updated`,
        });
      } catch (fsErr) {
        console.error(`[FIRESTORE] sync failed for updated client id=${client.id}:`, fsErr);
      }

      await storage.createActivity({
        userId: req.user.id,
        type: "client_updated",
        description: `Updated client: ${client.name}`,
        entityType: "client",
        entityId: client.id,
      });

      res.json(sanitizeClientResponse(await enrichClientAssignment(client), req.user.role));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid client data",
          errors: error.errors,
        });
      }

      console.error("Error updating client:", error);
      res.status(500).json({ message: "Failed to update client" });
    }
  };

  app.put("/api/clients/:id", requireAuth, updateClientHandler);
  app.patch("/api/clients/:id", requireAuth, updateClientHandler);

  app.patch("/api/clients/:id/assign", requireManagerOrAdmin, async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid client id" });
      const assignedProcessor = await validateAssignedProcessor(req.body?.assignedProcessor);
      const [client] = await db.update(clients).set({ assignedProcessor, updatedAt: new Date() })
        .where(eq(clients.id, id)).returning();
      if (!client) return res.status(404).json({ message: "Client not found" });
      await storage.createActivity({
        userId: req.user.id,
        type: "client_updated",
        description: `Assigned processor ${assignedProcessor ?? "unassigned"} to carrier ${client.name}`,
        entityType: "client",
        entityId: client.id,
      } as any);
      res.json(sanitizeClientResponse(await enrichClientAssignment(client), req.user.role));
    } catch (error: any) {
      if (error?.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error assigning client processor:", error);
      res.status(500).json({ message: "Failed to assign client processor" });
    }
  });

  app.delete("/api/clients/:id", requireManagerOrAdmin, async (req: any, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid client id" });
    }

    try {
      console.log(`[DELETE CLIENT] route hit for id=${id}`);

      const driverPhotos = await db.select({ photoS3Key: drivers.photoS3Key }).from(drivers).where(eq(drivers.carrierId, id));
      await Promise.all(driverPhotos.filter((driver) => driver.photoS3Key).map((driver) => deleteFromS3(driver.photoS3Key!)));
      await storage.deleteClient(id);
      console.log(`[DELETE CLIENT] Postgres delete complete for id=${id}`);

      const firestoreDeleted = await deleteClientMirror(id);
      console.log(`[DELETE CLIENT] Firestore delete result for id=${id}:`, firestoreDeleted);

      await storage.createActivity({
        userId: req.user.id,
        type: "client_deleted",
        description: `Deleted client ID: ${id}`,
        entityType: "client",
        entityId: id,
      });

      return res.json({
        message: "Client deleted successfully",
        firestoreDeleted,
      });
    } catch (error) {
      console.error(`[DELETE CLIENT] failed for id=${id}:`, error);
      return res.status(500).json({
        message: "Failed to delete client",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Loads
  app.get("/api/loads", requireAuth, async (_req: any, res) => {
    try {
      const loads = await storage.getLoads();
      res.json(loads);
    } catch (error) {
      console.error("Error fetching loads:", error);
      res.status(500).json({ message: "Failed to fetch loads" });
    }
  });

  app.get("/api/loads/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      const load = await storage.getLoad(id);
      if (!load) return res.status(404).json({ message: "Load not found" });

      // Enrich with client name and linked invoice number
      let clientName: string | null = null;
      let invoiceId: number | null = null;
      let invoiceNumber: string | null = null;

      if (load.clientId) {
        const client = await storage.getClient(load.clientId);
        clientName = client?.name ?? null;
      }

      const allInvoices = await storage.getInvoices();
      const linked = allInvoices.find((inv) => inv.loadId === id);
      if (linked) {
        invoiceId     = linked.id;
        invoiceNumber = linked.invoiceNumber;
      }

      res.json({ ...load, clientName, invoiceId, invoiceNumber });
    } catch (e) {
      res.status(500).json({ message: "Failed to fetch load" });
    }
  });

  app.post("/api/loads", requireAuth, async (req: any, res) => {
    try {
      const loadData = insertLoadSchema.parse(req.body);
      const load = await storage.createLoad(loadData);

      await storage.createActivity({
        userId: req.user.id,
        type: "load_created",
        description: `Created new load: ${load.loadNumber}`,
        entityType: "load",
        entityId: load.id,
      });

      res.status(201).json(load);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid load data", errors: error.errors });
      }
      console.error("Error creating load:", error);
      res.status(500).json({ message: "Failed to create load" });
    }
  });

  // Invoices
  // ─── Held Queue ──────────────────────────────────────────────────────────────
  app.get("/api/held", requireAuth, async (_req: any, res) => {
    try {
      const held = await storage.getHeldInvoices();
      // Enrich with client/broker names by joining the full invoice detail
      const enriched = await Promise.all(held.map(async (inv) => {
        try {
          const client = inv.clientId ? await storage.getClient(inv.clientId) : null;
          const broker = inv.brokerId
            ? (await db.select({ name: brokers.name }).from(brokers).where(eq(brokers.id, inv.brokerId)).limit(1))[0]
            : (inv.debtorId ? await storage.getDebtor(inv.debtorId) : null);
          return {
            ...inv,
            clientName: client?.name ?? null,
            brokerName: broker?.name ?? null,
          };
        } catch { return inv; }
      }));
      res.json(enriched);
    } catch (e) { res.status(500).json({ message: "Failed to fetch held invoices" }); }
  });

  app.post("/api/invoices/:id/hold", requireAuth, async (req: any, res) => {
    try {
      if (req.user.role !== "manager" && req.user.role !== "admin") {
        return res.status(403).json({ message: "Manager or admin access required" });
      }
      const invoiceId = Number(req.params.id);
      if (!Number.isInteger(invoiceId) || invoiceId <= 0) return res.status(400).json({ message: "Invalid invoice ID" });
      const { reason, notes } = req.body as { reason: string; notes?: string };
      if (!reason?.trim()) return res.status(400).json({ message: "Hold reason is required" });
      const allowedHoldStatuses = ["submitted", "docs_pending", "under_review", "approved"] as const;
      const outcome = await db.transaction(async (tx) => {
        const [existing] = await tx.select({ id: invoices.id, status: invoices.status })
          .from(invoices).where(eq(invoices.id, invoiceId));
        if (!existing) return { kind: "not_found" as const };
        if (!allowedHoldStatuses.includes(existing.status as typeof allowedHoldStatuses[number])) {
          return { kind: "conflict" as const, status: existing.status };
        }
        const heldAt = new Date();
        const [updated] = await tx.update(invoices).set({
          previousStatus: existing.status,
          status: "held",
          heldReason: reason.trim(),
          heldAt,
          heldBy: req.user.id,
          heldNotes: notes ?? null,
          updatedAt: heldAt,
        }).where(and(
          eq(invoices.id, invoiceId),
          inArray(invoices.status, [...allowedHoldStatuses]),
        )).returning();
        if (!updated) return { kind: "conflict" as const, status: existing.status };
        const previousStatus = updated.previousStatus ?? existing.status;
        await tx.insert(eventLedger).values({
          entityType: "invoice",
          entityId: invoiceId,
          eventType: "invoice_status_changed",
          actorType: "user",
          actorId: req.user.id,
          payloadJson: {
            from: previousStatus,
            to: "held",
            reason: reason.trim(),
            label: "Invoice placed on hold",
          },
        });
        return { kind: "updated" as const, invoice: updated };
      });
      if (outcome.kind === "not_found") return res.status(404).json({ message: "Invoice not found" });
      if (outcome.kind === "conflict") return res.status(409).json({ message: `Invoices in ${outcome.status} status cannot be placed on hold` });
      res.json(outcome.invoice);
    } catch (e: any) { res.status(500).json({ message: e.message ?? "Failed to hold invoice" }); }
  });

  app.post("/api/invoices/:id/release", requireAuth, async (req: any, res) => {
    try {
      if (req.user.role !== "manager" && req.user.role !== "admin") {
        return res.status(403).json({ message: "Manager or admin access required" });
      }
      const { releaseNote } = req.body as { releaseNote?: string };
      const inv = await storage.releaseInvoice(Number(req.params.id), req.user.id, releaseNote);
      res.json(inv);
    } catch (e: any) { res.status(500).json({ message: e.message ?? "Failed to release invoice" }); }
  });

  app.post("/api/invoices/preflight", requireAuth, async (req: any, res) => {
    try {
      const input = z.object({
        carrierId: z.coerce.number().int().positive(),
        brokerId: z.coerce.number().int().positive().optional(),
        invoiceNumber: z.string().trim().max(100).optional(),
        loadNumber: z.string().trim().optional(),
        amount: z.coerce.number().nonnegative().optional(),
        serviceDate: z.union([z.string(), z.date()]).optional(),
        excludeInvoiceId: z.coerce.number().int().positive().optional(),
        ocrDocumentIds: z.array(z.number().int().positive()).max(8).optional(),
      }).parse(req.body);
      if (!(await canAccessClient(req, input.carrierId))) {
        return res.status(403).json({ message: "You may only preflight invoices for carriers assigned to you" });
      }
      if (input.brokerId != null && !(await canAccessBroker(req, input.brokerId))) {
        return res.status(403).json({ message: "You may only preflight invoices for brokers assigned to you" });
      }
      const { alerts } = await runPreflightForInvoice({ ...input, ocrActor: req.user });
      const matchingInvoiceIds = alerts
        .map((alert: any) => Number(alert.invoiceId ?? alert.link?.match(/^\/invoices\/(\d+)$/)?.[1]))
        .filter((id: number) => Number.isInteger(id) && id > 0);
      const matchingInvoices = matchingInvoiceIds.length
        ? await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
          .from(invoices).where(and(
            inArray(invoices.id, Array.from(new Set(matchingInvoiceIds))),
            eq(invoices.clientId, input.carrierId),
            req.user.role === "employee" ? eq(invoices.submittedBy, req.user.id) : undefined,
          ))
        : [];
      const matchingInvoiceNumbers = new Map(matchingInvoices.map(invoice => [invoice.id, invoice.invoiceNumber] as const));
      res.json({
        alerts: alerts.map((alert: any) => {
          const invoiceId = Number(alert.invoiceId ?? alert.link?.match(/^\/invoices\/(\d+)$/)?.[1]);
          return matchingInvoiceNumbers.has(invoiceId)
            ? { ...alert, invoiceId, invoiceNumber: matchingInvoiceNumbers.get(invoiceId) }
            : alert;
        }),
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid preflight data", errors: error.errors });
      if (error instanceof IntakeError) return res.status(error.status).json({ message: error.message });
      console.error("Invoice preflight failed:", error);
      res.status(500).json({ message: "Failed to run invoice preflight" });
    }
  });

  app.get("/api/invoices/:id/preflight", requireAuth, async (req: any, res) => {
    try {
      const invoiceId = Number(req.params.id);
      if (!Number.isInteger(invoiceId) || invoiceId < 1) return res.status(400).json({ message: "Invalid invoice id" });
      const invoice = await storage.getInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      if (!await employeeCanAccessInvoice(req, invoiceId)) {
        return res.status(403).json({ message: "You may only view your own submitted invoices" });
      }
      const { alerts } = await runPreflightForInvoice({
        carrierId: invoice.clientId,
        brokerId: invoice.brokerId,
        invoiceNumber: invoice.carrierInvoiceNumber,
        loadNumber: invoice.loadNumber,
        amount: Number(invoice.amount),
        serviceDate: invoice.invoiceDate,
        excludeInvoiceId: invoice.id,
      });
      res.json({ alerts });
    } catch (error) {
      console.error("Invoice preflight review failed:", error);
      res.status(500).json({ message: "Failed to review invoice preflight" });
    }
  });

  app.get("/api/invoices/:id/ocr-alerts", requireAuth, async (req: any, res) => {
    try {
      const invoiceId = Number(req.params.id);
      if (!Number.isInteger(invoiceId) || invoiceId < 1) return res.status(400).json({ message: "Invalid invoice id" });
      if (!await storage.getInvoice(invoiceId)) return res.status(404).json({ message: "Invoice not found" });
      if (!await employeeCanAccessInvoice(req, invoiceId)) {
        return res.status(403).json({ message: "You may only view your own invoice documents" });
      }
      res.json({ alerts: await getInvoiceOcrAlerts(invoiceId) });
    } catch (error) {
      res.status(500).json({ message: "Failed to load document OCR alerts" });
    }
  });

  app.get("/api/preflight/alerts", requireManagerOrAdmin, async (_req: any, res) => {
    try {
      const result = await db.execute(sql`SELECT * FROM carrier_alerts ORDER BY created_at DESC`);
      res.json(result.rows);
    } catch (error) {
      console.error("Failed to list preflight alerts:", error);
      res.status(500).json({ message: "Failed to list preflight alerts" });
    }
  });

  app.post("/api/preflight/alerts", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const input = z.object({
        entityType: z.enum(["carrier", "broker"]),
        entityId: z.coerce.number().int().positive(),
        severity: z.enum(["block", "ack", "info"]),
        title: z.string().trim().min(1).max(255),
        message: z.string().trim().min(1).max(10000),
        active: z.boolean().optional(),
        expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
      }).parse(req.body);
      const result = await db.execute(sql`
        INSERT INTO carrier_alerts (entity_type, entity_id, severity, title, message, active, created_by, expires_at)
        VALUES (${input.entityType}, ${input.entityId}, ${input.severity}, ${input.title}, ${input.message}, ${input.active ?? true}, ${req.user.id}, ${input.expiresAt ? new Date(input.expiresAt) : null})
        RETURNING *
      `);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid alert data", errors: error.errors });
      console.error("Failed to create preflight alert:", error);
      res.status(500).json({ message: "Failed to create preflight alert" });
    }
  });

  const patchPreflightAlert = async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid alert id" });
      const input = z.object({
        severity: z.enum(["block", "ack", "info"]).optional(),
        title: z.string().trim().min(1).max(255).optional(),
        message: z.string().trim().min(1).max(10000).optional(),
        active: z.boolean().optional(),
        expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
      }).refine((value) => Object.keys(value).length > 0, "At least one field is required").parse(req.body);
      const result = await db.execute(sql`
        UPDATE carrier_alerts SET
          severity = COALESCE(${input.severity ?? null}, severity),
          title = COALESCE(${input.title ?? null}, title),
          message = COALESCE(${input.message ?? null}, message),
          active = COALESCE(${input.active ?? null}, active),
          expires_at = CASE WHEN ${Object.prototype.hasOwnProperty.call(input, "expiresAt")} THEN ${input.expiresAt ? new Date(input.expiresAt) : null} ELSE expires_at END
        WHERE id = ${id}
        RETURNING *
      `);
      if (!result.rows[0]) return res.status(404).json({ message: "Preflight alert not found" });
      res.json(result.rows[0]);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid alert data", errors: error.errors });
      console.error("Failed to update preflight alert:", error);
      res.status(500).json({ message: "Failed to update preflight alert" });
    }
  };
  app.patch("/api/preflight/alerts/:id", requireManagerOrAdmin, patchPreflightAlert);
  app.patch("/api/preflight/alerts", requireManagerOrAdmin, (req: any, res: any, next: any) => {
    req.params.id = String(req.body?.id ?? req.body?.alertId ?? "");
    next();
  }, patchPreflightAlert);

  app.get("/api/invoices/preflight/settings", requireAuth, async (_req: any, res) => {
    try {
      const result = await db.execute(sql`SELECT rules, dormant_days, near_amount_tolerance, near_service_date_days FROM invoice_preflight_settings LIMIT 1`);
      const row: any = result.rows[0];
      res.json(row ? {
        rules: row.rules,
        dormantDays: Number(row.dormant_days),
        nearAmountTolerance: Number(row.near_amount_tolerance),
        nearServiceDateDays: Number(row.near_service_date_days),
      } : {
        rules: {
          DUPLICATE_EXACT: true, DUPLICATE_NEAR: true, CARRIER_DORMANT: true,
          CARRIER_MANUAL_ALERT: true, BROKER_MANUAL_ALERT: true, BROKER_GRADE_LOW: true,
          BROKER_CHARGEBACKS: true, AUTHORITY_INACTIVE: true, DOCS_EXPIRED: true,
          CARRIER_OPEN_CHARGEBACK: true,
        },
        dormantDays: 45,
        nearAmountTolerance: 1,
        nearServiceDateDays: 3,
      });
    } catch (error) {
      console.error("Failed to load preflight settings:", error);
      res.status(500).json({ message: "Failed to load preflight settings" });
    }
  });

  app.patch("/api/invoices/preflight/settings", requireAdmin, async (req: any, res) => {
    try {
      const input = z.object({
        rules: z.record(z.boolean()).optional(),
        dormantDays: z.number().int().positive().optional(),
        nearAmountTolerance: z.number().nonnegative().optional(),
        nearServiceDateDays: z.number().int().nonnegative().optional(),
      }).refine((value) => Object.keys(value).length > 0, "At least one setting is required").parse(req.body);
      const currentResult = await db.execute(sql`SELECT rules, dormant_days, near_amount_tolerance, near_service_date_days FROM invoice_preflight_settings LIMIT 1`);
      const current: any = currentResult.rows[0];
      const allRules = {
        DUPLICATE_EXACT: true,
        DUPLICATE_NEAR: true,
        CARRIER_DORMANT: true,
        CARRIER_MANUAL_ALERT: true,
        BROKER_MANUAL_ALERT: true,
        BROKER_GRADE_LOW: true,
        BROKER_CHARGEBACKS: true,
        AUTHORITY_INACTIVE: true,
        DOCS_EXPIRED: true,
        CARRIER_OPEN_CHARGEBACK: true,
      };
      const settings = {
        rules: { ...allRules, ...(current?.rules ?? {}), ...(input.rules ?? {}) },
        dormantDays: input.dormantDays ?? Number(current?.dormant_days ?? 45),
        nearAmountTolerance: input.nearAmountTolerance ?? Number(current?.near_amount_tolerance ?? 1),
        nearServiceDateDays: input.nearServiceDateDays ?? Number(current?.near_service_date_days ?? 3),
      };
      const result = await db.execute(sql`
        INSERT INTO invoice_preflight_settings (id, rules, dormant_days, near_amount_tolerance, near_service_date_days, updated_by, updated_at)
        VALUES (1, ${JSON.stringify(settings.rules)}::jsonb, ${settings.dormantDays}, ${settings.nearAmountTolerance}, ${settings.nearServiceDateDays}, ${req.user.id}, NOW())
        ON CONFLICT (id) DO UPDATE SET
          rules = EXCLUDED.rules,
          dormant_days = EXCLUDED.dormant_days,
          near_amount_tolerance = EXCLUDED.near_amount_tolerance,
          near_service_date_days = EXCLUDED.near_service_date_days,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
        RETURNING rules, dormant_days, near_amount_tolerance, near_service_date_days
      `);
      const row: any = result.rows[0];
      res.json({ rules: row.rules, dormantDays: Number(row.dormant_days), nearAmountTolerance: Number(row.near_amount_tolerance), nearServiceDateDays: Number(row.near_service_date_days) });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid preflight settings", errors: error.errors });
      console.error("Failed to save preflight settings:", error);
      res.status(500).json({ message: "Failed to save preflight settings" });
    }
  });

  app.get("/api/invoices", requireAuth, async (req: any, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const all = req.query.all === "true";
      if (req.query.loadType !== undefined && typeof req.query.loadType !== "string") {
        return res.status(400).json({ message: "Invalid load type filter" });
      }
      const loadType = typeof req.query.loadType === "string" ? req.query.loadType.trim() : "";
      if (loadType && !(LOAD_TYPES as readonly string[]).includes(loadType)) {
        return res.status(400).json({ message: "Invalid load type filter" });
      }
      const scope = req.user.role === "employee" ? eq(invoices.submittedBy, req.user.id) : undefined;
      const invoiceSearchDocument = sql`(
        coalesce(${invoices.invoiceNumber}, '') || ' ' ||
        coalesce(${invoices.loadNumber}, '') || ' ' ||
        coalesce(${invoices.code}, '') || ' ' ||
        coalesce(${invoices.branchName}, '') || ' ' ||
        coalesce(${invoices.bolNumber}, '') || ' ' ||
        coalesce(${invoices.status}, '')
      )`;
      const invoiceCarrierSearchDocument = sql`(
        coalesce(${clients.name}, '') || ' ' ||
        coalesce(${clients.preferredName}, '') || ' ' ||
        coalesce(${clients.email}, '') || ' ' ||
        coalesce(${clients.phone}, '') || ' ' ||
        coalesce(${clients.contactPerson}, '') || ' ' ||
        coalesce(${clients.city}, '') || ' ' ||
        coalesce(${clients.state}, '') || ' ' ||
        coalesce(${clients.mcNumber}, '') || ' ' ||
        coalesce(${clients.dotNumber}, '')
      )`;
      const invoiceBrokerSearchDocument = sql`(
        coalesce(${brokers.name}, '') || ' ' ||
        coalesce(${brokers.contactPerson}, '') || ' ' ||
        coalesce(${brokers.email}, '')
      )`;
      const search = q ? or(
        ilike(invoiceSearchDocument, `%${q}%`), ilike(invoiceCarrierSearchDocument, `%${q}%`),
        ilike(invoiceBrokerSearchDocument, `%${q}%`),
      ) : undefined;
      let where = scope && search ? and(scope, search) : scope || search;
      if (loadType) {
        const loadTypeCondition = loadType === "other"
          ? or(eq(invoices.loadType, "other"), isNull(invoices.loadType))
          : eq(invoices.loadType, loadType as (typeof LOAD_TYPES)[number]);
        where = where ? and(where, loadTypeCondition) : loadTypeCondition;
      }
      const query = db.select({
        invoice: invoices,
        carrierName: clients.name,
        brokerName: brokers.name,
      }).from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .leftJoin(brokers, eq(invoices.brokerId, brokers.id))
        .where(where)
        .orderBy(desc(invoices.createdAt));
      if (all) {
        const rows = await query;
        return res.json(rows.map(({ invoice, carrierName, brokerName }) => ({
          ...withInvoiceDisplayStatus(invoice),
          carrierName,
          brokerName,
        })));
      }
      const { page, limit, offset } = parseListPagination(req);
      const [{ total }] = await db.select({ total: count() }).from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .leftJoin(brokers, eq(invoices.brokerId, brokers.id)).where(where);
      const rows = await query.limit(limit).offset(offset);
      const data = rows.map(({ invoice, carrierName, brokerName }) => ({
        ...withInvoiceDisplayStatus(invoice),
        carrierName,
        brokerName,
      }));
      res.json({ data, total: Number(total), page, totalPages: Math.ceil(Number(total) / limit) });
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  app.post("/api/invoices/with-documents", requireAuth, handleInvoicePaperworkUpload, async (req: any, res) => {
    const uploadedKeys: string[] = [];
    let transactionCommitted = false;
    try {
      const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
      const rateConfirmation = files.rateConfirmation?.[0];
      const billOfLading = files.billOfLading?.[0];
      if (!rateConfirmation || !billOfLading) {
        return res.status(400).json({ message: "Rate Confirmation and Bill of Lading are required." });
      }

      const allFiles = Object.values(files).flat();
      for (const file of allFiles) {
        const isPdf = file.mimetype.toLowerCase() === "application/pdf"
          && path.extname(file.originalname).toLowerCase() === ".pdf"
          && file.buffer.length >= 5
          && file.buffer.subarray(0, 5).toString("ascii") === "%PDF-";
        if (!isPdf) {
          return res.status(400).json({ message: `Invalid PDF paperwork file: ${sanitizeOriginalName(file.originalname)}` });
        }
      }

      let metadata: Record<string, any>;
      try {
        metadata = JSON.parse(String(req.body?.metadata ?? "{}"));
      } catch {
        return res.status(400).json({ message: "metadata must be valid JSON." });
      }
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return res.status(400).json({ message: "metadata must be a JSON object." });
      }

      const suppliedCarrierInvoiceNumber = z.string().trim().min(1, "Invoice number cannot be blank").max(100, "Invoice number must be 100 characters or fewer")
        .optional().parse(metadata.carrierInvoiceNumber ?? metadata.invoiceNumber);
      const { invoiceNumber: _legacyInvoiceNumber, carrierInvoiceNumber: _carrierInvoiceNumber, ...invoiceMetadata } = metadata;
      const parsed = insertInvoiceSchema.extend({
        invoiceNumber: z.string().trim().min(1).max(100),
        invoiceDate: z.preprocess(value => value == null || value === "" ? undefined : value, z.coerce.date().optional()),
        carrierInvoiceNumber: z.string().trim().max(100).nullable().optional(),
        loadType: z.enum(LOAD_TYPES),
        amount: z.coerce.number().positive("Amount must be greater than zero"),
        clientId: z.coerce.number().int().positive(),
        brokerId: z.coerce.number().int().positive(),
        branchId: z.coerce.number().int().positive(),
        driverId: z.coerce.number().int().positive().nullable().optional(),
        driverName: z.string().trim().max(255).nullable().optional(),
        bankAccountId: z.coerce.number().int().positive().nullable().optional(),
        code: z.string().trim().max(255).nullable().optional(),
        lumper: z.coerce.boolean().nullable().optional(),
        instructionsSubject: z.string().trim().max(255).nullable().optional(),
        instructionsDetails: z.string().trim().max(10000).nullable().optional(),
        paymentType: z.enum(["ACH", "Wire"]).optional(),
      }).parse({ ...invoiceMetadata, invoiceNumber: "INV000", carrierInvoiceNumber: suppliedCarrierInvoiceNumber ?? null });
      const invoiceData = await resolveInvoiceBrokerBranch(parsed as any);
      const invoiceServiceDate = invoiceData.invoiceDate ?? new Date();
      const ocrDocumentIds = parseIntakeIds(metadata.ocrDocumentIds);
      const intakeServiceDate = metadata.serviceDate == null ? undefined :
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(metadata.serviceDate);
      const intakeSnapshot = ocrDocumentIds.length ? await getIntakeSnapshot(ocrDocumentIds, req.user) : null;
      if (intakeSnapshot && intakeSnapshot.status !== "completed") {
        throw new IntakeError(intakeSnapshot.error || "Wait for all intake documents to finish extraction", 409);
      }
      const reusedPaperwork = reusableIntakePaperwork(files, intakeSnapshot?.documents ?? []);

      const [carrier] = await db.select({ id: clients.id, status: clients.status })
        .from(clients).where(eq(clients.id, invoiceData.clientId)).limit(1);
      if (!carrier) return res.status(400).json({ message: "Carrier not found." });
      if (carrier.status !== "active") return res.status(400).json({ message: "Carrier is not active." });
      if (!(await canAccessClient(req, invoiceData.clientId))) {
        return res.status(403).json({ message: "You may only create invoices for carriers assigned to you" });
      }
      if (invoiceData.brokerId != null && !(await canAccessBroker(req, invoiceData.brokerId))) {
        return res.status(403).json({ message: "You may only create invoices for brokers assigned to you" });
      }

      if (invoiceData.driverId != null) {
        const [driver] = await db.select({ id: drivers.id, carrierId: drivers.carrierId, status: drivers.status })
          .from(drivers).where(eq(drivers.id, invoiceData.driverId)).limit(1);
        if (!driver || driver.status !== "active" || driver.carrierId !== invoiceData.clientId) {
          return res.status(400).json({ message: "The selected driver is not available for this carrier." });
        }
      }
      if (invoiceData.bankAccountId != null) {
        const account = await storage.getVaultEntry(invoiceData.bankAccountId);
        if (!account || account.clientId !== invoiceData.clientId || account.dataType !== "bank_account" || !account.isActive) {
          return res.status(400).json({ message: "The selected bank account is not available for this carrier." });
        }
      }

      const acknowledgements = metadata.acknowledgements ?? [];
      const nearOverride = metadata.overrideNearDuplicate === true;
      const preflightResult = await runPreflightForInvoice({
        carrierId: invoiceData.clientId,
        brokerId: invoiceData.brokerId,
        invoiceNumber: suppliedCarrierInvoiceNumber,
        loadNumber: invoiceData.loadNumber,
        amount: invoiceData.amount,
        serviceDate: ocrDocumentIds.length ? intakeServiceDate : invoiceServiceDate,
        ocrDocumentIds, ocrActor: req.user,
      });
      const preflightDecision = getPreflightDecision(preflightResult.alerts, acknowledgements, req.user, nearOverride);
      if (preflightDecision.invalidAcknowledgements) return res.status(400).json({ message: "Acknowledgements must contain only unique alert codes requiring acknowledgement, with optional text reasons." });
      if (!preflightDecision.accepted) return res.status(409).json({ message: "Invoice preflight requires attention", alerts: preflightResult.alerts });

      const paperwork: Array<{ field: string; type: "rate_confirmation" | "bill_of_lading" | "lumper_receipt" | "other" }> = [
        { field: "rateConfirmation", type: "rate_confirmation" },
        { field: "billOfLading", type: "bill_of_lading" },
        { field: "lumperReceipt", type: "lumper_receipt" },
        { field: "other", type: "other" },
      ];
      const intakeKeyPrefix = crypto.randomUUID();
      const uploadedDocuments: Array<Record<string, any>> = [];
      for (const { field, type } of paperwork) {
        const file = files[field]?.[0];
        if (!file) continue;
        if (reusedPaperwork.has(field)) continue;
        const filename = `${type}-${crypto.randomUUID()}.pdf`;
        const s3Key = `invoices/intake/${intakeKeyPrefix}/paperwork/${filename}`;
        uploadedKeys.push(s3Key);
        await uploadDocumentToS3(file, s3Key);
        uploadedDocuments.push({
          filename,
          originalName: sanitizeOriginalName(file.originalname),
          mimeType: "application/pdf",
          size: file.size,
          ...documentSizeMetadata(file),
          s3Key,
          documentType: type,
          finalDocumentType: type,
          loadId: null,
          uploadedBy: req.user.id,
          sourceChannel: metadata.sourceChannel === "manual" ? "manual" : "drag_drop",
          status: "processed",
        });
      }

      const {
        status, factoringStage, submittedBy, submittedAt, approvedBy, approvedAt,
        fundedAt, heldReason, heldAt, heldBy, heldNotes, previousStatus,
        ...draftData
      } = invoiceData as any;
      const committed = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(92734012)`);
        const invoiceNumber = await getNextInvoiceNumberInTransaction(tx);
        const transactionalPreflight = await runPreflightForInvoice({
          carrierId: invoiceData.clientId,
          brokerId: invoiceData.brokerId,
          invoiceNumber: suppliedCarrierInvoiceNumber,
          loadNumber: invoiceData.loadNumber,
          amount: invoiceData.amount,
          serviceDate: ocrDocumentIds.length ? intakeServiceDate : invoiceServiceDate,
          ocrDocumentIds, ocrActor: req.user,
        }, tx);
        const transactionalDecision = getPreflightDecision(transactionalPreflight.alerts, metadata.acknowledgements ?? [], req.user, metadata.overrideNearDuplicate === true);
        if (transactionalDecision.invalidAcknowledgements || !transactionalDecision.accepted) {
          throw Object.assign(new Error("Invoice preflight changed before creation; review the current alerts and try again."), {
            status: 409,
            preflightAlerts: transactionalPreflight.alerts,
          });
        }
        const [invoice] = await tx.insert(invoices).values({
          ...draftData,
          invoiceNumber,
          invoiceDate: invoiceServiceDate,
          loadId: null,
          submittedBy: req.user.id,
          submittedAt: new Date(),
          status: "submitted",
          factoringStage: "verification",
        }).returning();
        await tx.insert(eventLedger).values({
          entityType: "invoice",
          entityId: invoice.id,
          eventType: "invoice.created",
          actorType: "user",
          actorId: req.user.id,
          payloadJson: {
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            clientId: invoice.clientId,
            brokerId: invoice.brokerId,
            amount: invoice.amount,
          },
        });
        const documents = uploadedDocuments.length ? await tx.insert(documentsTable).values(
          uploadedDocuments.map((document) => ({ ...document, invoiceId: invoice.id })) as any,
        ).returning() : [];
        if (ocrDocumentIds.length) {
          const lockedSnapshot = await getIntakeSnapshot(ocrDocumentIds, req.user, tx);
          if (lockedSnapshot.documents.some(doc => doc.invoiceId != null)) throw new IntakeError("Intake paperwork was already used by another invoice", 409);
          const attached = await tx.update(documentsTable).set({ invoiceId: invoice.id, clientId: invoice.clientId })
            .where(and(inArray(documentsTable.id, ocrDocumentIds), isNull(documentsTable.invoiceId))).returning();
          if (attached.length !== ocrDocumentIds.length) throw new IntakeError("Intake paperwork changed before submission", 409);
          documents.push(...attached);
        }
        await recordInvoicePreflight(invoice.id, req.user.id, transactionalPreflight.alerts, transactionalDecision.acknowledgements, transactionalDecision.nearOverride, tx);
        return { invoice, documents };
      });
      transactionCommitted = true;
      const readiness = await refreshInvoiceDocumentRequirements(committed.invoice.id);
      if (readiness.advanced) {
        committed.invoice.status = "under_review";
        committed.invoice.factoringStage = "verification";
      }
      return res.status(201).json({
        ...withInvoiceDisplayStatus(committed.invoice),
        documents: committed.documents.map((document) => ({
          id: document.id,
          documentType: document.documentType,
          finalDocumentType: document.finalDocumentType,
          originalName: document.originalName,
          size: document.size,
          originalSize: document.originalSize,
          compressedSize: document.compressedSize,
        })),
      });
    } catch (error) {
      // Any relational failure above has already been rolled back by the
      // transaction. Cleanup happens only after that rollback completes.
      if (!transactionCommitted) {
        await Promise.all(uploadedKeys.map((key) => cleanupS3KeyWithRetry(key, "invoice intake compensation")));
      }
      if ((error as any)?.status === 409) return res.status(409).json({ message: (error as Error).message, alerts: (error as any)?.preflightAlerts ?? [] });
      if ((error as any)?.status === 400) return res.status(400).json({ message: (error as Error).message });
      if (error instanceof IntakeError) return res.status(error.status).json({ message: error.message });
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid invoice data", errors: error.errors });
      if ((error as any)?.code === "23505") return res.status(409).json({ message: "Invoice number or load number has already been used.", alerts: [] });
      console.error("Error creating invoice with paperwork:", error);
      return res.status(500).json({ message: "Failed to create invoice with paperwork." });
    }
  });

  app.post("/api/invoices", requireAuth, async (req: any, res) => {
    try {
      const suppliedCarrierInvoiceNumber = z.string().trim().min(1, "Invoice number cannot be blank").max(100, "Invoice number must be 100 characters or fewer")
        .optional().parse(req.body?.carrierInvoiceNumber ?? req.body?.invoiceNumber);
      const { invoiceNumber: _legacyInvoiceNumber, carrierInvoiceNumber: _carrierInvoiceNumber, ...invoiceBody } = req.body ?? {};
      const invoiceData = await resolveInvoiceBrokerBranch(
        insertInvoiceSchema.extend({
          invoiceNumber: z.string().trim().min(1).max(100),
          carrierInvoiceNumber: z.string().trim().max(100).nullable().optional(),
          loadType: z.enum(LOAD_TYPES),
        }).parse({ ...invoiceBody, invoiceNumber: "INV000", carrierInvoiceNumber: suppliedCarrierInvoiceNumber ?? null }) as any,
      );
      const invoiceServiceDate = invoiceData.invoiceDate ?? new Date();
      if (!(await canAccessClient(req, invoiceData.clientId))) {
        return res.status(403).json({ message: "You may only create invoices for carriers assigned to you" });
      }
      if (invoiceData.brokerId != null && !(await canAccessBroker(req, invoiceData.brokerId))) {
        return res.status(403).json({ message: "You may only create invoices for brokers assigned to you" });
      }
      const preflightResult = await runPreflightForInvoice({
        carrierId: invoiceData.clientId,
        brokerId: invoiceData.brokerId,
        invoiceNumber: suppliedCarrierInvoiceNumber,
        loadNumber: invoiceData.loadNumber,
        amount: invoiceData.amount,
        serviceDate: invoiceServiceDate,
      });
      const preflightDecision = getPreflightDecision(preflightResult.alerts, req.body?.acknowledgements, req.user, req.body?.overrideNearDuplicate === true);
      if (preflightDecision.invalidAcknowledgements) return res.status(400).json({ message: "Acknowledgements must contain only unique alert codes requiring acknowledgement, with optional text reasons." });
      if (!preflightDecision.accepted) return res.status(409).json({ message: "Invoice preflight requires attention", alerts: preflightResult.alerts });
      const {
        status, factoringStage, submittedBy, submittedAt, approvedBy, approvedAt,
        fundedAt, heldReason, heldAt, heldBy, heldNotes, previousStatus,
        ...draftData
      } = invoiceData as any;
      const invoice = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(92734012)`);
        const invoiceNumber = await getNextInvoiceNumberInTransaction(tx);
        const transactionalPreflight = await runPreflightForInvoice({
          carrierId: invoiceData.clientId,
          brokerId: invoiceData.brokerId,
          invoiceNumber: suppliedCarrierInvoiceNumber,
          loadNumber: invoiceData.loadNumber,
          amount: invoiceData.amount,
          serviceDate: invoiceServiceDate,
        }, tx);
        const transactionalDecision = getPreflightDecision(transactionalPreflight.alerts, req.body?.acknowledgements, req.user, req.body?.overrideNearDuplicate === true);
        if (transactionalDecision.invalidAcknowledgements || !transactionalDecision.accepted) {
          throw Object.assign(new Error("Invoice preflight changed before creation; review the current alerts and try again."), {
            status: 409,
            preflightAlerts: transactionalPreflight.alerts,
          });
        }
        const [createdInvoice] = await tx.insert(invoices).values({
          ...draftData,
          invoiceNumber,
          invoiceDate: invoiceServiceDate,
          loadId: null,
          submittedBy: req.user.id,
          submittedAt: new Date(),
          status: "submitted",
          factoringStage: "verification",
        }).returning();
        await tx.insert(eventLedger).values({
          entityType: "invoice",
          entityId: createdInvoice.id,
          eventType: "invoice.created",
          actorType: "user",
          actorId: req.user.id,
          payloadJson: {
            invoiceNumber: createdInvoice.invoiceNumber,
            status: createdInvoice.status,
            clientId: createdInvoice.clientId,
            debtorId: createdInvoice.debtorId,
            amount: createdInvoice.amount,
          },
        });
        await recordInvoicePreflight(createdInvoice.id, req.user.id, transactionalPreflight.alerts, transactionalDecision.acknowledgements, transactionalDecision.nearOverride, tx);
        return createdInvoice;
      });
      res.status(201).json(withInvoiceDisplayStatus(invoice));
    } catch (error) {
      if ((error as any)?.status === 409) return res.status(409).json({ message: (error as Error).message, alerts: (error as any)?.preflightAlerts ?? [] });
      if ((error as any)?.status === 400) return res.status(400).json({ message: (error as Error).message });
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid invoice data", errors: error.errors });
      }
      if ((error as any)?.code === "23505") return res.status(409).json({ message: "Invoice number or load number has already been used.", alerts: [] });
      console.error("Error creating invoice:", error);
      res.status(500).json({ message: "Failed to create invoice" });
    }
  });

  // ─── Funding queue: actionable review and approved invoices ───────────────
  app.get("/api/invoices/funding/queue", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const allowedStatuses = ["submitted", "docs_pending", "under_review", "approved", "held", "rejected", "funded"] as const;
      const requestedStatuses = typeof req.query.status === "string" && req.query.status.trim()
        ? req.query.status.split(",").map((value: string) => value.trim()).filter(Boolean)
        : ["submitted", "docs_pending", "under_review", "approved"];
      if (!requestedStatuses.length || requestedStatuses.some((status: string) => !(allowedStatuses as readonly string[]).includes(status))) {
        return res.status(400).json({ message: "Invalid funding queue status filter" });
      }
      const loadType = typeof req.query.loadType === "string" && req.query.loadType !== "all" ? req.query.loadType : undefined;
      if (loadType && !(LOAD_TYPES as readonly string[]).includes(loadType)) {
        return res.status(400).json({ message: "Invalid load type filter" });
      }
      const paymentType = typeof req.query.paymentType === "string" && req.query.paymentType !== "all" ? req.query.paymentType : undefined;
      if (paymentType && !["ACH", "Wire", "ach", "wire"].includes(paymentType)) {
        return res.status(400).json({ message: "Invalid payment type filter" });
      }
      const parseId = (value: unknown, name: string) => {
        if (value === undefined || value === "" || value === "all") return undefined;
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${name} filter`);
        return parsed;
      };
      let carrierId: number | undefined;
      let brokerId: number | undefined;
      try {
        carrierId = parseId(req.query.carrierId, "carrier");
        brokerId = parseId(req.query.brokerId, "broker");
      } catch (error) {
        return res.status(400).json({ message: error instanceof Error ? error.message : "Invalid entity filter" });
      }
      const page = Math.max(1, Number(req.query.page ?? 1));
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 100)));
      if (!Number.isInteger(page) || !Number.isInteger(pageSize)) return res.status(400).json({ message: "Invalid pagination" });
      const dateFrom = typeof req.query.dateFrom === "string" && req.query.dateFrom ? new Date(`${req.query.dateFrom}T00:00:00.000Z`) : undefined;
      const dateTo = typeof req.query.dateTo === "string" && req.query.dateTo ? new Date(`${req.query.dateTo}T23:59:59.999Z`) : undefined;
      if ((dateFrom && Number.isNaN(dateFrom.getTime())) || (dateTo && Number.isNaN(dateTo.getTime())) || (dateFrom && dateTo && dateFrom > dateTo)) {
        return res.status(400).json({ message: "Invalid date range" });
      }
      const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const conditions = [
        inArray(invoices.status, requestedStatuses as any),
        carrierId ? eq(invoices.clientId, carrierId) : undefined,
        brokerId ? eq(invoices.brokerId, brokerId) : undefined,
        loadType ? eq(invoices.loadType, loadType as any) : undefined,
        paymentType ? eq(invoices.paymentType, paymentType === "ach" ? "ACH" : paymentType === "wire" ? "Wire" : paymentType as any) : undefined,
        dateFrom ? gte(invoices.submittedAt, dateFrom) : undefined,
        dateTo ? lte(invoices.submittedAt, dateTo) : undefined,
        search ? or(
          ilike(invoices.invoiceNumber, `%${search}%`),
          ilike(invoices.loadNumber, `%${search}%`),
          ilike(clients.name, `%${search}%`),
          ilike(brokers.name, `%${search}%`),
        ) : undefined,
      ].filter(Boolean) as any[];
      const queue = await db.select({
        invoice: invoices,
        carrierName: clients.name,
        advanceRate: clients.advanceRate,
        factoringFeeRate: clients.factoringFeeRate,
        brokerName: sql<string | null>`coalesce(${brokers.name}, ${debtors.name})`,
        branchNameJoined: brokerBranches.branchName,
        driverName: sql<string | null>`concat_ws(' ', ${drivers.firstName}, ${drivers.lastName})`,
        submittedByName: sql<string | null>`concat_ws(' ', ${userTable.firstName}, ${userTable.lastName})`,
      }).from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .leftJoin(brokers, eq(invoices.brokerId, brokers.id))
        .leftJoin(brokerBranches, eq(invoices.branchId, brokerBranches.id))
        .leftJoin(drivers, eq(invoices.driverId, drivers.id))
        .leftJoin(userTable, eq(invoices.submittedBy, userTable.id))
        .leftJoin(debtors, eq(invoices.debtorId, debtors.id))
        .where(and(...conditions))
        .orderBy(desc(invoices.submittedAt), desc(invoices.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const [{ total }] = await db.select({ total: count() }).from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .leftJoin(brokers, eq(invoices.brokerId, brokers.id))
        .leftJoin(debtors, eq(invoices.debtorId, debtors.id))
        .where(and(...conditions));
      const ids = queue.map((row) => row.invoice.id);
      const docs = ids.length
        ? await db.select({
          id: documentsTable.id,
          invoiceId: documentsTable.invoiceId,
          documentType: documentsTable.documentType,
          finalDocumentType: documentsTable.finalDocumentType,
          candidateDocumentType: documentsTable.candidateDocumentType,
          aiDocumentType: documentsTable.aiDocumentType,
          classificationSource: documentsTable.classificationSource,
          originalName: documentsTable.originalName,
          size: documentsTable.size,
          originalSize: documentsTable.originalSize,
          compressedSize: documentsTable.compressedSize,
        }).from(documentsTable).where(inArray(documentsTable.invoiceId, ids))
        : [];
      const byInvoice = new Map<number, typeof docs>();
      for (const document of docs) {
        if (!document.invoiceId) continue;
        byInvoice.set(document.invoiceId, [...(byInvoice.get(document.invoiceId) ?? []), document]);
      }
      const bankIds = queue.map(({ invoice }) => invoice.bankAccountId).filter((id): id is number => typeof id === "number");
      const bankEntries = bankIds.length
        ? await db.select({ id: clientVault.id, clientId: clientVault.clientId, label: clientVault.label, encryptedData: clientVault.encryptedData, isActive: clientVault.isActive })
          .from(clientVault).where(inArray(clientVault.id, bankIds))
        : [];
      const bankById = new Map(bankEntries.map((entry) => {
        let data: any = {};
        try { data = JSON.parse(decryptVault(entry.encryptedData)); } catch { /* keep masked fallback */ }
        const digits = String(data.accountNumber ?? "").replace(/\D/g, "");
        return [entry.id, {
          id: entry.id,
          bankName: data.bankName || entry.label || "Bank account",
          lastFour: digits ? digits.slice(-4).padStart(4, "•") : "••••",
          paymentType: data.paymentType === "Wire" ? "Wire" : data.paymentType === "ACH" ? "ACH" : null,
          isActive: entry.isActive,
        }];
      }));
      res.json({
        rows: queue.map(({ invoice, carrierName, advanceRate, factoringFeeRate, brokerName, branchNameJoined, driverName, submittedByName }) => {
        const invoiceDocs = byInvoice.get(invoice.id) ?? [];
        const types = new Set(invoiceDocs.map(document => checklistType(documentClassification(document))));
        const rateConfirmationPresent = types.has("rate_confirmation");
        const billOfLadingPresent = types.has("bill_of_lading") || types.has("bol");
        const lumperPresent = types.has("lumper_receipt") || types.has("receipt");
        const gross = Number(invoice.amount || 0);
        const rate = Number(advanceRate ?? 80);
        const feeRate = Number(factoringFeeRate ?? 3);
        const advanceAmount = +(gross * rate / 100).toFixed(2);
        const feeAmount = +(gross * feeRate / 100).toFixed(2);
        return {
          ...withInvoiceDisplayStatus(invoice),
          carrierName,
          advanceRate,
          factoringFeeRate,
          brokerName,
          branchName: invoice.branchName ?? branchNameJoined ?? null,
          driverName,
          submittedByName: submittedByName?.trim() || null,
          bankAccount: invoice.bankAccountId ? bankById.get(invoice.bankAccountId) ?? null : null,
          payoutPreview: {
            grossAmount: gross.toFixed(2),
            advanceRate: rate.toFixed(2),
            advanceAmount: advanceAmount.toFixed(2),
            feeRate: feeRate.toFixed(2),
            feeAmount: feeAmount.toFixed(2),
            reserveAmount: (gross - advanceAmount).toFixed(2),
            netFundingAmount: (advanceAmount - feeAmount).toFixed(2),
          },
          documentPresence: {
            rateConfirmation: rateConfirmationPresent,
            billOfLading: billOfLadingPresent,
            lumper: lumperPresent,
            readyToFund: rateConfirmationPresent && billOfLadingPresent && !!invoice.bankAccountId && !!bankById.get(invoice.bankAccountId)?.isActive,
          },
          documents: invoiceDocs.map((document) => ({
            id: document.id,
            type: documentClassification(document),
            originalName: document.originalName,
            size: document.size,
            originalSize: document.originalSize,
            compressedSize: document.compressedSize,
            viewPath: `/api/documents/${document.id}/view`,
            downloadPath: `/api/documents/${document.id}/download`,
          })),
        };
        }),
        page,
        pageSize,
        total: Number(total),
      });
    } catch (error) {
      console.error("Error fetching funding queue:", error);
      res.status(500).json({ message: "Failed to fetch funding queue" });
    }
  });

  // Uses the same guarded lifecycle operation as individual funding, ensuring
  // every funded invoice gets its payout, history, ledger, and notifications.
  app.post("/api/invoices/funding/batch", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const body = z.object({
        items: z.array(z.object({
          invoiceId: z.number().int().positive(),
          bankAccountVaultId: z.number().int().positive(),
          paymentMethod: z.enum(["ach", "wire", "check"]).optional(),
        })).min(1).max(100),
        force: z.boolean().optional(),
      }).parse(req.body);
      const uniqueIds = new Set(body.items.map((item) => item.invoiceId));
      if (uniqueIds.size !== body.items.length) {
        return res.status(400).json({ message: "Each invoice may appear only once in a funding batch" });
      }

      const results = [];
      for (const item of body.items) {
        const current = await storage.getInvoice(item.invoiceId);
        if (!current) {
          results.push({ invoiceId: item.invoiceId, success: false, error: "Invoice not found" });
          continue;
        }

        if (current.status !== "approved") {
          results.push({ invoiceId: item.invoiceId, success: false, error: "Only approved invoices can be funded" });
          continue;
        }
        const result = await performTransition(
          item.invoiceId,
          "fund",
          req.user.id,
          req.user.role,
          undefined,
          body.force,
          item.paymentMethod,
          item.bankAccountVaultId,
        );
        results.push({
          invoiceId: item.invoiceId,
          ...result,
          invoice: result.invoice ? withInvoiceDisplayStatus(result.invoice) : undefined,
        });
      }
      const funded = results.filter((result) => result.success).length;
      res.status(200).json({
        success: funded === results.length,
        funded,
        failed: results.length - funded,
        results,
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message });
      console.error("Error funding invoice batch:", error);
      res.status(500).json({ message: "Failed to fund invoice batch" });
    }
  });

  app.put("/api/invoices/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid invoice ID" });
      const lifecycleFields = [
        "status", "factoringStage", "submittedBy", "submittedAt", "approvedBy",
        "approvedAt", "fundedAt", "heldReason", "heldAt", "heldBy", "heldNotes",
        "previousStatus",
      ];
      const attemptedLifecycleField = lifecycleFields.find((field) =>
        Object.prototype.hasOwnProperty.call(req.body, field),
      );
      if (attemptedLifecycleField) {
        return res.status(400).json({
          message: `Lifecycle field "${attemptedLifecycleField}" cannot be changed through invoice updates; use the transition API`,
        });
      }
      // Older clients may still send the read-only internal invoice number.
      // Ignore it rather than allowing it into the update payload.
      const { invoiceNumber: _internalInvoiceNumber, ...editableInvoiceBody } = req.body ?? {};
      const invoiceData = insertInvoiceSchema.partial().extend({
        carrierInvoiceNumber: z.preprocess(
          value => typeof value === "string" && value.trim() === "" ? null : value,
          z.string().trim().max(100).nullable(),
        ).optional(),
      }).parse(editableInvoiceBody);
      const user = req.user;
      const currentInvoice = await storage.getInvoice(id);
      if (!currentInvoice) return res.status(404).json({ message: "Invoice not found" });
      const resolvedInvoiceData = await resolveInvoiceBrokerBranch(invoiceData as any, currentInvoice);
      if (user.role === "employee" && (currentInvoice.submittedBy !== user.id || !["draft", "rejected"].includes(currentInvoice.status))) {
        return res.status(403).json({ message: "Agents may edit only their own draft or correction-required invoices" });
      }
      if (resolvedInvoiceData.bankAccountId) {
        const account = await storage.getVaultEntry(resolvedInvoiceData.bankAccountId);
        if (!currentInvoice || !account || account.clientId !== currentInvoice.clientId || account.dataType !== "bank_account" || !account.isActive) {
          return res.status(400).json({ message: "The selected bank account is not available for this carrier" });
        }
      }

      const nextCarrierId = resolvedInvoiceData.clientId ?? currentInvoice.clientId;
      if (!(await canAccessClient(req, nextCarrierId))) {
        return res.status(403).json({ message: "You may only update invoices for carriers assigned to you" });
      }
      const nextCarrierInvoiceNumber = resolvedInvoiceData.carrierInvoiceNumber !== undefined
        ? resolvedInvoiceData.carrierInvoiceNumber
        : currentInvoice.carrierInvoiceNumber;
      const nextLoadNumber = resolvedInvoiceData.loadNumber !== undefined
        ? resolvedInvoiceData.loadNumber
        : currentInvoice.loadNumber;
      const duplicateRelevantFieldChanged = nextCarrierId !== currentInvoice.clientId
        || nextCarrierInvoiceNumber !== currentInvoice.carrierInvoiceNumber
        || nextLoadNumber !== currentInvoice.loadNumber;
      if (duplicateRelevantFieldChanged) {
        const preflight = await runPreflightForInvoice({
          carrierId: nextCarrierId,
          brokerId: resolvedInvoiceData.brokerId ?? currentInvoice.brokerId,
          invoiceNumber: nextCarrierInvoiceNumber,
          loadNumber: nextLoadNumber,
          amount: resolvedInvoiceData.amount ?? currentInvoice.amount,
          serviceDate: resolvedInvoiceData.invoiceDate ?? currentInvoice.invoiceDate,
          excludeInvoiceId: id,
        });
        const exactDuplicateAlerts = preflight.alerts.filter((alert: any) => alert.code === "DUPLICATE_EXACT");
        if (exactDuplicateAlerts.length) {
          return res.status(409).json({ message: "Carrier invoice number or load number is already in use.", alerts: exactDuplicateAlerts });
        }
      }

      const updatePayload: any = {
        ...resolvedInvoiceData,
        updatedAt: new Date(),
      };

      const invoice = await storage.updateInvoice(id, updatePayload);

      res.json(withInvoiceDisplayStatus(invoice));
    } catch (error) {
      if ((error as any)?.status === 400) return res.status(400).json({ message: (error as Error).message });
      if ((error as any)?.code === "23505") return res.status(409).json({ message: "Carrier invoice number or load number is already in use." });
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid invoice data", errors: error.errors });
      }
      console.error("Error updating invoice:", error);
      res.status(500).json({ message: "Failed to update invoice" });
    }
  });

  app.put("/api/invoices/:id/approve", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!await employeeCanAccessInvoice(req, id)) return res.status(403).json({ message: "You may only approve your own invoice" });
      const result = await performTransition(id, "approve", req.user.id, req.user.role ?? "employee");
      res.status(result.success ? 200 : 400).json(
        result.success ? { ...result, invoice: withInvoiceDisplayStatus(result.invoice) } : result,
      );
    } catch (error) {
      console.error("Error approving invoice:", error);
      res.status(500).json({ message: "Failed to approve invoice" });
    }
  });

  app.post("/api/invoices/:id/override-approve", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const reason = String(req.body.reason ?? "").trim();
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid invoice ID" });
      if (!await employeeCanAccessInvoice(req, id)) return res.status(403).json({ message: "You may only approve your own invoice" });
      if (!reason) return res.status(400).json({ message: "Override reason is required" });
      const result = await performTransition(
        id, "approve", req.user.id, req.user.role ?? "employee", reason, true,
      );
      res.status(result.success ? 200 : 400).json(
        result.success ? { ...result, invoice: withInvoiceDisplayStatus(result.invoice) } : result,
      );
    } catch (error) {
      console.error("Error overriding invoice approval:", error);
      res.status(500).json({ message: "Failed to override and approve invoice" });
    }
  });

  // ─── Invoice detail (all related data) ───────────────────────────────────
  app.get("/api/invoices/:id/download", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid invoice ID" });
      if (!await employeeCanAccessInvoice(req, id)) return res.status(403).json({ message: "You may only download your own invoices" });

      const [row] = await db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          loadNumber: invoices.loadNumber,
          amount: invoices.amount,
          currency: invoices.currency,
          status: invoices.status,
          invoiceDate: invoices.invoiceDate,
          submittedAt: invoices.submittedAt,
          dueDate: invoices.dueDate,
          pickupLocation: invoices.pickupLocation,
          deliveryLocation: invoices.deliveryLocation,
          bolNumber: invoices.bolNumber,
          notes: invoices.notes,
          clientName: clients.name,
          debtorName: sql<string | null>`coalesce(${brokers.name}, ${debtors.name})`,
        })
        .from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .leftJoin(brokers, eq(invoices.brokerId, brokers.id))
        .leftJoin(debtors, eq(invoices.debtorId, debtors.id))
        .where(eq(invoices.id, id))
        .limit(1);

      if (!row) return res.status(404).json({ message: "Invoice not found" });

      const doc = new PDFDocument({ margin: 50, size: "LETTER" });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(chunks);
        const filename = `${row.invoiceNumber || `invoice-${id}`}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", pdfBuffer.length.toString());
        res.end(pdfBuffer);
      });

      // ── Header ──────────────────────────────────────────────────────────
      doc.fontSize(22).font("Helvetica-Bold").text("FactorFlux", 50, 50);
      doc.fontSize(9).font("Helvetica").fillColor("#64748b").text("Trucking Pros Financial", 50, 76);
      doc.fillColor("#1e293b");

      // Invoice label + number (top-right)
      doc.fontSize(20).font("Helvetica-Bold")
        .text("INVOICE", 350, 50, { align: "right", width: 200 });
      doc.fontSize(11).font("Helvetica")
        .text(row.invoiceNumber || `#${id}`, 350, 76, { align: "right", width: 200 });

      // Divider
      doc.moveTo(50, 105).lineTo(562, 105).strokeColor("#e2e8f0").lineWidth(1).stroke();

      // ── Billing info ─────────────────────────────────────────────────────
      const col2 = 300;
      let y = 120;

      doc.fontSize(8).font("Helvetica-Bold").fillColor("#94a3b8").text("CARRIER", 50, y);
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#94a3b8").text("BROKER / DEBTOR", col2, y);
      y += 14;
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#1e293b")
        .text(row.clientName || "—", 50, y, { width: 220 });
      doc.fontSize(11).font("Helvetica-Bold").fillColor("#1e293b")
        .text(row.debtorName || "—", col2, y, { width: 220 });

      y += 30;
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#94a3b8").text("INVOICE DATE", 50, y);
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#94a3b8").text("DUE DATE", col2, y);
      y += 14;
      const fmtDate = (d: Date | string | null | undefined) =>
        d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";
      doc.fontSize(10).font("Helvetica").fillColor("#1e293b")
        .text(fmtDate(row.invoiceDate || row.submittedAt), 50, y);
      doc.fontSize(10).font("Helvetica").fillColor("#1e293b")
        .text(fmtDate(row.dueDate), col2, y);

      y += 30;
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#94a3b8").text("STATUS", 50, y);
      y += 14;
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#0f172a")
        .text((row.status || "").toUpperCase().replace(/_/g, " "), 50, y);

      // ── Load details table ────────────────────────────────────────────────
      y += 40;
      doc.moveTo(50, y).lineTo(562, y).strokeColor("#e2e8f0").lineWidth(1).stroke();
      y += 10;

      const col = [50, 200, 350, 450];
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#94a3b8");
      doc.text("LOAD NUMBER", col[0], y);
      doc.text("BOL NUMBER", col[1], y);
      doc.text("PICKUP", col[2], y);
      doc.text("DELIVERY", col[3], y);
      y += 14;
      doc.fontSize(10).font("Helvetica").fillColor("#1e293b");
      doc.text(row.loadNumber || "—", col[0], y, { width: 140 });
      doc.text(row.bolNumber || "—", col[1], y, { width: 140 });
      doc.text(row.pickupLocation || "—", col[2], y, { width: 90, ellipsis: true });
      doc.text(row.deliveryLocation || "—", col[3], y, { width: 110, ellipsis: true });

      // ── Amount box ────────────────────────────────────────────────────────
      y += 50;
      doc.moveTo(50, y).lineTo(562, y).strokeColor("#e2e8f0").lineWidth(1).stroke();
      y += 12;

      const amountStr = parseFloat(row.amount || "0").toLocaleString("en-US", {
        style: "currency", currency: row.currency || "USD",
      });
      doc.fontSize(10).font("Helvetica").fillColor("#64748b")
        .text("Invoice Amount", 350, y, { align: "right", width: 200 });
      y += 16;
      doc.fontSize(18).font("Helvetica-Bold").fillColor("#1e293b")
        .text(amountStr, 350, y, { align: "right", width: 200 });

      // ── Notes ─────────────────────────────────────────────────────────────
      if (row.notes) {
        y += 50;
        doc.fontSize(8).font("Helvetica-Bold").fillColor("#94a3b8").text("NOTES", 50, y);
        y += 14;
        doc.fontSize(10).font("Helvetica").fillColor("#475569").text(row.notes, 50, y, { width: 500 });
      }

      // ── Footer ────────────────────────────────────────────────────────────
      doc.fontSize(8).font("Helvetica").fillColor("#94a3b8")
        .text("Generated by FactorFlux · Trucking Pros Financial", 50, 720, { align: "center", width: 512 });

      doc.end();
    } catch (error) {
      console.error("Error generating invoice PDF:", error);
      res.status(500).json({ message: "Failed to generate invoice PDF" });
    }
  });

  app.get("/api/invoices/:id/detail", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const invoice = await storage.getInvoice(id);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      if (!await employeeCanAccessInvoice(req, id)) {
        return res.status(403).json({ message: "You may only view your own submitted invoices" });
      }
      const detail = await getInvoiceDetail(id);
      res.json(detail);
    } catch (err) {
      console.error("Error fetching invoice detail:", err);
      res.status(500).json({ message: "Failed to fetch invoice detail" });
    }
  });

  app.post("/api/invoices/:id/notes", requireAuth, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid invoice id" });
      if (!await employeeCanAccessInvoice(req, id)) return res.status(403).json({ message: "You may only add notes to your own submitted invoices" });
      const body = z.object({ body: z.string().trim().min(1).max(10000) }).parse(req.body);
      const [invoice] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, id)).limit(1);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      const [note] = await db.insert(invoiceNotes).values({ invoiceId: id, body: body.body, createdBy: req.user.id }).returning();
      await db.insert(eventLedger).values({
        entityType: "invoice", entityId: id, eventType: "invoice_note_added", actorType: "user", actorId: req.user.id,
        payloadJson: { noteId: note.id, body: note.body },
      });
      res.status(201).json(note);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message });
      console.error("Error adding invoice note:", error);
      res.status(500).json({ message: "Failed to add invoice note" });
    }
  });

  // ─── Invoice timeline (merged events) ────────────────────────────────────
  app.get("/api/invoices/:id/timeline", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!await employeeCanAccessInvoice(req, id)) return res.status(403).json({ message: "You may only view your own invoice status" });
      const timeline = await getInvoiceTimeline(id);
      res.json(timeline);
    } catch (err) {
      console.error("Error fetching invoice timeline:", err);
      res.status(500).json({ message: "Failed to fetch invoice timeline" });
    }
  });

  app.get("/api/invoices/:id/receipts", requireAuth, async (req: any, res) => {
    try {
      const invoiceId = Number(req.params.id);
      if (!Number.isInteger(invoiceId) || invoiceId < 1) return res.status(400).json({ message: "Invalid invoice ID" });
      if (!await employeeCanAccessInvoice(req, invoiceId)) return res.status(403).json({ message: "You may only view receipts for accessible invoices" });
      res.json(await listFundingReceipts(invoiceId));
    } catch (error) {
      console.error("Error fetching funding receipts:", error);
      res.status(500).json({ message: "Failed to fetch funding receipts" });
    }
  });

  app.get("/api/receipts/:receiptNo/download", requirePermission("factoring"), async (req: any, res) => {
    try {
      const receiptNo = z.string().regex(/^FR-\d{4}-\d{6}$/).parse(req.params.receiptNo);
      const version = req.query.version === undefined ? undefined : z.coerce.number().int().positive().parse(req.query.version);
      const receipt = await getFundingReceipt(receiptNo, version);
      if (!receipt) return res.status(404).json({ message: "Funding receipt not found" });
      if (!await employeeCanAccessInvoice(req, receipt.invoiceId)) return res.status(403).json({ message: "You may only download receipts for accessible invoices" });
      res.redirect(await getFundingReceiptDownloadUrl(receipt));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid receipt number or version" });
      console.error("Error downloading funding receipt:", error);
      res.status(500).json({ message: "Failed to download funding receipt" });
    }
  });

  app.post("/api/receipts/:receiptNo/resend", requireManagerOrAdmin, requirePermission("factoring"), async (req: any, res) => {
    try {
      const receiptNo = z.string().regex(/^FR-\d{4}-\d{6}$/).parse(req.params.receiptNo);
      const { version } = z.object({ version: z.coerce.number().int().positive().optional() }).parse(req.body ?? {});
      const receipt = await getFundingReceipt(receiptNo, version);
      if (!receipt) return res.status(404).json({ message: "Funding receipt not found" });
      if (!await employeeCanAccessInvoice(req, receipt.invoiceId)) return res.status(403).json({ message: "You may only resend receipts for accessible invoices" });
      const [row] = await db.select({
        invoiceNumber: invoices.invoiceNumber,
        carrierEmail: clients.email,
      }).from(invoices)
        .innerJoin(clients, eq(invoices.clientId, clients.id))
        .where(eq(invoices.id, receipt.invoiceId))
        .limit(1);
      if (!row) return res.status(404).json({ message: "Invoice not found" });
      if (!row.carrierEmail) return res.status(409).json({ message: "Carrier primary contact has no email address" });
      const delivery = await sendFundingReceiptEmail(receipt, row.invoiceNumber, row.carrierEmail);
      if (!delivery.success) return res.status(502).json({ message: "Receipt email could not be delivered" });
      res.json({ success: true, receiptNo: receipt.receiptNo, version: receipt.version });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid receipt resend request" });
      console.error("Error resending funding receipt:", error);
      res.status(500).json({ message: "Failed to resend funding receipt" });
    }
  });

  app.patch("/api/invoices/:id/payment-reference", requireManagerOrAdmin, requirePermission("factoring"), async (req: any, res) => {
    let issued: IssuedFundingReceipt | null = null;
    let receiptTransactionCommitted = false;
    try {
      const invoiceId = z.coerce.number().int().positive().parse(req.params.id);
      const { paymentReference } = z.object({
        paymentReference: z.string().trim().min(1).max(200),
      }).parse(req.body);
      const outcome = await db.transaction(async tx => {
        const [row] = await tx.select({
          invoice: invoices,
          payout: payouts,
          carrierName: clients.name,
          carrierEmail: clients.email,
        }).from(invoices)
          .innerJoin(payouts, eq(payouts.invoiceId, invoices.id))
          .innerJoin(clients, eq(clients.id, invoices.clientId))
          .where(eq(invoices.id, invoiceId))
          .limit(1);
        if (!row) throw Object.assign(new Error("Funded invoice not found"), { status: 404 });
        if (row.invoice.status !== "funded") throw Object.assign(new Error("Payment references may only be set on funded invoices"), { status: 409 });
        if (row.invoice.paymentReference === paymentReference) {
          throw Object.assign(new Error("Payment reference is unchanged"), { status: 409 });
        }
        const [latest] = await tx.select().from(fundingReceipts)
          .where(eq(fundingReceipts.invoiceId, invoiceId))
          .orderBy(desc(fundingReceipts.version))
          .limit(1);
        if (!latest) throw Object.assign(new Error("Initial funding receipt not found"), { status: 409 });
        const [updatedInvoice] = await tx.update(invoices)
          .set({ paymentReference, updatedAt: new Date() })
          .where(eq(invoices.id, invoiceId))
          .returning();
        await tx.insert(eventLedger).values({
          entityType: "invoice",
          entityId: invoiceId,
          eventType: "payment_reference_set",
          actorType: "user",
          actorId: req.user.id,
          payloadJson: { from: row.invoice.paymentReference, to: paymentReference },
        });
        issued = await issueFundingReceiptVersion(tx as any, {
          receiptNo: latest.receiptNo,
          invoiceId,
          invoiceNumber: row.invoice.invoiceNumber,
          carrierId: row.invoice.clientId,
          carrierName: row.carrierName,
          carrierEmail: row.carrierEmail,
          brokerId: row.invoice.brokerId,
          invoiceAmount: row.payout.invoiceAmount,
          advancePct: row.payout.advanceRate,
          feeAmount: row.payout.feeAmount,
          reserveAmount: row.payout.reserveAmount,
          netFunded: row.payout.netPayout,
          paymentMethod: row.payout.paymentMethod,
          paymentReference,
          fundedAt: row.invoice.fundedAt ?? row.payout.advancePaidAt ?? latest.fundedAt,
          fundedByUserId: row.payout.advancePaidBy ?? latest.fundedByUserId,
          issuedByUserId: req.user.id,
        });
        return { invoice: updatedInvoice, carrierEmail: row.carrierEmail };
      });
      receiptTransactionCommitted = true;
      const createdReceipt = issued as IssuedFundingReceipt | null;
      if (!createdReceipt) throw new Error("Funding receipt version was not created");
      try {
        const delivery = await sendFundingReceiptEmail(createdReceipt.receipt, outcome.invoice.invoiceNumber, outcome.carrierEmail, createdReceipt.pdf);
        await db.insert(eventLedger).values({
          entityType: "invoice",
          entityId: outcome.invoice.id,
          eventType: delivery.success ? "funding_receipt_email_sent" : "funding_receipt_email_failed",
          actorType: "system",
          actorId: req.user.id,
          payloadJson: {
            receiptNo: createdReceipt.receipt.receiptNo,
            version: createdReceipt.receipt.version,
            recipient: outcome.carrierEmail,
            messageId: delivery.messageId ?? null,
          },
        });
      } catch (deliveryError) {
        console.error("[funding-receipt] version delivery audit failed:", deliveryError);
      }
      res.json({ invoice: withInvoiceDisplayStatus(outcome.invoice), receipt: createdReceipt.receipt });
    } catch (error: any) {
      const uploaded = issued as IssuedFundingReceipt | null;
      if (uploaded && !receiptTransactionCommitted) await compensateFundingReceiptUpload(uploaded.receipt);
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message ?? "Invalid payment reference" });
      if (error?.status) return res.status(error.status).json({ message: error.message });
      console.error("Error setting funding payment reference:", error);
      res.status(500).json({ message: "Failed to set payment reference" });
    }
  });

  // ─── Available lifecycle transitions ─────────────────────────────────────
  app.get("/api/invoices/:id/available-transitions", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!await employeeCanAccessInvoice(req, id)) return res.status(403).json({ message: "You may only view your own invoice transitions" });
      const transitions = await getAvailableTransitions(id, req.user?.role ?? "employee", req.user?.id);
      res.json(transitions.map((transition) => ({
        ...transition,
        toDisplayStatus: getInvoiceDisplayStatus(transition.to),
      })));
    } catch (err) {
      console.error("Error fetching transitions:", err);
      res.status(500).json({ message: "Failed to fetch available transitions" });
    }
  });

  // ─── Perform a lifecycle transition ──────────────────────────────────────
  app.post("/api/invoices/:id/transition", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const schema = z.object({
        transitionId: z.string().min(1),
        reason: z.string().optional(),
        force: z.boolean().optional(),
        paymentMethod: z.enum(["ach", "wire", "check"]).optional(),
        bankAccountVaultId: z.number().int().positive().optional(),
      });
      const { transitionId, reason, force, paymentMethod, bankAccountVaultId } = schema.parse(req.body);
      if (!await employeeCanAccessInvoice(req, id)) return res.status(403).json({ message: "You may only transition your own invoice" });
      const result = await performTransition(
        id, transitionId, req.user.id, req.user.role ?? "employee", reason, force, paymentMethod, bankAccountVaultId,
      );
      res.status(result.success ? 200 : 400).json(
        result.success ? { ...result, invoice: withInvoiceDisplayStatus(result.invoice) } : result,
      );
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message });
      console.error("Error performing transition:", err);
      res.status(500).json({ message: "Failed to perform transition" });
    }
  });

  app.get("/api/invoices/aging-alerts", requireAuth, async (req: any, res) => {
    try {
      const view = req.query.view === "resolved" ? "acknowledged" : "pending";
      const alerts = await db.select({
        id: invoiceAgingAlerts.id, invoiceId: invoiceAgingAlerts.invoiceId, alertType: invoiceAgingAlerts.alertType,
        triggeredAt: invoiceAgingAlerts.triggeredAt, acknowledgedAt: invoiceAgingAlerts.acknowledgedAt,
        acknowledgedBy: invoiceAgingAlerts.acknowledgedBy, status: invoiceAgingAlerts.status,
        invoiceNumber: invoices.invoiceNumber, fundedAt: invoices.fundedAt, carrier: clients.name,
        broker: sql<string | null>`coalesce(${brokers.name}, ${debtors.name})`,
      }).from(invoiceAgingAlerts).innerJoin(invoices, eq(invoiceAgingAlerts.invoiceId, invoices.id))
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .leftJoin(brokers, eq(invoices.brokerId, brokers.id))
        .leftJoin(debtors, eq(invoices.debtorId, debtors.id))
        .where(eq(invoiceAgingAlerts.status, view as any)).orderBy(desc(invoiceAgingAlerts.triggeredAt));
      res.json(alerts);
    } catch (error) { console.error("Error fetching aging alerts:", error); res.status(500).json({ message: "Failed to fetch aging alerts" }); }
  });

  app.post("/api/invoices/aging-alerts/:id/acknowledge", requireAuth, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid alert id" });
      const [alert] = await db.update(invoiceAgingAlerts).set({
        status: "acknowledged", acknowledgedAt: new Date(), acknowledgedBy: req.user.id,
      }).where(and(eq(invoiceAgingAlerts.id, id), eq(invoiceAgingAlerts.status, "pending"))).returning();
      if (!alert) return res.status(404).json({ message: "Pending aging alert not found" });
      await db.insert(eventLedger).values({ entityType: "invoice", entityId: alert.invoiceId, eventType: "invoice_aging_alert_acknowledged", actorType: "user", actorId: req.user.id, payloadJson: { alertId: id, alertType: alert.alertType } });
      res.json(alert);
    } catch (error) { console.error("Error acknowledging aging alert:", error); res.status(500).json({ message: "Failed to acknowledge aging alert" }); }
  });

  app.get("/api/invoices/chargebacks", requireAuth, async (_req, res) => {
    try {
      const rows = await db.select({
        invoice: invoices, carrierName: clients.name,
        brokerName: sql<string | null>`coalesce(${brokers.name}, ${debtors.name})`,
      }).from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .leftJoin(brokers, eq(invoices.brokerId, brokers.id))
        .leftJoin(debtors, eq(invoices.debtorId, debtors.id))
        .where(inArray(invoices.chargebackStatus, ["scheduled", "extended", "charged"] as any[]))
        .orderBy(desc(invoices.chargebackDate));
      res.json(rows.map(r => ({ ...r.invoice, carrierName: r.carrierName, brokerName: r.brokerName })));
    } catch (error) {
      console.error("Error fetching chargebacks:", error);
      res.status(500).json({ message: "Failed to fetch chargebacks" });
    }
  });

  app.post("/api/invoices/:id/extend-chargeback", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!await employeeCanAccessInvoice(req, id)) return res.status(403).json({ message: "You may only extend chargeback for your own invoice" });
      const body = z.object({ extensionDate: z.string().min(1), reason: z.string().trim().min(3) }).parse(req.body);
      const extensionDate = new Date(body.extensionDate);
      if (Number.isNaN(extensionDate.getTime()) || extensionDate <= new Date()) return res.status(400).json({ message: "Extension date must be in the future" });
      const [invoice] = await db.update(invoices).set({
        chargebackStatus: "extended", chargebackDate: extensionDate,
        chargebackExtensionDate: extensionDate, chargebackExtensionReason: body.reason,
        chargebackExtendedBy: req.user.id, chargebackExtendedAt: new Date(), updatedAt: new Date(),
      }).where(and(eq(invoices.id, id), inArray(invoices.chargebackStatus, ["scheduled", "extended"] as any[]))).returning();
      if (!invoice) return res.status(404).json({ message: "Active scheduled chargeback not found" });
      const recipients = await db.select({ id: users.id }).from(users).where(and(eq(users.status, "active"), inArray(users.role, ["employee", "manager", "admin"])));
      const agentName = req.user.name || req.user.username || "Agent";
      for (const user of recipients) await storage.createNotification({
        userId: user.id, title: "Chargeback Extended",
        message: `Chargeback for invoice ${invoice.invoiceNumber} extended by ${agentName} to ${extensionDate.toLocaleDateString()}`,
        type: "success", entityType: "invoice", entityId: id, actionUrl: `/invoices/${id}`,
        metadata: JSON.stringify({ category: "chargeback", severity: "green", status: "extended" }),
      } as any);
      await db.insert(eventLedger).values({
        entityType: "invoice", entityId: id, eventType: "chargeback_extended", actorType: "user", actorId: req.user.id,
        payloadJson: { extensionDate, reason: body.reason, agentName },
      });
      await db.insert(invoiceChargebackEvents).values({
        invoiceId: id, eventType: "extended", extensionDate, reason: body.reason, actorId: req.user.id,
        metadata: { agentName },
      });
      if (invoice.brokerId != null) recalculateBrokerCreditSafe(invoice.brokerId);
      res.json(invoice);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message });
      console.error("Error extending chargeback:", error);
      res.status(500).json({ message: "Failed to extend chargeback" });
    }
  });

  app.post("/api/invoices/:id/chargeback/refunds", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid invoice id" });
      const body = z.object({
        amount: z.coerce.number().positive(),
        refundDate: z.coerce.date().optional(),
        method: z.string().trim().min(1).max(80),
        reference: z.string().trim().max(200).optional().nullable(),
        notes: z.string().trim().max(2000).optional().nullable(),
      }).parse(req.body);
      const [invoice] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, id)).limit(1);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      const [refund] = await db.insert(invoiceRefunds).values({
        invoiceId: id, amount: body.amount.toFixed(2), refundDate: body.refundDate ?? new Date(),
        method: body.method, reference: body.reference ?? null, notes: body.notes ?? null, createdBy: req.user.id,
      }).returning();
      await db.insert(invoiceChargebackEvents).values({
        invoiceId: id, eventType: "refunded", reason: body.notes ?? null, actorId: req.user.id,
        metadata: { refundId: refund.id, amount: refund.amount, method: refund.method, reference: refund.reference },
      });
      await db.insert(eventLedger).values({
        entityType: "invoice", entityId: id, eventType: "chargeback_refunded", actorType: "user", actorId: req.user.id,
        payloadJson: {
          refundId: refund.id,
          amount: refund.amount,
          method: refund.method,
          reference: refund.reference,
          reason: refund.notes,
        },
      });
      res.status(201).json(refund);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message });
      console.error("Error recording invoice refund:", error);
      res.status(500).json({ message: "Failed to record invoice refund" });
    }
  });

  // ─── Document Rules (admin-configurable checklist) ───────────────────────
  app.get("/api/document-rules", requireAuth, async (_req, res) => {
    try { res.json(await storage.getDocumentRules()); }
    catch (err) { res.status(500).json({ message: "Failed to fetch document rules" }); }
  });

  app.post("/api/document-rules", requireAuth, async (req: any, res) => {
    if (req.user?.role !== "manager" && req.user?.role !== "admin")
      return res.status(403).json({ message: "Manager or admin required" });
    try {
      const rule = await storage.createDocumentRule(req.body);
      res.status(201).json(rule);
    } catch (err) { res.status(500).json({ message: "Failed to create document rule" }); }
  });

  app.put("/api/document-rules/:id", requireAuth, async (req: any, res) => {
    if (req.user?.role !== "manager" && req.user?.role !== "admin")
      return res.status(403).json({ message: "Manager or admin required" });
    try {
      const rule = await storage.updateDocumentRule(parseInt(req.params.id), req.body);
      res.json(rule);
    } catch (err) { res.status(500).json({ message: "Failed to update document rule" }); }
  });

  app.delete("/api/document-rules/:id", requireAuth, async (req: any, res) => {
    if (req.user?.role !== "admin")
      return res.status(403).json({ message: "Admin required" });
    try {
      await storage.deleteDocumentRule(parseInt(req.params.id));
      res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Failed to delete document rule" }); }
  });

  // ─── Invoice document completeness status ─────────────────────────────────
  app.get("/api/invoices/:id/document-status", requireAuth, async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      if (!await employeeCanAccessInvoice(req, invoiceId)) return res.status(403).json({ message: "You may only view document status for your own invoices" });
      const raw = await getDocumentCompleteness(invoiceId);

      // Fetch latest review per document to surface confirmation status
      const docIds = raw.rules.map(rs => rs.document?.id).filter(Boolean) as number[];
      const reviewsByDocId = new Map<number, { reviewStatus: string; reviewedAt: Date | null; reviewedByUserId: string | null }>();
      if (docIds.length > 0) {
        const latestReviews = await db
          .select({
            documentId:       docReviews.documentId,
            reviewStatus:     docReviews.reviewStatus,
            reviewedAt:       docReviews.reviewedAt,
            reviewedByUserId: docReviews.reviewedByUserId,
          })
          .from(docReviews)
          .orderBy(desc(docReviews.createdAt));
        for (const rv of latestReviews) {
          if (!reviewsByDocId.has(rv.documentId)) {
            reviewsByDocId.set(rv.documentId, {
              reviewStatus:     rv.reviewStatus,
              reviewedAt:       rv.reviewedAt,
              reviewedByUserId: rv.reviewedByUserId,
            });
          }
        }
      }

      const flatRules = raw.rules.map(rs => {
        const docReview = rs.document?.id ? reviewsByDocId.get(rs.document.id) : undefined;
        return {
          documentType:     rs.rule.documentType,
          label:            rs.rule.label,
          description:      rs.rule.description,
          required:         rs.rule.required,
          requiredForStage: rs.rule.requiredForStage,
          sortOrder:        rs.rule.sortOrder,
          active:           rs.rule.active,
          present:          rs.uploaded,
          document:         rs.document ?? null,
          reviewStatus:     docReview?.reviewStatus ?? null,
          reviewedAt:       docReview?.reviewedAt ?? null,
          confirmed:        docReview?.reviewStatus === "confirmed",
        };
      });
      const [override] = await db.select().from(eventLedger)
        .where(and(
          eq(eventLedger.entityType, "invoice"),
          eq(eventLedger.entityId, invoiceId),
          eq(eventLedger.eventType, "document_requirements_overridden"),
        ))
        .orderBy(desc(eventLedger.createdAt))
        .limit(1);
      res.json({
        ...raw,
        rules: flatRules,
        overrideApplied: override ? { ...(override.payloadJson as any), createdAt: override.createdAt } : null,
      });
    } catch (err) { res.status(500).json({ message: "Failed to fetch document status" }); }
  });

  // ─── Invoice document reviews (reviewer notes) ────────────────────────────
  app.get("/api/invoices/:id/doc-reviews", requireAuth, async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.id);
      if (!await employeeCanAccessInvoice(req, invoiceId)) return res.status(403).json({ message: "You may only view reviews for your own invoices" });
      res.json(await storage.getDocReviews(invoiceId));
    } catch (err) { res.status(500).json({ message: "Failed to fetch document reviews" }); }
  });

  app.post("/api/invoices/:id/doc-reviews", requireAuth, async (req: any, res) => {
    if (req.user?.role !== "manager" && req.user?.role !== "admin")
      return res.status(403).json({ message: "Manager or admin required" });
    try {
      const schema = z.object({
        status: z.enum(["approved", "needs_revision", "incomplete"]),
        notes: z.string().optional(),
      });
      const { status, notes } = schema.parse(req.body);
      const invoiceId = parseInt(req.params.id);
      if (!await employeeCanAccessInvoice(req, invoiceId)) return res.status(403).json({ message: "You may only review your own invoice" });
      const review = await storage.createDocReview({
        invoiceId,
        reviewedBy: req.user.id,
        status, notes,
      });
      res.status(201).json(review);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message });
      res.status(500).json({ message: "Failed to save review" });
    }
  });

  app.get("/api/invoices/search", requireAuth, async (req: any, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== "string") {
        return res.status(400).json({ message: "Search query is required" });
      }
      const invoices = await storage.searchInvoices(q);
      res.json(req.user.role === "employee"
        ? invoices.filter(invoice => invoice.submittedBy === req.user.id)
        : invoices);
    } catch (error) {
      console.error("Error searching invoices:", error);
      res.status(500).json({ message: "Failed to search invoices" });
    }
  });

  // Search
  app.get("/api/search", requireAuth, async (req: any, res) => {
    try {
      const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (query.length < 2) {
        return res.json({ groups: [] });
      }
      const pattern = `%${query}%`;

      const [
        carrierResults,
        brokerResults,
        invoiceResults,
        loadResults,
        fuelAdvanceResults,
        ticketResults,
        taskResults,
        dispatcherResults,
        truckResults,
      ] = await Promise.all([
        db.select({
          id: clients.id,
          name: clients.name,
          mcNumber: clients.mcNumber,
          dotNumber: clients.dotNumber,
          contactPerson: clients.contactPerson,
        }).from(clients).where(or(
          ilike(clients.name, pattern),
          ilike(clients.mcNumber, pattern),
          ilike(clients.dotNumber, pattern),
          ilike(clients.contactPerson, pattern),
          ilike(clients.email, pattern),
        )).limit(5),
        db.select({
          id: brokers.id,
          name: brokers.name,
          mcNumber: brokers.mcNumber,
          contactPerson: brokers.contactPerson,
        }).from(brokers).where(or(
          ilike(brokers.name, pattern),
          ilike(brokers.mcNumber, pattern),
          ilike(brokers.contactPerson, pattern),
          ilike(brokers.email, pattern),
        )).limit(5),
        db.select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          loadNumber: invoices.loadNumber,
          amount: invoices.amount,
          status: invoices.status,
        }).from(invoices).where(and(
          or(
            ilike(invoices.invoiceNumber, pattern),
            ilike(invoices.loadNumber, pattern),
            ilike(invoices.code, pattern),
            ilike(invoices.driverName, pattern),
          ),
          req.user.role === "employee" ? eq(invoices.submittedBy, req.user.id) : undefined,
        )).limit(5),
        db.select({
          id: loads.id,
          loadNumber: loads.loadNumber,
          pickupLocation: loads.pickupLocation,
          deliveryLocation: loads.deliveryLocation,
        }).from(loads).where(or(
          ilike(loads.loadNumber, pattern),
          ilike(loads.pickupLocation, pattern),
          ilike(loads.deliveryLocation, pattern),
          ilike(loads.driverName, pattern),
        )).limit(5),
        db.select({
          id: fuelAdvances.id,
          carrierName: fuelAdvances.carrierName,
          advanceAmount: fuelAdvances.advanceAmount,
        }).from(fuelAdvances).where(or(
          ilike(fuelAdvances.carrierName, pattern),
          ilike(fuelAdvances.notes, pattern),
        )).limit(5),
        db.select({
          id: tickets.id,
          ticketNumber: tickets.ticketNumber,
          title: tickets.title,
          status: tickets.status,
        }).from(tickets).where(and(
          or(
            ilike(tickets.ticketNumber, pattern),
            ilike(tickets.title, pattern),
            ilike(tickets.description, pattern),
          ),
          req.user.role === "employee"
            ? or(eq(tickets.submittedBy, req.user.id), eq(tickets.assignedTo, req.user.id))
            : undefined,
        )).limit(5),
        db.select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          status: tasks.status,
        }).from(tasks).where(and(
          or(ilike(tasks.title, pattern), ilike(tasks.description, pattern)),
          req.user.role === "employee"
            ? or(eq(tasks.createdBy, req.user.id), eq(tasks.assignedTo, req.user.id))
            : undefined,
        )).limit(5),
        db.select({
          id: dispatchers.id,
          firstName: dispatchers.firstName,
          lastName: dispatchers.lastName,
          email: dispatchers.email,
          phone: dispatchers.phone,
        }).from(dispatchers).where(or(
          ilike(dispatchers.firstName, pattern),
          ilike(dispatchers.lastName, pattern),
          ilike(sql<string>`concat(${dispatchers.firstName}, ' ', ${dispatchers.lastName})`, pattern),
          ilike(dispatchers.email, pattern),
          ilike(dispatchers.phone, pattern),
        )).limit(5),
        db.select({
          id: trucks.id,
          truckNumber: trucks.truckNumber,
          vin: trucks.vin,
          make: trucks.make,
          model: trucks.model,
          licensePlate: trucks.licensePlate,
        }).from(trucks).where(or(
          ilike(trucks.truckNumber, pattern),
          ilike(trucks.vin, pattern),
          ilike(trucks.make, pattern),
          ilike(trucks.model, pattern),
          ilike(trucks.licensePlate, pattern),
        )).limit(5),
      ]);

      res.json({
        groups: [
          {
            type: "carriers",
            label: "Carriers",
            results: carrierResults.map(item => ({
              id: item.id,
              title: item.name,
              subtitle: [item.mcNumber && `MC ${item.mcNumber}`, item.dotNumber && `DOT ${item.dotNumber}`, item.contactPerson].filter(Boolean).join(" · "),
              href: `/clients/${item.id}`,
            })),
          },
          {
            type: "brokers",
            label: "Brokers",
            results: brokerResults.map(item => ({
              id: item.id,
              title: item.name,
              subtitle: [item.mcNumber && `MC ${item.mcNumber}`, item.contactPerson].filter(Boolean).join(" · "),
              href: `/brokers/${item.id}`,
            })),
          },
          {
            type: "invoices",
            label: "Invoices",
            results: invoiceResults.map(item => ({
              id: item.id,
              title: `Invoice ${item.invoiceNumber}`,
              subtitle: [item.loadNumber && `Load ${item.loadNumber}`, `$${item.amount}`, item.status].filter(Boolean).join(" · "),
              href: `/invoices/${item.id}`,
            })),
          },
          {
            type: "loads",
            label: "Load Ledger",
            results: loadResults.map(item => ({
              id: item.id,
              title: `Load ${item.loadNumber}`,
              subtitle: [item.pickupLocation, item.deliveryLocation].filter(Boolean).join(" → "),
              href: `/loads/${item.id}`,
            })),
          },
          {
            type: "fuelAdvances",
            label: "Fuel Advances",
            results: fuelAdvanceResults.map(item => ({
              id: item.id,
              title: item.carrierName,
              subtitle: `$${item.advanceAmount}`,
              href: `/fuel-advance/${item.id}`,
            })),
          },
          {
            type: "tickets",
            label: "Tickets",
            results: ticketResults.map(item => ({
              id: item.id,
              title: `${item.ticketNumber}: ${item.title}`,
              subtitle: item.status,
              href: `/tickets/${item.id}`,
            })),
          },
          {
            type: "tasks",
            label: "Tasks",
            results: taskResults.map(item => ({
              id: item.id,
              title: item.title,
              subtitle: item.status,
              href: `/tasks/${item.id}`,
            })),
          },
          {
            type: "dispatchers",
            label: "Dispatchers",
            results: dispatcherResults.map(item => {
              const name = `${item.firstName} ${item.lastName}`.trim();
              return {
                id: item.id,
                title: name,
                subtitle: item.email || item.phone || "",
                href: `/dispatchers?search=${encodeURIComponent(name)}`,
              };
            }),
          },
          {
            type: "trucks",
            label: "Trucks",
            results: truckResults.map(item => ({
              id: item.id,
              title: `Truck ${item.truckNumber}`,
              subtitle: [item.make, item.model, item.licensePlate, item.vin].filter(Boolean).join(" · "),
              href: `/trucks?search=${encodeURIComponent(item.truckNumber)}`,
            })),
          },
        ].filter(group => group.results.length > 0),
      });
    } catch (error) {
      console.error("Error performing global search:", error);
      res.status(500).json({ message: "Failed to perform search" });
    }
  });

  // Fuel card applications
  app.get("/api/fuel-card-applications", requireAuth, async (_req: any, res) => {
    try {
      const applications = await storage.getFuelCardApplications();
      res.json(applications);
    } catch (error) {
      console.error("Error fetching fuel card applications:", error);
      res.status(500).json({ message: "Failed to fetch applications" });
    }
  });

  app.post("/api/fuel-card-applications", async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const applicationData = { ...req.body, submittedBy: userId };
      const application = await storage.createFuelCardApplication(applicationData);

      await storage.createActivity({
        userId,
        type: "fuel_card_application",
        description: `Applied for ${req.body.cardType} fuel card`,
        entityType: "fuel_card_application",
        entityId: application.id,
      });

      res.status(201).json(application);
    } catch (error) {
      console.error("Error creating fuel card application:", error);
      res.status(500).json({ message: "Failed to create application" });
    }
  });

  app.patch("/api/fuel-card-applications/:id", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const id = parseInt(req.params.id, 10);
      const { status, notes } = req.body;

      const application = await storage.updateFuelCardApplication(id, {
        status,
        notes,
        reviewedBy: userId,
        reviewedAt: new Date(),
      });

      await storage.createActivity({
        userId,
        type: "fuel_card_review",
        description: `Reviewed fuel card application - Status: ${status}`,
        entityType: "fuel_card_application",
        entityId: application.id,
      });

      res.json(application);
    } catch (error) {
      console.error("Error updating fuel card application:", error);
      res.status(500).json({ message: "Failed to update application" });
    }
  });

  // Time tracking
  // ─── Time Tracking Admin Routes ────────────────────────────────────────────
  app.get("/api/time-tracking/summary", requireAdmin, async (_req, res) => {
    try {
      const now = new Date();
      // Start of this week (Monday)
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      startOfWeek.setHours(0, 0, 0, 0);
      // Start of pay period (14-day biweekly from a fixed epoch)
      const epoch = new Date("2024-01-01");
      const msSinceEpoch = now.getTime() - epoch.getTime();
      const payPeriodMs = 14 * 24 * 60 * 60 * 1000;
      const currentPeriodStart = new Date(epoch.getTime() + Math.floor(msSinceEpoch / payPeriodMs) * payPeriodMs);

      const allUsers = await db.select().from(users).orderBy(users.firstName);
      const weekEntries = await db.select().from(timeEntries)
        .where(sql`${timeEntries.clockInTime} >= ${startOfWeek}`);
      const periodEntries = await db.select().from(timeEntries)
        .where(sql`${timeEntries.clockInTime} >= ${currentPeriodStart}`);
      const liveEntries = await db.select().from(timeEntries)
        .where(eq(timeEntries.status, "clocked_in"));

      const summary = allUsers.map((u) => {
        const weekHrs = weekEntries
          .filter((e) => e.userId === u.id && e.status === "clocked_out")
          .reduce((s, e) => s + parseFloat(e.totalHours ?? "0"), 0);
        const periodHrs = periodEntries
          .filter((e) => e.userId === u.id && e.status === "clocked_out")
          .reduce((s, e) => s + parseFloat(e.totalHours ?? "0"), 0);
        const live = liveEntries.find((e) => e.userId === u.id);
        const lastEntry = [...weekEntries.filter((e) => e.userId === u.id)]
          .sort((a, b) => new Date(b.clockInTime).getTime() - new Date(a.clockInTime).getTime())[0];
        return {
          userId: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          clockedIn: !!live,
          clockInTime: live?.clockInTime ?? null,
          weekHours: Math.round(weekHrs * 100) / 100,
          periodHours: Math.round(periodHrs * 100) / 100,
          lastActivity: lastEntry?.clockInTime ?? null,
          todayHours: weekEntries
            .filter((e) => e.userId === u.id && e.status === "clocked_out" &&
              new Date(e.clockInTime).toDateString() === now.toDateString())
            .reduce((s, e) => s + parseFloat(e.totalHours ?? "0"), 0),
        };
      });
      res.json(summary);
    } catch (error) {
      console.error("Error fetching time tracking summary:", error);
      res.status(500).json({ message: "Failed to fetch summary" });
    }
  });

  app.get("/api/time-tracking/agent/:id", requireAdmin, async (req, res) => {
    try {
      const userId = req.params.id;
      const [agent] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const entries = await db.select().from(timeEntries)
        .where(eq(timeEntries.userId, userId))
        .orderBy(desc(timeEntries.clockInTime));

      // Group by calendar day
      const byDay: Record<string, typeof entries> = {};
      for (const e of entries) {
        const day = new Date(e.clockInTime).toLocaleDateString("en-CA"); // YYYY-MM-DD
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(e);
      }

      const startOfWeek = new Date();
      startOfWeek.setDate(new Date().getDate() - ((new Date().getDay() + 6) % 7));
      startOfWeek.setHours(0, 0, 0, 0);
      let weekTotal = 0;

      const days = Object.entries(byDay).map(([date, dayEntries]) => {
        const dayHrs = dayEntries
          .filter((e) => e.status === "clocked_out")
          .reduce((s, e) => s + parseFloat(e.totalHours ?? "0"), 0);
        const rounded = Math.round(dayHrs * 100) / 100;
        if (new Date(date) >= startOfWeek) weekTotal += rounded;
        return {
          date,
          entries: dayEntries.map((e) => ({
            id: e.id,
            clockIn: e.clockInTime,
            clockOut: e.clockOutTime,
            hours: e.totalHours ? parseFloat(e.totalHours) : null,
            status: e.status,
            notes: e.notes,
          })),
          totalHours: rounded,
          overtime: rounded > 8,
        };
      });

      res.json({
        userId: agent.id,
        firstName: agent.firstName,
        lastName: agent.lastName,
        role: agent.role,
        days,
        weekTotal: Math.round(weekTotal * 100) / 100,
        weekOvertime: weekTotal > 40,
      });
    } catch (error) {
      console.error("Error fetching agent time detail:", error);
      res.status(500).json({ message: "Failed to fetch agent detail" });
    }
  });

  app.get("/api/time-tracking/live", requireAdmin, async (_req, res) => {
    try {
      const live = await db.select().from(timeEntries)
        .where(eq(timeEntries.status, "clocked_in"));
      const userIds = [...new Set(live.map((e) => e.userId))];
      const agentRows = userIds.length
        ? await db.select().from(users).where(sql`${users.id} IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`)
        : [];
      const agentMap = Object.fromEntries(agentRows.map((u) => [u.id, u]));
      const result = live.map((e) => {
        const agent = agentMap[e.userId];
        const durationMs = Date.now() - new Date(e.clockInTime).getTime();
        const hours = durationMs / (1000 * 60 * 60);
        return {
          userId: e.userId,
          firstName: agent?.firstName ?? "Unknown",
          lastName: agent?.lastName ?? "",
          role: agent?.role ?? "",
          clockInTime: e.clockInTime,
          durationHours: Math.round(hours * 100) / 100,
        };
      });
      res.json(result);
    } catch (error) {
      console.error("Error fetching live agents:", error);
      res.status(500).json({ message: "Failed to fetch live agents" });
    }
  });

  app.get("/api/time-tracking/status", requireAuth, async (req: any, res) => {
    try {
      const currentEntry = await storage.getCurrentTimeEntry(req.user.id);
      const todayEntries = await storage.getTodayTimeEntries(req.user.id);

      res.json({
        isClocked: !!currentEntry,
        currentEntry,
        todayEntries,
        todayHours: todayEntries
          .filter((entry) => entry.status === "clocked_out")
          .reduce((total, entry) => total + parseFloat(entry.totalHours || "0"), 0),
      });
    } catch (error) {
      console.error("Error fetching time tracking status:", error);
      res.status(500).json({ message: "Failed to fetch time tracking status" });
    }
  });

  app.post("/api/time-tracking/clock-in", requireAuth, async (req: any, res) => {
    try {
      const timeEntry = await storage.clockIn(req.user.id, req.body.notes);
      res.json(timeEntry);
    } catch (error) {
      console.error("Error clocking in:", error);
      res.status(400).json({ message: (error as Error).message || "Failed to clock in" });
    }
  });

  app.post("/api/time-tracking/clock-out", requireAuth, async (req: any, res) => {
    try {
      const timeEntry = await storage.clockOut(req.user.id, req.body.notes);
      res.json(timeEntry);
    } catch (error) {
      console.error("Error clocking out:", error);
      res.status(400).json({ message: (error as Error).message || "Failed to clock out" });
    }
  });

  app.get("/api/time-tracking/entries", requireAuth, async (req: any, res) => {
    try {
      const { period } = req.query;

      let entries;
      if (period === "today") {
        entries = await storage.getTodayTimeEntries(req.user.id);
      } else if (period === "week") {
        entries = await storage.getWeekTimeEntries(req.user.id);
      } else {
        entries = await storage.getTimeEntries(req.user.id);
      }

      res.json(entries);
    } catch (error) {
      console.error("Error fetching time entries:", error);
      res.status(500).json({ message: "Failed to fetch time entries" });
    }
  });

  // Expenses
  const expenseOutput = async (expense: any) => {
    const [submitter] = await db.select({
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    }).from(users).where(eq(users.id, expense.submittedBy)).limit(1);
    const submittedByName = [submitter?.firstName, submitter?.lastName].filter(Boolean).join(" ") || submitter?.email || "Unknown agent";
    return {
      ...expense,
      amount: (Number(expense.amountCents) / 100).toFixed(2),
      submittedByName,
      receiptUrl: expense.receiptKey ? await getSignedViewUrl(expense.receiptKey) : null,
      receiptKey: undefined,
    };
  };
  const expenseId = (req: any) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid expense id");
    return id;
  };
  const canManageExpense = (req: any, expense: any) =>
    req.user.role !== "employee" || expense.submittedBy === req.user.id;
  const expenseDateFilter = (value: unknown, end = false) => {
    if (!value) return undefined;
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) throw new Error("Invalid date filter");
    if (end && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) date.setUTCHours(23, 59, 59, 999);
    return date;
  };
  const parseExpenseAmount = (value: unknown) => {
    const amount = String(value ?? "");
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) throw new Error("Amount must be positive with at most two decimal places");
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("Amount must be greater than zero");
    return cents;
  };
  const expenseCategories = z.enum(["fuel", "office", "travel", "meals", "equipment", "software", "other"]);
  const expenseStatuses = z.enum(["draft", "submitted", "approved", "rejected", "reimbursed"]);

  app.get("/api/expenses", requireModulePermission("expenses"), async (req: any, res) => {
    try {
      const conditions: any[] = [];
      if (req.user.role === "employee") conditions.push(eq(expenses.submittedBy, req.user.id));
      else if (req.query.submittedBy || req.query.userId) conditions.push(eq(expenses.submittedBy, String(req.query.submittedBy ?? req.query.userId)));
      if (req.query.status) conditions.push(eq(expenses.status, expenseStatuses.parse(String(req.query.status))));
      if (req.query.category) conditions.push(eq(expenses.category, expenseCategories.parse(String(req.query.category))));
      const from = expenseDateFilter(req.query.from ?? req.query.startDate ?? req.query.dateFrom);
      const to = expenseDateFilter(req.query.to ?? req.query.endDate ?? req.query.dateTo, true);
      if (from) conditions.push(gte(expenses.expenseDate, from));
      if (to) conditions.push(lte(expenses.expenseDate, to));
      const rows = await db.select().from(expenses)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt));
      res.json(await Promise.all(rows.map(expenseOutput)));
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to fetch expenses" });
    }
  });

  app.get("/api/expenses/:id", requireModulePermission("expenses"), async (req: any, res) => {
    try {
      const [expense] = await db.select().from(expenses).where(eq(expenses.id, expenseId(req)));
      if (!expense) return res.status(404).json({ message: "Expense not found" });
      if (!canManageExpense(req, expense)) return res.status(403).json({ message: "You can only access your own expenses" });
      res.json(await expenseOutput(expense));
    } catch (error: any) { res.status(400).json({ message: error.message || "Failed to fetch expense" }); }
  });

  app.post("/api/expenses", requireModulePermission("expenses"), handleUpload("receipt"), async (req: any, res) => {
    let createdId: number | undefined;
    let uploadedKey: string | undefined;
    try {
      if (req.file && !hasAllowedCarrierDocumentSignature(req.file)) return res.status(400).json({ message: "Invalid receipt file" });
      const body = { ...req.body, submittedBy: req.user.role === "employee" ? req.user.id : (req.body.submittedBy || req.user.id) };
      if (body.amountCents === undefined && body.amount !== undefined) {
        body.amountCents = parseExpenseAmount(body.amount);
      }
      const input = insertExpenseSchema.parse(body);
      let [expense] = await db.insert(expenses).values(input as any).returning();
      createdId = expense.id;
      if (req.file) {
        const key = `expenses/${req.user.id}/${expense.id}/${crypto.randomUUID()}-${sanitizeOriginalName(req.file.originalname)}`;
        await uploadDocumentToS3(req.file, key);
        uploadedKey = key;
        [expense] = await db.update(expenses).set({ receiptKey: key, receiptName: sanitizeOriginalName(req.file.originalname), receiptMimeType: req.file.mimetype, receiptSize: req.file.size }).where(eq(expenses.id, expense.id)).returning();
      }
      res.status(201).json(await expenseOutput(expense));
    } catch (error: any) {
      if (uploadedKey) await deleteFromS3(uploadedKey);
      if (createdId) await db.delete(expenses).where(eq(expenses.id, createdId)).catch(() => undefined);
      res.status(400).json({ message: error?.issues?.[0]?.message || error.message || "Invalid expense" });
    }
  });

  app.patch("/api/expenses/:id", requireModulePermission("expenses"), async (req: any, res) => {
    try {
      const id = expenseId(req);
      const [existing] = await db.select().from(expenses).where(eq(expenses.id, id));
      if (!existing) return res.status(404).json({ message: "Expense not found" });
      if (!canManageExpense(req, existing)) return res.status(403).json({ message: "You can only modify your own expenses" });
      if (req.body.status === "reimbursed" && req.user.role !== "employee" && existing.status === "approved") {
        const [updated] = await db.update(expenses).set({ status: "reimbursed", updatedAt: new Date() }).where(eq(expenses.id, id)).returning();
        return res.json(await expenseOutput(updated));
      }
      if (!["draft", "rejected"].includes(existing.status)) return res.status(409).json({ message: "Only draft or rejected expenses can be modified" });
      const allowed: any = {};
      for (const key of ["title", "category", "description", "expenseDate", "notes"]) if (req.body[key] !== undefined) allowed[key] = req.body[key];
      if (req.body.amount !== undefined) allowed.amountCents = parseExpenseAmount(req.body.amount);
      if (allowed.expenseDate !== undefined) allowed.expenseDate = new Date(allowed.expenseDate);
      if (allowed.amountCents !== undefined) allowed.amountCents = Number(allowed.amountCents);
      if (req.body.status !== undefined && !["draft", "submitted"].includes(req.body.status)) {
        return res.status(400).json({ message: "Approval and rejection must use their dedicated endpoints" });
      }
      if (req.body.status !== undefined) allowed.status = req.body.status;
      const [updated] = await db.update(expenses).set({ ...allowed, updatedAt: new Date() }).where(eq(expenses.id, id)).returning();
      res.json(await expenseOutput(updated));
    } catch (error: any) { res.status(400).json({ message: error.message || "Failed to update expense" }); }
  });

  app.patch("/api/expenses/:id/approve", requireModulePermission("expenses"), requireManagerOrAdmin, async (req: any, res) => {
    try {
      const id = expenseId(req);
      const [updated] = await db.update(expenses).set({ status: "approved", approvedBy: req.user.id, approvedAt: new Date(), rejectionReason: null, updatedAt: new Date() })
        .where(and(eq(expenses.id, id), eq(expenses.status, "submitted"))).returning();
      if (!updated) return res.status(404).json({ message: "Expense not found or not awaiting approval" });
      res.json(await expenseOutput(updated));
    } catch (error: any) { res.status(400).json({ message: error.message || "Failed to approve expense" }); }
  });

  app.patch("/api/expenses/:id/reject", requireModulePermission("expenses"), requireManagerOrAdmin, async (req: any, res) => {
    try {
      const reason = z.string().trim().min(1, "Rejection reason is required").parse(req.body?.reason);
      const id = expenseId(req);
      const [updated] = await db.update(expenses).set({ status: "rejected", rejectionReason: reason, rejectedBy: req.user.id, rejectedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(expenses.id, id), eq(expenses.status, "submitted"))).returning();
      if (!updated) return res.status(404).json({ message: "Expense not found or not awaiting approval" });
      res.json(await expenseOutput(updated));
    } catch (error: any) { res.status(400).json({ message: error.message || "Failed to reject expense" }); }
  });

  app.delete("/api/expenses/:id", requireModulePermission("expenses"), async (req: any, res) => {
    try {
      const id = expenseId(req);
      const [expense] = await db.select().from(expenses).where(eq(expenses.id, id));
      if (!expense) return res.status(404).json({ message: "Expense not found" });
      if (!canManageExpense(req, expense)) return res.status(403).json({ message: "You can only delete your own expenses" });
      if (expense.status !== "draft") return res.status(409).json({ message: "Only draft expenses can be deleted" });
      if (expense.receiptKey) await deleteFromS3Strict(expense.receiptKey);
      await db.delete(expenses).where(eq(expenses.id, id));
      res.status(204).send();
    } catch (error: any) { res.status(400).json({ message: error.message || "Failed to delete expense" }); }
  });

  app.post("/api/expenses/:id/receipt", requireModulePermission("expenses"), handleUpload("receipt"), async (req: any, res) => {
    let uploadedKey: string | undefined;
    try {
      const id = expenseId(req);
      const [expense] = await db.select().from(expenses).where(eq(expenses.id, id));
      if (!expense) return res.status(404).json({ message: "Expense not found" });
      if (!canManageExpense(req, expense)) return res.status(403).json({ message: "You can only upload receipts for your own expenses" });
      if (!["draft", "rejected"].includes(expense.status)) return res.status(409).json({ message: "Receipts can only be uploaded to draft or rejected expenses" });
      if (!req.file || !hasAllowedCarrierDocumentSignature(req.file)) return res.status(400).json({ message: "Invalid receipt file" });
      const key = `expenses/${req.user.id}/${id}/${crypto.randomUUID()}-${sanitizeOriginalName(req.file.originalname)}`;
      await uploadDocumentToS3(req.file, key);
      uploadedKey = key;
      const [updated] = await db.update(expenses).set({ receiptKey: key, receiptName: sanitizeOriginalName(req.file.originalname), receiptMimeType: req.file.mimetype, receiptSize: req.file.size, updatedAt: new Date() }).where(eq(expenses.id, id)).returning();
      uploadedKey = undefined;
      if (expense.receiptKey) {
        await deleteFromS3Strict(expense.receiptKey).catch((error) => {
          console.error("[Expenses] Could not remove replaced receipt:", expense.receiptKey, error);
        });
      }
      res.json(await expenseOutput(updated));
    } catch (error: any) {
      if (uploadedKey) await deleteFromS3Strict(uploadedKey).catch(() => undefined);
      res.status(400).json({ message: error.message || "Failed to upload receipt" });
    }
  });

  // Calendar
  const calendarRange = (req: any) => {
    const fromValue = req.query.from ?? req.query.startDate;
    const toValue = req.query.to ?? req.query.endDate;
    const from = fromValue ? new Date(String(fromValue)) : new Date();
    const to = toValue ? new Date(String(toValue)) : new Date(from.getTime() + 31 * 86400000);
    if (toValue && /^\d{4}-\d{2}-\d{2}$/.test(String(toValue))) {
      to.setUTCHours(23, 59, 59, 999);
    }
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new Error("Invalid calendar date range");
    return { from, to };
  };
  const calendarVisible = (req: any, event: any) =>
    req.user.role !== "employee" || event.assignedTo === req.user.id;
  const calendarInput = (body: any, user: any, createdBy = user.id) => ({
    ...body,
    startAt: body.startAt ?? (body.startDate && body.startTime ? `${body.startDate}T${body.startTime}` : body.startDate),
    endAt: body.endAt ?? (body.endDate && body.endTime ? `${body.endDate}T${body.endTime}` : body.endDate),
    createdBy,
    userId: body.userId || createdBy,
    assignedTo: user.role === "employee" ? user.id : (body.assignedTo ?? null),
    carrierId: body.carrierId ?? body.clientId ?? null,
  });
  const calendarOutput = (event: any) => ({
    ...event,
    startDate: (event.occurrenceStart ?? event.startAt)?.toISOString?.().slice(0, 10),
    endDate: (event.occurrenceEnd ?? event.endAt)?.toISOString?.().slice(0, 10),
    startTime: (event.occurrenceStart ?? event.startAt)?.toISOString?.().slice(11, 16),
    endTime: (event.occurrenceEnd ?? event.endAt)?.toISOString?.().slice(11, 16),
  });
  const calendarResponse = (events: any[], from: Date, to: Date) =>
    events.flatMap((event) => expandCalendarEvent(event, from, to).map(calendarOutput));

  app.get(["/api/calendar/events", "/api/calendar"], requireAuth, async (req: any, res) => {
    try {
      const { from, to } = calendarRange(req);
      const conditions: any[] = [];
      if (req.user.role === "employee") conditions.push(eq(calendarEvents.assignedTo, req.user.id));
      else if (req.query.userId) conditions.push(eq(calendarEvents.assignedTo, String(req.query.userId)));
      const rows = await db.select().from(calendarEvents).where(conditions.length ? and(...conditions) : undefined).orderBy(calendarEvents.startAt);
      res.json(calendarResponse(rows, from, to));
    } catch (error: any) { res.status(400).json({ message: error.message || "Failed to fetch calendar events" }); }
  });
  app.get("/api/calendar/today", requireAuth, async (req: any, res) => {
    const now = new Date(); const from = new Date(now); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    try {
      const scope = or(eq(calendarEvents.assignedTo, req.user.id), eq(calendarEvents.createdBy, req.user.id));
      const rows = await db.select().from(calendarEvents).where(scope).orderBy(calendarEvents.startAt);
      res.json(calendarResponse(rows, from, to));
    } catch { res.status(500).json({ message: "Failed to fetch today's events" }); }
  });
  app.post("/api/calendar/events", requireAuth, async (req: any, res) => {
    try {
      const input = insertCalendarEventSchema.parse(calendarInput(req.body, req.user));
      if (input.endAt <= input.startAt) return res.status(400).json({ message: "Event end must be after start" });
      const [assigned] = input.assignedTo ? await db.select({ id: users.id }).from(users).where(eq(users.id, input.assignedTo)) : [true];
      if (!assigned) return res.status(400).json({ message: "Assigned user not found" });
      for (const [table, id, label] of [[clients, input.carrierId, "Carrier"], [brokers, input.brokerId, "Broker"], [invoices, input.invoiceId, "Invoice"]] as const) {
        if (id != null && !(await db.select({ id: (table as any).id }).from(table as any).where(eq((table as any).id, id))).length) return res.status(400).json({ message: `${label} not found` });
      }
      const [event] = await db.insert(calendarEvents).values(input).returning();
      res.status(201).json(calendarOutput(event));
    } catch (error: any) { res.status(400).json({ message: error?.issues?.[0]?.message || error.message || "Invalid calendar event" }); }
  });
  app.patch("/api/calendar/events/:id", requireAuth, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const [existing] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
      if (!existing || !calendarVisible(req, existing)) return res.status(404).json({ message: "Calendar event not found" });
      const patchBody = { ...existing, ...req.body,
        createdBy: existing.createdBy,
        userId: existing.userId,
        assignedTo: req.user.role === "employee" ? req.user.id : (req.body.assignedTo !== undefined ? req.body.assignedTo : existing.assignedTo),
      };
      const merged = calendarInput(patchBody, req.user, existing.createdBy);
      const updates = insertCalendarEventSchema.partial().parse(merged);
      if (req.user.role === "employee" && updates.assignedTo !== req.user.id) {
        return res.status(403).json({ message: "Employees may only assign events to themselves" });
      }
      if (merged.endAt <= merged.startAt) return res.status(400).json({ message: "Event end must be after start" });
      if (updates.assignedTo && !(await db.select({ id: users.id }).from(users).where(eq(users.id, updates.assignedTo))).length) return res.status(400).json({ message: "Assigned user not found" });
      const [event] = await db.update(calendarEvents).set({ ...updates, updatedAt: new Date(), reminderSentAt: null }).where(eq(calendarEvents.id, id)).returning();
      res.json(calendarOutput(event));
    } catch (error: any) { res.status(400).json({ message: error?.issues?.[0]?.message || error.message || "Invalid calendar event" }); }
  });
  app.delete("/api/calendar/events/:id", requireAuth, async (req: any, res) => {
    const id = Number(req.params.id);
    const [existing] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
    if (!existing || !calendarVisible(req, existing)) return res.status(404).json({ message: "Calendar event not found" });
    await db.delete(calendarEvents).where(eq(calendarEvents.id, id));
    res.status(204).send();
  });

  // Notifications
  app.get("/api/notifications", requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const limit = parseInt(req.query.limit as string, 10) || 20;
      const notifications = await storage.getNotifications(userId, limit);
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.get("/api/notifications/unread-count", requireAuth, async (req: any, res) => {
    try {
      const count = await storage.getUnreadNotificationCount(req.user.id);
      res.json({ count });
    } catch (error) {
      console.error("Error fetching unread notification count:", error);
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  // ─── Internal agent chat ───────────────────────────────────────────────────
  const chatPermission = requireModulePermission("chat");
  const chatChannelIdSchema = z.coerce.number().int().positive();

  let defaultChatChannelsReady: Promise<void> | null = null;
  const ensurePublicChatMembership = async (userId: string) => {
    defaultChatChannelsReady ??= ensureDefaultChatChannels().catch(error => {
      defaultChatChannelsReady = null;
      throw error;
    });
    await defaultChatChannelsReady;
    const publicChannels = await db.select({ id: chatChannels.id })
      .from(chatChannels).where(eq(chatChannels.type, "channel"));
    if (publicChannels.length) {
      await db.insert(chatMembers).values(publicChannels.map(channel => ({
        channelId: channel.id, userId,
      }))).onConflictDoNothing();
    }
  };

  app.get("/api/chat/channels", chatPermission, async (req: any, res) => {
    try {
      const userId = req.user.id as string;
      const [messageSnapshot] = await db.select({
        cursor: sql<number>`coalesce(max(${chatMessages.id}), 0)`,
      }).from(chatMessages);
      await ensurePublicChatMembership(userId);
      const channels = await db.select().from(chatChannels)
        .leftJoin(chatMembers, and(eq(chatMembers.channelId, chatChannels.id), eq(chatMembers.userId, userId)))
        .where(or(eq(chatChannels.type, "channel"), sql`${chatMembers.userId} IS NOT NULL`));
      const result = await Promise.all(channels.map(async ({ chat_channels: channel, chat_members: membership }) => {
        const members = await db.select({
          id: users.id, name: sql<string>`trim(concat(coalesce(${users.firstName}, ''), ' ', coalesce(${users.lastName}, '')))`,
          profileImageUrl: users.profileImageUrl,
        }).from(chatMembers).innerJoin(users, eq(users.id, chatMembers.userId))
          .where(eq(chatMembers.channelId, channel.id));
        const unread = await db.select({ count: count() }).from(chatMessages)
          .where(and(eq(chatMessages.channelId, channel.id),
            membership?.lastReadAt ? sql`${chatMessages.createdAt} > ${membership.lastReadAt}` : sql`true`));
        const directOther = channel.type === "direct" ? members.find(member => member.id !== userId) : undefined;
        return {
          id: channel.id, name: channel.name, type: channel.type,
          unreadCount: Number(unread[0]?.count ?? 0), members,
          directName: directOther?.name || null,
          directProfileImageUrl: directOther?.profileImageUrl || null,
        };
      }));
      res.setHeader("X-Chat-Message-Cursor", String(messageSnapshot?.cursor ?? 0));
      res.json(result);
    } catch (error) {
      console.error("Error fetching chat channels:", error);
      res.status(500).json({ message: "Failed to fetch chat channels" });
    }
  });

  app.post("/api/chat/channels/direct", chatPermission, async (req: any, res) => {
    try {
      const { userId } = z.object({ userId: z.string().trim().min(1).max(255) }).strict().parse(req.body);
      const me = req.user.id as string;
      if (userId === me) return res.status(400).json({ message: "Cannot create a direct channel with yourself" });
      const [other] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, userId), eq(users.status, "active")));
      if (!other) return res.status(404).json({ message: "Active user not found" });
      const directKey = JSON.stringify([me, userId].sort());
      const existing = await db.select().from(chatChannels).where(eq(chatChannels.directKey, directKey));
      let channel = existing[0];
      if (!channel) {
        try {
          const inserted = await db.insert(chatChannels).values({ type: "direct", directKey }).returning();
          channel = inserted[0];
          if (channel) await db.insert(chatMembers).values([
            { channelId: channel.id, userId: me }, { channelId: channel.id, userId },
          ]).onConflictDoNothing();
        } catch (error: any) {
          if (error?.code !== "23505") throw error;
          channel = (await db.select().from(chatChannels).where(eq(chatChannels.directKey, directKey)))[0];
        }
      }
      if (!channel) return res.status(500).json({ message: "Unable to create direct channel" });
      await db.insert(chatMembers).values([
        { channelId: channel.id, userId: me }, { channelId: channel.id, userId },
      ]).onConflictDoNothing();
      res.status(201).json(channel);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message || "Invalid request" });
      console.error("Error creating direct chat channel:", error);
      res.status(500).json({ message: "Failed to create direct channel" });
    }
  });

  app.post("/api/chat/channels", chatPermission, async (req: any, res) => {
    try {
      const { name } = createChatChannelSchema.parse(req.body);
      await ensurePublicChatMembership(req.user.id);
      const channel = await createPublicChatChannel(name, req.user.id);
      res.status(201).json(channel);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message || "Invalid channel name" });
      if (error instanceof ChatChannelNameConflict || error?.code === "23505") {
        return res.status(409).json({ message: "A channel with that name already exists." });
      }
      console.error("Error creating public chat channel:", error);
      res.status(500).json({ message: "Failed to create channel" });
    }
  });

  app.get("/api/chat/users", chatPermission, async (req: any, res) => {
    try {
      const channelId = req.query.channelId === undefined ? undefined : chatChannelIdSchema.parse(req.query.channelId);
      if (channelId !== undefined) await assertChatMembership(db, channelId, req.user.id);
      const people = await getMentionStaff(db, channelId);
      res.json(channelId === undefined ? people.filter(person => person.id !== req.user.id) : people);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid channel ID" });
      if (error instanceof ChatMessageError) return res.status(error.statusCode).json({ message: error.message });
      console.error("Error fetching chat users:", error);
      res.status(500).json({ message: "Failed to fetch chat users" });
    }
  });

  app.get("/api/chat/channels/:id/messages", chatPermission, async (req: any, res) => {
    try {
      const channelId = chatChannelIdSchema.parse(req.params.id);
      const afterRaw = req.query.after;
      const afterIdRaw = req.query.afterId;
      const limitRaw = req.query.limit;
      let after: Date | undefined;
      if (afterRaw !== undefined) {
        if (typeof afterRaw !== "string" || !afterRaw || Number.isNaN(Date.parse(afterRaw))) {
          return res.status(400).json({ message: "after must be a valid ISO timestamp" });
        }
        after = new Date(afterRaw);
      }
      let afterId: number | undefined;
      if (afterIdRaw !== undefined) {
        if (typeof afterIdRaw !== "string" || !/^\d+$/.test(afterIdRaw)) {
          return res.status(400).json({ message: "afterId must be a non-negative integer" });
        }
        afterId = Number(afterIdRaw);
      }
      if (after !== undefined && afterId !== undefined) {
        return res.status(400).json({ message: "Use either after or afterId, not both" });
      }
      let pageLimit = 50;
      if (afterId !== undefined) {
        if (limitRaw !== undefined && (typeof limitRaw !== "string" || !/^\d+$/.test(limitRaw))) {
          return res.status(400).json({ message: "limit must be an integer from 1 to 200" });
        }
        pageLimit = limitRaw === undefined ? 100 : Number(limitRaw);
        if (pageLimit < 1 || pageLimit > 200) {
          return res.status(400).json({ message: "limit must be an integer from 1 to 200" });
        }
      }
      const [membership] = await db.select().from(chatMembers)
        .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, req.user.id)));
      if (!membership) return res.status(403).json({ message: "Chat channel access required" });
      const messageFilter = afterId !== undefined
        ? and(eq(chatMessages.channelId, channelId), gt(chatMessages.id, afterId))
        : after
          ? and(eq(chatMessages.channelId, channelId), gt(chatMessages.createdAt, after))
          : and(eq(chatMessages.channelId, channelId), sql`${chatMessages.parentMessageId} IS NULL`);
      const messages = await db.select(chatMessageSelection).from(chatMessages).innerJoin(users, eq(users.id, chatMessages.senderId))
        .where(messageFilter)
        .orderBy(...(afterId !== undefined
          ? [asc(chatMessages.id)]
          : [desc(chatMessages.createdAt), desc(chatMessages.id)]))
        .limit(pageLimit);
      res.json(afterId !== undefined ? messages : messages.reverse());
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid channel ID" });
      console.error("Error fetching chat messages:", error);
      res.status(500).json({ message: "Failed to fetch chat messages" });
    }
  });

  app.get("/api/chat/channels/:id/threads/:messageId", chatPermission, async (req: any, res) => {
    try {
      const channelId = chatChannelIdSchema.parse(req.params.id);
      const rootId = chatChannelIdSchema.parse(req.params.messageId);
      const afterId = z.coerce.number().int().nonnegative().safe().parse(req.query.afterId ?? 0);
      res.json(await getChatThread(db, channelId, rootId, req.user.id, afterId));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid thread or pagination ID" });
      if (error instanceof ChatMessageError) return res.status(error.statusCode).json({ message: error.message });
      console.error("Error fetching chat thread:", error);
      res.status(500).json({ message: "Failed to fetch chat thread" });
    }
  });

  app.post("/api/chat/channels/:id/messages", chatPermission, async (req: any, res) => {
    try {
      const channelId = chatChannelIdSchema.parse(req.params.id);
      const message = await db.transaction(tx => createChatMessage(tx, channelId, req.user.id, req.body));
      res.status(201).json(message);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message || "Invalid message" });
      if (error instanceof ChatMessageError) return res.status(error.statusCode).json({ message: error.message });
      console.error("Error sending chat message:", error);
      res.status(500).json({ message: "Failed to send chat message" });
    }
  });

  app.patch("/api/chat/channels/:id/read", chatPermission, async (req: any, res) => {
    try {
      const channelId = chatChannelIdSchema.parse(req.params.id);
      z.object({}).strict().parse(req.body ?? {});
      const [membership] = await db.update(chatMembers)
        .set({ lastReadAt: new Date() })
        .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, req.user.id))).returning();
      if (!membership) return res.status(403).json({ message: "Chat channel access required" });
      res.json({ success: true, lastReadAt: membership.lastReadAt });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid read timestamp" });
      console.error("Error marking chat read:", error);
      res.status(500).json({ message: "Failed to mark chat channel read" });
    }
  });

  app.get("/api/chat/unread-count", chatPermission, async (req: any, res) => {
    try {
      await ensurePublicChatMembership(req.user.id);
      const rows = await db.select({ count: count() }).from(chatMessages)
        .innerJoin(chatMembers, and(eq(chatMembers.channelId, chatMessages.channelId), eq(chatMembers.userId, req.user.id)))
        .where(sql`${chatMembers.lastReadAt} IS NULL OR ${chatMessages.createdAt} > ${chatMembers.lastReadAt}`);
      const unreadCount = Number(rows[0]?.count ?? 0);
      res.json({ count: unreadCount, unreadCount });
    } catch (error) {
      console.error("Error fetching chat unread count:", error);
      res.status(500).json({ message: "Failed to fetch chat unread count" });
    }
  });

  app.patch("/api/notifications/:id/read", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [owned] = await db.select({ id: notifications.id }).from(notifications)
        .where(and(eq(notifications.id, id), eq(notifications.userId, req.user.id))).limit(1);
      if (!owned) return res.status(404).json({ message: "Notification not found" });
      await storage.markNotificationAsRead(id);
      res.json({ message: "Notification marked as read" });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  });

  app.patch("/api/notifications/mark-all-read", requireAuth, async (req: any, res) => {
    try {
      await storage.markAllNotificationsAsRead(req.user.id);
      res.json({ message: "All notifications marked as read" });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      res.status(500).json({ message: "Failed to mark all notifications as read" });
    }
  });

  // Desktop downloads
  app.get("/api/desktop/download/windows", async (_req, res) => {
    try {
      const filePath = path.resolve(process.cwd(), "electron-dist", "FactorFlux-Windows-Portable.tar.gz");

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Windows installer not found" });
      }

      const stats = fs.statSync(filePath);

      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Disposition", 'attachment; filename="FactorFlux-Windows-Portable.tar.gz"');
      res.setHeader("Content-Length", stats.size.toString());
      res.setHeader("Cache-Control", "public, max-age=3600");

      const fileStream = fs.createReadStream(filePath);
      fileStream.on("error", (error) => {
        console.error("Error streaming Windows installer:", error);
        if (!res.headersSent) {
          res.status(500).json({ message: "Error downloading Windows installer" });
        }
      });
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error downloading Windows installer:", error);
      res.status(500).json({ message: "Failed to download Windows installer" });
    }
  });

  app.get("/api/desktop/download/mac", async (_req, res) => {
    try {
      const filePath = path.resolve(process.cwd(), "electron-dist", "FactorFlux-Mac-Installer.tar.gz");

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Mac installer not found" });
      }

      const stats = fs.statSync(filePath);

      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Disposition", 'attachment; filename="FactorFlux-Mac-Installer.tar.gz"');
      res.setHeader("Content-Length", stats.size.toString());
      res.setHeader("Cache-Control", "public, max-age=3600");

      const fileStream = fs.createReadStream(filePath);
      fileStream.on("error", (error) => {
        console.error("Error streaming Mac installer:", error);
        if (!res.headersSent) {
          res.status(500).json({ message: "Error downloading Mac installer" });
        }
      });
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error downloading Mac installer:", error);
      res.status(500).json({ message: "Failed to download Mac installer" });
    }
  });

  app.get("/api/desktop/download/linux", async (_req, res) => {
    try {
      const filePath = path.resolve(process.cwd(), "electron-dist", "FactorFlux-Linux-Portable.tar.gz");

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Linux installer not found" });
      }

      const stats = fs.statSync(filePath);

      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Disposition", 'attachment; filename="FactorFlux-Linux-Portable.tar.gz"');
      res.setHeader("Content-Length", stats.size.toString());
      res.setHeader("Cache-Control", "public, max-age=3600");

      const fileStream = fs.createReadStream(filePath);
      fileStream.on("error", (error) => {
        console.error("Error streaming Linux installer:", error);
        if (!res.headersSent) {
          res.status(500).json({ message: "Error downloading Linux installer" });
        }
      });
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error downloading Linux installer:", error);
      res.status(500).json({ message: "Failed to download Linux installer" });
    }
  });

  app.get("/api/desktop/download/guide", async (_req, res) => {
    try {
      const filePath = path.resolve(process.cwd(), "DESKTOP-TROUBLESHOOTING-GUIDE.md");

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Installation guide not found" });
      }

      const stats = fs.statSync(filePath);

      res.setHeader("Content-Type", "text/markdown");
      res.setHeader("Content-Disposition", 'attachment; filename="FactorFlux-Installation-Guide.md"');
      res.setHeader("Content-Length", stats.size.toString());
      res.setHeader("Cache-Control", "public, max-age=3600");

      const fileStream = fs.createReadStream(filePath);
      fileStream.on("error", (error) => {
        console.error("Error streaming installation guide:", error);
        if (!res.headersSent) {
          res.status(500).json({ message: "Error downloading installation guide" });
        }
      });
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error downloading installation guide:", error);
      res.status(500).json({ message: "Failed to download installation guide" });
    }
  });

  app.post("/api/email/installer-links", requireAuth, async (req: any, res) => {
    try {
      if (req.user?.role !== "manager" && req.user?.role !== "admin") {
        return res.status(403).json({ message: "Only managers and admins can send installer links" });
      }

      const { email, clientName, message } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email address is required" });
      }

      const appUrl = process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : "https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev";

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #2563eb;">FactorFlux Desktop Access</h1>
          ${clientName ? `<p>Hello ${clientName},</p>` : "<p>Hello,</p>"}
          <p>You now have access to FactorFlux, our freight factoring management system. You can access it in two ways:</p>
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="color: #1e40af; margin-top: 0;">🌐 Web Access (Recommended)</h2>
            <p><strong>Live Application:</strong> <a href="${appUrl}" style="color: #2563eb; text-decoration: none; font-weight: bold;">${appUrl}</a></p>
            <p>Access FactorFlux directly in your web browser - no installation required.</p>
          </div>
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="color: #1e40af; margin-top: 0;">💻 Desktop Installers</h2>
            <p>For a desktop-like experience, download the portable launcher for your operating system:</p>
            <div style="margin: 15px 0;"><strong>🪟 Windows:</strong><br><a href="${appUrl}/api/desktop/download/windows" style="color: #2563eb; text-decoration: none;">FactorFlux-Windows-Portable.tar.gz</a> (5.7 MB)</div>
            <div style="margin: 15px 0;"><strong>🍎 Mac:</strong><br><a href="${appUrl}/api/desktop/download/mac" style="color: #2563eb; text-decoration: none;">FactorFlux-Mac-Portable.tar.gz</a> (5.7 MB)</div>
            <div style="margin: 15px 0;"><strong>🐧 Linux:</strong><br><a href="${appUrl}/api/desktop/download/linux" style="color: #2563eb; text-decoration: none;">FactorFlux-Linux-Portable.tar.gz</a> (5.7 MB)</div>
            <div style="margin: 15px 0;"><strong>📖 Setup Guide:</strong><br><a href="${appUrl}/api/desktop/download/guide" style="color: #2563eb; text-decoration: none;">Installation Instructions</a></div>
          </div>
          <h2 style="color: #1e40af;">⚡ Quick Setup for Desktop</h2>
          <ol>
            <li>Download the file for your operating system</li>
            <li>Extract the archive using built-in tools</li>
            <li>Run the startup script (double-click or run in terminal)</li>
            <li>FactorFlux opens automatically in your browser</li>
          </ol>
          ${
            message
              ? `<div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0;">
                  <h3 style="color: #047857; margin-top: 0;">Additional Information</h3>
                  <p style="margin-bottom: 0;">${message}</p>
                </div>`
              : ""
          }
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p>If you have any questions or need assistance getting started, please don't hesitate to reach out.</p>
            <p style="color: #6b7280;">Best regards,<br><strong>Trucking Pros Financial Team</strong></p>
          </div>
        </div>
      `;

      const textContent = `
FactorFlux Desktop Access

${clientName ? `Hello ${clientName},` : "Hello,"}

You now have access to FactorFlux, our freight factoring management system.

WEB ACCESS (Recommended):
${appUrl}

DESKTOP INSTALLERS:
• Windows: ${appUrl}/api/download/windows (5.7 MB)
• Mac: ${appUrl}/api/download/mac (5.7 MB)
• Linux: ${appUrl}/api/download/linux (5.7 MB)
• Setup Guide: ${appUrl}/api/download/guide

QUICK SETUP FOR DESKTOP:
1. Download the file for your operating system
2. Extract the archive using built-in tools
3. Run the startup script (double-click or run in terminal)
4. FactorFlux opens automatically in your browser

${message ? `Additional Information: ${message}` : ""}

If you have any questions or need assistance getting started, please don't hesitate to reach out.

Best regards,
Trucking Pros Financial Team
      `.trim();

      console.log("Email would be sent to:", email);
      console.log("Subject:", `FactorFlux Access - ${clientName || "Desktop Installation"}`);
      console.log("Content preview:", `${textContent.substring(0, 200)}...`);

      await storage.createActivity({
        userId: req.user.id,
        type: "installer_links_prepared",
        description: `FactorFlux access prepared for: ${email}${clientName ? ` (${clientName})` : ""}`,
        entityType: "system",
        entityId: null,
      });

      res.json({
        message: "FactorFlux access email prepared successfully",
        emailContent: {
          to: email,
          subject: `FactorFlux Access - ${clientName || "Desktop Installation"}`,
          text: textContent,
          html: htmlContent,
        },
      });
    } catch (error) {
      console.error("Error sending installer links:", error);
      res.status(500).json({ message: "Failed to send installer links" });
    }
  });

  app.get("/api/download/windows", (_req, res) => {
    const filePath = path.resolve(process.cwd(), "electron-dist", "FactorFlux-Windows-Portable.tar.gz");
    if (fs.existsSync(filePath)) {
      return res.download(filePath, "FactorFlux-Windows-Portable.tar.gz");
    }
    return res.status(404).json({ message: "Windows installer not found" });
  });

  app.get("/api/download/mac", (_req, res) => {
    const filePath = path.resolve(process.cwd(), "electron-dist", "FactorFlux-Mac-Portable.tar.gz");
    if (fs.existsSync(filePath)) {
      return res.download(filePath, "FactorFlux-Mac-Portable.tar.gz");
    }
    return res.status(404).json({ message: "Mac installer not found" });
  });

  app.get("/api/download/linux", (_req, res) => {
    const filePath = path.resolve(process.cwd(), "electron-dist", "FactorFlux-Linux-Portable.tar.gz");
    if (fs.existsSync(filePath)) {
      return res.download(filePath, "FactorFlux-Linux-Portable.tar.gz");
    }
    return res.status(404).json({ message: "Linux installer not found" });
  });

  app.get("/api/download/guide", (_req, res) => {
    const filePath = path.resolve(process.cwd(), "USER-INSTALLATION-GUIDE.md");
    if (fs.existsSync(filePath)) {
      return res.download(filePath, "USER-INSTALLATION-GUIDE.md");
    }
    return res.status(404).json({ message: "Installation guide not found" });
  });

  app.get("/api/downloads", (_req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>FactorFlux Desktop Downloads</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          .download-card { background: #f5f5f5; padding: 20px; margin: 10px 0; border-radius: 8px; }
          .download-btn { background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 5px; }
          .download-btn:hover { background: #1d4ed8; }
          .file-size { color: #666; font-size: 0.9em; }
        </style>
      </head>
      <body>
        <h1>🚀 FactorFlux Desktop Installers</h1>
        <p>Download the portable desktop version for your operating system:</p>
        <div class="download-card">
          <h3>🪟 Windows</h3>
          <p>For Windows 10 and later</p>
          <a href="/api/download/windows" class="download-btn">Download Windows Version</a>
          <span class="file-size">(5.7 MB)</span>
        </div>
        <div class="download-card">
          <h3>🍎 Mac</h3>
          <p>For macOS 10.15 and later</p>
          <a href="/api/download/mac" class="download-btn">Download Mac Version</a>
          <span class="file-size">(5.7 MB)</span>
        </div>
        <div class="download-card">
          <h3>🐧 Linux</h3>
          <p>For most Linux distributions</p>
          <a href="/api/download/linux" class="download-btn">Download Linux Version</a>
          <span class="file-size">(5.7 MB)</span>
        </div>
        <div class="download-card">
          <h3>📖 Installation Guide</h3>
          <p>Complete setup instructions and troubleshooting</p>
          <a href="/api/download/guide" class="download-btn">Download Guide</a>
        </div>
        <h2>🛠️ Quick Setup:</h2>
        <ol>
          <li>Download the file for your operating system</li>
          <li>Extract the archive (no special software needed)</li>
          <li>Run the startup script</li>
          <li>FactorFlux opens in your browser automatically</li>
        </ol>
        <p><strong>Requirements:</strong> Node.js must be installed on your computer (download from <a href="https://nodejs.org/">nodejs.org</a>)</p>
      </body>
      </html>
    `);
  });

  // Collections
  app.get("/api/collections", requireAuth, async (_req: any, res) => {
    try {
      const collectionsData = await storage.getAllCollections();
      res.json(collectionsData);
    } catch (error) {
      console.error("Error fetching collections:", error);
      res.status(500).json({ message: "Failed to fetch collections" });
    }
  });

  app.get("/api/collections/client-performance", requireAuth, async (_req: any, res) => {
    try {
      const performanceData = await storage.getClientPerformanceData();
      res.json(performanceData);
    } catch (error) {
      console.error("Error fetching client performance data:", error);
      res.status(500).json({ message: "Failed to fetch client performance data" });
    }
  });

  app.get("/api/collections/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const collection = await storage.getCollection(id);

      if (!collection) {
        return res.status(404).json({ message: "Collection not found" });
      }

      res.json(collection);
    } catch (error) {
      console.error("Error fetching collection:", error);
      res.status(500).json({ message: "Failed to fetch collection" });
    }
  });

  app.post("/api/collections", requireAuth, async (req: any, res) => {
    try {
      const collectionData = insertCollectionSchema.parse(req.body);
      const collection = await storage.createCollection({
        ...collectionData,
        assignedTo: collectionData.assignedTo || req.user.id,
      });
      res.status(201).json(collection);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid collection data", errors: error.errors });
      }
      console.error("Error creating collection:", error);
      res.status(500).json({ message: "Failed to create collection" });
    }
  });

  app.patch("/api/collections/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const collection = await storage.updateCollection(id, req.body);
      res.json(collection);
    } catch (error) {
      console.error("Error updating collection:", error);
      res.status(500).json({ message: "Failed to update collection" });
    }
  });

  app.delete("/api/collections/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await storage.deleteCollection(id);

      await storage.createActivity({
        userId: req.user.id,
        type: "collection_deleted",
        description: "Deleted collection",
        entityType: "collection",
        entityId: id,
      });

      res.json({ message: "Collection deleted successfully" });
    } catch (error) {
      console.error("Error deleting collection:", error);
      res.status(500).json({ message: "Failed to delete collection" });
    }
  });

  // Vault — NOTE: specific sub-routes must be registered BEFORE the :clientId wildcard
  app.get("/api/vault/entry/:id", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid vault entry ID" });

      const entry = await storage.getVaultEntry(id);
      if (!entry) return res.status(404).json({ message: "Vault entry not found" });

      await storage.recordVaultAccess(id, req.user.id);
      await storage.createActivity({
        userId: req.user.id,
        type: "vault_accessed",
        description: `Accessed vault entry: ${(entry as any).label}`,
        entityType: "vault",
        entityId: id,
      });

      const decryptedValue = decryptVault((entry as any).encryptedData);
      const { encryptedData: _encryptedData, ...safeEntry } = entry as any;
      res.json({ ...safeEntry, decryptedValue });
    } catch (error) {
      console.error("Error fetching vault entry:", error);
      res.status(500).json({ message: "Failed to fetch vault entry" });
    }
  });

  app.get("/api/vault/:clientId", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      if (Number.isNaN(clientId)) return res.status(400).json({ message: "Invalid client ID" });

      const vaultEntries = await storage.getAllVaultEntries(clientId);
      res.json(vaultEntries.map(({ encryptedData: _encryptedData, ...entry }: any) => entry));
    } catch (error) {
      console.error("Error fetching vault entries:", error);
      res.status(500).json({ message: "Failed to fetch vault entries" });
    }
  });

  // Masked account summaries are safe for authenticated invoice agents; vault
  // mutations and decrypted entries remain manager/admin-only.
  app.get("/api/carriers/:id/bank-accounts", requireAuth, requireModulePermission("invoices"), async (req: any, res) => {
    try {
      const carrierId = parseInt(req.params.id, 10);
      if (Number.isNaN(carrierId)) return res.status(400).json({ message: "Invalid carrier ID" });
      const entries = await storage.getAllVaultEntries(carrierId);
      const accounts = entries
        .filter((entry: any) => entry.dataType === "bank_account" && entry.isActive)
        .map((entry: any) => {
          const decrypted = decryptVault(entry.encryptedData);
          let data: any = {};
          try { data = JSON.parse(decrypted); } catch { data = { accountNumber: decrypted }; }
          const digits = String(data.accountNumber ?? "").replace(/\D/g, "");
          const summary = {
            id: entry.id,
            bankName: data.bankName || "Bank",
            paymentType: data.paymentType === "ACH" || data.paymentType === "Wire" ? data.paymentType : null,
            lastFour: digits.slice(-4).padStart(4, "•"),
          };
          if (req.user.role === "manager" || req.user.role === "admin") {
            return { ...summary, accountType: data.accountType || null, nickname: data.nickname || entry.label };
          }
          return summary;
        });
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching carrier bank accounts:", error);
      res.status(500).json({ message: "Failed to fetch bank accounts" });
    }
  });

  app.post("/api/vault", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const { value, clientId, dataType, label, notes } = req.body;
      if (!value) return res.status(400).json({ message: "Value is required" });
      if (!clientId) return res.status(400).json({ message: "Client is required" });
      const parsedClientId = parseInt(String(clientId), 10);
      if (!Number.isInteger(parsedClientId)) return res.status(400).json({ message: "Invalid client ID" });
      const client = await storage.getClient(parsedClientId);
      if (!client) return res.status(404).json({ message: "Client not found" });

      const encryptedData = encryptVault(String(value));

      const data = insertClientVaultSchema.parse({
        clientId: parsedClientId,
        dataType: dataType || "other",
        label,
        encryptedData,
        notes: notes || null,
        createdBy: req.user.id,
      });

      const entry = await storage.createVaultEntry(data);

      await storage.createActivity({
        userId: req.user.id,
        type: "vault_created",
        description: `Created vault entry: ${label}`,
        entityType: "vault",
        entityId: entry.id,
      });

      const { encryptedData: _encryptedData, ...safeEntry } = entry as any;
      res.status(201).json(safeEntry);
    } catch (error: any) {
      console.error("Error creating vault entry:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid vault data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create vault entry" });
    }
  });

  app.patch("/api/vault/:id", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid vault entry ID" });
      const existing = await storage.getVaultEntry(id);
      if (!existing || !(existing as any).isActive) return res.status(404).json({ message: "Vault entry not found" });
      if (req.body.clientId !== undefined && Number(req.body.clientId) !== Number((existing as any).clientId)) {
        return res.status(403).json({ message: "Vault entry does not belong to this carrier" });
      }

      const updates: any = {};
      if (req.body.label) updates.label = req.body.label;
      if (req.body.dataType) updates.dataType = req.body.dataType;
      if (req.body.notes !== undefined) updates.notes = req.body.notes;
      if (req.body.value) updates.encryptedData = encryptVault(String(req.body.value));

      const entry = await storage.updateVaultEntry(id, updates);

      await storage.createActivity({
        userId: req.user.id,
        type: "vault_updated",
        description: `Updated vault entry: ${entry.label}`,
        entityType: "vault",
        entityId: id,
      });

      const { encryptedData: _encryptedData, ...safeEntry } = entry as any;
      res.json(safeEntry);
    } catch (error) {
      console.error("Error updating vault entry:", error);
      res.status(500).json({ message: "Failed to update vault entry" });
    }
  });

  app.put("/api/vault/:id", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid vault entry ID" });
      const existing = await storage.getVaultEntry(id);
      if (!existing || !(existing as any).isActive) return res.status(404).json({ message: "Vault entry not found" });
      if (req.body.clientId !== undefined && Number(req.body.clientId) !== Number((existing as any).clientId)) {
        return res.status(403).json({ message: "Vault entry does not belong to this carrier" });
      }

      const updates: any = {};
      if (req.body.label) updates.label = req.body.label;
      if (req.body.dataType) updates.dataType = req.body.dataType;
      if (req.body.notes !== undefined) updates.notes = req.body.notes;
      if (req.body.value) updates.encryptedData = encryptVault(String(req.body.value));

      const entry = await storage.updateVaultEntry(id, updates);
      const { encryptedData: _encryptedData, ...safeEntry } = entry as any;
      res.json(safeEntry);
    } catch (error) {
      console.error("Error updating vault entry (PUT):", error);
      res.status(500).json({ message: "Failed to update vault entry" });
    }
  });

  app.delete("/api/vault/:id", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid vault entry ID" });
      const existing = await storage.getVaultEntry(id);
      if (!existing || !(existing as any).isActive) return res.status(404).json({ message: "Vault entry not found" });
      if (req.query.clientId !== undefined && Number(req.query.clientId) !== Number((existing as any).clientId)) {
        return res.status(403).json({ message: "Vault entry does not belong to this carrier" });
      }

      await storage.deleteVaultEntry(id);

      await storage.createActivity({
        userId: req.user.id,
        type: "vault_deleted",
        description: "Deleted confidential vault entry",
        entityType: "vault",
        entityId: id,
      });

      res.json({ message: "Vault entry deleted successfully" });
    } catch (error) {
      console.error("Error deleting vault entry:", error);
      res.status(500).json({ message: "Failed to delete vault entry" });
    }
  });

  // Follow-ups
  app.get("/api/follow-ups", requireAuth, async (_req: any, res) => {
    try {
      const followUps = await storage.getAllFollowUps();
      res.json(followUps);
    } catch (error) {
      console.error("Error fetching follow-ups:", error);
      res.status(500).json({ message: "Failed to fetch follow-ups" });
    }
  });

  app.get("/api/follow-up-clients", requireAuth, async (_req: any, res) => {
    try {
      const clients = await storage.getClients();
      res.json(clients.map((client) => ({
        id: client.id,
        name: client.name,
        email: client.email,
      })));
    } catch (error) {
      console.error("Error fetching follow-up clients:", error);
      res.status(500).json({ message: "Failed to fetch follow-up clients" });
    }
  });

  app.post("/api/follow-ups", requireAuth, async (req: any, res) => {
    try {
      const data = insertFollowUpSchema.parse(req.body);
      const followUp = await storage.createFollowUp(data);

      await storage.createActivity({
        userId: req.user.id,
        type: "follow_up_created",
        description: `Created follow-up task: ${data.title}`,
        entityType: "follow_up",
        entityId: followUp.id,
      });

      res.json(followUp);
    } catch (error) {
      console.error("Error creating follow-up:", error);
      res.status(500).json({ message: "Failed to create follow-up" });
    }
  });

  app.patch("/api/follow-ups/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const followUp = await storage.updateFollowUp(id, req.body);

      await storage.createActivity({
        userId: req.user.id,
        type: "follow_up_updated",
        description: `Updated follow-up task: ${followUp.title}`,
        entityType: "follow_up",
        entityId: followUp.id,
      });

      res.json(followUp);
    } catch (error) {
      console.error("Error updating follow-up:", error);
      res.status(500).json({ message: "Failed to update follow-up" });
    }
  });

  app.delete("/api/follow-ups/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await storage.deleteFollowUp(id);

      await storage.createActivity({
        userId: req.user.id,
        type: "follow_up_deleted",
        description: "Deleted follow-up task",
        entityType: "follow_up",
        entityId: id,
      });

      res.json({ message: "Follow-up deleted successfully" });
    } catch (error) {
      console.error("Error deleting follow-up:", error);
      res.status(500).json({ message: "Failed to delete follow-up" });
    }
  });

  // ── Broker Follow-Up Automation Engine ─────────────────────────────────────

  // List all broker follow-ups (joined with invoice + client)
  app.get("/api/broker-follow-ups", requireAuth, async (_req: any, res) => {
    try {
      const records = await db
        .select({
          id: brokerFollowUps.id,
          invoiceId: brokerFollowUps.invoiceId,
          clientId: brokerFollowUps.clientId,
          brokerId: brokerFollowUps.brokerId,
          triggerType: brokerFollowUps.triggerType,
          triggerStatus: brokerFollowUps.triggerStatus,
          subject: brokerFollowUps.subject,
          body: brokerFollowUps.body,
          status: brokerFollowUps.status,
          sentAt: brokerFollowUps.sentAt,
          acknowledgedAt: brokerFollowUps.acknowledgedAt,
          sentBy: brokerFollowUps.sentBy,
          notes: brokerFollowUps.notes,
          createdAt: brokerFollowUps.createdAt,
          updatedAt: brokerFollowUps.updatedAt,
          invoiceNumber: invoices.invoiceNumber,
          invoiceAmount: invoices.amount,
          loadNumber: invoices.loadNumber,
          clientName: clients.name,
        })
        .from(brokerFollowUps)
        .leftJoin(invoices, eq(brokerFollowUps.invoiceId, invoices.id))
        .leftJoin(clients, eq(brokerFollowUps.clientId, clients.id))
        .orderBy(desc(brokerFollowUps.createdAt));
      res.json(records);
    } catch (error) {
      console.error("Error fetching broker follow-ups:", error);
      res.status(500).json({ message: "Failed to fetch broker follow-ups" });
    }
  });

  // Get broker follow-ups for a specific invoice
  app.get("/api/broker-follow-ups/invoice/:invoiceId", requireAuth, async (req: any, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId, 10);
      if (!await employeeCanAccessInvoice(req, invoiceId)) return res.status(403).json({ message: "You may only view follow-ups for your own invoice" });
      const records = await db
        .select()
        .from(brokerFollowUps)
        .where(eq(brokerFollowUps.invoiceId, invoiceId))
        .orderBy(desc(brokerFollowUps.createdAt));
      res.json(records);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch follow-ups for invoice" });
    }
  });

  // Manually trigger a broker follow-up for an invoice
  app.post("/api/broker-follow-ups/trigger", requireAuth, async (req: any, res) => {
    try {
      const { invoiceId } = z.object({ invoiceId: z.number() }).parse(req.body);
      if (!await employeeCanAccessInvoice(req, invoiceId)) return res.status(403).json({ message: "You may only trigger follow-ups for your own invoice" });
      const id = await triggerBrokerFollowUp(invoiceId, req.user.id, "funded", "manual");
      if (!id) return res.status(404).json({ message: "Invoice not found" });
      const [record] = await db
        .select()
        .from(brokerFollowUps)
        .where(eq(brokerFollowUps.id, id));
      res.json(record);
    } catch (error) {
      console.error("Error triggering broker follow-up:", error);
      res.status(500).json({ message: "Failed to trigger follow-up" });
    }
  });

  // Update a broker follow-up (acknowledge, add notes, change status)
  app.patch("/api/broker-follow-ups/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [existingFollowUp] = await db.select({ invoiceId: brokerFollowUps.invoiceId }).from(brokerFollowUps).where(eq(brokerFollowUps.id, id)).limit(1);
      if (!existingFollowUp) return res.status(404).json({ message: "Not found" });
      if (!await employeeCanAccessInvoice(req, existingFollowUp.invoiceId)) return res.status(403).json({ message: "You may only update follow-ups for your own invoice" });
      const updates: Record<string, unknown> = { ...req.body, updatedAt: new Date() };
      if (updates.status === "acknowledged" && !updates.acknowledgedAt) {
        updates.acknowledgedAt = new Date();
      }
      const [updated] = await db
        .update(brokerFollowUps)
        .set(updates as any)
        .where(eq(brokerFollowUps.id, id))
        .returning();
      if (!updated) return res.status(404).json({ message: "Not found" });
      await storage.createActivity({
        userId: req.user.id as string,
        type: "broker_followup_updated",
        description: `Broker follow-up #${id} status changed to ${updates.status ?? "updated"}`,
        entityType: "invoice",
        entityId: updated.invoiceId,
      } as any);
      res.json(updated);
    } catch (error) {
      console.error("Error updating broker follow-up:", error);
      res.status(500).json({ message: "Failed to update broker follow-up" });
    }
  });

  // Delete a broker follow-up
  app.delete("/api/broker-follow-ups/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await db.delete(brokerFollowUps).where(eq(brokerFollowUps.id, id));
      res.json({ message: "Broker follow-up deleted" });
    } catch (error) {
      console.error("Error deleting broker follow-up:", error);
      res.status(500).json({ message: "Failed to delete broker follow-up" });
    }
  });

  // ── Broker Follow-Up Reminders (cadence instances) ──────────────────────────

  // Get all reminders for a follow-up
  app.get("/api/broker-follow-ups/:id/reminders", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const reminders = await db
        .select()
        .from(brokerFollowUpReminders)
        .where(eq(brokerFollowUpReminders.followUpId, id))
        .orderBy(brokerFollowUpReminders.sequenceNumber);
      res.json(reminders);
    } catch (error) {
      console.error("Error fetching reminders:", error);
      res.status(500).json({ message: "Failed to fetch reminders" });
    }
  });

  // Update a reminder lifecycle state through an allowlisted transition.
  app.patch("/api/broker-follow-up-reminders/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid reminder id" });
      const { status } = z.object({
        status: z.enum(["scheduled", "skipped", "canceled"]),
      }).strict().parse(req.body);
      const [current] = await db.select().from(brokerFollowUpReminders).where(eq(brokerFollowUpReminders.id, id)).limit(1);
      if (!current) return res.status(404).json({ message: "Reminder not found" });
      const allowed: Record<string, string[]> = {
        scheduled: ["skipped", "canceled"],
        paused: ["skipped", "canceled"],
        skipped: ["scheduled", "canceled"],
        canceled: ["scheduled"],
      };
      if (!allowed[current.status]?.includes(status)) {
        return res.status(409).json({ message: `Cannot change reminder from ${current.status} to ${status}` });
      }
      const [updated] = await db
        .update(brokerFollowUpReminders)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(brokerFollowUpReminders.id, id), eq(brokerFollowUpReminders.status, current.status)))
        .returning();
      if (!updated) return res.status(409).json({ message: "Reminder changed while this action was processing" });
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message ?? "Invalid reminder update" });
      console.error("Error updating reminder:", error);
      res.status(500).json({ message: "Failed to update reminder" });
    }
  });

  app.patch("/api/broker-follow-ups/:id/reminders/:reminderId", requireAuth, async (req: any, res) => {
    try {
      const followUpId = Number(req.params.id), reminderId = Number(req.params.reminderId);
      if (!Number.isInteger(followUpId) || !Number.isInteger(reminderId) || followUpId < 1 || reminderId < 1)
        return res.status(400).json({ message: "Invalid follow-up or reminder id" });
      const payload = z.object({
        scheduledSendAt: z.string().datetime(),
        emailSubject: z.string().trim().min(1).max(500),
        emailBody: z.string().trim().min(1).max(20000),
      }).parse(req.body);
      const scheduledAt = new Date(payload.scheduledSendAt);
      if (Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ message: "Invalid scheduled date" });
      const [reminder] = await db.select().from(brokerFollowUpReminders).where(and(eq(brokerFollowUpReminders.id, reminderId), eq(brokerFollowUpReminders.followUpId, followUpId))).limit(1);
      if (!reminder) return res.status(404).json({ message: "Reminder not found for this follow-up" });
      if (reminder.status !== "scheduled") return res.status(409).json({ message: "Only scheduled reminders can be edited" });
      const [updated] = await db.update(brokerFollowUpReminders).set({ scheduledSendAt: scheduledAt, subject: payload.emailSubject, body: payload.emailBody, editedAt: new Date(), editedBy: req.user.id, updatedAt: new Date() }).where(and(
        eq(brokerFollowUpReminders.id, reminderId),
        eq(brokerFollowUpReminders.followUpId, followUpId),
        eq(brokerFollowUpReminders.status, "scheduled"),
      )).returning();
      if (!updated) return res.status(409).json({ message: "Reminder is no longer scheduled" });
      const [followUp] = await db.select({ invoiceId: brokerFollowUps.invoiceId }).from(brokerFollowUps).where(eq(brokerFollowUps.id, followUpId));
      if (followUp) {
        await db.insert(eventLedger).values({ entityType: "invoice", entityId: followUp.invoiceId, eventType: "broker_followup_reminder_edited", actorType: "user", actorId: req.user.id, payloadJson: { followUpId, reminderId } });
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message ?? "Invalid reminder update" });
      console.error("Error editing reminder:", error); res.status(500).json({ message: "Failed to edit reminder" });
    }
  });

  // Admin: manually trigger the reminder scheduler
  app.post("/api/broker-follow-up-reminders/process", requireAuth, async (req: any, res) => {
    try {
      if (req.user.role !== "admin") return res.status(403).json({ message: "Admin only" });
      const result = await processScheduledReminders();
      res.json({ message: "Reminders processed", ...result });
    } catch (error) {
      console.error("Error processing reminders:", error);
      res.status(500).json({ message: "Failed to process reminders" });
    }
  });

  // Agent suppress: cancel all pending reminders for a follow-up
  app.post("/api/broker-follow-ups/:id/suppress", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [bfu] = await db.select({ invoiceId: brokerFollowUps.invoiceId }).from(brokerFollowUps).where(eq(brokerFollowUps.id, id));
      if (!bfu) return res.status(404).json({ message: "Follow-up not found" });
      await suppressCadence(id, bfu.invoiceId, req.user.id);
      res.json({ message: "Cadence suppressed", followUpId: id, stopReason: "agent_suppressed" });
    } catch (error) {
      console.error("Error suppressing cadence:", error);
      res.status(500).json({ message: "Failed to suppress cadence" });
    }
  });

  // ── Broker Follow-Up Templates ─────────────────────────────────────────────

  // List all templates
  app.get("/api/broker-follow-up-templates", requireAuth, async (_req: any, res) => {
    try {
      const templates = await db
        .select()
        .from(brokerFollowUpTemplates)
        .orderBy(brokerFollowUpTemplates.triggerType, brokerFollowUpTemplates.name);
      res.json(templates);
    } catch (error) {
      console.error("Error fetching templates:", error);
      res.status(500).json({ message: "Failed to fetch templates" });
    }
  });

  // Create template
  app.post("/api/broker-follow-up-templates", requireAuth, async (req: any, res) => {
    try {
      const data = insertBrokerFollowUpTemplateSchema.parse({ ...req.body, createdBy: req.user.id });
      // If setting as default, clear existing default for this triggerType
      if (data.isDefault) {
        await db
          .update(brokerFollowUpTemplates)
          .set({ isDefault: false })
          .where(eq(brokerFollowUpTemplates.triggerType, data.triggerType));
      }
      const [tpl] = await db.insert(brokerFollowUpTemplates).values(data).returning();
      invalidateTemplateCache();
      res.status(201).json(tpl);
    } catch (error) {
      console.error("Error creating template:", error);
      res.status(500).json({ message: "Failed to create template" });
    }
  });

  // Update template
  app.patch("/api/broker-follow-up-templates/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updates = req.body as Record<string, unknown>;
      // If setting as default, clear existing default for this triggerType first
      if (updates.isDefault && updates.triggerType) {
        await db
          .update(brokerFollowUpTemplates)
          .set({ isDefault: false })
          .where(eq(brokerFollowUpTemplates.triggerType, updates.triggerType as "immediate" | "due_date" | "overdue" | "escalation"));
      }
      const [updated] = await db
        .update(brokerFollowUpTemplates)
        .set(updates as any)
        .where(eq(brokerFollowUpTemplates.id, id))
        .returning();
      if (!updated) return res.status(404).json({ message: "Template not found" });
      invalidateTemplateCache();
      res.json(updated);
    } catch (error) {
      console.error("Error updating template:", error);
      res.status(500).json({ message: "Failed to update template" });
    }
  });

  // Delete template
  app.delete("/api/broker-follow-up-templates/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await db.delete(brokerFollowUpTemplates).where(eq(brokerFollowUpTemplates.id, id));
      invalidateTemplateCache();
      res.json({ message: "Template deleted" });
    } catch (error) {
      console.error("Error deleting template:", error);
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  // Set a template as default for its trigger type
  app.post("/api/broker-follow-up-templates/:id/set-default", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [tpl] = await db.select().from(brokerFollowUpTemplates).where(eq(brokerFollowUpTemplates.id, id));
      if (!tpl) return res.status(404).json({ message: "Template not found" });
      await db.update(brokerFollowUpTemplates).set({ isDefault: false }).where(eq(brokerFollowUpTemplates.triggerType, tpl.triggerType));
      const [updated] = await db.update(brokerFollowUpTemplates).set({ isDefault: true }).where(eq(brokerFollowUpTemplates.id, id)).returning();
      invalidateTemplateCache();
      res.json(updated);
    } catch (error) {
      console.error("Error setting default template:", error);
      res.status(500).json({ message: "Failed to set default template" });
    }
  });

  // ── Workflow Config ─────────────────────────────────────────────────────────

  // Get the current workflow pipeline config (default or saved)
  app.get("/api/workflow-config", requireAuth, async (req: any, res) => {
    try {
      const [config] = await db
        .select()
        .from(workflowConfigs)
        .where(eq(workflowConfigs.name, "default"))
        .limit(1);
      if (!config) {
        return res.json(null);
      }
      res.json(config);
    } catch (error) {
      console.error("Error fetching workflow config:", error);
      res.status(500).json({ message: "Failed to fetch workflow config" });
    }
  });

  // Save / upsert the workflow pipeline config (manager+ only)
  app.put("/api/workflow-config", requireAuth, async (req: any, res) => {
    try {
      if (req.user.role !== "manager" && req.user.role !== "admin") {
        return res.status(403).json({ message: "Manager or Admin role required" });
      }
      const { stagesJson } = req.body;
      if (!Array.isArray(stagesJson)) {
        return res.status(400).json({ message: "stagesJson must be an array" });
      }

      // Upsert: update existing "default" row, or insert a new one
      const [existing] = await db
        .select({ id: workflowConfigs.id })
        .from(workflowConfigs)
        .where(eq(workflowConfigs.name, "default"))
        .limit(1);

      let result;
      if (existing) {
        [result] = await db
          .update(workflowConfigs)
          .set({ stagesJson, updatedBy: req.user.id, updatedAt: new Date() })
          .where(eq(workflowConfigs.id, existing.id))
          .returning();
      } else {
        [result] = await db
          .insert(workflowConfigs)
          .values({ name: "default", stagesJson, updatedBy: req.user.id })
          .returning();
      }

      // Write audit event
      await db.insert(eventLedger).values({
        entityType: "system",
        entityId:   0,
        eventType:  "workflow_config_saved",
        actorType:  "user",
        actorId:    req.user.id,
        payloadJson: { stageCount: stagesJson.length },
      }).catch(() => {});

      res.json(result);
    } catch (error) {
      console.error("Error saving workflow config:", error);
      res.status(500).json({ message: "Failed to save workflow config" });
    }
  });

  // Portfolio / version / auth repair
  app.get("/portfolio", (_req, res) => {
    const portfolioPath = path.resolve(process.cwd(), "portfolio-site", "index.html");
    if (fs.existsSync(portfolioPath)) {
      return res.sendFile(portfolioPath);
    }
    return res.status(404).json({ message: "Portfolio not found" });
  });

  app.get("/api/version-check", (_req, res) => {
    res.json({
      timestamp: new Date().toISOString(),
      version: `v3.0.0-WITH-BYPASS-${Date.now()}`,
      hasLocalAuth: !!(app as any)._router?.stack?.find((layer: any) => layer.route?.path === "/api/auth/local/login"),
      environment: process.env.NODE_ENV || "unknown",
      authEndpointExists: true,
      bypassAdded: true,
    });
  });



  // Tasks
  app.get("/api/tasks", requireAuth, requireModulePermission("tasks"), async (req: any, res) => {
    try {
      const isManager = req.user.role === "manager" || req.user.role === "admin";
      const scope = typeof req.query.scope === "string" ? req.query.scope : "all";
      const visibility = isManager
        ? scope === "assigned-to-me" ? eq(tasks.assignedTo, req.user.id)
          : scope === "created-by-me" ? eq(tasks.createdBy, req.user.id) : undefined
        : eq(tasks.assignedTo, req.user.id);
      const tasksData = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          description: tasks.description,
          type: tasks.type,
          priority: tasks.priority,
          status: tasks.status,
          dueDate: tasks.dueDate,
          clientId: tasks.clientId,
          assignedTo: tasks.assignedTo,
          createdBy: tasks.createdBy,
          progress: tasks.progress,
          progressUpdatedAt: tasks.progressUpdatedAt,
          progressUpdatedBy: tasks.progressUpdatedBy,
          assignedAgent: { id: userTable.id, firstName: userTable.firstName, lastName: userTable.lastName, profileImageUrl: userTable.profileImageUrl },
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
          client: {
            id: clients.id,
            name: clients.name,
          },
        })
        .from(tasks)
        .leftJoin(clients, eq(tasks.clientId, clients.id))
        .leftJoin(userTable, eq(tasks.assignedTo, userTable.id))
        .where(visibility)
        .orderBy(tasks.createdAt);
      // Fetch attribution names separately to avoid duplicate aliases in Drizzle's
      // select object while retaining the compact list query.
      const enriched = await Promise.all(tasksData.map(async (task) => {
        const [updater] = task.progressUpdatedAt && task.progressUpdatedBy
          ? await db.select({ firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl })
            .from(users).where(eq(users.id, task.progressUpdatedBy)).limit(1)
          : [];
        const [creator] = task.createdBy
          ? await db.select({ firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl })
            .from(users).where(eq(users.id, task.createdBy)).limit(1)
          : [];
        return { ...task, progressUpdater: updater ?? null, creator: creator ?? null };
      }));
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/:id", requireAuth, requireModulePermission("tasks"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const isManager = req.user.role === "manager" || req.user.role === "admin";
      const [task] = await db.select().from(tasks).where(and(eq(tasks.id, id), isManager ? sql`true` : eq(tasks.assignedTo, req.user.id))).limit(1);

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }
      const [assignedAgent] = task.assignedTo
        ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl }).from(users).where(eq(users.id, task.assignedTo)).limit(1)
        : [];
      const [progressUpdater] = task.progressUpdatedBy
        ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl }).from(users).where(eq(users.id, task.progressUpdatedBy)).limit(1)
        : [];
      const [creator] = task.createdBy
        ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl }).from(users).where(eq(users.id, task.createdBy)).limit(1)
        : [];
      res.json({ ...task, assignedAgent: assignedAgent ?? null, progressUpdater: progressUpdater ?? null, creator: creator ?? null });
    } catch (error) {
      console.error("Error fetching task:", error);
      res.status(500).json({ message: "Failed to fetch task" });
    }
  });

  app.post("/api/tasks", requireAuth, requireModulePermission("tasks"), async (req: any, res) => {
    try {
      const isManager = req.user.role === "manager" || req.user.role === "admin";
      const hasDueDate = Object.prototype.hasOwnProperty.call(req.body, "dueDate");
      const requestedAssignee = req.body.assignedTo === "" ? null : req.body.assignedTo;
      if (!isManager && requestedAssignee && requestedAssignee !== req.user.id) {
        return res.status(403).json({ message: "Employees may only assign tasks to themselves" });
      }
      const assignedTo = isManager ? (requestedAssignee ?? null) : req.user.id;
      if (assignedTo) {
        const [assignee] = await db.select({ id: users.id }).from(users)
          .where(and(eq(users.id, assignedTo), eq(users.status, "active"))).limit(1);
        if (!assignee) return res.status(400).json({ message: "Assignee must be an active user" });
      }
      const progress = req.body.progress === undefined ? 0 : Number(req.body.progress);
      if (!Number.isInteger(progress) || progress < 0 || progress > 100) return res.status(400).json({ message: "Progress must be an integer from 0 to 100" });
      const taskData = insertTaskSchema.parse({
        ...req.body,
        ...(hasDueDate ? { dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null } : {}),
        assignedTo,
        progress,
        createdBy: undefined,
      });
      const [newTask] = await db.insert(tasks).values({ ...taskData, createdBy: req.user.id, progressUpdatedAt: progress ? new Date() : null, progressUpdatedBy: progress ? req.user.id : null }).returning();
      if (assignedTo && assignedTo !== req.user.id) {
        await storage.createNotification({ userId: assignedTo, title: "New task assigned", message: `You were assigned: ${newTask.title}`, type: "info", entityType: "task", entityId: newTask.id, actionUrl: `/tasks/${newTask.id}` });
      }
      res.status(201).json(newTask);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      console.error("Error creating task:", error);
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  app.patch("/api/tasks/:id", requireAuth, requireModulePermission("tasks"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid task id" });
      const isManager = req.user.role === "manager" || req.user.role === "admin";
      const [existing] = await db.select().from(tasks).where(and(eq(tasks.id, id), isManager ? sql`true` : eq(tasks.assignedTo, req.user.id))).limit(1);
      if (!existing) return res.status(404).json({ message: "Task not found" });
      const hasDueDate = Object.prototype.hasOwnProperty.call(req.body, "dueDate");
      if (!isManager && Object.prototype.hasOwnProperty.call(req.body, "assignedTo")) return res.status(403).json({ message: "Employees cannot reassign tasks" });
      const requestedAssignee = Object.prototype.hasOwnProperty.call(req.body, "assignedTo") ? (req.body.assignedTo === "" ? null : req.body.assignedTo) : undefined;
      if (requestedAssignee) {
        const [assignee] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, requestedAssignee), eq(users.status, "active"))).limit(1);
        if (!assignee) return res.status(400).json({ message: "Assignee must be an active user" });
      }
      const updateData = insertTaskSchema.partial().parse({
        ...req.body,
        ...(hasDueDate ? { dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null } : {}),
      });
      if (updateData.progress !== undefined && (updateData.progress < 0 || updateData.progress > 100)) return res.status(400).json({ message: "Progress must be from 0 to 100" });
      const progressChanged = updateData.progress !== undefined && updateData.progress !== existing.progress;
      const setData: any = { ...updateData, ...(requestedAssignee !== undefined ? { assignedTo: requestedAssignee } : {}), updatedAt: new Date() };
      if (progressChanged) Object.assign(setData, { progressUpdatedAt: new Date(), progressUpdatedBy: req.user.id });
      const [updatedTask] = await db
        .update(tasks)
        .set(setData)
        .where(and(eq(tasks.id, id), isManager ? sql`true` : eq(tasks.assignedTo, req.user.id)))
        .returning();

      if (!updatedTask) {
        return res.status(404).json({ message: "Task not found" });
      }

      if (updatedTask.assignedTo && updatedTask.assignedTo !== existing.assignedTo && updatedTask.assignedTo !== req.user.id) {
        await storage.createNotification({ userId: updatedTask.assignedTo, title: "Task assigned to you", message: `You were assigned: ${updatedTask.title}`, type: "info", entityType: "task", entityId: updatedTask.id, actionUrl: `/tasks/${updatedTask.id}` });
      }
      res.json(updatedTask);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      console.error("Error updating task:", error);
      res.status(500).json({ message: "Failed to update task" });
    }
  });

  app.patch("/api/tasks/:id/progress", requireAuth, requireModulePermission("tasks"), async (req: any, res) => {
    const id = Number(req.params.id);
    const progress = Number(req.body?.progress);
    if (!Number.isInteger(id) || !Number.isInteger(progress) || progress < 0 || progress > 100) return res.status(400).json({ message: "Progress must be an integer from 0 to 100" });
    const isManager = req.user.role === "manager" || req.user.role === "admin";
    const [updated] = await db.update(tasks).set({ progress, progressUpdatedAt: new Date(), progressUpdatedBy: req.user.id, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), isManager ? sql`true` : eq(tasks.assignedTo, req.user.id))).returning();
    if (!updated) return res.status(404).json({ message: "Task not found" });
    res.json(updated);
  });

  app.delete("/api/tasks/:id", requireAuth, requireModulePermission("tasks"), async (req: any, res) => {
    try {
      if (req.user.role !== "manager" && req.user.role !== "admin") {
        return res.status(403).json({ message: "Only managers and admins can delete tasks" });
      }
      const id = parseInt(req.params.id, 10);
      const [deletedTask] = await db.delete(tasks).where(eq(tasks.id, id)).returning();

      if (!deletedTask) {
        return res.status(404).json({ message: "Task not found" });
      }

      res.json({ message: "Task deleted successfully" });
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  // Brokers
  app.get("/api/brokers", requireAuth, async (req: any, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const conditions: any[] = [];
      const brokerSearchDocument = sql`(
        coalesce(${brokers.name}, '') || ' ' ||
        coalesce(${brokers.contactPerson}, '') || ' ' ||
        coalesce(${brokers.email}, '') || ' ' ||
        coalesce(${brokers.phone}, '') || ' ' ||
        coalesce(${brokers.address}, '') || ' ' ||
        coalesce(${brokers.city}, '') || ' ' ||
        coalesce(${brokers.state}, '') || ' ' ||
        coalesce(${brokers.mcNumber}, '') || ' ' ||
        coalesce(${brokers.dotNumber}, '') || ' ' ||
        coalesce(${brokers.notes}, '')
      )`;
      if (q) conditions.push(ilike(brokerSearchDocument, `%${q}%`));
      if (typeof req.query.status === "string" && req.query.status !== "all") {
        conditions.push(eq(brokers.status, req.query.status as any));
      }
      if (typeof req.query.paymentTerms === "string" && req.query.paymentTerms) {
        conditions.push(eq(brokers.paymentTerms, req.query.paymentTerms as any));
      }
      if (typeof req.query.creditGrade === "string" && ["A", "B", "C", "D", "F"].includes(req.query.creditGrade)) {
        conditions.push(eq(brokers.creditGrade, req.query.creditGrade as any));
      }
      if (req.user.role === "employee" || req.query.processor === "me") {
        conditions.push(eq(brokers.assignedProcessor, req.user.id));
      }
      const where = conditions.length ? and(...conditions) : undefined;
      const creditSort = req.query.creditSort === "asc" || req.query.creditSort === "desc"
        ? req.query.creditSort
        : null;
      const orderBy = creditSort === "asc"
        ? [asc(brokers.creditScore), asc(brokers.name)]
        : creditSort === "desc"
          ? [desc(brokers.creditScore), asc(brokers.name)]
          : [asc(brokers.name)];
      if (req.query.all === "true") {
        const rows = await db.select().from(brokers).where(where).orderBy(...orderBy);
        return res.json(await enrichAssignments(rows));
      }
      const { page, limit, offset } = parseListPagination(req);
      const [{ total }] = await db.select({ total: count() }).from(brokers).where(where);
      const data = await db.select().from(brokers).where(where).orderBy(...orderBy).limit(limit).offset(offset);
      res.json({ data: await enrichAssignments(data), total: Number(total), page, totalPages: Math.ceil(Number(total) / limit) });
    } catch (error) {
      console.error("Error fetching brokers:", error);
      res.status(500).json({ message: "Failed to fetch brokers" });
    }
  });

  app.get("/api/brokers/credit-alerts", requireAuth, async (req: any, res) => {
    try {
      const conditions = [inArray(brokers.creditGrade, ["D", "F"] as any[])];
      if (req.user.role === "employee") conditions.push(eq(brokers.assignedProcessor, req.user.id));
      const risky = await db.select({
        id: brokers.id,
        name: brokers.name,
        creditGrade: brokers.creditGrade,
        creditScore: brokers.creditScore,
      }).from(brokers)
        .where(and(...conditions))
        .orderBy(asc(brokers.creditScore), brokers.name);
      res.json({
        fCount: risky.filter(broker => broker.creditGrade === "F").length,
        dCount: risky.filter(broker => broker.creditGrade === "D").length,
        worst: risky.slice(0, 5),
      });
    } catch (error) {
      console.error("Error fetching broker credit alerts:", error);
      res.status(500).json({ message: "Failed to fetch broker credit alerts" });
    }
  });

  app.post("/api/brokers/calculate-all-credit", requireAdmin, async (_req, res) => {
    try {
      const results = await recalculateAllBrokerCredit();
      res.json({ calculated: results.length, results });
    } catch (error) {
      console.error("Error recalculating all broker credit:", error);
      res.status(500).json({ message: "Failed to recalculate broker credit" });
    }
  });

  // Branch routes must precede /api/brokers/:id so "branches" is never
  // interpreted as a broker id by Express.
  app.get("/api/brokers/:id/branches", requireAuth, async (req, res) => {
    try {
      const brokerId = Number(req.params.id);
      if (!Number.isInteger(brokerId) || brokerId <= 0) return res.status(400).json({ message: "Invalid broker ID" });
      const [broker] = await db.select({ id: brokers.id }).from(brokers).where(eq(brokers.id, brokerId)).limit(1);
      if (!broker) return res.status(404).json({ message: "Broker not found" });
      if (!(await canAccessBroker(req, brokerId))) return res.status(403).json({ message: "You can only access brokers assigned to you" });
      const branches = await db.select().from(brokerBranches)
        .where(eq(brokerBranches.brokerId, brokerId))
        .orderBy(brokerBranches.branchName, brokerBranches.id);
      res.json(branches);
    } catch (error) {
      console.error("Error fetching broker branches:", error);
      res.status(500).json({ message: "Failed to fetch broker branches" });
    }
  });

  app.post("/api/brokers/:id/branches", requireAuth, requireManagerOrAdmin, async (req, res) => {
    try {
      const brokerId = Number(req.params.id);
      if (!Number.isInteger(brokerId) || brokerId <= 0) return res.status(400).json({ message: "Invalid broker ID" });
      const [broker] = await db.select({ id: brokers.id }).from(brokers).where(eq(brokers.id, brokerId)).limit(1);
      if (!broker) return res.status(404).json({ message: "Broker not found" });
      const branchData = insertBrokerBranchSchema.parse({ ...req.body, brokerId });
      const [branch] = await db.insert(brokerBranches).values(branchData).returning();
      res.status(201).json(branch);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid branch data", errors: error.errors });
      console.error("Error creating broker branch:", error);
      res.status(500).json({ message: "Failed to create broker branch" });
    }
  });

  app.patch("/api/brokers/:id/branches/:branchId", requireAuth, requireManagerOrAdmin, async (req, res) => {
    try {
      const brokerId = Number(req.params.id);
      const branchId = Number(req.params.branchId);
      if (!Number.isInteger(brokerId) || brokerId <= 0 || !Number.isInteger(branchId) || branchId <= 0) {
        return res.status(400).json({ message: "Invalid broker or branch ID" });
      }
      const updates = insertBrokerBranchSchema.omit({ brokerId: true }).partial().parse(req.body);
      const [branch] = await db.update(brokerBranches).set({ ...updates, updatedAt: new Date() })
        .where(and(eq(brokerBranches.id, branchId), eq(brokerBranches.brokerId, brokerId))).returning();
      if (!branch) return res.status(404).json({ message: "Branch not found" });
      res.json(branch);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid branch data", errors: error.errors });
      console.error("Error updating broker branch:", error);
      res.status(500).json({ message: "Failed to update broker branch" });
    }
  });

  app.delete("/api/brokers/:id/branches/:branchId", requireAuth, requireManagerOrAdmin, async (req, res) => {
    try {
      const brokerId = Number(req.params.id);
      const branchId = Number(req.params.branchId);
      if (!Number.isInteger(brokerId) || brokerId <= 0 || !Number.isInteger(branchId) || branchId <= 0) {
        return res.status(400).json({ message: "Invalid broker or branch ID" });
      }
      const [branch] = await db.delete(brokerBranches)
        .where(and(eq(brokerBranches.id, branchId), eq(brokerBranches.brokerId, brokerId))).returning();
      if (!branch) return res.status(404).json({ message: "Branch not found" });
      res.json({ message: "Branch deleted successfully" });
    } catch (error) {
      console.error("Error deleting broker branch:", error);
      res.status(500).json({ message: "Failed to delete broker branch" });
    }
  });

  app.get("/api/brokers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [broker] = await db.select().from(brokers).where(eq(brokers.id, id)).limit(1);

      if (!broker) {
        return res.status(404).json({ message: "Broker not found" });
      }
      if (!(await canAccessAssignedRecord(req, broker.assignedProcessor))) {
        return res.status(403).json({ message: "You can only access brokers assigned to you" });
      }

      res.json(await enrichBrokerAssignment(broker));
    } catch (error) {
      console.error("Error fetching broker:", error);
      res.status(500).json({ message: "Failed to fetch broker" });
    }
  });

  app.post("/api/brokers", requireAuth, async (req: any, res) => {
    try {
      const input = { ...req.body };
      // Accept the database-style pilot tag as well as the API's camelCase.
      if (Object.prototype.hasOwnProperty.call(input, "data_origin")) {
        if (input.dataOrigin !== undefined && input.dataOrigin !== input.data_origin) {
          return res.status(400).json({ message: "Conflicting data origin values" });
        }
        input.dataOrigin = input.data_origin;
        delete input.data_origin;
      }
      if (req.user.role === "employee") input.assignedProcessor = req.user.id;
      if (Object.prototype.hasOwnProperty.call(input, "assignedProcessor")) {
        input.assignedProcessor = await validateAssignedProcessor(input.assignedProcessor);
      }
      const brokerData = insertBrokerSchema.parse(input);
      const [newBroker] = await db.insert(brokers).values(brokerData).returning();
      res.status(201).json(await enrichBrokerAssignment(newBroker));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid broker data", errors: error.errors });
      }
      console.error("Error creating broker:", error);
      res.status(500).json({ message: "Failed to create broker" });
    }
  });

  app.patch("/api/brokers/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [existingBroker] = await db.select().from(brokers).where(eq(brokers.id, id)).limit(1);
      if (!existingBroker) return res.status(404).json({ message: "Broker not found" });
      if (!canAccessAssignedRecord(req, existingBroker.assignedProcessor)) {
        return res.status(403).json({ message: "You can only edit brokers assigned to you" });
      }
      if (Object.prototype.hasOwnProperty.call(req.body, "assignedProcessor")) {
        return res.status(403).json({ message: "Use the assignment endpoint to change the assigned processor" });
      }
      const input = { ...req.body };
      const updateData = insertBrokerSchema.partial().parse(input);

      const [updatedBroker] = await db
        .update(brokers)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(brokers.id, id))
        .returning();

      if (!updatedBroker) {
        return res.status(404).json({ message: "Broker not found" });
      }

      res.json(await enrichBrokerAssignment(updatedBroker));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid broker data", errors: error.errors });
      }
      console.error("Error updating broker:", error);
      res.status(500).json({ message: "Failed to update broker" });
    }
  });

  app.delete("/api/brokers/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [deletedBroker] = await db.delete(brokers).where(eq(brokers.id, id)).returning();

      if (!deletedBroker) {
        return res.status(404).json({ message: "Broker not found" });
      }

      res.json({ message: "Broker deleted successfully" });
    } catch (error) {
      console.error("Error deleting broker:", error);
      res.status(500).json({ message: "Failed to delete broker" });
    }
  });

  app.patch("/api/brokers/:id/assign", requireManagerOrAdmin, async (req: any, res: any) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid broker id" });
      const assignedProcessor = await validateAssignedProcessor(req.body?.assignedProcessor);
      const [broker] = await db.update(brokers).set({ assignedProcessor, updatedAt: new Date() })
        .where(eq(brokers.id, id)).returning();
      if (!broker) return res.status(404).json({ message: "Broker not found" });
      await storage.createActivity({
        userId: req.user.id,
        type: "broker_updated",
        description: `Assigned processor ${assignedProcessor ?? "unassigned"} to broker ${broker.name}`,
        entityType: "debtor",
        entityId: broker.id,
      } as any);
      res.json(await enrichBrokerAssignment(broker));
    } catch (error: any) {
      if (error?.status === 400) return res.status(400).json({ message: error.message });
      console.error("Error assigning broker processor:", error);
      res.status(500).json({ message: "Failed to assign broker processor" });
    }
  });

  // Fuel advances
  app.get("/api/fuel-advances", requireModulePermission("fuel_advance"), async (_req, res) => {
    try {
      const fuelAdvancesData = await db
        .select({
          fuelAdvance: fuelAdvances,
          processedByName: sql<string>`concat_ws(' ', ${users.firstName}, ${users.lastName})`,
          carrierJoinedName: clients.name,
          brokerName: brokers.name,
          authorizedAgentName: sql<string>`concat_ws(' ', ${userTable.firstName}, ${userTable.lastName})`,
        })
        .from(fuelAdvances)
        .leftJoin(users, eq(fuelAdvances.processedBy, users.id))
        .leftJoin(clients, eq(fuelAdvances.carrierId, clients.id))
        .leftJoin(brokers, eq(fuelAdvances.brokerId, brokers.id))
        .leftJoin(userTable, eq(fuelAdvances.authorizedAgent, userTable.id))
        .orderBy(desc(fuelAdvances.advanceDate));

      res.json(fuelAdvancesData.map(({ fuelAdvance, ...joined }) => ({
        ...fuelAdvance, ...joined, carrierName: joined.carrierJoinedName || fuelAdvance.carrierName,
      })));
    } catch (error) {
      console.error("Error fetching fuel advances:", error);
      res.status(500).json({ message: "Failed to fetch fuel advances" });
    }
  });

  app.get("/api/fuel-advances/:id", requireModulePermission("fuel_advance"), async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [fuelAdvance] = await db
        .select({
          fuelAdvance: fuelAdvances,
          processedByName: sql<string>`concat_ws(' ', ${users.firstName}, ${users.lastName})`,
          carrierJoinedName: clients.name,
          brokerName: brokers.name,
          authorizedAgentName: sql<string>`concat_ws(' ', ${userTable.firstName}, ${userTable.lastName})`,
        })
        .from(fuelAdvances)
        .leftJoin(users, eq(fuelAdvances.processedBy, users.id))
        .leftJoin(clients, eq(fuelAdvances.carrierId, clients.id))
        .leftJoin(brokers, eq(fuelAdvances.brokerId, brokers.id))
        .leftJoin(userTable, eq(fuelAdvances.authorizedAgent, userTable.id))
        .where(eq(fuelAdvances.id, id))
        .limit(1);

      if (!fuelAdvance) {
        return res.status(404).json({ message: "Fuel advance not found" });
      }

      const { fuelAdvance: advance, ...joined } = fuelAdvance;
      res.json({ ...advance, ...joined, carrierName: joined.carrierJoinedName || advance.carrierName });
    } catch (error) {
      console.error("Error fetching fuel advance:", error);
      res.status(500).json({ message: "Failed to fetch fuel advance" });
    }
  });

  app.post("/api/fuel-advances", requireModulePermission("fuel_advance"), (req: any, res: any, next: any) => {
    // The tracking form submits multipart data so the optional rate confirmation
    // can be created atomically with the advance.
    rateConUpload.single("rateCon")(req, res, (err: any) => {
      if (err) return res.status(400).json({ message: err.message || "Invalid rate confirmation" });
      next();
    });
  }, async (req: any, res) => {
    let uploadedKey: string | undefined;
    let inserted = false;
    try {
      const body = req.body || {};
      const isLegacyCreate = !body.carrierId && !body.brokerId && !body.rate && !body.loadNumber
        && body.carrierName && body.advanceAmount && body.advanceDate;
      if (isLegacyCreate) {
        const legacyData = insertFuelAdvanceSchema.parse({
          ...body,
          processedBy: req.user.id,
          authorizedAgent: req.user.id,
          paid: body.status === "paid",
        });
        const [legacyAdvance] = await db.insert(fuelAdvances).values(legacyData).returning();
        return res.status(201).json(legacyAdvance);
      }
      const number = (name: string, required = false) => {
        const value = Number(body[name]);
        if (!Number.isFinite(value) || (required && value <= 0)) throw new Error(`${name} is required and must be numeric`);
        return value;
      };
      const carrierId = number("carrierId", true);
      const brokerId = number("brokerId", true);
      const rate = number("rate", true);
      const advanceAmount = number("advanceAmount", true);
      const faPercent = body.faPercent === "" || body.faPercent == null ? 0 : number("faPercent");
      if (faPercent < 0) return res.status(400).json({ message: "FA percentage cannot be negative" });
      const rateCents = Math.round(rate * 100);
      const advanceCents = Math.round(advanceAmount * 100);
      if (advanceCents > Math.floor(rateCents * 0.5)) return res.status(400).json({ message: "Advance cannot exceed 50% of the rate" });
      const [carrier] = await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, carrierId));
      const [broker] = await db.select({ id: brokers.id, name: brokers.name }).from(brokers).where(eq(brokers.id, brokerId));
      if (!carrier) return res.status(400).json({ message: "Carrier not found" });
      if (!broker) return res.status(400).json({ message: "Broker not found" });
      const loadNumber = String(body.loadNumber || "").trim();
      if (!loadNumber) return res.status(400).json({ message: "Load number is required" });
      const feeCents = Math.round(advanceCents * faPercent / 100);
      const owedCents = advanceCents + feeCents;
      const fees = feeCents / 100;
      const owed = owedCents / 100;
      const deliveryDate = body.deliveryDate ? new Date(body.deliveryDate) : null;
      if (deliveryDate && Number.isNaN(deliveryDate.getTime())) return res.status(400).json({ message: "Invalid delivery date" });
      const referenceNumber = String(body.referenceNumber || body.reference || "").trim() || null;
      const fuelAdvanceData: any = {
        type: String(body.type || "Fuel Advance"), loadNumber, carrierId, brokerId, rate: rate.toFixed(2),
        faPercent: faPercent.toFixed(4), fees: fees.toFixed(2), owed: owed.toFixed(2),
        paymentMethod: body.paymentMethod ? String(body.paymentMethod) : null,
        deliveryDate, code: body.code ? String(body.code) : null, referenceNumber,
        authorizedAgent: req.user.id, processedBy: req.user.id, carrierName: carrier.name,
        advanceAmount: advanceAmount.toFixed(2), advanceDate: new Date(),
        pickupState: String(body.pickupState || ""), deliveryState: String(body.deliveryState || ""),
        loadId: body.loadId ? Number(body.loadId) : null, notes: body.notes ? String(body.notes) : null,
      };
      if (req.file) {
        if (req.file.buffer.subarray(0, 5).toString("ascii") !== "%PDF-") return res.status(400).json({ message: "Uploaded rate confirmation is not a valid PDF" });
        uploadedKey = await uploadDocumentToS3(req.file, `fuel-advances/pending/${crypto.randomUUID()}.pdf`);
        fuelAdvanceData.rateConS3Key = uploadedKey;
        fuelAdvanceData.rateConName = sanitizeOriginalName(req.file.originalname);
        fuelAdvanceData.rateConType = "application/pdf";
      }
      const [newFuelAdvance] = await db.insert(fuelAdvances).values(fuelAdvanceData).returning();
      inserted = true;
      const [joined] = await db.select({
        fuelAdvance: fuelAdvances, carrierJoinedName: clients.name, brokerName: brokers.name,
        authorizedAgentName: sql<string>`concat_ws(' ', ${userTable.firstName}, ${userTable.lastName})`,
      }).from(fuelAdvances).leftJoin(clients, eq(fuelAdvances.carrierId, clients.id))
        .leftJoin(brokers, eq(fuelAdvances.brokerId, brokers.id))
        .leftJoin(userTable, eq(fuelAdvances.authorizedAgent, userTable.id))
        .where(eq(fuelAdvances.id, newFuelAdvance.id)).limit(1);
      const { fuelAdvance: created, ...names } = joined;
      res.status(201).json({ ...created, carrierName: names.carrierJoinedName || created.carrierName, ...names });
    } catch (error) {
      if (uploadedKey && !inserted) await deleteFromS3(uploadedKey);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid fuel advance data", errors: error.errors });
      }
      console.error("Error creating fuel advance:", error);
      res.status(error instanceof Error && /required|numeric|not found/i.test(error.message) ? 400 : 500)
        .json({ message: error instanceof Error ? error.message : "Failed to create fuel advance" });
    }
  });

  app.patch("/api/fuel-advances/:id", requireModulePermission("fuel_advance"), async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const body: any = req.body || {};
      const allowed = ["type", "loadNumber", "carrierId", "brokerId", "rate", "faPercent", "paymentMethod",
        "deliveryDate", "code", "referenceNumber", "account", "notes", "status", "pickupState", "deliveryState",
        "advanceAmount",
        "loadId", "deliveryVerified", "paid"];
      const updateData: any = {};
      for (const key of allowed) if (Object.prototype.hasOwnProperty.call(body, key)) updateData[key] = body[key];
      if (Object.prototype.hasOwnProperty.call(body, "reference")) updateData.referenceNumber = body.reference;
      for (const key of ["carrierId", "brokerId", "loadId"]) if (updateData[key] !== undefined && updateData[key] !== null && updateData[key] !== "") updateData[key] = Number(updateData[key]);
      for (const key of ["deliveryVerified", "paid"]) if (updateData[key] !== undefined) updateData[key] = updateData[key] === true || updateData[key] === "true" || updateData[key] === "1";
      if (updateData.paid !== undefined) {
        updateData.status = updateData.paid ? "paid" : "approved";
      } else if (updateData.status !== undefined) {
        updateData.paid = updateData.status === "paid";
      }
      if (updateData.deliveryDate !== undefined) {
        updateData.deliveryDate = updateData.deliveryDate ? new Date(updateData.deliveryDate) : null;
        if (updateData.deliveryDate && Number.isNaN(updateData.deliveryDate.getTime())) return res.status(400).json({ message: "Invalid delivery date" });
      }
      const moneyChanged = ["rate", "faPercent", "advanceAmount"].some((key) => updateData[key] !== undefined);
      if (moneyChanged) {
        const [current] = await db.select({ rate: fuelAdvances.rate, faPercent: fuelAdvances.faPercent, advanceAmount: fuelAdvances.advanceAmount })
          .from(fuelAdvances).where(eq(fuelAdvances.id, id));
        if (!current) return res.status(404).json({ message: "Fuel advance not found" });
        const rate = Number(updateData.rate ?? current.rate);
        const faPercent = Number(updateData.faPercent ?? current.faPercent ?? 0);
        const advance = Number(updateData.advanceAmount ?? current.advanceAmount);
        if (![rate, faPercent, advance].every(Number.isFinite)) return res.status(400).json({ message: "Invalid monetary values" });
        if (rate <= 0 || advance <= 0 || faPercent < 0) return res.status(400).json({ message: "Rate and advance must be positive, and FA percentage cannot be negative" });
        const rateCents = Math.round(rate * 100);
        const advanceCents = Math.round(advance * 100);
        if (advanceCents > Math.floor(rateCents * 0.5)) return res.status(400).json({ message: "Advance cannot exceed 50% of the rate" });
        const feeCents = Math.round(advanceCents * faPercent / 100);
        updateData.rate = (rateCents / 100).toFixed(2);
        updateData.faPercent = faPercent.toFixed(4);
        updateData.advanceAmount = (advanceCents / 100).toFixed(2);
        updateData.fees = (feeCents / 100).toFixed(2);
        updateData.owed = ((advanceCents + feeCents) / 100).toFixed(2);
      }

      const [updatedFuelAdvance] = await db
        .update(fuelAdvances)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(fuelAdvances.id, id))
        .returning();

      if (!updatedFuelAdvance) {
        return res.status(404).json({ message: "Fuel advance not found" });
      }

      res.json(updatedFuelAdvance);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid fuel advance data", errors: error.errors });
      }
      console.error("Error updating fuel advance:", error);
      res.status(500).json({ message: "Failed to update fuel advance" });
    }
  });

  // Rate confirmations are intentionally PDF-only and stored using the shared S3 service.
  app.post("/api/fuel-advances/:id/rate-con", requireModulePermission("fuel_advance"), (req: any, res: any, next: any) => {
    rateConUpload.single("file")(req, res, (err: any) => {
      if (err) return res.status(400).json({ message: err.message || "PDF upload rejected" });
      next();
    });
  }, async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "PDF file is required" });
      if (req.file.buffer.subarray(0, 5).toString("ascii") !== "%PDF-") return res.status(400).json({ message: "Uploaded file is not a valid PDF" });
      const id = Number(req.params.id);
      const [existing] = await db.select({ key: fuelAdvances.rateConS3Key }).from(fuelAdvances)
        .where(eq(fuelAdvances.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Fuel advance not found" });
      const key = await uploadDocumentToS3(req.file, `fuel-advances/${id}/rate-con-${crypto.randomUUID()}.pdf`);
      let row;
      try {
        [row] = await db.update(fuelAdvances).set({
          rateConS3Key: key, rateConName: sanitizeOriginalName(req.file.originalname), rateConType: "application/pdf", updatedAt: new Date(),
        }).where(eq(fuelAdvances.id, id)).returning();
      } catch (error) {
        await deleteFromS3(key);
        throw error;
      }
      if (!row) {
        await deleteFromS3(key);
        return res.status(404).json({ message: "Fuel advance not found" });
      }
      if (existing.key && existing.key !== key) await deleteFromS3(existing.key);
      res.json(row);
    } catch (error) {
      console.error("Error uploading fuel rate confirmation:", error);
      res.status(500).json({ message: "Failed to upload rate confirmation" });
    }
  });

  for (const [suffix, disposition] of [["view", "view"], ["download", "download"]] as const) {
    app.get(`/api/fuel-advances/:id/rate-con/${suffix}`, requireModulePermission("fuel_advance"), async (req, res) => {
      try {
        const [row] = await db.select({ key: fuelAdvances.rateConS3Key, name: fuelAdvances.rateConName })
          .from(fuelAdvances).where(eq(fuelAdvances.id, Number(req.params.id))).limit(1);
        if (!row) return res.status(404).json({ message: "Fuel advance not found" });
        if (!row.key) return res.status(404).json({ message: "Rate confirmation not uploaded" });
        const url = disposition === "view" ? await getSignedViewUrl(row.key) : await getSignedDownloadUrl(row.key, row.name || "rate-confirmation.pdf");
        res.redirect(url);
      } catch { res.status(500).json({ message: "Failed to access rate confirmation" }); }
    });
  }
  app.get("/api/fuel-advances/:id/rate-con", requireModulePermission("fuel_advance"), (req, res) => {
    res.redirect(`/api/fuel-advances/${encodeURIComponent(req.params.id)}/rate-con/view`);
  });

  app.get("/api/fuel-advances/:id/deposit-slip", requireModulePermission("fuel_advance"), async (req, res) => {
    try {
      const [row] = await db.select({
        fuelAdvance: fuelAdvances, carrierJoinedName: clients.name, carrierAddress: clients.address,
        carrierCity: clients.city, carrierState: clients.state, carrierPhone: clients.phone,
        brokerName: brokers.name,
        authorizedAgentName: sql<string>`concat_ws(' ', ${userTable.firstName}, ${userTable.lastName})`,
      }).from(fuelAdvances).leftJoin(clients, eq(fuelAdvances.carrierId, clients.id))
        .leftJoin(brokers, eq(fuelAdvances.brokerId, brokers.id))
        .leftJoin(userTable, eq(fuelAdvances.authorizedAgent, userTable.id))
        .where(eq(fuelAdvances.id, Number(req.params.id))).limit(1);
      if (!row) return res.status(404).json({ message: "Fuel advance not found" });
      const advance = row.fuelAdvance;
      const doc = new PDFDocument({ size: "LETTER", margin: 48, info: { Title: "Fuel Advance Deposit Slip", Author: "Trucking Pros Financial" } });
      res.setHeader("Content-Type", "application/pdf");
      const disposition = req.query.download === "1" ? "attachment" : "inline";
      res.setHeader("Content-Disposition", `${disposition}; filename="fuel-advance-${advance.id}-deposit-slip.pdf"`);
      doc.pipe(res);
      doc.rect(0, 0, 612, 92).fill("#098b9f");
      const logoPath = path.resolve(process.cwd(), "server/assets/tpf-logo.png");
      if (fs.existsSync(logoPath)) doc.image(logoPath, 48, 15, { fit: [95, 60] });
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(18).text("TRUCKING PROS FINANCIAL", 155, 28);
      doc.font("Helvetica").fontSize(10).text("Fuel Advance Deposit Slip", 48, 58);
      doc.fillColor("#1a1a1a").font("Helvetica-Bold").fontSize(20).text("DEPOSIT SLIP", 48, 125);
      let y = 175;
      const carrierDetails = [row.carrierAddress, [row.carrierCity, row.carrierState].filter(Boolean).join(", "), row.carrierPhone].filter(Boolean).join(" • ");
      const pdfMoney = (value: string | null | undefined) => value == null || value === ""
        ? "N/A"
        : `$${Number(value).toFixed(2)}`;
      const fields: Array<[string, string]> = [
        ["PRO / Load #", `${advance.code || "—"} / ${advance.loadNumber || "—"}`],
        ["Carrier", `${row.carrierJoinedName || advance.carrierName}${carrierDetails ? ` — ${carrierDetails}` : ""}`],
        ["Broker", row.brokerName || "—"],
        ["Advance", pdfMoney(advance.advanceAmount)],
        ["Fees", pdfMoney(advance.fees)],
        ["Owed", pdfMoney(advance.owed)],
        ["Payment method", advance.paymentMethod || "—"],
        ["Reference", advance.referenceNumber || `FA-${advance.id}`],
        ["Date", new Date(advance.advanceDate).toLocaleDateString("en-US")],
        ["Authorized agent", row.authorizedAgentName || "—"],
      ];
      fields.forEach(([label, value], i) => { doc.rect(48, y, 516, 34).fill(i % 2 ? "#fff" : "#f1f5f5").strokeColor("#cbd5e1").stroke(); doc.fillColor("#475569").font("Helvetica-Bold").fontSize(9).text(label.toUpperCase(), 60, y + 11); doc.fillColor("#111827").font("Helvetica").fontSize(11).text(value, 220, y + 10); y += 34; });
      doc.fillColor("#64748b").fontSize(8).text("Generated electronically by FactorFlux. Retain for accounting records.", 48, 700);
      doc.font("Helvetica-Bold").fontSize(9).text("Trucking Pros Financial LLC", 48, 718, { align: "center", width: 516 });
      doc.end();
    } catch { res.status(500).json({ message: "Failed to generate deposit slip" }); }
  });

  app.delete("/api/fuel-advances/:id", requireModulePermission("fuel_advance"), async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [deletedFuelAdvance] = await db.delete(fuelAdvances).where(eq(fuelAdvances.id, id)).returning();

      if (!deletedFuelAdvance) {
        return res.status(404).json({ message: "Fuel advance not found" });
      }
      if (deletedFuelAdvance.rateConS3Key) await deleteFromS3(deletedFuelAdvance.rateConS3Key);

      res.json({ message: "Fuel advance deleted successfully" });
    } catch (error) {
      console.error("Error deleting fuel advance:", error);
      res.status(500).json({ message: "Failed to delete fuel advance" });
    }
  });

  app.get("/api/users", requireAuth, async (_req, res) => {
    try {
      const allUsers = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          role: users.role,
           profileImageUrl: users.profileImageUrl,
        })
        .from(users)
        .where(eq(users.status, "active"));
      res.json(allUsers);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  // ─── Payout Settings ──────────────────────────────────────────────────────
  app.get("/api/payout-settings", requireAuth, async (_req, res) => {
    try {
      let settings = await storage.getPayoutSettings();
      if (!settings) {
        // Seed defaults on first access
        settings = await storage.upsertPayoutSettings({ advanceRate: "90.00", feeRate: "3.00" });
      }
      res.json(settings);
    } catch (err) {
      console.error("Error fetching payout settings:", err);
      res.status(500).json({ message: "Failed to fetch payout settings" });
    }
  });

  app.patch("/api/payout-settings", requireAuth, async (req: any, res) => {
    try {
      const schema = z.object({
        advanceRate: z.coerce.number().min(1).max(100),
        feeRate: z.coerce.number().min(0).max(50),
      });
      const { advanceRate, feeRate } = schema.parse(req.body);
      if (advanceRate + feeRate > 100) {
        return res.status(400).json({ message: "Advance rate + fee rate cannot exceed 100%" });
      }
      const settings = await storage.upsertPayoutSettings({
        advanceRate: String(advanceRate),
        feeRate: String(feeRate),
        updatedBy: req.user.id,
      });
      res.json(settings);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message });
      console.error("Error updating payout settings:", err);
      res.status(500).json({ message: "Failed to update payout settings" });
    }
  });

  // ─── Payouts ──────────────────────────────────────────────────────────────
  app.get("/api/payouts", requireAuth, async (_req, res) => {
    try {
      // Join with invoices and clients for display
      const rows = await db
        .select({
          payout: {
            id: payouts.id,
            invoiceId: payouts.invoiceId,
            clientId: payouts.clientId,
            invoiceAmount: payouts.invoiceAmount,
            advanceRate: payouts.advanceRate,
            feeRate: payouts.feeRate,
            advanceAmount: payouts.advanceAmount,
            feeAmount: payouts.feeAmount,
            reserveAmount: payouts.reserveAmount,
            netPayout: payouts.netPayout,
            paymentStatus: payouts.paymentStatus,
            advancePaidAt: payouts.advancePaidAt,
            reserveReleasedAt: payouts.reserveReleasedAt,
            notes: payouts.notes,
            createdAt: payouts.createdAt,
            updatedAt: payouts.updatedAt,
          },
          invoiceNumber: invoices.invoiceNumber,
          clientName: clients.name,
        })
        .from(payouts)
        .leftJoin(invoices, eq(payouts.invoiceId, invoices.id))
        .leftJoin(clients, eq(payouts.clientId, clients.id))
        .orderBy(desc(payouts.createdAt));

      res.json(rows.map((r) => ({ ...r.payout, invoiceNumber: r.invoiceNumber, clientName: r.clientName })));
    } catch (err) {
      console.error("Error fetching payouts:", err);
      res.status(500).json({ message: "Failed to fetch payouts" });
    }
  });

  app.get("/api/payouts/invoice/:invoiceId", requireAuth, async (req: any, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId, 10);
      if (!await employeeCanAccessInvoice(req, invoiceId)) return res.status(403).json({ message: "You may only view payouts for your own invoice" });
      const payout = await storage.getPayoutByInvoice(invoiceId);
      if (!payout) return res.status(404).json({ message: "No payout found for this invoice" });
      res.json(payout);
    } catch (err) {
      console.error("Error fetching payout by invoice:", err);
      res.status(500).json({ message: "Failed to fetch payout" });
    }
  });

  app.post("/api/payouts", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const schema = z.object({
        invoiceId: z.number().int().positive(),
        notes: z.string().optional(),
      });
      const { invoiceId, notes } = schema.parse(req.body);

      // Check no duplicate
      const existing = await storage.getPayoutByInvoice(invoiceId);
      if (existing) return res.status(409).json({ message: "A payout record already exists for this invoice" });

      // Fetch invoice
      const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
      if (!inv) return res.status(404).json({ message: "Invoice not found" });
      if (!await employeeCanAccessInvoice(req, invoiceId)) return res.status(403).json({ message: "You may only create payouts for your own invoice" });

      // Get current rates
      let settings = await storage.getPayoutSettings();
      if (!settings) settings = await storage.upsertPayoutSettings({ advanceRate: "90.00", feeRate: "3.00" });

      const invoiceAmount = parseFloat(inv.amount);
      const advanceRate = parseFloat(settings.advanceRate);
      const feeRate = parseFloat(settings.feeRate);
      const advanceAmount = +(invoiceAmount * advanceRate / 100).toFixed(2);
      const feeAmount = +(invoiceAmount * feeRate / 100).toFixed(2);
      const reserveAmount = +(invoiceAmount - advanceAmount).toFixed(2);
      const netPayout = +(advanceAmount - feeAmount).toFixed(2);

      const payout = await storage.createPayout({
        invoiceId,
        clientId: inv.clientId,
        invoiceAmount: String(invoiceAmount),
        advanceRate: String(advanceRate),
        feeRate: String(feeRate),
        advanceAmount: String(advanceAmount),
        feeAmount: String(feeAmount),
        reserveAmount: String(reserveAmount),
        netPayout: String(netPayout),
        paymentStatus: "pending_advance",
        notes: notes ?? null,
        createdBy: req.user.id,
      });

      await db.insert(eventLedger).values({
        entityType: "invoice",
        entityId: invoiceId,
        eventType: "payout_created",
        actorType: "user",
        actorId: req.user.id,
        payloadJson: {
          payoutId: payout.id,
          netPayout,
          advanceAmount,
          feeAmount,
          reserveAmount,
          paymentStatus: payout.paymentStatus,
        },
      });

      advanceInvoiceStage(invoiceId, "advance", req.user.id, "Payout record created — advance processing").catch(() => {});

      res.status(201).json(payout);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message });
      console.error("Error creating payout:", err);
      res.status(500).json({ message: "Failed to create payout" });
    }
  });

  app.get("/api/payouts/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid payout id" });
      const [payout] = await db.select().from(payouts).where(eq(payouts.id, id)).limit(1);
      if (!payout) return res.status(404).json({ message: "Payout not found" });
      if (!await employeeCanAccessInvoice(req, payout.invoiceId)) return res.status(403).json({ message: "You may only view payouts for your own invoice" });
      // Enrich with invoice + client info
      let invoiceNumber: string | null = null;
      let clientName: string | null = null;
      if (payout.invoiceId) {
        const [inv] = await db.select().from(invoices).where(eq(invoices.id, payout.invoiceId)).limit(1);
        if (inv) {
          invoiceNumber = inv.invoiceNumber;
          if (inv.clientId) {
            const cl = await storage.getClient(inv.clientId);
            if (cl) clientName = cl.name;
          }
        }
      }
      res.json({ ...payout, invoiceNumber, clientName });
    } catch (error) {
      console.error("Error fetching payout:", error);
      res.status(500).json({ message: "Failed to fetch payout" });
    }
  });

  app.patch("/api/payouts/:id", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [existingPayout] = await db.select({ invoiceId: payouts.invoiceId }).from(payouts).where(eq(payouts.id, id)).limit(1);
      if (!existingPayout) return res.status(404).json({ message: "Payout not found" });
      if (!await employeeCanAccessInvoice(req, existingPayout.invoiceId)) return res.status(403).json({ message: "You may only update payouts for your own invoice" });
      const schema = z.object({
        paymentStatus: z.enum(["pending_advance", "advance_paid", "reserve_pending", "reserve_released", "complete"]).optional(),
        notes: z.string().optional(),
        advancePaidAt: z.string().datetime().optional(),
        reserveReleasedAt: z.string().datetime().optional(),
      });
      const updates = schema.parse(req.body);

      // Auto-timestamp status transitions
      const now = new Date();
      const extra: Record<string, any> = {};
      if (updates.paymentStatus === "advance_paid") {
        if (!updates.advancePaidAt) extra.advancePaidAt = now;
        extra.advancePaidBy = req.user.id;
      }
      if (updates.paymentStatus === "reserve_released" && !updates.reserveReleasedAt) extra.reserveReleasedAt = now;

      const updated = await storage.updatePayout(id, { ...updates, ...extra } as any);

      // Fire payout status notification
      if (updates.paymentStatus) {
        const statusLabels: Record<string, { title: string; message: string; type: "info" | "success" | "warning" | "error" }> = {
          advance_paid: { title: "Advance Payment Sent", message: `Your advance payment has been processed for payout #${id}.`, type: "success" },
          reserve_pending: { title: "Reserve Pending", message: `Your reserve is pending debtor payment for payout #${id}.`, type: "info" },
          reserve_released: { title: "Reserve Released", message: `Your reserve funds have been released for payout #${id}.`, type: "success" },
          complete: { title: "Payout Complete", message: `Payout #${id} is fully complete. All funds have been disbursed.`, type: "success" },
        };
        const notif = statusLabels[updates.paymentStatus];
        if (notif) {
          storage.createNotification({
            userId: req.user.id,
            title: notif.title,
            message: notif.message,
            type: notif.type,
            entityType: "payout",
            entityId: id,
            actionUrl: "/payouts",
            metadata: JSON.stringify({ emailSubject: notif.title, emailBody: notif.message, trigger: "payout_status_change" }),
          } as any).catch(() => {});
        }
      }

      // Auto-advance factoring stage based on payout status
      if (updates.paymentStatus && updated.invoiceId) {
        const stageMap: Record<string, import("./services/invoiceStage").FactoringStage> = {
          advance_paid:      "collections",
          reserve_pending:   "reconciliation",
          reserve_released:  "reconciliation",
          complete:          "final_settlement",
        };
        const nextStage = stageMap[updates.paymentStatus];
        if (nextStage) {
          advanceInvoiceStage(updated.invoiceId, nextStage, req.user.id, `Payout status: ${updates.paymentStatus}`).catch(() => {});
        }
      }

      res.json(updated);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message });
      console.error("Error updating payout:", err);
      res.status(500).json({ message: "Failed to update payout" });
    }
  });

  // ─── Notify: Admin requests more info ──────────────────────────────────────
  app.post("/api/admin/notify-carrier", requireAdmin, async (req: any, res) => {
    try {
      const schema = z.object({
        userId: z.string().min(1),
        subject: z.string().min(1).max(200),
        message: z.string().min(1).max(2000),
        entityType: z.string().optional(),
        entityId: z.number().optional(),
        actionUrl: z.string().optional(),
      });
      const body = schema.parse(req.body);

      const notif = await storage.createNotification({
        userId: body.userId,
        title: body.subject,
        message: body.message,
        type: "warning",
        entityType: body.entityType || null,
        entityId: body.entityId || null,
        actionUrl: body.actionUrl || null,
        metadata: JSON.stringify({
          emailSubject: body.subject,
          emailBody: body.message,
          trigger: "admin_request_info",
          sentBy: req.user.id,
        }),
      } as any);

      await storage.createActivity({
        userId: req.user.id,
        type: "invoice_approved",
        entityType: body.entityType || "notification",
        entityId: body.entityId || null,
        description: `Admin sent notification to user ${body.userId}: "${body.subject}"`,
      });

      res.status(201).json(notif);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message });
      console.error("Error sending admin notification:", err);
      res.status(500).json({ message: "Failed to send notification" });
    }
  });

  // ─── Document Requirements ─────────────────────────────────────────────────
  app.get("/api/admin/doc-requirements", requireAuth, async (_req, res) => {
    try {
      const rows = await db.select().from(docRequirements).orderBy(docRequirements.stage, docRequirements.documentName);
      res.json(rows);
    } catch (err) {
      console.error("Error fetching doc requirements:", err);
      res.status(500).json({ message: "Failed to fetch document requirements" });
    }
  });

  app.put("/api/admin/doc-requirements", requireAdmin, async (req: any, res) => {
    try {
      const schema = z.array(z.object({
        id: z.number().optional(),
        stage: z.enum(["submission", "approval", "factoring", "payout"]),
        documentName: z.string().min(1),
        required: z.boolean(),
        description: z.string().optional(),
      }));
      const items = schema.parse(req.body);

      // Clear and re-insert for simplicity
      await db.delete(docRequirements);
      if (items.length > 0) {
        await db.insert(docRequirements).values(items.map((i) => ({
          stage: i.stage,
          documentName: i.documentName,
          required: i.required,
          description: i.description || null,
          updatedAt: new Date(),
        })));
      }

      const rows = await db.select().from(docRequirements).orderBy(docRequirements.stage, docRequirements.documentName);
      res.json(rows);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message });
      console.error("Error saving doc requirements:", err);
      res.status(500).json({ message: "Failed to save document requirements" });
    }
  });

  // ─── Admin Audit Log ───────────────────────────────────────────────────────
  app.get("/api/admin/audit-log", requireAdmin, async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || "100", 10), 500);
      const rows = await db
        .select({
          id: activities.id,
          userId: activities.userId,
          type: activities.type,
          description: activities.description,
          entityType: activities.entityType,
          entityId: activities.entityId,
          createdAt: activities.createdAt,
          userName: users.firstName,
          userLastName: users.lastName,
        })
        .from(activities)
        .leftJoin(users, eq(activities.userId, users.id))
        .orderBy(desc(activities.createdAt))
        .limit(limit);
      res.json(rows);
    } catch (err) {
      console.error("Error fetching audit log:", err);
      res.status(500).json({ message: "Failed to fetch audit log" });
    }
  });

  // ─── Debtors (expose existing storage) ────────────────────────────────────
  app.get("/api/debtors", requireAuth, async (_req, res) => {
    try { res.json(await storage.getDebtors()); } catch (e) { res.status(500).json({ message: "Failed to fetch debtors" }); }
  });
  app.get("/api/debtors/:id", requireAuth, async (req, res) => {
    try {
      const d = await storage.getDebtor(Number(req.params.id));
      if (!d) return res.status(404).json({ message: "Debtor not found" });
      res.json(d);
    } catch (e) { res.status(500).json({ message: "Failed to fetch debtor" }); }
  });
  app.post("/api/debtors", requireAuth, async (req: any, res) => {
    try { res.status(201).json(await storage.createDebtor(req.body)); } catch (e) { res.status(500).json({ message: "Failed to create debtor" }); }
  });
  app.patch("/api/debtors/:id", requireAuth, async (req: any, res) => {
    try { res.json(await storage.updateDebtor(Number(req.params.id), req.body)); } catch (e) { res.status(500).json({ message: "Failed to update debtor" }); }
  });
  app.delete("/api/debtors/:id", requireAuth, async (req, res) => {
    try { await storage.deleteDebtor(Number(req.params.id)); res.json({ ok: true }); } catch (e) { res.status(500).json({ message: "Failed to delete debtor" }); }
  });

  // ─── Credit Checks ────────────────────────────────────────────────────────
  app.get("/api/credit-checks", requireAuth, async (_req, res) => {
    try { res.json(await storage.getCreditChecks()); } catch (e) { res.status(500).json({ message: "Failed to fetch credit checks" }); }
  });
  app.get("/api/credit-checks/:id", requireAuth, async (req, res) => {
    try {
      const c = await storage.getCreditCheck(Number(req.params.id));
      if (!c) return res.status(404).json({ message: "Not found" });
      res.json(c);
    } catch (e) { res.status(500).json({ message: "Failed to fetch credit check" }); }
  });
  app.post("/api/credit-checks", requireAuth, async (req: any, res) => {
    try {
      const check = await storage.createCreditCheck(req.body);
      await storage.createActivity({ userId: req.user.id, type: "credit_check_created", description: `Credit check created for ${req.body.entityName}`, entityType: req.body.entityType, entityId: req.body.entityId });
      res.status(201).json(check);
    } catch (e) { res.status(500).json({ message: "Failed to create credit check" }); }
  });
  app.patch("/api/credit-checks/:id", requireAuth, async (req: any, res) => {
    try {
      const updated = await storage.updateCreditCheck(Number(req.params.id), req.body);
      if (req.body.status) {
        await storage.createActivity({ userId: req.user.id, type: "credit_check_updated", description: `Credit check status changed to ${req.body.status}`, entityType: "credit_check", entityId: updated.id });
      }
      res.json(updated);
    } catch (e) { res.status(500).json({ message: "Failed to update credit check" }); }
  });
  app.delete("/api/credit-checks/:id", requireAdmin, async (req, res) => {
    try { await storage.deleteCreditCheck(Number(req.params.id)); res.json({ ok: true }); } catch (e) { res.status(500).json({ message: "Failed to delete" }); }
  });

  // ─── ACH Settings ─────────────────────────────────────────────────────────
  app.get("/api/ach-settings/:clientId", requireAuth, async (req, res) => {
    try {
      const s = await storage.getAchSettings(Number(req.params.clientId));
      res.json(s ?? null);
    } catch (e) { res.status(500).json({ message: "Failed to fetch ACH settings" }); }
  });
  app.put("/api/ach-settings/:clientId", requireAuth, async (req: any, res) => {
    try {
      const s = await storage.upsertAchSettings(Number(req.params.clientId), req.body);
      await storage.createActivity({ userId: req.user.id, type: "ach_settings_updated", description: `ACH settings updated for client ${req.params.clientId}`, entityType: "client", entityId: Number(req.params.clientId) });
      res.json(s);
    } catch (e) { res.status(500).json({ message: "Failed to save ACH settings" }); }
  });
  app.patch("/api/ach-settings/:clientId/verify", requireAdmin, async (req: any, res) => {
    try {
      const s = await storage.upsertAchSettings(Number(req.params.clientId), { status: "active", verifiedBy: req.user.id } as any);
      res.json(s);
    } catch (e) { res.status(500).json({ message: "Failed to verify ACH" }); }
  });

  // ─── Lockbox ──────────────────────────────────────────────────────────────
  app.get("/api/lockbox", requireAuth, async (req: any, res) => {
    try {
      const { status, dateFrom, dateTo } = req.query as Record<string, string>;
      const entries = await storage.getLockboxEntries({ status, dateFrom, dateTo });
      res.json(entries);
    } catch (e) { res.status(500).json({ message: "Failed to fetch lockbox entries" }); }
  });

  app.post("/api/lockbox", requireAuth, async (req: any, res) => {
    try {
      const parsed = insertLockboxEntrySchema.safeParse({ ...req.body, createdBy: req.user.id });
      if (!parsed.success) return res.status(400).json({ message: "Validation error", errors: parsed.error.errors });
      const entry = await storage.createLockboxEntry(parsed.data);
      await storage.createActivity({ userId: req.user.id, type: "lockbox_entry_created", description: `Lockbox entry from ${entry.payorName} — $${entry.amount}`, entityType: "payment", entityId: entry.id });
      res.status(201).json(entry);
    } catch (e) { res.status(500).json({ message: "Failed to create lockbox entry" }); }
  });

  app.patch("/api/lockbox/:id", requireAuth, async (req: any, res) => {
    try {
      const entry = await storage.getLockboxEntry(Number(req.params.id));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      const updated = await storage.updateLockboxEntry(Number(req.params.id), req.body);
      res.json(updated);
    } catch (e) { res.status(500).json({ message: "Failed to update lockbox entry" }); }
  });

  app.post("/api/lockbox/:id/match", requireAuth, async (req: any, res) => {
    try {
      const { matches, paymentMethod = "ach" } = req.body as { matches: Array<{ invoiceId: number; invoiceNumber: string; invoiceAmount: number; appliedAmount: number; varianceType: string; varianceReason?: string }>; paymentMethod?: string };
      if (!matches?.length) return res.status(400).json({ message: "No invoice matches provided" });
      const result = await storage.matchLockboxEntry(Number(req.params.id), matches, req.user.id, paymentMethod);
      // Advance matched invoices to payment_receipt stage
      for (const line of result.lines) {
        advanceInvoiceStage(line.invoiceId, "payment_receipt", req.user.id, "Payment matched via lockbox").catch(() => {});
      }
      await storage.createActivity({ userId: req.user.id, type: "lockbox_matched", description: `Lockbox entry #${req.params.id} matched to ${matches.length} invoice(s)`, entityType: "payment", entityId: result.cashApplication.id });
      res.json(result);
    } catch (e: any) { res.status(500).json({ message: e.message ?? "Failed to match entry" }); }
  });

  app.delete("/api/lockbox/:id", requireAuth, async (req: any, res) => {
    try {
      const entry = await storage.getLockboxEntry(Number(req.params.id));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      if (entry.status !== "unmatched") return res.status(409).json({ message: "Only unmatched entries can be deleted" });
      await storage.deleteLockboxEntry(Number(req.params.id));
      res.json({ success: true });
    } catch (e) { res.status(500).json({ message: "Failed to delete lockbox entry" }); }
  });

  // ─── Cash Applications ────────────────────────────────────────────────────
  app.get("/api/cash-applications", requireAuth, async (_req, res) => {
    try { res.json(await storage.getCashApplications()); } catch (e) { res.status(500).json({ message: "Failed to fetch" }); }
  });
  app.get("/api/cash-applications/:id", requireAuth, async (req, res) => {
    try {
      const c = await storage.getCashApplication(Number(req.params.id));
      if (!c) return res.status(404).json({ message: "Not found" });
      const lines = await storage.getPaymentApplicationLines(Number(req.params.id));
      res.json({ ...c, lines });
    } catch (e) { res.status(500).json({ message: "Failed to fetch" }); }
  });
  app.post("/api/cash-applications", requireAuth, async (req: any, res) => {
    try {
      const body = { ...req.body, processedBy: req.user.id, debtorId: req.body.debtorId ?? null };
      const ca = await storage.createCashApplication(body);
      await storage.createActivity({ userId: req.user.id, type: "payment_received", description: `Payment recorded: ${req.body.paymentReference} — $${req.body.totalReceived}`, entityType: "payment", entityId: ca.id });
      res.status(201).json(ca);
    } catch (e) { res.status(500).json({ message: "Failed to create" }); }
  });
  app.post("/api/cash-applications/:id/apply", requireAuth, async (req: any, res) => {
    try {
      const lines = await storage.applyPaymentToInvoices(Number(req.params.id), req.body.lines);
      await storage.createActivity({ userId: req.user.id, type: "payment_applied", description: `Payment ${req.params.id} applied to ${lines.length} invoice(s)`, entityType: "payment", entityId: Number(req.params.id) });
      // Advance each affected invoice to payment_receipt stage
      const uniqueInvoiceIds = Array.from(new Set(lines.map((l: any) => l.invoiceId).filter(Boolean)));
      for (const invId of uniqueInvoiceIds) {
        advanceInvoiceStage(invId, "payment_receipt", req.user.id, "Payment applied via cash application").catch(() => {});
      }
      res.json(lines);
    } catch (e) { console.error(e); res.status(500).json({ message: "Failed to apply payment" }); }
  });

  // ─── Exceptions ───────────────────────────────────────────────────────────
  app.get("/api/exceptions", requireAuth, async (_req, res) => {
    try { res.json(await storage.getExceptions()); } catch (e) { res.status(500).json({ message: "Failed to fetch" }); }
  });
  app.post("/api/exceptions", requireAuth, async (req: any, res) => {
    try {
      const exc = await storage.createException({ ...req.body, createdBy: req.user.id });
      res.status(201).json(exc);
    } catch (e) { res.status(500).json({ message: "Failed to create exception" }); }
  });
  app.patch("/api/exceptions/:id", requireAuth, async (req: any, res) => {
    try {
      const exc = await storage.updateException(Number(req.params.id), { ...req.body, resolvedBy: req.body.status === "resolved" ? req.user.id : undefined });
      res.json(exc);
    } catch (e) { res.status(500).json({ message: "Failed to update exception" }); }
  });

  // ─── FMCSA Authority Checks ───────────────────────────────────────────────
  app.get("/api/settings/fmcsa-key", requireAuth, async (_req, res) => {
    try {
      res.json(await getFmcsaKeyStatus());
    } catch (e: any) {
      console.error("[FMCSA Settings] Failed to load key status:", e?.message ?? e);
      res.status(500).json({ message: "FMCSA key status is unavailable. Check server encryption and database configuration." });
    }
  });

  app.get("/api/fmcsa/status", requireAuth, async (_req, res) => {
    try {
      const status = await getFmcsaKeyStatus();
      res.json({ ...status, paused: !status.configured });
    } catch (e: any) {
      console.error("[FMCSA Status] Failed:", e?.message ?? e);
      res.status(500).json({ message: "FMCSA status is unavailable" });
    }
  });

  const saveFmcsaKey = async (req: any, res: any) => {
    console.info("[FMCSA Settings] Save requested", { userId: req.user.id });
    try {
      const { webKey } = req.body;
      if (!webKey || typeof webKey !== "string" || webKey.trim().length < 8) {
        console.warn("[FMCSA Settings] Save rejected: invalid key format");
        return res.status(400).json({ message: "FMCSA Web Key must be at least 8 characters" });
      }
      await saveConfiguredFmcsaWebKey(webKey, req.user.id);
      await storage.createActivity({
        userId: req.user.id,
        type: "fmcsa_key_configured",
        description: "FMCSA API web key configured",
        entityType: "user",
        entityId: undefined,
      });
      const status = await getFmcsaKeyStatus();
      console.info("[FMCSA Settings] Save succeeded", { userId: req.user.id, source: status.source });
      res.json({ ok: true, ...status });
    } catch (e: any) {
      console.error("[FMCSA Settings] Save failed:", e?.message ?? e);
      res.status(500).json({ message: "FMCSA key could not be saved. Check server encryption and database configuration." });
    }
  };

  app.post("/api/settings/fmcsa-key", requireAdmin, saveFmcsaKey);

  app.get("/api/authority-checks/latest", requireAuth, async (_req, res) => {
    try {
      res.json(await storage.getLatestAuthorityChecks());
    } catch (e) { res.status(500).json({ message: "Failed to fetch authority checks" }); }
  });

  app.get("/api/authority-checks/history", requireAuth, async (req, res) => {
    try {
      const { entityType, entityId } = req.query as { entityType?: string; entityId?: string };
      if (!entityType || !entityId) return res.status(400).json({ message: "entityType and entityId required" });
      const checks = await storage.getAuthorityCheckHistory(entityType, Number(entityId));
      res.json({
        entityType,
        entityId: Number(entityId),
        entityName: checks[0]?.entityName ?? null,
        checks,
      });
    } catch (e) { res.status(500).json({ message: "Failed to fetch history" }); }
  });

  app.get(
    "/api/fmcsa/entities/:id/history",
    requireAuth,
    createFmcsaHistoryHandler((entityType, entityId) =>
      storage.getAuthorityCheckHistory(entityType, entityId),
    ),
  );

  app.post("/api/authority-checks/run", requireAdmin, async (req: any, res) => {
    try {
      const { runAllAuthorityChecks } = await import("./services/authorityScheduler");
      const summary = await runAllAuthorityChecks(req.user.id);
      res.json(summary);
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to run authority checks" });
    }
  });

  app.post("/api/authority-checks/lookup", requireAuth, async (req, res) => {
    try {
      const identifier = typeof req.body?.identifier === "string" ? req.body.identifier.trim() : "";
      if (!identifier) {
        return res.status(400).json({ message: "Enter an MC# or DOT# to search" });
      }
      const digits = identifier.replace(/\D/g, "");
      if (!digits) {
        return res.status(400).json({ message: "Enter a valid MC# or DOT#" });
      }
      const isMc = /^MC(?:\s*#|\s*-\s*|\s*)/i.test(identifier);
      const result = isMc ? await queryByMc(digits) : await queryByDot(digits);
      if (result.status === "no_key") {
        return res.status(400).json({ message: "Please configure your FMCSA Web Key above to use MC Check" });
      }
      if (result.status === "not_found") {
        return res.status(404).json({ message: `No FMCSA carrier found for ${isMc ? "MC" : "DOT"}# ${digits}` });
      }
      if (result.status === "api_error" || !result.carrier) {
        return res.status(502).json({ message: result.errorMessage || "FMCSA lookup failed" });
      }
      res.json({
        identifierType: isMc ? "MC" : "DOT",
        identifier: digits,
        carrier: result.carrier,
      });
    } catch (e: any) {
      const message = e?.message ?? "FMCSA lookup failed";
      console.error("[FMCSA Lookup] Failed:", message);
      res.status(500).json({ message });
    }
  });

  // Backward-compatible endpoint for existing clients.
  app.post("/api/authority-checks/configure-key", requireAdmin, saveFmcsaKey);

  app.get("/api/authority-checks/integration-runs", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 100);
      res.json(await storage.getIntegrationRuns(limit));
    } catch (e) { res.status(500).json({ message: "Failed to fetch integration runs" }); }
  });

  app.get("/api/authority-alerts", requireAuth, async (_req, res) => {
    try {
      res.json(await storage.getAuthorityAlerts());
    } catch (e) { res.status(500).json({ message: "Failed to fetch alerts" }); }
  });

  app.patch("/api/authority-alerts/:id/resolve", requireAuth, async (req: any, res) => {
    try {
      const alert = await storage.resolveAuthorityAlert(
        Number(req.params.id),
        req.user.id,
        req.body.notes
      );
      await storage.createActivity({
        userId: req.user.id,
        type: "authority_alert_resolved",
        description: `FMCSA authority alert resolved for ${alert.entityName ?? alert.entityType + " #" + alert.entityId}`,
        entityType: "broker",
        entityId: alert.entityType === "broker" ? alert.entityId : undefined,
      });
      res.json(alert);
    } catch (e) { res.status(500).json({ message: "Failed to resolve alert" }); }
  });

  // ─── Document Intake + Extraction ────────────────────────────────────────
  // POST /api/load-documents/intake — upload file, create doc record, kick off extraction job
  app.post("/api/load-documents/intake", requireAuth, handleUpload("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const { entityType, entityId, documentType } = req.body;
      const validEntityTypes = ["invoice", "load", "client", "broker"];
      const validDocumentTypes = [
        "rate_confirmation", "bol", "commercial_invoice", "pod", "other",
      ];
      if (!validEntityTypes.includes(entityType)) {
        return res.status(400).json({ message: "Invalid entityType" });
      }
      const eid = parseInt(entityId, 10);
      if (isNaN(eid)) return res.status(400).json({ message: "Invalid entityId" });
      if (!validDocumentTypes.includes(documentType)) {
        return res.status(400).json({ message: "Select a valid document type" });
      }

      const filename = crypto.randomUUID();
      const s3Key = await uploadDocumentToS3(req.file, `documents/${filename}`);
      const filePath = path.join("/tmp", filename);
      fs.writeFileSync(filePath, req.file.buffer);
      const docData: any = {
        filename,
        s3Key,
        originalName: sanitizeOriginalName(req.file.originalname),
        mimeType:     req.file.mimetype,
        size:         req.file.size,
        ...documentSizeMetadata(req.file),
        documentType,
        finalDocumentType: documentType,
        uploadedBy:   req.user.id,
        sourceChannel: "drag_drop" as const,
        status:       "processing" as const,
        loadId:    entityType === "load"    ? eid : null,
        invoiceId: entityType === "invoice" ? eid : null,
      };

      const doc = await storage.createDocument(docData);

      // Create extraction job and enqueue for background processing
      const [job] = await db
        .insert(docExtractionJobs)
        .values({ documentId: doc.id, jobType: "pdf_text", status: "queued" })
        .returning();

      jobQueue.enqueue({ jobId: job.id, documentId: doc.id, filePath, mimeType: req.file.mimetype });

      await storage.createActivity({
        userId:      req.user.id,
        type:        "document_uploaded",
        description: `Uploaded via drag-drop: ${doc.originalName}`,
        entityType:  "document",
        entityId:    doc.id,
        metadata:    buildDocumentMetadata(doc),
      });

      res.status(201).json({
        documentId:    doc.id,
        jobId:         job.id,
        originalName:  doc.originalName,
        mimeType:      doc.mimeType,
        size:          doc.size,
        extractionStatus: "queued",
      });
    } catch (err) {
      console.error("Intake error:", err);
      res.status(500).json({ message: "Failed to process document intake" });
    }
  });

  // GET /api/load-documents/:id/extraction-status — poll extraction job status
  app.get("/api/load-documents/:id/extraction-status", requireAuth, async (req, res) => {
    try {
      const docId = parseInt(req.params.id, 10);
      if (isNaN(docId)) return res.status(400).json({ message: "Invalid id" });

      const jobs = await db
        .select()
        .from(docExtractionJobs)
        .where(eq(docExtractionJobs.documentId, docId))
        .orderBy(desc(docExtractionJobs.createdAt))
        .limit(1);

      if (!jobs.length) return res.json({ status: "queued" });

      const job = jobs[0];

      // Also fetch classification info from the document
      const docRows = await db
        .select({
          candidateDocumentType:      documentsTable.candidateDocumentType,
          finalDocumentType:          documentsTable.finalDocumentType,
          classificationConfidence:   documentsTable.classificationConfidence,
          aiDocumentType:             documentsTable.aiDocumentType,
          aiClassificationConfidence: documentsTable.aiClassificationConfidence,
          aiClassificationSignals:    documentsTable.aiClassificationSignals,
          allClassificationScores:    documentsTable.allClassificationScores,
          classificationSource:       documentsTable.classificationSource,
          aiClassifiedAt:             documentsTable.aiClassifiedAt,
          aiClassificationModel:      documentsTable.aiClassificationModel,
        })
        .from(documentsTable)
        .where(eq(documentsTable.id, docId))
        .limit(1);

      const docInfo = docRows[0] ?? {};

      res.json({
        status:       job.status,
        jobId:        job.id,
        parserName:   job.parserName,
        startedAt:    job.startedAt,
        completedAt:  job.completedAt,
        errorMessage: job.errorMessage,
        candidateDocumentType:      docInfo.candidateDocumentType ?? null,
        finalDocumentType:          docInfo.finalDocumentType ?? null,
        classificationConfidence:   docInfo.classificationConfidence ?? null,
        aiDocumentType:             docInfo.aiDocumentType ?? null,
        aiClassificationConfidence: docInfo.aiClassificationConfidence ?? null,
        aiClassificationSignals:    docInfo.aiClassificationSignals ?? null,
        allClassificationScores:    docInfo.allClassificationScores ?? null,
        classificationSource:       docInfo.classificationSource ?? "rules",
        aiClassifiedAt:             docInfo.aiClassifiedAt ?? null,
        aiClassificationModel:      docInfo.aiClassificationModel ?? null,
      });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch extraction status" });
    }
  });

  // POST /api/load-documents/:id/ai-classify — trigger on-demand AI classification
  app.post("/api/load-documents/:id/ai-classify", requireAuth, async (req, res) => {
    try {
      const docId = parseInt(req.params.id, 10);
      if (isNaN(docId)) return res.status(400).json({ message: "Invalid id" });

      // Fetch the document and its most recent extraction text
      const docRows = await db
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.id, docId))
        .limit(1);
      if (!docRows.length) return res.status(404).json({ message: "Document not found" });

      const extractionRows = await db
        .select()
        .from(docExtractionResults)
        .where(eq(docExtractionResults.documentId, docId))
        .orderBy(desc(docExtractionResults.createdAt))
        .limit(1);

      const storedRaw = extractionRows[0]?.rawPayloadJson as { providerRaw?: { pageResults?: { text?: string }[] } } | undefined;
      const text = storedRaw?.providerRaw?.pageResults?.[0]?.text || extractionRows[0]?.mainText || extractionRows[0]?.fullText;
      if (!text) return res.status(422).json({ message: "No extracted text available — run extraction first" });

      const aiResult = await classifyDocumentAI(text);
      const reviewType = reviewDocumentType(aiResult.docType);

      // Persist AI result back to the document
      await db
        .update(documentsTable)
        .set({
          aiDocumentType:             reviewType,
          aiClassificationConfidence: String(aiResult.confidence),
          aiClassificationSignals:    aiResult.signals,
          allClassificationScores:    aiResult.allScores,
          classificationSource:       aiResult.source as any,
          aiClassifiedAt:             new Date(),
          aiClassificationModel:      aiResult.model,
          candidateDocumentType: reviewType as any,
          classificationConfidence: String(aiResult.confidence),
        })
        .where(eq(documentsTable.id, docId));

      const [linkedDocument] = await db.select({ invoiceId: documentsTable.invoiceId })
        .from(documentsTable).where(eq(documentsTable.id, docId)).limit(1);
      if (linkedDocument?.invoiceId) await refreshInvoiceDocumentRequirements(linkedDocument.invoiceId);

      res.json({
        docType:    reviewType,
        confidence: aiResult.confidence,
        signals:    aiResult.signals,
        allScores:  aiResult.allScores,
        model:      aiResult.model,
        source:     aiResult.source,
      });
    } catch (err: any) {
      console.error("[ai-classify] error:", err?.message);
      res.status(500).json({ message: "AI classification failed", detail: err?.message });
    }
  });

  // GET /api/load-documents/:id/extraction-result — full extracted text
  app.get("/api/load-documents/:id/extraction-result", requireAuth, async (req, res) => {
    try {
      const docId = parseInt(req.params.id, 10);
      if (isNaN(docId)) return res.status(400).json({ message: "Invalid id" });

      const results = await db
        .select()
        .from(docExtractionResults)
        .where(eq(docExtractionResults.documentId, docId))
        .orderBy(desc(docExtractionResults.createdAt))
        .limit(1);

      res.json(results[0] ?? null);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch extraction result" });
    }
  });

  // GET /api/load-documents/:id/field-candidates — extracted field suggestions
  app.get("/api/load-documents/:id/field-candidates", requireAuth, async (req, res) => {
    try {
      const docId = parseInt(req.params.id, 10);
      if (isNaN(docId)) return res.status(400).json({ message: "Invalid id" });

      const candidates = await db
        .select()
        .from(docFieldCandidates)
        .where(eq(docFieldCandidates.documentId, docId))
        .orderBy(docFieldCandidates.fieldName);

      res.json(candidates);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch field candidates" });
    }
  });

  // GET /api/load-documents/:id/review — get existing review for a document
  app.get("/api/load-documents/:id/review", requireAuth, async (req, res) => {
    try {
      const docId = parseInt(req.params.id, 10);
      if (isNaN(docId)) return res.status(400).json({ message: "Invalid id" });

      const reviews = await db
        .select()
        .from(docReviews)
        .where(eq(docReviews.documentId, docId))
        .orderBy(desc(docReviews.createdAt))
        .limit(1);

      res.json(reviews[0] ?? null);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch review" });
    }
  });

  // GET /api/load-documents/:id/detail — document metadata for review panel
  app.get("/api/load-documents/:id/detail", requireAuth, async (req, res) => {
    try {
      const docId = parseInt(req.params.id, 10);
      if (isNaN(docId)) return res.status(400).json({ message: "Invalid id" });
      const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, docId));
      if (!doc) return res.status(404).json({ message: "Document not found" });
      res.json(doc);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch document detail" });
    }
  });

  // PATCH /api/doc-field-candidates/:id — inline-edit a field value
  app.patch("/api/doc-field-candidates/:id", requireAuth, async (req: any, res) => {
    try {
      const candId = parseInt(req.params.id, 10);
      if (isNaN(candId)) return res.status(400).json({ message: "Invalid id" });
      const { fieldValue } = req.body;
      const [updated] = await db
        .update(docFieldCandidates)
        .set({ fieldValue: fieldValue ?? null })
        .where(eq(docFieldCandidates.id, candId))
        .returning();
      if (!updated) return res.status(404).json({ message: "Field candidate not found" });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: "Failed to update field candidate" });
    }
  });

  // POST /api/load-documents/:id/review — submit review (confirm/reject/unreadable/retry)
  app.post("/api/load-documents/:id/review", requireAuth, async (req: any, res) => {
    try {
      const docId = parseInt(req.params.id, 10);
      if (isNaN(docId)) return res.status(400).json({ message: "Invalid id" });

      const { reviewStatus, reviewNotes, finalFieldsJson } = req.body;
      const validStatuses = ["pending", "confirmed", "rejected", "unreadable"];
      if (!validStatuses.includes(reviewStatus)) {
        return res.status(400).json({ message: "Invalid reviewStatus" });
      }

      // Fetch the document to get its effective type + invoice linkage
      const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, docId));
      if (!doc) return res.status(404).json({ message: "Document not found" });

      // When confirming: update documents.documentType so lifecycle guards work
      if (reviewStatus === "confirmed") {
        const effectiveType = documentClassification(doc) as any;
        await storage.updateDocument(docId, {
          documentType: effectiveType, finalDocumentType: effectiveType, classificationSource: "agent",
        });
      }

      const [review] = await db
        .insert(docReviews)
        .values({
          documentId:       docId,
          reviewedByUserId: req.user.id,
          reviewStatus,
          reviewNotes:      reviewNotes ?? null,
          finalFieldsJson:  finalFieldsJson ?? null,
          reviewedAt:       new Date(),
        })
        .returning();

      await storage.createActivity({
        userId:      req.user.id,
        type:        "document_reviewed",
        description: `Document #${docId} marked as ${reviewStatus}`,
        entityType:  "document",
        entityId:    docId,
      });

      // Workflow integration — emit event + check completeness when confirming
      if (reviewStatus === "confirmed" && doc.invoiceId) {
        const effectiveType = documentClassification(doc);
        const completeness = await getDocumentCompleteness(doc.invoiceId);
        await db.insert(eventLedger).values({
          entityType:  "invoice",
          entityId:    doc.invoiceId,
          eventType:   "doc_confirmed",
          actorType:   "user",
          actorId:     req.user.id,
          payloadJson: {
            documentId:          docId,
            documentType:        effectiveType,
            completenessPercent: completeness.completenessPercent,
            canStartReview:      completeness.canStartReview,
            canApprove:          completeness.canApprove,
          },
        });
      }

      res.status(201).json({ ...review, invoiceId: doc.invoiceId });
    } catch (err) {
      res.status(500).json({ message: "Failed to save review" });
    }
  });

  // PATCH /api/load-documents/:id/document-type — agent override of classified doc type
  app.patch("/api/load-documents/:id/document-type", requireAuth, async (req: any, res) => {
    try {
      const docId = parseInt(req.params.id, 10);
      if (isNaN(docId)) return res.status(400).json({ message: "Invalid id" });

      const VALID_TYPES = [
        "rate_confirmation", "bill_of_lading", "proof_of_delivery",
        "lumper_receipt", "invoice", "receipt", "other",
      ];
      const { finalDocumentType } = req.body;
      if (!VALID_TYPES.includes(finalDocumentType)) {
        return res.status(400).json({ message: "Invalid document type" });
      }

      const [updated] = await db
        .update(documentsTable)
        .set({ finalDocumentType: finalDocumentType as any, classificationSource: "agent" })
        .where(eq(documentsTable.id, docId))
        .returning({
          id: documentsTable.id,
          invoiceId: documentsTable.invoiceId,
          candidateDocumentType: documentsTable.candidateDocumentType,
          finalDocumentType: documentsTable.finalDocumentType,
          classificationConfidence: documentsTable.classificationConfidence,
        });

      if (!updated) return res.status(404).json({ message: "Document not found" });
      if (updated.invoiceId) await refreshInvoiceDocumentRequirements(updated.invoiceId);

      await storage.createActivity({
        userId:      req.user.id,
        type:        "document_reviewed",
        description: `Doc #${docId} type overridden to: ${finalDocumentType}`,
        entityType:  "document",
        entityId:    docId,
        metadata:    { originalName: finalDocumentType } as any,
      }).catch(() => {});

      res.json(updated);
    } catch (err) {
      console.error("doc-type patch error:", err);
      res.status(500).json({ message: "Failed to update document type" });
    }
  });

  // POST /api/load-documents/:id/retry-extraction — re-queue failed job
  app.post("/api/load-documents/:id/retry-extraction", requireAuth, async (req: any, res) => {
    try {
      const docId = parseInt(req.params.id, 10);
      if (isNaN(docId)) return res.status(400).json({ message: "Invalid id" });

      const docs = await db
        .select()
        .from(documentsTable)
        .where(eq(documentsTable.id, docId))
        .limit(1);

      if (!docs.length) return res.status(404).json({ message: "Document not found" });
      const doc = docs[0];

      if (req.user.role === "employee" &&
          (!doc.invoiceId || !await employeeCanAccessInvoice(req, doc.invoiceId))) {
        return res.status(403).json({ message: "You may only retry your own invoice documents" });
      }
      if (doc.status !== "failed") return res.status(409).json({ message: "Only failed documents can be retried" });

      // For S3 docs: download to /tmp for OCR; for legacy docs: use uploads/ path
      let filePath = path.join("/tmp", doc.filename);
      if (!fs.existsSync(filePath)) {
        const legacyPath = path.join("uploads", doc.filename);
        if (fs.existsSync(legacyPath)) {
          filePath = legacyPath;
        } else if ((doc as any).s3Key) {
          await downloadToTemp((doc as any).s3Key, filePath);
        }
      }
      if (!fs.existsSync(filePath)) return res.status(404).json({ message: "Original document file is unavailable" });
      const job = await db.transaction(async tx => {
        const [claimed] = await tx.update(documentsTable).set({ status: "processing" })
          .where(and(eq(documentsTable.id, docId), eq(documentsTable.status, "failed")))
          .returning({ id: documentsTable.id });
        if (!claimed) return null;
        const [created] = await tx.insert(docExtractionJobs)
          .values({ documentId: docId, jobType: "ocr", status: "queued" }).returning();
        return created;
      });
      if (!job) return res.status(409).json({ message: "OCR retry already started" });
      jobQueue.enqueue({ jobId: job.id, documentId: docId, filePath, mimeType: doc.mimeType });

      res.json({ jobId: job.id, status: "queued" });
    } catch (err) {
      res.status(500).json({ message: "Failed to retry extraction" });
    }
  });

  // ─── Audit endpoints ──────────────────────────────────────────────────────
  app.get("/api/audit/events", requireAuth, async (req, res) => {
    try {
      const entityType = (req.query.entityType as string) || undefined;
      const limit = Math.min(parseInt((req.query.limit as string) || "500", 10), 500);
      const rows = await storage.getEventLedger(entityType, limit);
      res.json(rows);
    } catch (e) { res.status(500).json({ message: "Failed to fetch events" }); }
  });
  app.get("/api/audit/status-history", requireAuth, async (_req, res) => {
    try { res.json(await storage.getInvoiceStatusHistoryAll()); } catch (e) { res.status(500).json({ message: "Failed to fetch status history" }); }
  });

  // ─── Stuck OCR jobs monitoring ─────────────────────────────────────────────
  app.get("/api/documents/stuck-jobs", requireAdmin, async (_req, res) => {
    try {
      const stuck = await db
        .select({
          jobId:      docExtractionJobs.id,
          documentId: docExtractionJobs.documentId,
          status:     docExtractionJobs.status,
          jobType:    docExtractionJobs.jobType,
          attemptCount: docExtractionJobs.attemptCount,
          createdAt:  docExtractionJobs.createdAt,
          startedAt:  docExtractionJobs.startedAt,
          filename:   documentsTable.filename,
          originalName: documentsTable.originalName,
        })
        .from(docExtractionJobs)
        .innerJoin(documentsTable, eq(documentsTable.id, docExtractionJobs.documentId))
        .where(inArray(docExtractionJobs.status, ["queued", "processing"]));

      res.json({ count: stuck.length, jobs: stuck });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to query stuck jobs", error: err?.message });
    }
  });

  // ── Demo seed ──────────────────────────────────────────────────────────────
  app.get("/api/admin/seed-demo/status", requireAdmin, async (_req, res) => {
    try {
      const existing = await db
        .select({ id: loads.id })
        .from(loads)
        .where(eq(loads.loadNumber, "DEMO-2024-001"))
        .limit(1);
      res.json({ seeded: existing.length > 0 });
    } catch (err: any) {
      res.status(500).json({ message: "Status check failed", error: err?.message });
    }
  });

  // ── Bounce/failure summary for follow-up header ─────────────────────────────
  app.get("/api/broker-follow-up-reminders/delivery-summary", requireAuth, async (_req, res) => {
    try {
      const rows = await db
        .select({ deliveryStatus: brokerFollowUpReminders.deliveryStatus })
        .from(brokerFollowUpReminders)
        .where(
          inArray(brokerFollowUpReminders.deliveryStatus as any, ["bounced", "failed", "spam"]),
        );

      const bounced = rows.filter(r => r.deliveryStatus === "bounced").length;
      const failed  = rows.filter(r => r.deliveryStatus === "failed").length;
      const spam    = rows.filter(r => r.deliveryStatus === "spam").length;
      res.json({ bounced, failed, spam, total: bounced + failed + spam });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to fetch delivery summary" });
    }
  });

  // ─── Reports API ──────────────────────────────────────────────────────────────

  const reportDateRange = (query: Record<string, unknown>) => {
    const parse = (value: unknown, label: string, endOfDay = false) => {
      if (!value) return undefined;
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${label}`);
      if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) date.setHours(23, 59, 59, 999);
      return date;
    };
    const start = parse(query.startDate, "startDate");
    const end = parse(query.endDate, "endDate", true);
    if (start && end && start > end) throw new Error("startDate must be before endDate");
    return { start, end };
  };

  const inReportRange = (date: Date | null, range: { start?: Date; end?: Date }) =>
    !!date && (!range.start || date >= range.start) && (!range.end || date <= range.end);

  // Global reports deliberately use a small, presentation-neutral contract so the
  // web table and exported PDF cannot diverge.  Keep the directory projections
  // explicit: client banking, tax, owner, and onboarding fields must never leak.
  const globalReportIds = new Set([
    "aging-1", "aging-45", "aging-60", "aging-90", "aging-100", "todays-deposits",
    "all-short-pay", "uncollected-2025", "dso", "monthly-sales-journal",
    "aging-90-chargebacks", "brokers-all", "brokers-active", "brokers-inactive",
    "brokers-active-dump", "brokers-active-otr", "carriers-all", "carriers-active-all",
    "carriers-active-basic", "carriers-active-dump-all", "carriers-active-dump-basic",
    "carriers-active-otr-all", "carriers-active-otr-basic", "carriers-top-20", "carriers-noa",
  ]);
  const globalReportTitles: Record<string, string> = {
    "aging-1": "1+ Day Aging Report", "aging-45": "45+ Days Aging Report",
    "aging-60": "60+ Days Aging Report", "aging-90": "90+ Days Aging Report",
    "aging-100": "100+ Days Aging Report", "todays-deposits": "Today's Deposits",
    "all-short-pay": "All Short Pay Report", "uncollected-2025": "2025 Uncollected AR",
    dso: "DSO (Days Sales Outstanding)", "monthly-sales-journal": "Monthly Sales Journal Reports",
    "aging-90-chargebacks": "90 Plus Days Reports", "brokers-all": "All Broker List",
    "brokers-active": "All Active Broker List", "brokers-inactive": "All Inactive Broker List",
    "brokers-active-dump": "Active Broker (Dump)", "brokers-active-otr": "Active Broker (OTR)",
    "carriers-all": "All Carrier List", "carriers-active-all": "Active Carrier all info (All)",
    "carriers-active-basic": "Active Carrier less info (All)",
    "carriers-active-dump-all": "Active Carrier all info (Dump)",
    "carriers-active-dump-basic": "Active Carrier less info (Dump)",
    "carriers-active-otr-all": "Active Carrier all info (OTR)",
    "carriers-active-otr-basic": "Active Carrier less info (OTR)",
    "carriers-top-20": "Active Carrier Top 20", "carriers-noa": "Carrier's NOA",
  };
  type GlobalReport = {
    title: string;
    columns: Array<{ key: string; label: string; type?: "money" | "date" | "number" | "text" }>;
    rows: Array<Record<string, string | number | null>>;
    summary: { count: number; totalAmount: number };
  };
  const globalColumns = {
    invoice: [
      { key: "invoiceNumber", label: "Invoice" }, { key: "carrier", label: "Carrier" },
      { key: "broker", label: "Broker / Debtor" }, { key: "amount", label: "Amount", type: "money" as const },
      { key: "fundedDate", label: "Funded Date", type: "date" as const },
      { key: "ageDays", label: "Age (Days)", type: "number" as const }, { key: "status", label: "Status" },
      { key: "outstanding", label: "Outstanding", type: "money" as const },
    ],
    broker: [
      { key: "name", label: "Name" }, { key: "mcNumber", label: "MC #" }, { key: "contactPerson", label: "Contact" },
      { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "status", label: "Status" },
      { key: "address", label: "Address" }, { key: "city", label: "City" }, { key: "state", label: "State" },
      { key: "zipCode", label: "ZIP" }, { key: "dotNumber", label: "DOT #" },
      { key: "creditLimit", label: "Credit Limit", type: "money" as const },
      { key: "paymentTerms", label: "Payment Terms" }, { key: "createdAt", label: "Created", type: "date" as const },
    ],
    carrierBasic: [
      { key: "name", label: "Name" }, { key: "mcNumber", label: "MC #" },
      { key: "email", label: "Email" }, { key: "phone", label: "Phone" },
    ],
    carrierFull: [
      { key: "name", label: "Name" }, { key: "mcNumber", label: "MC #" }, { key: "contactPerson", label: "Contact" },
      { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "address", label: "Address" },
      { key: "ratePercent", label: "Rate %", type: "number" as const },
      { key: "advanceRate", label: "Advance Rate", type: "number" as const },
      { key: "factoringFeeRate", label: "Factoring Fee", type: "number" as const },
      { key: "language", label: "Language" }, { key: "reviewed", label: "Reviewed", type: "date" as const },
      { key: "nextReview", label: "Next Review", type: "date" as const },
      { key: "reserves", label: "Reserves", type: "money" as const },
      { key: "shorts", label: "Shorts", type: "money" as const },
      { key: "status", label: "Status" }, { key: "createdAt", label: "Created", type: "date" as const },
    ],
  };
  const reportDate = (value: Date | null | undefined) => value ? value.toISOString().slice(0, 10) : null;
  const businessDate = (value: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(value);
    const part = (type: string) => parts.find(item => item.type === type)?.value || "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const normalized = (value: string | null | undefined) => (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const buildGlobalReport = async (reportId: string): Promise<GlobalReport> => {
    if (!globalReportIds.has(reportId)) throw Object.assign(new Error("Report not found"), { status: 404 });
    const title = globalReportTitles[reportId];
    const allInvoices = await db.select({
      id: invoices.id, invoiceNumber: invoices.invoiceNumber, amount: invoices.amount, status: invoices.status,
      fundedAt: invoices.fundedAt, invoiceDate: invoices.invoiceDate, createdAt: invoices.createdAt,
      brokerConfirmationStatus: invoices.brokerConfirmationStatus,
      clientId: invoices.clientId, carrier: clients.name, brokerId: invoices.brokerId, debtorId: invoices.debtorId,
      broker: sql<string | null>`coalesce(${brokers.name}, ${debtors.name})`,
      debtorMcNumber: sql<string | null>`coalesce(${brokers.mcNumber}, ${debtors.mcNumber})`,
      loadType: invoices.loadType, chargebackStatus: invoices.chargebackStatus,
    }).from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .leftJoin(brokers, eq(invoices.brokerId, brokers.id))
      .leftJoin(debtors, eq(invoices.debtorId, debtors.id));
    const lines = await db.select({
      invoiceId: paymentApplicationLines.invoiceId, appliedAmount: paymentApplicationLines.appliedAmount,
      variance: paymentApplicationLines.variance, varianceType: paymentApplicationLines.varianceType,
      createdAt: paymentApplicationLines.createdAt,
      paymentDate: cashApplications.paymentDate,
    }).from(paymentApplicationLines).leftJoin(cashApplications, eq(paymentApplicationLines.cashApplicationId, cashApplications.id));
    const applied = new Map<number, number>();
    const settled = new Map<number, number>();
    const shortPay = new Set<number>();
    const paymentEvents = new Map<number, Array<{ date: Date; amount: number }>>();
    for (const line of lines) {
      const amount = Number(line.appliedAmount);
      applied.set(line.invoiceId, (applied.get(line.invoiceId) || 0) + amount);
      const adjustment = line.varianceType === "write_off" ? Math.abs(Number(line.variance || 0)) : 0;
      settled.set(line.invoiceId, (settled.get(line.invoiceId) || 0) + amount + adjustment);
      if (line.varianceType === "short_pay") shortPay.add(line.invoiceId);
      const date = line.paymentDate || line.createdAt;
      if (date) {
        const events = paymentEvents.get(line.invoiceId) || [];
        events.push({ date, amount });
        paymentEvents.set(line.invoiceId, events);
      }
    }
    const shortPayExceptions = await db.select({
      invoiceId: exceptions.entityId, status: exceptions.status,
    }).from(exceptions).where(and(eq(exceptions.type, "short_pay"), eq(exceptions.entityType, "invoice")));
    const shortPayExceptionStates = new Map<number, Set<string>>();
    shortPayExceptions.forEach(item => {
      if (!item.invoiceId) return;
      const states = shortPayExceptionStates.get(item.invoiceId) || new Set<string>();
      states.add(item.status);
      shortPayExceptionStates.set(item.invoiceId, states);
    });
    const invoiceReport = (predicate: (invoice: typeof allInvoices[number], outstanding: number, age: number) => boolean, chargebacks = false): GlobalReport => {
      const now = new Date();
      const rows = allInvoices.map(invoice => {
        const outstanding = Math.max(0, Number(invoice.amount) - (settled.get(invoice.id) || 0));
        const ageDays = invoice.fundedAt ? fundedAgeDays(invoice.fundedAt, now) : 0;
        return { invoice, outstanding, ageDays };
      }).filter(({ invoice, outstanding, ageDays }) => predicate(invoice, outstanding, ageDays))
        .map(({ invoice, outstanding, ageDays }) => ({
          invoiceNumber: invoice.invoiceNumber, brokerId: invoice.brokerId ?? invoice.debtorId,
          carrier: invoice.carrier || `Carrier #${invoice.clientId}`,
          broker: invoice.broker || "Unassigned", amount: Number(invoice.amount), fundedDate: reportDate(invoice.fundedAt),
          ageDays, status: invoice.status, outstanding: +outstanding.toFixed(2),
          confirmationStatus: invoice.brokerConfirmationStatus,
          ...(chargebacks ? { chargebackStatus: invoice.chargebackStatus } : {}),
        })).sort((a, b) => Number(b.ageDays) - Number(a.ageDays));
      const riskColumns = [...globalColumns.invoice, { key: "confirmationStatus", label: "Broker Confirmation" }];
      const columns = chargebacks ? [...riskColumns, { key: "chargebackStatus", label: "Chargeback Status" }] : riskColumns;
      return { title, columns, rows, summary: { count: rows.length, totalAmount: +rows.reduce((sum, row) => sum + Number(row.outstanding), 0).toFixed(2) } };
    };
    const agingThreshold = /^aging-(1|45|60|90|100)$/.exec(reportId);
    if (agingThreshold) return invoiceReport((invoice, outstanding, age) => !!invoice.fundedAt && outstanding > 0 && age >= Number(agingThreshold[1]));
    if (reportId === "aging-90-chargebacks") return invoiceReport((invoice, outstanding, age) => !!invoice.fundedAt && outstanding > 0 && age >= 90, true);
    if (reportId === "all-short-pay") {
      const report = invoiceReport((invoice, outstanding) => {
        const states = shortPayExceptionStates.get(invoice.id);
        const unresolved = !states || states.has("open") || states.has("under_review");
        return shortPay.has(invoice.id) && unresolved && outstanding > 0;
      });
      report.columns = [
        ...globalColumns.invoice.slice(0, -1),
        { key: "collected", label: "Collected", type: "money" },
        { key: "shortPayAmount", label: "Short Pay Amount", type: "money" },
      ];
      const invoiceByNumber = new Map(allInvoices.map(invoice => [invoice.invoiceNumber, invoice]));
      report.rows = report.rows.map(row => {
        const invoice = invoiceByNumber.get(String(row.invoiceNumber))!;
        return {
          ...Object.fromEntries(globalColumns.invoice.slice(0, -1).map(column => [column.key, row[column.key]])),
          brokerId: invoice.brokerId ?? invoice.debtorId,
          collected: +(applied.get(invoice.id) || 0).toFixed(2),
          shortPayAmount: row.outstanding,
        };
      });
      return report;
    }
    if (reportId === "uncollected-2025") return invoiceReport((invoice, outstanding) =>
      !!invoice.invoiceDate && businessDate(invoice.invoiceDate).startsWith("2025-") && outstanding > 0,
    );

    if (reportId === "todays-deposits") {
      const payoutRows = await db.select({
        id: payouts.id, invoiceId: payouts.invoiceId, netPayout: payouts.netPayout, advanceAmount: payouts.advanceAmount,
        advancePaidAt: payouts.advancePaidAt, paymentStatus: payouts.paymentStatus, invoiceNumber: invoices.invoiceNumber,
         invoiceAmount: invoices.amount, brokerId: invoices.brokerId, debtorId: invoices.debtorId, carrier: clients.name,
         broker: sql<string | null>`coalesce(${brokers.name}, ${debtors.name})`, fundedAt: invoices.fundedAt,
       }).from(payouts).innerJoin(invoices, eq(payouts.invoiceId, invoices.id))
         .leftJoin(clients, eq(invoices.clientId, clients.id))
         .leftJoin(brokers, eq(invoices.brokerId, brokers.id))
         .leftJoin(debtors, eq(invoices.debtorId, debtors.id));
      const today = businessDate(new Date());
      const rows = payoutRows.filter(row =>
        row.paymentStatus !== "pending_advance" && !!row.advancePaidAt && businessDate(row.advancePaidAt) === today,
      ).map(row => ({
        payoutId: row.id, invoiceNumber: row.invoiceNumber, brokerId: row.brokerId ?? row.debtorId,
        carrier: row.carrier || "Unknown", broker: row.broker || "Unassigned",
        amount: Number(row.netPayout || row.advanceAmount), processedDate: row.advancePaidAt ? businessDate(row.advancePaidAt) : null,
      }));
      return { title: "Today's Deposits", columns: [{ key: "payoutId", label: "Payout #" }, { key: "invoiceNumber", label: "Invoice" }, { key: "carrier", label: "Carrier" }, { key: "broker", label: "Broker" }, { key: "amount", label: "Amount", type: "money" }, { key: "processedDate", label: "Processed", type: "date" }], rows, summary: { count: rows.length, totalAmount: +rows.reduce((s, r) => s + Number(r.amount), 0).toFixed(2) } };
    }
    if (reportId === "dso") {
      const groups = new Map<string, { broker: string; count: number; days: number; amount: number }>();
      for (const invoice of allInvoices) {
        if (!invoice.fundedAt) continue;
        const events = (paymentEvents.get(invoice.id) || []).sort((a, b) => a.date.getTime() - b.date.getTime());
        let cumulative = 0;
        let end: Date | undefined;
        for (const event of events) {
          cumulative += event.amount;
          if (cumulative >= Number(invoice.amount)) { end = event.date; break; }
        }
        if (!end) continue;
        const key = String(invoice.brokerId ?? invoice.debtorId ?? "unassigned");
        const days = Math.max(0, Math.floor((end.getTime() - invoice.fundedAt.getTime()) / 86400000));
        const group = groups.get(key) || { broker: invoice.broker || "Unassigned", count: 0, days: 0, amount: 0 };
        group.count++; group.days += days; group.amount += Number(invoice.amount); groups.set(key, group);
      }
      const grouped = Array.from(groups.values());
      const overall = grouped.reduce((total, group) => ({ count: total.count + group.count, days: total.days + group.days, amount: total.amount + group.amount }), { count: 0, days: 0, amount: 0 });
      const rows = [
        ...grouped.map(g => ({ broker: g.broker, invoiceCount: g.count, averageDays: +(g.days / g.count).toFixed(2) })),
        ...(overall.count ? [{ broker: "Overall", invoiceCount: overall.count, averageDays: +(overall.days / overall.count).toFixed(2) }] : []),
      ];
      return { title: "Days Sales Outstanding", columns: [{ key: "broker", label: "Broker / Debtor" }, { key: "invoiceCount", label: "Invoices", type: "number" }, { key: "averageDays", label: "Average Days", type: "number" }], rows, summary: { count: overall.count, totalAmount: +overall.amount.toFixed(2) } };
    }
    if (reportId === "monthly-sales-journal") {
      const payoutRows = await db.select().from(payouts);
      const byInvoice = new Map(allInvoices.map(i => [i.id, i]));
      const months = new Map<string, { funded: number; fees: number; reserves: number; count: number }>();
      for (const payout of payoutRows) {
        if (payout.paymentStatus === "pending_advance" || !payout.advancePaidAt) continue;
        const invoice = byInvoice.get(payout.invoiceId), date = payout.advancePaidAt;
        const key = businessDate(date).slice(0, 7), row = months.get(key) || { funded: 0, fees: 0, reserves: 0, count: 0 };
        row.funded += Number(payout.advanceAmount); row.fees += Number(payout.feeAmount); row.reserves += Number(payout.reserveAmount); row.count++; months.set(key, row);
      }
      const rows = Array.from(months.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, r]) => ({ month, totalFunded: +r.funded.toFixed(2), fees: +r.fees.toFixed(2), reserves: +r.reserves.toFixed(2), count: r.count }));
      return { title: "Monthly Sales Journal", columns: [{ key: "month", label: "Month" }, { key: "totalFunded", label: "Funded", type: "money" }, { key: "fees", label: "Fees", type: "money" }, { key: "reserves", label: "Reserves", type: "money" }, { key: "count", label: "Count", type: "number" }], rows, summary: { count: rows.reduce((s, r) => s + Number(r.count), 0), totalAmount: +rows.reduce((s, r) => s + Number(r.totalFunded), 0).toFixed(2) } };
    }
    const clientRows = await db.select().from(clients);
    const carrierRow = (client: typeof clientRows[number], basic: boolean): Record<string, string | number | null> => basic
      ? { name: client.name, mcNumber: client.mcNumber, email: client.email, phone: client.phone }
      : {
          name: client.name, mcNumber: client.mcNumber, contactPerson: client.contactPerson,
          email: client.email, phone: client.phone, address: client.address,
          ratePercent: Number(client.ratePercent || 0), advanceRate: Number(client.advanceRate || 0),
          factoringFeeRate: Number(client.factoringFeeRate || 0), language: client.language,
          reviewed: reportDate(client.reviewed), nextReview: reportDate(client.nextReview),
          reserves: Number(client.reserves || 0), shorts: Number(client.shorts || 0),
          status: client.status, createdAt: reportDate(client.createdAt),
        };
    if (reportId.startsWith("brokers-")) {
      const directory = await db.select().from(brokers);
      let rows = directory;
      if (reportId === "brokers-active" || reportId === "brokers-active-dump" || reportId === "brokers-active-otr") rows = rows.filter(b => b.status === "active");
      if (reportId === "brokers-inactive") rows = rows.filter(b => b.status === "inactive");
      if (reportId === "brokers-active-otr") {
        const otrDebtorNames = new Set(allInvoices.filter(i => i.loadType === "otr_load").map(i => normalized(i.broker)).filter(Boolean));
        const otrDebtorMcNumbers = new Set(allInvoices.filter(i => i.loadType === "otr_load").map(i => normalized(i.debtorMcNumber)).filter(Boolean));
        rows = rows.filter(b => {
          const name = normalized(b.name), mcNumber = normalized(b.mcNumber);
          return (!!name && otrDebtorNames.has(name)) || (!!mcNumber && otrDebtorMcNumbers.has(mcNumber));
        });
      }
      const safe = rows.map(b => ({
        name: b.name, mcNumber: b.mcNumber, contactPerson: b.contactPerson, email: b.email,
        phone: b.phone, status: b.status, address: b.address, city: b.city, state: b.state,
        zipCode: b.zipCode, dotNumber: b.dotNumber, creditLimit: Number(b.creditLimit || 0),
        paymentTerms: b.paymentTerms, createdAt: reportDate(b.createdAt),
      }));
      return { title, columns: globalColumns.broker, rows: safe, summary: { count: safe.length, totalAmount: 0 } };
    }
    const basic = reportId.endsWith("basic") || reportId.endsWith("basic");
    let selected = clientRows;
    if (reportId.includes("active")) selected = selected.filter(c => c.status === "active");
    if (reportId.includes("-otr-")) {
      const otrClients = new Set(allInvoices.filter(i => i.loadType === "otr_load").map(i => i.clientId));
      selected = selected.filter(c => otrClients.has(c.id));
    }
    if (reportId === "carriers-top-20") {
      const totals = new Map<number, { count: number; amount: number }>();
      allInvoices.filter(i => !!i.fundedAt).forEach(i => { const x = totals.get(i.clientId) || { count: 0, amount: 0 }; x.count++; x.amount += Number(i.amount); totals.set(i.clientId, x); });
      const rows = clientRows.filter(c => c.status === "active" && totals.has(c.id)).map(c => ({ ...carrierRow(c, false), invoiceCount: totals.get(c.id)!.count, invoiceVolume: +totals.get(c.id)!.amount.toFixed(2) })).sort((a, b) => Number(b.invoiceVolume) - Number(a.invoiceVolume)).slice(0, 20);
      return { title: "Top 20 Carriers", columns: [...globalColumns.carrierFull, { key: "invoiceCount", label: "Invoices", type: "number" }, { key: "invoiceVolume", label: "Invoice Volume", type: "money" }], rows, summary: { count: rows.length, totalAmount: +rows.reduce((s, r) => s + Number(r.invoiceVolume), 0).toFixed(2) } };
    }
    if (reportId === "carriers-noa") {
      const docs = await db.select({
        clientId: documentsTable.clientId, invoiceId: documentsTable.invoiceId,
        documentType: documentsTable.documentType, finalDocumentType: documentsTable.finalDocumentType,
        aiDocumentType: documentsTable.aiDocumentType, documentCategory: documentsTable.documentCategory,
        filename: documentsTable.filename, originalName: documentsTable.originalName,
        storageKey: documentsTable.storageKey, s3Key: documentsTable.s3Key,
      }).from(documentsTable);
      const invoiceClients = new Map(allInvoices.map(invoice => [invoice.id, invoice.clientId]));
      const counts = new Map<number, number>();
      docs.forEach(d => {
        const metadata = [d.documentType, d.finalDocumentType, d.aiDocumentType, d.documentCategory, d.filename, d.originalName, d.storageKey, d.s3Key].filter(Boolean).join(" ");
        const clientId = d.clientId || (d.invoiceId ? invoiceClients.get(d.invoiceId) : undefined);
        if (/(?:^|[^a-z0-9])noa(?:[^a-z0-9]|$)|notice[\s_-]*of[\s_-]*assignment/i.test(metadata) && clientId) counts.set(clientId, (counts.get(clientId) || 0) + 1);
      });
      const rows = clientRows.filter(c => counts.has(c.id)).map(c => ({ ...carrierRow(c, false), documentCount: counts.get(c.id)! }));
      return { title: "Carrier NOA", columns: [...globalColumns.carrierFull, { key: "documentCount", label: "NOA Documents", type: "number" }], rows, summary: { count: rows.length, totalAmount: 0 } };
    }
    const rows = selected.map(c => carrierRow(c, basic));
    return { title, columns: basic ? globalColumns.carrierBasic : globalColumns.carrierFull, rows, summary: { count: rows.length, totalAmount: 0 } };
  };
  const streamGlobalReportPdf = (res: any, report: GlobalReport, reportId: string) => {
    const margin = 28;
    const doc = new PDFDocument({ size: "LEGAL", layout: "landscape", margin, info: { Title: report.title } });
    const money = (value: unknown) => `$${Number(value || 0).toFixed(2)}`;
    const display = (value: unknown, type?: string) => value === null || value === undefined ? "—" : type === "money" ? money(value) : String(value).replace(/_/g, " ");
    const width = (doc.page.width - margin * 2) / Math.max(report.columns.length, 1);
    const drawRow = (values: string[], bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(report.columns.length > 12 ? 6 : 7).fillColor(bold ? "#333" : "#111");
      const rowY = doc.y;
      const rowHeight = Math.max(9, ...values.map(value => doc.heightOfString(value, { width: width - 4 }))) + 4;
      if (!bold && rowY + rowHeight > doc.page.height - margin) {
        doc.addPage();
        header();
        return drawRow(values);
      }
      values.forEach((value, index) => {
        doc.text(value, margin + index * width, rowY, { width: width - 4, height: rowHeight - 2, ellipsis: true });
      });
      doc.y = rowY + rowHeight;
    };
    const header = () => {
      drawRow(report.columns.map(column => column.label.toUpperCase()), true);
      doc.moveTo(margin, doc.y).lineTo(doc.page.width - margin, doc.y).strokeColor("#999").stroke();
      doc.y += 4;
    };
    res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `attachment; filename="${reportId}.pdf"`); res.setHeader("Cache-Control", "no-store"); doc.pipe(res);
    doc.font("Helvetica-Bold").fontSize(17).fillColor("#111").text(report.title);
    doc.font("Helvetica").fontSize(9).fillColor("#555").text(`Generated ${new Date().toLocaleDateString()}  •  Count: ${report.summary.count}  •  Total: ${money(report.summary.totalAmount)}`);
    doc.moveDown(); header();
    for (const row of report.rows) drawRow(report.columns.map(column => display(row[column.key], column.type)));
    doc.end();
  };
  app.get("/api/reports/global/:reportId/pdf", requireReportsPermission, async (req, res) => {
    try { streamGlobalReportPdf(res, await buildGlobalReport(req.params.reportId), req.params.reportId); }
    catch (error: any) { res.status(error.status || 400).json({ message: error.message || "Failed to generate report PDF" }); }
  });
  app.get("/api/reports/global/:reportId", requireReportsPermission, async (req, res) => {
    try { res.json(await buildGlobalReport(req.params.reportId)); }
    catch (error: any) { res.status(error.status || 400).json({ message: error.message || "Failed to generate report" }); }
  });

  // Detailed operational productivity report. Agent visibility is deliberately
  // enforced here rather than trusting a userId supplied by the browser.
  app.get("/api/reports/agent-performance", requireAuth, async (req: any, res) => {
    try {
      const range = reportDateRange(req.query);
      const requestedUserId = typeof req.query.userId === "string" ? req.query.userId : undefined;
      const actor = req.user;
      const activeUsers = await db.select().from(users).where(eq(users.status, "active"));
      let visibleUsers = activeUsers;
      if (actor.role === "employee") {
        visibleUsers = activeUsers.filter((user) => user.id === actor.id);
      } else if (actor.role === "manager") {
        visibleUsers = activeUsers.filter((user) => user.id === actor.id || user.createdBy === actor.id);
      }
      if (requestedUserId) {
        visibleUsers = visibleUsers.filter((user) => user.id === requestedUserId);
        if (!visibleUsers.length) return res.status(403).json({ message: "You do not have access to this employee" });
      }

      const visibleIds = new Set(visibleUsers.map((user) => user.id));
      const invoiceRows = await db.select({
        id: invoices.id, invoiceNumber: invoices.invoiceNumber, amount: invoices.amount,
        status: invoices.status, factoringStage: invoices.factoringStage, createdAt: invoices.createdAt,
        fundedAt: invoices.fundedAt, assignedTo: invoices.assignedTo, submittedBy: invoices.submittedBy,
        clientId: invoices.clientId, clientName: clients.name, brokerId: invoices.brokerId,
        debtorId: invoices.debtorId, brokerName: sql<string | null>`coalesce(${brokers.name}, ${debtors.name})`,
      }).from(invoices).leftJoin(clients, eq(invoices.clientId, clients.id))
        .leftJoin(brokers, eq(invoices.brokerId, brokers.id))
        .leftJoin(debtors, eq(invoices.debtorId, debtors.id));
      const relevantInvoices = invoiceRows.filter((invoice) => {
        const ownerId = invoice.assignedTo ?? invoice.submittedBy;
        return !!ownerId && visibleIds.has(ownerId) && inReportRange(invoice.createdAt, range);
      });
      const invoiceIds = new Set(relevantInvoices.map((invoice) => invoice.id));

      const reviewRows = invoiceIds.size ? await db.select({
        invoiceId: documentsTable.invoiceId, type: documentsTable.documentType,
        reviewedBy: docReviews.reviewedByUserId, reviewStatus: docReviews.reviewStatus,
      }).from(docReviews).innerJoin(documentsTable, eq(docReviews.documentId, documentsTable.id)) : [];
      const entryRows = await db.select().from(timeEntries);
      const performance = visibleUsers.map((user) => {
        const agentInvoices = relevantInvoices.filter((invoice) => (invoice.assignedTo ?? invoice.submittedBy) === user.id);
        const stageBreakdown: Record<string, number> = {};
        let fundedVolume = 0;
        const fundedDays: number[] = [];
        for (const invoice of agentInvoices) {
          stageBreakdown[invoice.factoringStage] = (stageBreakdown[invoice.factoringStage] || 0) + 1;
          if (["funded", "paid", "settled"].includes(invoice.status)) {
            fundedVolume += Number(invoice.amount);
            if (invoice.createdAt && invoice.fundedAt) fundedDays.push(Math.max(0, (invoice.fundedAt.getTime() - invoice.createdAt.getTime()) / 86400000));
          }
        }
        const completedReviews = reviewRows.filter((review) => review.reviewStatus === "confirmed" && review.reviewedBy === user.id);
        const hoursWorked = entryRows.filter((entry) => entry.userId === user.id && inReportRange(entry.clockInTime, range))
          .reduce((sum, entry) => sum + Number(entry.totalHours || 0), 0);
        return {
          userId: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role,
          invoicesProcessed: agentInvoices.length, fundedVolume: +fundedVolume.toFixed(2),
          totalVolumeFunded: +fundedVolume.toFixed(2),
          avgDaysToFund: fundedDays.length ? +(fundedDays.reduce((sum, days) => sum + days, 0) / fundedDays.length).toFixed(2) : null,
          averageDaysToFund: fundedDays.length ? +(fundedDays.reduce((sum, days) => sum + days, 0) / fundedDays.length).toFixed(2) : null,
          stageBreakdown,
          invoicesByStage: stageBreakdown,
          carrierReviewsCompleted: completedReviews.filter((review) => review.type === "carrier_setup").length,
          brokerReviewsCompleted: completedReviews.filter((review) => review.type === "rate_confirmation").length,
          hoursWorked: +hoursWorked.toFixed(2),
          clockHoursWorked: +hoursWorked.toFixed(2),
          invoices: agentInvoices.map((invoice) => ({
            id: invoice.id, invoiceNumber: invoice.invoiceNumber, amount: invoice.amount, status: invoice.status,
            factoringStage: invoice.factoringStage, createdAt: invoice.createdAt, fundedAt: invoice.fundedAt,
            carrierId: invoice.clientId, carrierName: invoice.clientName,
            brokerId: invoice.brokerId ?? invoice.debtorId, brokerName: invoice.brokerName,
          })),
        };
      });
      res.json(requestedUserId ? performance[0] : performance);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to generate agent performance report" });
    }
  });

  const warningScope = async (actor: any) => {
    if (actor.role === "admin") return undefined as Set<string> | undefined;
    if (actor.role === "employee") return new Set([actor.id]);
    const team = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.status, "active"), eq(users.createdBy, actor.id)));
    return new Set([actor.id, ...team.map((user) => user.id)]);
  };

  app.get("/api/warnings", requireAuth, async (req: any, res) => {
    try {
      const scope = await warningScope(req.user);
      const requestedUserId = typeof req.query.userId === "string" ? req.query.userId : undefined;
      if (requestedUserId && scope && !scope.has(requestedUserId)) return res.status(403).json({ message: "You do not have access to these warnings" });
      const rows = await db.select({
        id: writtenWarnings.id, userId: writtenWarnings.userId, issuedBy: writtenWarnings.issuedBy,
        reason: writtenWarnings.reason, severity: writtenWarnings.severity, createdAt: writtenWarnings.createdAt,
        acknowledgedAt: writtenWarnings.acknowledgedAt, firstName: users.firstName, lastName: users.lastName, email: users.email,
      }).from(writtenWarnings).leftJoin(users, eq(writtenWarnings.userId, users.id)).orderBy(desc(writtenWarnings.createdAt));
      res.json(rows.filter((warning) => (!scope || scope.has(warning.userId)) && (!requestedUserId || warning.userId === requestedUserId))
        .map(warning => ({ ...warning, agentName: `${warning.firstName ?? ""} ${warning.lastName ?? ""}`.trim() || warning.email || warning.userId })));
    } catch { res.status(500).json({ message: "Failed to fetch warnings" }); }
  });

  app.post("/api/warnings", requireAuth, async (req: any, res) => {
    try {
      if (!["manager", "admin"].includes(req.user.role)) return res.status(403).json({ message: "Manager or Admin role required" });
      const body = z.object({ userId: z.string().min(1), reason: z.string().trim().min(1), severity: z.enum(["verbal", "written", "final"]) }).parse(req.body);
      const scope = await warningScope(req.user);
      if (scope && !scope.has(body.userId)) return res.status(403).json({ message: "You may only issue warnings to your active team" });
      const [target] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, body.userId), eq(users.status, "active")));
      if (!target) return res.status(404).json({ message: "Active employee not found" });
      const [warning] = await db.insert(writtenWarnings).values({ ...body, issuedBy: req.user.id }).returning();
      await db.insert(eventLedger).values({ entityType: "user", entityId: 0, eventType: "written_warning_issued", actorType: "user", actorId: req.user.id, payloadJson: { warningId: warning.id, userId: body.userId, severity: body.severity } });
      res.status(201).json(warning);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message || "Invalid warning" });
      res.status(500).json({ message: "Failed to issue warning" });
    }
  });

  app.patch("/api/warnings/:id/acknowledge", requireAuth, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid warning id" });
      const [warning] = await db.select().from(writtenWarnings).where(eq(writtenWarnings.id, id));
      if (!warning) return res.status(404).json({ message: "Warning not found" });
      if (warning.userId !== req.user.id) return res.status(403).json({ message: "Only the receiving employee may acknowledge this warning" });
      const [updated] = await db.update(writtenWarnings).set({ acknowledgedAt: warning.acknowledgedAt || new Date() }).where(eq(writtenWarnings.id, id)).returning();
      await db.insert(eventLedger).values({ entityType: "user", entityId: 0, eventType: "written_warning_acknowledged", actorType: "user", actorId: req.user.id, payloadJson: { warningId: id } });
      res.json(updated);
    } catch { res.status(500).json({ message: "Failed to acknowledge warning" }); }
  });

  type ArRow = {
    id: number; invoiceNumber: string; amount: number; appliedAmount: number; outstanding: number;
    status: string; invoiceDate: Date | null; dueDate: Date | null; createdAt: Date | null;
    carrierId: number; carrierName: string; brokerId: number | null; brokerName: string;
    reserveHeld: number; chargebackExposure: number;
  };
  const buildArReport = async (kind: "carrier" | "broker", query: Record<string, unknown>) => {
    const range = reportDateRange(query);
    const filterId = kind === "carrier" ? query.carrierId : query.brokerId;
    if (filterId !== undefined && (!/^\d+$/.test(String(filterId)) || Number(filterId) < 1)) throw new Error(`Invalid ${kind}Id`);
    const allInvoices = await db.select({
      id: invoices.id, invoiceNumber: invoices.invoiceNumber, amount: invoices.amount, status: invoices.status,
      invoiceDate: invoices.invoiceDate, dueDate: invoices.dueDate, createdAt: invoices.createdAt,
      chargebackStatus: invoices.chargebackStatus, clientId: invoices.clientId, clientName: clients.name,
      brokerId: invoices.brokerId, debtorId: invoices.debtorId,
      brokerName: sql<string | null>`coalesce(${brokers.name}, ${debtors.name})`,
    }).from(invoices)
      .leftJoin(clients, eq(invoices.clientId, clients.id))
      .leftJoin(brokers, eq(invoices.brokerId, brokers.id))
      .leftJoin(debtors, eq(invoices.debtorId, debtors.id));
    const applications = await db.select({ invoiceId: paymentApplicationLines.invoiceId, appliedAmount: paymentApplicationLines.appliedAmount }).from(paymentApplicationLines);
    const payoutsForInvoices = await db.select({
      invoiceId: payouts.invoiceId, reserveAmount: payouts.reserveAmount, reserveReleasedAt: payouts.reserveReleasedAt, paymentStatus: payouts.paymentStatus,
    }).from(payouts);
    const appliedByInvoice = new Map<number, number>();
    applications.forEach((line) => appliedByInvoice.set(line.invoiceId, (appliedByInvoice.get(line.invoiceId) || 0) + Number(line.appliedAmount)));
    const payoutByInvoice = new Map(payoutsForInvoices.map((payout) => [payout.invoiceId, payout]));
    const rows: ArRow[] = allInvoices.filter((invoice) => {
      const entityId = kind === "carrier" ? invoice.clientId : (invoice.brokerId ?? invoice.debtorId);
      return inReportRange(invoice.createdAt, range) && (!filterId || entityId === Number(filterId));
    }).map((invoice) => {
      const appliedAmount = appliedByInvoice.get(invoice.id) || 0;
      const payout = payoutByInvoice.get(invoice.id);
      const reserveHeld = payout && !payout.reserveReleasedAt && !["reserve_released", "complete"].includes(payout.paymentStatus) ? Number(payout.reserveAmount) : 0;
      return {
        id: invoice.id, invoiceNumber: invoice.invoiceNumber, amount: Number(invoice.amount), appliedAmount,
        outstanding: Math.max(0, Number(invoice.amount) - appliedAmount), status: invoice.status,
        invoiceDate: invoice.invoiceDate, dueDate: invoice.dueDate, createdAt: invoice.createdAt,
        carrierId: invoice.clientId, carrierName: invoice.clientName || `Carrier #${invoice.clientId}`,
        brokerId: invoice.brokerId ?? invoice.debtorId,
        brokerName: invoice.brokerName || ((invoice.brokerId ?? invoice.debtorId) ? `Broker #${invoice.brokerId ?? invoice.debtorId}` : "Unassigned"),
        reserveHeld, chargebackExposure: ["scheduled", "extended", "charged"].includes(invoice.chargebackStatus) ? Math.max(0, Number(invoice.amount) - appliedAmount) : 0,
      };
    });
    const grouped = new Map<string, any>();
    const now = Date.now();
    for (const row of rows) {
      const id = kind === "carrier" ? row.carrierId : row.brokerId;
      const name = kind === "carrier" ? row.carrierName : row.brokerName;
      const key = String(id ?? "unassigned");
      if (!grouped.has(key)) grouped.set(key, {
        [`${kind}Id`]: id, [`${kind}Name`]: name, totalInvoices: 0, totalFundedAmount: 0, totalOutstanding: 0,
        reserveHeld: 0, totalCollected: 0, chargebackExposure: 0, aging: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 }, invoices: [],
      });
      const group = grouped.get(key);
      group.totalInvoices++;
      if (["funded", "paid", "settled"].includes(row.status)) group.totalFundedAmount += row.amount;
      group.totalOutstanding += row.outstanding;
      group.reserveHeld += row.reserveHeld;
      group.totalCollected += row.appliedAmount;
      group.chargebackExposure += row.chargebackExposure;
      if (row.outstanding) {
        const basis = row.dueDate || row.invoiceDate || row.createdAt || new Date();
        const days = Math.max(0, Math.floor((now - basis.getTime()) / 86400000));
        group.aging[days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+"] += row.outstanding;
      }
      group.invoices.push(row);
    }
    const results = Array.from(grouped.values()).map((group) => ({
      ...group,
      totalFundedAmount: +group.totalFundedAmount.toFixed(2), totalOutstanding: +group.totalOutstanding.toFixed(2),
      reserveHeld: +group.reserveHeld.toFixed(2), totalCollected: +group.totalCollected.toFixed(2),
      chargebackExposure: +group.chargebackExposure.toFixed(2),
    })).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
    return {
      totals: results.reduce((total, row) => ({
        totalOutstanding: total.totalOutstanding + row.totalOutstanding, reserveHeld: total.reserveHeld + row.reserveHeld,
        totalCollected: total.totalCollected + row.totalCollected, chargebackExposure: total.chargebackExposure + row.chargebackExposure,
      }), { totalOutstanding: 0, reserveHeld: 0, totalCollected: 0, chargebackExposure: 0 }),
      results,
    };
  };

  app.get("/api/reports/carrier-ar", requireAuth, async (req, res) => {
    try { res.json(await buildArReport("carrier", req.query)); }
    catch (error: any) { res.status(400).json({ message: error.message || "Failed to generate carrier AR report" }); }
  });
  app.get("/api/reports/broker-ar", requireAuth, async (req, res) => {
    try { res.json(await buildArReport("broker", req.query)); }
    catch (error: any) { res.status(400).json({ message: error.message || "Failed to generate broker AR report" }); }
  });

  // Carrier/broker reports always scope by both sides of the receivable. This
  // prevents a carrier-only (or broker-only) query from inadvertently exposing
  // unrelated invoice activity.
  type CarrierBrokerReportRow = {
    id: number; invoiceNumber: string; loadNumber: string | null; brokerId: number | null; amount: number;
    fundedDate: Date | null; ageDays: number; status: string; chargebackStatus: string;
    appliedAmount: number; collected: number; outstanding: number; shortPayAmount: number;
    accountStatus: "pending" | "overdue" | "charged_back" | "payment_plan";
  };
  const carrierBrokerReportQuery = (query: Record<string, unknown>, options: {
    aging?: boolean; invoices?: boolean; shortPay?: boolean;
  } = {}) => {
    const parsePositiveInteger = (value: unknown, label: string) => {
      if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be a positive integer`);
      return Number(value);
    };
    const carrierId = parsePositiveInteger(query.carrierId, "carrierId");
    const brokerId = parsePositiveInteger(query.brokerId, "brokerId");
    let minDays = 0;
    if (options.aging && query.minDays !== undefined) {
      if (typeof query.minDays !== "string" || !/^\d+$/.test(query.minDays)) throw new Error("minDays must be a non-negative integer");
      minDays = Number(query.minDays);
    }
    let includeChargebacks = false;
    if (options.aging && query.includeChargebacks !== undefined) {
      if (query.includeChargebacks !== "true" && query.includeChargebacks !== "false") throw new Error("includeChargebacks must be true or false");
      includeChargebacks = query.includeChargebacks === "true";
    }
    let year: number | undefined;
    let type: "all" | "otr" = "all";
    if (options.invoices) {
      if (query.year !== undefined) {
        if (typeof query.year !== "string" || !/^\d{4}$/.test(query.year)) throw new Error("year must be a four-digit year");
        year = Number(query.year);
      }
      if (query.type !== undefined) {
        if (query.type !== "all" && query.type !== "otr") throw new Error("type must be all or otr");
        type = query.type;
      }
    }
    return { carrierId, brokerId, minDays, includeChargebacks, year, type };
  };
  const buildCarrierBrokerReport = async (
    query: Record<string, unknown>,
    options: { aging?: boolean; invoices?: boolean; shortPay?: boolean } = {},
  ) => {
    const filters = carrierBrokerReportQuery(query, options);
    const invoiceRows = await db.select({
      id: invoices.id, invoiceNumber: invoices.invoiceNumber, loadNumber: invoices.loadNumber,
      brokerId: invoices.brokerId, debtorId: invoices.debtorId,
      amount: invoices.amount, fundedDate: invoices.fundedAt, status: invoices.status,
      chargebackStatus: invoices.chargebackStatus, invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate, createdAt: invoices.createdAt, loadType: invoices.loadType,
      notes: invoices.notes,
    }).from(invoices).where(and(
      eq(invoices.clientId, filters.carrierId),
      or(eq(invoices.brokerId, filters.brokerId), and(isNull(invoices.brokerId), eq(invoices.debtorId, filters.brokerId))),
    ));
    const invoiceIds = invoiceRows.map((invoice) => invoice.id);
    const applicationRows = invoiceIds.length
      ? await db.select({
          invoiceId: paymentApplicationLines.invoiceId,
          appliedAmount: paymentApplicationLines.appliedAmount,
          varianceType: paymentApplicationLines.varianceType,
        }).from(paymentApplicationLines).where(inArray(paymentApplicationLines.invoiceId, invoiceIds))
      : [];
    const appliedByInvoice = new Map<number, number>();
    applicationRows.forEach((line) =>
      appliedByInvoice.set(line.invoiceId, (appliedByInvoice.get(line.invoiceId) || 0) + Number(line.appliedAmount)),
    );
    const shortPayInvoiceIds = new Set(
      applicationRows.filter((line) => line.varianceType === "short_pay").map((line) => line.invoiceId),
    );
    const now = Date.now();
    const rows: CarrierBrokerReportRow[] = invoiceRows
      .filter((invoice) => {
        const appliedAmount = appliedByInvoice.get(invoice.id) || 0;
        const outstanding = Math.max(0, Number(invoice.amount) - appliedAmount);
        const ageDays = invoice.fundedDate ? Math.max(0, Math.floor((now - invoice.fundedDate.getTime()) / 86400000)) : 0;
        if (options.aging && (!invoice.fundedDate || outstanding <= 0 || (!filters.includeChargebacks && ["scheduled", "extended", "charged"].includes(invoice.chargebackStatus)) || ageDays < filters.minDays)) return false;
        if (options.invoices && ((filters.year !== undefined && (invoice.invoiceDate ?? invoice.createdAt)?.getFullYear() !== filters.year) || (filters.type === "otr" && invoice.loadType !== "otr_load"))) return false;
        if (options.shortPay && (!shortPayInvoiceIds.has(invoice.id) || outstanding <= 0)) return false;
        return true;
      })
      .map((invoice) => {
        const appliedAmount = appliedByInvoice.get(invoice.id) || 0;
        const outstanding = Math.max(0, Number(invoice.amount) - appliedAmount);
        const chargedBack = ["scheduled", "extended", "charged"].includes(invoice.chargebackStatus);
        const paymentPlan = /\bpayment\s*plan\b/i.test(invoice.notes || "");
        const overdue = !!invoice.dueDate && invoice.dueDate.getTime() < now;
        const accountStatus: CarrierBrokerReportRow["accountStatus"] =
          paymentPlan ? "payment_plan" : chargedBack ? "charged_back" : overdue ? "overdue" : "pending";
        return {
           id: invoice.id, invoiceNumber: invoice.invoiceNumber, loadNumber: invoice.loadNumber,
           brokerId: invoice.brokerId ?? invoice.debtorId,
          amount: Number(invoice.amount), fundedDate: invoice.fundedDate,
          ageDays: invoice.fundedDate ? Math.max(0, Math.floor((now - invoice.fundedDate.getTime()) / 86400000)) : 0,
          status: invoice.status, chargebackStatus: invoice.chargebackStatus,
          appliedAmount: +appliedAmount.toFixed(2), collected: +appliedAmount.toFixed(2),
          outstanding: +outstanding.toFixed(2), shortPayAmount: options.shortPay ? +outstanding.toFixed(2) : 0,
          accountStatus,
        };
      })
      .sort((a, b) => b.ageDays - a.ageDays || a.invoiceNumber.localeCompare(b.invoiceNumber));
    const summary = rows.reduce((total, row) => ({
      count: total.count + 1,
      totalAmount: total.totalAmount + row.amount,
      totalOutstanding: total.totalOutstanding + row.outstanding,
      totalShortPay: total.totalShortPay + row.shortPayAmount,
    }), { count: 0, totalAmount: 0, totalOutstanding: 0, totalShortPay: 0 });
    return {
      rows,
      summary: {
        count: summary.count,
        totalAmount: +summary.totalAmount.toFixed(2),
        totalOutstanding: +summary.totalOutstanding.toFixed(2),
        totalShortPay: +summary.totalShortPay.toFixed(2),
      },
    };
  };

  app.get("/api/reports/carrier-broker-aging", requireAuth, async (req, res) => {
    try { res.json(await buildCarrierBrokerReport(req.query, { aging: true })); }
    catch (error: any) { res.status(400).json({ message: error.message || "Failed to generate carrier/broker aging report" }); }
  });
  app.get("/api/reports/carrier-broker-invoices", requireAuth, async (req, res) => {
    try { res.json(await buildCarrierBrokerReport(req.query, { invoices: true })); }
    catch (error: any) { res.status(400).json({ message: error.message || "Failed to generate carrier/broker invoice report" }); }
  });
  app.get("/api/reports/short-pay", requireAuth, async (req, res) => {
    try { res.json(await buildCarrierBrokerReport(req.query, { shortPay: true })); }
    catch (error: any) { res.status(400).json({ message: error.message || "Failed to generate short-pay report" }); }
  });
  app.get("/api/reports/carrier-broker-pdf", requireAuth, async (req, res) => {
    try {
      const reportType = String(req.query.reportType || "aging");
      if (!["aging", "invoices", "short-pay"].includes(reportType)) throw new Error("Invalid reportType");
      const options = reportType === "aging" ? { aging: true }
        : reportType === "invoices" ? { invoices: true } : { shortPay: true };
      const report = await buildCarrierBrokerReport(req.query, options);
      const showAccountStatus = req.query.statusView === "true";
      const showShortPay = reportType === "short-pay";
      const title = typeof req.query.title === "string" && req.query.title.trim()
        ? req.query.title.trim().slice(0, 120) : "Carrier / Broker AR Report";
      const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 30, info: { Title: title } });
      const money = (value: number) => `$${value.toFixed(2)}`;
      const tableHeader = () => {
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#333");
        doc.text("INVOICE", 30, doc.y, { width: 90, continued: true })
          .text("LOAD", { width: 72, continued: true }).text("AMOUNT", { width: 72, continued: true })
          .text("FUNDED", { width: 82, continued: true }).text("AGE", { width: 42, continued: true })
          .text("STATUS", { width: 86, continued: true }).text("CHARGEBACK", { width: 82, continued: true })
          .text(showShortPay ? "SHORT PAY" : "OUTSTANDING", { width: 90 });
        doc.moveTo(30, doc.y + 3).lineTo(762, doc.y + 3).strokeColor("#999").stroke();
        doc.moveDown(0.5);
      };
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=carrier-broker-report.pdf");
      res.setHeader("Cache-Control", "no-store");
      doc.pipe(res);
      doc.font("Helvetica-Bold").fontSize(18).fillColor("#111").text(title);
      doc.font("Helvetica").fontSize(9).fillColor("#555").text(`Generated ${new Date().toLocaleDateString()}`);
      doc.moveDown(0.5).fillColor("#111").text(
        `Invoices: ${report.summary.count}    Total: ${money(report.summary.totalAmount)}    Outstanding: ${money(report.summary.totalOutstanding)}${showShortPay ? `    Short Pay: ${money(report.summary.totalShortPay)}` : ""}`,
      );
      doc.moveDown();
      tableHeader();
      for (const row of report.rows) {
        if (doc.y > 540) { doc.addPage(); tableHeader(); }
        doc.font("Helvetica").fontSize(8).fillColor("#111");
        doc.text(row.invoiceNumber, 30, doc.y, { width: 90, continued: true })
          .text(row.loadNumber || "—", { width: 72, continued: true }).text(money(row.amount), { width: 72, continued: true })
          .text(row.fundedDate ? row.fundedDate.toLocaleDateString() : "—", { width: 82, continued: true })
          .text(`${row.ageDays}d`, { width: 42, continued: true }).text((showAccountStatus ? row.accountStatus : row.status).replace(/_/g, " "), { width: 86, continued: true })
          .text(row.chargebackStatus.replace(/_/g, " "), { width: 82, continued: true })
          .text(money(showShortPay ? row.shortPayAmount : row.outstanding), { width: 90 });
        doc.moveDown(0.35);
      }
      doc.end();
    } catch (error: any) { res.status(400).json({ message: error.message || "Failed to generate carrier/broker PDF" }); }
  });
  app.get("/api/reports/carrier-ar/pdf", requireAuth, async (req, res) => {
    try {
      const report = await buildArReport("carrier", req.query);
      const doc = new PDFDocument({ size: "LETTER", margin: 36, info: { Title: "Carrier AR Report" } });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=carrier-ar-report.pdf");
      doc.pipe(res);
      doc.font("Helvetica-Bold").fontSize(18).text("Carrier Accounts Receivable Report");
      doc.font("Helvetica").fontSize(9).fillColor("#555").text(`Generated ${new Date().toLocaleDateString()}`);
      doc.moveDown().fillColor("#111").fontSize(10).text(`Outstanding: $${report.totals.totalOutstanding.toFixed(2)}    Reserve held: $${report.totals.reserveHeld.toFixed(2)}    Collected: $${report.totals.totalCollected.toFixed(2)}    Chargebacks: $${report.totals.chargebackExposure.toFixed(2)}`);
      doc.moveDown();
      for (const row of report.results) {
        if (doc.y > 700) doc.addPage();
        doc.font("Helvetica-Bold").fontSize(11).text(row.carrierName);
        doc.font("Helvetica").fontSize(9).text(`Invoices ${row.totalInvoices} | Funded $${row.totalFundedAmount.toFixed(2)} | Outstanding $${row.totalOutstanding.toFixed(2)} | Reserve $${row.reserveHeld.toFixed(2)} | Collected $${row.totalCollected.toFixed(2)}`);
        doc.text(`Aging: 0–30 $${row.aging["0-30"].toFixed(2)}  31–60 $${row.aging["31-60"].toFixed(2)}  61–90 $${row.aging["61-90"].toFixed(2)}  90+ $${row.aging["90+"].toFixed(2)}`);
        doc.moveDown(0.6);
      }
      doc.end();
    } catch (error: any) { res.status(400).json({ message: error.message || "Failed to generate carrier AR PDF" }); }
  });

  // Printable carrier statement used by the Aging Report download action.  This
  // intentionally derives its balance from cash application lines rather than
  // invoice status, since a funded invoice may be only partially collected.
  app.get("/api/reports/aging-pdf", requireAuth, async (req, res) => {
    try {
      const parsePositiveInteger = (value: unknown, label: string) => {
        if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
          throw new Error(`${label} must be a positive integer`);
        }
        return Number(value);
      };
      const carrierId = parsePositiveInteger(req.query.carrierId, "carrierId");
      const minDays = req.query.minDays === undefined ? 1 : Number(req.query.minDays);
      if (!Number.isInteger(minDays) || ![1, 45, 60, 90, 100].includes(minDays)) {
        throw new Error("minDays must be one of 1, 45, 60, 90, or 100");
      }

      const [carrier] = await db.select().from(clients).where(eq(clients.id, carrierId));
      if (!carrier) return res.status(404).json({ message: "Carrier not found" });

      const invoiceRows = await db.select({
        id: invoices.id, invoiceNumber: invoices.invoiceNumber, amount: invoices.amount,
        invoiceDate: invoices.invoiceDate, dueDate: invoices.dueDate, fundedAt: invoices.fundedAt,
        loadNumber: invoices.loadNumber, bolNumber: invoices.bolNumber, loadId: invoices.loadId,
         debtorName: sql<string | null>`coalesce(${brokers.name}, ${debtors.name})`, loadLoadNumber: loads.loadNumber,
      }).from(invoices)
         .leftJoin(brokers, eq(invoices.brokerId, brokers.id))
        .leftJoin(debtors, eq(invoices.debtorId, debtors.id))
        .leftJoin(loads, eq(invoices.loadId, loads.id))
        .where(eq(invoices.clientId, carrierId));
      const invoiceIds = invoiceRows.map(invoice => invoice.id);
      const applicationRows = invoiceIds.length ? await db.select({
        invoiceId: paymentApplicationLines.invoiceId, appliedAmount: paymentApplicationLines.appliedAmount,
        variance: paymentApplicationLines.variance, varianceType: paymentApplicationLines.varianceType,
      }).from(paymentApplicationLines).where(inArray(paymentApplicationLines.invoiceId, invoiceIds)) : [];
      const collectedByInvoice = new Map<number, number>();
      for (const line of applicationRows) {
        const writeOff = line.varianceType === "write_off" ? Math.abs(Number(line.variance || 0)) : 0;
        collectedByInvoice.set(line.invoiceId, (collectedByInvoice.get(line.invoiceId) || 0) + Number(line.appliedAmount || 0) + writeOff);
      }
      const denverCalendarDay = (value: Date) => {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
        }).formatToParts(value);
        const part = (type: string) => Number(parts.find(item => item.type === type)?.value || 0);
        return Math.floor(Date.UTC(part("year"), part("month") - 1, part("day")) / 86400000);
      };
      const today = denverCalendarDay(new Date());
      const rows = invoiceRows.map(invoice => {
        const ageDays = invoice.fundedAt ? Math.max(0, today - denverCalendarDay(invoice.fundedAt)) : 0;
        return {
          ...invoice,
          ageDays,
          balance: Math.max(0, Number(invoice.amount) - (collectedByInvoice.get(invoice.id) || 0)),
          broker: invoice.debtorName || "Unassigned",
        };
      }).filter(invoice => !!invoice.fundedAt && invoice.ageDays >= minDays && invoice.balance > 0)
        .sort((a, b) => a.broker.localeCompare(b.broker) || b.ageDays - a.ageDays || a.invoiceNumber.localeCompare(b.invoiceNumber));

      const allLoads = await db.select({ id: loads.id, clientId: loads.clientId }).from(loads);
      const carrierLoadIds = new Set(allLoads.filter(load => load.clientId === carrierId).map(load => load.id));
      const normalizeName = (value: string | null | undefined) => (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const normalizedCarrierName = normalizeName(carrier.name);
      const allCarrierNames = await db.select({ name: clients.name }).from(clients);
      const carrierNameIsUnique = allCarrierNames.filter(item => normalizeName(item.name) === normalizedCarrierName).length === 1;
      const advances = await db.select().from(fuelAdvances);
      const fuelAdvance = advances.filter(advance => {
        if (!["approved", "paid"].includes(advance.status)) return false;
        // A load association is authoritative; only unassociated advances use
        // the carrier-name fallback to avoid matching another carrier's load.
        return advance.loadId
          ? carrierLoadIds.has(advance.loadId)
          : carrierNameIsUnique && normalizeName(advance.carrierName) === normalizedCarrierName;
      }).reduce((sum, advance) => sum + Number(advance.advanceAmount || 0), 0);

      const buckets = { "1-30": 0, "31-60": 0, "61-90": 0, "90-120": 0, "120+": 0 };
      rows.forEach(row => {
        const bucket = row.ageDays <= 30 ? "1-30" : row.ageDays <= 60 ? "31-60" : row.ageDays <= 90 ? "61-90" : row.ageDays <= 120 ? "90-120" : "120+";
        buckets[bucket] += row.balance;
      });
      const balance = rows.reduce((sum, row) => sum + row.balance, 0);
      const reserves = Number(carrier.reserves || 0);
      const shorts = Number(carrier.shorts || 0);
      const claims = 0, others = 0, totalAmountDue = balance + reserves - fuelAdvance - claims - shorts - others;
      const onboarding = (carrier.onboardingData && typeof carrier.onboardingData === "object" ? carrier.onboardingData : {}) as Record<string, unknown>;
      const field = (...names: string[]) => {
        for (const name of names) {
          const value = onboarding[name];
          if (typeof value === "string" && value.trim()) return value.trim();
        }
        return "";
      };
      const contact = carrier.contactPerson || field("contactPerson", "contactName", "primaryContact") || "—";
      const dot = field("dotNumber", "dot", "DOT") || "—";
      const streetAddress = carrier.address || field("physicalAddress", "mailingAddress", "businessAddress") || "—";
      const city = field("physicalCity", "mailingCity", "city", "businessCity");
      const state = field("physicalState", "mailingState", "state", "businessState");
      const zip = field("physicalZip", "mailingZip", "zip", "zipCode", "businessZip");
      const location = [city, state, zip].filter(Boolean).join(", ") || "—";
      const statementDate = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 28, info: { Title: `${carrier.name} Aging Statement`, Author: "Trucking Pros Financial" } });
      const left = 28, right = 764, bottom = 556;
      const money = (value: number) => {
        const normalized = Math.abs(value) < 0.005 ? 0 : value;
        return `$${normalized.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      };
      const date = (value: Date | null) => value ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "2-digit", day: "2-digit", year: "2-digit" }).format(value) : "—";
      const columns = [
        ["Broker Name", 136], ["Invoice#", 76], ["Invoice Date", 82], ["Date Factored", 88],
        ["Broker PO#/Ref", 128], ["Days Out", 58], ["Due Date", 80], ["Balance Due", 88],
      ] as const;
      const footer = () => {
        doc.strokeColor("#000").lineWidth(0.4).moveTo(left, bottom).lineTo(right, bottom).stroke();
        doc.font("Helvetica").fontSize(6.5).fillColor("#111").text(
          "Trucking Pros Financial LLC  |  (801) 755-9755  |  legalteam@truckingprosfinancial.com  |  www.truckingprosfinancial.com",
          left, bottom + 5, { width: right - left, align: "center" },
        );
      };
      const pageHeader = () => {
        let logoDrawn = false;
        const logoPaths = [
          path.resolve(process.cwd(), "client/public/images/ff-logo-emboss.png"),
          path.resolve(process.cwd(), "dist/public/images/ff-logo-emboss.png"),
        ];
        try {
          const logoPath = logoPaths.find(candidate => fs.existsSync(candidate));
          if (logoPath) { doc.image(logoPath, left, 23, { fit: [54, 54] }); logoDrawn = true; }
        } catch { /* Bold wordmark below is the deliberate rendering fallback. */ }
        if (!logoDrawn) doc.font("Helvetica-Bold").fontSize(17).fillColor("#111").text("TRUCKING PROS FINANCIAL", left, 39);
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#111").text("Trucking Pros Financial LLC", left, 78);
        doc.font("Helvetica").fontSize(7.5).text("204 E. 900 S. Salt Lake City, UT 84111", left, 88);
        doc.text("801-755-9755", left, 98);
        doc.font("Helvetica-Bold").fontSize(16).text("AGING STATEMENT", 500, 29, { width: 264, align: "right" });
        doc.font("Helvetica").fontSize(8).text(`Statement Date: ${statementDate}`, 500, 49, { width: 264, align: "right" });
        doc.text(`Account #: TPF-${String(carrier.id).padStart(6, "0")}`, 500, 61, { width: 264, align: "right" });
        doc.text(`Phone: ${carrier.phone || "—"}  |  Fax: —`, 500, 73, { width: 264, align: "right" });
        doc.strokeColor("#000").lineWidth(0.6).moveTo(left, 111).lineTo(right, 111).stroke();
        doc.font("Helvetica-Bold").fontSize(8).text(carrier.name, left, 117);
        doc.font("Helvetica").fontSize(7).text(`Contact: ${contact}`, left, 128);
        doc.text(`Address: ${streetAddress}`, left, 138, { width: 300, ellipsis: true });
        doc.text(`City / State / ZIP: ${location}`, 338, 128, { width: 210, ellipsis: true });
        doc.text(`MC#: ${carrier.mcNumber || "—"}   DOT#: ${dot}`, 338, 138, { width: 210, ellipsis: true });
      };
      const tableHeader = (y: number) => {
        doc.rect(left, y, right - left, 15).fill("#f1f1f1");
        doc.fillColor("#111").font("Helvetica-Bold").fontSize(6.7);
        let x = left;
        columns.forEach(([label, width]) => { doc.text(label, x + 2, y + 4, { width: width - 4, ellipsis: true }); x += width; });
        doc.strokeColor("#000").lineWidth(0.4).rect(left, y, right - left, 15).stroke();
      };
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="aging-statement-TPF-${String(carrier.id).padStart(6, "0")}-${minDays}days.pdf"`);
      res.setHeader("Cache-Control", "no-store");
      doc.pipe(res);
      pageHeader();
      let y = 157, currentBroker = "";
      tableHeader(y); y += 15;
      for (const row of rows) {
        if (y + 16 > 480) {
          footer(); doc.addPage(); pageHeader(); y = 157; tableHeader(y); y += 15; currentBroker = "";
        }
        const brokerLabel = row.broker !== currentBroker ? `^${row.broker}` : "";
        currentBroker = row.broker;
        const values = [brokerLabel, row.invoiceNumber, date(row.invoiceDate), date(row.fundedAt), row.loadLoadNumber || row.loadNumber || row.bolNumber || "—", String(row.ageDays), date(row.dueDate), money(row.balance)];
        doc.font("Helvetica").fontSize(6.7).fillColor("#111");
        let x = left;
        values.forEach((value, index) => {
          const width = columns[index][1];
          doc.text(value, x + 2, y + 4, { width: width - 4, height: 9, ellipsis: true, align: index === 7 ? "right" : "left" });
          x += width;
        });
        doc.strokeColor("#000").lineWidth(0.25).rect(left, y, right - left, 16).stroke();
        y += 16;
      }
      // Keep statement totals together at the bottom, starting a fresh page when
      // a long detail section would crowd the aging buckets.
      if (y > 385) { footer(); doc.addPage(); pageHeader(); y = 157; }
      const boxY = Math.max(y + 13, 390), boxWidth = (right - left) / 5;
      doc.font("Helvetica-Bold").fontSize(7).fillColor("#111").text("AGING SUMMARY", left, boxY - 12);
      Object.entries(buckets).forEach(([label, value], index) => {
        const x = left + index * boxWidth;
        doc.rect(x, boxY, boxWidth, 34).strokeColor("#000").lineWidth(0.4).stroke();
        doc.font("Helvetica-Bold").fontSize(6.5).text(label, x + 4, boxY + 5, { width: boxWidth - 8 });
        doc.font("Helvetica").fontSize(7.5).text(money(value), x + 4, boxY + 18, { width: boxWidth - 8, align: "right" });
      });
      const summaryY = boxY + 51, summaryX = 522;
      const summary = [["Carrier Reserves", reserves], ["Fuel Advance", -fuelAdvance], ["Claims", -claims], ["Shorts", -shorts], ["Others", -others], ["Balance", balance], ["Total Amount Due", totalAmountDue]];
      summary.forEach(([label, value], index) => {
        const total = index === summary.length - 1;
        if (total) doc.moveTo(summaryX, summaryY + index * 12 - 2).lineTo(right, summaryY + index * 12 - 2).strokeColor("#000").stroke();
        doc.font(total ? "Helvetica-Bold" : "Helvetica").fontSize(total ? 8 : 7).fillColor("#111").text(String(label), summaryX, summaryY + index * 12, { width: 135 });
        doc.text(money(Number(value)), summaryX + 135, summaryY + index * 12, { width: 107, align: "right" });
      });
      footer();
      doc.end();
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to generate aging statement" });
    }
  });

  // Aging Report
  app.get("/api/reports/aging", requireAuth, async (req: any, res) => {
    try {
      const allInvoices = await getConfirmationAgingRows(await getConfirmationInvoiceScope(req.user));
      const bucket = (inv: typeof allInvoices[0]) => {
        const days = inv.ageDays;
        if (days <= 30) return "0-30";
        if (days <= 60) return "31-60";
        if (days <= 90) return "61-90";
        return "90+";
      };

      const buckets: Record<string, { count: number; total: number; carriers: Record<string, number>; brokers: Record<string, number> }> = {
        "0-30": { count: 0, total: 0, carriers: {}, brokers: {} },
        "31-60": { count: 0, total: 0, carriers: {}, brokers: {} },
        "61-90": { count: 0, total: 0, carriers: {}, brokers: {} },
        "90+": { count: 0, total: 0, carriers: {}, brokers: {} },
      };

      for (const inv of allInvoices) {
        const b = bucket(inv);
        const amt = inv.outstanding;
        buckets[b].count++;
        buckets[b].total += amt;
        const carrier = inv.carrier ?? "Unknown carrier";
        const broker = inv.broker ?? "Unknown broker";
        buckets[b].carriers[carrier] = (buckets[b].carriers[carrier] ?? 0) + amt;
        buckets[b].brokers[broker] = (buckets[b].brokers[broker] ?? 0) + amt;
      }

      res.json(buckets);
    } catch (e) { res.status(500).json({ message: "Failed to generate aging report" }); }
  });

  // Agent Report
  app.get("/api/reports/agent", requireAuth, async (req: any, res) => {
    try {
      const { startDate, endDate } = req.query as Record<string, string>;
      let q = db
        .select({
          id: invoices.id,
          amount: invoices.amount,
          status: invoices.status,
          createdAt: invoices.createdAt,
          approvedAt: invoices.approvedAt,
          agentId: invoices.assignedTo,
          agentName: sql<string>`CONCAT(${users.firstName}, ' ', ${users.lastName})`,
        })
        .from(invoices)
        .leftJoin(users, eq(invoices.assignedTo, users.id))
        .$dynamic();

      const conds: any[] = [];
      if (startDate) conds.push(sql`${invoices.createdAt} >= ${new Date(startDate)}`);
      if (endDate)   conds.push(sql`${invoices.createdAt} <= ${new Date(endDate)}`);
      if (conds.length) q = q.where(and(...conds));

      const rows = await q;
      const agentMap: Record<string, { agentId: string | null; agentName: string; count: number; totalFunded: number; totalAmount: number; timesToFund: number[] }> = {};

      for (const row of rows) {
        const key = row.agentId ?? "unassigned";
        if (!agentMap[key]) agentMap[key] = { agentId: row.agentId, agentName: row.agentName ?? "Unassigned", count: 0, totalFunded: 0, totalAmount: 0, timesToFund: [] };
        const a = agentMap[key];
        a.count++;
        a.totalAmount += parseFloat(String(row.amount));
        if (row.status === "funded" || row.status === "paid" || row.status === "settled") {
          a.totalFunded += parseFloat(String(row.amount));
          if (row.approvedAt && row.createdAt) {
            const days = (new Date(row.approvedAt).getTime() - new Date(row.createdAt).getTime()) / 86400000;
            a.timesToFund.push(Math.max(0, days));
          }
        }
      }

      const result = Object.values(agentMap).map(a => ({
        ...a,
        avgDaysToFund: a.timesToFund.length ? +(a.timesToFund.reduce((s, v) => s + v, 0) / a.timesToFund.length).toFixed(2) : null,
        timesToFund: undefined,
      }));

      res.json(result);
    } catch (e) { res.status(500).json({ message: "Failed to generate agent report" }); }
  });

  // Broker Report
  app.get("/api/reports/broker", requireAuth, async (req: any, res) => {
    try {
      const { startDate, endDate } = req.query as Record<string, string>;
      const rows = await db
        .select({
          id: invoices.id,
          amount: invoices.amount,
          status: invoices.status,
          createdAt: invoices.createdAt,
          brokerId: invoices.brokerId,
          debtorId: invoices.debtorId,
          brokerName: sql<string | null>`coalesce(${brokers.name}, ${debtors.name})`,
          creditLimit: sql<number | null>`coalesce(${brokers.creditLimit}, ${debtors.creditLimit})`,
          debtorAvgDaysToPay: debtors.averageDaysToPay,
        })
        .from(invoices)
        .leftJoin(brokers, eq(invoices.brokerId, brokers.id))
        .leftJoin(debtors, eq(invoices.debtorId, debtors.id));

      const brokerMap: Record<string, { brokerId: number | null; debtorId: number | null; brokerName: string; invoiceCount: number; totalVolume: number; outstanding: number; paid: number; creditLimit: number | null; avgDaysToPay: number | null }> = {};

      for (const row of rows) {
        if (startDate && new Date(row.createdAt!) < new Date(startDate)) continue;
        if (endDate   && new Date(row.createdAt!) > new Date(endDate))   continue;
        const canonicalBrokerId = row.brokerId ?? row.debtorId;
        const key = String(canonicalBrokerId ?? 0);
        if (!brokerMap[key]) brokerMap[key] = { brokerId: row.brokerId, debtorId: row.debtorId, brokerName: row.brokerName ?? "Unknown", invoiceCount: 0, totalVolume: 0, outstanding: 0, paid: 0, creditLimit: row.creditLimit ? parseFloat(String(row.creditLimit)) : null, avgDaysToPay: row.brokerId ? null : row.debtorAvgDaysToPay };
        const b = brokerMap[key];
        const amt = parseFloat(String(row.amount));
        b.invoiceCount++;
        b.totalVolume += amt;
        if (["paid", "settled", "funded"].includes(row.status)) b.paid += amt;
        else b.outstanding += amt;
      }

      res.json(Object.values(brokerMap).sort((a, b) => b.totalVolume - a.totalVolume));
    } catch (e) { res.status(500).json({ message: "Failed to generate broker report" }); }
  });

  // Carrier Report
  app.get("/api/reports/carrier", requireAuth, async (req: any, res) => {
    try {
      const { startDate, endDate } = req.query as Record<string, string>;
      const rows = await db
        .select({
          id: invoices.id,
          amount: invoices.amount,
          status: invoices.status,
          createdAt: invoices.createdAt,
          clientId: invoices.clientId,
          carrierName: clients.name,
        })
        .from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .where(req.user.role === "employee" ? eq(clients.assignedProcessor, req.user.id) : undefined);

      const carrierMap: Record<string, { clientId: number; carrierName: string; invoiceCount: number; totalFunded: number; outstanding: number; amounts: number[] }> = {};

      for (const row of rows) {
        if (startDate && new Date(row.createdAt!) < new Date(startDate)) continue;
        if (endDate   && new Date(row.createdAt!) > new Date(endDate))   continue;
        const key = String(row.clientId);
        if (!carrierMap[key]) carrierMap[key] = { clientId: row.clientId, carrierName: row.carrierName ?? `Carrier #${row.clientId}`, invoiceCount: 0, totalFunded: 0, outstanding: 0, amounts: [] };
        const c = carrierMap[key];
        const amt = parseFloat(String(row.amount));
        c.invoiceCount++;
        c.amounts.push(amt);
        if (["funded", "paid", "settled"].includes(row.status)) c.totalFunded += amt;
        else c.outstanding += amt;
      }

      const result = Object.values(carrierMap).map(c => ({
        ...c,
        avgInvoiceSize: c.amounts.length ? +(c.amounts.reduce((s, v) => s + v, 0) / c.amounts.length).toFixed(2) : 0,
        amounts: undefined,
      })).sort((a, b) => b.totalFunded - a.totalFunded);

      res.json(result);
    } catch (e) { res.status(500).json({ message: "Failed to generate carrier report" }); }
  });

  // Daily AR
  app.get("/api/reports/daily-ar", requireAuth, async (_req, res) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

      const allInvoices = await db.select({ amount: invoices.amount, status: invoices.status, createdAt: invoices.createdAt }).from(invoices);
      const todayPayments = await db.select({ appliedAmount: paymentApplicationLines.appliedAmount, createdAt: cashApplications.createdAt })
        .from(paymentApplicationLines)
        .innerJoin(cashApplications, eq(paymentApplicationLines.cashApplicationId, cashApplications.id))
        .where(and(sql`${cashApplications.createdAt} >= ${today}`, sql`${cashApplications.createdAt} < ${tomorrow}`));

      const totalAR = allInvoices
        .filter(i => !["paid", "settled", "rejected"].includes(i.status))
        .reduce((s, i) => s + parseFloat(String(i.amount)), 0);

      const outstanding = allInvoices
        .filter(i => !["paid", "settled", "funded", "rejected"].includes(i.status))
        .reduce((s, i) => s + parseFloat(String(i.amount)), 0);

      const collectedToday = todayPayments.reduce((s, p) => s + parseFloat(String(p.appliedAmount)), 0);

      const newToday = allInvoices
        .filter(i => i.createdAt && new Date(i.createdAt) >= today && new Date(i.createdAt) < tomorrow)
        .reduce((s, i) => s + parseFloat(String(i.amount)), 0);

      res.json({ totalAR, outstanding, collectedToday, newToday, date: today.toISOString() });
    } catch (e) { res.status(500).json({ message: "Failed to generate daily AR" }); }
  });

  // Monthly Summary
  app.get("/api/reports/monthly", requireAuth, async (req: any, res) => {
    try {
      const year = parseInt(req.query.year ?? String(new Date().getFullYear()));

      const rows = await db
        .select({
          month: sql<number>`EXTRACT(MONTH FROM ${payouts.createdAt})`,
          invoiceCount: sql<number>`COUNT(*)`,
          totalVolume: sql<string>`SUM(${payouts.invoiceAmount})`,
          totalFees: sql<string>`SUM(${payouts.feeAmount})`,
          totalAdvanced: sql<string>`SUM(${payouts.advanceAmount})`,
        })
        .from(payouts)
        .where(sql`EXTRACT(YEAR FROM ${payouts.createdAt}) = ${year}`)
        .groupBy(sql`EXTRACT(MONTH FROM ${payouts.createdAt})`)
        .orderBy(sql`EXTRACT(MONTH FROM ${payouts.createdAt})`);

      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const result = months.map((label, idx) => {
        const row = rows.find(r => Number(r.month) === idx + 1);
        return {
          month: idx + 1,
          label,
          invoiceCount: row ? Number(row.invoiceCount) : 0,
          totalVolume: row ? parseFloat(String(row.totalVolume)) : 0,
          totalFees: row ? parseFloat(String(row.totalFees)) : 0,
          totalAdvanced: row ? parseFloat(String(row.totalAdvanced)) : 0,
        };
      });

      res.json({ year, months: result });
    } catch (e) { res.status(500).json({ message: "Failed to generate monthly summary" }); }
  });

  // ─── Dispatchers ──────────────────────────────────────────────────────────
  app.get("/api/dispatchers", requireAuth, async (req, res) => {
    try {
      const { carrierId, status } = req.query;
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const conditions: any[] = [];
      if (carrierId) conditions.push(eq(dispatchers.carrierId, parseInt(carrierId as string, 10)));
      if (status && status !== "all") conditions.push(eq(dispatchers.status, status as any));
      if (q) conditions.push(or(
        ilike(dispatchers.firstName, `%${q}%`), ilike(dispatchers.lastName, `%${q}%`),
        ilike(dispatchers.email, `%${q}%`), ilike(dispatchers.phone, `%${q}%`),
        ilike(dispatchers.notes, `%${q}%`),
      ));
      const carrierScope = await assignedCarrierScope(req, dispatchers.carrierId);
      if (carrierScope) conditions.push(carrierScope);
      const where = conditions.length ? and(...conditions) : undefined;
      if (req.query.all === "true") return res.json(await db.select().from(dispatchers).where(where).orderBy(dispatchers.lastName));
      const { page, limit, offset } = parseListPagination(req);
      const [{ total }] = await db.select({ total: count() }).from(dispatchers).where(where);
      const rows = await db.select().from(dispatchers).where(where).orderBy(dispatchers.lastName).limit(limit).offset(offset);
      res.json({ data: rows, total: Number(total), page, totalPages: Math.ceil(Number(total) / limit) });
    } catch (error) {
      console.error("Error fetching dispatchers:", error);
      res.status(500).json({ message: "Failed to fetch dispatchers" });
    }
  });

  app.get("/api/dispatchers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [row] = await db.select().from(dispatchers).where(eq(dispatchers.id, id)).limit(1);
      if (!row) return res.status(404).json({ message: "Dispatcher not found" });
      if (!(await canAccessClient(req, row.carrierId))) return res.status(403).json({ message: "You can only access dispatchers for carriers assigned to you" });
      res.json(row);
    } catch (error) {
      console.error("Error fetching dispatcher:", error);
      res.status(500).json({ message: "Failed to fetch dispatcher" });
    }
  });

  app.post("/api/dispatchers", requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const data = insertDispatcherSchema.parse({ ...req.body, createdBy: userId });
      if (!(await canAccessClient(req, data.carrierId))) return res.status(403).json({ message: "You can only create dispatchers for carriers assigned to you" });
      const [row] = await db.insert(dispatchers).values(data).returning();
      res.status(201).json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid data", errors: error.errors });
      console.error("Error creating dispatcher:", error);
      res.status(500).json({ message: "Failed to create dispatcher" });
    }
  });

  app.patch("/api/dispatchers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [existing] = await db.select({ carrierId: dispatchers.carrierId }).from(dispatchers).where(eq(dispatchers.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Dispatcher not found" });
      if (!(await canAccessClient(req, existing.carrierId))) return res.status(403).json({ message: "You can only edit dispatchers for carriers assigned to you" });
      const data = insertDispatcherSchema.partial().parse(req.body);
      if (data.carrierId != null && !(await canAccessClient(req, data.carrierId))) return res.status(403).json({ message: "You can only move dispatchers to carriers assigned to you" });
      const [row] = await db.update(dispatchers).set(data).where(eq(dispatchers.id, id)).returning();
      if (!row) return res.status(404).json({ message: "Dispatcher not found" });
      res.json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid data", errors: error.errors });
      console.error("Error updating dispatcher:", error);
      res.status(500).json({ message: "Failed to update dispatcher" });
    }
  });

  app.delete("/api/dispatchers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [existing] = await db.select({ carrierId: dispatchers.carrierId }).from(dispatchers).where(eq(dispatchers.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Dispatcher not found" });
      if (!(await canAccessClient(req, existing.carrierId))) return res.status(403).json({ message: "You can only delete dispatchers for carriers assigned to you" });
      const [row] = await db
        .update(dispatchers)
        .set({ status: "inactive" })
        .where(eq(dispatchers.id, id))
        .returning();
      if (!row) return res.status(404).json({ message: "Dispatcher not found" });
      res.json(row);
    } catch (error) {
      console.error("Error deactivating dispatcher:", error);
      res.status(500).json({ message: "Failed to deactivate dispatcher" });
    }
  });

  // ─── Release Letters ───────────────────────────────────────────────────────
  app.get("/api/release-letters", requireAuth, async (req, res) => {
    try {
      const { carrierId, status, brokerId, dateFrom, dateTo } = req.query;
      const conditions: any[] = [];
      if (carrierId) conditions.push(eq(releaseLetters.carrierId, parseInt(carrierId as string, 10)));
      if (brokerId) conditions.push(eq(releaseLetters.brokerId, parseInt(brokerId as string, 10)));
      if (status && status !== "all") conditions.push(eq(releaseLetters.status, status as any));
      if (dateFrom) conditions.push(sql`${releaseLetters.createdAt} >= ${new Date(dateFrom as string)}`);
      if (dateTo) conditions.push(sql`${releaseLetters.createdAt} <= ${new Date(dateTo as string)}`);
      const rows = conditions.length
        ? await db.select().from(releaseLetters).where(and(...conditions)).orderBy(desc(releaseLetters.createdAt))
        : await db.select().from(releaseLetters).orderBy(desc(releaseLetters.createdAt));
      res.json(rows);
    } catch (error) {
      console.error("Error fetching release letters:", error);
      res.status(500).json({ message: "Failed to fetch release letters" });
    }
  });

  app.get("/api/release-letters/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [letter] = await db.select().from(releaseLetters).where(eq(releaseLetters.id, id)).limit(1);
      if (!letter) return res.status(404).json({ message: "Release letter not found" });
      res.json(letter);
    } catch (error) {
      console.error("Error fetching release letter:", error);
      res.status(500).json({ message: "Failed to fetch release letter" });
    }
  });

  app.post("/api/release-letters", requireAuth, async (req: any, res) => {
    try {
      const { invoiceId, carrierId, brokerId, letterType, content } = req.body;

      if (!carrierId) return res.status(400).json({ message: "Carrier is required" });
      if (!content || content.trim().length < 10) return res.status(400).json({ message: "Letter content must be at least 10 characters" });

      const insertData: any = {
        carrierId: parseInt(carrierId, 10),
        brokerId: brokerId ? parseInt(brokerId, 10) : null,
        invoiceId: invoiceId ? parseInt(invoiceId, 10) : null,
        letterType: letterType ?? "standard",
        status: "draft",
        content: content.trim(),
      };

      if (isNaN(insertData.carrierId)) return res.status(400).json({ message: "Invalid carrier ID" });

      const [letter] = await db.insert(releaseLetters).values(insertData).returning();
      res.status(201).json(letter);
    } catch (error: any) {
      console.error("Error creating release letter:", error);
      const msg = error?.detail ?? error?.message ?? "Failed to create release letter";
      res.status(500).json({ message: msg });
    }
  });

  app.patch("/api/release-letters/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [existing] = await db.select().from(releaseLetters).where(eq(releaseLetters.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Release letter not found" });
      const { status, content, letterType } = req.body;
      const updates: any = {};
      if (content !== undefined) updates.content = content;
      if (letterType) updates.letterType = letterType;
      if (status) {
        updates.status = status;
        if (status === "acknowledged" && !existing.acknowledgedAt) updates.acknowledgedAt = new Date();
      }
      const [updated] = await db.update(releaseLetters).set(updates).where(eq(releaseLetters.id, id)).returning();
      res.json(updated);
    } catch (error) {
      console.error("Error updating release letter:", error);
      res.status(500).json({ message: "Failed to update release letter" });
    }
  });

  app.post("/api/release-letters/:id/send", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [letter] = await db.select().from(releaseLetters).where(eq(releaseLetters.id, id)).limit(1);
      if (!letter) return res.status(404).json({ message: "Release letter not found" });
      if (letter.status === "sent") return res.status(400).json({ message: "Letter already sent" });

      // Fetch broker email if brokerId present
      let brokerEmail: string | null = null;
      let brokerName = "Broker";
      if (letter.brokerId) {
        const [broker] = await db.select().from(brokers).where(eq(brokers.id, letter.brokerId)).limit(1);
        if (broker) { brokerEmail = broker.email; brokerName = broker.name; }
      }
      // Override with provided email if passed
      const toEmail = req.body?.email ?? brokerEmail;
      if (!toEmail) return res.status(400).json({ message: "No broker email available. Add email to broker profile or pass email in body." });

      const FROM = "Support@Truckingprosfinancial.com";
      const subject = `Release Letter — ${letter.letterType.charAt(0).toUpperCase() + letter.letterType.slice(1)}`;
      const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;">
        <h2 style="color:#1a1a1a;">Release Letter</h2>
        <p><strong>Type:</strong> ${letter.letterType.charAt(0).toUpperCase() + letter.letterType.slice(1)}</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
        <div style="white-space:pre-wrap;line-height:1.6;">${letter.content}</div>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
        <p style="color:#6b7280;font-size:13px;">Sent via FactorFlux — Trucking Pros Financial</p>
      </div>`;

      const sent = await sendEmail({ to: toEmail, subject, html, text: letter.content,
        emailLog: { entityType: "broker", entityId: letter.brokerId ?? undefined, templateName: "release_letter" } });
      const [updated] = await db.update(releaseLetters)
        .set({ status: "sent", sentAt: new Date() })
        .where(eq(releaseLetters.id, id))
        .returning();

      console.log(`[release-letters] ${sent ? "✓ sent" : "⚠ log-only"} → ${toEmail}`);
      res.json({ ...updated, emailSent: sent, to: toEmail });
    } catch (error) {
      console.error("Error sending release letter:", error);
      res.status(500).json({ message: "Failed to send release letter" });
    }
  });

  // ─── AI Assistant ──────────────────────────────────────────────────────────
  // Pending actions intentionally live server-side. The opaque id is the only
  // thing returned to the browser and expires quickly, so it cannot be turned
  // into an arbitrary method, URL, or request body by a caller.
  type EarlPendingAction = { userId: string; tool: string; args: Record<string, unknown>; expiresAt: number };
  const earlPendingActions = new Map<string, EarlPendingAction>();
  const EARL_ACTION_TTL_MS = 5 * 60 * 1000;
  const EARL_MAX_RESULT_CHARS = 6000;
  const EARL_MAX_TOOL_ROUNDS = 4;
  const earlSystemPrompt = `You are Earl, the internal AI operator for FactorFlux — the freight factoring operating system built for Trucking Pros Financial. You have full knowledge of the system and can fetch live data and take actions on behalf of agents.

COMPANY: Trucking Pros Financial LLC
ADDRESS: 204 E. 900 S. Salt Lake City, UT 84111
PHONE: 801-755-9755
EMAIL: dosh@truckingprosfinancial.com
HOURS: Monday-Friday 7AM-3PM MST
WIRE CUTOFF: 1:15 PM MST | ACH CUTOFF: 2:15 PM MST

SYSTEM MODULES:
- Carriers: trucking companies we factor for. Fields: name, MC#, DOT#, advance rate, factoring rate, status, assigned processor
- Invoices: freight invoices submitted for factoring. Statuses: draft, pending_review, approved, funded, collected, settled
- Sheets: funding queue where managers approve and fund invoices
- Brokers: freight brokers who owe payment. Have credit grades A-F
- Factoring Pipeline: 8 stages — Document Intake → Verification → Advance → Approval → Collections → Payment Receipt → Reconciliation → Final Settlement
- Fuel Advance: short-term advance up to 50% of load rate before full funding
- Lockbox: cash application — matching broker payments to open invoices
- Held Queue: invoices blocked from funding — missing docs, disputes, manual holds
- Chargebacks: invoices past 60 days auto-scheduled for chargeback, 90 days = charged
- Followups: automated broker email cadence — immediate → due date → 3d → 7d → weekly x4
- Vault: encrypted storage for SSN, bank accounts, sensitive carrier data. Never disclose vault contents.
- Portal: carrier self-service at factorflux.io/portal — submit invoices, upload docs, message agents
- Reports: Aging, Agent Performance, Broker AR, Carrier AR, Short Pay, Daily Deposits
- Earl: that's you

WORKFLOWS:
- Factor an invoice: Carrier submits via portal OR agent creates in Invoices → uploads Rate Con + BOL → submits → appears in Sheets → manager approves → funds carrier
- Fuel advance: Agent creates in Fuel Advance → enters load rate → system calculates 50% max → selects bank account → generates deposit slip
- Put invoice on hold: Open invoice → Hold button → select reason → invoice moves to Held queue
- Match a payment: Lockbox → New Entry → enter payment → Match to invoice
- Approve carrier portal user: Admin → Carrier Portal tab → Approve
- Check broker credit: Brokers page → click broker → Credit Score panel → grade A-F
- Chargeback extension: Held/Factoring → invoice → Chargeback tab → Extend → enter new date and reason

RESPOND:
- Always in the context of FactorFlux and Trucking Pros Financial
- Use exact terminology: carriers not clients, invoices not loads (unless agent uses loads), brokers not debtors
- Be concise and action-oriented
- If you can fetch live data to answer — always fetch it first
- When asked about creating or reviewing an invoice, call preflight_invoice when the carrier is known and surface its alerts; that tool is read-only and you cannot create invoices
- If you can take an action — confirm with the agent before executing
- Broker confirmation is a risk indicator, not an aging clock. Report it using get_invoice. You may resend_broker_confirmation after agent approval, but you must never mark receipt confirmed; phone confirmations are recorded by a human agent in the invoice section.
- Never invent live values, expose sensitive vault data, or reveal provider/internal errors.`;

  const earlToolDefinitions: any[] = [
    { name: "resend_broker_confirmation", description: "Resend a funded invoice receipt confirmation to its broker; requires agent approval. Cannot mark receipt confirmed.", input_schema: { type: "object", properties: { invoice_id: { type: "string", minLength: 1, maxLength: 40 } }, required: ["invoice_id"], additionalProperties: false } },
    { name: "search_system", description: "Search across carriers, brokers, invoices, fuel advances, tickets, tasks", input_schema: { type: "object", properties: { query: { type: "string", minLength: 2, maxLength: 120 }, entity_type: { type: "string", enum: ["carriers", "brokers", "invoices", "fuel_advances", "tickets", "tasks", "all"] } }, required: ["query"], additionalProperties: false } },
    { name: "get_carrier", description: "Get full safe carrier details by ID or MC#", input_schema: { type: "object", properties: { identifier: { type: "string", minLength: 1, maxLength: 80 } }, required: ["identifier"], additionalProperties: false } },
    { name: "get_invoice", description: "Get safe invoice details and status by invoice number, optionally narrowed by carrier MC number", input_schema: { type: "object", properties: { invoice_number: { type: "string", minLength: 1, maxLength: 80 }, mc: { type: "string", minLength: 1, maxLength: 80 } }, required: ["invoice_number"], additionalProperties: false } },
    { name: "preflight_invoice", description: "Read invoice preflight risk alerts before an invoice is created; this tool never creates an invoice", input_schema: { type: "object", properties: { carrier_id: { type: "string", minLength: 1, maxLength: 40 }, broker_id: { type: "string", minLength: 1, maxLength: 40 }, invoice_number: { type: "string", maxLength: 80 }, load_number: { type: "string", maxLength: 120 }, amount: { type: "number", minimum: 0 }, service_date: { type: "string", maxLength: 40 } }, required: ["carrier_id"], additionalProperties: false } },
    { name: "get_broker", description: "Get safe broker details and credit grade by name or MC#", input_schema: { type: "object", properties: { identifier: { type: "string", minLength: 1, maxLength: 80 } }, required: ["identifier"], additionalProperties: false } },
    { name: "get_aging_report", description: "Get current aging report — invoices past due by bucket", input_schema: { type: "object", properties: { min_days: { type: "number", minimum: 0, maximum: 3650 } }, additionalProperties: false } },
    { name: "get_sheets_queue", description: "Get current funding queue — invoices pending approval", input_schema: { type: "object", properties: { limit: { type: "number", minimum: 1, maximum: 50 } }, additionalProperties: false } },
    { name: "get_dashboard_stats", description: "Get current dashboard stats — in queue, awaiting docs, held, funded today", input_schema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "hold_invoice", description: "Put an invoice on hold with a reason; requires confirmation", input_schema: { type: "object", properties: { invoice_id: { type: "string", minLength: 1, maxLength: 40 }, reason: { type: "string", minLength: 1, maxLength: 500 } }, required: ["invoice_id", "reason"], additionalProperties: false } },
    { name: "assign_task", description: "Create and assign a task to an agent; requires confirmation", input_schema: { type: "object", properties: { title: { type: "string", minLength: 1, maxLength: 200 }, description: { type: "string", maxLength: 2000 }, assigned_to: { type: "string", minLength: 1, maxLength: 120 }, due_date: { type: "string", maxLength: 40 }, priority: { type: "string", enum: ["low", "medium", "high", "urgent"] } }, required: ["title", "assigned_to"], additionalProperties: false } },
    { name: "send_carrier_message", description: "Send a message to a carrier via portal chat; requires confirmation", input_schema: { type: "object", properties: { carrier_id: { type: "string", minLength: 1, maxLength: 40 }, message: { type: "string", minLength: 1, maxLength: 10000 } }, required: ["carrier_id", "message"], additionalProperties: false } },
    { name: "get_carrier_invoices", description: "Get safe invoices for a specific carrier", input_schema: { type: "object", properties: { carrier_id: { type: "string", minLength: 1, maxLength: 40 }, status: { type: "string", maxLength: 40 } }, required: ["carrier_id"], additionalProperties: false } },
    { name: "get_broker_credit", description: "Get broker credit score and grade", input_schema: { type: "object", properties: { broker_id: { type: "string", minLength: 1, maxLength: 40 } }, required: ["broker_id"], additionalProperties: false } },
    { name: "get_funding_receipt", description: "Get the latest funding receipt by invoice number or carrier MC number, optionally narrowed by load number", input_schema: { type: "object", properties: { invoice_no: { type: "string", minLength: 1, maxLength: 80 }, mc: { type: "string", minLength: 1, maxLength: 80 }, load_no: { type: "string", minLength: 1, maxLength: 80 } }, additionalProperties: false } },
  ];
  const earlPositiveId = z.preprocess(
    value => typeof value === "string" ? value.trim() : value,
    z.coerce.number().int().positive(),
  );
  const earlText = (min: number, max: number) => z.string().trim().min(min).max(max);
  const earlDate = z.string().trim().min(1).max(40).refine(value => !Number.isNaN(new Date(value).getTime()), "Invalid date");
  const earlToolSchemas: Record<string, z.ZodTypeAny> = {
    resend_broker_confirmation: z.object({ invoice_id: earlPositiveId }).strict(),
    search_system: z.object({
      query: earlText(2, 120),
      entity_type: z.enum(["carriers", "brokers", "invoices", "fuel_advances", "tickets", "tasks", "all"]).default("all"),
    }).strict(),
    get_carrier: z.object({ identifier: earlText(1, 80) }).strict(),
    get_invoice: z.object({ invoice_number: earlText(1, 80), mc: earlText(1, 80).optional() }).strict(),
    preflight_invoice: z.object({
      carrier_id: earlPositiveId,
      broker_id: earlPositiveId.optional(),
      invoice_number: earlText(1, 80).optional(),
      load_number: earlText(1, 120).optional(),
      amount: z.coerce.number().nonnegative().optional(),
      service_date: earlDate.optional(),
    }).strict(),
    get_broker: z.object({ identifier: earlText(1, 80) }).strict(),
    get_aging_report: z.object({ min_days: z.coerce.number().int().min(0).max(3650).default(1) }).strict(),
    get_sheets_queue: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }).strict(),
    get_dashboard_stats: z.object({}).strict(),
    hold_invoice: z.object({ invoice_id: earlPositiveId, reason: earlText(1, 500) }).strict(),
    assign_task: z.object({
      title: earlText(1, 200), description: earlText(1, 2000).optional(),
      assigned_to: earlText(1, 120), due_date: earlDate.optional(),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
    }).strict(),
    send_carrier_message: z.object({ carrier_id: earlPositiveId, message: earlText(1, 10000) }).strict(),
    get_carrier_invoices: z.object({
      carrier_id: earlPositiveId,
      status: z.enum(["draft", "submitted", "docs_pending", "under_review", "approved", "rejected", "funded", "settled", "paid", "held"]).optional(),
    }).strict(),
    get_broker_credit: z.object({ broker_id: earlPositiveId }).strict(),
    get_funding_receipt: z.object({
      invoice_no: earlText(1, 80).optional(),
      mc: earlText(1, 80).optional(),
      load_no: earlText(1, 80).optional(),
    }).strict().refine(value => Boolean(value.invoice_no || value.mc), {
      message: "Provide invoice_no or mc",
    }),
  };
  const earlMutationTools = new Set(["hold_invoice", "assign_task", "send_carrier_message", "resend_broker_confirmation"]);
  const earlToolPermission: Record<string, string[]> = {
    resend_broker_confirmation: ["invoices", "factoring"],
    search_system: ["dashboard", "carriers", "brokers", "invoices", "factoring", "tasks", "tickets"],
    get_carrier: ["carriers"], get_invoice: ["invoices", "factoring"], preflight_invoice: ["invoices", "factoring"], get_broker: ["brokers"],
    get_aging_report: ["factoring", "reports"], get_sheets_queue: ["factoring"], get_dashboard_stats: ["dashboard"],
    hold_invoice: ["factoring"], assign_task: ["tasks"], send_carrier_message: ["chat", "portal_submissions"],
    get_carrier_invoices: ["invoices", "factoring"], get_broker_credit: ["brokers"],
    get_funding_receipt: ["factoring"],
  };
  const earlHasPermission = async (req: any, permissions: string[]) => {
    if (req.user?.role === "admin") return true;
    const cache = ((req as any).__permissionCache ??= new Map<string, string[]>()) as Map<string, string[]>;
    let granted = cache.get(req.user.id);
    if (!granted) {
      granted = await storage.getUserPermissions(req.user.id);
      if (!granted.length) granted = ROLE_DEFAULT_PERMISSIONS[req.user.role] ?? ROLE_DEFAULT_PERMISSIONS.employee;
      cache.set(req.user.id, granted);
    }
    return permissions.some(permission => granted!.includes(permission));
  };
  const earlRedact = (value: any): any => {
    if (Array.isArray(value)) return value.slice(0, 50).map(earlRedact);
    if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}… [truncated]` : value;
    if (!value || typeof value !== "object") return value;
    const blocked = /ssn|bank|routing|secret|password|encrypted|vault|token|owner/i;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !blocked.test(key)).map(([key, val]) => [key, earlRedact(val)]));
  };
  const earlJson = (value: any) => {
    const json = JSON.stringify(earlRedact(value ?? { message: "No data found" }));
    return json.length > EARL_MAX_RESULT_CHARS ? `${json.slice(0, EARL_MAX_RESULT_CHARS - 32)}… [truncated]` : json;
  };
  const earlLog = async (userId: string, event: any) => {
    const audit = {
      role: "tool",
      event: String(event.event ?? "tool_event"),
      tool: event.tool ? String(event.tool) : undefined,
      status: event.status ? String(event.status) : undefined,
      entityIds: Array.isArray(event.entityIds) ? event.entityIds.slice(0, 20).map((id: unknown) => String(id)) : undefined,
      count: typeof event.count === "number" ? event.count : undefined,
      toolNames: Array.isArray(event.toolNames) ? event.toolNames.slice(0, 20).map((name: unknown) => String(name)) : undefined,
      errorCategory: event.errorCategory ? String(event.errorCategory) : undefined,
      timestamp: new Date().toISOString(),
    };
    await db.insert(aiChatLogs).values({ userId, messages: [audit] }).catch(() => undefined);
  };
  const earlCarrierFields = (carrier: any) => ({ id: carrier.id, name: carrier.name, mcNumber: carrier.mcNumber, dotNumber: carrier.dotNumber, status: carrier.status, advanceRate: carrier.advanceRate, factoringRate: carrier.factoringFeeRate, assignedProcessor: carrier.assignedProcessor });
  const earlInvoiceFields = (row: any) => ({
    id: row.id, invoiceNumber: row.invoiceNumber, carrier: row.carrierName, broker: row.brokerName,
    amount: row.amount, status: row.status,
    ageDays: row.fundedAt ? fundedAgeDays(new Date(row.fundedAt)) : 0, fundedAt: row.fundedAt, dueDate: row.dueDate,
    confirmationStatus: row.brokerConfirmationStatus, confirmationSentAt: row.confirmationSentAt,
    brokerConfirmedAt: row.brokerConfirmedAt, confirmationRemindedCount: row.confirmationRemindedCount,
    assignedFollowupAgentId: row.assignedFollowupAgentId,
  });
  const earlBrokerFields = (broker: any) => ({ id: broker.id, name: broker.name, mcNumber: broker.mcNumber, status: broker.status, creditGrade: broker.creditGrade, creditScore: broker.creditScore, assignedProcessor: broker.assignedProcessor });
  const earlCard = (type: string, title: string, fields: Record<string, unknown>, entityId?: number) => ({
    id: `${type}-${entityId ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    type, title, fields: Object.entries(fields).map(([label, value]) => ({ label, value: value == null ? "—" : String(value) })),
    entityType: type, entityId,
  });

  const executeEarlReadTool = async (tool: string, args: any, req: any): Promise<{ data: any; cards?: any[] }> => {
    const q = String(args.query ?? "").trim();
    if (tool === "preflight_invoice") {
      const carrierId = Number(args.carrier_id);
      if (!(await canAccessClient(req, carrierId))) return { data: { message: "Carrier not found or not accessible" } };
      const { alerts } = await runPreflightForInvoice({
        carrierId,
        brokerId: args.broker_id == null ? undefined : Number(args.broker_id),
        invoiceNumber: args.invoice_number,
        loadNumber: args.load_number,
        amount: args.amount,
        serviceDate: args.service_date,
      });
      return { data: { alerts, blocked: alerts.some((alert: any) => alert.severity === "block"), note: "Read-only preflight; no invoice was created." } };
    }
    if (tool === "search_system") {
      const pattern = `%${q}%`; const type = args.entity_type ?? "all"; const result: any = {};
      if ((type === "carriers" || type === "all") && await earlHasPermission(req, ["carriers"])) {
        const scope = isPrivilegedUser(req) ? undefined : eq(clients.assignedProcessor, req.user.id);
        result.carriers = (await db.select({ id: clients.id, name: clients.name, mcNumber: clients.mcNumber, dotNumber: clients.dotNumber, status: clients.status, assignedProcessor: clients.assignedProcessor }).from(clients).where(and(or(ilike(clients.name, pattern), ilike(clients.mcNumber, pattern), ilike(clients.dotNumber, pattern)), scope)).limit(10)).map(earlCarrierFields);
      }
      if ((type === "brokers" || type === "all") && await earlHasPermission(req, ["brokers"])) {
        const scope = isPrivilegedUser(req) ? undefined : eq(brokers.assignedProcessor, req.user.id);
        result.brokers = (await db.select({ id: brokers.id, name: brokers.name, mcNumber: brokers.mcNumber, status: brokers.status, creditGrade: brokers.creditGrade, creditScore: brokers.creditScore, assignedProcessor: brokers.assignedProcessor }).from(brokers).where(and(or(ilike(brokers.name, pattern), ilike(brokers.mcNumber, pattern)), scope)).limit(10)).map(earlBrokerFields);
      }
      if ((type === "invoices" || type === "all") && await earlHasPermission(req, ["invoices", "factoring"])) {
        const scope = req.user.role === "employee" ? eq(invoices.submittedBy, req.user.id) : undefined;
        result.invoices = (await db.select({ invoice: invoices, carrierName: clients.name, brokerName: brokers.name }).from(invoices).leftJoin(clients, eq(invoices.clientId, clients.id)).leftJoin(brokers, eq(invoices.brokerId, brokers.id)).where(and(or(ilike(invoices.invoiceNumber, pattern), ilike(invoices.loadNumber, pattern), ilike(invoices.code, pattern)), scope)).limit(10)).map(row => earlInvoiceFields({ ...row.invoice, carrierName: row.carrierName, brokerName: row.brokerName }));
      }
      if ((type === "fuel_advances" || type === "all") && await earlHasPermission(req, ["fuel_advance"])) {
        const scope = isPrivilegedUser(req)
          ? undefined
          : or(eq(fuelAdvances.processedBy, req.user.id), eq(clients.assignedProcessor, req.user.id));
        result.fuel_advances = await db.select({
          id: fuelAdvances.id, carrierName: fuelAdvances.carrierName, carrierId: fuelAdvances.carrierId,
          loadNumber: fuelAdvances.loadNumber, advanceDate: fuelAdvances.advanceDate,
          pickupState: fuelAdvances.pickupState, deliveryState: fuelAdvances.deliveryState,
          status: fuelAdvances.status,
        }).from(fuelAdvances).leftJoin(clients, eq(fuelAdvances.carrierId, clients.id))
          .where(and(or(ilike(fuelAdvances.carrierName, pattern), ilike(fuelAdvances.loadNumber, pattern), ilike(fuelAdvances.code, pattern)), scope)).limit(10);
      }
      if ((type === "tasks" || type === "all") && await earlHasPermission(req, ["tasks"])) {
        const scope = isPrivilegedUser(req) ? undefined : eq(tasks.assignedTo, req.user.id);
        result.tasks = await db.select({ id: tasks.id, title: tasks.title, status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate, assignedTo: tasks.assignedTo }).from(tasks).where(and(or(ilike(tasks.title, pattern), ilike(tasks.description, pattern)), scope)).limit(10);
      }
      if ((type === "tickets" || type === "all") && await earlHasPermission(req, ["tickets"])) {
        const scope = isPrivilegedUser(req) ? undefined : eq(tickets.assignedTo, req.user.id);
        result.tickets = await db.select({ id: tickets.id, title: tickets.title, status: tickets.status, priority: tickets.priority }).from(tickets).where(and(ilike(tickets.title, pattern), scope)).limit(10);
      }
      return { data: result };
    }
    if (tool === "get_carrier") {
      const identifier = String(args.identifier).trim();
      const numeric = /^\d+$/.test(identifier) ? Number(identifier) : -1;
      const [carrier] = await db.select({ id: clients.id, name: clients.name, mcNumber: clients.mcNumber, dotNumber: clients.dotNumber, status: clients.status, advanceRate: clients.advanceRate, factoringFeeRate: clients.factoringFeeRate, assignedProcessor: clients.assignedProcessor }).from(clients).where(and(or(eq(clients.id, numeric), ilike(clients.mcNumber, identifier), ilike(clients.name, `%${identifier}%`)), isPrivilegedUser(req) ? undefined : eq(clients.assignedProcessor, req.user.id))).limit(1);
      if (!carrier) return { data: { message: "Carrier not found" } };
      return { data: earlCarrierFields(carrier), cards: [earlCard("carrier", carrier.name, earlCarrierFields(carrier), carrier.id)] };
    }
    if (tool === "get_broker" || tool === "get_broker_credit") {
      const identifier = String(args.identifier ?? args.broker_id).trim(); const numeric = /^\d+$/.test(identifier) ? Number(identifier) : -1;
      const [broker] = await db.select({ id: brokers.id, name: brokers.name, mcNumber: brokers.mcNumber, status: brokers.status, creditGrade: brokers.creditGrade, creditScore: brokers.creditScore, assignedProcessor: brokers.assignedProcessor }).from(brokers).where(and(or(eq(brokers.id, numeric), ilike(brokers.mcNumber, identifier), ilike(brokers.name, `%${identifier}%`)), isPrivilegedUser(req) ? undefined : eq(brokers.assignedProcessor, req.user.id))).limit(1);
      if (!broker) return { data: { message: "Broker not found" } };
      const brokerInvoices = await db.select({ amount: invoices.amount, status: invoices.status }).from(invoices).where(and(eq(invoices.brokerId, broker.id), inArray(invoices.status, ["submitted", "docs_pending", "under_review", "approved", "funded", "held"])));
      const outstandingAr = brokerInvoices.reduce((total, invoice) => total + Number(invoice.amount || 0), 0).toFixed(2);
      const fields = { ...earlBrokerFields(broker), outstandingAr };
      return { data: fields, cards: [earlCard("broker", broker.name, { ...fields, creditBadge: broker.creditGrade ?? "Unrated" }, broker.id)] };
    }
    if (tool === "get_invoice") {
      const invoiceNumber = String(args.invoice_number).trim();
      const mc = args.mc ? String(args.mc).trim() : null;
      const rows = await db.select({ invoice: invoices, carrierName: clients.name, brokerName: brokers.name })
        .from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .leftJoin(brokers, eq(invoices.brokerId, brokers.id))
        .where(and(
          eq(invoices.invoiceNumber, invoiceNumber),
          mc ? ilike(clients.mcNumber, mc) : undefined,
          req.user.role === "employee" ? or(eq(invoices.submittedBy, req.user.id), eq(invoices.assignedFollowupAgentId, req.user.id)) : undefined,
        ))
        .limit(1);
      if (!rows.length) return { data: { message: "Invoice not found" } };
      const [row] = rows;
      const fields = earlInvoiceFields({ ...row.invoice, carrierName: row.carrierName, brokerName: row.brokerName });
      return { data: fields, cards: [earlCard("invoice", String(row.invoice.invoiceNumber), fields, row.invoice.id)] };
    }
    if (tool === "get_funding_receipt") {
      const invoiceNo = args.invoice_no ? String(args.invoice_no).trim() : null;
      const mc = args.mc ? String(args.mc).trim() : null;
      const loadNo = args.load_no ? String(args.load_no).trim() : null;
      const identity = invoiceNo
        ? eq(invoices.invoiceNumber, invoiceNo)
        : ilike(clients.mcNumber, mc!);
      const [row] = await db.select({
        receipt: fundingReceipts,
        invoiceNumber: invoices.invoiceNumber,
        loadNumber: invoices.loadNumber,
        carrierName: clients.name,
        mcNumber: clients.mcNumber,
      }).from(fundingReceipts)
        .innerJoin(invoices, eq(fundingReceipts.invoiceId, invoices.id))
        .innerJoin(clients, eq(invoices.clientId, clients.id))
        .where(and(
          identity,
          invoiceNo && mc ? ilike(clients.mcNumber, mc) : undefined,
          loadNo ? ilike(invoices.loadNumber, loadNo) : undefined,
          req.user.role === "employee" ? eq(invoices.submittedBy, req.user.id) : undefined,
        ))
        .orderBy(desc(fundingReceipts.createdAt), desc(fundingReceipts.version))
        .limit(1);
      if (!row) return { data: { message: "Funding receipt not found" } };
      const downloadLink = `/api/receipts/${encodeURIComponent(row.receipt.receiptNo)}/download?version=${row.receipt.version}`;
      const fields = {
        receiptNo: row.receipt.receiptNo,
        version: row.receipt.version,
        invoiceNumber: row.invoiceNumber,
        loadNumber: row.loadNumber,
        carrier: row.carrierName,
        mcNumber: row.mcNumber,
        invoiceAmount: row.receipt.invoiceAmount,
        advancePct: row.receipt.advancePct,
        feeAmount: row.receipt.feeAmount,
        reserveAmount: row.receipt.reserveAmount,
        netFunded: row.receipt.netFunded,
        paymentMethod: row.receipt.paymentMethod,
        paymentReference: row.receipt.paymentReference ?? "pending",
        fundedAt: row.receipt.fundedAt,
        auditHash: row.receipt.auditHash,
        downloadLink,
      };
      return {
        data: fields,
        cards: [earlCard("funding_receipt", `${row.receipt.receiptNo} v${row.receipt.version}`, fields, row.receipt.id)],
      };
    }
    if (tool === "get_carrier_invoices") {
      const carrierId = Number(args.carrier_id); if (!Number.isInteger(carrierId) || !(await canAccessClient(req, carrierId))) return { data: { message: "Carrier not found or not accessible" } };
      const rows = await db.select({ invoice: invoices, carrierName: clients.name, brokerName: brokers.name }).from(invoices).leftJoin(clients, eq(invoices.clientId, clients.id)).leftJoin(brokers, eq(invoices.brokerId, brokers.id)).where(and(eq(invoices.clientId, carrierId), args.status ? eq(invoices.status, String(args.status) as any) : undefined, req.user.role === "employee" ? eq(invoices.submittedBy, req.user.id) : undefined)).orderBy(desc(invoices.createdAt)).limit(50);
      return { data: rows.map(row => earlInvoiceFields({ ...row.invoice, carrierName: row.carrierName, brokerName: row.brokerName })) };
    }
    if (tool === "get_aging_report") {
      const minDays = Number(args.min_days ?? 1);
      const rows = (await getConfirmationAgingRows(await getConfirmationInvoiceScope(req.user))).filter(row => row.ageDays >= minDays);
      return { data: { minDays, total: rows.length, invoices: rows.slice(0, 50) } };
    }
    if (tool === "get_sheets_queue") {
      const limit = Math.min(50, Math.max(1, Number(args.limit ?? 10))); const rows = await db.select({ invoice: invoices, carrierName: clients.name, brokerName: brokers.name }).from(invoices).leftJoin(clients, eq(invoices.clientId, clients.id)).leftJoin(brokers, eq(invoices.brokerId, brokers.id)).where(and(inArray(invoices.status, ["submitted", "docs_pending", "under_review", "approved"]), req.user.role === "employee" ? eq(invoices.submittedBy, req.user.id) : undefined)).orderBy(asc(invoices.createdAt)).limit(limit);
      return { data: { total: rows.length, invoices: rows.map(row => earlInvoiceFields({ ...row.invoice, carrierName: row.carrierName, brokerName: row.brokerName })) } };
    }
    if (tool === "get_dashboard_stats") {
      if (!isPrivilegedUser(req)) return { data: { message: "Dashboard totals require manager or admin access" } };
      return { data: await storage.getDashboardStats() };
    }
    return { data: { message: "Tool not available" } };
  };

  const makeEarlPendingConfirmation = (req: any, tool: string, args: Record<string, unknown>) => {
    const now = Date.now();
    earlPendingActions.forEach((pending, pendingId) => {
      if (pending.expiresAt <= now) earlPendingActions.delete(pendingId);
    });
    const id = crypto.randomBytes(24).toString("hex"); const expiresAt = Date.now() + EARL_ACTION_TTL_MS;
    earlPendingActions.set(id, { userId: req.user.id, tool, args, expiresAt });
    const labels: Record<string, string> = { hold_invoice: "Place invoice on hold", assign_task: "Create and assign task", send_carrier_message: "Send carrier portal message", resend_broker_confirmation: "Resend broker confirmation" };
    return { id, tool, title: labels[tool], description: tool === "resend_broker_confirmation" ? `Resend broker receipt confirmation for invoice ${args.invoice_id}` : tool === "hold_invoice" ? `Place invoice ${args.invoice_id} on hold for: ${args.reason}` : tool === "assign_task" ? `Assign task “${args.title}” to ${args.assigned_to}` : `Send a message to carrier ${args.carrier_id}`, expiresAt: new Date(expiresAt).toISOString() };
  };
  const executeEarlMutation = async (tool: string, args: any, req: any) => {
    if (tool === "resend_broker_confirmation") {
      const invoiceId = Number(args.invoice_id);
      if (!await employeeCanAccessInvoice(req, invoiceId)) throw new Error("Invoice not accessible.");
      return brokerConfirmationService.sendForInvoice(invoiceId, { kind: "agent", id: req.user.id });
    }
    if (tool === "hold_invoice") {
      if (!isPrivilegedUser(req)) throw new Error("Manager or admin access required");
      const invoiceId = Number(args.invoice_id); if (!Number.isInteger(invoiceId) || invoiceId <= 0) throw new Error("Invalid invoice ID");
      const reason = String(args.reason).trim(); const allowed = ["submitted", "docs_pending", "under_review", "approved"] as const;
      const outcome = await db.transaction(async tx => {
        const [existing] = await tx.select({ id: invoices.id, status: invoices.status }).from(invoices).where(eq(invoices.id, invoiceId));
        if (!existing) return { kind: "not_found" as const }; if (!allowed.includes(existing.status as any)) return { kind: "conflict" as const, status: existing.status };
        const heldAt = new Date(); const [updated] = await tx.update(invoices).set({ previousStatus: existing.status, status: "held", heldReason: reason, heldAt, heldBy: req.user.id, updatedAt: heldAt }).where(and(eq(invoices.id, invoiceId), inArray(invoices.status, [...allowed]))).returning();
        if (!updated) return { kind: "conflict" as const, status: existing.status };
        await tx.insert(eventLedger).values({
          entityType: "invoice",
          entityId: invoiceId,
          eventType: "invoice_status_changed",
          actorType: "user",
          actorId: req.user.id,
          payloadJson: { from: existing.status, to: "held", reason, label: "Invoice placed on hold" },
        });
        return { kind: "updated" as const, invoice: updated };
      });
      if (outcome.kind === "not_found") throw new Error("Invoice not found"); if (outcome.kind === "conflict") throw new Error(`Invoices in ${outcome.status} status cannot be placed on hold`);
      return { message: `Invoice ${outcome.invoice.invoiceNumber} placed on hold.` };
    }
    if (tool === "assign_task") {
      const assignedValue = String(args.assigned_to).trim(); let assignedTo = assignedValue;
      const [byId] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, assignedValue), eq(users.status, "active"))).limit(1);
      if (!byId) {
        const [byName] = await db.select({ id: users.id }).from(users).where(and(eq(users.status, "active"), ilike(sql`concat(${users.firstName}, ' ', ${users.lastName})`, assignedValue))).limit(1);
        assignedTo = byName?.id ?? "";
      }
      if (!assignedTo) throw new Error("Active assignee not found");
      if (req.user.role === "employee" && assignedTo !== req.user.id) throw new Error("Employees may only assign tasks to themselves");
      const dueDate = args.due_date ? new Date(String(args.due_date)) : undefined; if (dueDate && Number.isNaN(dueDate.getTime())) throw new Error("Invalid due date");
      const data = insertTaskSchema.parse({ title: String(args.title).trim(), description: args.description ? String(args.description).trim() : null, type: "task", priority: args.priority ?? "medium", assignedTo, ...(dueDate ? { dueDate } : {}) });
      const [task] = await db.insert(tasks).values({ ...data, createdBy: req.user.id }).returning();
      if (assignedTo !== req.user.id) await storage.createNotification({ userId: assignedTo, title: "New task assigned", message: `You were assigned: ${task.title}`, type: "info", entityType: "task", entityId: task.id, actionUrl: `/tasks/${task.id}` });
      return { message: `Task “${task.title}” assigned.`, taskId: task.id };
    }
    if (tool === "send_carrier_message") {
      const carrierId = Number(args.carrier_id); if (!Number.isInteger(carrierId) || !(await canAccessClient(req, carrierId))) throw new Error("Carrier not found or not accessible");
      const chatResult = await getAgentChatForCarrier(carrierId, true);
      if (!chatResult) throw new Error("Active carrier portal chat not found");
      const [created] = await db.insert(portalChatMessages).values({ chatId: chatResult.chat.id, senderType: "agent", senderId: String(req.user.id), message: String(args.message).trim(), read: false }).returning();
      await db.update(portalChats).set({ agentId: sql`coalesce(${portalChats.agentId}, ${req.user.id})`, updatedAt: new Date() }).where(eq(portalChats.id, chatResult.chat.id));
      await storage.createActivity({ userId: req.user.id, type: "carrier_chat_message_sent", description: `Sent a portal message to carrier ${carrierId}`, entityType: "client", entityId: carrierId }).catch(() => undefined);
      return { message: "Carrier message sent.", messageId: created.id };
    }
    throw new Error("Unsupported action");
  };

  app.post("/api/ai/chat", requireAuth, async (req: any, res) => {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(503).json({ message: "AI Assistant is not configured. Ask your administrator to set the ANTHROPIC_API_KEY." });
      const rawMessages = req.body?.messages;
      if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > 20) return res.status(400).json({ message: "messages must contain 1 to 20 messages" });
      const messages = rawMessages.map((message: any) => {
        if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string" || !message.content.trim() || message.content.length > 12000) throw new Error("Invalid message format");
        return { role: message.role, content: message.content.trim() };
      });
      const client = new Anthropic({ apiKey }); let transcript: any[] = [...messages]; let finalMessage = ""; let confirmation: any = null; let mutationQueued = false; const cards: any[] = []; const activities: any[] = []; const toolNames: string[] = [];
      for (let round = 0; round < EARL_MAX_TOOL_ROUNDS; round++) {
        const response: any = await client.messages.create({ model: "claude-sonnet-4-5", max_tokens: 1400, system: earlSystemPrompt, tools: earlToolDefinitions, messages: transcript });
        transcript.push({ role: "assistant", content: response.content });
        const text = response.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n").trim();
        const calls = response.content.filter((block: any) => block.type === "tool_use");
        if (text) finalMessage = text;
        if (!calls.length || response.stop_reason !== "tool_use") break;
        const results: any[] = [];
        for (const call of calls) {
          const tool = String(call.name); const definition = earlToolDefinitions.find(item => item.name === tool);
          if (!definition) { await earlLog(req.user.id, { event: "tool_denied", tool, reason: "unknown_tool" }); results.push({ type: "tool_result", tool_use_id: call.id, content: earlJson({ message: "Unknown tool" }), is_error: true }); continue; }
          let args: any;
          try { args = earlToolSchemas[tool].parse(call.input ?? {}); } catch { await earlLog(req.user.id, { event: "tool_failed", tool, status: "failed", errorCategory: "invalid_input" }); activities.push({ tool, label: tool.replace(/_/g, " "), status: "failed", detail: "Invalid tool input" }); results.push({ type: "tool_result", tool_use_id: call.id, content: earlJson({ message: "Invalid tool input" }), is_error: true }); continue; }
          toolNames.push(tool);
          if (!(await earlHasPermission(req, earlToolPermission[tool] ?? []))) { await earlLog(req.user.id, { event: "tool_denied", tool, status: "denied", errorCategory: "permission" }); activities.push({ tool, label: tool.replace(/_/g, " "), status: "failed", detail: "Permission denied" }); results.push({ type: "tool_result", tool_use_id: call.id, content: earlJson({ message: "You do not have permission for this data or action." }), is_error: true }); continue; }
          await earlLog(req.user.id, { event: "tool_call", tool, status: "running" });
          if (earlMutationTools.has(tool)) {
            if (mutationQueued) {
              await earlLog(req.user.id, { event: "tool_denied", tool, status: "denied", errorCategory: "multiple_pending_actions" });
              activities.push({ tool, label: tool.replace(/_/g, " "), status: "failed", detail: "Only one action can be confirmed at a time" });
              results.push({ type: "tool_result", tool_use_id: call.id, content: earlJson({ message: "Only one action can be confirmed at a time." }), is_error: true });
              continue;
            }
            confirmation = makeEarlPendingConfirmation(req, tool, args);
            mutationQueued = true;
            activities.push({ tool, label: tool.replace(/_/g, " "), status: "pending", detail: "Waiting for confirmation" });
            await earlLog(req.user.id, { event: "tool_pending", tool, status: "pending" });
            results.push({ type: "tool_result", tool_use_id: call.id, content: earlJson({ pending_confirmation: true, tool, message: "Confirmation is required before this action can execute." }) });
          } else {
            try { const output = await executeEarlReadTool(tool, args, req); cards.push(...(output.cards ?? [])); await earlLog(req.user.id, { event: "tool_result", tool, status: "completed", count: Array.isArray(output.data) ? output.data.length : undefined }); activities.push({ tool, label: tool.replace(/_/g, " "), status: "completed" }); results.push({ type: "tool_result", tool_use_id: call.id, content: earlJson(output.data) }); }
            catch { await earlLog(req.user.id, { event: "tool_failed", tool, status: "failed", errorCategory: "data_access" }); activities.push({ tool, label: tool.replace(/_/g, " "), status: "failed", detail: "Data unavailable" }); results.push({ type: "tool_result", tool_use_id: call.id, content: earlJson({ message: "Unable to retrieve that data." }), is_error: true }); }
          }
        }
        transcript.push({ role: "user", content: results });
        if (confirmation) break;
      }
      if (!finalMessage && !confirmation) {
        const synthesis: any = await client.messages.create({ model: "claude-sonnet-4-5", max_tokens: 1400, system: earlSystemPrompt, messages: transcript });
        finalMessage = synthesis.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n").trim();
      }
      if (!finalMessage) finalMessage = confirmation ? "I’m ready to do that. Please confirm the action." : "I couldn’t find a response for that request.";
      const userId = req.user?.claims?.sub ?? req.user?.id;
      await earlLog(userId, { event: "chat", status: "completed", count: messages.length, toolNames });
      const uniqueCards = Array.from(new Map(cards.filter(card => typeof card?.id === "string").map(card => [card.id, card])).values());
      res.json({ message: finalMessage, activities, cards: uniqueCards.slice(0, 10), confirmation });
    } catch (error: any) {
      console.error("AI chat error:", error instanceof Error ? error.message : "unknown");
      res.status(error?.message === "Invalid message format" ? 400 : 500).json({ message: error?.message === "Invalid message format" ? error.message : "Failed to get AI response" });
    }
  });

  app.post("/api/ai/actions/:id/confirm", requireAuth, async (req: any, res) => {
    const id = String(req.params.id || "");
    const pending = earlPendingActions.get(id);
    if (!pending || pending.expiresAt <= Date.now()) { if (pending) earlPendingActions.delete(id); return res.status(404).json({ message: "Confirmation expired or not found", activities: [], cards: [], confirmation: null }); }
    if (pending.userId !== req.user.id) return res.status(403).json({ message: DENIED_MESSAGE, activities: [], cards: [], confirmation: null });
    earlPendingActions.delete(id);
    if (!(await earlHasPermission(req, earlToolPermission[pending.tool] ?? []))) { await earlLog(req.user.id, { event: "action_denied", tool: pending.tool, status: "denied", errorCategory: "permission" }); return res.status(403).json({ message: DENIED_MESSAGE, activities: [], cards: [], confirmation: null }); }
    try {
      const parsedArgs = earlToolSchemas[pending.tool].parse(pending.args);
      const result = await executeEarlMutation(pending.tool, parsedArgs, req);
      await earlLog(req.user.id, { event: "action_confirmed", tool: pending.tool, status: "completed" });
      res.json({ message: result.message, activities: [{ tool: pending.tool, label: pending.tool.replace(/_/g, " "), status: "completed" }], cards: [], confirmation: null });
    } catch (error: any) {
      await earlLog(req.user.id, { event: "action_failed", tool: pending.tool, status: "failed", errorCategory: error instanceof z.ZodError ? "invalid_saved_input" : "business_state" });
      res.status(400).json({ message: error instanceof z.ZodError ? "Confirmation is no longer valid" : error instanceof Error ? error.message : "Action could not be completed", activities: [{ tool: pending.tool, label: pending.tool.replace(/_/g, " "), status: "failed", detail: "Action could not be completed" }], cards: [], confirmation: null });
    }
  });

  // ─── Bulk Invoices ─────────────────────────────────────────────────────────
  const bulkRateSchema = z.union([
    z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Rate must use no more than two decimal places"),
    z.number().multipleOf(0.01, "Rate must use no more than two decimal places"),
  ]).transform(value => Number(value)).refine(value => value > 0 && value <= 99_999_999.99, "Rate must be greater than zero");

  const bulkInvoiceCreateSchema = z.object({
    brokerId: z.coerce.number().int().positive(),
    reportDateStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reportDateEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    acknowledgements: z.array(z.object({ code: z.string().trim().min(1).max(120), reason: z.string().trim().max(2000).optional() }).strict()).max(100).optional(),
    overrideNearDuplicate: z.boolean().optional(),
    items: z.array(z.object({
      carrierId: z.coerce.number().int().positive(),
      ticketNumber: z.string().trim().min(1).max(120),
      loadNumber: z.string().trim().min(1).max(120),
      rate: bulkRateSchema,
    })).min(1).max(200),
  }).superRefine((value, ctx) => {
    if (value.reportDateStart > value.reportDateEnd) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reportDateEnd"], message: "End date must be on or after start date" });
    }
    const seen = new Set<string>();
    value.items.forEach((item, index) => {
      const key = `${item.carrierId}|${item.ticketNumber.toLowerCase()}|${item.loadNumber.toLowerCase()}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items", index], message: "Duplicate carrier, ticket, and load combination" });
      }
      seen.add(key);
    });
  });

  const bulkBatchAccessCondition = (req: any, id?: number) => {
    const conditions = id ? [eq(bulkInvoiceBatches.id, id)] : [];
    if (req.user.role === "employee") conditions.push(eq(bulkInvoiceBatches.createdBy, req.user.id));
    return conditions.length === 1 ? conditions[0] : conditions.length > 1 ? and(...conditions) : undefined;
  };

  const formatBulkPdfDate = (value: Date | string | null | undefined) => value
    ? new Date(value).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", timeZone: "America/Denver" })
    : "Not recorded";

  app.get("/api/bulk-invoices", requireModulePermission("bulk_invoices"), async (req: any, res) => {
    try {
      const rows = await db.select({
        batch: bulkInvoiceBatches,
        brokerName: brokers.name,
        createdByFirstName: users.firstName,
        createdByLastName: users.lastName,
      }).from(bulkInvoiceBatches)
        .leftJoin(brokers, eq(bulkInvoiceBatches.brokerId, brokers.id))
        .leftJoin(users, eq(bulkInvoiceBatches.createdBy, users.id))
        .where(bulkBatchAccessCondition(req))
        .orderBy(desc(bulkInvoiceBatches.createdAt));

      const batchIds = rows.map(({ batch }) => batch.id);
      const ticketRows = batchIds.length
        ? await db.select({
            batchId: bulkInvoiceItems.batchId,
            ticketNumber: bulkInvoiceItems.ticketNumber,
            legacyLoadNumber: bulkInvoiceItems.loadNumber,
          }).from(bulkInvoiceItems).where(inArray(bulkInvoiceItems.batchId, batchIds))
        : [];
      const ticketsByBatch = new Map<number, string[]>();
      for (const item of ticketRows) {
        const ticket = item.ticketNumber || item.legacyLoadNumber;
        if (!ticket) continue;
        ticketsByBatch.set(item.batchId, [...(ticketsByBatch.get(item.batchId) || []), ticket]);
      }

      res.json(rows.map(({ batch, brokerName, createdByFirstName, createdByLastName }) => ({
        ...batch,
        brokerName: brokerName || "Legacy batch",
        totalRate: batch.totalRate || batch.totalAmount,
        ticketNumbers: ticketsByBatch.get(batch.id) || [],
        createdByName: [createdByFirstName, createdByLastName].filter(Boolean).join(" ") || "Unknown",
      })));
    } catch (error) {
      console.error("Error fetching bulk invoices:", error);
      res.status(500).json({ message: "Failed to fetch bulk invoices" });
    }
  });

  app.get("/api/bulk-invoices/:id", requireModulePermission("bulk_invoices"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid batch ID" });
      const [row] = await db.select({
        batch: bulkInvoiceBatches,
        brokerName: brokers.name,
        createdByFirstName: users.firstName,
        createdByLastName: users.lastName,
      }).from(bulkInvoiceBatches)
        .leftJoin(brokers, eq(bulkInvoiceBatches.brokerId, brokers.id))
        .leftJoin(users, eq(bulkInvoiceBatches.createdBy, users.id))
        .where(bulkBatchAccessCondition(req, id))
        .limit(1);
      if (!row) return res.status(404).json({ message: "Batch not found" });
      const items = await db.select({
        id: bulkInvoiceItems.id,
        batchId: bulkInvoiceItems.batchId,
        carrierId: bulkInvoiceItems.carrierId,
        carrierName: clients.name,
        ticketNumber: bulkInvoiceItems.ticketNumber,
        loadNumber: bulkInvoiceItems.loadNumber,
        rate: bulkInvoiceItems.rate,
        invoiceId: bulkInvoiceItems.invoiceId,
        invoiceNumber: bulkInvoiceItems.invoiceNumber,
        createdAt: invoices.createdAt,
      }).from(bulkInvoiceItems)
        .leftJoin(clients, eq(bulkInvoiceItems.carrierId, clients.id))
        .leftJoin(invoices, eq(bulkInvoiceItems.invoiceId, invoices.id))
        .where(eq(bulkInvoiceItems.batchId, id));
      res.json({
        ...row.batch,
        brokerName: row.brokerName || "Legacy batch",
        totalRate: row.batch.totalRate || row.batch.totalAmount,
        ticketNumbers: items.map(item => item.ticketNumber || item.loadNumber).filter(Boolean),
        createdByName: [row.createdByFirstName, row.createdByLastName].filter(Boolean).join(" ") || "Unknown",
        items,
      });
    } catch (error) {
      console.error("Error fetching bulk invoice batch:", error);
      res.status(500).json({ message: "Failed to fetch batch" });
    }
  });

  app.post("/api/bulk-invoices", requireModulePermission("bulk_invoices"), async (req: any, res) => {
    try {
      const input = bulkInvoiceCreateSchema.parse(req.body);
      const userId = req.user.id;
      const reportDateStart = new Date(`${input.reportDateStart}T12:00:00`);
      const reportDateEnd = new Date(`${input.reportDateEnd}T12:00:00`);
      const totalRateCents = input.items.reduce((sum, item) => sum + Math.round(item.rate * 100), 0);
      const totalRate = totalRateCents / 100;
      const uniqueCarrierIds = Array.from(new Set(input.items.map(item => item.carrierId)));
      const normalizeBulkIdentity = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
      const requestHash = crypto.createHash("sha256").update(JSON.stringify({
        userId,
        brokerId: input.brokerId,
        reportDateStart: input.reportDateStart,
        reportDateEnd: input.reportDateEnd,
        items: input.items.map(item => ({
          carrierId: item.carrierId,
          ticketNumber: item.ticketNumber.toLowerCase(),
          loadNumber: item.loadNumber.toLowerCase(),
          rateCents: Math.round(item.rate * 100),
        })),
      })).digest("hex");

      const [broker] = await db.select().from(brokers).where(eq(brokers.id, input.brokerId)).limit(1);
      if (!broker) return res.status(400).json({ message: "Selected broker was not found" });
      const carrierRows = await db.select({ id: clients.id }).from(clients).where(inArray(clients.id, uniqueCarrierIds));
      if (carrierRows.length !== uniqueCarrierIds.length) return res.status(400).json({ message: "One or more selected carriers were not found" });
      if (!(await canAccessBroker(req, input.brokerId))) {
        return res.status(403).json({ message: "You may only create bulk invoices for brokers assigned to you" });
      }
      for (const carrierId of uniqueCarrierIds) {
        if (!(await canAccessClient(req, carrierId))) {
          return res.status(403).json({ message: "You may only create bulk invoices for carriers assigned to you" });
        }
      }

      const bulkPreflightAlerts: any[][] = [];
      for (let index = 0; index < input.items.length; index += 1) {
        const item = input.items[index];
        const preflight = await runPreflightForInvoice({
          carrierId: item.carrierId,
          brokerId: input.brokerId,
          loadNumber: item.loadNumber,
          amount: item.rate,
          serviceDate: reportDateStart,
        });
        bulkPreflightAlerts.push(preflight.alerts);
      }
      const allAckAlerts = bulkPreflightAlerts.flat().filter((alert: any) => alert.severity === "ack");
      const ackValidation = getPreflightDecision(allAckAlerts, input.acknowledgements, req.user, false);
      if (ackValidation.invalidAcknowledgements) {
        return res.status(400).json({ message: "Acknowledgements must contain only unique alert codes requiring acknowledgement, with optional text reasons." });
      }
      const bulkPreflightResults: Array<{ alerts: any[]; decision: any }> = [];
      const failedPreflightAlerts: any[] = [];
      for (let index = 0; index < bulkPreflightAlerts.length; index += 1) {
        const alerts = bulkPreflightAlerts[index];
        const itemAckCodes = new Set(alerts.filter((alert: any) => alert.severity === "ack").map((alert: any) => alert.code));
        const itemAcknowledgements = (input.acknowledgements ?? []).filter((ack: any) => itemAckCodes.has(ack.code));
        const decision = getPreflightDecision(alerts, itemAcknowledgements, req.user, input.overrideNearDuplicate === true);
        bulkPreflightResults.push({ alerts, decision });
        if (!decision.accepted) failedPreflightAlerts.push(...alerts.map((alert: any) => ({ ...alert, itemIndex: index })));
      }
      if (failedPreflightAlerts.length) {
        return res.status(409).json({ message: "Bulk invoice preflight requires attention", alerts: failedPreflightAlerts });
      }

      const createdResult = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(92734012)`);
        const lockedAlerts: any[][] = [];
        for (let index = 0; index < input.items.length; index += 1) {
          const item = input.items[index];
          const preflight = await runPreflightForInvoice({
            carrierId: item.carrierId,
            brokerId: input.brokerId,
            loadNumber: item.loadNumber,
            amount: item.rate,
            serviceDate: reportDateStart,
          }, tx);
          lockedAlerts.push(preflight.alerts);
        }
        const settingsResult = await tx.execute(sql`SELECT rules, near_amount_tolerance FROM invoice_preflight_settings LIMIT 1`);
        const preflightSettings: any = settingsResult.rows[0];
        const nearDuplicatesEnabled = preflightSettings?.rules?.DUPLICATE_NEAR !== false;
        const nearAmountTolerance = Number(preflightSettings?.near_amount_tolerance ?? 1);
        const sameBatchAlerts = input.items.map(() => [] as any[]);
        const normalizeLoadNumber = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
        for (let leftIndex = 0; leftIndex < input.items.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < input.items.length; rightIndex += 1) {
            const left = input.items[leftIndex];
            const right = input.items[rightIndex];
            if (left.carrierId !== right.carrierId) continue;
            if (normalizeLoadNumber(left.loadNumber) === normalizeLoadNumber(right.loadNumber)) {
              sameBatchAlerts[leftIndex].push({
                code: "DUPLICATE_EXACT",
                severity: "block",
                title: "Duplicate load in this batch",
                message: `Batch item ${rightIndex + 1} repeats load ${left.loadNumber}.`,
                matchedItemIndex: rightIndex,
              });
              sameBatchAlerts[rightIndex].push({
                code: "DUPLICATE_EXACT",
                severity: "block",
                title: "Duplicate load in this batch",
                message: `Batch item ${leftIndex + 1} repeats load ${right.loadNumber}.`,
                matchedItemIndex: leftIndex,
              });
            } else if (nearDuplicatesEnabled && Math.abs(left.rate - right.rate) <= nearAmountTolerance) {
              sameBatchAlerts[leftIndex].push({
                code: "DUPLICATE_NEAR",
                severity: "block",
                title: "Near-duplicate load in this batch",
                message: `Batch item ${rightIndex + 1} has the same carrier, broker, report date, and a rate within $${nearAmountTolerance.toFixed(2)}.`,
                matchedItemIndex: rightIndex,
              });
              sameBatchAlerts[rightIndex].push({
                code: "DUPLICATE_NEAR",
                severity: "block",
                title: "Near-duplicate load in this batch",
                message: `Batch item ${leftIndex + 1} has the same carrier, broker, report date, and a rate within $${nearAmountTolerance.toFixed(2)}.`,
                matchedItemIndex: leftIndex,
              });
            }
          }
        }
        for (let index = 0; index < lockedAlerts.length; index += 1) {
          lockedAlerts[index].push(...sameBatchAlerts[index]);
        }
        const lockedAckValidation = getPreflightDecision(
          lockedAlerts.flat().filter((alert: any) => alert.severity === "ack"),
          input.acknowledgements,
          req.user,
          false,
        );
        if (lockedAckValidation.invalidAcknowledgements) {
          throw Object.assign(new Error("Invoice preflight changed before creation; review the current alerts and try again."), {
            status: 409,
            preflightAlerts: lockedAlerts.flat(),
          });
        }
        const lockedResults: Array<{ alerts: any[]; decision: any }> = [];
        const lockedFailures: any[] = [];
        for (let index = 0; index < lockedAlerts.length; index += 1) {
          const alerts = lockedAlerts[index];
          const itemAckCodes = new Set(alerts.filter((alert: any) => alert.severity === "ack").map((alert: any) => alert.code));
          const itemAcknowledgements = (input.acknowledgements ?? []).filter((ack: any) => itemAckCodes.has(ack.code));
          const decision = getPreflightDecision(alerts, itemAcknowledgements, req.user, input.overrideNearDuplicate === true);
          lockedResults.push({ alerts, decision });
          if (!decision.accepted) lockedFailures.push(...alerts.map((alert: any) => ({ ...alert, itemIndex: index })));
        }
        if (lockedFailures.length) {
          throw Object.assign(new Error("Bulk invoice preflight requires attention."), {
            status: 409,
            preflightAlerts: lockedFailures,
          });
        }
        bulkPreflightResults.splice(0, bulkPreflightResults.length, ...lockedResults);

        let [debtor] = await tx.select().from(debtors)
          .where(sql`lower(${debtors.name}) = lower(${broker.name})`)
          .limit(1);
        if (!debtor) {
          [debtor] = await tx.insert(debtors).values({
            name: broker.name,
            email: broker.email,
            phone: broker.phone,
            address: [broker.address, broker.city, broker.state, broker.zipCode].filter(Boolean).join(", ") || null,
            contactPerson: broker.contactPerson,
            mcNumber: broker.mcNumber,
            dotNumber: broker.dotNumber,
            status: broker.status === "inactive" ? "inactive" : "active",
            notes: `Created automatically from broker record #${broker.id} for bulk invoicing`,
          }).returning();
        }

        const now = new Date();
        const batchName = `${broker.name} ${input.reportDateStart} to ${input.reportDateEnd}`;
        const [createdBatch] = await tx.insert(bulkInvoiceBatches).values({
          batchName,
          carrierId: input.items[0].carrierId,
          brokerId: broker.id,
          requestHash,
          reportDateStart,
          reportDateEnd,
          totalAmount: totalRate.toFixed(2),
          totalRate: totalRate.toFixed(2),
          invoiceCount: input.items.length,
          status: "submitted",
          submittedAt: now,
          createdBy: userId,
        }).returning();

        const createdInvoices: any[] = [];
        const createdItems: any[] = [];
        for (let index = 0; index < input.items.length; index += 1) {
          const item = input.items[index];
          const businessKey = crypto.createHash("sha256").update([
            broker.id,
            item.carrierId,
            normalizeBulkIdentity(item.ticketNumber),
            normalizeBulkIdentity(item.loadNumber),
          ].join("|")).digest("hex");
          const invoiceNumber = await getNextInvoiceNumberInTransaction(tx);
          const [createdInvoice] = await tx.insert(invoices).values({
            invoiceNumber,
            loadId: null,
            clientId: item.carrierId,
            brokerId: broker.id,
            debtorId: debtor.id,
            loadNumber: item.loadNumber,
            amount: (Math.round(item.rate * 100) / 100).toFixed(2),
            currency: "USD",
            invoiceDate: reportDateStart,
            loadType: "dump_truck_ticket",
            bolNumber: item.ticketNumber,
            status: "submitted",
            factoringStage: "verification",
            submittedBy: userId,
            submittedAt: now,
            notes: `Bulk invoice batch #${createdBatch.id}; ticket ${item.ticketNumber}`,
          }).returning();
          const [createdItem] = await tx.insert(bulkInvoiceItems).values({
            batchId: createdBatch.id,
            carrierId: item.carrierId,
            ticketNumber: item.ticketNumber,
            loadNumber: item.loadNumber,
            rate: (Math.round(item.rate * 100) / 100).toFixed(2),
            invoiceId: createdInvoice.id,
            businessKey,
            invoiceNumber,
            amount: (Math.round(item.rate * 100) / 100).toFixed(2),
            brokerName: broker.name,
            status: "pending",
            notes: null,
          }).returning();
          createdInvoices.push(createdInvoice);
          createdItems.push(createdItem);
          const preflight = bulkPreflightResults[index];
          await recordInvoicePreflight(createdInvoice.id, userId, preflight.alerts, preflight.decision.acknowledgements, preflight.decision.nearOverride, tx);
          await tx.insert(eventLedger).values({
            entityType: "invoice",
            entityId: createdInvoice.id,
            eventType: "invoice.created",
            actorType: "user",
            actorId: userId,
            payloadJson: {
              invoiceNumber: createdInvoice.invoiceNumber,
              status: createdInvoice.status,
              clientId: createdInvoice.clientId,
              debtorId: createdInvoice.debtorId,
              amount: createdInvoice.amount,
              source: "bulk_invoice",
              batchId: createdBatch.id,
            },
          });
        }
        return { batch: createdBatch, createdInvoices, items: createdItems };
      });

      await storage.createActivity({
        userId,
        type: "invoice_created",
        description: `Created bulk invoice batch #${createdResult.batch.id} with ${createdResult.createdInvoices.length} invoices for ${broker.name}`,
        entityType: "bulk_invoice_batch",
        entityId: createdResult.batch.id,
      }).catch((error: any) => console.warn("Bulk invoice activity logging failed:", error?.message));

      res.status(201).json({
        ...createdResult.batch,
        brokerName: broker.name,
        totalRate: createdResult.batch.totalRate,
        ticketNumbers: input.items.map(item => item.ticketNumber),
        createdByName: req.user.name || [req.user.firstName, req.user.lastName].filter(Boolean).join(" "),
        items: createdResult.items,
        createdInvoices: createdResult.createdInvoices.map(withInvoiceDisplayStatus),
      });
    } catch (error) {
      if ((error as any)?.status === 409) {
        return res.status(409).json({ message: (error as Error).message, alerts: (error as any)?.preflightAlerts ?? [] });
      }
      if (error instanceof z.ZodError) {
        if (error.errors.some((issue) => issue.message === "Duplicate carrier, ticket, and load combination")) {
          return res.status(409).json({ message: "Duplicate carrier, ticket, and load combinations were submitted.", alerts: [] });
        }
        return res.status(400).json({ message: error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "), errors: error.errors });
      }
      const duplicateConstraint = String((error as any)?.constraint || "");
      const isRequestDuplicate = (error as any)?.code === "23505" && duplicateConstraint.includes("request_hash");
      const isBusinessDuplicate = (error as any)?.code === "23505" && duplicateConstraint.includes("business_key");
      if (isRequestDuplicate || isBusinessDuplicate) {
        return res.status(409).json({
          message: isBusinessDuplicate
            ? "One or more carrier ticket/load combinations have already been invoiced."
            : "This exact bulk invoice batch was already submitted.",
          alerts: [],
        });
      }
      if ((error as any)?.code === "23505") {
        return res.status(409).json({ message: "One or more invoices already exist for the carrier/load combination.", alerts: [] });
      }
      console.error("Error creating bulk invoice batch:", error);
      const message = isBusinessDuplicate
        ? "One or more carrier ticket/load combinations have already been invoiced."
        : isRequestDuplicate
          ? "This exact bulk invoice batch was already submitted."
          : (error as any)?.code === "23505"
            ? "An invoice number collision occurred. Please retry."
            : "Failed to create batch";
      res.status(500).json({ message });
    }
  });

  app.get("/api/bulk-invoices/:id/pdf", requireModulePermission("bulk_invoices"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid batch ID" });
      const [row] = await db.select({
        batch: bulkInvoiceBatches,
        brokerName: brokers.name,
      }).from(bulkInvoiceBatches)
        .leftJoin(brokers, eq(bulkInvoiceBatches.brokerId, brokers.id))
        .where(bulkBatchAccessCondition(req, id))
        .limit(1);
      if (!row) return res.status(404).json({ message: "Batch not found" });
      const items = await db.select({
        carrierName: clients.name,
        ticketNumber: bulkInvoiceItems.ticketNumber,
        loadNumber: bulkInvoiceItems.loadNumber,
        invoiceNumber: bulkInvoiceItems.invoiceNumber,
        rate: bulkInvoiceItems.rate,
        legacyAmount: bulkInvoiceItems.amount,
        createdAt: invoices.createdAt,
      }).from(bulkInvoiceItems)
        .leftJoin(clients, eq(bulkInvoiceItems.carrierId, clients.id))
        .leftJoin(invoices, eq(bulkInvoiceItems.invoiceId, invoices.id))
        .where(eq(bulkInvoiceItems.batchId, id));

      const doc = new PDFDocument({ size: "LETTER", margin: 42, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on("data", chunk => chunks.push(chunk));
      doc.on("end", () => {
        const pdf = Buffer.concat(chunks);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="bulk-invoice-batch-${id}.pdf"`);
        res.setHeader("Content-Length", String(pdf.length));
        res.send(pdf);
      });

      const logoCandidates = [
        path.resolve(process.cwd(), "server/assets/tpf-logo.png"),
        path.resolve(process.cwd(), "dist/tpf-logo.png"),
      ];
      const logoPath = logoCandidates.find(candidate => fs.existsSync(candidate));
      if (logoPath) doc.image(logoPath, 370, 42, { fit: [180, 58], align: "right" });
      else doc.font("Helvetica-Bold").fontSize(16).fillColor("#087d8d").text("TPF", 440, 50, { width: 110, align: "right" });

      doc.fillColor("#203a46").font("Helvetica-Bold").fontSize(12).text(`For: ${row.brokerName || "Not recorded"}`, 42, 45, { width: 315 });
      doc.font("Helvetica").fontSize(9)
        .text(`Report Dates: ${formatBulkPdfDate(row.batch.reportDateStart)} to ${formatBulkPdfDate(row.batch.reportDateEnd)}`)
        .text(`Today's Date: ${formatBulkPdfDate(new Date())}`)
        .text(`Invoice Count: ${row.batch.invoiceCount}`)
        .text(`Total Rate: $${Number(row.batch.totalRate || row.batch.totalAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      doc.moveTo(42, 118).lineTo(570, 118).strokeColor("#087d8d").lineWidth(1.5).stroke();

      const columns = [
        { label: "Carrier", x: 42, width: 128 },
        { label: "Load/Ticket#", x: 170, width: 120 },
        { label: "Invoice#", x: 290, width: 92 },
        { label: "Total Rate$", x: 382, width: 90 },
        { label: "Created on", x: 472, width: 98 },
      ];
      let y = 132;
      const drawTableHeader = () => {
        doc.rect(42, y, 528, 22).fill("#087d8d");
        doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
        columns.forEach(column => doc.text(column.label, column.x + 5, y + 7, { width: column.width - 10 }));
        y += 22;
      };
      const ensureRoom = (height: number) => {
        if (y + height <= 660) return;
        doc.addPage();
        y = 46;
        drawTableHeader();
      };
      drawTableHeader();
      const sortedItems = [...items].sort((a, b) => (a.carrierName || "").localeCompare(b.carrierName || ""));
      let currentCarrier = "";
      for (const item of sortedItems) {
        const carrierName = item.carrierName || "Carrier not recorded";
        if (carrierName !== currentCarrier) {
          ensureRoom(43);
          doc.rect(42, y, 528, 19).fill("#e3eff0");
          doc.fillColor("#203a46").font("Helvetica-Bold").fontSize(8).text(carrierName, 47, y + 6, { width: 518, lineBreak: false, ellipsis: true });
          y += 19;
          currentCarrier = carrierName;
        }
        ensureRoom(24);
        doc.rect(42, y, 528, 24).fill(y % 2 === 0 ? "#f7f9f8" : "#ffffff");
        doc.fillColor("#334b54").font("Helvetica").fontSize(8);
        const values = [
          carrierName,
          [item.loadNumber, item.ticketNumber].filter(Boolean).join(" / "),
          item.invoiceNumber,
          `$${Number(item.rate || item.legacyAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          formatBulkPdfDate(item.createdAt || row.batch.createdAt),
        ];
        columns.forEach((column, index) => doc.text(values[index] || "—", column.x + 5, y + 8, { width: column.width - 10, lineBreak: false, ellipsis: true }));
        doc.moveTo(42, y + 24).lineTo(570, y + 24).strokeColor("#d6dfe1").lineWidth(0.4).stroke();
        y += 24;
      }

      const pageRange = doc.bufferedPageRange();
      for (let pageIndex = 0; pageIndex < pageRange.count; pageIndex += 1) {
        doc.switchToPage(pageIndex);
        doc.moveTo(42, 680).lineTo(570, 680).strokeColor("#a9b6ba").lineWidth(0.5).stroke();
        doc.fillColor("#52666d").font("Helvetica-Bold").fontSize(8).text("Trucking Pros Financial LLC", 42, 689, { width: 260 });
        doc.font("Helvetica").fontSize(7).text("204 E. 900 S. · Salt Lake City, UT 84111 · 801-755-9755", 302, 689, { width: 268, align: "right" });
      }
      doc.end();
    } catch (error) {
      console.error("Error generating bulk invoice PDF:", error);
      if (!res.headersSent) res.status(500).json({ message: "Failed to generate batch PDF" });
    }
  });

  // ─── Payroll ───────────────────────────────────────────────────────────────
  app.get("/api/payroll", requireAuth, async (req, res) => {
    try {
      const { employeeId, status, dateFrom, dateTo } = req.query;
      const conditions: any[] = [];
      if (employeeId) conditions.push(eq(payrollEntries.employeeId, employeeId as string));
      if (status && status !== "all") conditions.push(eq(payrollEntries.status, status as any));
      if (dateFrom) conditions.push(sql`${payrollEntries.payPeriodStart} >= ${new Date(dateFrom as string)}`);
      if (dateTo) conditions.push(sql`${payrollEntries.payPeriodEnd} <= ${new Date(dateTo as string)}`);
      const rows = conditions.length
        ? await db.select().from(payrollEntries).where(and(...conditions)).orderBy(desc(payrollEntries.payPeriodStart))
        : await db.select().from(payrollEntries).orderBy(desc(payrollEntries.payPeriodStart));
      res.json(rows);
    } catch (error) {
      console.error("Error fetching payroll:", error);
      res.status(500).json({ message: "Failed to fetch payroll" });
    }
  });

  app.get("/api/payroll/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.id, id)).limit(1);
      if (!entry) return res.status(404).json({ message: "Payroll entry not found" });
      const deductions = await db.select().from(payrollDeductions).where(eq(payrollDeductions.payrollEntryId, id));
      res.json({ ...entry, deductions });
    } catch (error) {
      console.error("Error fetching payroll entry:", error);
      res.status(500).json({ message: "Failed to fetch payroll entry" });
    }
  });

  app.post("/api/payroll", requireAuth, async (req: any, res) => {
    try {
      console.log("[POST /api/payroll] req.body:", JSON.stringify(req.body, null, 2));
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const { deductionItems, deductionsTotal, payPeriodStart, payPeriodEnd, ...rest } = req.body;
      const data = insertPayrollEntrySchema.parse({
        ...rest,
        deductions: deductionsTotal ?? "0",
        payPeriodStart: new Date(payPeriodStart),
        payPeriodEnd: new Date(payPeriodEnd),
        createdBy: userId,
      });
      const [entry] = await db.insert(payrollEntries).values(data).returning();
      const deductionList = Array.isArray(deductionItems) ? deductionItems : [];
      if (deductionList.length > 0) {
        const rows = deductionList.map((d: any) => insertPayrollDeductionSchema.parse({
          deductionType: d.deductionType,
          amount: String(d.amount),
          description: d.description ?? null,
          payrollEntryId: entry.id,
        }));
        await db.insert(payrollDeductions).values(rows);
      }
      const deductions = await db.select().from(payrollDeductions).where(eq(payrollDeductions.payrollEntryId, entry.id));
      res.status(201).json({ ...entry, deductions });
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("[POST /api/payroll] Zod validation error:", JSON.stringify(error.errors, null, 2));
        return res.status(400).json({ message: error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "), errors: error.errors });
      }
      console.error("[POST /api/payroll] Error creating payroll entry:", error);
      res.status(500).json({ message: "Failed to create payroll entry" });
    }
  });

  app.patch("/api/payroll/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [existing] = await db.select().from(payrollEntries).where(eq(payrollEntries.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Payroll entry not found" });
      const { status, deductionItems, deductionsTotal, payPeriodStart, payPeriodEnd, ...rest } = req.body;
      const userRole = req.user?.role;
      if ((status === "approved" || status === "paid") && userRole !== "admin" && userRole !== "manager") {
        return res.status(403).json({ message: "Only managers/admins can approve or mark paid" });
      }
      if (existing.status !== "draft" && !["approved", "paid"].includes(status ?? "")) {
        return res.status(400).json({ message: "Only draft entries can be edited" });
      }
      const updates: any = {};
      if (rest.employeeId) updates.employeeId = rest.employeeId;
      if (rest.regularHours !== undefined) updates.regularHours = String(rest.regularHours);
      if (rest.overtimeHours !== undefined) updates.overtimeHours = String(rest.overtimeHours);
      if (rest.hourlyRate !== undefined) updates.hourlyRate = String(rest.hourlyRate);
      if (rest.grossPay !== undefined) updates.grossPay = String(rest.grossPay);
      if (rest.netPay !== undefined) updates.netPay = String(rest.netPay);
      if (rest.notes !== undefined) updates.notes = rest.notes;
      if (deductionsTotal !== undefined) updates.deductions = String(deductionsTotal);
      if (status) updates.status = status;
      if (status === "paid" && !existing.paidAt) updates.paidAt = new Date();
      if (payPeriodStart) updates.payPeriodStart = new Date(payPeriodStart);
      if (payPeriodEnd) updates.payPeriodEnd = new Date(payPeriodEnd);
      const [entry] = await db.update(payrollEntries).set(updates).where(eq(payrollEntries.id, id)).returning();
      if (Array.isArray(deductionItems)) {
        await db.delete(payrollDeductions).where(eq(payrollDeductions.payrollEntryId, id));
        if (deductionItems.length > 0) {
          const rows = deductionItems.map((d: any) => insertPayrollDeductionSchema.parse({
            deductionType: d.deductionType,
            amount: String(d.amount),
            description: d.description ?? null,
            payrollEntryId: id,
          }));
          await db.insert(payrollDeductions).values(rows);
        }
      }
      const deductions = await db.select().from(payrollDeductions).where(eq(payrollDeductions.payrollEntryId, id));
      res.json({ ...entry, deductions });
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("[PATCH /api/payroll] Zod error:", JSON.stringify(error.errors, null, 2));
        return res.status(400).json({ message: error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "), errors: error.errors });
      }
      console.error("Error updating payroll entry:", error);
      res.status(500).json({ message: "Failed to update payroll entry" });
    }
  });

  app.delete("/api/payroll/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [existing] = await db.select().from(payrollEntries).where(eq(payrollEntries.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Payroll entry not found" });
      if (existing.status !== "draft") return res.status(400).json({ message: "Only draft entries can be deleted" });
      await db.delete(payrollDeductions).where(eq(payrollDeductions.payrollEntryId, id));
      await db.delete(payrollEntries).where(eq(payrollEntries.id, id));
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error("Error deleting payroll entry:", error);
      res.status(500).json({ message: "Failed to delete payroll entry" });
    }
  });

  // ─── Bank Transfers ────────────────────────────────────────────────────────
  app.get("/api/bank-transfers", requireAuth, async (req, res) => {
    try {
      const { carrierId, status, transferType, dateFrom, dateTo } = req.query;
      const conditions: any[] = [];
      if (carrierId) conditions.push(eq(bankTransfers.carrierId, parseInt(carrierId as string, 10)));
      if (status && status !== "all") conditions.push(eq(bankTransfers.status, status as any));
      if (transferType && transferType !== "all") conditions.push(eq(bankTransfers.transferType, transferType as any));
      if (dateFrom) conditions.push(sql`${bankTransfers.transferDate} >= ${new Date(dateFrom as string)}`);
      if (dateTo) conditions.push(sql`${bankTransfers.transferDate} <= ${new Date(dateTo as string)}`);
      const rows = conditions.length
        ? await db.select().from(bankTransfers).where(and(...conditions)).orderBy(desc(bankTransfers.createdAt))
        : await db.select().from(bankTransfers).orderBy(desc(bankTransfers.createdAt));
      // Mask account number — never send raw encrypted blob to client
      const masked = rows.map((r) => ({ ...r, accountNumberEncrypted: r.accountNumberEncrypted ? "••••" : null }));
      res.json(masked);
    } catch (error) {
      console.error("Error fetching bank transfers:", error);
      res.status(500).json({ message: "Failed to fetch bank transfers" });
    }
  });

  app.get("/api/bank-transfers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [row] = await db.select().from(bankTransfers).where(eq(bankTransfers.id, id)).limit(1);
      if (!row) return res.status(404).json({ message: "Transfer not found" });
      // Decrypt account number for single-record view (authorized users only)
      let accountNumberLast4: string | null = null;
      if (row.accountNumberEncrypted) {
        try {
          const decrypted = decryptVault(row.accountNumberEncrypted);
          accountNumberLast4 = "••••" + decrypted.slice(-4);
        } catch { accountNumberLast4 = "••••"; }
      }
      res.json({ ...row, accountNumberEncrypted: undefined, accountNumberLast4 });
    } catch (error) {
      console.error("Error fetching bank transfer:", error);
      res.status(500).json({ message: "Failed to fetch transfer" });
    }
  });

  app.post("/api/bank-transfers", requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const { accountNumber, transferDate, ...rest } = req.body;
      const accountNumberEncrypted = accountNumber ? encryptVault(String(accountNumber)) : null;
      const data = insertBankTransferSchema.parse({
        ...rest,
        accountNumberEncrypted,
        transferDate: transferDate ? new Date(transferDate) : null,
        createdBy: userId,
      });
      const [row] = await db.insert(bankTransfers).values(data).returning();
      res.status(201).json({ ...row, accountNumberEncrypted: undefined });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid data", errors: error.errors });
      console.error("Error creating bank transfer:", error);
      res.status(500).json({ message: "Failed to create transfer" });
    }
  });

  app.patch("/api/bank-transfers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { status, accountNumber, transferDate, confirmedAt, ...rest } = req.body;
      const updates: Record<string, any> = { ...rest };
      if (status) updates.status = status;
      if (accountNumber) updates.accountNumberEncrypted = encryptVault(String(accountNumber));
      if (transferDate) updates.transferDate = new Date(transferDate);
      if (status === "completed" && !confirmedAt) updates.confirmedAt = new Date();
      if (confirmedAt) updates.confirmedAt = new Date(confirmedAt);
      const [row] = await db.update(bankTransfers).set(updates).where(eq(bankTransfers.id, id)).returning();
      if (!row) return res.status(404).json({ message: "Transfer not found" });
      res.json({ ...row, accountNumberEncrypted: undefined });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid data", errors: error.errors });
      console.error("Error updating bank transfer:", error);
      res.status(500).json({ message: "Failed to update transfer" });
    }
  });

  // ─── Trucks ────────────────────────────────────────────────────────────────
  app.get("/api/trucks", requireAuth, async (req, res) => {
    try {
      const { carrierId, dispatcherId, status } = req.query;
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const conditions: any[] = [];
      if (carrierId) conditions.push(eq(trucks.carrierId, parseInt(carrierId as string, 10)));
      if (dispatcherId) conditions.push(eq(trucks.dispatcherId, parseInt(dispatcherId as string, 10)));
      if (status && status !== "all") conditions.push(eq(trucks.status, status as any));
      if (q) conditions.push(or(
        ilike(trucks.truckNumber, `%${q}%`), ilike(trucks.vin, `%${q}%`),
        ilike(trucks.make, `%${q}%`), ilike(trucks.model, `%${q}%`),
        ilike(trucks.licensePlate, `%${q}%`), ilike(trucks.state, `%${q}%`),
        ilike(trucks.notes, `%${q}%`),
      ));
      const carrierScope = await assignedCarrierScope(req, trucks.carrierId);
      if (carrierScope) conditions.push(carrierScope);
      const where = conditions.length ? and(...conditions) : undefined;
      if (req.query.all === "true") return res.json(await db.select().from(trucks).where(where).orderBy(trucks.truckNumber));
      const { page, limit, offset } = parseListPagination(req);
      const [{ total }] = await db.select({ total: count() }).from(trucks).where(where);
      const rows = await db.select().from(trucks).where(where).orderBy(trucks.truckNumber).limit(limit).offset(offset);
      res.json({ data: rows, total: Number(total), page, totalPages: Math.ceil(Number(total) / limit) });
    } catch (error) {
      console.error("Error fetching trucks:", error);
      res.status(500).json({ message: "Failed to fetch trucks" });
    }
  });

  app.get("/api/trucks/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [row] = await db.select().from(trucks).where(eq(trucks.id, id)).limit(1);
      if (!row) return res.status(404).json({ message: "Truck not found" });
      if (!(await canAccessClient(req, row.carrierId))) return res.status(403).json({ message: "You can only access trucks for carriers assigned to you" });
      res.json(row);
    } catch (error) {
      console.error("Error fetching truck:", error);
      res.status(500).json({ message: "Failed to fetch truck" });
    }
  });

  app.post("/api/trucks", requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const data = insertTruckSchema.parse({ ...req.body, createdBy: userId });
      if (!(await canAccessClient(req, data.carrierId))) return res.status(403).json({ message: "You can only create trucks for carriers assigned to you" });
      const [row] = await db.insert(trucks).values(data).returning();
      res.status(201).json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid data", errors: error.errors });
      console.error("Error creating truck:", error);
      res.status(500).json({ message: "Failed to create truck" });
    }
  });

  app.patch("/api/trucks/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [existing] = await db.select({ carrierId: trucks.carrierId }).from(trucks).where(eq(trucks.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Truck not found" });
      if (!(await canAccessClient(req, existing.carrierId))) return res.status(403).json({ message: "You can only edit trucks for carriers assigned to you" });
      const data = insertTruckSchema.partial().parse(req.body);
      if (data.carrierId != null && !(await canAccessClient(req, data.carrierId))) return res.status(403).json({ message: "You can only move trucks to carriers assigned to you" });
      const [row] = await db.update(trucks).set(data).where(eq(trucks.id, id)).returning();
      if (!row) return res.status(404).json({ message: "Truck not found" });
      res.json(row);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid data", errors: error.errors });
      console.error("Error updating truck:", error);
      res.status(500).json({ message: "Failed to update truck" });
    }
  });

  app.delete("/api/trucks/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [existing] = await db.select({ carrierId: trucks.carrierId }).from(trucks).where(eq(trucks.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Truck not found" });
      if (!(await canAccessClient(req, existing.carrierId))) return res.status(403).json({ message: "You can only delete trucks for carriers assigned to you" });
      const [row] = await db.delete(trucks).where(eq(trucks.id, id)).returning();
      if (!row) return res.status(404).json({ message: "Truck not found" });
      res.json(row);
    } catch (error) {
      console.error("Error deleting truck:", error);
      res.status(500).json({ message: "Failed to delete truck" });
    }
  });

  // ─── Carrier Drivers ───────────────────────────────────────────────────────
  const driverPayloadSchema = z.object({
    carrierId: z.coerce.number().int().positive(),
    firstName: z.string().trim().min(1, "First name is required"),
    lastName: z.string().trim().min(1, "Last name is required"),
    phone: z.string().trim().max(50).optional().nullable(),
    email: z.union([z.string().trim().email(), z.literal("")]).optional().nullable(),
    licenseNumber: z.string().trim().max(100).optional().nullable(),
    licenseState: z.string().trim().max(2).optional().nullable(),
    licenseExpiration: z.union([z.string().trim(), z.literal("")]).optional().nullable(),
    status: z.enum(["active", "inactive"]).default("active"),
  });

  const serializeDriver = async (driver: typeof drivers.$inferSelect, canViewLicense: boolean) => ({
    ...driver,
    licenseNumber: canViewLicense ? driver.licenseNumber : null,
    licenseState: canViewLicense ? driver.licenseState : null,
    licenseExpiration: canViewLicense ? driver.licenseExpiration : null,
    photoUrl: driver.photoS3Key ? await getSignedViewUrl(driver.photoS3Key) : null,
    photoS3Key: undefined,
  });

  app.get("/api/drivers", requireAuth, async (req: any, res) => {
    try {
      const carrierId = Number(req.query.carrierId);
      if (!Number.isInteger(carrierId) || carrierId <= 0) {
        return res.status(400).json({ message: "A valid carrierId is required" });
      }
      const rows = await db.select().from(drivers)
        .where(eq(drivers.carrierId, carrierId))
        .orderBy(desc(drivers.status), drivers.lastName, drivers.firstName);
      const canViewLicense = req.user.role === "manager" || req.user.role === "admin";
      res.json(await Promise.all(rows.map((row) => serializeDriver(row, canViewLicense))));
    } catch (error) {
      console.error("Error fetching carrier drivers:", error);
      res.status(500).json({ message: "Failed to fetch drivers" });
    }
  });

  app.post("/api/drivers", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const parsed = driverPayloadSchema.parse(req.body);
      const [carrier] = await db.select({ id: clients.id }).from(clients)
        .where(eq(clients.id, parsed.carrierId)).limit(1);
      if (!carrier) return res.status(404).json({ message: "Carrier not found" });
      const [row] = await db.insert(drivers).values({
        ...parsed,
        phone: parsed.phone || null,
        email: parsed.email || null,
        licenseNumber: parsed.licenseNumber || null,
        licenseState: parsed.licenseState?.toUpperCase() || null,
        licenseExpiration: parsed.licenseExpiration ? new Date(`${parsed.licenseExpiration}T12:00:00Z`) : null,
        createdBy: req.user.id,
      }).returning();
      res.status(201).json(await serializeDriver(row, true));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid driver data", errors: error.errors });
      console.error("Error creating driver:", error);
      res.status(500).json({ message: "Failed to create driver" });
    }
  });

  app.patch("/api/drivers/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid driver id" });
      const parsed = driverPayloadSchema.partial().omit({ carrierId: true }).parse(req.body);
      const [row] = await db.update(drivers).set({
        ...parsed,
        phone: parsed.phone === undefined ? undefined : parsed.phone || null,
        email: parsed.email === undefined ? undefined : parsed.email || null,
        licenseNumber: parsed.licenseNumber === undefined ? undefined : parsed.licenseNumber || null,
        licenseState: parsed.licenseState === undefined ? undefined : parsed.licenseState?.toUpperCase() || null,
        licenseExpiration: parsed.licenseExpiration === undefined
          ? undefined
          : parsed.licenseExpiration ? new Date(`${parsed.licenseExpiration}T12:00:00Z`) : null,
        updatedAt: new Date(),
      }).where(eq(drivers.id, id)).returning();
      if (!row) return res.status(404).json({ message: "Driver not found" });
      res.json(await serializeDriver(row, true));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid driver data", errors: error.errors });
      console.error("Error updating driver:", error);
      res.status(500).json({ message: "Failed to update driver" });
    }
  });

  app.post("/api/drivers/:id/photo", requireManagerOrAdmin, handleUpload("photo"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid driver id" });
      if (!req.file) return res.status(400).json({ message: "No photo uploaded" });
      if (!["image/jpeg", "image/png"].includes(req.file.mimetype) || req.file.size > 5 * 1024 * 1024) {
        return res.status(400).json({ message: "Driver photo must be a JPEG or PNG no larger than 5MB" });
      }
      const bytes = req.file.buffer;
      const validJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const validPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      if (!validJpeg && !validPng) return res.status(400).json({ message: "Photo contents are not a valid JPEG or PNG" });
      const [existing] = await db.select().from(drivers).where(eq(drivers.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Driver not found" });
      const s3Key = await uploadToS3(req.file.buffer, `drivers/${id}/${crypto.randomUUID()}`, req.file.mimetype);
      let updated: typeof drivers.$inferSelect;
      try {
        [updated] = await db.update(drivers).set({ photoS3Key: s3Key, updatedAt: new Date() })
          .where(eq(drivers.id, id)).returning();
      } catch (error) {
        await deleteFromS3(s3Key);
        throw error;
      }
      if (existing.photoS3Key) await deleteFromS3(existing.photoS3Key).catch((error) => console.warn("Could not remove previous driver photo:", error));
      res.json(await serializeDriver(updated, true));
    } catch (error) {
      console.error("Error uploading driver photo:", error);
      res.status(500).json({ message: "Failed to upload driver photo" });
    }
  });

  app.delete("/api/drivers/:id", requireManagerOrAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid driver id" });
      const [existing] = await db.select().from(drivers).where(eq(drivers.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Driver not found" });
      const [row] = await db.delete(drivers).where(eq(drivers.id, id)).returning();
      if (!row) return res.status(404).json({ message: "Driver not found" });
      if (existing.photoS3Key) {
        await deleteFromS3(existing.photoS3Key).catch((error) => console.warn("Could not remove deleted driver photo:", error));
      }
      res.json({ message: "Driver removed" });
    } catch (error) {
      console.error("Error removing driver:", error);
      res.status(500).json({ message: "Failed to remove driver" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CARRIER PORTAL ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  const portalUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: DOCUMENT_UPLOAD_LIMIT },
    fileFilter: (_req, file, cb) => {
      if (path.extname(file.originalname).toLowerCase() === ".pdf" && file.mimetype === "application/pdf") {
        return cb(null, true);
      }
      cb(new Error("Only PDF files up to 135MB are allowed"));
    },
  });
  const portalChatUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const allowed = (extension === ".pdf" && file.mimetype.toLowerCase() === "application/pdf")
        || ([".jpg", ".jpeg"].includes(extension) && file.mimetype.toLowerCase() === "image/jpeg")
        || (extension === ".png" && file.mimetype.toLowerCase() === "image/png");
      if (allowed) return cb(null, true);
      cb(new Error("Attachments must be a PDF, JPEG, or PNG"));
    },
  });

  const requirePortalAuth = async (req: any, res: any, next: any) => {
    const sessionUser = (req.session as any)?.portalUser;
    if (!sessionUser) return res.status(401).json({ message: "Portal authentication required" });
    try {
      const [portalUser] = await db.select().from(carrierPortalUsers)
        .where(eq(carrierPortalUsers.id, sessionUser.id)).limit(1);
      if (!portalUser || portalUser.status !== "active") {
        delete (req.session as any).portalUser;
        return res.status(403).json({ message: portalUser?.status === "pending" ? "Your account is pending approval." : "An active carrier portal account is required." });
      }
      const safeUser = {
        id: portalUser.id,
        email: portalUser.email,
        companyName: portalUser.companyName,
        status: portalUser.status,
      };
      (req.session as any).portalUser = safeUser;
      req.portalUser = safeUser;
      next();
    } catch (error) {
      console.error("Portal authorization error:", error);
      res.status(500).json({ message: "Unable to verify portal access" });
    }
  };

  // Submission documents may be reached from a public portal URL, but the
  // document itself must belong to the submission in the URL. Internal users
  // use the normal audited portal_submissions permission gate instead.
  const requirePortalDocumentAccess = async (req: any, res: any, next: any) => {
    if ((req.session as any)?.portalUser) {
      return requirePortalAuth(req, res, async () => {
        const submissionId = Number(req.params.id);
        const [submission] = await db.select({ id: carrierSubmissions.id })
          .from(carrierSubmissions)
          .where(and(
            eq(carrierSubmissions.id, submissionId),
            eq(carrierSubmissions.portalUserId, req.portalUser.id),
          )).limit(1);
        if (!submission) return res.status(404).json({ message: "Submission not found" });
        next();
      });
    }
    return requireAnyPermission(["portal_submissions"])(req, res, next);
  };

  const userCanUseCarrierChat = async (user: any) => {
    if (!user || !["employee", "manager", "admin"].includes(user.role)) return false;
    if (user.role === "admin") return true;
    const stored = await storage.getUserPermissions(user.id);
    const permissions = stored.length ? stored : (ROLE_DEFAULT_PERMISSIONS[user.role] ?? ROLE_DEFAULT_PERMISSIONS.employee);
    return (permissions as readonly string[]).includes("chat")
      || (permissions as readonly string[]).includes("portal_submissions");
  };

  const requireChatAgent = requireAnyPermission(["chat", "portal_submissions"]);

  // ── Portal Auth ────────────────────────────────────────────────────────────
  app.post("/api/portal/register", async (req, res) => {
    try {
      const parsed = z.object({
        email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
        password: z.string().min(8).max(200),
        companyName: z.string().trim().min(2).max(255),
        mcNumber: z.string().trim().max(50).optional(),
        dotNumber: z.string().trim().max(50).optional(),
        phone: z.string().trim().max(50).optional(),
      }).safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Enter a valid company name, email, and password of at least 8 characters" });
      const { email, password, companyName, mcNumber, dotNumber, phone } = parsed.data;
      const passwordHash = await bcrypt.hash(password, 10);
      const { user } = await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(carrierPortalUsers)
          .where(eq(carrierPortalUsers.email, email)).limit(1);
        if (existing) throw Object.assign(new Error("An account with this email already exists"), { status: 409 });

        const [created] = await tx.insert(carrierPortalUsers).values({
          email,
          passwordHash,
          companyName,
          mcNumber: mcNumber || null,
          dotNumber: dotNumber || null,
          phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
          status: "pending",
        }).returning();
        const internalUsers = await tx.select({ id: users.id }).from(users).where(and(
          eq(users.status, "active"),
          or(eq(users.role, "employee"), eq(users.role, "manager"), eq(users.role, "admin")),
        ));
        if (internalUsers.length) {
          await tx.insert(notifications).values(internalUsers.map((internalUser) => ({
            userId: internalUser.id,
            title: "New carrier registration",
            message: `New carrier registration: ${companyName} is pending approval`,
            type: "info" as const,
            entityType: "carrier_portal_user",
            entityId: created.id,
            actionUrl: "/portal-submissions",
          })));
        }
        return { user: created };
      });

      // Send registration confirmation to carrier
      const regHtml = `
        <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;">
          <div style="background:#1e40af;color:#fff;border-radius:12px 12px 0 0;padding:20px 24px;">
            <h2 style="margin:0;">Carrier Portal — Registration Received</h2>
            <p style="margin:4px 0 0;opacity:.8;font-size:13px;">Trucking Pros Financial</p>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
            <p style="color:#374151;">Hi ${escapeHtml(companyName)},</p>
            <p style="color:#374151;">Thank you for registering on the Trucking Pros Financial carrier portal. Your account is <strong>pending approval</strong>.</p>
            <p style="color:#374151;">Our team will review your information and notify you once your account has been approved. This typically takes 1–2 business days.</p>
            <p style="color:#374151;">If you have questions, reply to this email or call us at <strong>385-495-4962</strong>.</p>
            <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;" />
            <p style="color:#9ca3af;font-size:12px;margin:0;">Trucking Pros Financial · Support@Truckingprosfinancial.com · 385-495-4962</p>
          </div>
        </div>`;
      sendEmail({
        to: user.email,
        subject: "Carrier Portal — Registration Received (Pending Approval)",
        html: regHtml,
        text: `Hi ${companyName},\n\nThank you for registering. Your account is pending approval. We will notify you once approved.\n\nTrucking Pros Financial\nSupport@Truckingprosfinancial.com`,
      }).catch(() => {});

      res.status(201).json({ message: "Registration successful. Pending approval.", id: user.id });
    } catch (error: any) {
      if (error?.status === 409 || error?.code === "23505") {
        return res.status(409).json({ message: "An account with this email already exists" });
      }
      console.error("Portal register error:", error);
      res.status(500).json({ message: "Registration failed" });
    }
  });

  app.post("/api/portal/login", async (req: any, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ message: "Email and password required" });
      const [user] = await db.select().from(carrierPortalUsers).where(eq(carrierPortalUsers.email, email.toLowerCase())).limit(1);
      if (!user) return res.status(401).json({ message: "Invalid email or password" });
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return res.status(401).json({ message: "Invalid email or password" });
      if (user.status === "pending") return res.status(403).json({ message: "Your account is pending approval." });
      if (user.status === "rejected") return res.status(403).json({ message: "Your registration was rejected. Please contact TPF." });
      if (user.status === "suspended") return res.status(403).json({ message: "Your account has been suspended. Please contact TPF." });
      await db.update(carrierPortalUsers).set({ lastLoginAt: new Date() }).where(eq(carrierPortalUsers.id, user.id));
      (req.session as any).portalUser = { id: user.id, email: user.email, companyName: user.companyName, status: user.status };
      res.json({ id: user.id, email: user.email, companyName: user.companyName, status: user.status });
    } catch (error) {
      console.error("Portal login error:", error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/portal/logout", (req: any, res) => {
    delete (req.session as any).portalUser;
    res.json({ message: "Logged out" });
  });

  app.get("/api/portal/me", requirePortalAuth, async (req: any, res) => {
    try {
      const [user] = await db.select().from(carrierPortalUsers).where(eq(carrierPortalUsers.id, req.portalUser.id)).limit(1);
      if (!user) return res.status(404).json({ message: "User not found" });
      const [carrier] = user.carrierId
        ? await db.select({ id: clients.id, cargoType: clients.cargoType }).from(clients).where(eq(clients.id, user.carrierId)).limit(1)
        : [];
      res.json({
        id: user.id, email: user.email, companyName: user.companyName,
        mcNumber: user.mcNumber, dotNumber: user.dotNumber, status: user.status,
        carrierId: user.carrierId, cargoType: carrier?.cargoType ?? null,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  // ── Carrier/Agent Chat ──────────────────────────────────────────────────────
  const getActivePortalChatUser = async (portalUserId: number) => {
    const [portalUser] = await db.select().from(carrierPortalUsers)
      .where(and(eq(carrierPortalUsers.id, portalUserId), eq(carrierPortalUsers.status, "active"))).limit(1);
    if (!portalUser?.carrierId) return null;
    const [carrier] = await db.select({ id: clients.id, name: clients.name })
      .from(clients).where(eq(clients.id, portalUser.carrierId)).limit(1);
    if (!carrier) return null;
    return { portalUser, carrier };
  };

  const chatSummary = (chat: any, carrierName?: string | null, portalCompanyName?: string | null) => ({
    id: chat.id,
    carrierId: chat.carrierId,
    portalUserId: chat.portalUserId,
    agentId: chat.agentId,
    carrierLastReadAt: chat.carrierLastReadAt,
    agentLastReadAt: chat.agentLastReadAt,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    carrierName: carrierName ?? null,
    portalCompanyName: portalCompanyName ?? null,
  });

  const chatMessageResponse = (message: any) => ({
    id: message.id,
    chatId: message.chatId,
    senderType: message.senderType,
    senderId: message.senderId,
    message: message.message,
    read: message.read,
    createdAt: message.createdAt,
    attachment: message.attachmentS3Key ? {
      name: message.attachmentName,
      mimeType: message.attachmentMimeType,
      size: message.attachmentSize,
      viewUrl: `/api/portal-chat/messages/${message.id}/attachment/view`,
      downloadUrl: `/api/portal-chat/messages/${message.id}/attachment/download`,
    } : null,
  });

  const enrichChatMessages = async (rows: any[], portalCompanyName?: string | null) => {
    const agentIds = Array.from(new Set(rows
      .filter((row) => row.senderType === "agent")
      .map((row) => String(row.senderId))));
    const agents = agentIds.length
      ? await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
      }).from(users).where(inArray(users.id, agentIds))
      : [];
    const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
    return rows.map((row) => {
      const response = chatMessageResponse(row);
      const agent = row.senderType === "agent" ? agentMap.get(String(row.senderId)) : undefined;
      return {
        ...response,
        senderName: row.senderType === "carrier"
          ? portalCompanyName || "Carrier"
          : [agent?.firstName, agent?.lastName].filter(Boolean).join(" ") || "TPF Agent",
        senderAvatar: agent?.profileImageUrl || null,
      };
    });
  };

  const parseChatSince = (raw: unknown) => {
    if (raw === undefined) return undefined;
    if (typeof raw !== "string" || !raw || Number.isNaN(Date.parse(raw))) {
      throw new Error("since must be a valid ISO timestamp");
    }
    return new Date(raw);
  };

  const loadChatMessageRows = async (chatId: number, since?: Date, afterId = 0) => {
    if (since) {
      return db.select().from(portalChatMessages).where(and(
        eq(portalChatMessages.chatId, chatId),
        or(
          gt(portalChatMessages.createdAt, since),
          and(eq(portalChatMessages.createdAt, since), gt(portalChatMessages.id, afterId)),
        ),
      )).orderBy(portalChatMessages.createdAt, portalChatMessages.id).limit(200);
    }
    return db.select().from(portalChatMessages)
      .where(eq(portalChatMessages.chatId, chatId))
      .orderBy(portalChatMessages.createdAt, portalChatMessages.id)
      .limit(200);
  };

  const getPortalChat = async (portalUserId: number, create = true) => {
    const context = await getActivePortalChatUser(portalUserId);
    if (!context) return null;
    let [chat] = await db.select().from(portalChats).where(and(
      eq(portalChats.carrierId, context.carrier.id),
      eq(portalChats.portalUserId, portalUserId),
    )).limit(1);
    if (!chat && create) {
      [chat] = await db.insert(portalChats).values({
        carrierId: context.carrier.id,
        portalUserId,
      }).onConflictDoNothing({
        target: [portalChats.carrierId, portalChats.portalUserId],
      }).returning();
      if (!chat) {
        [chat] = await db.select().from(portalChats).where(and(
          eq(portalChats.carrierId, context.carrier.id),
          eq(portalChats.portalUserId, portalUserId),
        )).limit(1);
      }
    }
    return chat ? { chat, ...context } : null;
  };

  const getAgentChatForCarrier = async (carrierId: number, create = false) => {
    const activePortalUsers = await db.select({ id: carrierPortalUsers.id })
      .from(carrierPortalUsers)
      .where(and(eq(carrierPortalUsers.carrierId, carrierId), eq(carrierPortalUsers.status, "active")))
      .orderBy(desc(carrierPortalUsers.id));
    if (activePortalUsers.length > 1) {
      throw Object.assign(new Error("Multiple active portal accounts are linked to this carrier. Resolve the duplicate accounts before using chat."), { status: 409 });
    }
    const portalUser = activePortalUsers[0];
    if (!portalUser) return null;
    let [chat] = await db.select({ chat: portalChats }).from(portalChats)
      .where(and(eq(portalChats.carrierId, carrierId), eq(portalChats.portalUserId, portalUser.id)))
      .orderBy(desc(portalChats.updatedAt), desc(portalChats.id)).limit(1);
    if (chat || !create) return chat ? { chat: chat.chat } : null;
    let [createdChat] = await db.insert(portalChats).values({ carrierId, portalUserId: portalUser.id })
      .onConflictDoNothing({ target: [portalChats.carrierId, portalChats.portalUserId] }).returning();
    if (!createdChat) {
      [createdChat] = await db.select().from(portalChats).where(and(
        eq(portalChats.carrierId, carrierId), eq(portalChats.portalUserId, portalUser.id),
      )).limit(1);
    }
    return createdChat ? { chat: createdChat } : null;
  };

  // Returns the authenticated chat message only after checking either side's ownership.
  const serveChatAttachment = async (req: any, res: any, mode: "view" | "download") => {
    const messageId = Number(req.params.messageId);
    if (!Number.isInteger(messageId) || messageId <= 0) return res.status(400).json({ message: "Invalid message" });
    const portalUserId = (req.session as any)?.portalUser?.id;
    const internalUser = (req.session as any)?.user;
    const [activePortalUser] = portalUserId
      ? await db.select({ id: carrierPortalUsers.id, carrierId: carrierPortalUsers.carrierId }).from(carrierPortalUsers).where(and(
        eq(carrierPortalUsers.id, portalUserId), eq(carrierPortalUsers.status, "active"),
      )).limit(1)
      : [];
    const [activeAgent] = internalUser
      ? await db.select({ id: users.id }).from(users).where(and(
        eq(users.id, internalUser.id), eq(users.status, "active"),
      )).limit(1)
      : [];
    if (!activePortalUser && !activeAgent) return res.status(401).json({ message: "Authentication required" });
    const isAgent = !!activeAgent && await userCanUseCarrierChat(internalUser);
    if (activeAgent && !isAgent && !activePortalUser) {
      await auditAuthorizationDenial(req, internalUser, "any:chat,portal_submissions");
      return res.status(403).json({ message: DENIED_MESSAGE });
    }

    const [row] = await db.select({
      message: portalChatMessages,
      chat: portalChats,
    }).from(portalChatMessages).innerJoin(portalChats, eq(portalChats.id, portalChatMessages.chatId))
      .where(eq(portalChatMessages.id, messageId)).limit(1);
    if (!row?.message.attachmentS3Key) return res.status(404).json({ message: "Attachment not found" });

    const isPortalOwner = !!activePortalUser
      && row.chat.portalUserId === activePortalUser.id
      && row.chat.carrierId === activePortalUser.carrierId;
    if (!isPortalOwner && !isAgent) {
      if (activeAgent) await auditAuthorizationDenial(req, internalUser, "any:chat,portal_submissions");
      return res.status(403).json({ message: DENIED_MESSAGE });
    }
    const url = mode === "view"
      ? await getSignedViewUrl(row.message.attachmentS3Key)
      : await getSignedDownloadUrl(row.message.attachmentS3Key, row.message.attachmentName || "attachment");
    return res.redirect(url);
  };

  app.get("/api/portal/chat", requirePortalAuth, async (req: any, res) => {
    try {
      const result = await getPortalChat(req.portalUser.id);
      if (!result) return res.status(403).json({ message: "An active, linked portal account is required" });
      const [carrier] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, result.chat.carrierId)).limit(1);
      const [{ total }] = await db.select({ total: count() }).from(portalChatMessages).where(and(
        eq(portalChatMessages.chatId, result.chat.id),
        eq(portalChatMessages.senderType, "agent"),
        eq(portalChatMessages.read, false),
      ));
      const [agent] = result.chat.agentId
        ? await db.select({
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
        }).from(users).where(eq(users.id, result.chat.agentId)).limit(1)
        : [];
      res.json({
        ...chatSummary(result.chat, carrier?.name, result.portalUser.companyName),
        unreadCount: Number(total),
        agent: agent ? {
          name: [agent.firstName, agent.lastName].filter(Boolean).join(" "),
          profileImageUrl: agent.profileImageUrl,
        } : null,
      });
    } catch (error) {
      console.error("Portal chat fetch error:", error);
      res.status(500).json({ message: "Failed to load chat" });
    }
  });

  app.post("/api/portal/chat/messages", requirePortalAuth, (req: any, res, next) => {
    portalChatUpload.single("attachment")(req, res, (err: any) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ message: "Attachment must be 10MB or smaller" });
      res.status(400).json({ message: err.message || "Attachment upload rejected" });
    });
  }, async (req: any, res) => {
    try {
      const result = await getPortalChat(req.portalUser.id);
      if (!result) return res.status(403).json({ message: "An active, linked portal account is required" });
      const file = req.file as Express.Multer.File | undefined;
      const text = typeof req.body.message === "string" ? req.body.message.trim() : "";
      if (!text && !file) return res.status(400).json({ message: "Message or attachment is required" });
      if (text.length > 10000) return res.status(400).json({ message: "Message must be 10,000 characters or fewer" });
      if (file) {
        const bytes = file.buffer;
        const mime = file.mimetype.toLowerCase();
        const validMagic = (mime === "application/pdf" && bytes.subarray(0, 5).toString("ascii") === "%PDF-")
          || (mime === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
          || (mime === "image/png" && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
        if (!validMagic) return res.status(400).json({ message: "Attachment contents do not match its declared type" });
      }
      let attachmentS3Key: string | null = null;
      if (file) {
        attachmentS3Key = await uploadDocumentToS3(file, `portal-chat/${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
      }
      const [created] = await db.insert(portalChatMessages).values({
        chatId: result.chat.id,
        senderType: "carrier",
        senderId: String(result.portalUser.id),
        message: text || null,
        attachmentS3Key,
        attachmentName: file ? sanitizeOriginalName(file.originalname) : null,
        attachmentMimeType: file?.mimetype || null,
        attachmentSize: file?.size || null,
        read: false,
      }).returning();
      await db.update(portalChats).set({ updatedAt: new Date() }).where(eq(portalChats.id, result.chat.id));

      try {
        const agents = await db.select({ id: users.id, role: users.role }).from(users).where(and(
          eq(users.status, "active"), inArray(users.role, ["employee", "manager", "admin"]),
        ));
        const notificationText = `New message from ${result.carrier.name}`;
        const eligibleAgents = [];
        for (const agent of agents) {
          if (await userCanUseCarrierChat(agent)) eligibleAgents.push(agent);
        }
        await Promise.all(eligibleAgents.map((agent) => storage.createNotification({
          userId: agent.id,
          title: notificationText,
          message: notificationText,
          type: "info",
          entityType: "portal_chat",
          entityId: result.chat.id,
          actionUrl: `/portal-submissions?carrierId=${result.chat.carrierId}`,
        })));
      } catch (notificationError) {
        console.error("Carrier chat notification fan-out failed:", notificationError instanceof Error ? notificationError.message : "unknown error");
      }
      res.status(201).json(chatMessageResponse(created));
    } catch (error) {
      console.error("Portal chat message error:", error);
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  app.get("/api/portal/chat/messages", requirePortalAuth, async (req: any, res) => {
    try {
      const result = await getPortalChat(req.portalUser.id);
      if (!result) return res.status(403).json({ message: "An active, linked portal account is required" });
      let since: Date | undefined;
      try { since = parseChatSince(req.query.since); } catch (error) { return res.status(400).json({ message: (error as Error).message }); }
      const afterId = Number(req.query.afterId || 0);
      if (!Number.isInteger(afterId) || afterId < 0) return res.status(400).json({ message: "afterId must be a non-negative integer" });
      const rows = await loadChatMessageRows(result.chat.id, since, afterId);
      const [{ unreadAgents }] = await db.select({ unreadAgents: count() }).from(portalChatMessages).where(and(
        eq(portalChatMessages.chatId, result.chat.id),
        eq(portalChatMessages.senderType, "agent"),
        eq(portalChatMessages.read, false),
      ));
      if (Number(unreadAgents) > 0) {
        await db.update(portalChatMessages).set({ read: true }).where(and(
          eq(portalChatMessages.chatId, result.chat.id),
          eq(portalChatMessages.senderType, "agent"),
          eq(portalChatMessages.read, false),
        ));
        await db.update(portalChats).set({ carrierLastReadAt: new Date() }).where(eq(portalChats.id, result.chat.id));
      }
      res.json(await enrichChatMessages(rows, result.portalUser.companyName));
    } catch (error) {
      console.error("Portal chat messages fetch error:", error);
      if ((error as any)?.status) return res.status((error as any).status).json({ message: (error as Error).message });
      res.status(500).json({ message: "Failed to load messages" });
    }
  });

  app.get("/api/carrier-chat/unread-count", requireChatAgent, async (_req: any, res) => {
    try {
      const [{ total }] = await db.select({ total: count() }).from(portalChatMessages)
        .innerJoin(portalChats, eq(portalChats.id, portalChatMessages.chatId))
        .innerJoin(carrierPortalUsers, and(
          eq(carrierPortalUsers.id, portalChats.portalUserId),
          eq(carrierPortalUsers.carrierId, portalChats.carrierId),
          eq(carrierPortalUsers.status, "active"),
        ))
        .where(and(eq(portalChatMessages.senderType, "carrier"), eq(portalChatMessages.read, false)));
      res.json({ count: Number(total) });
    } catch (error) {
      console.error("Carrier chat unread count error:", error);
      res.status(500).json({ message: "Failed to load unread count" });
    }
  });

  app.get("/api/carrier-chat", requireChatAgent, async (_req: any, res) => {
    try {
      const rows = await db.select({
        chat: portalChats,
        carrierName: clients.name,
        portalCompanyName: carrierPortalUsers.companyName,
      }).from(portalChats)
        .innerJoin(clients, eq(clients.id, portalChats.carrierId))
        .innerJoin(carrierPortalUsers, and(
          eq(carrierPortalUsers.id, portalChats.portalUserId),
          eq(carrierPortalUsers.carrierId, portalChats.carrierId),
          eq(carrierPortalUsers.status, "active"),
        ))
        .orderBy(desc(portalChats.updatedAt), desc(portalChats.id));
      const result = [];
      for (const row of rows) {
        const [last] = await db.select().from(portalChatMessages)
          .where(eq(portalChatMessages.chatId, row.chat.id))
          .orderBy(desc(portalChatMessages.createdAt), desc(portalChatMessages.id)).limit(1);
        const [{ total }] = await db.select({ total: count() }).from(portalChatMessages).where(and(
          eq(portalChatMessages.chatId, row.chat.id), eq(portalChatMessages.senderType, "carrier"), eq(portalChatMessages.read, false),
        ));
        result.push({
          ...chatSummary(row.chat, row.carrierName, row.portalCompanyName),
          unreadCount: Number(total),
          lastMessage: last ? chatMessageResponse(last) : null,
        });
      }
      res.json(result);
    } catch (error) {
      console.error("Carrier chat list error:", error);
      res.status(500).json({ message: "Failed to load carrier chats" });
    }
  });

  app.get("/api/carrier-chat/:carrierId", requireChatAgent, async (req: any, res) => {
    try {
      const carrierId = Number(req.params.carrierId);
      if (!Number.isInteger(carrierId) || carrierId <= 0) return res.status(400).json({ message: "Invalid carrier" });
      const result = await getAgentChatForCarrier(carrierId, true);
      if (!result) return res.status(404).json({ message: "Carrier chat not found" });
      let since: Date | undefined;
      try { since = parseChatSince(req.query.since); } catch (error) { return res.status(400).json({ message: (error as Error).message }); }
      const afterId = Number(req.query.afterId || 0);
      if (!Number.isInteger(afterId) || afterId < 0) return res.status(400).json({ message: "afterId must be a non-negative integer" });
      const [carrier] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, carrierId)).limit(1);
      const rows = await loadChatMessageRows(result.chat.id, since, afterId);
      const [{ unreadCarriers }] = await db.select({ unreadCarriers: count() }).from(portalChatMessages).where(and(
        eq(portalChatMessages.chatId, result.chat.id),
        eq(portalChatMessages.senderType, "carrier"),
        eq(portalChatMessages.read, false),
      ));
      if (Number(unreadCarriers) > 0) {
        await db.update(portalChatMessages).set({ read: true }).where(and(
          eq(portalChatMessages.chatId, result.chat.id),
          eq(portalChatMessages.senderType, "carrier"),
          eq(portalChatMessages.read, false),
        ));
        await db.update(portalChats).set({ agentLastReadAt: new Date() }).where(eq(portalChats.id, result.chat.id));
      }
      const [portalUser] = await db.select({ companyName: carrierPortalUsers.companyName })
        .from(carrierPortalUsers).where(eq(carrierPortalUsers.id, result.chat.portalUserId)).limit(1);
      res.json({
        chat: chatSummary(result.chat, carrier?.name, portalUser?.companyName),
        messages: await enrichChatMessages(rows, portalUser?.companyName),
      });
    } catch (error) {
      console.error("Carrier chat fetch error:", error);
      if ((error as any)?.status) return res.status((error as any).status).json({ message: (error as Error).message });
      res.status(500).json({ message: "Failed to load carrier chat" });
    }
  });

  app.post("/api/carrier-chat/:carrierId/messages", requireChatAgent, (req: any, res, next) => {
    portalChatUpload.single("attachment")(req, res, (err: any) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ message: "Attachment must be 10MB or smaller" });
      res.status(400).json({ message: err.message || "Attachment upload rejected" });
    });
  }, async (req: any, res) => {
    try {
      const carrierId = Number(req.params.carrierId);
      if (!Number.isInteger(carrierId) || carrierId <= 0) return res.status(400).json({ message: "Invalid carrier" });
      const result = await getAgentChatForCarrier(carrierId, true);
      if (!result) return res.status(404).json({ message: "Active portal user for carrier not found" });
      const file = req.file as Express.Multer.File | undefined;
      const text = typeof req.body?.message === "string" ? req.body.message.trim() : "";
      if (!text && !file) return res.status(400).json({ message: "Message or attachment is required" });
      if (text.length > 10000) return res.status(400).json({ message: "Message must be 10,000 characters or fewer" });
      if (file) {
        const bytes = file.buffer;
        const mime = file.mimetype.toLowerCase();
        const validMagic = (mime === "application/pdf" && bytes.subarray(0, 5).toString("ascii") === "%PDF-")
          || (mime === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
          || (mime === "image/png" && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
        if (!validMagic) return res.status(400).json({ message: "Attachment contents do not match its declared type" });
      }
      let attachmentS3Key: string | null = null;
      if (file) {
        attachmentS3Key = await uploadDocumentToS3(file, `portal-chat/${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
      }
      const [created] = await db.insert(portalChatMessages).values({
        chatId: result.chat.id,
        senderType: "agent",
        senderId: String(req.user.id),
        message: text || null,
        attachmentS3Key,
        attachmentName: file ? sanitizeOriginalName(file.originalname) : null,
        attachmentMimeType: file?.mimetype || null,
        attachmentSize: file?.size || null,
        read: false,
      }).returning();
      await db.update(portalChats).set({
        agentId: sql`coalesce(${portalChats.agentId}, ${req.user.id})`,
        updatedAt: new Date(),
      }).where(eq(portalChats.id, result.chat.id));
      res.status(201).json(chatMessageResponse(created));
    } catch (error) {
      console.error("Carrier chat message error:", error);
      if ((error as any)?.status) return res.status((error as any).status).json({ message: (error as Error).message });
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  app.get("/api/portal-chat/messages/:messageId/attachment/view", async (req: any, res) => {
    try { return await serveChatAttachment(req, res, "view"); }
    catch (error) { console.error("Chat attachment view error:", error); return res.status(500).json({ message: "Failed to view attachment" }); }
  });
  app.get("/api/portal-chat/messages/:messageId/attachment/download", async (req: any, res) => {
    try { return await serveChatAttachment(req, res, "download"); }
    catch (error) { console.error("Chat attachment download error:", error); return res.status(500).json({ message: "Failed to download attachment" }); }
  });

  app.get("/api/portal/brokers", requirePortalAuth, async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const conditions = [eq(brokers.status, "active" as const)];
      if (q) conditions.push(ilike(brokers.name, `%${q}%`));
      const rows = await db.select({ id: brokers.id, name: brokers.name })
        .from(brokers).where(and(...conditions)).orderBy(brokers.name).limit(20);
      res.json(rows);
    } catch {
      res.status(500).json({ message: "Failed to load brokers" });
    }
  });

  app.get("/api/portal/brokers/:id/branches", requirePortalAuth, async (req, res) => {
    try {
      const brokerId = Number(req.params.id);
      if (!Number.isInteger(brokerId)) return res.status(400).json({ message: "Invalid broker" });
      const rows = await db.select({ id: brokerBranches.id, branchName: brokerBranches.branchName })
        .from(brokerBranches)
        .where(and(eq(brokerBranches.brokerId, brokerId), eq(brokerBranches.status, "active")))
        .orderBy(brokerBranches.branchName);
      res.json(rows);
    } catch {
      res.status(500).json({ message: "Failed to load branches" });
    }
  });

  const portalBankAccountSummary = (entry: any) => {
    const decrypted = decryptVault(entry.encryptedData);
    const data = JSON.parse(decrypted);
    const digits = String(data.accountNumber || "").replace(/\D/g, "");
    return {
      id: entry.id,
      bankName: data.bankName,
      accountType: data.accountType,
      nickname: data.nickname || entry.label,
      lastFour: digits.slice(-4).padStart(4, "•"),
      createdAt: entry.createdAt,
    };
  };

  app.get("/api/portal/bank-accounts", requirePortalAuth, async (req: any, res) => {
    try {
      const [portalUser] = await db.select().from(carrierPortalUsers)
        .where(eq(carrierPortalUsers.id, req.portalUser.id)).limit(1);
      if (!portalUser?.carrierId) return res.json([]);
      const entries = await db.select().from(clientVault).where(and(
        eq(clientVault.clientId, portalUser.carrierId),
        eq(clientVault.dataType, "bank_account"),
        eq(clientVault.isActive, true),
      )).orderBy(desc(clientVault.createdAt));
      res.json(entries.map(portalBankAccountSummary));
    } catch (error) {
      console.error("Portal bank accounts error:", error);
      res.status(500).json({ message: "Failed to load bank accounts" });
    }
  });

  app.post("/api/portal/bank-accounts", requirePortalAuth, async (req: any, res) => {
    try {
      const bankSchema = z.object({
        bankName: z.string().trim().min(1).max(120),
        accountType: z.enum(["checking", "savings"]),
        routingNumber: z.string().regex(/^\d{9}$/, "Routing number must be 9 digits"),
        accountNumber: z.string().regex(/^\d{4,17}$/, "Account number must be 4-17 digits"),
        nickname: z.string().trim().min(1).max(80),
      });
      const value = bankSchema.parse(req.body);
      const [portalUser] = await db.select().from(carrierPortalUsers)
        .where(eq(carrierPortalUsers.id, req.portalUser.id)).limit(1);
      if (!portalUser?.carrierId) {
        return res.status(409).json({ message: "Your portal account is not linked to a carrier profile. Please contact TPF." });
      }
      const [entry] = await db.insert(clientVault).values({
        clientId: portalUser.carrierId,
        dataType: "bank_account",
        label: value.nickname,
        encryptedData: encryptVault(JSON.stringify({
          bankName: value.bankName,
          accountType: value.accountType,
          routingNumber: value.routingNumber,
          accountNumber: value.accountNumber,
          nickname: value.nickname,
        })),
        notes: "Added from Carrier Portal",
        createdBy: null,
        createdByPortalUserId: portalUser.id,
      }).returning();
      res.status(201).json(portalBankAccountSummary(entry));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message || "Invalid bank account" });
      console.error("Portal bank account create error:", error);
      res.status(500).json({ message: "Failed to add bank account" });
    }
  });

  app.get("/api/portal/bank-accounts/:id/reveal", requirePortalAuth, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const [portalUser] = await db.select().from(carrierPortalUsers)
        .where(eq(carrierPortalUsers.id, req.portalUser.id)).limit(1);
      if (!portalUser?.carrierId) return res.status(404).json({ message: "Bank account not found" });
      const [entry] = await db.select().from(clientVault).where(and(
        eq(clientVault.id, id), eq(clientVault.clientId, portalUser.carrierId),
        eq(clientVault.dataType, "bank_account"), eq(clientVault.isActive, true),
      )).limit(1);
      if (!entry) return res.status(404).json({ message: "Bank account not found" });
      const data = JSON.parse(decryptVault(entry.encryptedData));
      res.json({ accountNumber: data.accountNumber, routingNumber: data.routingNumber });
    } catch {
      res.status(500).json({ message: "Failed to reveal bank account" });
    }
  });

  app.delete("/api/portal/bank-accounts/:id", requirePortalAuth, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const [portalUser] = await db.select().from(carrierPortalUsers)
        .where(eq(carrierPortalUsers.id, req.portalUser.id)).limit(1);
      if (!portalUser?.carrierId) return res.status(404).json({ message: "Bank account not found" });
      const [entry] = await db.update(clientVault).set({ isActive: false, updatedAt: new Date() }).where(and(
        eq(clientVault.id, id), eq(clientVault.clientId, portalUser.carrierId),
        eq(clientVault.dataType, "bank_account"),
      )).returning({ id: clientVault.id });
      if (!entry) return res.status(404).json({ message: "Bank account not found" });
      res.json({ message: "Bank account removed" });
    } catch {
      res.status(500).json({ message: "Failed to remove bank account" });
    }
  });

  // ── Portal Submissions ─────────────────────────────────────────────────────
  app.get("/api/portal/submissions", requirePortalAuth, async (req: any, res) => {
    try {
      const subs = await db.select().from(carrierSubmissions)
        .where(eq(carrierSubmissions.portalUserId, req.portalUser.id))
        .orderBy(desc(carrierSubmissions.submittedAt));
      const subIds = subs.map((s) => s.id);
      const docs = subIds.length
        ? await db.select().from(carrierSubmissionDocs).where(inArray(carrierSubmissionDocs.submissionId, subIds))
        : [];
      const submissionInvoiceNumbers = subs.map(s => s.invoiceNumber).filter((value): value is string => Boolean(value));
      const receiptRows = submissionInvoiceNumbers.length
        ? await db.select({
            carrierInvoiceNumber: invoices.carrierInvoiceNumber,
            carrierId: invoices.clientId,
            receipt: fundingReceipts,
          }).from(fundingReceipts)
            .innerJoin(invoices, eq(fundingReceipts.invoiceId, invoices.id))
            .where(inArray(invoices.carrierInvoiceNumber, submissionInvoiceNumbers))
            .orderBy(desc(fundingReceipts.version))
        : [];
      const result = subs.map((s) => ({
        ...s,
        documents: docs.filter((d) => d.submissionId === s.id),
        receipts: receiptRows
          .filter(row => row.carrierInvoiceNumber === s.invoiceNumber && row.carrierId === s.carrierId)
          .map(row => ({
            receiptNo: row.receipt.receiptNo,
            version: row.receipt.version,
            fundedAt: row.receipt.fundedAt,
            createdAt: row.receipt.createdAt,
            paymentReference: row.receipt.paymentReference,
          })),
      }));
      res.json(result);
    } catch (error) {
      console.error("Portal submissions error:", error);
      res.status(500).json({ message: "Failed to fetch submissions" });
    }
  });

  app.post("/api/portal/submissions/preflight", requirePortalAuth, async (req: any, res) => {
    try {
      const input = z.object({
        brokerId: z.coerce.number().int().positive().optional(),
        invoiceNumber: z.string().trim().optional(),
        loadNumber: z.string().trim().optional(),
        amount: z.coerce.number().nonnegative().optional(),
        serviceDate: z.string().trim().optional(),
      }).parse(req.body);
      const [portalUser] = await db.select({ carrierId: carrierPortalUsers.carrierId })
        .from(carrierPortalUsers)
        .where(eq(carrierPortalUsers.id, req.portalUser.id))
        .limit(1);
      if (!portalUser?.carrierId) {
        return res.status(409).json({ message: "Your account is not linked to a carrier profile" });
      }
      const { alerts } = await runPreflightForInvoice({
        carrierId: portalUser.carrierId,
        brokerId: input.brokerId,
        invoiceNumber: input.invoiceNumber,
        loadNumber: input.loadNumber,
        amount: input.amount,
        serviceDate: input.serviceDate ?? new Date(),
      });
      const nearDuplicateAlerts = input.brokerId != null && input.amount != null
        ? await getPortalSubmissionNearDuplicateAlerts({
          carrierId: portalUser.carrierId,
          brokerId: input.brokerId,
          amount: input.amount,
        })
        : [];
      return res.json({ alerts: [...alerts, ...nearDuplicateAlerts] });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid preflight data", errors: error.errors });
      console.error("Portal invoice preflight failed:", error);
      return res.status(500).json({ message: "Failed to run invoice preflight" });
    }
  });

  app.post("/api/portal/submissions", requirePortalAuth, (req: any, res, next) => {
    portalUpload.array("documents", 10)(req, res, (err: any) => {
      if (err) return res.status(400).json({ message: err.message || "File upload error" });
      next();
    });
  }, async (req: any, res) => {
    const uploadedPortalKeys: string[] = [];
    try {
      const submissionSchema = z.object({
        loadNumber: z.string().trim().min(1),
        invoiceNumber: z.string().trim().optional(),
        loadType: z.enum(LOAD_TYPES),
        brokerId: z.coerce.number().int().positive(),
        branchId: z.coerce.number().int().positive(),
        code: z.string().trim().min(1),
        lumper: z.enum(["yes", "no"]),
        driverName: z.string().trim().min(1),
        bankAccountId: z.coerce.number().int().positive(),
        amount: z.coerce.number().positive(),
        paymentType: z.enum(["ACH", "wire"]),
        instructionsSubject: z.string().trim().optional(),
        instructionsDetails: z.string().trim().optional(),
        acknowledgements: z.union([z.string(), z.array(z.any())]).optional(),
      });
      const data = submissionSchema.parse(req.body);
      const files: Express.Multer.File[] = (req.files as Express.Multer.File[]) || [];
      const docTypes: string[] = Array.isArray(req.body.documentTypes) ? req.body.documentTypes : (req.body.documentTypes ? [req.body.documentTypes] : []);
      if (files.some(file => file.buffer.subarray(0, 5).toString() !== "%PDF-")) {
        return res.status(400).json({ message: "Every upload must be a valid PDF file" });
      }
      if (!docTypes.includes("rate_confirmation") || !docTypes.includes("bol")) {
        return res.status(400).json({ message: "Rate Confirmation and Bill of Lading are required" });
      }
      const [portalUser] = await db.select().from(carrierPortalUsers)
        .where(eq(carrierPortalUsers.id, req.portalUser.id)).limit(1);
      if (!portalUser?.carrierId) return res.status(409).json({ message: "Your account is not linked to a carrier profile" });
      const [[broker], [branch], [bankAccount]] = await Promise.all([
        db.select().from(brokers).where(and(eq(brokers.id, data.brokerId), eq(brokers.status, "active"))).limit(1),
        db.select().from(brokerBranches).where(and(eq(brokerBranches.id, data.branchId), eq(brokerBranches.brokerId, data.brokerId), eq(brokerBranches.status, "active"))).limit(1),
        db.select().from(clientVault).where(and(eq(clientVault.id, data.bankAccountId), eq(clientVault.clientId, portalUser.carrierId), eq(clientVault.dataType, "bank_account"), eq(clientVault.isActive, true))).limit(1),
      ]);
      if (!broker) return res.status(400).json({ message: "Select an active broker" });
      if (!branch) return res.status(400).json({ message: "Select an active branch for this broker" });
      if (!bankAccount) return res.status(400).json({ message: "Select an active bank account from your profile" });
      let acknowledgements: any[] = [];
      try {
        const rawAcks = data.acknowledgements;
        acknowledgements = Array.isArray(rawAcks) ? rawAcks : rawAcks ? JSON.parse(rawAcks) : [];
        if (!Array.isArray(acknowledgements)) throw new Error("Acknowledgements must be an array");
      } catch {
        return res.status(400).json({ message: "Acknowledgements must be a JSON array" });
      }
      const portalPreflight = await runPreflightForInvoice({
        carrierId: portalUser.carrierId,
        brokerId: data.brokerId,
        invoiceNumber: data.invoiceNumber,
        loadNumber: data.loadNumber,
        amount: data.amount,
        serviceDate: new Date(),
      });
      const portalDecision = getPreflightDecision(portalPreflight.alerts, acknowledgements, req.portalUser, false);
      if (portalDecision.invalidAcknowledgements) {
        return res.status(400).json({ message: "Acknowledgements must contain only unique alert codes requiring acknowledgement, with optional text reasons." });
      }
      if (!portalDecision.accepted) {
        return res.status(409).json({ message: "Submission preflight requires attention", alerts: portalPreflight.alerts });
      }
      const uploadedDocuments: Array<Record<string, any>> = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const dtype = (docTypes[i] || "other") as "rate_confirmation" | "bol" | "lumper_receipt" | "other";
        const portalFileUuid = crypto.randomUUID();
        const portalS3Key = await uploadDocumentToS3(file, `portal/${portalFileUuid}`);
        uploadedPortalKeys.push(portalS3Key);
        uploadedDocuments.push({
          documentType: dtype,
          filename: portalFileUuid,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          ...documentSizeMetadata(file),
          s3Key: portalS3Key,
        });
      }
      const sub = await db.transaction(async (tx) => {
        // Serialize portal submissions with identical carrier/load keys so
        // concurrent requests cannot both pass the preflight check.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(92734012)`);
        const lockedPreflightBase = await runPreflightForInvoice({
          carrierId: portalUser.carrierId,
          brokerId: data.brokerId,
          invoiceNumber: data.invoiceNumber,
          loadNumber: data.loadNumber,
          amount: data.amount,
          serviceDate: new Date(),
        }, tx);
        const portalSubmissionNearAlerts = await getPortalSubmissionNearDuplicateAlerts({
          carrierId: portalUser.carrierId!,
          brokerId: data.brokerId,
          amount: data.amount,
        }, tx);
        const lockedPreflight = { alerts: [...lockedPreflightBase.alerts, ...portalSubmissionNearAlerts] };
        const lockedDecision = getPreflightDecision(lockedPreflight.alerts, acknowledgements, req.portalUser, false);
        if (lockedDecision.invalidAcknowledgements || !lockedDecision.accepted) {
          throw Object.assign(new Error("Submission preflight changed before creation; review the current alerts and try again."), {
            status: 409,
            preflightAlerts: lockedPreflight.alerts,
          });
        }
        const duplicateInvoice = await tx.select({ id: invoices.id, carrierInvoiceNumber: invoices.carrierInvoiceNumber, loadNumber: invoices.loadNumber })
          .from(invoices)
          .where(and(
            eq(invoices.clientId, portalUser.carrierId!),
            or(
              data.invoiceNumber ? eq(invoices.carrierInvoiceNumber, data.invoiceNumber) : undefined,
              eq(invoices.loadNumber, data.loadNumber),
            ),
          ))
          .limit(1);
        const duplicateSubmission = await tx.select({ id: carrierSubmissions.id, invoiceNumber: carrierSubmissions.invoiceNumber, loadNumber: carrierSubmissions.loadNumber })
          .from(carrierSubmissions)
          .where(and(
            eq(carrierSubmissions.carrierId, portalUser.carrierId!),
            ne(carrierSubmissions.status, "rejected"),
            or(
              data.invoiceNumber ? eq(carrierSubmissions.invoiceNumber, data.invoiceNumber) : undefined,
              eq(carrierSubmissions.loadNumber, data.loadNumber),
            ),
          ))
          .limit(1);
        const duplicate = duplicateInvoice[0] ?? duplicateSubmission[0];
        if (duplicate) {
          throw Object.assign(new Error("This load or invoice number has already been submitted."), {
            status: 409,
            preflightAlerts: [{
              code: "DUPLICATE_EXACT",
              severity: "block",
              title: "Possible duplicate invoice",
              message: `An invoice or submission already uses load ${data.loadNumber}${data.invoiceNumber ? ` or invoice ${data.invoiceNumber}` : ""}.`,
            }],
          });
        }
        const [createdSubmission] = await tx.insert(carrierSubmissions).values({
          portalUserId: req.portalUser.id,
          carrierId: portalUser.carrierId,
          loadNumber: data.loadNumber,
          invoiceNumber: data.invoiceNumber || null,
          loadType: data.loadType as any,
          brokerId: broker.id,
          brokerName: broker.name,
          branchId: branch.id,
          branchName: branch.branchName,
          code: data.code,
          lumper: data.lumper === "yes",
          driverName: data.driverName,
          bankAccountId: bankAccount.id,
          amount: String(data.amount),
          paymentType: data.paymentType,
          instructionsSubject: data.instructionsSubject || null,
          instructionsDetails: data.instructionsDetails || null,
          status: "submitted",
        }).returning();
        if (uploadedDocuments.length) {
          await tx.insert(carrierSubmissionDocs).values(
            uploadedDocuments.map((document) => ({ ...document, submissionId: createdSubmission.id })) as any,
          );
        }
        if (lockedDecision.acknowledgements.length) {
          await tx.insert(carrierSubmissionAlertAcks).values(lockedDecision.acknowledgements.map((acknowledgement: any) => ({
            submissionId: createdSubmission.id,
            portalUserId: req.portalUser.id,
            alertCode: acknowledgement.code,
            reason: acknowledgement.reason || null,
          })));
        }
        await tx.insert(carrierSubmissionPreflightEvents).values({
          submissionId: createdSubmission.id,
          eventType: "invoice_preflight",
          alerts: lockedPreflight.alerts,
          acknowledgements: lockedDecision.acknowledgements,
          portalUserId: req.portalUser.id,
        });
        return createdSubmission;
      });
      try {
        const activeAgents = await db.select({ id: users.id }).from(users).where(and(
          eq(users.status, "active"),
          inArray(users.role, ["employee", "manager", "admin"]),
        ));
        const formattedAmount = Number(sub.amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
        await Promise.all(activeAgents.map(agent => storage.createNotification({
          userId: agent.id,
          title: "New carrier submission",
          message: `New carrier submission from ${portalUser.companyName} — ${formattedAmount}`,
          type: "warning",
          entityType: "carrier_submission",
          entityId: sub.id,
          actionUrl: "/portal-submissions",
        }).catch((error: any) => console.warn("Portal submission notification failed:", error?.message))));
      } catch (error: any) {
        console.warn("Portal submission notification lookup failed:", error?.message);
      }
      res.status(201).json(sub);
    } catch (error) {
      await Promise.all(uploadedPortalKeys.map((key) => cleanupS3KeyWithRetry(key, "portal submission compensation")));
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message || "Invalid submission" });
      if ((error as any)?.status === 409) {
        return res.status(409).json({ message: (error as Error).message, alerts: (error as any)?.preflightAlerts ?? [] });
      }
      if ((error as any)?.code === "23505") return res.status(409).json({ message: "This load or invoice number has already been submitted.", alerts: [] });
      console.error("Portal submit error:", error);
      res.status(500).json({ message: "Submission failed" });
    }
  });

  app.get("/api/portal/submissions/:id", requirePortalAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [sub] = await db.select().from(carrierSubmissions)
        .where(and(eq(carrierSubmissions.id, id), eq(carrierSubmissions.portalUserId, req.portalUser.id))).limit(1);
      if (!sub) return res.status(404).json({ message: "Submission not found" });
      const docs = await db.select().from(carrierSubmissionDocs).where(eq(carrierSubmissionDocs.submissionId, id));
      res.json({ ...sub, documents: docs });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch submission" });
    }
  });

  app.get("/api/portal/submissions/:id/documents/:docId/view", requirePortalDocumentAccess, async (req: any, res) => {
    try {
      const docId = parseInt(req.params.docId, 10);
      const submissionId = parseInt(req.params.id, 10);
      const [doc] = await db.select().from(carrierSubmissionDocs).where(and(
        eq(carrierSubmissionDocs.id, docId),
        eq(carrierSubmissionDocs.submissionId, submissionId),
      )).limit(1);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      if (doc.s3Key) {
        const url = await getSignedViewUrl(doc.s3Key);
        return res.redirect(url);
      }
      // Legacy local fallback
      const filePath = path.join(process.cwd(), "uploads/portal", doc.filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ message: "File not found on disk" });
      res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename="${doc.originalName}"`);
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.status(500).json({ message: "Failed to serve document" });
    }
  });

  app.get("/api/portal/submissions/:id/documents/:docId/download", requirePortalDocumentAccess, async (req: any, res) => {
    try {
      const docId = parseInt(req.params.docId, 10);
      const submissionId = parseInt(req.params.id, 10);
      const [doc] = await db.select().from(carrierSubmissionDocs).where(and(
        eq(carrierSubmissionDocs.id, docId),
        eq(carrierSubmissionDocs.submissionId, submissionId),
      )).limit(1);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      if (doc.s3Key) {
        const url = await getSignedDownloadUrl(doc.s3Key, doc.originalName);
        return res.redirect(url);
      }
      // Legacy local fallback
      const filePath = path.join(process.cwd(), "uploads/portal", doc.filename);
      if (!fs.existsSync(filePath)) return res.status(404).json({ message: "File not found on disk" });
      res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${doc.originalName}"`);
      fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      res.status(500).json({ message: "Failed to download document" });
    }
  });

  app.get("/api/portal/submissions/:id/receipts/:receiptNo/download", requirePortalAuth, async (req: any, res) => {
    try {
      const submissionId = z.coerce.number().int().positive().parse(req.params.id);
      const receiptNo = z.string().regex(/^FR-\d{4}-\d{6}$/).parse(req.params.receiptNo);
      const version = req.query.version === undefined ? undefined : z.coerce.number().int().positive().parse(req.query.version);
      const [submission] = await db.select().from(carrierSubmissions).where(and(
        eq(carrierSubmissions.id, submissionId),
        eq(carrierSubmissions.portalUserId, req.portalUser.id),
      )).limit(1);
      if (!submission?.invoiceNumber || !submission.carrierId) return res.status(404).json({ message: "Funding receipt not found" });
      const receipt = await getFundingReceipt(receiptNo, version);
      if (!receipt) return res.status(404).json({ message: "Funding receipt not found" });
      const [invoice] = await db.select({ id: invoices.id }).from(invoices).where(and(
        eq(invoices.id, receipt.invoiceId),
        eq(invoices.carrierInvoiceNumber, submission.invoiceNumber),
        eq(invoices.clientId, submission.carrierId),
      )).limit(1);
      if (!invoice) return res.status(404).json({ message: "Funding receipt not found" });
      res.redirect(await getFundingReceiptDownloadUrl(receipt));
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid funding receipt request" });
      console.error("Portal funding receipt download error:", error);
      res.status(500).json({ message: "Failed to download funding receipt" });
    }
  });

  // ── Agent-facing Portal Routes ─────────────────────────────────────────────
  const carrierPortalSubmissionPermission = requireModulePermission("portal_submissions");

  app.get("/api/portal-submissions/unreviewed-count", carrierPortalSubmissionPermission, async (_req, res) => {
    try {
      const [{ total }] = await db.select({ total: count() }).from(carrierSubmissions)
        .where(isNull(carrierSubmissions.reviewedAt));
      res.json({ count: Number(total) });
    } catch (error) {
      console.error("Unreviewed portal submissions count error:", error);
      res.status(500).json({ message: "Failed to fetch unreviewed count" });
    }
  });

  app.post("/api/carrier-portal/submissions/:id/review", carrierPortalSubmissionPermission, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid submission" });
      const [updated] = await db.update(carrierSubmissions).set({
        reviewedAt: new Date(),
        reviewedBy: req.user.id,
      }).where(and(eq(carrierSubmissions.id, id), isNull(carrierSubmissions.reviewedAt))).returning();
      if (updated) return res.json(updated);
      const [existing] = await db.select().from(carrierSubmissions).where(eq(carrierSubmissions.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Submission not found" });
      res.json(existing);
    } catch (error) {
      console.error("Review portal submission error:", error);
      res.status(500).json({ message: "Failed to mark submission reviewed" });
    }
  });

  app.get("/api/carrier-portal/submissions", carrierPortalSubmissionPermission, async (_req, res) => {
    try {
      const subs = await db.select().from(carrierSubmissions).orderBy(desc(carrierSubmissions.submittedAt));
      const subIds = subs.map((s) => s.id);
      const docs = subIds.length
        ? await db.select().from(carrierSubmissionDocs).where(inArray(carrierSubmissionDocs.submissionId, subIds))
        : [];
      const userIds = Array.from(new Set(subs.map((s) => s.portalUserId)));
      const portalUsers = userIds.length
        ? await db.select().from(carrierPortalUsers).where(inArray(carrierPortalUsers.id, userIds))
        : [];
      const userMap = Object.fromEntries(portalUsers.map((u) => [u.id, u]));
      const bankIds = Array.from(new Set(subs.map(s => s.bankAccountId).filter((id): id is number => id != null)));
      const bankEntries = bankIds.length
        ? await db.select().from(clientVault).where(inArray(clientVault.id, bankIds))
        : [];
      const bankMap = Object.fromEntries(bankEntries.map(entry => {
        try {
          const data = JSON.parse(decryptVault(entry.encryptedData));
          const digits = String(data.accountNumber || "").replace(/\D/g, "");
          return [entry.id, { id: entry.id, bankName: data.bankName || "Bank", nickname: data.nickname || entry.label, lastFour: digits.slice(-4) }];
        } catch {
          return [entry.id, { id: entry.id, bankName: "Bank", nickname: entry.label, lastFour: "••••" }];
        }
      }));
      const result = subs.map((s) => ({
        ...s,
        companyName: userMap[s.portalUserId]?.companyName ?? null,
        bankAccount: s.bankAccountId ? bankMap[s.bankAccountId] ?? null : null,
        documents: docs.filter((d) => d.submissionId === s.id),
      }));
      res.json(result);
    } catch (error) {
      console.error("Agent portal submissions error:", error);
      res.status(500).json({ message: "Failed to fetch submissions" });
    }
  });

  app.patch("/api/carrier-portal/submissions/:id", carrierPortalSubmissionPermission, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { status, notes } = req.body;
      const validStatuses = ["submitted", "under_review", "approved", "funded", "rejected"];
      if (status && !validStatuses.includes(status)) return res.status(400).json({ message: "Invalid status" });

      // Fetch existing submission + portal user email before update
      const [existing] = await db.select().from(carrierSubmissions).where(eq(carrierSubmissions.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Submission not found" });

      const [updated] = await db.update(carrierSubmissions)
        .set({
          ...(status && { status }),
          ...(notes !== undefined && { notes }),
          reviewedAt: existing.reviewedAt ?? new Date(),
          reviewedBy: existing.reviewedBy ?? req.user.id,
        })
        .where(eq(carrierSubmissions.id, id))
        .returning();
      if (!updated) return res.status(404).json({ message: "Submission not found" });

      // Notify carrier when status changes to a notable state
      if (status && status !== existing.status && ["approved", "funded", "rejected", "under_review"].includes(status)) {
        try {
          const [portalUser] = await db.select().from(carrierPortalUsers).where(eq(carrierPortalUsers.id, existing.portalUserId)).limit(1);
          if (portalUser?.email) {
            const statusLabels: Record<string, string> = {
              under_review: "Under Review",
              approved: "Approved",
              funded: "Funded",
              rejected: "Action Required",
            };
            const statusMessages: Record<string, string> = {
              under_review: "Your submission is currently being reviewed by our team. We will reach out if we need additional information.",
              approved: "Great news — your submission has been <strong>approved</strong>! Our team will process your payment shortly.",
              funded: "Your invoice has been <strong>funded</strong>. Please allow 1–2 business days for funds to arrive.",
              rejected: "Unfortunately, your submission could not be processed at this time. Please contact us for details.",
            };
            const notifyHtml = `
              <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;">
                <div style="background:#1e40af;color:#fff;border-radius:12px 12px 0 0;padding:20px 24px;">
                  <h2 style="margin:0;">Submission Update — ${escapeHtml(statusLabels[status] ?? status)}</h2>
                  <p style="margin:4px 0 0;opacity:.8;font-size:13px;">Trucking Pros Financial</p>
                </div>
                <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
                  <p style="color:#374151;">Hi ${escapeHtml(portalUser.companyName)},</p>
                  <p style="color:#374151;">${statusMessages[status] ?? `Your submission status has been updated to <strong>${escapeHtml(status)}</strong>.`}</p>
                  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin:16px 0;">
                    <p style="margin:0 0 6px;font-size:13px;color:#374151;"><strong>Load #:</strong> ${escapeHtml(existing.loadNumber)}</p>
                    ${existing.invoiceNumber ? `<p style="margin:0 0 6px;font-size:13px;color:#374151;"><strong>Invoice #:</strong> ${escapeHtml(existing.invoiceNumber)}</p>` : ""}
                    ${existing.amount ? `<p style="margin:0;font-size:13px;color:#374151;"><strong>Amount:</strong> $${escapeHtml(existing.amount)}</p>` : ""}
                  </div>
                  ${notes ? `<p style="color:#374151;font-size:13px;"><strong>Notes:</strong> ${escapeHtml(notes)}</p>` : ""}
                  <p style="color:#374151;">Questions? Reply to this email or call us at <strong>385-495-4962</strong>.</p>
                  <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;" />
                  <p style="color:#9ca3af;font-size:12px;margin:0;">Trucking Pros Financial · Support@Truckingprosfinancial.com · 385-495-4962</p>
                </div>
              </div>`;
            sendEmail({
              to: portalUser.email,
              subject: `Carrier Portal — Submission ${statusLabels[status] ?? status}: Load #${existing.loadNumber}`,
              html: notifyHtml,
              text: `Hi ${portalUser.companyName},\n\n${statusMessages[status]?.replace(/<[^>]+>/g, "") ?? `Your submission (Load #${existing.loadNumber}) status updated to: ${status}`}\n\nTrucking Pros Financial\nSupport@Truckingprosfinancial.com`,
            }).catch(() => {});
          }
        } catch (_) { /* email failure is non-fatal */ }
      }

      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update submission" });
    }
  });

  const portalUserOutput = (user: typeof carrierPortalUsers.$inferSelect) => ({
    id: user.id,
    email: user.email,
    carrierId: user.carrierId,
    mcNumber: user.mcNumber,
    dotNumber: user.dotNumber,
    phone: user.phone,
    companyName: user.companyName,
    status: user.status,
    rejectionReason: user.rejectionReason,
    reviewedAt: user.reviewedAt,
    reviewedBy: user.reviewedBy,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  });

  app.get("/api/carrier-portal/users", carrierPortalSubmissionPermission, async (_req, res) => {
    try {
      const users = await db.select().from(carrierPortalUsers).orderBy(desc(carrierPortalUsers.createdAt));
      res.json(users.map(portalUserOutput));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch portal users" });
    }
  });

  app.get("/api/carrier-portal/pending-count", carrierPortalSubmissionPermission, async (_req, res) => {
    try {
      const [{ total }] = await db.select({ total: count() }).from(carrierPortalUsers)
        .where(eq(carrierPortalUsers.status, "pending"));
      res.json({ count: Number(total) });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pending portal user count" });
    }
  });

  app.patch("/api/carrier-portal/users/:id/approve", carrierPortalSubmissionPermission, async (req: any, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid portal user" });

      const result = await db.transaction(async (tx) => {
        const [pendingUser] = await tx.select().from(carrierPortalUsers)
          .where(and(eq(carrierPortalUsers.id, id), eq(carrierPortalUsers.status, "pending")))
          .for("update").limit(1);
        if (!pendingUser) {
          const [existing] = await tx.select({ status: carrierPortalUsers.status })
            .from(carrierPortalUsers).where(eq(carrierPortalUsers.id, id)).limit(1);
          if (!existing) throw Object.assign(new Error("Portal user not found"), { status: 404 });
          throw Object.assign(new Error("Only pending portal users can be approved"), { status: 409 });
        }

        const normalizedMc = pendingUser.mcNumber?.replace(/\D/g, "") || "";
        const matchingClients = normalizedMc
          ? await tx.select({ id: clients.id }).from(clients).where(
            sql`regexp_replace(coalesce(${clients.mcNumber}, ''), '[^0-9]', '', 'g') = ${normalizedMc}`,
          ).for("update").limit(2)
          : [];
        if (matchingClients.length > 1) {
          throw Object.assign(new Error("Multiple carriers have this MC number. Resolve the duplicate carrier records before approval."), { status: 409 });
        }
        const matchedClient = matchingClients[0];
        if (matchedClient) {
          const activeAccounts = await tx.select({ id: carrierPortalUsers.id }).from(carrierPortalUsers)
            .where(and(
              eq(carrierPortalUsers.carrierId, matchedClient.id),
              eq(carrierPortalUsers.status, "active"),
            )).limit(1);
          if (activeAccounts.length) {
            throw Object.assign(new Error("This carrier already has an active portal account. Resolve the existing account before approval."), { status: 409 });
          }
        }
        const reviewedAt = new Date();
        const [updated] = await tx.update(carrierPortalUsers).set({
          status: "active",
          carrierId: matchedClient?.id ?? null,
          rejectionReason: null,
          reviewedAt,
          reviewedBy: req.user.id,
        }).where(and(eq(carrierPortalUsers.id, id), eq(carrierPortalUsers.status, "pending"))).returning();
        if (!updated) throw Object.assign(new Error("Only pending portal users can be approved"), { status: 409 });
        return { updated };
      });

      const { updated } = result;
      const companyName = escapeHtml(updated.companyName);
      const approvalHtml = `
        <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;">
          <div style="background:#1e40af;color:#fff;border-radius:12px 12px 0 0;padding:20px 24px;">
            <h2 style="margin:0;">Carrier Portal — Account Approved</h2>
            <p style="margin:4px 0 0;opacity:.8;font-size:13px;">Trucking Pros Financial</p>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
            <p style="color:#374151;">Hi ${companyName},</p>
            <p style="color:#374151;">Your Trucking Pros Financial carrier account has been approved. You can now log in at <a href="https://factorflux.io/portal">factorflux.io/portal</a>.</p>
            <p style="color:#374151;">If you have questions, reply to this email or call us at <strong>385-495-4962</strong>.</p>
            <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;" />
            <p style="color:#9ca3af;font-size:12px;margin:0;">Trucking Pros Financial · Support@Truckingprosfinancial.com · 385-495-4962</p>
          </div>
        </div>`;
      const emailSent = await sendEmail({
        to: updated.email,
        subject: "Carrier Portal — Account Approved",
        html: approvalHtml,
        text: `Hi ${updated.companyName},\n\nYour Trucking Pros Financial carrier account has been approved. You can now log in at https://factorflux.io/portal.\n\nTrucking Pros Financial\nSupport@Truckingprosfinancial.com`,
      }).catch(() => false);
      res.json({ ...portalUserOutput(updated), emailSent });
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message });
      console.error("Approve portal user error:", error);
      res.status(500).json({ message: "Failed to approve portal user" });
    }
  });

  app.patch("/api/carrier-portal/users/:id/reject", carrierPortalSubmissionPermission, async (req: any, res) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) return res.status(400).json({ message: "Invalid portal user" });
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!reason) return res.status(400).json({ message: "A rejection reason is required" });
      if (reason.length > 2000) return res.status(400).json({ message: "Rejection reason must be 2000 characters or fewer" });

      const updated = await db.transaction(async (tx) => {
        const [pendingUser] = await tx.select().from(carrierPortalUsers)
          .where(and(eq(carrierPortalUsers.id, id), eq(carrierPortalUsers.status, "pending")))
          .for("update").limit(1);
        if (!pendingUser) {
          const [existing] = await tx.select({ status: carrierPortalUsers.status })
            .from(carrierPortalUsers).where(eq(carrierPortalUsers.id, id)).limit(1);
          if (!existing) throw Object.assign(new Error("Portal user not found"), { status: 404 });
          throw Object.assign(new Error("Only pending portal users can be rejected"), { status: 409 });
        }
        const [rejected] = await tx.update(carrierPortalUsers).set({
          status: "rejected",
          rejectionReason: reason,
          reviewedAt: new Date(),
          reviewedBy: req.user.id,
        }).where(and(eq(carrierPortalUsers.id, id), eq(carrierPortalUsers.status, "pending"))).returning();
        if (!rejected) throw Object.assign(new Error("Only pending portal users can be rejected"), { status: 409 });
        return rejected;
      });

      if ((req.session as any)?.portalUser?.id === updated.id) delete (req.session as any).portalUser;
      const companyName = escapeHtml(updated.companyName);
      const escapedReason = escapeHtml(reason);
      const rejectionHtml = `
        <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;">
          <div style="background:#1e40af;color:#fff;border-radius:12px 12px 0 0;padding:20px 24px;">
            <h2 style="margin:0;">Carrier Portal — Registration Update</h2>
            <p style="margin:4px 0 0;opacity:.8;font-size:13px;">Trucking Pros Financial</p>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
            <p style="color:#374151;">Hi ${companyName},</p>
            <p style="color:#374151;">We were unable to approve your carrier portal registration at this time.</p>
            <p style="color:#374151;"><strong>Reason:</strong> ${escapedReason}</p>
            <p style="color:#374151;">If you have questions, reply to this email or call us at <strong>385-495-4962</strong>.</p>
            <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;" />
            <p style="color:#9ca3af;font-size:12px;margin:0;">Trucking Pros Financial · Support@Truckingprosfinancial.com · 385-495-4962</p>
          </div>
        </div>`;
      const emailSent = await sendEmail({
        to: updated.email,
        subject: "Carrier Portal — Registration Update",
        html: rejectionHtml,
        text: `Hi ${updated.companyName},\n\nWe were unable to approve your carrier portal registration at this time.\n\nReason: ${reason}\n\nTrucking Pros Financial\nSupport@Truckingprosfinancial.com`,
      }).catch(() => false);
      res.json({ ...portalUserOutput(updated), emailSent });
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message });
      console.error("Reject portal user error:", error);
      res.status(500).json({ message: "Failed to reject portal user" });
    }
  });

  app.patch("/api/carrier-portal/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { status, carrierId } = req.body;
      const validStatuses = ["pending", "active", "suspended", "rejected"];
      if (status && !validStatuses.includes(status)) return res.status(400).json({ message: "Invalid status" });
      const [updated] = await db.update(carrierPortalUsers)
        .set({ ...(status && { status }), ...(carrierId !== undefined && { carrierId }) })
        .where(eq(carrierPortalUsers.id, id))
        .returning();
      if (!updated) return res.status(404).json({ message: "Portal user not found" });
      res.json(portalUserOutput(updated));
    } catch (error) {
      res.status(500).json({ message: "Failed to update portal user" });
    }
  });

  // Credit reports are scoped to the broker assignment for employees. History
  // is read-only; only managers/admins may force a recalculation.
  app.get("/api/brokers/:id/credit", requireAuth, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid broker id" });
      if (!(await canAccessBroker(req, id))) return res.status(403).json({ message: "You may only access brokers assigned to you" });
      const [broker] = await db.select().from(brokers).where(eq(brokers.id, id)).limit(1);
      if (!broker) return res.status(404).json({ message: "Broker not found" });
      const [latest] = await db.select().from(brokerCreditScores)
        .where(eq(brokerCreditScores.brokerId, id)).orderBy(desc(brokerCreditScores.lastCalculatedAt)).limit(1);
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      const historyNewestFirst = await db.select().from(brokerCreditScores)
        .where(and(
          eq(brokerCreditScores.brokerId, id),
          gte(brokerCreditScores.lastCalculatedAt, twelveMonthsAgo),
        ))
        .orderBy(desc(brokerCreditScores.lastCalculatedAt))
        .limit(50);
      res.json({
        broker: { id: broker.id, name: broker.name, creditGrade: broker.creditGrade, creditScore: broker.creditScore },
        current: latest ?? null,
        history: historyNewestFirst.reverse(),
      });
    } catch (error) {
      console.error("Error fetching broker credit:", error);
      res.status(500).json({ message: "Failed to fetch broker credit" });
    }
  });

  app.post("/api/brokers/:id/calculate-credit", requireManagerOrAdmin, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid broker id" });
      const result = await recalculateBrokerCredit(id);
      res.status(201).json(result);
    } catch (error: any) {
      if (error?.message === "Broker not found") return res.status(404).json({ message: error.message });
      console.error("Error recalculating broker credit:", error);
      res.status(500).json({ message: "Failed to recalculate broker credit" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}