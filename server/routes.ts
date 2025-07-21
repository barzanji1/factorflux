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
import { z } from "zod";

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
      const { load, invoice } = req.query;
      let documents;
      
      if (load) {
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

  app.post('/api/documents/upload', isAuthenticated, upload.single('document'), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const { documentType, loadId, invoiceId } = req.body;
      
      const documentData = {
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
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
