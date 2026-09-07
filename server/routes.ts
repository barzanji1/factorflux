import type { Express } from "express";
import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { encryptVault, decryptVault } from "./services/vaultCrypto";
import {
  uploadToS3,
  getSignedViewUrl,
  getSignedDownloadUrl,
  deleteFromS3,
  downloadToTemp,
} from "./services/s3Service";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { eq, and, desc, sql, inArray, notInArray } from "drizzle-orm";

import { storage } from "./storage";
import { firestore } from "./firebase";
import {
  upsertClientMirror,
  addClientActivityLog,
} from "./services/firestore-records";
import { deleteClientMirror } from "./services/firestore-record";
import { db } from "./db";

import {
  insertClientSchema,
  insertLoadSchema,
  insertInvoiceSchema,
  insertFollowUpSchema,
  insertCollectionSchema,
  insertClientVaultSchema,
  insertTaskSchema,
  insertBrokerSchema,
  insertFuelAdvanceSchema,
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
  brokers,
  fuelAdvances,
  invoices,
  payouts,
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
  debtors,
  paymentApplicationLines,
  cashApplications,
  dispatchers,
  insertDispatcherSchema,
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
  carrierPortalUsers,
  carrierSubmissions,
  carrierSubmissionDocs,
  ALL_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
} from "@shared/schema";
import Anthropic from "@anthropic-ai/sdk";
import { triggerBrokerFollowUp, processScheduledReminders, suppressCadence, invalidateTemplateCache } from "./services/brokerFollowUpEngine";
import { jobQueue } from "./services/jobQueue";
import { classifyDocumentAI } from "./services/aiClassifier";

import { sendEmail } from "./emailService";
import {
  advanceInvoiceStage,
  stageFromInvoiceStatus,
  getInvoiceDetail,
  getInvoiceTimeline,
} from "./services/invoiceStage";
import {
  getAvailableTransitions,
  performTransition,
} from "./services/lifecycleEngine";
import { getDocumentCompleteness } from "./services/docValidation";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf|tiff|tif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    }

    cb(new Error("Only PDF, JPEG, JPG, PNG, and TIFF files are allowed"));
  },
});

function handleUpload(field: string) {
  return (req: any, res: any, next: any) => {
    upload.single(field)(req, res, (err: any) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: "File too large. Maximum size is 10MB." });
      }
      return res.status(400).json({ message: err.message || "File upload rejected." });
    });
  };
}

