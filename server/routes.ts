import type { Express } from "express";
import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { z } from "zod";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

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
} from "@shared/schema";
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
  dest: "uploads/",
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

function vaultKey(): Buffer {
  const secret = process.env.VAULT_SECRET || process.env.SESSION_SECRET || "vault-default-secret-key";
  return crypto.scryptSync(secret, "vault-salt-v1", 32);
}

function encryptVault(plaintext: string): string {
  const key = vaultKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptVault(encryptedText: string): string {
  try {
    const key = vaultKey();
    const parts = encryptedText.split(":");
    if (parts.length !== 3) return "***LEGACY***";
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final("utf8");
  } catch {
    return "***DECRYPTION ERROR***";
  }
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

const PRODUCTION_USERS = [
  {
    username: "agent1",
    password: "$2b$10$6yrEqMAIrQ6dkKX/1N6NyeUPNiENkuVsNDCQIFQIwauFxepIEDVla",
    name: "Production Agent",
    role: "employee",
    id: "prod-1",
    firstName: "TPF",
    lastName: "Agent",
    verified: false,
  },
  {
    username: "manager1",
    password: "$2b$10$6yrEqMAIrQ6dkKX/1N6NyeUPNiENkuVsNDCQIFQIwauFxepIEDVla",
    name: "Production Manager",
    role: "manager",
    id: "prod-2",
    firstName: "TPF",
    lastName: "Manager",
    verified: false,
  },
  {
    username: "admin1",
    password: "$2b$10$6yrEqMAIrQ6dkKX/1N6NyeUPNiENkuVsNDCQIFQIwauFxepIEDVla",
    name: "System Administrator",
    role: "admin",
    id: "prod-3",
    firstName: "System",
    lastName: "Admin",
    verified: true,
  },
];

export async function registerRoutes(app: Express): Promise<Server> {
  // Ensure production users exist in the DB so FK constraints (e.g. activities.user_id) never fail
  try {
    for (const u of PRODUCTION_USERS) {
      await db
        .insert(users)
        .values({
          id: u.id,
          email: u.username === "agent1" ? "agent1@tpf.com" : u.username === "manager1" ? "manager1@tpf.com" : "admin1@tpf.com",
          password: u.password,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role as "employee" | "manager" | "admin",
          authType: "local",
          verified: u.verified,
          status: "active",
        })
        .onConflictDoNothing();
    }
    console.log("[startup] Production users synced to DB");
  } catch (err: any) {
    console.warn("[startup] Could not sync production users (non-fatal):", err?.message);
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

  // Auth
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      // 1. Check hardcoded production users first (by username)
      const prodUser = PRODUCTION_USERS.find((u) => u.username === username);
      if (prodUser) {
        const isValid = await bcrypt.compare(password, prodUser.password);
        if (!isValid) return res.status(401).json({ message: "Invalid credentials" });

        // Check live DB status for prod users (allows admin to suspend them)
        const dbRecord = await storage.getUser(prodUser.id);
        if (dbRecord && (dbRecord as any).status === "suspended") {
          return res.status(403).json({ message: "Your account has been suspended. Contact your administrator." });
        }

        const sessionUser = {
          id: prodUser.id,
          username: prodUser.username,
          name: prodUser.name,
          role: prodUser.role,
          firstName: prodUser.firstName,
          lastName: prodUser.lastName,
          verified: prodUser.verified,
        };
        (req.session as any).user = sessionUser;
        return res.json({ success: true, user: sessionUser });
      }

      // 2. Fall back to DB users (login with email as username)
      const dbUser = await storage.getUserByEmail(username);
      if (!dbUser || !dbUser.password) {
        return res.status(401).json({ message: "Invalid credentials" });
      }

      const isValid = await bcrypt.compare(password, dbUser.password);
      if (!isValid) return res.status(401).json({ message: "Invalid credentials" });

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
      };
      (req.session as any).user = sessionUser;
      return res.json({ success: true, user: sessionUser });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/auth/verify", (req, res) => {
    const user = (req.session as any)?.user;
    if (user) {
      return res.json({ user });
    }
    return res.status(401).json({ message: "Not authenticated" });
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

  app.post("/api/user/profile-image", handleUpload("profileImage"), async (req: any, res) => {
    try {
      const userId = "1";

      if (!req.file) {
        return res.status(400).json({ message: "No image file provided" });
      }

      const profileImageUrl = `/uploads/${req.file.filename}`;

      await storage.updateUserProfile(userId, { profileImageUrl });
      const updatedUser = await storage.getUser(userId);

      res.json({
        message: "Profile image updated successfully",
        user: updatedUser,
      });
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
      const senderEmail = "doshbarzanji@gmail.com";

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
        from: senderEmail,
        subject: `[FactorFlux Help] ${subject} - ${email}`,
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

      const supportEmail = "doshbarzanji@gmail.com";
      const senderEmail = "dosh@truckingprosfinancial.com";

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
        to: supportEmail,
        from: senderEmail,
        subject: `[FactorFlux Help] ${subject} - ${email}`,
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
          from: "Support@Truckingprosfinancial.com",
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
        from: "Support@Truckingprosfinancial.com",
        subject: "Your FactorFlux Account Has Been Created",
        text: `Welcome to FactorFlux!\n\nEmail: ${email}\nTemporary Password: ${password}\n\nPlease log in at ${req.protocol}://${req.get("host")}/login`,
        html: welcomeHtml,
      });

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

  app.post("/api/invoices/:id/documents", requireAuth, handleUpload("file"), async (req: any, res) => {
    try {
      const invoiceId = parseInt(req.params.id, 10);
      if (Number.isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { documentType, sourceChannel } = req.body;
      const processedOriginalName = sanitizeOriginalName(req.file.originalname);

      const documentData = {
        filename: req.file.filename,
        originalName: processedOriginalName,
        mimeType: req.file.mimetype,
        size: req.file.size,
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

      const processedFilename = req.file.filename;
      const processedMimeType = req.file.mimetype;
      const processedOriginalName = sanitizeOriginalName(req.file.originalname);

      if (req.file.mimetype.includes("jpeg") || req.file.mimetype.includes("jpg")) {
        console.log("Image uploaded as-is (PDF conversion disabled for web deployment)");
      }

      const documentData = {
        filename: processedFilename,
        originalName: processedOriginalName,
        mimeType: processedMimeType,
        size: req.file.size,
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
        const filePath = path.join("uploads", document.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (fileError) {
        console.warn("Could not delete physical file:", fileError);
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
        if (!res.headersSent) {
          res.status(500).json({ message: "Error streaming file" });
        }
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
        if (!res.headersSent) {
          res.status(500).json({ message: "Error streaming file" });
        }
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

  // ─── Invoice detail (all related data) ───────────────────────────────────
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
      });
      const { transitionId, reason, force } = schema.parse(req.body);
      const result = await performTransition(
        id, transitionId, req.user.id, req.user.role ?? "employee", reason, force,
      );
      res.json(result);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message });
      console.error("Error performing transition:", err);
      res.status(500).json({ message: "Failed to perform transition" });
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
      res.json({ ...raw, rules: flatRules });
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

  app.patch("/api/fuel-card-applications/:id", async (req, res) => {
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
      const userId = "1";
      const limit = parseInt(req.query.limit as string, 10) || 20;
      const notifications = await storage.getNotifications(userId, limit);
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.get("/api/notifications/unread-count", requireAuth, async (_req: any, res) => {
    try {
      const count = await storage.getUnreadNotificationCount("1");
      res.json({ count });
    } catch (error) {
      console.error("Error fetching unread notification count:", error);
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  app.patch("/api/notifications/:id/read", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      await storage.markNotificationAsRead(id);
      res.json({ message: "Notification marked as read" });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  });

  app.patch("/api/notifications/mark-all-read", requireAuth, async (_req: any, res) => {
    try {
      await storage.markAllNotificationsAsRead("1");
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

  // Update a reminder (skip, cancel, restore, reschedule)
  app.patch("/api/broker-follow-up-reminders/:id", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const updates: Record<string, unknown> = { ...req.body, updatedAt: new Date() };
      const [updated] = await db
        .update(brokerFollowUpReminders)
        .set(updates as any)
        .where(eq(brokerFollowUpReminders.id, id))
        .returning();
      if (!updated) return res.status(404).json({ message: "Reminder not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating reminder:", error);
      res.status(500).json({ message: "Failed to update reminder" });
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

      const { entityType, entityId } = req.body;
      const validEntityTypes = ["invoice", "load", "client", "broker"];
      if (!validEntityTypes.includes(entityType)) {
        return res.status(400).json({ message: "Invalid entityType" });
      }
      const eid = parseInt(entityId, 10);
      if (isNaN(eid)) return res.status(400).json({ message: "Invalid entityId" });

      const docData: any = {
        filename:     req.file.filename,
        originalName: sanitizeOriginalName(req.file.originalname),
        mimeType:     req.file.mimetype,
        size:         req.file.size,
        documentType: "other" as const,
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

      const filePath = path.join("uploads", doc.filename);
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

  const httpServer = createServer(app);
  return httpServer;
}