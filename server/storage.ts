import {
  users,
  clients,
  debtors,
  loads,
  invoices,
  documents,
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
  clientMessages,
  payoutSettings,
  payouts,
  creditChecks,
  achSettings,
  lockboxEntries,
  cashApplications,
  paymentApplicationLines,
  exceptions,
  tasks,
  brokerAuthorityChecks,
  carrierAuthorityChecks,
  brokerAuthorityAlerts,
  complianceIntegrationRuns,
  type BrokerAuthorityCheck,
  type CarrierAuthorityCheck,
  type InsertBrokerAuthorityCheck,
  type BrokerAuthorityAlert,
  type InsertBrokerAuthorityAlert,
  type ComplianceIntegrationRun,
  type InsertComplianceIntegrationRun,
  type PayoutSettings,
  type InsertPayoutSettings,
  type Payout,
  type InsertPayout,
  type ClientMessage,
  type InsertClientMessage,
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
  type InvoiceStatusHistory,
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
  type CreditCheck,
  type InsertCreditCheck,
  type AchSettings,
  type InsertAchSettings,
  type LockboxEntry,
  type InsertLockboxEntry,
  type CashApplication,
  type InsertCashApplication,
  type PaymentApplicationLine,
  type InsertPaymentApplicationLine,
  type Exception,
  type InsertException,
  documentRules,
  invoiceDocReviews,
  type DocumentRule,
  type InsertDocumentRule,
  type InvoiceDocReview,
  type InsertInvoiceDocReview,
  userPermissions,
  ALL_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  type PermissionKey,
} from "@shared/schema";
import { db } from "./db";
import { recalculateBrokerCreditSafe } from "./services/brokerCreditEngine";

