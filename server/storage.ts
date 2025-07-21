import {
  users,
  clients,
  loads,
  invoices,
  documents,
  activities,
  fuelCardApplications,
  type User,
  type UpsertUser,
  type Client,
  type InsertClient,
  type Load,
  type InsertLoad,
  type Invoice,
  type InsertInvoice,
  type Document,
  type InsertDocument,
  type Activity,
  type InsertActivity,
  type FuelCardApplication,
  type InsertFuelCardApplication,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, like, or, and, count, sql } from "drizzle-orm";

export interface IStorage {
  // User operations (required for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Client operations
  getClients(): Promise<Client[]>;
  getClient(id: number): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: number, client: Partial<InsertClient>): Promise<Client>;
  deleteClient(id: number): Promise<void>;
  searchClients(query: string): Promise<Client[]>;
  
  // Load operations
  getLoads(): Promise<Load[]>;
  getLoad(id: number): Promise<Load | undefined>;
  getLoadByNumber(loadNumber: string): Promise<Load | undefined>;
  createLoad(load: InsertLoad): Promise<Load>;
  updateLoad(id: number, load: Partial<InsertLoad>): Promise<Load>;
  deleteLoad(id: number): Promise<void>;
  searchLoads(query: string): Promise<Load[]>;
  
  // Invoice operations
  getInvoices(): Promise<Invoice[]>;
  getInvoice(id: number): Promise<Invoice | undefined>;
  getInvoicesByClient(clientId: number): Promise<Invoice[]>;
  getInvoicesByStatus(status: string): Promise<Invoice[]>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: number, invoice: Partial<InsertInvoice>): Promise<Invoice>;
  deleteInvoice(id: number): Promise<void>;
  searchInvoices(query: string): Promise<Invoice[]>;
  
  // Document operations
  getDocuments(): Promise<Document[]>;
  getDocument(id: number): Promise<Document | undefined>;
  getDocumentsByLoad(loadId: number): Promise<Document[]>;
  getDocumentsByInvoice(invoiceId: number): Promise<Document[]>;
  getDocumentsByEntity(entityType: string, entityId: number): Promise<Document[]>;
  createDocument(document: InsertDocument): Promise<Document>;
  updateDocument(id: number, document: Partial<InsertDocument>): Promise<Document>;
  deleteDocument(id: number): Promise<void>;
  
  // Activity operations
  getActivities(limit?: number): Promise<Activity[]>;
  createActivity(activity: InsertActivity): Promise<Activity>;
  
  // Dashboard statistics
  getDashboardStats(): Promise<{
    pendingInvoices: number;
    processedToday: number;
    totalRevenue: string;
    activeClients: number;
  }>;
  
  // Fuel card application operations
  getFuelCardApplications(): Promise<FuelCardApplication[]>;
  getFuelCardApplication(id: number): Promise<FuelCardApplication | undefined>;
  createFuelCardApplication(application: InsertFuelCardApplication): Promise<FuelCardApplication>;
  updateFuelCardApplication(id: number, application: Partial<InsertFuelCardApplication>): Promise<FuelCardApplication>;
}

export class DatabaseStorage implements IStorage {
  // User operations (required for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Client operations
  async getClients(): Promise<Client[]> {
    return await db.select().from(clients).orderBy(desc(clients.createdAt));
  }

  async getClient(id: number): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async createClient(client: InsertClient): Promise<Client> {
    const [newClient] = await db.insert(clients).values(client).returning();
    return newClient;
  }