function sanitizeOriginalName(name: string) {
  return name
    .normalize("NFKC")
    .replace(/[^\w.\- ()]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
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

  const requireAuth = (req: any, res: any, next: any) => {
    const user = (req.session as any)?.user;
    if (!user) {
      return res.status(401).json({ message: "Authentication required" });
    }
    req.user = user;
    next();
  };

  const requireAdmin = (req: any, res: any, next: any) => {
    const user = (req.session as any)?.user;
    if (!user) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    req.user = user;
    next();
  };

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

  app.get("/api/auth/verify", async (req, res) => {
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
        from: "dosh@truckingprosfinancial.com",
        replyTo: email,
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
        from: "dosh@truckingprosfinancial.com",
        replyTo: email,
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
          from: "dosh@truckingprosfinancial.com",
          replyTo: "dosh@truckingprosfinancial.com",
          subject,
          text: body,
          html,
        });
        emailStatus = sent ? "sent" : "failed";
        if (!sent) emailError = "SendGrid delivery failed";
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
  app.get("/api/admin/users", requireAdmin, async (_req: any, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      res.json(allUsers);
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
        from: "dosh@truckingprosfinancial.com",
        replyTo: "dosh@truckingprosfinancial.com",
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

      res.status(201).json(newUser);
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

      res.json(updatedUser);
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
      res.json({ permissions: perms });
    } catch (err) {
      console.error("Error fetching own permissions:", err);
      res.status(500).json({ message: "Failed to fetch permissions" });
    }
  });

  app.get("/api/admin/users/:id/permissions", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const perms = await storage.getUserPermissions(id);
      res.json({ permissions: perms });
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

      res.json(documents);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  app.get("/api/invoices/:id/documents", requireAuth, async (req: any, res) => {
    try {
      const invoiceId = parseInt(req.params.id, 10);
      if (Number.isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });
      const docs = await storage.getDocumentsByInvoice(invoiceId);
      res.json(docs);
    } catch (error) {
      console.error("Error fetching invoice documents:", error);
      res.status(500).json({ message: "Failed to fetch invoice documents" });
    }
  });

  app.patch("/api/documents/:id/document-type", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const validTypes = [
        "rate_confirmation", "bol", "commercial_invoice", "pod", "other",
      ];
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid document ID" });
      if (!validTypes.includes(req.body.documentType)) {
        return res.status(400).json({ message: "Invalid document type" });
      }

      const document = await storage.updateDocument(id, {
        documentType: req.body.documentType,
        finalDocumentType: req.body.documentType,
      } as any);
      if (!document) return res.status(404).json({ message: "Document not found" });
      res.json(document);
    } catch (error) {
      console.error("Error updating document type:", error);
      res.status(500).json({ message: "Failed to update document type" });
    }
  });

  app.post("/api/invoices/:id/documents", requireAuth, handleUpload("file"), async (req: any, res) => {
    try {
      const invoiceId = parseInt(req.params.id, 10);
      if (Number.isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { documentType, sourceChannel } = req.body;
      const processedOriginalName = sanitizeOriginalName(req.file.originalname);
      const fileUuid = crypto.randomUUID();
      const s3Key = await uploadToS3(req.file.buffer, `documents/${fileUuid}`, req.file.mimetype);
      // Write to /tmp for OCR pipeline (ephemeral, not uploads/)
      const tmpPath = path.join("/tmp", fileUuid);
      fs.writeFileSync(tmpPath, req.file.buffer);

      const documentData = {
        filename: fileUuid,
        originalName: processedOriginalName,
        mimeType: req.file.mimetype,
        size: req.file.size,
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

      const processedMimeType = req.file.mimetype;
      const processedOriginalName = sanitizeOriginalName(req.file.originalname);
      const fileUuid = crypto.randomUUID();
      const s3Key = await uploadToS3(req.file.buffer, `documents/${fileUuid}`, processedMimeType);
      // Write to /tmp for OCR pipeline (ephemeral, not uploads/)
      const tmpPath = path.join("/tmp", fileUuid);
      fs.writeFileSync(tmpPath, req.file.buffer);

      const documentData = {
        filename: fileUuid,
        originalName: processedOriginalName,
        mimeType: processedMimeType,
        size: req.file.size,
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
  app.get("/api/clients", requireAuth, async (_req: any, res) => {
    try {
      const allClients = await storage.getClients();
      res.json(allClients);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  app.get("/api/clients/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid client id" });
      const client = await storage.getClient(id);
      if (!client) return res.status(404).json({ message: "Client not found" });
      res.json(client);
    } catch (error) {
      console.error("Error fetching client:", error);
      res.status(500).json({ message: "Failed to fetch client" });
    }
  });

  app.get("/api/clients/search", requireAuth, async (req: any, res) => {
    try {
      const { q } = req.query;

      if (!q || typeof q !== "string") {
        return res.status(400).json({ message: "Search query is required" });
      }

      const results = await storage.searchClients(q);
      res.json(results);
    } catch (error) {
      console.error("Error searching clients:", error);
      res.status(500).json({ message: "Failed to search clients" });
    }
  });

  app.post("/api/clients", requireAuth, async (req: any, res) => {
    try {
      const clientData = insertClientSchema.parse(req.body);
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

      res.status(201).json(client);
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

  app.get("/api/firebase-clients", async (_req: any, res) => {
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

  app.put("/api/clients/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);

      if (Number.isNaN(id)) {
        return res.status(400).json({ message: "Invalid client id" });
      }

      const clientData = insertClientSchema.partial().parse(req.body);
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

      res.json(client);
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
  });

  app.delete("/api/clients/:id", requireAuth, async (req: any, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Invalid client id" });
    }

    try {
      console.log(`[DELETE CLIENT] route hit for id=${id}`);

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
        clientName = client?.companyName ?? null;
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
          const broker = inv.debtorId ? await storage.getDebtor(inv.debtorId) : null;
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
      const { reason, notes } = req.body as { reason: string; notes?: string };
      if (!reason?.trim()) return res.status(400).json({ message: "Hold reason is required" });
      const inv = await storage.holdInvoice(Number(req.params.id), reason, req.user.id, notes);
      await storage.createActivity({ userId: req.user.id, type: "invoice_held", description: `Invoice #${inv.invoiceNumber} placed on hold: ${reason}`, entityType: "invoice", entityId: inv.id });
      res.json(inv);
    } catch (e: any) { res.status(500).json({ message: e.message ?? "Failed to hold invoice" }); }
  });

  app.post("/api/invoices/:id/release", requireAuth, async (req: any, res) => {
    try {
      const { releaseNote } = req.body as { releaseNote?: string };
      const inv = await storage.releaseInvoice(Number(req.params.id), req.user.id, releaseNote);
      await storage.createActivity({ userId: req.user.id, type: "invoice_released", description: `Invoice #${inv.invoiceNumber} released from hold`, entityType: "invoice", entityId: inv.id });
      res.json(inv);
    } catch (e: any) { res.status(500).json({ message: e.message ?? "Failed to release invoice" }); }
  });

  app.get("/api/invoices", requireAuth, async (_req: any, res) => {
    try {
      const invoices = await storage.getInvoices();
      res.json(invoices);
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  app.post("/api/invoices", requireAuth, async (req: any, res) => {
    try {
      const invoiceData = insertInvoiceSchema.parse(req.body);
      // Always generate a unique invoice number server-side to prevent collisions
      const invoiceNumber = await storage.getNextInvoiceNumber();
      const invoice = await storage.createInvoice({
        ...invoiceData,
        invoiceNumber,
        loadId: null,
        submittedBy: req.user.id,
        submittedAt: new Date(),
      });

      await storage.createActivity({
        userId: req.user.id,
        type: "invoice_created",
        description: `Created invoice: ${invoice.invoiceNumber}`,
        entityType: "invoice",
        entityId: invoice.id,
      });

      res.status(201).json(invoice);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid invoice data", errors: error.errors });
      }
      console.error("Error creating invoice:", error);
      res.status(500).json({ message: "Failed to create invoice" });
    }
  });

  app.put("/api/invoices/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const invoiceData = insertInvoiceSchema.partial().parse(req.body);
      const user = req.user;
      if (invoiceData.bankAccountId) {
        const currentInvoice = await storage.getInvoice(id);
        const account = await storage.getVaultEntry(invoiceData.bankAccountId);
        if (!currentInvoice || !account || account.clientId !== currentInvoice.clientId || account.dataType !== "bank_account" || !account.isActive) {
          return res.status(400).json({ message: "The selected bank account is not available for this carrier" });
        }
      }

      const updatePayload: any = {
        ...invoiceData,
        updatedAt: new Date(),
      };

      if (invoiceData.status === "approved" && (user?.role === "manager" || user?.role === "admin")) {
        updatePayload.approvedBy = req.user.id;
        updatePayload.approvedAt = new Date();
      }

      if (invoiceData.status === "submitted") {
        updatePayload.submittedAt = new Date();
      }

      const invoice = await storage.updateInvoice(id, updatePayload);

      await storage.createActivity({
        userId: req.user.id,
        type: "invoice_updated",
        description: `Updated invoice: ${invoice.invoiceNumber}`,
        entityType: "invoice",
        entityId: invoice.id,
      });

      if (invoiceData.status) {
        const derivedStage = stageFromInvoiceStatus(invoiceData.status);
        advanceInvoiceStage(id, derivedStage, req.user.id, `Status changed to ${invoiceData.status}`).catch(() => {});
      }

      res.json(invoice);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid invoice data", errors: error.errors });
      }
      console.error("Error updating invoice:", error);
      res.status(500).json({ message: "Failed to update invoice" });
    }
  });

  app.put("/api/invoices/:id/approve", requireAuth, async (req: any, res) => {
    try {
      const user = req.user;
      if (user?.role !== "manager" && user?.role !== "admin") {
        return res.status(403).json({ message: "Only managers and admins can approve invoices" });
      }

      const id = parseInt(req.params.id, 10);
      const invoice = await storage.updateInvoice(id, {
        status: "approved",
        approvedBy: req.user.id,
        approvedAt: new Date(),
      });

      await storage.createActivity({
        userId: req.user.id,
        type: "invoice_approved",
        description: `Approved invoice: ${invoice.invoiceNumber}`,
        entityType: "invoice",
        entityId: invoice.id,
      });

      advanceInvoiceStage(id, "approval", req.user.id, "Invoice approved").catch(() => {});

      res.json(invoice);
    } catch (error) {
      console.error("Error approving invoice:", error);
      res.status(500).json({ message: "Failed to approve invoice" });
    }
  });

  app.post("/api/invoices/:id/override-approve", requireAuth, async (req: any, res) => {
    try {
      if (req.user?.role !== "manager" && req.user?.role !== "admin") {
        return res.status(403).json({ message: "Manager or admin required" });
      }
      const id = parseInt(req.params.id, 10);
      const reason = String(req.body.reason ?? "").trim();
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid invoice ID" });
      if (!reason) return res.status(400).json({ message: "Override reason is required" });

      const existing = await storage.getInvoice(id);
      if (!existing) return res.status(404).json({ message: "Invoice not found" });
      const appliedAt = new Date();
      const agentName = [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || req.user.id;
      const invoice = await storage.updateInvoice(id, {
        status: "approved",
        factoringStage: "approval",
        approvedBy: req.user.id,
        approvedAt: appliedAt,
        updatedAt: appliedAt,
      } as any);
      await db.insert(eventLedger).values({
        entityType: "invoice",
        entityId: id,
        eventType: "document_requirements_overridden",
        actorType: "user",
        actorId: req.user.id,
        payloadJson: { reason, agentName, appliedAt: appliedAt.toISOString(), previousStatus: existing.status },
      });
      await storage.createActivity({
        userId: req.user.id,
        type: "invoice_override_approved",
        description: `${agentName} overrode document requirements and approved invoice ${invoice.invoiceNumber}: ${reason}`,
        entityType: "invoice",
        entityId: id,
      } as any);
      res.json(invoice);
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
          debtorName: debtors.name,
        })
        .from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
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
      const detail = await getInvoiceDetail(id);
      if (!detail) return res.status(404).json({ message: "Invoice not found" });
      res.json(detail);
    } catch (err) {
      console.error("Error fetching invoice detail:", err);
      res.status(500).json({ message: "Failed to fetch invoice detail" });
    }
  });

  // ─── Invoice timeline (merged events) ────────────────────────────────────
  app.get("/api/invoices/:id/timeline", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const timeline = await getInvoiceTimeline(id);
      res.json(timeline);
    } catch (err) {
      console.error("Error fetching invoice timeline:", err);
      res.status(500).json({ message: "Failed to fetch invoice timeline" });
    }
  });

  // ─── Available lifecycle transitions ─────────────────────────────────────
  app.get("/api/invoices/:id/available-transitions", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const transitions = await getAvailableTransitions(id, req.user?.role ?? "employee");
      res.json(transitions);
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
        paymentMethod: z.enum(["ach", "wire"]).optional(),
        bankAccountVaultId: z.number().int().positive().optional(),
      });
      const { transitionId, reason, force, paymentMethod, bankAccountVaultId } = schema.parse(req.body);
      const result = await performTransition(
        id, transitionId, req.user.id, req.user.role ?? "employee", reason, force, paymentMethod, bankAccountVaultId,
      );
      res.json(result);
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
        invoiceNumber: invoices.invoiceNumber, fundedAt: invoices.fundedAt, carrier: clients.name, broker: debtors.name,
      }).from(invoiceAgingAlerts).innerJoin(invoices, eq(invoiceAgingAlerts.invoiceId, invoices.id))
        .leftJoin(clients, eq(invoices.clientId, clients.id)).leftJoin(debtors, eq(invoices.debtorId, debtors.id))
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
      await storage.createActivity({ userId: req.user.id, type: "invoice_aging_alert_acknowledged", description: `Acknowledged ${alert.alertType} aging alert`, entityType: "invoice", entityId: alert.invoiceId } as any);
      res.json(alert);
    } catch (error) { console.error("Error acknowledging aging alert:", error); res.status(500).json({ message: "Failed to acknowledge aging alert" }); }
  });

  app.get("/api/invoices/chargebacks", requireAuth, async (_req, res) => {
    try {
      const rows = await db.select({
        invoice: invoices, carrierName: clients.name, brokerName: debtors.name,
      }).from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .leftJoin(debtors, eq(invoices.debtorId, debtors.id))
        .where(inArray(invoices.chargebackStatus, ["scheduled", "extended", "charged"] as any[]))
        .orderBy(desc(invoices.chargebackDate));
      res.json(rows.map(r => ({ ...r.invoice, carrierName: r.carrierName, brokerName: r.brokerName })));
    } catch (error) {
      console.error("Error fetching chargebacks:", error);
      res.status(500).json({ message: "Failed to fetch chargebacks" });
    }
  });

  app.post("/api/invoices/:id/extend-chargeback", requireAuth, async (req: any, res) => {
    try {
      if (!["employee", "manager", "admin"].includes(req.user?.role)) return res.status(403).json({ message: "Agent access required" });
      const id = Number(req.params.id);
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
      await storage.createActivity({ userId: req.user.id, type: "chargeback_extended", description: `Extended chargeback for ${invoice.invoiceNumber} to ${extensionDate.toLocaleDateString()}: ${body.reason}`, entityType: "invoice", entityId: id } as any);
      res.json(invoice);
    } catch (error: any) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message });
      console.error("Error extending chargeback:", error);
      res.status(500).json({ message: "Failed to extend chargeback" });
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
      res.json(await storage.getDocReviews(parseInt(req.params.id)));
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
      const review = await storage.createDocReview({
        invoiceId: parseInt(req.params.id),
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
      res.json(invoices);
    } catch (error) {
      console.error("Error searching invoices:", error);
      res.status(500).json({ message: "Failed to search invoices" });
    }
  });

  // Search
  app.get("/api/search", requireAuth, async (req: any, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== "string") {
        return res.status(400).json({ message: "Search query is required" });
      }

      const [clientResults, invoiceResults, loadResults] = await Promise.all([
        storage.searchClients(q),
        storage.searchInvoices(q),
        storage.searchLoads(q),
      ]);

      res.json({
        clients: clientResults,
        invoices: invoiceResults,
        loads: loadResults,
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
  app.get("/api/vault/entry/:id", requireAuth, async (req: any, res) => {
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
      res.json({ ...entry, decryptedValue });
    } catch (error) {
      console.error("Error fetching vault entry:", error);
      res.status(500).json({ message: "Failed to fetch vault entry" });
    }
  });

  app.get("/api/vault/:clientId", requireAuth, async (req: any, res) => {
    try {
      const clientId = parseInt(req.params.clientId, 10);
      if (Number.isNaN(clientId)) return res.status(400).json({ message: "Invalid client ID" });

      const vaultEntries = await storage.getAllVaultEntries(clientId);
      res.json(vaultEntries);
    } catch (error) {
      console.error("Error fetching vault entries:", error);
      res.status(500).json({ message: "Failed to fetch vault entries" });
    }
  });

  app.get("/api/carriers/:id/bank-accounts", requireAuth, async (req: any, res) => {
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
          return {
            id: entry.id,
            bankName: data.bankName || "Bank",
            accountType: data.accountType || null,
            nickname: data.nickname || entry.label,
            lastFour: digits.slice(-4).padStart(4, "•"),
          };
        });
      res.json(accounts);
    } catch (error) {
      console.error("Error fetching carrier bank accounts:", error);
      res.status(500).json({ message: "Failed to fetch bank accounts" });
    }
  });

  app.post("/api/vault", requireAuth, async (req: any, res) => {
    try {
      const { value, clientId, dataType, label, notes } = req.body;
      if (!value) return res.status(400).json({ message: "Value is required" });
      if (!clientId) return res.status(400).json({ message: "Client is required" });

      const encryptedData = encryptVault(String(value));

      const data = insertClientVaultSchema.parse({
        clientId: parseInt(String(clientId), 10),
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

      res.status(201).json(entry);
    } catch (error: any) {
      console.error("Error creating vault entry:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid vault data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to create vault entry" });
    }
  });

  app.patch("/api/vault/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid vault entry ID" });

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

      res.json(entry);
    } catch (error) {
      console.error("Error updating vault entry:", error);
      res.status(500).json({ message: "Failed to update vault entry" });
    }
  });

  app.put("/api/vault/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid vault entry ID" });

      const updates: any = {};
      if (req.body.label) updates.label = req.body.label;
      if (req.body.dataType) updates.dataType = req.body.dataType;
      if (req.body.notes !== undefined) updates.notes = req.body.notes;
      if (req.body.value) updates.encryptedData = encryptVault(String(req.body.value));

      const entry = await storage.updateVaultEntry(id, updates);
      res.json(entry);
    } catch (error) {
      console.error("Error updating vault entry (PUT):", error);
      res.status(500).json({ message: "Failed to update vault entry" });
    }
  });

  app.delete("/api/vault/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid vault entry ID" });

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
        await storage.createActivity({ userId: req.user.id, type: "broker_followup_reminder_edited", description: `Edited scheduled broker follow-up reminder #${reminderId}`, entityType: "invoice", entityId: followUp.invoiceId } as any);
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
  app.get("/api/tasks", requireAuth, async (_req: any, res) => {
    try {
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
          createdAt: tasks.createdAt,
          updatedAt: tasks.updatedAt,
          client: {
            id: clients.id,
            name: clients.name,
          },
        })
        .from(tasks)
        .leftJoin(clients, eq(tasks.clientId, clients.id))
        .orderBy(tasks.createdAt);

      res.json(tasksData);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  app.get("/api/tasks/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      res.json(task);
    } catch (error) {
      console.error("Error fetching task:", error);
      res.status(500).json({ message: "Failed to fetch task" });
    }
  });

  app.post("/api/tasks", requireAuth, async (req: any, res) => {
    try {
      const taskData = insertTaskSchema.parse({
        ...req.body,
        assignedTo: req.user.id,
      });

      const [newTask] = await db.insert(tasks).values(taskData).returning();
      res.status(201).json(newTask);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      console.error("Error creating task:", error);
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  app.patch("/api/tasks/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updateData = insertTaskSchema.partial().parse(req.body);

      const [updatedTask] = await db
        .update(tasks)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(tasks.id, id))
        .returning();

      if (!updatedTask) {
        return res.status(404).json({ message: "Task not found" });
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

  app.delete("/api/tasks/:id", requireAuth, async (req, res) => {
    try {
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
  app.get("/api/brokers", requireAuth, async (_req, res) => {
    try {
      const brokersData = await db.select().from(brokers).orderBy(brokers.name);
      res.json(brokersData);
    } catch (error) {
      console.error("Error fetching brokers:", error);
      res.status(500).json({ message: "Failed to fetch brokers" });
    }
  });

  app.get("/api/brokers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [broker] = await db.select().from(brokers).where(eq(brokers.id, id)).limit(1);

      if (!broker) {
        return res.status(404).json({ message: "Broker not found" });
      }

      res.json(broker);
    } catch (error) {
      console.error("Error fetching broker:", error);
      res.status(500).json({ message: "Failed to fetch broker" });
    }
  });

  app.post("/api/brokers", requireAuth, async (req, res) => {
    try {
      const brokerData = insertBrokerSchema.parse(req.body);
      const [newBroker] = await db.insert(brokers).values(brokerData).returning();
      res.status(201).json(newBroker);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid broker data", errors: error.errors });
      }
      console.error("Error creating broker:", error);
      res.status(500).json({ message: "Failed to create broker" });
    }
  });

  app.patch("/api/brokers/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updateData = insertBrokerSchema.partial().parse(req.body);

      const [updatedBroker] = await db
        .update(brokers)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(brokers.id, id))
        .returning();

      if (!updatedBroker) {
        return res.status(404).json({ message: "Broker not found" });
      }

      res.json(updatedBroker);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid broker data", errors: error.errors });
      }
      console.error("Error updating broker:", error);
      res.status(500).json({ message: "Failed to update broker" });
    }
  });

  app.delete("/api/brokers/:id", requireAuth, async (req, res) => {
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

  // Fuel advances
  app.get("/api/fuel-advances", requireAuth, async (_req, res) => {
    try {
      const fuelAdvancesData = await db
        .select({
          id: fuelAdvances.id,
          carrierName: fuelAdvances.carrierName,
          advanceAmount: fuelAdvances.advanceAmount,
          advanceDate: fuelAdvances.advanceDate,
          pickupState: fuelAdvances.pickupState,
          deliveryState: fuelAdvances.deliveryState,
          processedBy: fuelAdvances.processedBy,
          loadId: fuelAdvances.loadId,
          notes: fuelAdvances.notes,
          status: fuelAdvances.status,
          createdAt: fuelAdvances.createdAt,
          updatedAt: fuelAdvances.updatedAt,
          processedByName: users.firstName,
        })
        .from(fuelAdvances)
        .leftJoin(users, eq(fuelAdvances.processedBy, users.id))
        .orderBy(fuelAdvances.advanceDate);

      res.json(fuelAdvancesData);
    } catch (error) {
      console.error("Error fetching fuel advances:", error);
      res.status(500).json({ message: "Failed to fetch fuel advances" });
    }
  });

  app.get("/api/fuel-advances/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [fuelAdvance] = await db
        .select({
          id: fuelAdvances.id,
          carrierName: fuelAdvances.carrierName,
          advanceAmount: fuelAdvances.advanceAmount,
          advanceDate: fuelAdvances.advanceDate,
          pickupState: fuelAdvances.pickupState,
          deliveryState: fuelAdvances.deliveryState,
          processedBy: fuelAdvances.processedBy,
          loadId: fuelAdvances.loadId,
          notes: fuelAdvances.notes,
          status: fuelAdvances.status,
          createdAt: fuelAdvances.createdAt,
          updatedAt: fuelAdvances.updatedAt,
          processedByName: users.firstName,
        })
        .from(fuelAdvances)
        .leftJoin(users, eq(fuelAdvances.processedBy, users.id))
        .where(eq(fuelAdvances.id, id))
        .limit(1);

      if (!fuelAdvance) {
        return res.status(404).json({ message: "Fuel advance not found" });
      }

      res.json(fuelAdvance);
    } catch (error) {
      console.error("Error fetching fuel advance:", error);
      res.status(500).json({ message: "Failed to fetch fuel advance" });
    }
  });

  app.post("/api/fuel-advances", requireAuth, async (req, res) => {
    try {
      const fuelAdvanceData = insertFuelAdvanceSchema.parse(req.body);
      const [newFuelAdvance] = await db.insert(fuelAdvances).values(fuelAdvanceData).returning();
      res.status(201).json(newFuelAdvance);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid fuel advance data", errors: error.errors });
      }
      console.error("Error creating fuel advance:", error);
      res.status(500).json({ message: "Failed to create fuel advance" });
    }
  });

  app.patch("/api/fuel-advances/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updateData = insertFuelAdvanceSchema.partial().parse(req.body);

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

  app.delete("/api/fuel-advances/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [deletedFuelAdvance] = await db.delete(fuelAdvances).where(eq(fuelAdvances.id, id)).returning();

      if (!deletedFuelAdvance) {
        return res.status(404).json({ message: "Fuel advance not found" });
      }

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
        })
        .from(users);
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

  app.get("/api/payouts/invoice/:invoiceId", requireAuth, async (req, res) => {
    try {
      const invoiceId = parseInt(req.params.invoiceId, 10);
      const payout = await storage.getPayoutByInvoice(invoiceId);
      if (!payout) return res.status(404).json({ message: "No payout found for this invoice" });
      res.json(payout);
    } catch (err) {
      console.error("Error fetching payout by invoice:", err);
      res.status(500).json({ message: "Failed to fetch payout" });
    }
  });

  app.post("/api/payouts", requireAuth, async (req: any, res) => {
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

      await storage.createActivity({
        userId: req.user.id,
        type: "invoice_created",
        entityType: "invoice",
        entityId: invoiceId,
        description: `Created payout record for invoice ${inv.invoiceNumber}: net payout $${netPayout}`,
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

  app.patch("/api/payouts/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
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
      if (updates.paymentStatus === "advance_paid" && !updates.advancePaidAt) extra.advancePaidAt = now;
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

  app.post("/api/authority-checks/run", requireAdmin, async (req: any, res) => {
    try {
      const { runAllAuthorityChecks } = await import("./services/authorityScheduler");
      const summary = await runAllAuthorityChecks(req.user.id);
      res.json(summary);
    } catch (e: any) {
      res.status(500).json({ message: e?.message ?? "Failed to run authority checks" });
    }
  });

  app.post("/api/authority-checks/configure-key", requireAdmin, async (req: any, res) => {
    try {
      const { webKey } = req.body;
      if (!webKey || typeof webKey !== "string" || webKey.trim().length < 8) {
        return res.status(400).json({ message: "Invalid web key" });
      }
      // Store in process env for current session; persisting to env file is handled via Replit secrets
      process.env.FMCSA_WEBKEY = webKey.trim();
      await storage.createActivity({
        userId: req.user.id,
        type: "fmcsa_key_configured",
        description: "FMCSA API web key configured",
        entityType: "user",
        entityId: undefined,
      });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: "Failed to save key" }); }
  });

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

      const docData: any = {
        filename:     req.file.filename,
        originalName: sanitizeOriginalName(req.file.originalname),
        mimeType:     req.file.mimetype,
        size:         req.file.size,
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

      const filePath = path.join("uploads", req.file.filename);
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

      const text = extractionRows[0]?.mainText || extractionRows[0]?.fullText;
      if (!text) return res.status(422).json({ message: "No extracted text available — run extraction first" });

      const aiResult = await classifyDocumentAI(text);

      // Persist AI result back to the document
      await db
        .update(documentsTable)
        .set({
          aiDocumentType:             aiResult.docType,
          aiClassificationConfidence: String(aiResult.confidence),
          aiClassificationSignals:    aiResult.signals,
          allClassificationScores:    aiResult.allScores,
          classificationSource:       aiResult.source as any,
          aiClassifiedAt:             new Date(),
          aiClassificationModel:      aiResult.model,
          // Promote to candidate if AI is more confident
          candidateDocumentType:
            aiResult.confidence > parseFloat(docRows[0].classificationConfidence ?? "0")
              ? (aiResult.docType as any)
              : docRows[0].candidateDocumentType,
          classificationConfidence:
            aiResult.confidence > parseFloat(docRows[0].classificationConfidence ?? "0")
              ? String(aiResult.confidence)
              : docRows[0].classificationConfidence,
        })
        .where(eq(documentsTable.id, docId));

      res.json({
        docType:    aiResult.docType,
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
        const effectiveType = (doc.finalDocumentType ?? doc.candidateDocumentType ?? "other") as any;
        await db.update(documentsTable)
          .set({ documentType: effectiveType })
          .where(eq(documentsTable.id, docId));
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
        const effectiveType = doc.finalDocumentType ?? doc.candidateDocumentType ?? "other";
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
        // Notify managers if completeness just reached a milestone
        if (completeness.canStartReview || completeness.canApprove) {
          const milestone = completeness.canApprove ? "ready for approval" : "ready for review";
          await storage.createActivity({
            userId:      req.user.id,
            type:        "workflow_milestone",
            description: `Invoice #${doc.invoiceId} is now ${milestone} — all required documents confirmed`,
            entityType:  "invoice",
            entityId:    doc.invoiceId,
          });
        }
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
        .set({ finalDocumentType: finalDocumentType as any })
        .where(eq(documentsTable.id, docId))
        .returning({
          id: documentsTable.id,
          candidateDocumentType: documentsTable.candidateDocumentType,
          finalDocumentType: documentsTable.finalDocumentType,
          classificationConfidence: documentsTable.classificationConfidence,
        });

      if (!updated) return res.status(404).json({ message: "Document not found" });

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

      const [job] = await db
        .insert(docExtractionJobs)
        .values({ documentId: docId, jobType: "pdf_text", status: "queued" })
        .returning();

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
  app.post("/api/admin/seed-demo", requireAdmin, async (req: any, res) => {
    try {
      const { seedDemoData } = await import("./services/demoSeed");
      const agentId = req.user?.id ?? "prod-1";
      const result  = await seedDemoData(agentId);
      res.json(result);
    } catch (err: any) {
      console.error("[Demo Seed] failed:", err?.message);
      res.status(500).json({ message: "Seed failed", error: err?.message });
    }
  });

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

  // ── SendGrid delivery webhook (no auth) ────────────────────────────────────
  app.post("/api/webhooks/sendgrid", async (req: any, res) => {
    try {
      const events: any[] = Array.isArray(req.body) ? req.body : [];
      let matched = 0;

      for (const event of events) {
        const sgMsgId: string | undefined = event.sg_message_id;
        if (!sgMsgId) continue;

        const evtMap: Record<string, string> = {
          delivered:   "delivered",
          bounce:      "bounced",
          dropped:     "failed",
          spamreport:  "spam",
          unsubscribe: "unsubscribed",
        };
        const deliveryStatus = evtMap[event.event as string];
        if (!deliveryStatus) continue;

        // Find reminder whose stored sendgridMessageId is a prefix of the incoming sg_message_id
        const [reminder] = await db
          .select({
            id:        brokerFollowUpReminders.id,
            followUpId: brokerFollowUpReminders.followUpId,
            invoiceId: brokerFollowUps.invoiceId,
          })
          .from(brokerFollowUpReminders)
          .innerJoin(brokerFollowUps, eq(brokerFollowUpReminders.followUpId, brokerFollowUps.id))
          .where(sql`${sgMsgId} LIKE ${brokerFollowUpReminders.sendgridMessageId} || '%'`)
          .limit(1);

        if (!reminder) continue;

        await db
          .update(brokerFollowUpReminders)
          .set({ deliveryStatus, updatedAt: new Date() })
          .where(eq(brokerFollowUpReminders.id, reminder.id));

        // Write to event ledger
        await db.insert(eventLedger).values({
          entityType:  "invoice",
          entityId:    reminder.invoiceId,
          eventType:   `broker_followup_delivery_${deliveryStatus}`,
          actorType:   "system",
          actorId:     "sendgrid",
          payloadJson: {
            reminderId:     reminder.id,
            followUpId:     reminder.followUpId,
            sgMessageId:    sgMsgId,
            deliveryStatus,
            originalEvent:  event.event,
            email:          event.email,
          },
        });

        matched++;
      }

      res.status(200).json({ received: events.length, matched });
    } catch (error: any) {
      console.error("[sendgrid-webhook]", error?.message);
      res.status(500).json({ message: "Webhook processing error" });
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

  // Aging Report
  app.get("/api/reports/aging", requireAuth, async (_req, res) => {
    try {
      const allInvoices = await db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          amount: invoices.amount,
          status: invoices.status,
          invoiceDate: invoices.invoiceDate,
          dueDate: invoices.dueDate,
          createdAt: invoices.createdAt,
          clientId: invoices.clientId,
          debtorId: invoices.debtorId,
          clientName: clients.name,
          debtorName: debtors.name,
        })
        .from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .leftJoin(debtors, eq(invoices.debtorId, debtors.id))
        .where(notInArray(invoices.status, ["paid", "settled", "funded", "rejected"] as any[]));

      const now = Date.now();
      const bucket = (inv: typeof allInvoices[0]) => {
        const base = inv.dueDate ?? inv.invoiceDate ?? inv.createdAt ?? new Date();
        const days = Math.floor((now - new Date(base).getTime()) / 86400000);
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
        const amt = parseFloat(String(inv.amount));
        buckets[b].count++;
        buckets[b].total += amt;
        const carrier = inv.clientName ?? `Carrier #${inv.clientId}`;
        const broker = inv.debtorName ?? (inv.debtorId ? `Broker #${inv.debtorId}` : "Unknown");
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
          debtorId: invoices.debtorId,
          brokerName: debtors.name,
          creditLimit: debtors.creditLimit,
          avgDaysToPay: debtors.averageDaysToPay,
        })
        .from(invoices)
        .leftJoin(debtors, eq(invoices.debtorId, debtors.id));

      const brokerMap: Record<string, { debtorId: number | null; brokerName: string; invoiceCount: number; totalVolume: number; outstanding: number; paid: number; creditLimit: number | null; avgDaysToPay: number | null }> = {};

      for (const row of rows) {
        if (startDate && new Date(row.createdAt!) < new Date(startDate)) continue;
        if (endDate   && new Date(row.createdAt!) > new Date(endDate))   continue;
        const key = String(row.debtorId ?? 0);
        if (!brokerMap[key]) brokerMap[key] = { debtorId: row.debtorId, brokerName: row.brokerName ?? "Unknown", invoiceCount: 0, totalVolume: 0, outstanding: 0, paid: 0, creditLimit: row.creditLimit ? parseFloat(String(row.creditLimit)) : null, avgDaysToPay: row.avgDaysToPay };
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
        .leftJoin(clients, eq(invoices.clientId, clients.id));

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
      let query = db.select().from(dispatchers);
      const conditions: any[] = [];
      if (carrierId) conditions.push(eq(dispatchers.carrierId, parseInt(carrierId as string, 10)));
      if (status && status !== "all") conditions.push(eq(dispatchers.status, status as any));
      const rows = conditions.length
        ? await db.select().from(dispatchers).where(and(...conditions)).orderBy(dispatchers.lastName)
        : await db.select().from(dispatchers).orderBy(dispatchers.lastName);
      res.json(rows);
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
      const data = insertDispatcherSchema.partial().parse(req.body);
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

      const sent = await sendEmail({ to: toEmail, from: "dosh@truckingprosfinancial.com", replyTo: "dosh@truckingprosfinancial.com", subject, html, text: letter.content });
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
  app.post("/api/ai/chat", requireAuth, async (req: any, res) => {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ message: "AI Assistant is not configured. Ask your administrator to set the ANTHROPIC_API_KEY." });
      }

      const { messages } = req.body;
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ message: "messages array is required" });
      }

      const client = new Anthropic({ apiKey });

      const systemPrompt = `You are an internal AI assistant for FactorFlux, a freight factoring operations system built for Trucking Pros Financial. You help agents navigate the system, troubleshoot issues, and understand workflows.

System knowledge:
- Carriers: trucking companies that submit invoices for factoring
- Invoices: freight invoices submitted by carriers for payment advance
- Factoring: 8-stage lifecycle — Document Intake → Verification → Advance → Approval → Collections → Payment Receipt → Final Settlement
- Brokers: freight brokers who owe payment on invoices
- Lockbox: cash application tool to match incoming payments to open invoices
- Held Queue: invoices blocked from funding due to missing docs, disputes, or manual holds
- Fuel Advance: short-term advances to carriers for fuel costs
- Followups: automated broker communication and collections cadence
- Vault: encrypted storage for sensitive carrier data (SSN, bank accounts)
- Portal Submissions: invoices submitted by carriers through the carrier portal at /portal
- Dispatchers: carrier dispatchers linked to carrier records
- Trucks: carrier equipment tracked per carrier
- Bank Transfers: ACH and wire transfer records
- Payroll: agent payroll tracking
- Release Letters: letters sent to brokers upon invoice settlement
- C/B Reviews: credit and background reviews on carriers and brokers
- MC Check: FMCSA authority verification for carriers
- Bulk Invoices: batch invoice processing for high-volume carriers
- Reports: Aging, Agent, Broker, Carrier, Daily AR, Monthly Summary
- Audit Trail/Logs: full system activity log
- Workflow Builder: configurable factoring pipeline stages with SLA targets
- Rules: document classification rules
- Admin: user management, permissions, carrier portal approvals

Common workflows:
- To factor an invoice: Carriers → Create Invoice → Upload BOL and Rate Con → Factoring tab → move through stages
- To hold an invoice: Open invoice → Hold button → select reason
- To match a payment: Lockbox → New Entry → Match to invoice
- To approve a carrier portal user: Admin → Carrier Portal tab → Approve
- To add an agent: Admin → Users tab → Add Agent → set permissions via toggles

Always be helpful, concise, and specific to FactorFlux workflows. If an agent describes an error, ask for details and guide them through fixing it step by step.`;

      const response = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
      });

      const assistantMessage = response.content[0]?.type === "text" ? response.content[0].text : "";

      // Log conversation
      const userId = req.user?.claims?.sub ?? req.user?.id;
      await db.insert(aiChatLogs).values({
        userId,
        messages: [...messages, { role: "assistant", content: assistantMessage }],
      });

      res.json({ message: assistantMessage });
    } catch (error: any) {
      console.error("AI chat error:", error);
      const msg = error?.message ?? "Failed to get AI response";
      res.status(500).json({ message: msg });
    }
  });

  // ─── Bulk Invoices ─────────────────────────────────────────────────────────
  app.get("/api/bulk-invoices", requireAuth, async (req, res) => {
    try {
      const { carrierId, status } = req.query;
      const conditions: any[] = [];
      if (carrierId) conditions.push(eq(bulkInvoiceBatches.carrierId, parseInt(carrierId as string, 10)));
      if (status && status !== "all") conditions.push(eq(bulkInvoiceBatches.status, status as any));
      const rows = conditions.length
        ? await db.select().from(bulkInvoiceBatches).where(and(...conditions)).orderBy(desc(bulkInvoiceBatches.createdAt))
        : await db.select().from(bulkInvoiceBatches).orderBy(desc(bulkInvoiceBatches.createdAt));
      res.json(rows);
    } catch (error) {
      console.error("Error fetching bulk invoices:", error);
      res.status(500).json({ message: "Failed to fetch bulk invoices" });
    }
  });

  app.get("/api/bulk-invoices/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [batch] = await db.select().from(bulkInvoiceBatches).where(eq(bulkInvoiceBatches.id, id)).limit(1);
      if (!batch) return res.status(404).json({ message: "Batch not found" });
      const items = await db.select().from(bulkInvoiceItems).where(eq(bulkInvoiceItems.batchId, id));
      res.json({ ...batch, items });
    } catch (error) {
      console.error("Error fetching bulk invoice batch:", error);
      res.status(500).json({ message: "Failed to fetch batch" });
    }
  });

  app.post("/api/bulk-invoices", requireAuth, async (req: any, res) => {
    try {
      const userId = req.user?.claims?.sub ?? req.user?.id;
      const { items: itemList, ...batchBody } = req.body;
      const parsedItems = Array.isArray(itemList) ? itemList : [];
      const totalAmount = parsedItems.reduce((s: number, i: any) => s + Number(i.amount || 0), 0);
      const batch = insertBulkInvoiceBatchSchema.parse({
        batchName: batchBody.batchName,
        carrierId: parseInt(batchBody.carrierId, 10),
        totalAmount: totalAmount.toFixed(2),
        invoiceCount: parsedItems.length,
        status: "draft",
        createdBy: userId,
      });
      const [created] = await db.insert(bulkInvoiceBatches).values(batch).returning();
      if (parsedItems.length > 0) {
        const rows = parsedItems.map((i: any) => insertBulkInvoiceItemSchema.parse({
          batchId: created.id,
          invoiceNumber: i.invoiceNumber,
          loadNumber: i.loadNumber ?? null,
          amount: String(Number(i.amount).toFixed(2)),
          brokerName: i.brokerName ?? null,
          status: "pending",
          notes: i.notes ?? null,
        }));
        await db.insert(bulkInvoiceItems).values(rows);
      }
      const items = await db.select().from(bulkInvoiceItems).where(eq(bulkInvoiceItems.batchId, created.id));
      res.status(201).json({ ...created, items });
    } catch (error) {
      if (error instanceof z.ZodError) {
        console.error("[POST /api/bulk-invoices] Zod error:", error.errors);
        return res.status(400).json({ message: error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "), errors: error.errors });
      }
      console.error("Error creating bulk invoice batch:", error);
      res.status(500).json({ message: "Failed to create batch" });
    }
  });

  app.patch("/api/bulk-invoices/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [existing] = await db.select().from(bulkInvoiceBatches).where(eq(bulkInvoiceBatches.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Batch not found" });
      const { status, batchName } = req.body;
      const updates: any = {};
      if (batchName) updates.batchName = batchName;
      if (status) {
        updates.status = status;
        if (status === "submitted" && !existing.submittedAt) updates.submittedAt = new Date();
      }
      const [updated] = await db.update(bulkInvoiceBatches).set(updates).where(eq(bulkInvoiceBatches.id, id)).returning();
      const items = await db.select().from(bulkInvoiceItems).where(eq(bulkInvoiceItems.batchId, id));
      res.json({ ...updated, items });
    } catch (error) {
      console.error("Error updating bulk invoice batch:", error);
      res.status(500).json({ message: "Failed to update batch" });
    }
  });

  app.delete("/api/bulk-invoices/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [existing] = await db.select().from(bulkInvoiceBatches).where(eq(bulkInvoiceBatches.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Batch not found" });
      if (existing.status !== "draft") return res.status(400).json({ message: "Only draft batches can be deleted" });
      await db.delete(bulkInvoiceItems).where(eq(bulkInvoiceItems.batchId, id));
      await db.delete(bulkInvoiceBatches).where(eq(bulkInvoiceBatches.id, id));
      res.json({ message: "Deleted" });
    } catch (error) {
      console.error("Error deleting bulk invoice batch:", error);
      res.status(500).json({ message: "Failed to delete batch" });
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
      const conditions: any[] = [];
      if (carrierId) conditions.push(eq(trucks.carrierId, parseInt(carrierId as string, 10)));
      if (dispatcherId) conditions.push(eq(trucks.dispatcherId, parseInt(dispatcherId as string, 10)));
      if (status && status !== "all") conditions.push(eq(trucks.status, status as any));
      const rows = conditions.length
        ? await db.select().from(trucks).where(and(...conditions)).orderBy(trucks.truckNumber)
        : await db.select().from(trucks).orderBy(trucks.truckNumber);
      res.json(rows);
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
      const data = insertTruckSchema.partial().parse(req.body);
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
      const [row] = await db.update(trucks).set({ status: "inactive" }).where(eq(trucks.id, id)).returning();
      if (!row) return res.status(404).json({ message: "Truck not found" });
      res.json(row);
    } catch (error) {
      console.error("Error deactivating truck:", error);
      res.status(500).json({ message: "Failed to deactivate truck" });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CARRIER PORTAL ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  const portalUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /jpeg|jpg|png|pdf|tiff|tif/;
      if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
        return cb(null, true);
      }
      cb(new Error("Only PDF, JPEG, JPG, PNG, and TIFF files are allowed"));
    },
  });

  const requirePortalAuth = (req: any, res: any, next: any) => {
    const portalUser = (req.session as any)?.portalUser;
    if (!portalUser) return res.status(401).json({ message: "Portal authentication required" });
    req.portalUser = portalUser;
    next();
  };

  // ── Portal Auth ────────────────────────────────────────────────────────────
  app.post("/api/portal/register", async (req, res) => {
    try {
      const { email, password, companyName, mcNumber, dotNumber } = req.body;
      if (!email || !password || !companyName) {
        return res.status(400).json({ message: "Email, password, and company name are required" });
      }
      const [existing] = await db.select().from(carrierPortalUsers).where(eq(carrierPortalUsers.email, email.toLowerCase())).limit(1);
      if (existing) return res.status(409).json({ message: "An account with this email already exists" });
      const passwordHash = await bcrypt.hash(password, 10);
      const [user] = await db.insert(carrierPortalUsers).values({
        email: email.toLowerCase(),
        passwordHash,
        companyName,
        mcNumber: mcNumber || null,
        dotNumber: dotNumber || null,
        status: "pending",
      }).returning();

      // Send registration confirmation to carrier
      const regHtml = `
        <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;">
          <div style="background:#1e40af;color:#fff;border-radius:12px 12px 0 0;padding:20px 24px;">
            <h2 style="margin:0;">Carrier Portal — Registration Received</h2>
            <p style="margin:4px 0 0;opacity:.8;font-size:13px;">Trucking Pros Financial</p>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
            <p style="color:#374151;">Hi ${companyName},</p>
            <p style="color:#374151;">Thank you for registering on the Trucking Pros Financial carrier portal. Your account is <strong>pending approval</strong>.</p>
            <p style="color:#374151;">Our team will review your information and notify you once your account has been approved. This typically takes 1–2 business days.</p>
            <p style="color:#374151;">If you have questions, reply to this email or call us at <strong>385-495-4962</strong>.</p>
            <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;" />
            <p style="color:#9ca3af;font-size:12px;margin:0;">Trucking Pros Financial · Support@Truckingprosfinancial.com · 385-495-4962</p>
          </div>
        </div>`;
      sendEmail({
        to: user.email,
        from: "dosh@truckingprosfinancial.com",
        replyTo: "dosh@truckingprosfinancial.com",
        subject: "Carrier Portal — Registration Received (Pending Approval)",
        html: regHtml,
        text: `Hi ${companyName},\n\nThank you for registering. Your account is pending approval. We will notify you once approved.\n\nTrucking Pros Financial\nSupport@Truckingprosfinancial.com`,
      }).catch(() => {});

      res.status(201).json({ message: "Registration successful. Pending approval.", id: user.id });
    } catch (error) {
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
      res.json({ id: user.id, email: user.email, companyName: user.companyName, mcNumber: user.mcNumber, dotNumber: user.dotNumber, status: user.status });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch profile" });
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
      const result = subs.map((s) => ({
        ...s,
        documents: docs.filter((d) => d.submissionId === s.id),
      }));
      res.json(result);
    } catch (error) {
      console.error("Portal submissions error:", error);
      res.status(500).json({ message: "Failed to fetch submissions" });
    }
  });

  app.post("/api/portal/submissions", requirePortalAuth, (req: any, res, next) => {
    portalUpload.array("documents", 10)(req, res, (err: any) => {
      if (err) return res.status(400).json({ message: err.message || "File upload error" });
      next();
    });
  }, async (req: any, res) => {
    try {
      const { loadNumber, invoiceNumber, brokerName, amount, paymentType } = req.body;
      if (!loadNumber || !brokerName) return res.status(400).json({ message: "Load number and broker name are required" });
      const [sub] = await db.insert(carrierSubmissions).values({
        portalUserId: req.portalUser.id,
        carrierId: null,
        loadNumber,
        invoiceNumber: invoiceNumber || null,
        brokerName,
        amount: amount ? String(amount) : null,
        paymentType: paymentType || "ACH",
        status: "submitted",
      }).returning();

      const files: Express.Multer.File[] = (req.files as Express.Multer.File[]) || [];
      const docTypes: string[] = Array.isArray(req.body.documentTypes) ? req.body.documentTypes : (req.body.documentTypes ? [req.body.documentTypes] : []);
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const dtype = (docTypes[i] || "other") as "rate_confirmation" | "bol" | "lumper_receipt" | "other";
        const portalFileUuid = crypto.randomUUID();
        const portalS3Key = await uploadToS3(file.buffer, `portal/${portalFileUuid}`, file.mimetype);
        await db.insert(carrierSubmissionDocs).values({
          submissionId: sub.id,
          documentType: dtype,
          filename: portalFileUuid,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          s3Key: portalS3Key,
        });
      }
      res.status(201).json(sub);
    } catch (error) {
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

  app.get("/api/portal/submissions/:id/documents/:docId/view", async (req: any, res) => {
    try {
      const docId = parseInt(req.params.docId, 10);
      const [doc] = await db.select().from(carrierSubmissionDocs).where(eq(carrierSubmissionDocs.id, docId)).limit(1);
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

  app.get("/api/portal/submissions/:id/documents/:docId/download", async (req: any, res) => {
    try {
      const docId = parseInt(req.params.docId, 10);
      const [doc] = await db.select().from(carrierSubmissionDocs).where(eq(carrierSubmissionDocs.id, docId)).limit(1);
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

  // ── Agent-facing Portal Routes ─────────────────────────────────────────────
  app.get("/api/carrier-portal/submissions", requireAuth, async (_req, res) => {
    try {
      const subs = await db.select().from(carrierSubmissions).orderBy(desc(carrierSubmissions.submittedAt));
      const subIds = subs.map((s) => s.id);
      const docs = subIds.length
        ? await db.select().from(carrierSubmissionDocs).where(inArray(carrierSubmissionDocs.submissionId, subIds))
        : [];
      const userIds = [...new Set(subs.map((s) => s.portalUserId))];
      const portalUsers = userIds.length
        ? await db.select().from(carrierPortalUsers).where(inArray(carrierPortalUsers.id, userIds))
        : [];
      const userMap = Object.fromEntries(portalUsers.map((u) => [u.id, u]));
      const result = subs.map((s) => ({
        ...s,
        companyName: userMap[s.portalUserId]?.companyName ?? null,
        documents: docs.filter((d) => d.submissionId === s.id),
      }));
      res.json(result);
    } catch (error) {
      console.error("Agent portal submissions error:", error);
      res.status(500).json({ message: "Failed to fetch submissions" });
    }
  });

  app.patch("/api/carrier-portal/submissions/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { status, notes } = req.body;
      const validStatuses = ["submitted", "under_review", "approved", "funded", "rejected"];
      if (status && !validStatuses.includes(status)) return res.status(400).json({ message: "Invalid status" });

      // Fetch existing submission + portal user email before update
      const [existing] = await db.select().from(carrierSubmissions).where(eq(carrierSubmissions.id, id)).limit(1);
      if (!existing) return res.status(404).json({ message: "Submission not found" });

      const [updated] = await db.update(carrierSubmissions)
        .set({ ...(status && { status }), ...(notes !== undefined && { notes }) })
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
                  <h2 style="margin:0;">Submission Update — ${statusLabels[status] ?? status}</h2>
                  <p style="margin:4px 0 0;opacity:.8;font-size:13px;">Trucking Pros Financial</p>
                </div>
                <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
                  <p style="color:#374151;">Hi ${portalUser.companyName},</p>
                  <p style="color:#374151;">${statusMessages[status] ?? `Your submission status has been updated to <strong>${status}</strong>.`}</p>
                  <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin:16px 0;">
                    <p style="margin:0 0 6px;font-size:13px;color:#374151;"><strong>Load #:</strong> ${existing.loadNumber}</p>
                    ${existing.invoiceNumber ? `<p style="margin:0 0 6px;font-size:13px;color:#374151;"><strong>Invoice #:</strong> ${existing.invoiceNumber}</p>` : ""}
                    ${existing.amount ? `<p style="margin:0;font-size:13px;color:#374151;"><strong>Amount:</strong> $${existing.amount}</p>` : ""}
                  </div>
                  ${notes ? `<p style="color:#374151;font-size:13px;"><strong>Notes:</strong> ${notes}</p>` : ""}
                  <p style="color:#374151;">Questions? Reply to this email or call us at <strong>385-495-4962</strong>.</p>
                  <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;" />
                  <p style="color:#9ca3af;font-size:12px;margin:0;">Trucking Pros Financial · Support@Truckingprosfinancial.com · 385-495-4962</p>
                </div>
              </div>`;
            sendEmail({
              to: portalUser.email,
              from: "dosh@truckingprosfinancial.com",
              replyTo: "dosh@truckingprosfinancial.com",
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

  app.get("/api/carrier-portal/users", requireAdmin, async (_req, res) => {
    try {
      const users = await db.select().from(carrierPortalUsers).orderBy(desc(carrierPortalUsers.createdAt));
      res.json(users.map((u) => ({ ...u, passwordHash: undefined })));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch portal users" });
    }
  });

  app.patch("/api/carrier-portal/users/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { status, carrierId } = req.body;
      const validStatuses = ["pending", "active", "suspended"];
      if (status && !validStatuses.includes(status)) return res.status(400).json({ message: "Invalid status" });
      const [updated] = await db.update(carrierPortalUsers)
        .set({ ...(status && { status }), ...(carrierId !== undefined && { carrierId }) })
        .where(eq(carrierPortalUsers.id, id))
        .returning();
      if (!updated) return res.status(404).json({ message: "Portal user not found" });
      res.json({ ...updated, passwordHash: undefined });
    } catch (error) {
      res.status(500).json({ message: "Failed to update portal user" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}