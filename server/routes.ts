import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupLocalAuth, isAuthenticatedLocal } from "./localAuth";
import { 
  insertClientSchema, 
  insertLoadSchema, 
  insertInvoiceSchema,
  insertDocumentSchema,
  insertFollowUpSchema,
  users,
  users as userTable
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

// Helper function to get user ID from local auth
function getUserId(req: any): string | null {
  if (!req.isAuthenticated()) {
    return null;
  }
  return req.user.id;
}

// Helper function to get current user from local auth
async function getCurrentUser(req: any): Promise<any> {
  if (!req.isAuthenticated()) {
    return null;
  }
  return req.user;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  setupLocalAuth(app);

  // Auth routes - Handle both Replit Auth and Local Auth
  app.get('/api/auth/user', async (req: any, res) => {
    try {
      const user = await getCurrentUser(req);
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Profile routes
  app.patch('/api/user/profile', async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

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
      const updatedUser = await storage.getUser(userId);
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  app.post('/api/user/profile-image', upload.single('profileImage'), async (req: any, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const userId = req.user.authType === 'local' ? req.user.id : req.user.id;
      
      if (!req.file) {
        return res.status(400).json({ message: "No image file provided" });
      }

      // In a real app, you'd upload to cloud storage (S3, Cloudinary, etc.)
      // For now, we'll just store the local file path
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
      const currentUser = await getCurrentUser(req);
      if (!currentUser) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      if (currentUser?.role !== 'manager' && currentUser?.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Manager or admin role required." });
      }

      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch('/api/admin/users/:userId/role', isAuthenticatedLocal, async (req: any, res) => {
    try {
      const currentUser = req.user;
      if (currentUser?.role !== 'manager' && currentUser?.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Manager or admin role required." });
      }

      const { userId } = req.params;
      const { role } = req.body;

      if (!['employee', 'manager', 'admin'].includes(role)) {
        return res.status(400).json({ message: "Invalid role. Must be 'employee', 'manager', or 'admin'." });
      }

      // Prevent changing own role
      if (userId === req.user.id) {
        return res.status(400).json({ message: "Cannot change your own role." });
      }

      await storage.updateUserProfile(userId, { role });
      const updatedUser = await storage.getUser(userId);

      // Log the activity
      await storage.createActivity({
        userId: req.user.id,
        type: "role_changed",
        entityType: "user", 
        entityId: parseInt(userId),
        description: `Changed user role to ${role}`,
      });

      res.json({
        message: `User role updated to ${role}`,
        user: updatedUser
      });
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  // Dashboard routes
  app.get('/api/dashboard/stats', isAuthenticatedLocal, async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard statistics" });
    }
  });

  app.get('/api/dashboard/recent-activities', isAuthenticatedLocal, async (req, res) => {
    try {
      const activities = await storage.getActivities(10);
      res.json(activities);
    } catch (error) {
      console.error("Error fetching recent activities:", error);
      res.status(500).json({ message: "Failed to fetch recent activities" });
    }
  });

  // All activities endpoint
  app.get('/api/activities', isAuthenticatedLocal, async (req, res) => {
    try {
      const activities = await storage.getActivities();
      res.json(activities);
    } catch (error) {
      console.error("Error fetching all activities:", error);
      res.status(500).json({ message: "Failed to fetch activities" });
    }
  });

  // Clear all activities endpoint
  app.delete('/api/activities', isAuthenticatedLocal, async (req, res) => {
    try {
      await storage.clearActivities();
      
      // Log the activity reset
      await storage.createActivity({
        userId: (req.user as any).claims.sub,
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

  // Client routes
  app.get('/api/clients', isAuthenticatedLocal, async (req, res) => {
    try {
      const clients = await storage.getClients();
      res.json(clients);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  app.get('/api/clients/search', isAuthenticatedLocal, async (req, res) => {
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

  app.get('/api/clients/:id', isAuthenticatedLocal, async (req, res) => {
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

  app.post('/api/clients', isAuthenticatedLocal, async (req: any, res) => {
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

  app.put('/api/clients/:id', isAuthenticatedLocal, async (req: any, res) => {
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
  app.get('/api/loads', isAuthenticatedLocal, async (req, res) => {
    try {
      const loads = await storage.getLoads();
      res.json(loads);
    } catch (error) {
      console.error("Error fetching loads:", error);
      res.status(500).json({ message: "Failed to fetch loads" });
    }
  });

  app.get('/api/loads/:id', isAuthenticatedLocal, async (req, res) => {
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

  app.post('/api/loads', isAuthenticatedLocal, async (req: any, res) => {
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
  app.get('/api/invoices', isAuthenticatedLocal, async (req, res) => {
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

  app.get('/api/invoices/search', isAuthenticatedLocal, async (req, res) => {
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
  app.get('/api/search', isAuthenticatedLocal, async (req, res) => {
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
  app.get('/api/fuel-card-applications', isAuthenticatedLocal, async (req, res) => {
    try {
      const applications = await storage.getFuelCardApplications();
      res.json(applications);
    } catch (error) {
      console.error("Error fetching fuel card applications:", error);
      res.status(500).json({ message: "Failed to fetch applications" });
    }
  });

  app.post('/api/fuel-card-applications', isAuthenticatedLocal, async (req, res) => {
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

  app.patch('/api/fuel-card-applications/:id', isAuthenticatedLocal, async (req, res) => {
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

  app.get('/api/invoices/:id', isAuthenticatedLocal, async (req, res) => {
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

  app.post('/api/invoices', isAuthenticatedLocal, async (req: any, res) => {
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

  app.put('/api/invoices/:id', isAuthenticatedLocal, async (req: any, res) => {
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
  app.get('/api/documents', isAuthenticatedLocal, async (req, res) => {
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
  app.get('/api/documents/:id', isAuthenticatedLocal, async (req, res) => {
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

  app.post('/api/documents/upload', isAuthenticatedLocal, upload.single('file'), async (req: any, res) => {
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

  app.delete('/api/documents/:id', isAuthenticatedLocal, async (req: any, res) => {
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
  app.get('/api/documents/:id/download', isAuthenticatedLocal, async (req, res) => {
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

  app.get('/api/documents/:id/view', isAuthenticatedLocal, async (req, res) => {
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

      res.setHeader('Content-Type', document.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${document.originalName}"`);
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      console.error("Error viewing document:", error);
      res.status(500).json({ message: "Failed to view document" });
    }
  });

  // Manager-only routes
  app.put('/api/invoices/:id/approve', isAuthenticatedLocal, async (req: any, res) => {
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
  app.get('/api/time-tracking/status', isAuthenticatedLocal, async (req: any, res) => {
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

  app.post('/api/time-tracking/clock-in', isAuthenticatedLocal, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const { notes } = req.body;
      
      const timeEntry = await storage.clockIn(userId, notes);
      res.json(timeEntry);
    } catch (error) {
      console.error("Error clocking in:", error);
      res.status(400).json({ message: (error as Error).message || "Failed to clock in" });
    }
  });

  app.post('/api/time-tracking/clock-out', isAuthenticatedLocal, async (req: any, res) => {
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

  app.get('/api/time-tracking/entries', isAuthenticatedLocal, async (req: any, res) => {
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
  app.get('/api/notifications', isAuthenticatedLocal, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const limit = parseInt(req.query.limit as string) || 20;
      const notifications = await storage.getNotifications(userId, limit);
      res.json(notifications);
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.get('/api/notifications/unread-count', isAuthenticatedLocal, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const count = await storage.getUnreadNotificationCount(userId);
      res.json({ count });
    } catch (error) {
      console.error("Error fetching unread notification count:", error);
      res.status(500).json({ message: "Failed to fetch unread count" });
    }
  });

  app.patch('/api/notifications/:id/read', isAuthenticatedLocal, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.markNotificationAsRead(id);
      res.json({ message: "Notification marked as read" });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ message: "Failed to mark notification as read" });
    }
  });

  app.patch('/api/notifications/mark-all-read', isAuthenticatedLocal, async (req: any, res) => {
    try {
      const userId = req.user.id;
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
      const filePath = path.resolve(process.cwd(), 'electron-dist', 'QuantumCore-Windows-Portable.tar.gz');
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Windows installer not found" });
      }

      const stats = fs.statSync(filePath);
      
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', 'attachment; filename="QuantumCore-Windows-Portable.tar.gz"');
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
      const filePath = path.resolve(process.cwd(), 'electron-dist', 'QuantumCore-Mac-Installer.tar.gz');
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Mac installer not found" });
      }

      const stats = fs.statSync(filePath);
      
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', 'attachment; filename="QuantumCore-Mac-Installer.tar.gz"');
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
      const filePath = path.resolve(process.cwd(), 'electron-dist', 'QuantumCore-Linux-Portable.tar.gz');
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Linux installer not found" });
      }

      const stats = fs.statSync(filePath);
      
      res.setHeader('Content-Type', 'application/gzip');
      res.setHeader('Content-Disposition', 'attachment; filename="QuantumCore-Linux-Portable.tar.gz"');
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
      res.setHeader('Content-Disposition', 'attachment; filename="QuantumCore-Installation-Guide.md"');
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
  app.post('/api/email/installer-links', isAuthenticatedLocal, async (req: any, res) => {
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
          <h1 style="color: #2563eb;">QuantumCore Desktop Access</h1>
          
          ${clientName ? `<p>Hello ${clientName},</p>` : '<p>Hello,</p>'}
          
          <p>You now have access to QuantumCore, our freight factoring management system. You can access it in two ways:</p>
          
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="color: #1e40af; margin-top: 0;">🌐 Web Access (Recommended)</h2>
            <p><strong>Live Application:</strong> <a href="${appUrl}" style="color: #2563eb; text-decoration: none; font-weight: bold;">${appUrl}</a></p>
            <p>Access QuantumCore directly in your web browser - no installation required.</p>
          </div>
          
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="color: #1e40af; margin-top: 0;">💻 Desktop Installers</h2>
            <p>For a desktop-like experience, download the portable launcher for your operating system:</p>
            
            <div style="margin: 15px 0;">
              <strong>🪟 Windows:</strong><br>
              <a href="${appUrl}/api/desktop/download/windows" style="color: #2563eb; text-decoration: none;">
                QuantumCore-Windows-Portable.tar.gz
              </a> (5.7 MB)
            </div>
            
            <div style="margin: 15px 0;">
              <strong>🍎 Mac:</strong><br>
              <a href="${appUrl}/api/desktop/download/mac" style="color: #2563eb; text-decoration: none;">
                QuantumCore-Mac-Portable.tar.gz
              </a> (5.7 MB)
            </div>
            
            <div style="margin: 15px 0;">
              <strong>🐧 Linux:</strong><br>
              <a href="${appUrl}/api/desktop/download/linux" style="color: #2563eb; text-decoration: none;">
                QuantumCore-Linux-Portable.tar.gz
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
            <li>QuantumCore opens automatically in your browser</li>
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
QuantumCore Desktop Access

${clientName ? `Hello ${clientName},` : 'Hello,'}

You now have access to QuantumCore, our freight factoring management system.

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
4. QuantumCore opens automatically in your browser

${message ? `Additional Information: ${message}` : ''}

If you have any questions or need assistance getting started, please don't hesitate to reach out.

Best regards,
Trucking Pros Financial Team
      `.trim();

      // For now, log the email content and return success (since SendGrid needs proper setup)
      console.log('Email would be sent to:', email);
      console.log('Subject:', `QuantumCore Access - ${clientName || 'Desktop Installation'}`);
      console.log('Content preview:', textContent.substring(0, 200) + '...');

      // Log activity
      await storage.createActivity({
        userId: req.user.id,
        type: 'installer_links_prepared',
        description: `QuantumCore access prepared for: ${email}${clientName ? ` (${clientName})` : ''}`,
        entityType: 'system',
        entityId: null,
      });

      // Return the email content for manual sending or display
      res.json({ 
        message: "QuantumCore access email prepared successfully",
        emailContent: {
          to: email,
          subject: `QuantumCore Access - ${clientName || 'Desktop Installation'}`,
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
    const filePath = path.resolve(process.cwd(), 'electron-dist', 'QuantumCore-Windows-Portable.tar.gz');
    if (fs.existsSync(filePath)) {
      res.download(filePath, 'QuantumCore-Windows-Portable.tar.gz');
    } else {
      res.status(404).json({ message: "Windows installer not found" });
    }
  });

  app.get('/api/download/mac', (req, res) => {
    const filePath = path.resolve(process.cwd(), 'electron-dist', 'QuantumCore-Mac-Portable.tar.gz');
    if (fs.existsSync(filePath)) {
      res.download(filePath, 'QuantumCore-Mac-Portable.tar.gz');
    } else {
      res.status(404).json({ message: "Mac installer not found" });
    }
  });

  app.get('/api/download/linux', (req, res) => {
    const filePath = path.resolve(process.cwd(), 'electron-dist', 'QuantumCore-Linux-Portable.tar.gz');
    if (fs.existsSync(filePath)) {
      res.download(filePath, 'QuantumCore-Linux-Portable.tar.gz');
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
        <title>QuantumCore Desktop Downloads</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          .download-card { background: #f5f5f5; padding: 20px; margin: 10px 0; border-radius: 8px; }
          .download-btn { background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 5px; }
          .download-btn:hover { background: #1d4ed8; }
          .file-size { color: #666; font-size: 0.9em; }
        </style>
      </head>
      <body>
        <h1>🚀 QuantumCore Desktop Installers</h1>
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
          <li>QuantumCore opens in your browser automatically</li>
        </ol>
        
        <p><strong>Requirements:</strong> Node.js must be installed on your computer (download from <a href="https://nodejs.org/">nodejs.org</a>)</p>
      </body>
      </html>
    `);
  });

  // Follow-up routes
  app.get('/api/follow-ups', isAuthenticatedLocal, async (req: any, res) => {
    try {
      const followUps = await storage.getAllFollowUps();
      res.json(followUps);
    } catch (error) {
      console.error("Error fetching follow-ups:", error);
      res.status(500).json({ message: "Failed to fetch follow-ups" });
    }
  });

  app.post('/api/follow-ups', isAuthenticatedLocal, async (req: any, res) => {
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

  app.patch('/api/follow-ups/:id', isAuthenticatedLocal, async (req: any, res) => {
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

  app.delete('/api/follow-ups/:id', isAuthenticatedLocal, async (req: any, res) => {
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

  // Emergency login endpoint that bypasses Passport 
  app.post('/api/emergency-login', async (req, res) => {
    try {
      const { email, password, secret } = req.body;
      
      if (secret !== 'emergency-tpf-2025') {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      console.log('Emergency login attempt for:', email);
      
      // Direct database query - no storage interface
      const [adminUser] = await db.select().from(userTable).where(
        and(
          eq(userTable.email, email),
          eq(userTable.authType, 'local')
        )
      );
      
      if (!adminUser) {
        return res.status(401).json({ message: 'User not found' });
      }

      console.log('Testing password for user:', adminUser.id);
      
      // Direct bcrypt comparison
      const passwordValid = await bcrypt.compare(password, adminUser.password);
      
      if (!passwordValid) {
        return res.status(401).json({ 
          message: 'Invalid password',
          debug: {
            hashLength: adminUser.password?.length,
            passwordLength: password.length
          }
        });
      }

      // Manually set session (bypass Passport)
      req.session.userId = adminUser.id;
      req.session.user = adminUser;
      
      console.log('Emergency login successful for:', email);
      
      return res.json({
        success: true,
        user: {
          id: adminUser.id,
          email: adminUser.email,
          firstName: adminUser.firstName,
          lastName: adminUser.lastName,
          role: adminUser.role
        }
      });
      
    } catch (error) {
      console.error('Emergency login error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Emergency login failed'
      });
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
      const isValid = await bcrypt.compare(password, user.password);
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