async function triggerBrokerCreditForInvoices(invoiceIds: number[]): Promise<void> {
  try {
    if (!invoiceIds.length) return;
    const rows = await db.select({ brokerId: invoices.brokerId }).from(invoices)
      .where(inArray(invoices.id, invoiceIds));
    new Set(rows.map(row => row.brokerId).filter((id): id is number => id != null)).forEach((brokerId) => {
      recalculateBrokerCreditSafe(brokerId);
    });
  } catch (error) {
    console.warn("[brokerCredit] trigger lookup failed:", error instanceof Error ? error.message : error);
  }
}
import { eq, desc, like, or, and, count, sql, inArray, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

type AuthorityCheckSnapshot = Omit<BrokerAuthorityCheck, "entityType"> & {
  entityType: "broker" | "debtor" | "carrier";
};

function carrierAuthoritySnapshot(
  row: CarrierAuthorityCheck,
  entityName: string | null,
): AuthorityCheckSnapshot {
  return {
    ...row,
    entityType: "carrier",
    entityId: row.carrierId,
    entityName,
    legalName: null,
    dbaName: null,
    commonAuthorityStatus: null,
    contractAuthorityStatus: null,
    brokerAuthorityStatus: null,
    allowedToOperate: null,
    carrierOperation: null,
    bipdRequired: null,
    bipdInsuranceOnFile: null,
    cargoInsuranceRequired: null,
    cargoInsuranceOnFile: null,
    brokerBondStatus: null,
    bondAmount: null,
    changeSummary: null,
    errorMessage: row.checkError,
    brokerId: null,
    debtorId: null,
  } as AuthorityCheckSnapshot;
}

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserProfile(id: string, updates: Partial<User>): Promise<User>;
  getAllUsers(): Promise<User[]>;
  getUserByEmailAndType(email: string, authType: string): Promise<User[]>;
  createAgent(data: { id: string; firstName: string; lastName: string; email: string; role: string; password: string; createdBy: string }): Promise<User>;
  deleteUser(id: string): Promise<void>;
  getUserPermissions(userId: string): Promise<string[]>;
  setUserPermissions(userId: string, granted: string[], updatedBy: string): Promise<void>;
  seedDefaultPermissions(userId: string, role: string, updatedBy: string): Promise<void>;

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
  getHeldInvoices(): Promise<Invoice[]>;
  holdInvoice(id: number, reason: string, heldBy: string, notes?: string): Promise<Invoice>;
  releaseInvoice(id: number, releasedBy: string, releaseNote?: string): Promise<Invoice>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  getNextInvoiceNumber(): Promise<string>;
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
  clearActivities(): Promise<void>;

  // Invoice history / event ledger
  getInvoiceStatusHistory(invoiceId: number): Promise<InvoiceStatusHistory[]>;
  getEvents(entityType?: string, entityId?: number): Promise<EventLedger[]>;
  createEvent(entry: InsertEventLedger): Promise<EventLedger>;

  // Support message operations
  getSupportMessages(): Promise<SupportMessage[]>;
  getSupportMessage(id: number): Promise<SupportMessage | undefined>;
  createSupportMessage(message: InsertSupportMessage): Promise<SupportMessage>;
  deleteSupportMessage(id: number): Promise<void>;

  // Client message operations (outbound to clients/carriers)
  createClientMessage(message: InsertClientMessage): Promise<ClientMessage>;
  getClientMessages(clientId?: number): Promise<ClientMessage[]>;

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

  // Payout Settings
  getPayoutSettings(): Promise<PayoutSettings | undefined>;
  upsertPayoutSettings(data: Partial<InsertPayoutSettings>): Promise<PayoutSettings>;

  // Payouts
  getPayouts(): Promise<Payout[]>;
  getPayoutByInvoice(invoiceId: number): Promise<Payout | undefined>;
  createPayout(data: InsertPayout): Promise<Payout>;
  updatePayout(id: number, updates: Partial<InsertPayout>): Promise<Payout>;

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

  // Credit Checks
  getCreditChecks(): Promise<CreditCheck[]>;
  getCreditCheck(id: number): Promise<CreditCheck | undefined>;
  createCreditCheck(data: InsertCreditCheck): Promise<CreditCheck>;
  updateCreditCheck(id: number, updates: Partial<InsertCreditCheck>): Promise<CreditCheck>;
  deleteCreditCheck(id: number): Promise<void>;

  // ACH Settings
  getAchSettings(clientId: number): Promise<AchSettings | undefined>;
  upsertAchSettings(clientId: number, data: Partial<InsertAchSettings>): Promise<AchSettings>;

  // Lockbox
  getLockboxEntries(filters?: { status?: string; dateFrom?: string; dateTo?: string }): Promise<LockboxEntry[]>;
  getLockboxEntry(id: number): Promise<LockboxEntry | undefined>;
  createLockboxEntry(data: InsertLockboxEntry): Promise<LockboxEntry>;
  updateLockboxEntry(id: number, updates: Partial<InsertLockboxEntry>): Promise<LockboxEntry>;
  deleteLockboxEntry(id: number): Promise<void>;
  matchLockboxEntry(entryId: number, matches: Array<{ invoiceId: number; invoiceNumber: string; invoiceAmount: number; appliedAmount: number; varianceType: string; varianceReason?: string }>, userId: string, paymentMethod: string): Promise<{ cashApplication: CashApplication; lines: PaymentApplicationLine[] }>;

  // Cash Applications
  getCashApplications(): Promise<CashApplication[]>;
  getCashApplication(id: number): Promise<CashApplication | undefined>;
  createCashApplication(data: InsertCashApplication): Promise<CashApplication>;
  updateCashApplication(id: number, updates: Partial<InsertCashApplication>): Promise<CashApplication>;
  applyPaymentToInvoices(cashApplicationId: number, lines: InsertPaymentApplicationLine[]): Promise<PaymentApplicationLine[]>;
  getPaymentApplicationLines(cashApplicationId: number): Promise<PaymentApplicationLine[]>;

  // Exceptions
  getExceptions(): Promise<Exception[]>;
  getException(id: number): Promise<Exception | undefined>;
  createException(data: InsertException): Promise<Exception>;
  updateException(id: number, updates: Partial<InsertException>): Promise<Exception>;

  // Audit
  getEventLedger(entityType?: string, limit?: number): Promise<EventLedger[]>;
  getInvoiceStatusHistoryAll(): Promise<InvoiceStatusHistory[]>;

  // Document Rules (configurable approval checklist)
  getDocumentRules(): Promise<DocumentRule[]>;
  getDocumentRule(id: number): Promise<DocumentRule | undefined>;
  createDocumentRule(data: InsertDocumentRule): Promise<DocumentRule>;
  updateDocumentRule(id: number, updates: Partial<InsertDocumentRule>): Promise<DocumentRule>;
  deleteDocumentRule(id: number): Promise<void>;

  // Invoice Document Reviews (reviewer notes)
  getDocReviews(invoiceId: number): Promise<InvoiceDocReview[]>;
  createDocReview(data: InsertInvoiceDocReview): Promise<InvoiceDocReview>;
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

  async createAgent(data: { id: string; firstName: string; lastName: string; email: string; role: string; password: string; createdBy: string }): Promise<User> {
    const [row] = await db.insert(users).values({
      id: data.id,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      password: data.password,
      role: data.role as "employee" | "manager" | "admin",
      authType: "local",
      status: "active",
      createdBy: data.createdBy,
      verified: true,
    }).returning();
    return row;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
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
      } as typeof clients.$inferInsert)
      .returning();

    return newClient;
  }

  async updateClient(id: number, client: Partial<InsertClient>): Promise<Client> {
    const [updatedClient] = await db
      .update(clients)
      .set({
        ...client,
        updatedAt: new Date(),
      } as Partial<typeof clients.$inferInsert>)
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

  async getHeldInvoices(): Promise<Invoice[]> {
    return await db
      .select()
      .from(invoices)
      .where(eq(invoices.status, "held" as any))
      .orderBy(desc(invoices.heldAt));
  }

  async holdInvoice(id: number, reason: string, heldBy: string, notes?: string): Promise<Invoice> {
    const existing = await this.getInvoice(id);
    if (!existing) throw new Error(`Invoice ${id} not found`);
    if (existing.status === "held") throw new Error(`Invoice ${id} is already on hold`);
    return db.transaction(async tx => {
      const [updated] = await tx
        .update(invoices)
        .set({
          previousStatus: existing.status,
          status: "held" as any,
          heldReason: reason,
          heldAt: new Date(),
          heldBy,
          heldNotes: notes ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(invoices.id, id), eq(invoices.status, existing.status)))
        .returning();
      if (!updated) throw new Error("Invoice status changed before it could be placed on hold");
      await tx.insert(eventLedger).values({
        entityType: "invoice",
        entityId: id,
        eventType: "invoice_status_changed",
        actorType: "user",
        actorId: heldBy,
        payloadJson: {
          from: existing.status,
          to: "held",
          reason,
          label: "Invoice placed on hold",
        },
      });
      return updated;
    });
  }

  async releaseInvoice(id: number, releasedBy: string, releaseNote?: string): Promise<Invoice> {
    const existing = await this.getInvoice(id);
    if (!existing) throw new Error(`Invoice ${id} not found`);
    if (existing.status !== "held") throw new Error(`Invoice ${id} is not on hold`);
    const restoreStatus = (existing.previousStatus as any) ?? "submitted";
    return db.transaction(async tx => {
      const [updated] = await tx
        .update(invoices)
        .set({
          status: restoreStatus,
          heldReason: null,
          heldAt: null,
          heldBy: null,
          heldNotes: null,
          previousStatus: null,
          updatedAt: new Date(),
        })
        .where(and(eq(invoices.id, id), eq(invoices.status, "held")))
        .returning();
      if (!updated) throw new Error("Invoice is no longer on hold");
      await tx.insert(eventLedger).values({
        entityType: "invoice",
        entityId: id,
        eventType: "invoice_status_changed",
        actorType: "user",
        actorId: releasedBy,
        payloadJson: {
          from: "held",
          to: restoreStatus,
          reason: releaseNote || "Released from hold",
          label: "Invoice released from hold",
        },
      });
      return updated;
    });
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [newInvoice] = await db.insert(invoices).values(invoice).returning();

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
      await this.createEvent({
        entityType: "invoice",
        entityId: updatedInvoice.id,
        eventType: "invoice_status_changed",
        actorType: "user",
        actorId:
          updatedInvoice.approvedBy ||
          updatedInvoice.submittedBy ||
          updatedInvoice.assignedTo ||
          null,
        payloadJson: {
          from: existing.status,
          to: invoice.status,
          reason: null,
          label: invoice.status === "approved" ? "Invoice approved" : `Invoice status changed to ${invoice.status}`,
        },
      });
    }

    const { status: _status, updatedAt: _updatedAt, ...updatedFields } = invoice as any;
    if (Object.keys(updatedFields).length > 0) {
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
        payloadJson: updatedFields,
      });
    }

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
    if (entityType === "invoice") {
      return this.getDocumentsByInvoice(entityId);
    }
    if (entityType === "load") {
      return this.getDocumentsByLoad(entityId);
    }
    return [];
  }

  async createDocument(document: InsertDocument): Promise<Document> {
    const [newDocument] = await db.insert(documents).values(document as any).returning();

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
      .set(document as any)
      .where(eq(documents.id, id))
      .returning();

    return updatedDocument;
  }

  async deleteDocument(id: number): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  // Activity operations
  async getActivities(limit?: number): Promise<Activity[]> {
    const query = db.select().from(activities).orderBy(desc(activities.createdAt));
    return limit ? await query.limit(limit) : await query;
  }

  async createActivity(activity: InsertActivity): Promise<Activity> {
    try {
      const [newActivity] = await db.insert(activities).values(activity as any).returning();

      if (this.shouldCreateNotification(activity.type)) {
        await this.createNotificationFromActivity(activity, newActivity).catch((err: any) =>
          console.warn("createNotificationFromActivity non-fatal error:", err?.message)
        );
      }

      return newActivity;
    } catch (err: any) {
      // Activity logging is non-critical — log the error but never crash the calling request
      console.warn("createActivity non-fatal error (activity not saved):", err?.message ?? err);
      return {} as Activity;
    }
  }

  async getNextInvoiceNumber(): Promise<string> {
    const rows = await db
      .select({ n: invoices.invoiceNumber })
      .from(invoices)
      .orderBy(desc(invoices.id));

    let maxSeq = 0;
    for (const { n } of rows) {
      if (!n) continue;
      const match = n.replace(/\D/g, "");
      const num = parseInt(match, 10);
      if (!isNaN(num) && num > maxSeq) maxSeq = num;
    }
    return `INV${String(maxSeq + 1).padStart(3, "0")}`;
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

  async createClientMessage(message: InsertClientMessage): Promise<ClientMessage> {
    const [row] = await db.insert(clientMessages).values(message).returning();
    return row;
  }

  async getClientMessages(clientId?: number): Promise<ClientMessage[]> {
    if (clientId) {
      return await db
        .select()
        .from(clientMessages)
        .where(eq(clientMessages.clientId, clientId))
        .orderBy(desc(clientMessages.sentAt));
    }
    return await db.select().from(clientMessages).orderBy(desc(clientMessages.sentAt));
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

  // Payout Settings
  async getPayoutSettings(): Promise<PayoutSettings | undefined> {
    const [row] = await db.select().from(payoutSettings).orderBy(desc(payoutSettings.id)).limit(1);
    return row;
  }

  async upsertPayoutSettings(data: Partial<InsertPayoutSettings>): Promise<PayoutSettings> {
    const existing = await this.getPayoutSettings();
    if (existing) {
      const [updated] = await db
        .update(payoutSettings)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(payoutSettings.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(payoutSettings).values({
      advanceRate: data.advanceRate ?? "80.00",
      feeRate: data.feeRate ?? "3.00",
      updatedBy: data.updatedBy,
    }).returning();
    return created;
  }

  // Payouts
  async getPayouts(): Promise<Payout[]> {
    return await db.select().from(payouts).orderBy(desc(payouts.createdAt));
  }

  async getPayoutByInvoice(invoiceId: number): Promise<Payout | undefined> {
    const [row] = await db.select().from(payouts).where(eq(payouts.invoiceId, invoiceId));
    return row;
  }

  async createPayout(data: InsertPayout): Promise<Payout> {
    const [row] = await db.insert(payouts).values(data).returning();
    return row;
  }

  async updatePayout(id: number, updates: Partial<InsertPayout>): Promise<Payout> {
    const [row] = await db
      .update(payouts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(payouts.id, id))
      .returning();
    return row;
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

    if (entry.createdBy) {
      await this.createActivity({
        userId: entry.createdBy,
        type: "vault_created",
        description: `Created vault entry: ${entry.label}`,
        entityType: "vault",
        entityId: newEntry.id,
      });
    }

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

  // ── Credit Checks ────────────────────────────────────────────────────────────
  async getCreditChecks(): Promise<CreditCheck[]> {
    return db.select().from(creditChecks).orderBy(desc(creditChecks.createdAt));
  }

  async getCreditCheck(id: number): Promise<CreditCheck | undefined> {
    const [row] = await db.select().from(creditChecks).where(eq(creditChecks.id, id));
    return row;
  }

  async createCreditCheck(data: InsertCreditCheck): Promise<CreditCheck> {
    const [row] = await db.insert(creditChecks).values(data).returning();
    return row;
  }

  async updateCreditCheck(id: number, updates: Partial<InsertCreditCheck>): Promise<CreditCheck> {
    const [row] = await db.update(creditChecks).set({ ...updates, updatedAt: new Date() }).where(eq(creditChecks.id, id)).returning();
    return row;
  }

  async deleteCreditCheck(id: number): Promise<void> {
    await db.delete(creditChecks).where(eq(creditChecks.id, id));
  }

  // ── ACH Settings ─────────────────────────────────────────────────────────────
  async getAchSettings(clientId: number): Promise<AchSettings | undefined> {
    const [row] = await db.select().from(achSettings).where(eq(achSettings.clientId, clientId));
    return row;
  }

  async upsertAchSettings(clientId: number, data: Partial<InsertAchSettings>): Promise<AchSettings> {
    const existing = await this.getAchSettings(clientId);
    if (existing) {
      const [row] = await db.update(achSettings).set({ ...data, updatedAt: new Date() }).where(eq(achSettings.clientId, clientId)).returning();
      return row;
    }
    const [row] = await db.insert(achSettings).values({ clientId, ...data } as InsertAchSettings).returning();
    return row;
  }

  // ── Cash Applications ────────────────────────────────────────────────────────
  async getCashApplications(): Promise<CashApplication[]> {
    return db.select().from(cashApplications).orderBy(desc(cashApplications.createdAt));
  }

  async getCashApplication(id: number): Promise<CashApplication | undefined> {
    const [row] = await db.select().from(cashApplications).where(eq(cashApplications.id, id));
    return row;
  }

  async createCashApplication(data: InsertCashApplication): Promise<CashApplication> {
    const [row] = await db.insert(cashApplications).values(data).returning();
    return row;
  }

  async updateCashApplication(id: number, updates: Partial<InsertCashApplication>): Promise<CashApplication> {
    const [row] = await db.update(cashApplications).set({ ...updates, updatedAt: new Date() }).where(eq(cashApplications.id, id)).returning();
    return row;
  }

  async applyPaymentToInvoices(cashApplicationId: number, lines: InsertPaymentApplicationLine[]): Promise<PaymentApplicationLine[]> {
    const inserted = await db.insert(paymentApplicationLines).values(lines).returning();
    // Recalculate application status
    const totalReceived = (await db.select().from(cashApplications).where(eq(cashApplications.id, cashApplicationId)))[0]?.totalReceived;
    const totalApplied = lines.reduce((s, l) => s + parseFloat(String(l.appliedAmount) || "0"), 0);
    const received = parseFloat(String(totalReceived) || "0");
    let status: CashApplication["status"] = "fully_applied";
    if (totalApplied < received - 0.01) status = "partially_applied";
    else if (totalApplied > received + 0.01) status = "overpaid";
    await db.update(cashApplications).set({ status, updatedAt: new Date() }).where(eq(cashApplications.id, cashApplicationId));
    // Auto-create exceptions for short-pays / overpays
    for (const l of lines) {
      if (l.varianceType === "short_pay" || l.varianceType === "overpay") {
        await db.insert(exceptions).values({
          type: l.varianceType,
          severity: "medium",
          entityType: "payment",
          entityId: cashApplicationId,
          entityRef: l.invoiceNumber,
          title: `${l.varianceType === "short_pay" ? "Short Pay" : "Overpay"} on Invoice ${l.invoiceNumber}`,
          description: l.varianceReason ?? `Variance of $${Math.abs(parseFloat(String(l.variance) || "0")).toFixed(2)}`,
          status: "open",
        });
      }
    }
    await triggerBrokerCreditForInvoices(lines.map(line => line.invoiceId));
    return inserted;
  }

  async getPaymentApplicationLines(cashApplicationId: number): Promise<PaymentApplicationLine[]> {
    return db.select().from(paymentApplicationLines).where(eq(paymentApplicationLines.cashApplicationId, cashApplicationId));
  }

  // ── Lockbox ───────────────────────────────────────────────────────────────────
  async getLockboxEntries(filters?: { status?: string; dateFrom?: string; dateTo?: string }): Promise<LockboxEntry[]> {
    let query = db.select().from(lockboxEntries).orderBy(desc(lockboxEntries.receivedDate)) as any;
    const conditions: any[] = [];
    if (filters?.status && filters.status !== "all") {
      conditions.push(eq(lockboxEntries.status, filters.status as any));
    }
    if (filters?.dateFrom) {
      conditions.push(sql`${lockboxEntries.receivedDate} >= ${new Date(filters.dateFrom)}`);
    }
    if (filters?.dateTo) {
      conditions.push(sql`${lockboxEntries.receivedDate} <= ${new Date(filters.dateTo)}`);
    }
    if (conditions.length > 0) {
      query = query.where(conditions.length === 1 ? conditions[0] : and(...conditions));
    }
    return query;
  }

  async getLockboxEntry(id: number): Promise<LockboxEntry | undefined> {
    const [row] = await db.select().from(lockboxEntries).where(eq(lockboxEntries.id, id));
    return row;
  }

  async createLockboxEntry(data: InsertLockboxEntry): Promise<LockboxEntry> {
    const [row] = await db.insert(lockboxEntries).values(data).returning();
    return row;
  }

  async updateLockboxEntry(id: number, updates: Partial<InsertLockboxEntry>): Promise<LockboxEntry> {
    const [row] = await db.update(lockboxEntries).set(updates).where(eq(lockboxEntries.id, id)).returning();
    return row;
  }

  async deleteLockboxEntry(id: number): Promise<void> {
    await db.delete(lockboxEntries).where(eq(lockboxEntries.id, id));
  }

  async matchLockboxEntry(
    entryId: number,
    matches: Array<{ invoiceId: number; invoiceNumber: string; invoiceAmount: number; appliedAmount: number; varianceType: string; varianceReason?: string }>,
    userId: string,
    paymentMethod: string,
  ): Promise<{ cashApplication: CashApplication; lines: PaymentApplicationLine[] }> {
    const entry = await this.getLockboxEntry(entryId);
    if (!entry) throw new Error(`Lockbox entry ${entryId} not found`);

    const totalApplied = matches.reduce((s, m) => s + m.appliedAmount, 0);
    const received = parseFloat(String(entry.amount));

    const ref = `LBX-${entryId}-${Date.now()}`;
    const [ca] = await db.insert(cashApplications).values({
      lockboxEntryId: entryId,
      paymentReference: ref,
      payorName: entry.payorName,
      paymentDate: entry.receivedDate,
      totalReceived: entry.amount,
      paymentMethod: paymentMethod as any,
      status: "unapplied",
      processedBy: userId,
      notes: entry.notes ?? null,
    }).returning();

    const lineValues = matches.map(m => ({
      cashApplicationId: ca.id,
      invoiceId: m.invoiceId,
      invoiceNumber: m.invoiceNumber,
      invoiceAmount: String(m.invoiceAmount),
      appliedAmount: String(m.appliedAmount),
      variance: String(Math.round((m.invoiceAmount - m.appliedAmount) * 100) / 100),
      varianceType: m.varianceType as any,
      varianceReason: m.varianceReason ?? null,
    }));
    const lines = await db.insert(paymentApplicationLines).values(lineValues).returning();

    let caStatus: CashApplication["status"] = "fully_applied";
    if (totalApplied < received - 0.01) caStatus = "partially_applied";
    else if (totalApplied > received + 0.01) caStatus = "overpaid";
    await db.update(cashApplications).set({ status: caStatus, updatedAt: new Date() }).where(eq(cashApplications.id, ca.id));

    const entryStatus: LockboxEntry["status"] = totalApplied >= received - 0.01 ? "matched" : "partial";
    await db.update(lockboxEntries).set({ status: entryStatus }).where(eq(lockboxEntries.id, entryId));

    await triggerBrokerCreditForInvoices(lines.map(line => line.invoiceId));
    return { cashApplication: { ...ca, status: caStatus }, lines };
  }

  // ── Exceptions ────────────────────────────────────────────────────────────────
  async getExceptions(): Promise<Exception[]> {
    return db.select().from(exceptions).orderBy(desc(exceptions.createdAt));
  }

  async getException(id: number): Promise<Exception | undefined> {
    const [row] = await db.select().from(exceptions).where(eq(exceptions.id, id));
    return row;
  }

  async createException(data: InsertException): Promise<Exception> {
    const [row] = await db.insert(exceptions).values(data).returning();
    return row;
  }

  async updateException(id: number, updates: Partial<InsertException> & { resolvedAt?: Date | null }): Promise<Exception> {
    const patch: Record<string, unknown> = { ...updates, updatedAt: new Date() };
    if (updates.status === "resolved" && !updates.resolvedAt) patch.resolvedAt = new Date();
    const [row] = await db.update(exceptions).set(patch).where(eq(exceptions.id, id)).returning();
    if (row?.entityType === "broker" && row.entityId != null) {
      recalculateBrokerCreditSafe(row.entityId);
    } else if (row?.entityType === "invoice" && row.entityId != null) {
      await triggerBrokerCreditForInvoices([row.entityId]);
    } else if (row?.entityType === "payment" && row.entityId != null) {
      const affectedLines = await db.select({ invoiceId: paymentApplicationLines.invoiceId })
        .from(paymentApplicationLines)
        .where(eq(paymentApplicationLines.cashApplicationId, row.entityId));
      await triggerBrokerCreditForInvoices(affectedLines.map(line => line.invoiceId));
    }
    return row;
  }

  // ── Audit ─────────────────────────────────────────────────────────────────────
  async getEventLedger(entityType?: string, limit = 500): Promise<EventLedger[]> {
    const baseQuery = db
      .select({
        id: eventLedger.id,
        entityType: eventLedger.entityType,
        entityId: eventLedger.entityId,
        eventType: eventLedger.eventType,
        actorType: eventLedger.actorType,
        actorId: eventLedger.actorId,
        payloadJson: eventLedger.payloadJson,
        createdAt: eventLedger.createdAt,
        actorName: sql<string | null>`CASE WHEN ${eventLedger.actorType} = 'user' THEN (SELECT concat(first_name, ' ', last_name) FROM users WHERE id = ${eventLedger.actorId}) ELSE NULL END`,
      })
      .from(eventLedger)
      .orderBy(desc(eventLedger.createdAt))
      .limit(limit);

    if (entityType && entityType !== "all") {
      return (baseQuery.where(eq(eventLedger.entityType, entityType as any))) as any;
    }
    return baseQuery as any;
  }

  async getInvoiceStatusHistoryAll(): Promise<InvoiceStatusHistory[]> {
    return db
      .select({
        id: invoiceStatusHistory.id,
        invoiceId: invoiceStatusHistory.invoiceId,
        oldStatus: invoiceStatusHistory.oldStatus,
        newStatus: invoiceStatusHistory.newStatus,
        changedBy: invoiceStatusHistory.changedBy,
        reason: invoiceStatusHistory.reason,
        createdAt: invoiceStatusHistory.createdAt,
        changedByName: sql<string | null>`(SELECT concat(first_name, ' ', last_name) FROM users WHERE id = ${invoiceStatusHistory.changedBy})`,
      })
      .from(invoiceStatusHistory)
      .orderBy(desc(invoiceStatusHistory.createdAt))
      .limit(500) as any;
  }

  // ── FMCSA Authority Checks ────────────────────────────────────────────────────
  async getLatestAuthorityChecks(): Promise<AuthorityCheckSnapshot[]> {
    // Return the most recent check per entity (entityType + entityId)
    const [rows, carrierRows] = await Promise.all([
      db
        .select()
        .from(brokerAuthorityChecks)
        .orderBy(desc(brokerAuthorityChecks.checkedAt)),
      db
        .select({ check: carrierAuthorityChecks, entityName: clients.name })
        .from(carrierAuthorityChecks)
        .leftJoin(clients, eq(carrierAuthorityChecks.carrierId, clients.id))
        .orderBy(desc(carrierAuthorityChecks.checkedAt)),
    ]);

    const snapshots: AuthorityCheckSnapshot[] = [
      ...rows,
      ...carrierRows.map(({ check, entityName }) => carrierAuthoritySnapshot(check, entityName)),
    ];
    snapshots.sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime());
    const seen = new Map<string, AuthorityCheckSnapshot>();
    for (const row of snapshots) {
      const key = `${row.entityType}-${row.entityId}`;
      if (!seen.has(key)) seen.set(key, row);
    }
    return Array.from(seen.values());
  }

  async getAuthorityCheckHistory(entityType: string, entityId: number): Promise<AuthorityCheckSnapshot[]> {
    if (entityType === "carrier") {
      const rows = await db
        .select({ check: carrierAuthorityChecks, entityName: clients.name })
        .from(carrierAuthorityChecks)
        .leftJoin(clients, eq(carrierAuthorityChecks.carrierId, clients.id))
        .where(eq(carrierAuthorityChecks.carrierId, entityId))
        .orderBy(desc(carrierAuthorityChecks.checkedAt))
        .limit(50);
      return rows.map(({ check, entityName }) => carrierAuthoritySnapshot(check, entityName));
    }
    return db
      .select()
      .from(brokerAuthorityChecks)
      .where(
        and(
          eq(brokerAuthorityChecks.entityType, entityType as "broker" | "debtor"),
          eq(brokerAuthorityChecks.entityId, entityId)
        )
      )
      .orderBy(desc(brokerAuthorityChecks.checkedAt))
      .limit(50);
  }

  async createAuthorityCheck(data: InsertBrokerAuthorityCheck): Promise<BrokerAuthorityCheck> {
    const [row] = await db.insert(brokerAuthorityChecks).values(data).returning();
    return row;
  }

  async getAuthorityAlerts(includeResolved = false): Promise<BrokerAuthorityAlert[]> {
    const rows = await db
      .select()
      .from(brokerAuthorityAlerts)
      .orderBy(desc(brokerAuthorityAlerts.createdAt));
    if (includeResolved) return rows;
    return rows; // return all; UI filters
  }

  async resolveAuthorityAlert(id: number, resolvedBy: string, notes?: string): Promise<BrokerAuthorityAlert> {
    const [row] = await db
      .update(brokerAuthorityAlerts)
      .set({ resolvedAt: new Date(), resolvedBy, notes: notes ?? null })
      .where(eq(brokerAuthorityAlerts.id, id))
      .returning();
    return row;
  }

  // ── Compliance Integration Runs ────────────────────────────────────────────────
  async getIntegrationRuns(limit = 50): Promise<ComplianceIntegrationRun[]> {
    return db
      .select()
      .from(complianceIntegrationRuns)
      .orderBy(desc(complianceIntegrationRuns.startedAt))
      .limit(limit);
  }

  async getIntegrationRun(id: number): Promise<ComplianceIntegrationRun | undefined> {
    const [row] = await db
      .select()
      .from(complianceIntegrationRuns)
      .where(eq(complianceIntegrationRuns.id, id));
    return row;
  }

  // ── Document Rules ──────────────────────────────────────────────────────────
  async getDocumentRules(): Promise<DocumentRule[]> {
    return db.select().from(documentRules).orderBy(documentRules.sortOrder);
  }

  async getDocumentRule(id: number): Promise<DocumentRule | undefined> {
    const [row] = await db.select().from(documentRules).where(eq(documentRules.id, id));
    return row;
  }

  async createDocumentRule(data: InsertDocumentRule): Promise<DocumentRule> {
    const [row] = await db.insert(documentRules).values(data).returning();
    return row;
  }

  async updateDocumentRule(id: number, updates: Partial<InsertDocumentRule>): Promise<DocumentRule> {
    const [row] = await db.update(documentRules)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(documentRules.id, id))
      .returning();
    return row;
  }

  async deleteDocumentRule(id: number): Promise<void> {
    await db.delete(documentRules).where(eq(documentRules.id, id));
  }

  // ── Invoice Document Reviews ────────────────────────────────────────────────
  async getDocReviews(invoiceId: number): Promise<InvoiceDocReview[]> {
    return db.select().from(invoiceDocReviews)
      .where(eq(invoiceDocReviews.invoiceId, invoiceId))
      .orderBy(desc(invoiceDocReviews.createdAt));
  }

  async createDocReview(data: InsertInvoiceDocReview): Promise<InvoiceDocReview> {
    const [row] = await db.insert(invoiceDocReviews).values(data).returning();
    return row;
  }

  // ─── User Permissions ──────────────────────────────────────────────────────
  async getUserPermissions(userId: string): Promise<string[]> {
    const rows = await db
      .select({ permission: userPermissions.permission, granted: userPermissions.granted })
      .from(userPermissions)
      .where(eq(userPermissions.userId, userId));
    const granted = rows.filter((row) => row.granted).map((row) => row.permission);
    return rows.length > 0 && granted.length === 0 ? ["__none__"] : granted;
  }

  async setUserPermissions(userId: string, granted: string[], updatedBy: string): Promise<void> {
    await db.delete(userPermissions).where(eq(userPermissions.userId, userId));
    if (granted.length === 0) {
      await db.insert(userPermissions).values({
        userId,
        permission: "__none__",
        granted: false,
        updatedBy,
      });
      return;
    }
    await db.insert(userPermissions).values(
      granted.map((p) => ({ userId, permission: p, granted: true, updatedBy })),
    );
  }

  async seedDefaultPermissions(userId: string, role: string, updatedBy: string): Promise<void> {
    const existing = await db
      .select({ id: userPermissions.id })
      .from(userPermissions)
      .where(eq(userPermissions.userId, userId))
      .limit(1);
    if (existing.length > 0) return; // already seeded
    const defaults = ROLE_DEFAULT_PERMISSIONS[role] ?? ROLE_DEFAULT_PERMISSIONS.employee;
    await this.setUserPermissions(userId, defaults as string[], updatedBy);
  }
}

export const storage = new DatabaseStorage();