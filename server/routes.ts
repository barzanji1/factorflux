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
      if (invoiceData.status === 'approved' && user?.role === 'manager') {
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
      if (user?.role !== 'manager') {
        return res.status(403).json({ message: "Only managers can approve invoices" });
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

  const httpServer = createServer(app);
  return httpServer;
}
