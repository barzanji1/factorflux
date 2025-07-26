import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { 
  insertClientSchema, 
  insertLoadSchema, 
  insertInvoiceSchema,
  insertDocumentSchema 
} from "@shared/schema";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { jsPDF } from "jspdf";
import { sendDesktopInstallers } from "./emailService";

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

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Profile routes
  app.patch('/api/user/profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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

  app.post('/api/user/profile-image', isAuthenticated, upload.single('profileImage'), async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
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
  app.get('/api/admin/users', isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
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

  app.patch('/api/admin/users/:userId/role', isAuthenticated, async (req: any, res) => {
    try {
      const currentUser = await storage.getUser(req.user.claims.sub);
      if (currentUser?.role !== 'manager' && currentUser?.role !== 'admin') {
        return res.status(403).json({ message: "Access denied. Manager or admin role required." });
      }

      const { userId } = req.params;
      const { role } = req.body;

      if (!['employee', 'manager', 'admin'].includes(role)) {
        return res.status(400).json({ message: "Invalid role. Must be 'employee', 'manager', or 'admin'." });
      }

      // Prevent changing own role
      if (userId === req.user.claims.sub) {
        return res.status(400).json({ message: "Cannot change your own role." });
      }

      await storage.updateUserProfile(userId, { role });
      const updatedUser = await storage.getUser(userId);

      // Log the activity
      await storage.createActivity({
        userId: req.user.claims.sub,
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
  app.get('/api/dashboard/stats', isAuthenticated, async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ message: "Failed to fetch dashboard statistics" });
    }
  });

  app.get('/api/dashboard/recent-activities', isAuthenticated, async (req, res) => {
    try {
      const activities = await storage.getActivities(10);
      res.json(activities);
    } catch (error) {
      console.error("Error fetching recent activities:", error);
      res.status(500).json({ message: "Failed to fetch recent activities" });
    }
  });

  // All activities endpoint
  app.get('/api/activities', isAuthenticated, async (req, res) => {
    try {
      const activities = await storage.getActivities();
      res.json(activities);
    } catch (error) {
      console.error("Error fetching all activities:", error);
      res.status(500).json({ message: "Failed to fetch activities" });
    }
  });

  // Clear all activities endpoint
  app.delete('/api/activities', isAuthenticated, async (req, res) => {
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
  app.get('/api/clients', isAuthenticated, async (req, res) => {
    try {
      const clients = await storage.getClients();
      res.json(clients);
    } catch (error) {
      console.error("Error fetching clients:", error);
      res.status(500).json({ message: "Failed to fetch clients" });
    }
  });

  app.get('/api/clients/search', isAuthenticated, async (req, res) => {
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

  app.get('/api/clients/:id', isAuthenticated, async (req, res) => {
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

  app.post('/api/clients', isAuthenticated, async (req: any, res) => {
    try {
      const clientData = insertClientSchema.parse(req.body);
      const client = await storage.createClient(clientData);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.claims.sub,
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

  app.put('/api/clients/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const clientData = insertClientSchema.partial().parse(req.body);
      const client = await storage.updateClient(id, clientData);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.claims.sub,
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
  app.get('/api/loads', isAuthenticated, async (req, res) => {
    try {
      const loads = await storage.getLoads();
      res.json(loads);
    } catch (error) {
      console.error("Error fetching loads:", error);
      res.status(500).json({ message: "Failed to fetch loads" });
    }
  });

  app.get('/api/loads/:id', isAuthenticated, async (req, res) => {
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

  app.post('/api/loads', isAuthenticated, async (req: any, res) => {
    try {
      const loadData = insertLoadSchema.parse(req.body);
      const load = await storage.createLoad(loadData);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.claims.sub,
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
  app.get('/api/invoices', isAuthenticated, async (req, res) => {
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

  app.get('/api/invoices/search', isAuthenticated, async (req, res) => {
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
  app.get('/api/search', isAuthenticated, async (req, res) => {
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
  app.get('/api/fuel-card-applications', isAuthenticated, async (req, res) => {
    try {
      const applications = await storage.getFuelCardApplications();
      res.json(applications);
    } catch (error) {
      console.error("Error fetching fuel card applications:", error);
      res.status(500).json({ message: "Failed to fetch applications" });
    }
  });

  app.post('/api/fuel-card-applications', isAuthenticated, async (req, res) => {
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

  app.patch('/api/fuel-card-applications/:id', isAuthenticated, async (req, res) => {
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

  app.get('/api/invoices/:id', isAuthenticated, async (req, res) => {
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

  app.post('/api/invoices', isAuthenticated, async (req: any, res) => {
    try {
      const invoiceData = insertInvoiceSchema.parse(req.body);
      const invoice = await storage.createInvoice({
        ...invoiceData,
        submittedBy: req.user.claims.sub,
        submittedAt: new Date(),
      });
      
      // Log activity
      await storage.createActivity({
        userId: req.user.claims.sub,
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

  app.put('/api/invoices/:id', isAuthenticated, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const user = await storage.getUser(req.user.claims.sub);
      const invoiceData = insertInvoiceSchema.partial().parse(req.body);
      
      // Add approval data if status is being changed to approved and user is manager
      if (invoiceData.status === 'approved' && (user?.role === 'manager' || user?.role === 'admin')) {
        invoiceData.approvedBy = req.user.claims.sub;
        invoiceData.approvedAt = new Date();
      }
      
      const invoice = await storage.updateInvoice(id, invoiceData);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.claims.sub,
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
  app.get('/api/documents', isAuthenticated, async (req, res) => {
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

  // Helper function to convert JPEG to PDF using jsPDF
  async function convertImageToPdf(inputPath: string, outputPath: string): Promise<void> {
    try {
      // Read the image file as base64
      const imageBuffer = fs.readFileSync(inputPath);
      const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
      
      // Create PDF with standard letter size
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      
      // Add image to PDF - fit to page with margins
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const maxWidth = pageWidth - (margin * 2);
      const maxHeight = pageHeight - (margin * 2);
      
      pdf.addImage(base64Image, 'JPEG', margin, margin, maxWidth, maxHeight);
      
      // Save PDF to file
      const pdfBuffer = Buffer.from(pdf.output('arraybuffer'));
      fs.writeFileSync(outputPath, pdfBuffer);
    } catch (error) {
      console.error('Error converting image to PDF:', error);
      throw error;
    }
  }

  app.post('/api/documents/upload', isAuthenticated, upload.single('file'), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { documentType, loadId, invoiceId } = req.body;
      let processedFilename = req.file.filename;
      let processedMimeType = req.file.mimetype;
      let processedOriginalName = req.file.originalname;

      // Convert JPEG/JPG to PDF automatically
      if (req.file.mimetype.includes('jpeg') || req.file.mimetype.includes('jpg')) {
        try {
          const pdfFilename = req.file.filename + '.pdf';
          const pdfPath = path.join('uploads', pdfFilename);
          
          await convertImageToPdf(req.file.path, pdfPath);
          
          // Remove original image file
          fs.unlinkSync(req.file.path);
          
          // Update file info to reflect PDF conversion
          processedFilename = pdfFilename;
          processedMimeType = 'application/pdf';
          processedOriginalName = req.file.originalname.replace(/\.[^/.]+$/, '.pdf');
          
          console.log(`Converted ${req.file.originalname} to PDF: ${pdfFilename}`);
        } catch (conversionError) {
          console.error('Failed to convert image to PDF:', conversionError);
          // Continue with original file if conversion fails
        }
      }
      
      const documentData = {
        filename: processedFilename,
        originalName: processedOriginalName,
        mimeType: processedMimeType,
        size: req.file.size,
        documentType: documentType || 'other',
        loadId: loadId && loadId !== 'undefined' ? parseInt(loadId) : null,
        invoiceId: invoiceId && invoiceId !== 'undefined' ? parseInt(invoiceId) : null,
        uploadedBy: req.user.claims.sub,
        status: 'processing' as const,
      };

      const document = await storage.createDocument(documentData);
      
      // Log activity
      await storage.createActivity({
        userId: req.user.claims.sub,
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

  app.delete('/api/documents/:id', isAuthenticated, async (req: any, res) => {
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
        const fs = require('fs');
        const path = require('path');
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
        userId: req.user.claims.sub,
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
  app.get('/api/documents/:id/download', isAuthenticated, async (req, res) => {
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

  app.get('/api/documents/:id/view', isAuthenticated, async (req, res) => {
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
  app.put('/api/invoices/:id/approve', isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (user?.role !== 'manager' && user?.role !== 'admin') {
        return res.status(403).json({ message: "Only managers and admins can approve invoices" });
      }

      const id = parseInt(req.params.id);
      const invoice = await storage.updateInvoice(id, {
        status: 'approved',
        approvedBy: req.user.claims.sub,
        approvedAt: new Date(),
      });
      
      // Log activity
      await storage.createActivity({
        userId: req.user.claims.sub,
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
  app.get('/api/time-tracking/status', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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

  app.post('/api/time-tracking/clock-in', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { notes } = req.body;
      
      const timeEntry = await storage.clockIn(userId, notes);
      res.json(timeEntry);
    } catch (error) {
      console.error("Error clocking in:", error);
      res.status(400).json({ message: (error as Error).message || "Failed to clock in" });
    }
  });

  app.post('/api/time-tracking/clock-out', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { notes } = req.body;
      
      const timeEntry = await storage.clockOut(userId, notes);
      res.json(timeEntry);
    } catch (error) {
      console.error("Error clocking out:", error);
      res.status(400).json({ message: (error as Error).message || "Failed to clock out" });
    }
  });

  app.get('/api/time-tracking/entries', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
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

  // Email installer route - send desktop installers via email
  app.post('/api/email/installers', isAuthenticated, async (req: any, res) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (user?.role !== 'manager' && user?.role !== 'admin') {
        return res.status(403).json({ message: "Only managers and admins can send installers" });
      }

      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: "Email address is required" });
      }

      const success = await sendDesktopInstallers(email);
      if (success) {
        // Log activity
        await storage.createActivity({
          userId: req.user.claims.sub,
          type: 'installer_email_sent',
          description: `Desktop installers sent to: ${email}`,
          entityType: 'system',
          entityId: null,
        });

        res.json({ message: "Desktop installers sent successfully" });
      } else {
        res.status(500).json({ message: "Failed to send installers" });
      }
    } catch (error) {
      console.error("Error sending installers:", error);
      res.status(500).json({ message: "Failed to send installers" });
    }
  });

  // Desktop installer download routes
  app.get('/download/windows', (req, res) => {
    const filePath = path.resolve(process.cwd(), 'electron-dist', 'QuantumCore-Windows-Portable.tar.gz');
    if (fs.existsSync(filePath)) {
      res.download(filePath, 'QuantumCore-Windows-Portable.tar.gz');
    } else {
      res.status(404).json({ message: "Windows installer not found" });
    }
  });

  app.get('/download/mac', (req, res) => {
    const filePath = path.resolve(process.cwd(), 'electron-dist', 'QuantumCore-Mac-Portable.tar.gz');
    if (fs.existsSync(filePath)) {
      res.download(filePath, 'QuantumCore-Mac-Portable.tar.gz');
    } else {
      res.status(404).json({ message: "Mac installer not found" });
    }
  });

  app.get('/download/linux', (req, res) => {
    const filePath = path.resolve(process.cwd(), 'electron-dist', 'QuantumCore-Linux-Portable.tar.gz');
    if (fs.existsSync(filePath)) {
      res.download(filePath, 'QuantumCore-Linux-Portable.tar.gz');
    } else {
      res.status(404).json({ message: "Linux installer not found" });
    }
  });

  app.get('/download/guide', (req, res) => {
    const filePath = path.resolve(process.cwd(), 'USER-INSTALLATION-GUIDE.md');
    if (fs.existsSync(filePath)) {
      res.download(filePath, 'USER-INSTALLATION-GUIDE.md');
    } else {
      res.status(404).json({ message: "Installation guide not found" });
    }
  });

  // Download page for easy access
  app.get('/downloads', (req, res) => {
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
          <a href="/download/windows" class="download-btn">Download Windows Version</a>
          <span class="file-size">(5.7 MB)</span>
        </div>
        
        <div class="download-card">
          <h3>🍎 Mac</h3>
          <p>For macOS 10.15 and later</p>
          <a href="/download/mac" class="download-btn">Download Mac Version</a>
          <span class="file-size">(5.7 MB)</span>
        </div>
        
        <div class="download-card">
          <h3>🐧 Linux</h3>
          <p>For most Linux distributions</p>
          <a href="/download/linux" class="download-btn">Download Linux Version</a>
          <span class="file-size">(5.7 MB)</span>
        </div>
        
        <div class="download-card">
          <h3>📖 Installation Guide</h3>
          <p>Complete setup instructions and troubleshooting</p>
          <a href="/download/guide" class="download-btn">Download Guide</a>
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

  // Portfolio route - serve the portfolio website
  app.get('/portfolio', (req, res) => {
    const portfolioPath = path.resolve(process.cwd(), 'portfolio-site', 'index.html');
    if (fs.existsSync(portfolioPath)) {
      res.sendFile(portfolioPath);
    } else {
      res.status(404).json({ message: "Portfolio not found" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
