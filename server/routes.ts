import type { Express } from "express";
import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";

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
} from "@shared/schema";

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
      const uniqueInvoiceIds = [...new Set(lines.map((l: any) => l.invoiceId).filter(Boolean))];
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

  const httpServer = createServer(app);
  return httpServer;
}