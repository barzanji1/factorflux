import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupLocalAuth } from "./localAuth";
import { 
  insertClientSchema, 
  insertLoadSchema, 
  insertInvoiceSchema,
  insertDocumentSchema,
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
  type Task,
  type InsertTask,
  type Broker,
  type InsertBroker,
  type FuelAdvance,
  type InsertFuelAdvance
} from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
// jsPDF removed for web deployment optimization
import { sendDesktopInstallers, sendEmail } from "./emailService";

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only PDF, JPEG, JPG, and PNG files are allowed'));
    }
  },
});

// Helper function to get user ID - authentication removed
function getUserId(req: any): string | null {
  // Return default user ID since authentication is disabled
  return "1";
}

// Helper function to get current user - authentication removed
async function getCurrentUser(req: any): Promise<any> {
  // Return default admin user since authentication is disabled
  return { id: "1", firstName: "Admin", lastName: "User", role: "admin", email: "admin@tpf.com" };
}

// Production credentials with secure bcrypt hashes  
const PRODUCTION_USERS = [
  {
    username: "agent1",
    password: "$2b$10$6yrEqMAIrQ6dkKX/1N6NyeUPNiENkuVsNDCQIFQIwauFxepIEDVla", // "tpf2025!"
    name: "Production Agent",
    role: "agent",
    id: "prod-1",
    firstName: "TPF",
    lastName: "Agent"
  },
  {
    username: "manager1", 
    password: "$2b$10$6yrEqMAIrQ6dkKX/1N6NyeUPNiENkuVsNDCQIFQIwauFxepIEDVla", // "tpf2025!"
    name: "Production Manager",
    role: "manager",
    id: "prod-2",
    firstName: "TPF",
    lastName: "Manager"
  },
  {
    username: "admin1",
    password: "$2b$10$6yrEqMAIrQ6dkKX/1N6NyeUPNiENkuVsNDCQIFQIwauFxepIEDVla", // "tpf2025!"
    name: "System Administrator", 
    role: "admin",
    id: "prod-3",
    firstName: "System",
    lastName: "Admin"
  }
];