  async updateClient(id: number, client: Partial<InsertClient>): Promise<Client> {
    const [updatedClient] = await db
      .update(clients)
      .set({ ...client, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();
    return updatedClient;
  }

  async deleteClient(id: number): Promise<void> {
    await db.delete(clients).where(eq(clients.id, id));
  }

  async searchClients(query: string): Promise<Client[]> {
    return await db
      .select()
      .from(clients)
      .where(
        or(
          like(clients.name, `%${query}%`),
          like(clients.email, `%${query}%`),
          like(clients.contactPerson, `%${query}%`)
        )
      )
      .orderBy(desc(clients.createdAt));
  }

  // Load operations
  async getLoads(): Promise<Load[]> {
    return await db.select().from(loads).orderBy(desc(loads.createdAt));
  }

  async getLoad(id: number): Promise<Load | undefined> {
    const [load] = await db.select().from(loads).where(eq(loads.id, id));
    return load;
  }

  async getLoadByNumber(loadNumber: string): Promise<Load | undefined> {
    const [load] = await db.select().from(loads).where(eq(loads.loadNumber, loadNumber));
    return load;
  }

  async createLoad(load: InsertLoad): Promise<Load> {
    const [newLoad] = await db.insert(loads).values(load).returning();
    return newLoad;
  }

  async updateLoad(id: number, load: Partial<InsertLoad>): Promise<Load> {
    const [updatedLoad] = await db
      .update(loads)
      .set({ ...load, updatedAt: new Date() })
      .where(eq(loads.id, id))
      .returning();
    return updatedLoad;
  }

  async deleteLoad(id: number): Promise<void> {
    await db.delete(loads).where(eq(loads.id, id));
  }

  async searchLoads(query: string): Promise<Load[]> {
    return await db
      .select()
      .from(loads)
      .where(
        or(
          like(loads.loadNumber, `%${query}%`),
          like(loads.pickupLocation, `%${query}%`),
          like(loads.deliveryLocation, `%${query}%`),
          like(loads.driverName, `%${query}%`)
        )
      )
      .orderBy(desc(loads.createdAt));
  }

  // Invoice operations
  async getInvoices(): Promise<Invoice[]> {
    return await db.select().from(invoices).orderBy(desc(invoices.createdAt));
  }

  async getInvoice(id: number): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice;
  }

  async getInvoicesByClient(clientId: number): Promise<Invoice[]> {
    return await db.select().from(invoices).where(eq(invoices.clientId, clientId)).orderBy(desc(invoices.createdAt));
  }

  async getInvoicesByStatus(status: string): Promise<Invoice[]> {
    return await db.select().from(invoices).where(eq(invoices.status, status as any)).orderBy(desc(invoices.createdAt));
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [newInvoice] = await db.insert(invoices).values(invoice).returning();
    return newInvoice;
  }

  async updateInvoice(id: number, invoice: Partial<InsertInvoice>): Promise<Invoice> {
    const [updatedInvoice] = await db
      .update(invoices)
      .set({ ...invoice, updatedAt: new Date() })
      .where(eq(invoices.id, id))
      .returning();
    return updatedInvoice;
  }

  async deleteInvoice(id: number): Promise<void> {
    await db.delete(invoices).where(eq(invoices.id, id));
  }

  async searchInvoices(query: string): Promise<Invoice[]> {
    return await db
      .select()
      .from(invoices)
      .where(
        or(
          like(invoices.invoiceNumber, `%${query}%`),
          like(sql`CAST(${invoices.loadId} AS TEXT)`, `%${query}%`)
        )
      )
      .orderBy(desc(invoices.createdAt));
  }

  // Document operations
  async getDocuments(): Promise<Document[]> {
    return await db.select().from(documents).orderBy(desc(documents.createdAt));
  }

  async getDocument(id: number): Promise<Document | undefined> {
    const [document] = await db.select().from(documents).where(eq(documents.id, id));
    return document;
  }

  async getDocumentsByLoad(loadId: number): Promise<Document[]> {
    return await db.select().from(documents).where(eq(documents.loadId, loadId)).orderBy(desc(documents.createdAt));
  }

  async getDocumentsByInvoice(invoiceId: number): Promise<Document[]> {
    return await db.select().from(documents).where(eq(documents.invoiceId, invoiceId)).orderBy(desc(documents.createdAt));
  }

  async getDocumentsByEntity(entityType: string, entityId: number): Promise<Document[]> {
    // For fuel card applications, we'll return all documents since we don't have
    // a direct relationship table yet. In the future, this could be enhanced
    // to filter by specific entity types and relationships
    return await db.select().from(documents).orderBy(desc(documents.createdAt));
  }

  async createDocument(document: InsertDocument): Promise<Document> {
    const [newDocument] = await db.insert(documents).values(document).returning();
    return newDocument;
  }

  async updateDocument(id: number, document: Partial<InsertDocument>): Promise<Document> {
    const [updatedDocument] = await db
      .update(documents)
      .set(document)
      .where(eq(documents.id, id))
      .returning();
    return updatedDocument;
  }

  async deleteDocument(id: number): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  // Activity operations
  async getActivities(limit?: number): Promise<Activity[]> {
    const query = db
      .select()
      .from(activities)
      .orderBy(desc(activities.createdAt));
    
    return limit ? await query.limit(limit) : await query;
  }

  async createActivity(activity: InsertActivity): Promise<Activity> {
    const [newActivity] = await db.insert(activities).values(activity).returning();
    return newActivity;
  }

  // Fuel card application operations
  async getFuelCardApplications(): Promise<FuelCardApplication[]> {
    return await db.select().from(fuelCardApplications).orderBy(desc(fuelCardApplications.createdAt));
  }

  async getFuelCardApplication(id: number): Promise<FuelCardApplication | undefined> {
    const [application] = await db.select().from(fuelCardApplications).where(eq(fuelCardApplications.id, id));
    return application;
  }

  async createFuelCardApplication(application: InsertFuelCardApplication): Promise<FuelCardApplication> {
    const [newApplication] = await db.insert(fuelCardApplications).values(application).returning();
    return newApplication;
  }

  async updateFuelCardApplication(id: number, application: Partial<InsertFuelCardApplication>): Promise<FuelCardApplication> {
    const [updatedApplication] = await db
      .update(fuelCardApplications)
      .set({ ...application, updatedAt: new Date() })
      .where(eq(fuelCardApplications.id, id))
      .returning();
    return updatedApplication;
  }

  // Dashboard statistics
  async getDashboardStats(): Promise<{
    pendingInvoices: number;
    processedToday: number;
    totalRevenue: string;
    activeClients: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [pendingInvoicesResult] = await db
      .select({ count: count() })
      .from(invoices)
      .where(eq(invoices.status, 'submitted'));

    const [processedTodayResult] = await db
      .select({ count: count() })
      .from(invoices)
      .where(
        and(
          eq(invoices.status, 'approved'),
          sql`DATE(${invoices.approvedAt}) = CURRENT_DATE`
        )
      );

    const [totalRevenueResult] = await db
      .select({ sum: sql<string>`COALESCE(SUM(${invoices.amount}), 0)` })
      .from(invoices)
      .where(eq(invoices.status, 'paid'));

    const [activeClientsResult] = await db
      .select({ count: count() })
      .from(clients)
      .where(eq(clients.status, 'active'));

    return {
      pendingInvoices: pendingInvoicesResult.count,
      processedToday: processedTodayResult.count,
      totalRevenue: totalRevenueResult.sum || '0',
      activeClients: activeClientsResult.count,
    };
  }
}

export const storage = new DatabaseStorage();
