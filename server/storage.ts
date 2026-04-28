import {
  users,
  clients,
  debtors,
  debtorContacts,
  loads,
  invoices,
  documents,
  documentLinks,
  invoiceStatusHistory,
  eventLedger,
  activities,
  supportMessages,
  fuelCardApplications,
  timeEntries,
  notifications,
  followUps,
  collections,
  clientVault,
  type User,
  type UpsertUser,
  type TimeEntry,
  type InsertTimeEntry,
  type Client,
  type InsertClient,
  type Debtor,
  type InsertDebtor,
  type Load,
  type InsertLoad,
  type Invoice,
  type InsertInvoice,
  type Document,
  type InsertDocument,
  type DocumentLink,
  type InsertDocumentLink,
  type InvoiceStatusHistory,
  type InsertInvoiceStatusHistory,
  type EventLedger,
  type InsertEventLedger,
  type Activity,
  type InsertActivity,
  type SupportMessage,
  type InsertSupportMessage,
  type FuelCardApplication,
  type InsertFuelCardApplication,
  type Notification,
  type InsertNotification,
  type FollowUp,
  type InsertFollowUp,
  type Collection,
  type InsertCollection,
  type ClientVault,
  type InsertClientVault,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, like, or, and, count, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserProfile(id: string, updates: Partial<User>): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getUserByEmailAndType(email: string, authType: string): Promise<User[]>;

  // Client operations
  getClients(): Promise<Client[]>;
  getClient(id: number): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: number, client: Partial<InsertClient>): Promise<Client>;
  deleteClient(id: number): Promise<void>;
  searchClients(query: string): Promise<Client[]>;

  // Debtor operations
  getDebtors(): Promise<Debtor[]>;
  getDebtor(id: number): Promise<Debtor | undefined>;
  createDebtor(debtor: InsertDebtor): Promise<Debtor>;
  updateDebtor(id: number, debtor: Partial<InsertDebtor>): Promise<Debtor>;
  deleteDebtor(id: number): Promise<void>;
  searchDebtors(query: string): Promise<Debtor[]>;

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
  getDocumentLinks(documentId: number): Promise<DocumentLink[]>;
  linkDocument(link: InsertDocumentLink): Promise<DocumentLink>;

  // Activity operations
  getActivities(limit?: number): Promise<Activity[]>;
  createActivity(activity: InsertActivity): Promise<Activity>;
  clearActivities(): Promise<void>;

  // Invoice history / event ledger
  getInvoiceStatusHistory(invoiceId: number): Promise<InvoiceStatusHistory[]>;
  createInvoiceStatusHistory(entry: InsertInvoiceStatusHistory): Promise<InvoiceStatusHistory>;
  getEvents(entityType?: string, entityId?: number): Promise<EventLedger[]>;
  createEvent(entry: InsertEventLedger): Promise<EventLedger>;

  // Support message operations
  getSupportMessages(): Promise<SupportMessage[]>;
  getSupportMessage(id: number): Promise<SupportMessage | undefined>;
  createSupportMessage(message: InsertSupportMessage): Promise<SupportMessage>;
  deleteSupportMessage(id: number): Promise<void>;

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
  updateFuelCardApplication(
    id: number,
    application: Partial<InsertFuelCardApplication>
  ): Promise<FuelCardApplication>;

  // Time tracking operations
  getTimeEntries(userId: string): Promise<TimeEntry[]>;
  getCurrentTimeEntry(userId: string): Promise<TimeEntry | undefined>;
  clockIn(userId: string, notes?: string): Promise<TimeEntry>;
  clockOut(userId: string, notes?: string): Promise<TimeEntry>;
  getTimeEntryById(id: number): Promise<TimeEntry | undefined>;
  getTodayTimeEntries(userId: string): Promise<TimeEntry[]>;
  getWeekTimeEntries(userId: string): Promise<TimeEntry[]>;

  // Notification operations
  getNotifications(userId: string, limit?: number): Promise<Notification[]>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationAsRead(id: number): Promise<void>;
  markAllNotificationsAsRead(userId: string): Promise<void>;
  getUnreadNotificationCount(userId: string): Promise<number>;

  // Follow-up operations
  getAllFollowUps(): Promise<FollowUp[]>;
  getFollowUp(id: number): Promise<FollowUp | undefined>;
  createFollowUp(followUp: InsertFollowUp): Promise<FollowUp>;
  updateFollowUp(id: number, updates: Partial<InsertFollowUp>): Promise<FollowUp>;
  deleteFollowUp(id: number): Promise<void>;

  // Collections operations
  getAllCollections(): Promise<Collection[]>;
  getCollection(id: number): Promise<Collection | undefined>;
  getCollectionsByClient(clientId: number): Promise<Collection[]>;
  createCollection(collection: InsertCollection): Promise<Collection>;
  updateCollection(id: number, updates: Partial<InsertCollection>): Promise<Collection>;
  deleteCollection(id: number): Promise<void>;
  getClientPerformanceData(): Promise<
    {
      clientId: number;
      name: string;
      lastLoadDate: Date | null;
      daysSinceLastLoad: number;
      status: "active" | "warning" | "inactive";
      totalOwed: string;
      pendingCollections: number;
    }[]
  >;

  // Client Vault operations
  getAllVaultEntries(clientId: number): Promise<ClientVault[]>;
  getVaultEntry(id: number): Promise<ClientVault | undefined>;
  createVaultEntry(entry: InsertClientVault): Promise<ClientVault>;
  updateVaultEntry(id: number, updates: Partial<InsertClientVault>): Promise<ClientVault>;
  deleteVaultEntry(id: number): Promise<void>;
  recordVaultAccess(id: number, userId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // User operations
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

  async updateUserProfile(id: string, updates: Partial<User>): Promise<User> {
    const [updatedUser] = await db
      .update(users)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    return updatedUser;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByEmailAndType(email: string, authType: string): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), eq(users.authType, authType as "replit" | "local")));
  }

  // Client operations
  async getClients(): Promise<Client[]> {
    const rows = await db
      .select()
      .from(clients)
      .orderBy(desc(clients.createdAt));

    return rows.map((c) => ({
      ...c,
      createdAt: c.createdAt || new Date(), // fallback safety
      updatedAt: c.updatedAt || new Date(),
    }));
  }

  async getClient(id: number): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client;
  }

  async createClient(client: InsertClient): Promise<Client> {
    const [newClient] = await db
      .insert(clients)
      .values({
        ...client,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return newClient;
  }

  async updateClient(id: number, client: Partial<InsertClient>): Promise<Client> {
    const [updatedClient] = await db
      .update(clients)
      .set({
        ...client,
        updatedAt: new Date(),
      })
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

  // Debtor operations
  async getDebtors(): Promise<Debtor[]> {
    return await db.select().from(debtors).orderBy(desc(debtors.createdAt));
  }

  async getDebtor(id: number): Promise<Debtor | undefined> {
    const [debtor] = await db.select().from(debtors).where(eq(debtors.id, id));
    return debtor;
  }

  async createDebtor(debtor: InsertDebtor): Promise<Debtor> {
    const [newDebtor] = await db.insert(debtors).values(debtor).returning();
    return newDebtor;
  }

  async updateDebtor(id: number, debtor: Partial<InsertDebtor>): Promise<Debtor> {
    const [updatedDebtor] = await db
      .update(debtors)
      .set({ ...debtor, updatedAt: new Date() })
      .where(eq(debtors.id, id))
      .returning();

    return updatedDebtor;
  }

  async deleteDebtor(id: number): Promise<void> {
    await db.delete(debtors).where(eq(debtors.id, id));
  }

  async searchDebtors(query: string): Promise<Debtor[]> {
    return await db
      .select()
      .from(debtors)
      .where(
        or(
          like(debtors.name, `%${query}%`),
          like(debtors.email, `%${query}%`),
          like(debtors.contactPerson, `%${query}%`)
        )
      )
      .orderBy(desc(debtors.createdAt));
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
    const [newLoad] = await db.insert(loads).values(load as any).returning();
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
    return await db
      .select()
      .from(invoices)
      .where(eq(invoices.clientId, clientId))
      .orderBy(desc(invoices.createdAt));
  }

  async getInvoicesByStatus(status: string): Promise<Invoice[]> {
    return await db
      .select()
      .from(invoices)
      .where(eq(invoices.status, status as any))
      .orderBy(desc(invoices.createdAt));
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [newInvoice] = await db.insert(invoices).values(invoice).returning();

    await this.createInvoiceStatusHistory({
      invoiceId: newInvoice.id,
      oldStatus: null,
      newStatus: newInvoice.status,
      changedBy: newInvoice.submittedBy || null,
      reason: "Invoice created",
    });

    await this.createEvent({
      entityType: "invoice",
      entityId: newInvoice.id,
      eventType: "invoice.created",
      actorType: "user",
      actorId: newInvoice.submittedBy || null,
      payloadJson: {
        invoiceNumber: newInvoice.invoiceNumber,
        status: newInvoice.status,
        clientId: newInvoice.clientId,
        debtorId: newInvoice.debtorId,
        amount: newInvoice.amount,
      },
    });

    return newInvoice;
  }

  async updateInvoice(id: number, invoice: Partial<InsertInvoice>): Promise<Invoice> {
    const existing = await this.getInvoice(id);
    if (!existing) {
      throw new Error("Invoice not found");
    }

    const [updatedInvoice] = await db
      .update(invoices)
      .set({ ...invoice, updatedAt: new Date() })
      .where(eq(invoices.id, id))
      .returning();

    if (invoice.status && invoice.status !== existing.status) {
      await this.createInvoiceStatusHistory({
        invoiceId: updatedInvoice.id,
        oldStatus: existing.status,
        newStatus: invoice.status,
        changedBy:
          updatedInvoice.approvedBy ||
          updatedInvoice.submittedBy ||
          updatedInvoice.assignedTo ||
          null,
        reason: "Invoice status updated",
      });

      await this.createEvent({
        entityType: "invoice",
        entityId: updatedInvoice.id,
        eventType: "invoice.status_changed",
        actorType: "user",
        actorId:
          updatedInvoice.approvedBy ||
          updatedInvoice.submittedBy ||
          updatedInvoice.assignedTo ||
          null,
        payloadJson: {
          oldStatus: existing.status,
          newStatus: invoice.status,
        },
      });
    }

    await this.createEvent({
      entityType: "invoice",
      entityId: updatedInvoice.id,
      eventType: "invoice.updated",
      actorType: "user",
      actorId:
        updatedInvoice.approvedBy ||
        updatedInvoice.submittedBy ||
        updatedInvoice.assignedTo ||
        null,
      payloadJson: invoice,
    });

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
          like(invoices.loadNumber, `%${query}%`),
          like(invoices.bolNumber, `%${query}%`)
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
    return await db
      .select()
      .from(documents)
      .where(eq(documents.loadId, loadId))
      .orderBy(desc(documents.createdAt));
  }

  async getDocumentsByInvoice(invoiceId: number): Promise<Document[]> {
    return await db
      .select()
      .from(documents)
      .where(eq(documents.invoiceId, invoiceId))
      .orderBy(desc(documents.createdAt));
  }

  async getDocumentsByEntity(entityType: string, entityId: number): Promise<Document[]> {
    const rows = await db
      .select({
        id: documents.id,
        companyId: documents.companyId,
        filename: documents.filename,
        originalName: documents.originalName,
        mimeType: documents.mimeType,
        size: documents.size,
        storageKey: documents.storageKey,
        documentType: documents.documentType,
        loadId: documents.loadId,
        invoiceId: documents.invoiceId,
        uploadedBy: documents.uploadedBy,
        sourceChannel: documents.sourceChannel,
        status: documents.status,
        createdAt: documents.createdAt,
      })
      .from(documentLinks)
      .innerJoin(documents, eq(documentLinks.documentId, documents.id))
      .where(
        and(
          eq(documentLinks.entityType, entityType as any),
          eq(documentLinks.entityId, entityId)
        )
      )
      .orderBy(desc(documents.createdAt));

    return rows as Document[];
  }

  async createDocument(document: InsertDocument): Promise<Document> {
    const [newDocument] = await db.insert(documents).values(document).returning();

    if (newDocument.invoiceId) {
      await this.linkDocument({
        documentId: newDocument.id,
        entityType: "invoice",
        entityId: newDocument.invoiceId,
      });
    }

    if (newDocument.loadId) {
      await this.linkDocument({
        documentId: newDocument.id,
        entityType: "load",
        entityId: newDocument.loadId,
      });
    }

    await this.createEvent({
      entityType: "document",
      entityId: newDocument.id,
      eventType: "document.created",
      actorType: "user",
      actorId: newDocument.uploadedBy,
      payloadJson: {
        originalName: newDocument.originalName,
        documentType: newDocument.documentType,
        invoiceId: newDocument.invoiceId,
        loadId: newDocument.loadId,
      },
    });

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

  async getDocumentLinks(documentId: number): Promise<DocumentLink[]> {
    return await db
      .select()
      .from(documentLinks)
      .where(eq(documentLinks.documentId, documentId))
      .orderBy(desc(documentLinks.createdAt));
  }

  async linkDocument(link: InsertDocumentLink): Promise<DocumentLink> {
    const [newLink] = await db.insert(documentLinks).values(link).returning();
    return newLink;
  }

  // Activity operations
  async getActivities(limit?: number): Promise<Activity[]> {
    const query = db.select().from(activities).orderBy(desc(activities.createdAt));
    return limit ? await query.limit(limit) : await query;
  }

  async createActivity(activity: InsertActivity): Promise<Activity> {
    const [newActivity] = await db.insert(activities).values(activity as any).returning();

    if (this.shouldCreateNotification(activity.type)) {
      await this.createNotificationFromActivity(activity, newActivity);
    }

    return newActivity;
  }

  async clearActivities(): Promise<void> {
    await db.delete(activities);
  }

  async getInvoiceStatusHistory(invoiceId: number): Promise<InvoiceStatusHistory[]> {
    return await db
      .select()
      .from(invoiceStatusHistory)
      .where(eq(invoiceStatusHistory.invoiceId, invoiceId))
      .orderBy(desc(invoiceStatusHistory.createdAt));
  }

  async createInvoiceStatusHistory(
    entry: InsertInvoiceStatusHistory
  ): Promise<InvoiceStatusHistory> {
    const [newEntry] = await db.insert(invoiceStatusHistory).values(entry).returning();
    return newEntry;
  }

  async getEvents(entityType?: string, entityId?: number): Promise<EventLedger[]> {
    if (entityType && typeof entityId === "number") {
      return await db
        .select()
        .from(eventLedger)
        .where(
          and(
            eq(eventLedger.entityType, entityType as any),
            eq(eventLedger.entityId, entityId)
          )
        )
        .orderBy(desc(eventLedger.createdAt));
    }

    return await db.select().from(eventLedger).orderBy(desc(eventLedger.createdAt));
  }

  async createEvent(entry: InsertEventLedger): Promise<EventLedger> {
    const [newEvent] = await db.insert(eventLedger).values(entry).returning();
    return newEvent;
  }

  private shouldCreateNotification(activityType: string): boolean {
    const notifiableTypes = [
      "document_uploaded",
      "invoice_created",
      "invoice_approved",
      "fuel_card_application_submitted",
      "fuel_card_application_approved",
      "fuel_card_application_rejected",
    ];
    return notifiableTypes.includes(activityType);
  }

  private async createNotificationFromActivity(
    activity: InsertActivity,
    _createdActivity: Activity
  ): Promise<void> {
    const notificationMap: Record<
      string,
      { title: string; message: string; type: "info" | "success" | "warning" | "error" }
    > = {
      document_uploaded: {
        title: "Document Uploaded",
        message: `New document has been uploaded and is being processed.`,
        type: "info",
      },
      invoice_created: {
        title: "Invoice Created",
        message: `New invoice has been created and is ready for review.`,
        type: "info",
      },
      invoice_approved: {
        title: "Invoice Approved",
        message: `Invoice has been approved and is ready for processing.`,
        type: "success",
      },
      fuel_card_application_submitted: {
        title: "Fuel Card Application",
        message: `Your fuel card application has been submitted for review.`,
        type: "info",
      },
      fuel_card_application_approved: {
        title: "Fuel Card Approved",
        message: `Your fuel card application has been approved!`,
        type: "success",
      },
      fuel_card_application_rejected: {
        title: "Fuel Card Application",
        message: `Your fuel card application needs revision. Please check the details.`,
        type: "warning",
      },
    };

    const notificationData = notificationMap[activity.type];
    if (notificationData) {
      await this.createNotification({
        userId: activity.userId,
        title: notificationData.title,
        message: notificationData.message,
        type: notificationData.type,
        entityType: activity.entityType || undefined,
        entityId: activity.entityId || undefined,
      });
    }
  }

  // Support message operations
  async getSupportMessages(): Promise<SupportMessage[]> {
    return await db.select().from(supportMessages).orderBy(desc(supportMessages.createdAt));
  }

  async getSupportMessage(id: number): Promise<SupportMessage | undefined> {
    const [message] = await db.select().from(supportMessages).where(eq(supportMessages.id, id));
    return message;
  }

  async createSupportMessage(message: InsertSupportMessage): Promise<SupportMessage> {
    const [newMessage] = await db.insert(supportMessages).values(message).returning();
    return newMessage;
  }

  async deleteSupportMessage(id: number): Promise<void> {
    await db.delete(supportMessages).where(eq(supportMessages.id, id));
  }

  // Dashboard statistics
  async getDashboardStats(): Promise<{
    pendingInvoices: number;
    processedToday: number;
    totalRevenue: string;
    activeClients: number;
  }> {
    const [pendingInvoicesResult] = await db
      .select({ count: count() })
      .from(invoices)
      .where(eq(invoices.status, "submitted"));

    const [processedTodayResult] = await db
      .select({ count: count() })
      .from(invoices)
      .where(and(eq(invoices.status, "approved"), sql`DATE(${invoices.approvedAt}) = CURRENT_DATE`));

    const [totalRevenueResult] = await db
      .select({ sum: sql<string>`COALESCE(SUM(${invoices.amount}), 0)` })
      .from(invoices)
      .where(eq(invoices.status, "paid"));

    const [activeClientsResult] = await db
      .select({ count: count() })
      .from(clients)
      .where(eq(clients.status, "active"));

    return {
      pendingInvoices: pendingInvoicesResult.count,
      processedToday: processedTodayResult.count,
      totalRevenue: totalRevenueResult.sum || "0",
      activeClients: activeClientsResult.count,
    };
  }

  // Fuel card application operations
  async getFuelCardApplications(): Promise<FuelCardApplication[]> {
    return await db.select().from(fuelCardApplications).orderBy(desc(fuelCardApplications.createdAt));
  }

  async getFuelCardApplication(id: number): Promise<FuelCardApplication | undefined> {
    const [application] = await db
      .select()
      .from(fuelCardApplications)
      .where(eq(fuelCardApplications.id, id));
    return application;
  }

  async createFuelCardApplication(
    application: InsertFuelCardApplication
  ): Promise<FuelCardApplication> {
    const [newApplication] = await db
      .insert(fuelCardApplications)
      .values(application)
      .returning();
    return newApplication;
  }

  async updateFuelCardApplication(
    id: number,
    application: Partial<InsertFuelCardApplication>
  ): Promise<FuelCardApplication> {
    const [updatedApplication] = await db
      .update(fuelCardApplications)
      .set({ ...application, updatedAt: new Date() })
      .where(eq(fuelCardApplications.id, id))
      .returning();

    return updatedApplication;
  }

  // Time tracking operations
  async getTimeEntries(userId: string): Promise<TimeEntry[]> {
    return await db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.userId, userId))
      .orderBy(desc(timeEntries.clockInTime));
  }

  async getCurrentTimeEntry(userId: string): Promise<TimeEntry | undefined> {
    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, userId), eq(timeEntries.status, "clocked_in")))
      .orderBy(desc(timeEntries.clockInTime))
      .limit(1);

    return entry;
  }

  async clockIn(userId: string, notes?: string): Promise<TimeEntry> {
    const existingEntry = await this.getCurrentTimeEntry(userId);
    if (existingEntry) {
      throw new Error("User is already clocked in");
    }

    const [timeEntry] = await db
      .insert(timeEntries)
      .values({
        userId,
        clockInTime: new Date(),
        status: "clocked_in",
        notes: notes || null,
      } as any)
      .returning();

    await this.createActivity({
      userId,
      type: "clock_in",
      description: `Clocked in at ${new Date().toLocaleTimeString()}`,
      entityType: "time_entry",
      entityId: timeEntry.id,
    });

    return timeEntry;
  }

  async clockOut(userId: string, notes?: string): Promise<TimeEntry> {
    const currentEntry = await this.getCurrentTimeEntry(userId);
    if (!currentEntry) {
      throw new Error("No active clock-in found");
    }

    const clockOutTime = new Date();
    const totalHours =
      (clockOutTime.getTime() - currentEntry.clockInTime.getTime()) / (1000 * 60 * 60);

    const [timeEntry] = await db
      .update(timeEntries)
      .set({
        clockOutTime,
        totalHours: totalHours.toFixed(2),
        status: "clocked_out",
        notes: notes || currentEntry.notes,
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, currentEntry.id))
      .returning();

    await this.createActivity({
      userId,
      type: "clock_out",
      description: `Clocked out at ${clockOutTime.toLocaleTimeString()} (${totalHours.toFixed(2)} hours)`,
      entityType: "time_entry",
      entityId: timeEntry.id,
    });

    return timeEntry;
  }

  async getTimeEntryById(id: number): Promise<TimeEntry | undefined> {
    const [entry] = await db.select().from(timeEntries).where(eq(timeEntries.id, id));
    return entry;
  }

  async getTodayTimeEntries(userId: string): Promise<TimeEntry[]> {
    return await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, userId), sql`DATE(${timeEntries.clockInTime}) = CURRENT_DATE`))
      .orderBy(desc(timeEntries.clockInTime));
  }

  async getWeekTimeEntries(userId: string): Promise<TimeEntry[]> {
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    return await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, userId), sql`${timeEntries.clockInTime} >= ${startOfWeek}`))
      .orderBy(desc(timeEntries.clockInTime));
  }

  // Notification operations
  async getNotifications(userId: string, limit: number = 20): Promise<Notification[]> {
    return await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [newNotification] = await db.insert(notifications).values(notification as any).returning();
    return newNotification;
  }

  async markNotificationAsRead(id: number): Promise<void> {
    await db.update(notifications).set({ read: true }).where(eq(notifications.id, id));
  }

  async markAllNotificationsAsRead(userId: string): Promise<void> {
    await db.update(notifications).set({ read: true }).where(eq(notifications.userId, userId));
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.read, false)));

    return result[0]?.count || 0;
  }

  // Follow-up operations
  async getAllFollowUps(): Promise<FollowUp[]> {
    return (await db
      .select({
        id: followUps.id,
        clientId: followUps.clientId,
        title: followUps.title,
        description: followUps.description,
        priority: followUps.priority,
        status: followUps.status,
        dueDate: followUps.dueDate,
        createdAt: followUps.createdAt,
        updatedAt: followUps.updatedAt,
        client: {
          id: clients.id,
          name: clients.name,
          email: clients.email,
        },
      })
      .from(followUps)
      .leftJoin(clients, eq(followUps.clientId, clients.id))
      .orderBy(desc(followUps.createdAt))) as any;
  }

  async getFollowUp(id: number): Promise<FollowUp | undefined> {
    const [followUp] = await db.select().from(followUps).where(eq(followUps.id, id));
    return followUp;
  }

  async createFollowUp(followUp: InsertFollowUp): Promise<FollowUp> {
    const [newFollowUp] = await db.insert(followUps).values(followUp as any).returning();
    return newFollowUp;
  }

  async updateFollowUp(id: number, updates: Partial<InsertFollowUp>): Promise<FollowUp> {
    const [updatedFollowUp] = await db
      .update(followUps)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(followUps.id, id))
      .returning();

    return updatedFollowUp;
  }

  async deleteFollowUp(id: number): Promise<void> {
    await db.delete(followUps).where(eq(followUps.id, id));
  }

  // Collections operations
  async getAllCollections(): Promise<Collection[]> {
    return (await db
      .select({
        id: collections.id,
        clientId: collections.clientId,
        amount: collections.amount,
        description: collections.description,
        status: collections.status,
        priority: collections.priority,
        dueDate: collections.dueDate,
        lastContactDate: collections.lastContactDate,
        notes: collections.notes,
        assignedTo: collections.assignedTo,
        createdAt: collections.createdAt,
        updatedAt: collections.updatedAt,
        client: {
          id: clients.id,
          name: clients.name,
          email: clients.email,
          status: clients.status,
        },
        assignedUser: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(collections)
      .leftJoin(clients, eq(collections.clientId, clients.id))
      .leftJoin(users, eq(collections.assignedTo, users.id))
      .orderBy(desc(collections.createdAt))) as any;
  }

  async getCollection(id: number): Promise<Collection | undefined> {
    const [collection] = await db
      .select({
        id: collections.id,
        clientId: collections.clientId,
        amount: collections.amount,
        description: collections.description,
        status: collections.status,
        priority: collections.priority,
        dueDate: collections.dueDate,
        lastContactDate: collections.lastContactDate,
        notes: collections.notes,
        assignedTo: collections.assignedTo,
        createdAt: collections.createdAt,
        updatedAt: collections.updatedAt,
        client: {
          id: clients.id,
          name: clients.name,
          email: clients.email,
          status: clients.status,
        },
        assignedUser: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(collections)
      .leftJoin(clients, eq(collections.clientId, clients.id))
      .leftJoin(users, eq(collections.assignedTo, users.id))
      .where(eq(collections.id, id));

    return collection as any;
  }

  async getCollectionsByClient(clientId: number): Promise<Collection[]> {
    return await db
      .select()
      .from(collections)
      .where(eq(collections.clientId, clientId))
      .orderBy(desc(collections.createdAt));
  }

  async createCollection(collection: InsertCollection): Promise<Collection> {
    const [newCollection] = await db.insert(collections).values(collection as any).returning();

    await this.createActivity({
      userId: collection.assignedTo || "system",
      type: "collection_created",
      description: `New collection created for ${collection.amount} - ${collection.description}`,
      entityType: "collection",
      entityId: newCollection.id,
    });

    return newCollection;
  }

  async updateCollection(id: number, updates: Partial<InsertCollection>): Promise<Collection> {
    const [updatedCollection] = await db
      .update(collections)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(collections.id, id))
      .returning();

    if (updates.status) {
      await this.createActivity({
        userId: updates.assignedTo || "system",
        type: "collection_updated",
        description: `Collection status updated to ${updates.status}`,
        entityType: "collection",
        entityId: id,
      });
    }

    return updatedCollection;
  }

  async deleteCollection(id: number): Promise<void> {
    await db.delete(collections).where(eq(collections.id, id));
  }

  async getClientPerformanceData(): Promise<
    {
      clientId: number;
      name: string;
      lastLoadDate: Date | null;
      daysSinceLastLoad: number;
      status: "active" | "warning" | "inactive";
      totalOwed: string;
      pendingCollections: number;
    }[]
  > {
    const clientsWithData = await db
      .select({
        clientId: clients.id,
        name: clients.name,
        lastLoadDate: sql<Date | null>`MAX(${loads.createdAt})`,
        totalOwed: sql<string>`COALESCE(SUM(CASE WHEN ${collections.status} IN ('pending', 'in_progress') THEN ${collections.amount} ELSE 0 END), 0)`,
        pendingCollections: sql<number>`COUNT(CASE WHEN ${collections.status} IN ('pending', 'in_progress') THEN 1 END)`,
      })
      .from(clients)
      .leftJoin(loads, eq(clients.id, loads.clientId))
      .leftJoin(collections, eq(clients.id, collections.clientId))
      .groupBy(clients.id, clients.name)
      .orderBy(clients.name);

    return clientsWithData.map((client) => {
      const daysSinceLastLoad = client.lastLoadDate
        ? Math.floor((Date.now() - client.lastLoadDate.getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      let status: "active" | "warning" | "inactive";
      if (daysSinceLastLoad <= 7) {
        status = "active";
      } else if (daysSinceLastLoad <= 30) {
        status = "warning";
      } else {
        status = "inactive";
      }

      return {
        ...client,
        daysSinceLastLoad,
        status,
      };
    });
  }

  // Client Vault operations
  async getAllVaultEntries(clientId: number): Promise<ClientVault[]> {
    const createdByAlias = alias(users, "created_by_user");
    const lastAccessedByAlias = alias(users, "last_accessed_by_user");
    return (await db
      .select({
        id: clientVault.id,
        clientId: clientVault.clientId,
        dataType: clientVault.dataType,
        label: clientVault.label,
        encryptedData: clientVault.encryptedData,
        notes: clientVault.notes,
        isActive: clientVault.isActive,
        lastAccessedAt: clientVault.lastAccessedAt,
        lastAccessedBy: clientVault.lastAccessedBy,
        createdAt: clientVault.createdAt,
        updatedAt: clientVault.updatedAt,
        createdBy: clientVault.createdBy,
        client: {
          id: clients.id,
          name: clients.name,
        },
        createdByUser: {
          id: createdByAlias.id,
          firstName: createdByAlias.firstName,
          lastName: createdByAlias.lastName,
        },
        lastAccessedByUser: {
          id: lastAccessedByAlias.id,
          firstName: lastAccessedByAlias.firstName,
          lastName: lastAccessedByAlias.lastName,
        },
      })
      .from(clientVault)
      .leftJoin(clients, eq(clientVault.clientId, clients.id))
      .leftJoin(createdByAlias, eq(clientVault.createdBy, createdByAlias.id))
      .leftJoin(lastAccessedByAlias, eq(clientVault.lastAccessedBy, lastAccessedByAlias.id))
      .where(and(eq(clientVault.clientId, clientId), eq(clientVault.isActive, true)))
      .orderBy(desc(clientVault.createdAt))) as any;
  }

  async getVaultEntry(id: number): Promise<ClientVault | undefined> {
    const [entry] = await db
      .select({
        id: clientVault.id,
        clientId: clientVault.clientId,
        dataType: clientVault.dataType,
        label: clientVault.label,
        encryptedData: clientVault.encryptedData,
        notes: clientVault.notes,
        isActive: clientVault.isActive,
        lastAccessedAt: clientVault.lastAccessedAt,
        lastAccessedBy: clientVault.lastAccessedBy,
        createdAt: clientVault.createdAt,
        updatedAt: clientVault.updatedAt,
        createdBy: clientVault.createdBy,
        client: {
          id: clients.id,
          name: clients.name,
        },
        createdByUser: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(clientVault)
      .leftJoin(clients, eq(clientVault.clientId, clients.id))
      .leftJoin(users, eq(clientVault.createdBy, users.id))
      .where(eq(clientVault.id, id));

    return entry as any;
  }

  async createVaultEntry(entry: InsertClientVault): Promise<ClientVault> {
    const [newEntry] = await db.insert(clientVault).values(entry as any).returning();

    await this.createActivity({
      userId: entry.createdBy,
      type: "vault_created",
      description: `Created vault entry: ${entry.label}`,
      entityType: "vault",
      entityId: newEntry.id,
    });

    return newEntry;
  }

  async updateVaultEntry(id: number, updates: Partial<InsertClientVault>): Promise<ClientVault> {
    const [updatedEntry] = await db
      .update(clientVault)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(clientVault.id, id))
      .returning();

    if (updates.encryptedData || updates.label) {
      await this.createActivity({
        userId: updates.createdBy || "system",
        type: "vault_updated",
        description: `Updated vault entry: ${updatedEntry.label}`,
        entityType: "vault",
        entityId: id,
      });
    }

    return updatedEntry;
  }

  async deleteVaultEntry(id: number): Promise<void> {
    await db
      .update(clientVault)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(clientVault.id, id));
  }

  async recordVaultAccess(id: number, userId: string): Promise<void> {
    await db
      .update(clientVault)
      .set({
        lastAccessedAt: new Date(),
        lastAccessedBy: userId,
      })
      .where(eq(clientVault.id, id));
  }
}

export const storage = new DatabaseStorage();