export async function registerRoutes(app: Express): Promise<Server> {
  // Authentication endpoints
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      // Find user in production credentials
      const user = PRODUCTION_USERS.find(u => u.username === username);
      
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      
      // Verify password with bcrypt
      const isValid = await bcrypt.compare(password, user.password);
      
      if (!isValid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      
      // Store in session
      (req.session as any).user = {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      };
      
      res.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName
        }
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/auth/verify", (req, res) => {
    const user = (req.session as any)?.user;
    if (user) {
      res.json({ user });
    } else {
      res.status(401).json({ message: "Not authenticated" });
    }
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

  // Middleware to check authentication for protected routes
  const requireAuth = (req: any, res: any, next: any) => {
    console.log("RequireAuth middleware - session:", !!req.session, "user:", !!(req.session as any)?.user);
    const user = (req.session as any)?.user;
    if (!user) {
      console.log("Authentication required - no user in session");
      return res.status(401).json({ message: "Authentication required" });
    }
    req.user = user;
    console.log("Authentication successful - user ID:", user.id);
    next();
  };
  app.get('/api/auth/user', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Don't send password in response
      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Profile routes
  app.patch('/api/user/profile', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id; // Use authenticated user ID

      const updates = req.body;
      
      // Validate input
      const validUpdates = [
        'firstName', 'lastName', 'phone', 'jobTitle', 'department',
        'bio', 'location', 'timezone', 'language',
        'emailNotifications', 'smsNotifications', 'desktopNotifications',
        'startTime', 'endTime', 'workDays',
        'theme', 'dateFormat', 'timeFormat'
      ];
      const filteredUpdates = Object.keys(updates)
        .filter(key => validUpdates.includes(key))
        .reduce((obj: any, key) => {
          obj[key] = updates[key];
          return obj;
        }, {});

      await storage.updateUserProfile(userId, filteredUpdates);
      
      // Return a simple success message instead of trying to fetch updated user
      res.json({ 
        message: "Profile updated successfully",
        success: true 
      });
    } catch (error) {
      console.error("Error updating user profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

        app.post("/api/support/contact", async (req, res) => {
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

  // Admin routes - Role management
  app.get('/api/admin/users', async (req: any, res) => {
    try {
      // Authentication removed - admin access enabled by default
      const currentUser = { id: "1", role: "admin" };

      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

 
  
 
    // Profile routes
    app.patch('/api/user/profile', requireAuth, async (req: any, res) => {
      try {
        const userId = req.user.id;

        const updates = req.body;

        const validUpdates = [
          'firstName', 'lastName', 'phone', 'jobTitle', 'department',
          'bio', 'location', 'timezone', 'language',
          'emailNotifications', 'smsNotifications', 'desktopNotifications',
          'startTime', 'endTime', 'workDays',
          'theme', 'dateFormat', 'timeFormat'
        ];

        const filteredUpdates = Object.keys(updates)
          .filter((key) => validUpdates.includes(key))
          .reduce((obj: any, key) => {
            obj[key] = updates[key];
            return obj;
          }, {});

        await storage.updateUserProfile(userId, filteredUpdates);

        res.json({
          message: "Profile updated successfully",
          success: true
        });
      } catch (error) {
        console.error("Error updating user profile:", error);
        res.status(500).json({ message: "Failed to update profile" });
      }
    });

    app.post('/api/user/profile-image', upload.single('profileImage'), async (req: any, res) => {
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
          user: updatedUser
        });
      } catch (error) {
        console.error("Error uploading profile image:", error);
        res.status(500).json({ message: "Failed to upload profile image" });
      }
    });

    // Admin routes - Role management
    app.get('/api/admin/users', async (req: any, res) => {
      try {
        const users = await storage.getAllUsers();
        res.json(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Failed to fetch users" });
      }
    });
  
  // Profile 
  app.post("/api/support/messages", async (req, res) => {
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

  app.get("/api/support/messages", async (_req, res) => {
    try {
      const messages = await storage.getSupportMessages();
      res.json(messages);
    } catch (error) {
      console.error("Error fetching support messages:", error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

    // Dashboard routes
    app.get('/api/dashboard/stats', async (req, res) => {
      try {
        const stats = await storage.getDashboardStats();
        res.json(stats);
      } catch (error) {
        console.error("Error fetching dashboard stats:", error);
        res.status(500).json({ message: "Failed to fetch dashboard statistics" });
      }
    });

    app.get('/api/dashboard/recent-activities', async (req, res) => {
      try {
        const activities = await storage.getActivities(10);
        res.json(activities);
      } catch (error) {
        console.error("Error fetching recent activities:", error);
        res.status(500).json({ message: "Failed to fetch recent activities" });
      }
    });

    // All activities endpoint
    app.get('/api/activities', async (req, res) => {
      try {
        const activities = await storage.getActivities();
        res.json(activities);
      } catch (error) {
        console.error("Error fetching all activities:", error);
        res.status(500).json({ message: "Failed to fetch activities" });
      }
    });

    // Clear all activities endpoint
    app.delete('/api/activities', requireAuth, async (req: any, res) => {
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

    // Document routes
    app.get('/api/documents', async (req, res) => {
      try {
        const { load, invoice, entityType, entityId } = req.query;
        let documents;

        if (entityType && entityId) {
          documents = await storage.getDocumentsByEntity(
            entityType as string,
            parseInt(entityId as string)
          );
        } else if (load) {
          const loadId = parseInt(load as string);
          documents = await storage.getDocumentsByLoad(loadId);
        } else if (invoice) {
          const invoiceId = parseInt(invoice as string);
          documents = await storage.getDocumentsByInvoice(invoiceId);
        } else {
          documents = await storage.getDocuments();
        }

        res.json(documents);
      } catch (error) {
        console.error("Error fetching documents:", error);
        res.status(500).json({ message: "Failed to fetch documents" });
      }
    });

    app.get('/api/documents/:id', async (req, res) => {
      try {
        const id = parseInt(req.params.id);
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

    async function convertImageToPdf(inputPath: string, outputPath: string): Promise<void> {
      throw new Error('PDF conversion temporarily unavailable');
    }

    app.post('/api/documents/upload', requireAuth, upload.single('file'), async (req: any, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ message: "No file uploaded" });
        }

        const { documentType, loadId, invoiceId } = req.body;
        let processedFilename = req.file.filename;
        let processedMimeType = req.file.mimetype;
        let processedOriginalName = req.file.originalname;

        if (req.file.mimetype.includes('jpeg') || req.file.mimetype.includes('jpg')) {
          console.log('Image uploaded as-is (PDF conversion disabled for web deployment)');
        }

        const documentData = {
          filename: processedFilename,
          originalName: processedOriginalName,
          mimeType: processedMimeType,
          size: req.file.size,
          documentType: documentType || 'other',
          loadId: loadId && loadId !== 'undefined' ? parseInt(loadId) : null,
          invoiceId: invoiceId && invoiceId !== 'undefined' ? parseInt(invoiceId) : null,
          uploadedBy: req.user.id,
          status: 'processing' as const,
        };

        const document = await storage.createDocument(documentData);

        await storage.createActivity({
          userId: req.user.id,
          type: 'document_uploaded',
          description: `Uploaded document: ${document.originalName}`,
          entityType: 'document',
          entityId: document.id,
        });

        setTimeout(async () => {
          try {
            await storage.updateDocument(document.id, { status: 'processed' });
          } catch (error) {
            console.error("Error updating document status:", error);
          }
        }, 2000);

        res.status(201).json(document);
      } catch (error) {
        console.error("Error uploading document:", error);
        res.status(500).json({ message: "Failed to upload document" });
      }
    });

    app.delete('/api/documents/:id', requireAuth, async (req: any, res) => {
      try {
        const id = parseInt(req.params.id);

        if (isNaN(id)) {
          return res.status(400).json({ message: "Invalid document ID" });
        }

        const document = await storage.getDocument(id);

        if (!document) {
          return res.status(404).json({ message: "Document not found" });
        }

        await storage.deleteDocument(id);

        try {
          const filePath = path.join('uploads', document.filename);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (fileError) {
          console.warn("Could not delete physical file:", fileError);
        }

        await storage.createActivity({
          userId: req.user.id,
          type: 'document_deleted',
          description: `Deleted document: ${document.originalName}`,
          entityType: 'document',
          entityId: document.id,
        });

        res.json({ message: "Document deleted successfully" });
      } catch (error) {
        console.error("Error deleting document:", error);
        res.status(500).json({ message: "Failed to delete document" });
      }
    });

    // Document download/view routes
    app.get('/api/documents/:id/download', async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const document = await storage.getDocument(id);

        if (!document) {
          return res.status(404).json({ message: "Document not found" });
        }

        let filePath = path.resolve(process.cwd(), 'uploads', document.filename);
        if (!fs.existsSync(filePath)) {
          filePath = path.resolve(process.cwd(), 'uploads', document.filename + '.pdf');
          if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${document.filename} or ${document.filename}.pdf`);
            return res.status(404).json({ message: "File not found on disk" });
          }
        }

        const stats = fs.statSync(filePath);

        res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${document.originalName}"`);
        res.setHeader('Content-Length', stats.size.toString());
        res.setHeader('Cache-Control', 'no-cache');

        const fileStream = fs.createReadStream(filePath);
        fileStream.on('error', (error) => {
          console.error('Error streaming file:', error);
          if (!res.headersSent) {
            res.status(500).json({ message: 'Error streaming file' });
          }
        });
        fileStream.pipe(res);
      } catch (error) {
        console.error("Error downloading document:", error);
        res.status(500).json({ message: "Failed to download document" });
      }
    });

    app.get('/api/documents/:id/view', async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const document = await storage.getDocument(id);

        if (!document) {
          return res.status(404).json({ message: "Document not found" });
        }

        let filePath = path.resolve(process.cwd(), 'uploads', document.filename);
        if (!fs.existsSync(filePath)) {
          filePath = path.resolve(process.cwd(), 'uploads', document.filename + '.pdf');
          if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${document.filename} or ${document.filename}.pdf`);
            return res.status(404).json({ message: "File not found on disk" });
          }
        }

        res.setHeader('Content-Type', document.mimeType);
        res.setHeader('Content-Disposition', `inline; filename="${document.originalName}"`);

        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
      } catch (error) {
        console.error("Error viewing document:", error);
        res.status(500).json({ message: "Failed to view document" });
      }
    });

  // Client routes
  app.get('/api/clients', async (req, res) => {
    try {
      const clients = await storage.getClients();
      res.json(clients);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  app.get('/api/clients/search', async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ message: "Search query is required" });
      }
      const clients = await storage.searchClients(q);
      res.json(clients);
    } catch (error) {
      console.error("Error searching clients:", error);
      res.status(500).json({ message: "Failed to search clients" });
    }
  });

  app.get('/api/clients/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const client = await storage.getClient(id);
      if (!client) {
        return res.status(404).json({ message: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      console.error("Error fetching client:", error);
      res.status(500).json({ message: "Failed to fetch client" });
    }
  });

  app.post('/api/clients', async (req: any, res) => {
    try {
      const clientData = insertClientSchema.parse(req.body);
      const client = await storage.createClient(clientData);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        type: 'client_created',
        description: `Created new client: ${client.name}`,
        entityType: 'client',
        entityId: client.id,
      });

      res.status(201).json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid client data", errors: error.errors });
      }
      console.error("Error creating client:", error);
      res.status(500).json({ message: "Failed to create client" });
    }
  });

  app.put('/api/clients/:id', async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const clientData = insertClientSchema.partial().parse(req.body);
      const client = await storage.updateClient(id, clientData);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        type: 'client_updated',
        description: `Updated client: ${client.name}`,
        entityType: 'client',
        entityId: client.id,
      });

      res.json(client);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid client data", errors: error.errors });
      }
      console.error("Error updating client:", error);
      res.status(500).json({ message: "Failed to update client" });
    }
  });

  // Load routes
  app.get('/api/loads', async (req, res) => {
    try {
      const loads = await storage.getLoads();
      res.json(loads);
    } catch (error) {
      console.error("Error fetching loads:", error);
      res.status(500).json({ message: "Failed to fetch loads" });
    }
  });

  app.get('/api/loads/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const load = await storage.getLoad(id);
      if (!load) {
        return res.status(404).json({ message: "Load not found" });
      }
      res.json(load);
    } catch (error) {
      console.error("Error fetching load:", error);
      res.status(500).json({ message: "Failed to fetch load" });
    }
  });

  app.post('/api/loads', async (req: any, res) => {
    try {
      const loadData = insertLoadSchema.parse(req.body);
      const load = await storage.createLoad(loadData);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        type: 'load_created',
        description: `Created new load: ${load.loadNumber}`,
        entityType: 'load',
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

  // Invoice routes
  app.get('/api/invoices', async (req, res) => {
    try {
      const { status, client } = req.query;
      let invoices;
      
      if (status && typeof status === 'string') {
        invoices = await storage.getInvoicesByStatus(status);
      } else if (client) {
        const clientId = parseInt(client as string);
        invoices = await storage.getInvoicesByClient(clientId);
      } else {
        invoices = await storage.getInvoices();
      }
      
      res.json(invoices);
    } catch (error) {
      console.error("Error fetching invoices:", error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  app.get('/api/invoices/search', async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ message: "Search query is required" });
      }
      const invoices = await storage.searchInvoices(q);
      res.json(invoices);
    } catch (error) {
      console.error("Error searching invoices:", error);
      res.status(500).json({ message: "Failed to search invoices" });
    }
  });

  // Global search endpoint
  app.get('/api/search', async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== 'string') {
        return res.status(400).json({ message: "Search query is required" });
      }
      
      const [clients, invoices, loads] = await Promise.all([
        storage.searchClients(q),
        storage.searchInvoices(q),
        storage.searchLoads(q)
      ]);
      
      res.json({
        clients,
        invoices,
        loads
      });
    } catch (error) {
      console.error("Error performing global search:", error);
      res.status(500).json({ message: "Failed to perform search" });
    }
  });

  // Fuel card application routes
  app.get('/api/fuel-card-applications', async (req, res) => {
    try {
      const applications = await storage.getFuelCardApplications();
      res.json(applications);
    } catch (error) {
      console.error("Error fetching fuel card applications:", error);
      res.status(500).json({ message: "Failed to fetch applications" });
    }
  });

  app.post('/api/fuel-card-applications', async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const applicationData = { ...req.body, submittedBy: userId };
      const application = await storage.createFuelCardApplication(applicationData);
      
      // Log activity
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

  app.patch('/api/fuel-card-applications/:id', async (req, res) => {
    try {
      const userId = (req as any).user?.claims?.sub;
      if (!userId) {
        return res.status(401).json({ message: "User not authenticated" });
      }

      const id = parseInt(req.params.id);
      const { status, notes } = req.body;

      const updateData = {
        status,
        notes,
        reviewedBy: userId,
        reviewedAt: new Date(),
      };

      const application = await storage.updateFuelCardApplication(id, updateData);
      
      // Log activity
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

  app.get('/api/invoices/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invoice = await storage.getInvoice(id);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      res.json(invoice);
    } catch (error) {
      console.error("Error fetching invoice:", error);
      res.status(500).json({ message: "Failed to fetch invoice" });
    }
  });

  app.post('/api/invoices', async (req: any, res) => {
    try {
      const invoiceData = insertInvoiceSchema.parse(req.body);
      const invoice = await storage.createInvoice({
        ...invoiceData,
        submittedBy: req.user.id,
        submittedAt: new Date(),
      });
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        type: 'invoice_created',
        description: `Created invoice: ${invoice.invoiceNumber}`,
        entityType: 'invoice',
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

  app.put('/api/invoices/:id', async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const user = req.user;
      const invoiceData = insertInvoiceSchema.partial().parse(req.body);
      
      // Add approval data if status is being changed to approved and user is manager
      if (invoiceData.status === 'approved' && (user?.role === 'manager' || user?.role === 'admin')) {
        invoiceData.approvedBy = req.user.id;
        invoiceData.approvedAt = new Date();
      }
      
      const invoice = await storage.updateInvoice(id, invoiceData);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        type: 'invoice_updated',
        description: `Updated invoice: ${invoice.invoiceNumber}`,
        entityType: 'invoice',
        entityId: invoice.id,
      });

      res.json(invoice);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid invoice data", errors: error.errors });
      }
      console.error("Error updating invoice:", error);
      res.status(500).json({ message: "Failed to update invoice" });
    }
  });

  // Document routes
  app.get('/api/documents', async (req, res) => {
    try {
      const { load, invoice, entityType, entityId } = req.query;
      let documents;
      
      if (entityType && entityId) {
        documents = await storage.getDocumentsByEntity(
          entityType as string, 
          parseInt(entityId as string)
        );
      } else if (load) {
        const loadId = parseInt(load as string);
        documents = await storage.getDocumentsByLoad(loadId);
      } else if (invoice) {
        const invoiceId = parseInt(invoice as string);
        documents = await storage.getDocumentsByInvoice(invoiceId);
      } else {
        documents = await storage.getDocuments();
      }
      
      res.json(documents);
    } catch (error) {
      console.error("Error fetching documents:", error);
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  // Get single document by ID
  app.get('/api/documents/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
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

  // PDF conversion temporarily disabled for web deployment optimization
  // Will be re-enabled with server-side PDF processing in future version
  async function convertImageToPdf(inputPath: string, outputPath: string): Promise<void> {
    // Feature disabled - images will be kept as-is for now
    throw new Error('PDF conversion temporarily unavailable');
  }

  app.post('/api/documents/upload', requireAuth, upload.single('file'), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { documentType, loadId, invoiceId } = req.body;
      let processedFilename = req.file.filename;
      let processedMimeType = req.file.mimetype;
      let processedOriginalName = req.file.originalname;

      // PDF conversion temporarily disabled - keep original image format
      // Future enhancement: server-side PDF processing
      if (req.file.mimetype.includes('jpeg') || req.file.mimetype.includes('jpg')) {
        // Keep original image for now
        console.log('Image uploaded as-is (PDF conversion disabled for web deployment)');
      }
      
      const documentData = {
        filename: processedFilename,
        originalName: processedOriginalName,
        mimeType: processedMimeType,
        size: req.file.size,
        documentType: documentType || 'other',
        loadId: loadId && loadId !== 'undefined' ? parseInt(loadId) : null,
        invoiceId: invoiceId && invoiceId !== 'undefined' ? parseInt(invoiceId) : null,
        uploadedBy: req.user.id,
        status: 'processing' as const,
      };

      const document = await storage.createDocument(documentData);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        type: 'document_uploaded',
        description: `Uploaded document: ${document.originalName}`,
        entityType: 'document',
        entityId: document.id,
      });

      // Simulate document processing
      setTimeout(async () => {
        try {
          await storage.updateDocument(document.id, { status: 'processed' });
        } catch (error) {
          console.error("Error updating document status:", error);
        }
      }, 2000);

      res.status(201).json(document);
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ message: "Failed to upload document" });
    }
  });

  app.delete('/api/documents/:id', requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid document ID" });
      }
      
      const document = await storage.getDocument(id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Delete the document from database
      await storage.deleteDocument(id);
      
      // Try to delete the physical file (optional - don't fail if file doesn't exist)
      try {
        const filePath = path.join('uploads', document.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (fileError) {
        console.warn("Could not delete physical file:", fileError);
        // Continue anyway - database record is more important
      }
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        type: 'document_deleted',
        description: `Deleted document: ${document.originalName}`,
        entityType: 'document',
        entityId: document.id,
      });

      res.json({ message: "Document deleted successfully" });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  // Document download/view routes
  app.get('/api/documents/:id/download', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const document = await storage.getDocument(id);
      
      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      // Check for file with and without extension
      let filePath = path.resolve(process.cwd(), 'uploads', document.filename);
      if (!fs.existsSync(filePath)) {
        // Try with .pdf extension for converted files
        filePath = path.resolve(process.cwd(), 'uploads', document.filename + '.pdf');
        if (!fs.existsSync(filePath)) {
          console.error(`File not found: ${document.filename} or ${document.filename}.pdf`);
          return res.status(404).json({ message: "File not found on disk" });
        }
      }

      // Get file stats for Content-Length
      const stats = fs.statSync(filePath);
      
      res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${document.originalName}"`);
      res.setHeader('Content-Length', stats.size.toString());
      res.setHeader('Cache-Control', 'no-cache');
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.on('error', (error) => {
        console.error('Error streaming file:', error);
        if (!res.headersSent) {
          res.status(500).json({ message: 'Error streaming file' });
        }
      });
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error downloading document:", error);
      res.status(500).json({ message: "Failed to download document" });
    }
  });

  // Manager-only routes
  app.put('/api/invoices/:id/approve', async (req: any, res) => {
    try {
      const user = req.user;
      if (user?.role !== 'manager' && user?.role !== 'admin') {
        return res.status(403).json({ message: "Only managers and admins can approve invoices" });
      }

      const id = parseInt(req.params.id);
      const invoice = await storage.updateInvoice(id, {
        status: 'approved',
        approvedBy: req.user.id,
        approvedAt: new Date(),
      });
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        type: 'invoice_approved',
        description: `Approved invoice: ${invoice.invoiceNumber}`,
        entityType: 'invoice',
        entityId: invoice.id,
      });

      res.json(invoice);
    } catch (error) {
      console.error("Error approving invoice:", error);
      res.status(500).json({ message: "Failed to approve invoice" });
    }
  });

  // Time tracking routes
  app.get('/api/time-tracking/status', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const currentEntry = await storage.getCurrentTimeEntry(userId);
      const todayEntries = await storage.getTodayTimeEntries(userId);
      
      res.json({
        isClocked: !!currentEntry,
        currentEntry,
        todayEntries,
        todayHours: todayEntries
          .filter(entry => entry.status === 'clocked_out')
          .reduce((total, entry) => total + parseFloat(entry.totalHours || '0'), 0),
      });
    } catch (error) {
      console.error("Error fetching time tracking status:", error);
      res.status(500).json({ message: "Failed to fetch time tracking status" });
    }
  });

  app.post('/api/time-tracking/clock-in', requireAuth, async (req: any, res) => {
    try {
      console.log("Clock-in request - user:", req.user);
      const userId = req.user.id;
      const { notes } = req.body;
      
      const timeEntry = await storage.clockIn(userId, notes);
      res.json(timeEntry);
    } catch (error) {
      console.error("Error clocking in:", error);
      res.status(400).json({ message: (error as Error).message || "Failed to clock in" });
    }
  });

  app.post('/api/time-tracking/clock-out', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { notes } = req.body;
      
      const timeEntry = await storage.clockOut(userId, notes);
      res.json(timeEntry);
    } catch (error) {
      console.error("Error clocking out:", error);
      res.status(400).json({ message: (error as Error).message || "Failed to clock out" });
    }
  });

  app.get('/api/time-tracking/entries', requireAuth, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { period } = req.query;
      
      let entries;
      if (period === 'today') {
        entries = await storage.getTodayTimeEntries(userId);
      } else if (period === 'week') {
        entries = await storage.getWeekTimeEntries(userId);
      } else {
        entries = await storage.getTimeEntries(userId);
      }
      
      res.json(entries);
    } catch (error) {
      console.error("Error fetching time entries:", error);
      res.status(500).json({ message: "Failed to fetch time entries" });
    }
  });

  // Notification routes
  app.get('/api/notifications', async (req: any, res) => {
    try {
      const userId = "1"; // Default user ID - authentication removed
      const limit = parseInt(req.query.limit as string) || 20;
      const notifications = await storage.getNotifications(userId, limit);
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.get('/api/notifications/unread-count', async (req: any, res) => {
    try {
      const userId = "1"; // Default user ID - authentication removed
      const count = await storage.getUnreadNotificationCount(userId);
      res.json({ count });
    } catch (error) {
      console.error("Error fetching unread notification count:", error);
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  app.patch('/api/notifications/:id/read', async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.markNotificationAsRead(id);
      res.json({ message: "Notification marked as read" });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  });

  app.patch('/api/notifications/mark-all-read', async (req: any, res) => {
    try {
      const userId = "1"; // Default user ID - authentication removed
      await storage.markAllNotificationsAsRead(userId);
      res.json({ message: "All notifications marked as read" });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      res.status(500).json({ message: "Failed to mark all notifications as read" });
    }
  });

  // Desktop installer download routes - Direct download links
  app.get('/api/desktop/download/windows', async (req, res) => {
    try {
      const filePath = path.resolve(process.cwd(), 'electron-dist', 'FactorFlux-Windows-Portable.tar.gz');
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Windows installer not found" });
      }

      const stats = fs.statSync(filePath);
      
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', 'attachment; filename="FactorFlux-Windows-Portable.tar.gz"');
      res.setHeader('Content-Length', stats.size.toString());
      res.setHeader('Cache-Control', 'public, max-age=3600');
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.on('error', (error) => {
        console.error('Error streaming Windows installer:', error);
        if (!res.headersSent) {
          res.status(500).json({ message: 'Error downloading Windows installer' });
        }
      });
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error downloading Windows installer:", error);
      res.status(500).json({ message: "Failed to download Windows installer" });
    }
  });

  app.get('/api/desktop/download/mac', async (req, res) => {
    try {
      const filePath = path.resolve(process.cwd(), 'electron-dist', 'FactorFlux-Mac-Installer.tar.gz');
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Mac installer not found" });
      }

      const stats = fs.statSync(filePath);
      
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', 'attachment; filename="FactorFlux-Mac-Installer.tar.gz"');
      res.setHeader('Content-Length', stats.size.toString());
      res.setHeader('Cache-Control', 'public, max-age=3600');
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.on('error', (error) => {
        console.error('Error streaming Mac installer:', error);
        if (!res.headersSent) {
          res.status(500).json({ message: 'Error downloading Mac installer' });
        }
      });
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error downloading Mac installer:", error);
      res.status(500).json({ message: "Failed to download Mac installer" });
    }
  });

  app.get('/api/desktop/download/linux', async (req, res) => {
    try {
      const filePath = path.resolve(process.cwd(), 'electron-dist', 'FactorFlux-Linux-Portable.tar.gz');
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Linux installer not found" });
      }

      const stats = fs.statSync(filePath);
      
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', 'attachment; filename="FactorFlux-Linux-Portable.tar.gz"');
      res.setHeader('Content-Length', stats.size.toString());
      res.setHeader('Cache-Control', 'public, max-age=3600');
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.on('error', (error) => {
        console.error('Error streaming Linux installer:', error);
        if (!res.headersSent) {
          res.status(500).json({ message: 'Error downloading Linux installer' });
        }
      });
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error downloading Linux installer:", error);
      res.status(500).json({ message: "Failed to download Linux installer" });
    }
  });

  // Desktop installation guide download route
  app.get('/api/desktop/download/guide', async (req, res) => {
    try {
      const filePath = path.resolve(process.cwd(), 'DESKTOP-TROUBLESHOOTING-GUIDE.md');
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Installation guide not found" });
      }

      const stats = fs.statSync(filePath);
      
      res.setHeader('Content-Type', 'text/markdown');
      res.setHeader('Content-Disposition', 'attachment; filename="FactorFlux-Installation-Guide.md"');
      res.setHeader('Content-Length', stats.size.toString());
      res.setHeader('Cache-Control', 'public, max-age=3600');
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.on('error', (error) => {
        console.error('Error streaming installation guide:', error);
        if (!res.headersSent) {
          res.status(500).json({ message: 'Error downloading installation guide' });
        }
      });
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error downloading installation guide:", error);
      res.status(500).json({ message: "Failed to download installation guide" });
    }
  });

  // Email installer links route - send installer download links via email
  app.post('/api/email/installer-links', async (req: any, res) => {
    try {
      const user = req.user;
      if (user?.role !== 'manager' && user?.role !== 'admin') {
        return res.status(403).json({ message: "Only managers and admins can send installer links" });
      }

      const { email, clientName, message } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email address is required" });
      }

      const appUrl = process.env.REPLIT_DEV_DOMAIN 
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : 'https://e603594c-e028-4700-8f9c-83ea4151f86f-00-1yv0wd2mfzho3.janeway.replit.dev';

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #2563eb;">FactorFlux Desktop Access</h1>
          
          ${clientName ? `<p>Hello ${clientName},</p>` : '<p>Hello,</p>'}
          
          <p>You now have access to FactorFlux, our freight factoring management system. You can access it in two ways:</p>
          
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="color: #1e40af; margin-top: 0;">🌐 Web Access (Recommended)</h2>
            <p><strong>Live Application:</strong> <a href="${appUrl}" style="color: #2563eb; text-decoration: none; font-weight: bold;">${appUrl}</a></p>
            <p>Access FactorFlux directly in your web browser - no installation required.</p>
          </div>
          
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="color: #1e40af; margin-top: 0;">💻 Desktop Installers</h2>
            <p>For a desktop-like experience, download the portable launcher for your operating system:</p>
            
            <div style="margin: 15px 0;">
              <strong>🪟 Windows:</strong><br>
              <a href="${appUrl}/api/desktop/download/windows" style="color: #2563eb; text-decoration: none;">
                FactorFlux-Windows-Portable.tar.gz
              </a> (5.7 MB)
            </div>
            
            <div style="margin: 15px 0;">
              <strong>🍎 Mac:</strong><br>
              <a href="${appUrl}/api/desktop/download/mac" style="color: #2563eb; text-decoration: none;">
                FactorFlux-Mac-Portable.tar.gz
              </a> (5.7 MB)
            </div>
            
            <div style="margin: 15px 0;">
              <strong>🐧 Linux:</strong><br>
              <a href="${appUrl}/api/desktop/download/linux" style="color: #2563eb; text-decoration: none;">
                FactorFlux-Linux-Portable.tar.gz
              </a> (5.7 MB)
            </div>
            
            <div style="margin: 15px 0;">
              <strong>📖 Setup Guide:</strong><br>
              <a href="${appUrl}/api/desktop/download/guide" style="color: #2563eb; text-decoration: none;">
                Installation Instructions
              </a>
            </div>
          </div>
          
          <h2 style="color: #1e40af;">⚡ Quick Setup for Desktop</h2>
          <ol>
            <li>Download the file for your operating system</li>
            <li>Extract the archive using built-in tools</li>
            <li>Run the startup script (double-click or run in terminal)</li>
            <li>FactorFlux opens automatically in your browser</li>
          </ol>
          
          ${message ? `<div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0;">
            <h3 style="color: #047857; margin-top: 0;">Additional Information</h3>
            <p style="margin-bottom: 0;">${message}</p>
          </div>` : ''}
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <p>If you have any questions or need assistance getting started, please don't hesitate to reach out.</p>
            <p style="color: #6b7280;">
              Best regards,<br>
              <strong>Trucking Pros Financial Team</strong>
            </p>
          </div>
        </div>
      `;

      const textContent = `
FactorFlux Desktop Access

${clientName ? `Hello ${clientName},` : 'Hello,'}

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

${message ? `Additional Information: ${message}` : ''}

If you have any questions or need assistance getting started, please don't hesitate to reach out.

Best regards,
Trucking Pros Financial Team
      `.trim();

      // For now, log the email content and return success (since SendGrid needs proper setup)
      console.log('Email would be sent to:', email);
      console.log('Subject:', `FactorFlux Access - ${clientName || 'Desktop Installation'}`);
      console.log('Content preview:', textContent.substring(0, 200) + '...');

      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        type: 'installer_links_prepared',
        description: `FactorFlux access prepared for: ${email}${clientName ? ` (${clientName})` : ''}`,
        entityType: 'system',
        entityId: null,
      });

      // Return the email content for manual sending or display
      res.json({ 
        message: "FactorFlux access email prepared successfully",
        emailContent: {
          to: email,
          subject: `FactorFlux Access - ${clientName || 'Desktop Installation'}`,
          text: textContent,
          html: htmlContent
        }
      });
    } catch (error) {
      console.error("Error sending installer links:", error);
      res.status(500).json({ message: "Failed to send installer links" });
    }
  });

  // Desktop installer download routes - these must come before catch-all routes
  app.get('/api/download/windows', (req, res) => {
    const filePath = path.resolve(process.cwd(), 'electron-dist', 'FactorFlux-Windows-Portable.tar.gz');
    if (fs.existsSync(filePath)) {
      res.download(filePath, 'FactorFlux-Windows-Portable.tar.gz');
    } else {
      res.status(404).json({ message: "Windows installer not found" });
    }
  });

  app.get('/api/download/mac', (req, res) => {
    const filePath = path.resolve(process.cwd(), 'electron-dist', 'FactorFlux-Mac-Portable.tar.gz');
    if (fs.existsSync(filePath)) {
      res.download(filePath, 'FactorFlux-Mac-Portable.tar.gz');
    } else {
      res.status(404).json({ message: "Mac installer not found" });
    }
  });

  app.get('/api/download/linux', (req, res) => {
    const filePath = path.resolve(process.cwd(), 'electron-dist', 'FactorFlux-Linux-Portable.tar.gz');
    if (fs.existsSync(filePath)) {
      res.download(filePath, 'FactorFlux-Linux-Portable.tar.gz');
    } else {
      res.status(404).json({ message: "Linux installer not found" });
    }
  });

  app.get('/api/download/guide', (req, res) => {
    const filePath = path.resolve(process.cwd(), 'USER-INSTALLATION-GUIDE.md');
    if (fs.existsSync(filePath)) {
      res.download(filePath, 'USER-INSTALLATION-GUIDE.md');
    } else {
      res.status(404).json({ message: "Installation guide not found" });
    }
  });

  // Download page for easy access
  app.get('/api/downloads', (req, res) => {
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

  // Collections routes
  app.get('/api/collections', async (req: any, res) => {
    try {
      const collections = await storage.getAllCollections();
      res.json(collections);
    } catch (error) {
      console.error("Error fetching collections:", error);
      res.status(500).json({ message: "Failed to fetch collections" });
    }
  });

  app.get('/api/collections/client-performance', async (req: any, res) => {
    try {
      const performanceData = await storage.getClientPerformanceData();
      res.json(performanceData);
    } catch (error) {
      console.error("Error fetching client performance data:", error);
      res.status(500).json({ message: "Failed to fetch client performance data" });
    }
  });

  app.get('/api/collections/:id', async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
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

  app.post('/api/collections', requireAuth, async (req: any, res) => {
    try {
      const collectionData = insertCollectionSchema.parse(req.body);
      const collection = await storage.createCollection({
        ...collectionData,
        assignedTo: collectionData.assignedTo || req.user.id
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

  app.patch('/api/collections/:id', requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      const collection = await storage.updateCollection(id, updates);
      res.json(collection);
    } catch (error) {
      console.error("Error updating collection:", error);
      res.status(500).json({ message: "Failed to update collection" });
    }
  });

  app.delete('/api/collections/:id', requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteCollection(id);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        type: 'collection_deleted',
        description: 'Deleted collection',
        entityType: 'collection',
        entityId: id,
      });

      res.json({ message: "Collection deleted successfully" });
    } catch (error) {
      console.error("Error deleting collection:", error);
      res.status(500).json({ message: "Failed to delete collection" });
    }
  });

  // Client Vault routes - Secure storage for confidential information
  app.get('/api/vault/:clientId', requireAuth, async (req: any, res) => {
    try {
      const clientId = parseInt(req.params.clientId);
      if (isNaN(clientId)) {
        return res.status(400).json({ message: "Invalid client ID" });
      }
      
      const vaultEntries = await storage.getAllVaultEntries(clientId);
      res.json(vaultEntries);
    } catch (error) {
      console.error("Error fetching vault entries:", error);
      res.status(500).json({ message: "Failed to fetch vault entries" });
    }
  });

  app.get('/api/vault/entry/:id', requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid vault entry ID" });
      }
      
      const entry = await storage.getVaultEntry(id);
      if (!entry) {
        return res.status(404).json({ message: "Vault entry not found" });
      }
      
      // Record access for audit trail
      await storage.recordVaultAccess(id, req.user.id);
      
      res.json(entry);
    } catch (error) {
      console.error("Error fetching vault entry:", error);
      res.status(500).json({ message: "Failed to fetch vault entry" });
    }
  });

  app.post('/api/vault', requireAuth, async (req: any, res) => {
    try {
      const data = insertClientVaultSchema.parse({
        ...req.body,
        createdBy: req.user.id
      });
      
      const entry = await storage.createVaultEntry(data);
      res.status(201).json(entry);
    } catch (error) {
      console.error("Error creating vault entry:", error);
      res.status(500).json({ message: "Failed to create vault entry" });
    }
  });

  app.patch('/api/vault/:id', requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid vault entry ID" });
      }
      
      const updates = {
        ...req.body,
        createdBy: req.user.id // For audit trail in update
      };
      
      const entry = await storage.updateVaultEntry(id, updates);
      res.json(entry);
    } catch (error) {
      console.error("Error updating vault entry:", error);
      res.status(500).json({ message: "Failed to update vault entry" });
    }
  });

  app.delete('/api/vault/:id', requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid vault entry ID" });
      }
      
      await storage.deleteVaultEntry(id);
      
      // Log activity for security audit
      await storage.createActivity({
        userId: req.user.id,
        type: 'vault_deleted',
        description: 'Deleted confidential vault entry',
        entityType: 'vault',
        entityId: id,
      });

      res.json({ message: "Vault entry deleted successfully" });
    } catch (error) {
      console.error("Error deleting vault entry:", error);
      res.status(500).json({ message: "Failed to delete vault entry" });
    }
  });

  // Follow-up routes
  app.get('/api/follow-ups', async (req: any, res) => {
    try {
      const followUps = await storage.getAllFollowUps();
      res.json(followUps);
    } catch (error) {
      console.error("Error fetching follow-ups:", error);
      res.status(500).json({ message: "Failed to fetch follow-ups" });
    }
  });

  app.post('/api/follow-ups', async (req: any, res) => {
    try {
      const data = insertFollowUpSchema.parse(req.body);
      const followUp = await storage.createFollowUp(data);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        type: 'follow_up_created',
        description: `Created follow-up task: ${data.title}`,
        entityType: 'follow_up',
        entityId: followUp.id,
      });

      res.json(followUp);
    } catch (error) {
      console.error("Error creating follow-up:", error);
      res.status(500).json({ message: "Failed to create follow-up" });
    }
  });

  app.patch('/api/follow-ups/:id', async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const updates = req.body;
      
      const followUp = await storage.updateFollowUp(id, updates);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        type: 'follow_up_updated',
        description: `Updated follow-up task: ${followUp.title}`,
        entityType: 'follow_up',
        entityId: followUp.id,
      });

      res.json(followUp);
    } catch (error) {
      console.error("Error updating follow-up:", error);
      res.status(500).json({ message: "Failed to update follow-up" });
    }
  });

  app.delete('/api/follow-ups/:id', async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteFollowUp(id);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        type: 'follow_up_deleted',
        description: `Deleted follow-up task`,
        entityType: 'follow_up',
        entityId: id,
      });

      res.json({ message: "Follow-up deleted successfully" });
    } catch (error) {
      console.error("Error deleting follow-up:", error);
      res.status(500).json({ message: "Failed to delete follow-up" });
    }
  });

  // Portfolio route - serve the portfolio website
  app.get('/portfolio', (req, res) => {
    const portfolioPath = path.resolve(process.cwd(), 'portfolio-site', 'index.html');
    if (fs.existsSync(portfolioPath)) {
      res.sendFile(portfolioPath);
    } else {
      res.status(404).json({ message: "Portfolio not found" });
    }
  });

  // Version check endpoint - FORCE DEPLOYMENT UPDATE v3
  app.get('/api/version-check', (req, res) => {
    res.json({
      timestamp: new Date().toISOString(),
      version: 'v3.0.0-WITH-BYPASS-' + Date.now(),
      hasLocalAuth: !!app._router?.stack?.find((layer: any) => 
        layer.route?.path === '/api/auth/local/login'
      ),
      environment: process.env.NODE_ENV || 'unknown',
      authEndpointExists: true,
      bypassAdded: true
    });
  });

  // EMERGENCY LOGIN BYPASS - TEMPORARY FIX FOR DEPLOYMENT ISSUES
  app.post('/api/emergency-login', async (req, res) => {
    try {
      const { email, password, secret } = req.body;
      
      // Only allow admin with secret key
      if (email === 'doshbarzanji@gmail.com' && password === 'admin@tpf2025' && secret === 'emergency-fix-2025') {
        // Get user from database
        const users = await db.select().from(userTable).where(
          and(
            eq(userTable.email, email),
            eq(userTable.authType, 'local')
          )
        );
        
        if (users.length > 0) {
          const user = users[0];
          
          // Create session manually
          (req.session as any).passport = { user: user.id };
          req.session.save((err) => {
            if (err) {
              return res.status(500).json({ message: 'Session error' });
            }
            
            return res.json({
              success: true,
              message: 'Emergency login successful',
              user: {
                id: user.id,
                email: user.email,
                role: user.role,
                firstName: user.firstName,
                lastName: user.lastName,
                authType: user.authType
              }
            });
          });
        } else {
          return res.status(404).json({ message: 'User not found' });
        }
      } else {
        return res.status(401).json({ message: 'Invalid emergency credentials' });
      }
    } catch (error) {
      console.error('Emergency login error:', error);
      res.status(500).json({ error: 'Emergency login failed' });
    }
  });

  // Production authentication fix - comprehensive solution
  app.post('/api/auth/production-fix', async (req, res) => {
    try {
      const { email, password } = req.body;
      
      console.log('Production fix: attempting login for', email);
      
      if (!email || !password) {
        return res.status(400).json({ message: 'Email and password required' });
      }
      
      // Get user from database
      const users = await db.select().from(userTable).where(
        and(
          eq(userTable.email, email),
          eq(userTable.authType, 'local')
        )
      );
      
      console.log('Production fix: found users:', users.length);
      
      if (users.length === 0) {
        // Create admin user if it's the expected admin email
        if (email === 'doshbarzanji@gmail.com') {
          console.log('Production fix: creating fresh admin user');
          const hashedPassword = await bcrypt.hash('admin@tpf2025', 10);
          
          const newUser = await db.insert(userTable).values({
            id: crypto.randomUUID(),
            email: 'doshbarzanji@gmail.com',
            password: hashedPassword,
            authType: 'local',
            role: 'admin',
            firstName: 'Dosh',
            lastName: 'Barzanji'
          }).returning();
          
          // Login the new user using passport
          req.login(newUser[0], (err) => {
            if (err) {
              console.error('Production fix: passport login error after creation', err);
              return res.status(500).json({ message: 'Login failed after user creation' });
            }
            
            console.log('Production fix: new admin user created and logged in');
            return res.status(200).json({
              message: 'Admin user created and authenticated',
              user: {
                id: newUser[0].id,
                email: newUser[0].email,
                firstName: newUser[0].firstName,
                lastName: newUser[0].lastName,
                role: newUser[0].role
              }
            });
          });
          return;
        } else {
          return res.status(404).json({ message: 'User not found' });
        }
      }
      
      const user = users[0];
      console.log('Production fix: found user, testing password');
      
      // Test password
      const isValid = await bcrypt.compare(password, user.password!);
      console.log('Production fix: password validation result:', isValid);
      
      if (isValid) {
        // Use passport login for proper session handling
        req.login(user, (err) => {
          if (err) {
            console.error('Production fix: passport login error', err);
            return res.status(500).json({ message: 'Session creation failed' });
          }
          
          console.log('Production fix: authentication successful');
          return res.status(200).json({
            message: 'Authentication successful',
            user: {
              id: user.id,
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              role: user.role
            }
          });
        });
      } else {
        console.log('Production fix: invalid password');
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      
    } catch (error) {
      console.error('Production fix error:', error);
      res.status(500).json({ 
        message: 'Authentication failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Direct authentication test endpoint - bypasses Passport entirely
  app.post('/api/direct-auth-test', async (req, res) => {
    try {
      const { email, password } = req.body;
      
      console.log('Direct auth test for:', email);
      
      if (!email || !password) {
        return res.status(400).json({ message: 'Email and password required' });
      }
      
      // Get user directly from database
      const users = await db.select().from(userTable).where(
        and(
          eq(userTable.email, email),
          eq(userTable.authType, 'local')
        )
      );
      
      if (users.length === 0) {
        return res.status(401).json({ message: 'User not found' });
      }
      
      const user = users[0];
      console.log('Direct auth: found user', user.id);
      
      // Test password directly
      const isValid = await bcrypt.compare(password, user.password!);
      console.log('Direct auth: password valid', isValid);
      
      if (isValid) {
        return res.json({
          success: true,
          message: 'Direct authentication successful',
          user: {
            id: user.id,
            email: user.email,
            role: user.role
          }
        });
      } else {
        return res.status(401).json({ message: 'Invalid password' });
      }
      
    } catch (error) {
      console.error('Direct auth error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Direct auth failed' });
    }
  });

  // Reset admin password with fresh hash
  app.post('/api/reset-admin-password', async (req, res) => {
    try {
      const { secret } = req.body;
      
      if (secret !== 'reset-admin-2025') {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      console.log('Resetting admin password in production');
      
      // Generate a completely fresh hash for admintpf2025
      const freshPassword = 'admintpf2025';
      const freshHash = await bcrypt.hash(freshPassword, 12);
      
      console.log('Generated fresh hash for password reset');
      
      // Update admin user with the fresh hash
      const result = await db.update(userTable).set({
        password: freshHash
      }).where(
        and(
          eq(userTable.email, 'doshbarzanji@gmail.com'),
          eq(userTable.authType, 'local')
        )
      ).returning();
      
      if (result.length === 0) {
        return res.status(404).json({ message: 'Admin user not found' });
      }
      
      console.log('Admin password reset successfully');
      
      // Test the new password immediately
      const testValid = await bcrypt.compare(freshPassword, freshHash);
      
      return res.json({
        success: true,
        message: 'Admin password reset successfully',
        user: {
          id: result[0].id,
          email: result[0].email
        },
        passwordTest: testValid,
        hashLength: freshHash.length
      });
      
    } catch (error) {
      console.error('Password reset error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Password reset failed'
      });
    }
  });

  // Tasks routes
  app.get('/api/tasks', requireAuth, async (req: any, res) => {
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

  app.get('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [task] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, id))
        .limit(1);

      if (!task) {
        return res.status(404).json({ message: "Task not found" });
      }

      res.json(task);
    } catch (error) {
      console.error("Error fetching task:", error);
      res.status(500).json({ message: "Failed to fetch task" });
    }
  });

  app.post('/api/tasks', requireAuth, async (req: any, res) => {
    try {
      const taskData = insertTaskSchema.parse({
        ...req.body,
        assignedTo: req.user.id,
      });

      const [newTask] = await db
        .insert(tasks)
        .values(taskData)
        .returning();

      res.status(201).json(newTask);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid task data", errors: error.errors });
      }
      console.error("Error creating task:", error);
      res.status(500).json({ message: "Failed to create task" });
    }
  });

  app.patch('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
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

  app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [deletedTask] = await db
        .delete(tasks)
        .where(eq(tasks.id, id))
        .returning();

      if (!deletedTask) {
        return res.status(404).json({ message: "Task not found" });
      }

      res.json({ message: "Task deleted successfully" });
    } catch (error) {
      console.error("Error deleting task:", error);
      res.status(500).json({ message: "Failed to delete task" });
    }
  });

  // Brokers routes
  app.get('/api/brokers', requireAuth, async (req, res) => {
    try {
      const brokersData = await db
        .select()
        .from(brokers)
        .orderBy(brokers.name);

      res.json(brokersData);
    } catch (error) {
      console.error("Error fetching brokers:", error);
      res.status(500).json({ message: "Failed to fetch brokers" });
    }
  });

  app.get('/api/brokers/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [broker] = await db
        .select()
        .from(brokers)
        .where(eq(brokers.id, id))
        .limit(1);

      if (!broker) {
        return res.status(404).json({ message: "Broker not found" });
      }

      res.json(broker);
    } catch (error) {
      console.error("Error fetching broker:", error);
      res.status(500).json({ message: "Failed to fetch broker" });
    }
  });

  app.post('/api/brokers', requireAuth, async (req, res) => {
    try {
      const brokerData = insertBrokerSchema.parse(req.body);

      const [newBroker] = await db
        .insert(brokers)
        .values(brokerData)
        .returning();

      res.status(201).json(newBroker);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid broker data", errors: error.errors });
      }
      console.error("Error creating broker:", error);
      res.status(500).json({ message: "Failed to create broker" });
    }
  });

  app.patch('/api/brokers/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
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

  app.delete('/api/brokers/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [deletedBroker] = await db
        .delete(brokers)
        .where(eq(brokers.id, id))
        .returning();

      if (!deletedBroker) {
        return res.status(404).json({ message: "Broker not found" });
      }

      res.json({ message: "Broker deleted successfully" });
    } catch (error) {
      console.error("Error deleting broker:", error);
      res.status(500).json({ message: "Failed to delete broker" });
    }
  });

  // Fuel Advances routes
  app.get('/api/fuel-advances', requireAuth, async (req, res) => {
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
          // Include agent name
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

  app.get('/api/fuel-advances/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
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

  app.post('/api/fuel-advances', requireAuth, async (req, res) => {
    try {
      const fuelAdvanceData = insertFuelAdvanceSchema.parse(req.body);

      const [newFuelAdvance] = await db
        .insert(fuelAdvances)
        .values(fuelAdvanceData)
        .returning();

      res.status(201).json(newFuelAdvance);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid fuel advance data", errors: error.errors });
      }
      console.error("Error creating fuel advance:", error);
      res.status(500).json({ message: "Failed to create fuel advance" });
    }
  });

  app.patch('/api/fuel-advances/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
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

  app.delete('/api/fuel-advances/:id', requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [deletedFuelAdvance] = await db
        .delete(fuelAdvances)
        .where(eq(fuelAdvances.id, id))
        .returning();

      if (!deletedFuelAdvance) {
        return res.status(404).json({ message: "Fuel advance not found" });
      }

      res.json({ message: "Fuel advance deleted successfully" });
    } catch (error) {
      console.error("Error deleting fuel advance:", error);
      res.status(500).json({ message: "Failed to delete fuel advance" });
    }
  });

  // Simple test login endpoint to verify credentials
  app.post('/api/test-login', async (req, res) => {
    try {
      const { email, password, secret } = req.body;
      
      if (secret !== 'test-login-tpf-2025') {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      console.log('Testing login for:', email);
      
      // Direct database query to find user
      const users = await db.select().from(userTable).where(
        and(
          eq(userTable.email, email),
          eq(userTable.authType, 'local')
        )
      );
      
      console.log('Found users:', users.length);
      
      if (users.length === 0) {
        return res.json({ 
          success: false, 
          message: 'User not found',
          email: email
        });
      }

      const user = users[0];
      console.log('User found:', user.id, 'password hash length:', user.password?.length);
      
      // Test password comparison
      const isValid = await bcrypt.compare(password, user.password!);
      console.log('Password valid:', isValid);
      
      return res.json({ 
        success: isValid,
        message: isValid ? 'Credentials valid' : 'Password mismatch',
        user: {
          id: user.id,
          email: user.email,
          role: user.role
        },
        hashLength: user.password?.length,
        passwordTested: password
      });
      
    } catch (error) {
      console.error('Test login error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Test failed',
        details: error
      });
    }
  });

  // Database migration endpoint - sync admin password with local
  app.post('/api/migration/sync-admin', async (req, res) => {
    try {
      const { secret } = req.body;
      
      if (secret !== 'tpf-sync-admin-2025') {
        return res.status(401).json({ message: 'Unauthorized sync' });
      }

      // Use the exact working password hash from local development
      const workingHash = '$2b$10$qca5rltTDf7A.k7UZjJphuIH.TjoX0RyX6BFVGhosWxgL3mObjXXO';
      
      try {
        // Direct database query to update password hash
        const result = await db.update(users)
          .set({ password: workingHash })
          .where(eq(users.email, 'doshbarzanji@gmail.com'))
          .returning();
        
        if (result.length > 0) {
          return res.json({ 
            success: true, 
            message: 'Admin password synchronized successfully',
            user: { 
              id: result[0].id, 
              email: result[0].email, 
              role: result[0].role 
            } 
          });
        } else {
          return res.status(404).json({ 
            error: 'Admin user not found' 
          });
        }
      } catch (error) {
        console.error('Password sync failed:', error);
        return res.status(500).json({ 
          error: 'Failed to sync admin password',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    } catch (error) {
      console.error('Sync error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Sync failed' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
} 
