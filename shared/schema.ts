import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  serial,
  decimal,
  boolean,
  integer,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Session storage table (required for Replit Auth)
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table (supports both Replit Auth and local auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().notNull(),
  email: varchar("email").unique(),
  password: varchar("password"), // For local authentication
  authType: varchar("auth_type", { enum: ["replit", "local"] }).default("replit"),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  phone: varchar("phone"),
  jobTitle: varchar("job_title"),
  department: varchar("department"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role", { enum: ["employee", "manager", "admin"] }).default("employee").notNull(),
  // Personal settings
  bio: text("bio"),
  location: varchar("location"),
  timezone: varchar("timezone").default("America/New_York"),
  language: varchar("language").default("en"),
  // Notification preferences
  emailNotifications: boolean("email_notifications").default(true),
  smsNotifications: boolean("sms_notifications").default(false),
  desktopNotifications: boolean("desktop_notifications").default(true),
  // Work preferences
  startTime: varchar("start_time").default("09:00"),
  endTime: varchar("end_time").default("17:00"),
  workDays: varchar("work_days").default("monday,tuesday,wednesday,thursday,friday"),
  // Theme preferences
  theme: varchar("theme", { enum: ["light", "dark", "system"] }).default("system"),
  dateFormat: varchar("date_format").default("MM/dd/yyyy"),
  timeFormat: varchar("time_format", { enum: ["12h", "24h"] }).default("12h"),
  // Verification status
  verified: boolean("verified").default(false),
  // Account status
  status: varchar("status", { enum: ["active", "suspended", "inactive"] }).default("active").notNull(),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// New addition to users table for role-based permissions
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: varchar("name", {
    enum: [
      "admin",
      "operations_manager",
      "funding_specialist",
      "underwriter",
      "account_manager",
      "client_user",
    ],
  }).notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const permissions = pgTable("permissions", {
  id: serial("id").primaryKey(),
  key: varchar("key").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    roleId: integer("role_id").references(() => roles.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.roleId] }),
  })
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: integer("role_id").references(() => roles.id, { onDelete: "cascade" }).notNull(),
    permissionId: integer("permission_id").references(() => permissions.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roleId, table.permissionId] }),
  })
);

// Clients table
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull(),
  email: varchar("email"),
  phone: varchar("phone"),
  address: text("address"),
  contactPerson: varchar("contact_person"),
  taxId: varchar("tax_id"),
  // Carrier / factoring fields
  mcNumber: varchar("mc_number"),
  ratePercent: decimal("rate_percent", { precision: 6, scale: 2 }),
  language: varchar("language"),
  reviewed: timestamp("reviewed"),
  nextReview: timestamp("next_review"),
  reserves: decimal("reserves", { precision: 12, scale: 2 }).default("0"),
  shorts: decimal("shorts", { precision: 12, scale: 2 }).default("0"),
  status: varchar("status", { enum: ["active", "inactive"] }).default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// New addition for debtors table
export const debtors = pgTable("debtors", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull(),
  email: varchar("email"),
  phone: varchar("phone"),
  address: text("address"),
  contactPerson: varchar("contact_person"),
  taxId: varchar("tax_id"),
  mcNumber: varchar("mc_number"),
  dotNumber: varchar("dot_number"),
  creditLimit: decimal("credit_limit", { precision: 12, scale: 2 }).default("0"),
  averageDaysToPay: integer("average_days_to_pay"),
  status: varchar("status", { enum: ["active", "inactive", "on_hold"] })
    .default("active")
    .notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const debtorContacts = pgTable("debtor_contacts", {
  id: serial("id").primaryKey(),
  debtorId: integer("debtor_id")
    .references(() => debtors.id, { onDelete: "cascade" })
    .notNull(),
  fullName: varchar("full_name").notNull(),
  title: varchar("title"),
  email: varchar("email"),
  phone: varchar("phone"),
  isPrimary: boolean("is_primary").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Loads table
export const loads = pgTable("loads", {
  id: integer("id").primaryKey(),
  loadNumber: varchar("load_number").unique().notNull(),
  clientId: integer("client_id").references(() => clients.id).notNull(),
  pickupLocation: text("pickup_location"),
  deliveryLocation: text("delivery_location"),
  pickupDate: timestamp("pickup_date"),
  deliveryDate: timestamp("delivery_date"),
  rate: decimal("rate", { precision: 10, scale: 2 }),
  status: varchar("status", {
    enum: ["pending", "in_transit", "delivered", "invoiced", "paid"]
  }).default("pending").notNull(),
  driverName: varchar("driver_name"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Invoices table
export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: varchar("invoice_number").unique().notNull(),
  loadId: integer("load_id").references(() => loads.id),
  clientId: integer("client_id").references(() => clients.id).notNull(),
  debtorId: integer("debtor_id").references(() => debtors.id),
  loadNumber: varchar("load_number"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency").default("USD").notNull(),
  invoiceDate: timestamp("invoice_date"),
  dueDate: timestamp("due_date"),
  pickupLocation: text("pickup_location"),
  deliveryLocation: text("delivery_location"),
  loadType: varchar("load_type", {
    enum: ["otr_load", "dump_truck_ticket", "other"],
  }),
  bolNumber: varchar("bol_number"),
  status: varchar("status", {
    enum: [
      "draft",
      "submitted",
      "docs_pending",
      "under_review",
      "approved",
      "rejected",
      "funded",
      "settled",
      "paid",
    ],
  })
    .default("draft")
    .notNull(),
  submittedBy: varchar("submitted_by").references(() => users.id),
  submittedAt: timestamp("submitted_at"),
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  assignedTo: varchar("assigned_to").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Documents table
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  companyId: varchar("company_id"),
  filename: varchar("filename").notNull(),
  originalName: varchar("original_name").notNull(),
  mimeType: varchar("mime_type").notNull(),
  size: integer("size").notNull(),
  storageKey: varchar("storage_key"),
  documentType: varchar("document_type", {
    enum: [
      "invoice",
      "rate_confirmation",
      "bill_of_lading",
      "proof_of_delivery",
      "lumper_receipt",
      "receipt",
      "driver_id",
      "carrier_setup",
      "other",
    ],
  }).notNull(),
  loadId: integer("load_id").references(() => loads.id),
  invoiceId: integer("invoice_id").references(() => invoices.id),
  uploadedBy: varchar("uploaded_by").references(() => users.id).notNull(),
  sourceChannel: varchar("source_channel", {
    enum: ["portal", "manual", "email", "api"],
  }).default("manual"),
  status: varchar("status", {
    enum: ["processing", "processed", "failed"],
  }).default("processing").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export const documentLinks = pgTable("document_links", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id")
    .references(() => documents.id, { onDelete: "cascade" })
    .notNull(),
  entityType: varchar("entity_type", {
    enum: ["client", "debtor", "invoice", "load"],
  }).notNull(),
  entityId: integer("entity_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// New addition for document processing status
export const invoiceStatusHistory = pgTable("invoice_status_history", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .references(() => invoices.id, { onDelete: "cascade" })
    .notNull(),
  oldStatus: varchar("old_status"),
  newStatus: varchar("new_status").notNull(),
  changedBy: varchar("changed_by").references(() => users.id),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const eventLedger = pgTable("event_ledger", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", {
    enum: ["client", "debtor", "invoice", "load", "document", "user"],
  }).notNull(),
  entityId: integer("entity_id").notNull(),
  eventType: varchar("event_type").notNull(),
  actorType: varchar("actor_type", {
    enum: ["user", "system", "client"],
  }).default("user"),
  actorId: varchar("actor_id"),
  payloadJson: jsonb("payload_json"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Activity log table
export const activities = pgTable("activities", {
  id: integer("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  type: varchar("type").notNull(),
  description: text("description").notNull(),
  entityType: varchar("entity_type"),
  entityId: integer("entity_id"),

  // 🔥 ADD THIS
  metadata: jsonb("metadata").$type<{
    documentId?: number;
    filePath?: string;
    downloadPath?: string;
    originalName?: string;
    mimeType?: string;
  }>(),

  createdAt: timestamp("created_at").defaultNow(),
});

// Support Messages table
export const supportMessages = pgTable("support_messages", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull(),
  email: varchar("email").notNull(),
  subject: varchar("subject").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Client messages (outbound emails to clients/carriers)
export const clientMessages = pgTable("client_messages", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id).notNull(),
  sentBy: varchar("sent_by").references(() => users.id).notNull(),
  subject: varchar("subject").notNull(),
  messageType: varchar("message_type", {
    enum: ["request_documents", "payment_notice", "general_inquiry", "follow_up"],
  }).notNull(),
  body: text("body").notNull(),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  status: varchar("status", { enum: ["sent", "failed"] }).default("sent").notNull(),
});

export const insertClientMessageSchema = createInsertSchema(clientMessages).omit({
  id: true,
  sentAt: true,
});
export type ClientMessage = typeof clientMessages.$inferSelect;
export type InsertClientMessage = z.infer<typeof insertClientMessageSchema>;

// Fuel card applications table
export const fuelCardApplications = pgTable("fuel_card_applications", {
  id: integer("id").primaryKey(),
  companyName: varchar("company_name").notNull(),
  contactName: varchar("contact_name").notNull(),
  email: varchar("email").notNull(),
  phone: varchar("phone").notNull(),
  fleetSize: varchar("fleet_size").notNull(),
  monthlyFuelSpend: varchar("monthly_fuel_spend").notNull(),
  cardType: varchar("card_type", { enum: ["base", "fleet", "premium"] }).notNull(),
  businessType: varchar("business_type").notNull(),
  yearsInBusiness: varchar("years_in_business").notNull(),
  status: varchar("status", { enum: ["pending", "approved", "rejected"] }).default("pending").notNull(),
  submittedBy: varchar("submitted_by").references(() => users.id).notNull(),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Time Tracking table
export const timeEntries = pgTable("time_entries", {
  id: integer("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  clockInTime: timestamp("clock_in_time").notNull(),
  clockOutTime: timestamp("clock_out_time"),
  totalHours: decimal("total_hours", { precision: 4, scale: 2 }),
  status: varchar("status", { enum: ["clocked_in", "clocked_out"] }).default("clocked_in").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Notifications table
export const notifications = pgTable("notifications", {
  id: integer("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  title: varchar("title").notNull(),
  message: text("message").notNull(),
  type: varchar("type", { enum: ["info", "success", "warning", "error"] }).default("info").notNull(),
  read: boolean("read").default(false).notNull(),
  entityType: varchar("entity_type"),
  entityId: integer("entity_id"),
  actionUrl: varchar("action_url"),
  metadata: text("metadata"), // JSON string: emailSubject, emailBody, recipientEmail
  createdAt: timestamp("created_at").defaultNow(),
});

// Document Requirements table (configurable checklist per workflow stage)
export const docRequirements = pgTable("doc_requirements", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  stage: varchar("stage", { enum: ["submission", "approval", "factoring", "payout"] }).notNull(),
  documentName: varchar("document_name").notNull(),
  required: boolean("required").default(true).notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type DocRequirement = typeof docRequirements.$inferSelect;
export type InsertDocRequirement = typeof docRequirements.$inferInsert;

// Collections table
export const collections = pgTable("collections", {
  id: integer("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  description: text("description").notNull(),
  status: varchar("status", { enum: ["pending", "in_progress", "paid", "written_off"] }).default("pending").notNull(),
  priority: varchar("priority", { enum: ["low", "medium", "high", "urgent"] }).default("medium").notNull(),
  dueDate: timestamp("due_date").notNull(),
  lastContactDate: timestamp("last_contact_date"),
  notes: text("notes"),
  assignedTo: varchar("assigned_to").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Client Vault - Secure storage for confidential information
export const clientVault = pgTable("client_vault", {
  id: integer("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id).notNull(),
  dataType: varchar("data_type", {
    enum: ["ssn", "bank_account", "password", "driver_license", "passport", "tax_documents", "insurance", "other"]
  }).notNull(),
  label: varchar("label").notNull(), // User-friendly label like "Primary Bank Account"
  encryptedData: text("encrypted_data").notNull(), // AES encrypted data
  notes: text("notes"), // Optional notes (non-encrypted)
  isActive: boolean("is_active").default(true).notNull(),
  lastAccessedAt: timestamp("last_accessed_at"),
  lastAccessedBy: varchar("last_accessed_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id).notNull(),
});

// Tasks table
export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: varchar("title").notNull(),
  description: text("description"),
  type: varchar("type", { enum: ["chargeback", "followup", "call", "task", "processing"] }).notNull(),
  priority: varchar("priority", { enum: ["low", "medium", "high", "urgent"] }).default("medium").notNull(),
  status: varchar("status", { enum: ["todo", "in_progress", "held", "completed"] }).default("todo").notNull(),
  dueDate: timestamp("due_date"),
  clientId: integer("client_id").references(() => clients.id),
  assignedTo: varchar("assigned_to").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Brokers table
export const brokers = pgTable("brokers", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull(),
  contactPerson: varchar("contact_person").notNull(),
  email: varchar("email").notNull(),
  phone: varchar("phone").notNull(),
  address: varchar("address"),
  city: varchar("city"),
  state: varchar("state"),
  zipCode: varchar("zip_code"),
  mcNumber: varchar("mc_number"),
  dotNumber: varchar("dot_number"),
  creditLimit: integer("credit_limit").default(0),
  paymentTerms: varchar("payment_terms", { enum: ["net15", "net30", "net45", "net60", "quickpay"] }).default("net30").notNull(),
  status: varchar("status", { enum: ["active", "inactive", "suspended"] }).default("active").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Fuel Advances table
export const fuelAdvances = pgTable("fuel_advances", {
  id: serial("id").primaryKey(),
  carrierName: varchar("carrier_name").notNull(),
  advanceAmount: decimal("advance_amount", { precision: 10, scale: 2 }).notNull(),
  advanceDate: timestamp("advance_date").notNull(),
  pickupState: varchar("pickup_state", { length: 2 }).notNull(), // State initials
  deliveryState: varchar("delivery_state", { length: 2 }).notNull(), // State initials
  processedBy: varchar("processed_by").references(() => users.id).notNull(), // Agent who processed
  loadId: integer("load_id").references(() => loads.id), // Optional reference to load
  notes: text("notes"),
  status: varchar("status", { enum: ["pending", "approved", "paid", "cancelled"] }).default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Follow-ups table
export const followUps = pgTable("follow_ups", {
  id: integer("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id).notNull(),
  title: varchar("title").notNull(),
  description: text("description"),
  priority: varchar("priority", { enum: ["low", "medium", "high"] }).default("medium").notNull(),
  status: varchar("status", { enum: ["pending", "in-progress", "completed"] }).default("pending").notNull(),
  dueDate: timestamp("due_date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  invoices: many(invoices),
  documents: many(documents),
  activities: many(activities),
  timeEntries: many(timeEntries),
  notifications: many(notifications),
}));

// New relations for role-based permissions 3/29/26
export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
  rolePermissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, { fields: [rolePermissions.permissionId], references: [permissions.id] }),
}));

export const debtorsRelations = relations(debtors, ({ many }) => ({
  contacts: many(debtorContacts),
  invoices: many(invoices),
}));

export const debtorContactsRelations = relations(debtorContacts, ({ one }) => ({
  debtor: one(debtors, { fields: [debtorContacts.debtorId], references: [debtors.id] }),
}));

export const clientsRelations = relations(clients, ({ many }) => ({
  loads: many(loads),
  invoices: many(invoices),
  followUps: many(followUps),
  collections: many(collections),
}));

export const loadsRelations = relations(loads, ({ one, many }) => ({
  client: one(clients, { fields: [loads.clientId], references: [clients.id] }),
  invoices: many(invoices),
  documents: many(documents),
}));
// Added new invoice relations 3/29/26
export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  load: one(loads, { fields: [invoices.loadId], references: [loads.id] }),
  client: one(clients, { fields: [invoices.clientId], references: [clients.id] }),
  debtor: one(debtors, { fields: [invoices.debtorId], references: [debtors.id] }),
  submittedByUser: one(users, { fields: [invoices.submittedBy], references: [users.id] }),
  approvedByUser: one(users, { fields: [invoices.approvedBy], references: [users.id] }),
  assignedToUser: one(users, { fields: [invoices.assignedTo], references: [users.id] }),
  documents: many(documents),
}));

// Added new document relations 3/29/26
export const documentLinksRelations = relations(documentLinks, ({ one }) => ({
  document: one(documents, { fields: [documentLinks.documentId], references: [documents.id] }),
}));

export const invoiceStatusHistoryRelations = relations(invoiceStatusHistory, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceStatusHistory.invoiceId], references: [invoices.id] }),
  changedByUser: one(users, { fields: [invoiceStatusHistory.changedBy], references: [users.id] }),
}));

export const documentsRelations = relations(documents, ({ one }) => ({
  load: one(loads, { fields: [documents.loadId], references: [loads.id] }),
  invoice: one(invoices, { fields: [documents.invoiceId], references: [invoices.id] }),
  uploadedByUser: one(users, { fields: [documents.uploadedBy], references: [users.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  user: one(users, { fields: [activities.userId], references: [users.id] }),
}));

export const fuelCardApplicationsRelations = relations(fuelCardApplications, ({ one }) => ({
  submittedByUser: one(users, { fields: [fuelCardApplications.submittedBy], references: [users.id] }),
  reviewedByUser: one(users, { fields: [fuelCardApplications.reviewedBy], references: [users.id] }),
}));

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  user: one(users, { fields: [timeEntries.userId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const followUpsRelations = relations(followUps, ({ one }) => ({
  client: one(clients, { fields: [followUps.clientId], references: [clients.id] }),
}));

export const collectionsRelations = relations(collections, ({ one }) => ({
  client: one(clients, { fields: [collections.clientId], references: [clients.id] }),
  assignedToUser: one(users, { fields: [collections.assignedTo], references: [users.id] }),
}));

export const clientVaultRelations = relations(clientVault, ({ one }) => ({
  client: one(clients, { fields: [clientVault.clientId], references: [clients.id] }),
  createdByUser: one(users, { fields: [clientVault.createdBy], references: [users.id] }),
  lastAccessedByUser: one(users, { fields: [clientVault.lastAccessedBy], references: [users.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  client: one(clients, { fields: [tasks.clientId], references: [clients.id] }),
  assignedToUser: one(users, { fields: [tasks.assignedTo], references: [users.id] }),
}));

export const brokersRelations = relations(brokers, ({ many }) => ({
  // Add relations to loads/invoices if needed in the future
}));

export const fuelAdvancesRelations = relations(fuelAdvances, ({ one }) => ({
  processedByUser: one(users, { fields: [fuelAdvances.processedBy], references: [users.id] }),
  load: one(loads, { fields: [fuelAdvances.loadId], references: [loads.id] }),
}));

// Insert schemas
export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLoadSchema = createInsertSchema(loads).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true, createdAt: true });
export const insertActivitySchema = createInsertSchema(activities).omit({ id: true, createdAt: true });
export const insertSupportMessageSchema = createInsertSchema(supportMessages).omit({
  id: true,
  createdAt: true,
});
// New insert schemas 3/29/26
export const insertRoleSchema = createInsertSchema(roles).omit({
  id: true,
  createdAt: true,
});

export const insertPermissionSchema = createInsertSchema(permissions).omit({
  id: true,
  createdAt: true,
});

export const insertDebtorSchema = createInsertSchema(debtors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDebtorContactSchema = createInsertSchema(debtorContacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDocumentLinkSchema = createInsertSchema(documentLinks).omit({
  id: true,
  createdAt: true,
});

export const insertInvoiceStatusHistorySchema = createInsertSchema(invoiceStatusHistory).omit({
  id: true,
  createdAt: true,
});

export const insertEventLedgerSchema = createInsertSchema(eventLedger).omit({
  id: true,
  createdAt: true,
});
export const insertFuelCardApplicationSchema = createInsertSchema(fuelCardApplications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  reviewedBy: true,
  reviewedAt: true,
  notes: true
});

export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
  id: true,
  createdAt: true
});

export const insertFollowUpSchema = createInsertSchema(followUps).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertCollectionSchema = createInsertSchema(collections).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertClientVaultSchema = createInsertSchema(clientVault).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastAccessedAt: true,
  lastAccessedBy: true
});

export const insertTaskSchema = createInsertSchema(tasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertBrokerSchema = createInsertSchema(brokers).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

export const insertFuelAdvanceSchema = createInsertSchema(fuelAdvances).omit({
  id: true,
  createdAt: true,
  updatedAt: true
});

// Types
export type TimeEntry = typeof timeEntries.$inferSelect;
export type InsertTimeEntry = typeof timeEntries.$inferInsert;
export type UpsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

export type FollowUp = typeof followUps.$inferSelect;
export type InsertFollowUp = z.infer<typeof insertFollowUpSchema>;

export type Collection = typeof collections.$inferSelect;
export type InsertCollection = z.infer<typeof insertCollectionSchema>;

export type ClientVault = typeof clientVault.$inferSelect;
export type InsertClientVault = z.infer<typeof insertClientVaultSchema>;

export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;

export type Broker = typeof brokers.$inferSelect;
export type InsertBroker = z.infer<typeof insertBrokerSchema>;

export type FuelAdvance = typeof fuelAdvances.$inferSelect;
export type InsertFuelAdvance = z.infer<typeof insertFuelAdvanceSchema>;

export type SupportMessage = typeof supportMessages.$inferSelect;
export type InsertSupportMessage = z.infer<typeof insertSupportMessageSchema>;

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// User profile update schema
export const updateUserProfileSchema = createInsertSchema(users).pick({
  firstName: true,
  lastName: true,
  phone: true,
  jobTitle: true,
  department: true,
}).extend({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
});

// User settings update schema 3/29/26
export type Role = typeof roles.$inferSelect;
export type InsertRole = z.infer<typeof insertRoleSchema>;

export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;

export type Debtor = typeof debtors.$inferSelect;
export type InsertDebtor = z.infer<typeof insertDebtorSchema>;

export type DebtorContact = typeof debtorContacts.$inferSelect;
export type InsertDebtorContact = z.infer<typeof insertDebtorContactSchema>;

export type DocumentLink = typeof documentLinks.$inferSelect;
export type InsertDocumentLink = z.infer<typeof insertDocumentLinkSchema>;

export type InvoiceStatusHistory = typeof invoiceStatusHistory.$inferSelect;
export type InsertInvoiceStatusHistory = z.infer<typeof insertInvoiceStatusHistorySchema>;

export type EventLedger = typeof eventLedger.$inferSelect;
export type InsertEventLedger = z.infer<typeof insertEventLedgerSchema>;

export type UpdateUserProfile = z.infer<typeof updateUserProfileSchema>;

// ─── Payout Settings ──────────────────────────────────────────────────────────
// One active row stores the current configurable factoring percentages
export const payoutSettings = pgTable("payout_settings", {
  id: serial("id").primaryKey(),
  advanceRate: decimal("advance_rate", { precision: 5, scale: 2 }).notNull().default("90.00"),
  feeRate: decimal("fee_rate", { precision: 5, scale: 2 }).notNull().default("3.00"),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPayoutSettingsSchema = createInsertSchema(payoutSettings).omit({
  id: true, createdAt: true, updatedAt: true,
});

// ─── Payouts ──────────────────────────────────────────────────────────────────
// One payout record per invoice; amounts are a snapshot at creation time
export const payouts = pgTable("payouts", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .references(() => invoices.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  clientId: integer("client_id").references(() => clients.id).notNull(),
  invoiceAmount: decimal("invoice_amount", { precision: 12, scale: 2 }).notNull(),
  advanceRate: decimal("advance_rate", { precision: 5, scale: 2 }).notNull(),
  feeRate: decimal("fee_rate", { precision: 5, scale: 2 }).notNull(),
  advanceAmount: decimal("advance_amount", { precision: 12, scale: 2 }).notNull(),
  feeAmount: decimal("fee_amount", { precision: 12, scale: 2 }).notNull(),
  reserveAmount: decimal("reserve_amount", { precision: 12, scale: 2 }).notNull(),
  netPayout: decimal("net_payout", { precision: 12, scale: 2 }).notNull(),
  paymentStatus: varchar("payment_status", {
    enum: ["pending_advance", "advance_paid", "reserve_pending", "reserve_released", "complete"],
  }).default("pending_advance").notNull(),
  advancePaidAt: timestamp("advance_paid_at"),
  reserveReleasedAt: timestamp("reserve_released_at"),
  notes: text("notes"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPayoutSchema = createInsertSchema(payouts).omit({
  id: true, createdAt: true, updatedAt: true,
});

export type PayoutSettings = typeof payoutSettings.$inferSelect;
export type InsertPayoutSettings = z.infer<typeof insertPayoutSettingsSchema>;
export type Payout = typeof payouts.$inferSelect;
export type InsertPayout = z.infer<typeof insertPayoutSchema>;

export type FuelCardApplication = typeof fuelCardApplications.$inferSelect;
export type InsertFuelCardApplication = typeof fuelCardApplications.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Load = typeof loads.$inferSelect;
export type InsertLoad = z.infer<typeof insertLoadSchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Activity = typeof activities.$inferSelect;
export type InsertActivity = z.infer<typeof insertActivitySchema>;

// ─── Credit Checks ────────────────────────────────────────────────────────────
export const creditChecks = pgTable("credit_checks", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", { enum: ["broker", "debtor"] }).notNull(),
  entityId: integer("entity_id").notNull(),
  entityName: varchar("entity_name").notNull(),
  mcNumber: varchar("mc_number"),
  dotNumber: varchar("dot_number"),
  riskScore: integer("risk_score"),
  riskTier: varchar("risk_tier", { enum: ["low", "medium", "high", "critical"] }),
  creditLimit: decimal("credit_limit", { precision: 12, scale: 2 }),
  recommendedCreditLimit: decimal("recommended_credit_limit", { precision: 12, scale: 2 }),
  avgDaysToPay: integer("avg_days_to_pay"),
  status: varchar("status", {
    enum: ["pending", "approved", "approved_with_conditions", "declined", "expired"],
  }).default("pending").notNull(),
  expiresAt: timestamp("expires_at"),
  checkedBy: varchar("checked_by").references(() => users.id),
  approvedBy: varchar("approved_by").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCreditCheckSchema = createInsertSchema(creditChecks).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type CreditCheck = typeof creditChecks.$inferSelect;
export type InsertCreditCheck = z.infer<typeof insertCreditCheckSchema>;

// ─── ACH Settings ─────────────────────────────────────────────────────────────
export const achSettings = pgTable("ach_settings", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull().unique(),
  bankName: varchar("bank_name").notNull(),
  routingNumber: varchar("routing_number").notNull(),
  accountNumber: varchar("account_number").notNull(),
  accountType: varchar("account_type", { enum: ["checking", "savings"] }).default("checking").notNull(),
  accountHolderName: varchar("account_holder_name").notNull(),
  status: varchar("status", { enum: ["active", "inactive", "pending_verification"] }).default("pending_verification").notNull(),
  verifiedAt: timestamp("verified_at"),
  verifiedBy: varchar("verified_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertAchSettingsSchema = createInsertSchema(achSettings).omit({
  id: true, createdAt: true, updatedAt: true, verifiedAt: true,
});
export type AchSettings = typeof achSettings.$inferSelect;
export type InsertAchSettings = z.infer<typeof insertAchSettingsSchema>;

// ─── Cash Applications (incoming payment records) ────────────────────────────
export const cashApplications = pgTable("cash_applications", {
  id: serial("id").primaryKey(),
  paymentReference: varchar("payment_reference").unique().notNull(),
  payorName: varchar("payor_name").notNull(),
  debtorId: integer("debtor_id").references(() => debtors.id),
  paymentDate: timestamp("payment_date").notNull(),
  totalReceived: decimal("total_received", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method", {
    enum: ["ach", "wire", "check", "other"],
  }).default("ach").notNull(),
  status: varchar("status", {
    enum: ["unapplied", "partially_applied", "fully_applied", "overpaid"],
  }).default("unapplied").notNull(),
  notes: text("notes"),
  processedBy: varchar("processed_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCashApplicationSchema = createInsertSchema(cashApplications).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type CashApplication = typeof cashApplications.$inferSelect;
export type InsertCashApplication = z.infer<typeof insertCashApplicationSchema>;

// ─── Payment Application Lines (maps payment → invoice) ──────────────────────
export const paymentApplicationLines = pgTable("payment_application_lines", {
  id: serial("id").primaryKey(),
  cashApplicationId: integer("cash_application_id")
    .references(() => cashApplications.id, { onDelete: "cascade" }).notNull(),
  invoiceId: integer("invoice_id").references(() => invoices.id).notNull(),
  invoiceNumber: varchar("invoice_number").notNull(),
  invoiceAmount: decimal("invoice_amount", { precision: 12, scale: 2 }).notNull(),
  appliedAmount: decimal("applied_amount", { precision: 12, scale: 2 }).notNull(),
  variance: decimal("variance", { precision: 12, scale: 2 }).default("0"),
  varianceType: varchar("variance_type", {
    enum: ["full_match", "short_pay", "overpay", "write_off"],
  }).default("full_match").notNull(),
  varianceReason: text("variance_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPaymentApplicationLineSchema = createInsertSchema(paymentApplicationLines).omit({
  id: true, createdAt: true,
});
export type PaymentApplicationLine = typeof paymentApplicationLines.$inferSelect;
export type InsertPaymentApplicationLine = z.infer<typeof insertPaymentApplicationLineSchema>;

// ─── Exceptions ───────────────────────────────────────────────────────────────
export const exceptions = pgTable("exceptions", {
  id: serial("id").primaryKey(),
  type: varchar("type", {
    enum: ["short_pay", "overpay", "doc_missing", "credit_limit_exceeded", "duplicate_invoice", "unapplied_payment", "other"],
  }).notNull(),
  severity: varchar("severity", { enum: ["low", "medium", "high", "critical"] }).default("medium").notNull(),
  entityType: varchar("entity_type", {
    enum: ["invoice", "payment", "client", "debtor", "broker"],
  }).notNull(),
  entityId: integer("entity_id"),
  entityRef: varchar("entity_ref"),
  title: varchar("title").notNull(),
  description: text("description"),
  status: varchar("status", {
    enum: ["open", "under_review", "resolved", "waived"],
  }).default("open").notNull(),
  assignedTo: varchar("assigned_to").references(() => users.id),
  resolvedBy: varchar("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  resolution: text("resolution"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertExceptionSchema = createInsertSchema(exceptions).omit({
  id: true, createdAt: true, updatedAt: true, resolvedAt: true,
});
export type Exception = typeof exceptions.$inferSelect;
export type InsertException = z.infer<typeof insertExceptionSchema>;

// ─── Compliance Integration Runs ─────────────────────────────────────────────
// Records every scheduled or manual FMCSA check run for audit/traceability.
export const complianceIntegrationRuns = pgTable("compliance_integration_runs", {
  id: serial("id").primaryKey(),
  runType: varchar("run_type", { enum: ["scheduled", "manual"] }).notNull().default("scheduled"),
  triggeredBy: varchar("triggered_by").notNull().default("system"),
  status: varchar("status", {
    enum: ["running", "completed", "failed"],
  }).notNull().default("running"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  totalChecked: integer("total_checked").default(0),
  successCount: integer("success_count").default(0),
  failureCount: integer("failure_count").default(0),
  notFoundCount: integer("not_found_count").default(0),
  noKeyCount: integer("no_key_count").default(0),
  alertsCreated: integer("alerts_created").default(0),
  errorLog: jsonb("error_log"),
});

export const insertComplianceIntegrationRunSchema = createInsertSchema(complianceIntegrationRuns).omit({
  id: true, startedAt: true,
});
export type ComplianceIntegrationRun = typeof complianceIntegrationRuns.$inferSelect;
export type InsertComplianceIntegrationRun = z.infer<typeof insertComplianceIntegrationRunSchema>;

// ─── FMCSA Broker Authority Checks ───────────────────────────────────────────
// Append-only: every check is a new row. Never overwrite old records.
export const brokerAuthorityChecks = pgTable("broker_authority_checks", {
  id: serial("id").primaryKey(),
  // FK to source entity (one of these will be populated, the other null)
  brokerId: integer("broker_id").references(() => brokers.id, { onDelete: "set null" }),
  debtorId: integer("debtor_id").references(() => debtors.id, { onDelete: "set null" }),
  // Generic entity reference (for querying across types)
  entityType: varchar("entity_type", { enum: ["broker", "debtor"] }).notNull(),
  entityId: integer("entity_id").notNull(),
  entityName: varchar("entity_name"),
  // Identifiers
  mcNumber: varchar("mc_number"),
  dotNumber: varchar("dot_number"),
  // FMCSA-returned identity fields
  legalName: varchar("legal_name"),
  dbaName: varchar("dba_name"),
  // Authority status fields
  operatingStatus: varchar("operating_status"),
  commonAuthorityStatus: varchar("common_authority_status"),
  contractAuthorityStatus: varchar("contract_authority_status"),
  brokerAuthorityStatus: varchar("broker_authority_status"),
  allowedToOperate: boolean("allowed_to_operate"),
  carrierOperation: varchar("carrier_operation"),
  // Insurance / bond fields
  bipdRequired: varchar("bipd_required"),
  bipdInsuranceOnFile: varchar("bipd_insurance_on_file"),
  cargoInsuranceRequired: varchar("cargo_insurance_required"),
  cargoInsuranceOnFile: varchar("cargo_insurance_on_file"),
  brokerBondStatus: varchar("broker_bond_status"),
  bondAmount: decimal("bond_amount", { precision: 14, scale: 2 }),
  // Integration run linkage
  integrationRunId: integer("integration_run_id").references(() => complianceIntegrationRuns.id),
  // Change detection
  changeSummary: text("change_summary"),
  // Raw source payload for audit/debugging
  rawResponse: jsonb("raw_response"),
  // Outcome of this check
  checkStatus: varchar("check_status", {
    enum: ["success", "not_found", "api_error", "no_key"],
  }).default("success").notNull(),
  errorMessage: text("error_message"),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
  checkedBy: varchar("checked_by"),
}, (table) => ({
  mcIdx: index("bac_mc_number_idx").on(table.mcNumber),
  dotIdx: index("bac_dot_number_idx").on(table.dotNumber),
  statusIdx: index("bac_check_status_idx").on(table.checkStatus),
  checkedAtIdx: index("bac_checked_at_idx").on(table.checkedAt),
  entityIdx: index("bac_entity_idx").on(table.entityType, table.entityId),
  brokerIdx: index("bac_broker_id_idx").on(table.brokerId),
}));

export const insertBrokerAuthorityCheckSchema = createInsertSchema(brokerAuthorityChecks).omit({
  id: true, checkedAt: true,
});
export type BrokerAuthorityCheck = typeof brokerAuthorityChecks.$inferSelect;
export type InsertBrokerAuthorityCheck = z.infer<typeof insertBrokerAuthorityCheckSchema>;

// ─── FMCSA Authority Alerts ───────────────────────────────────────────────────
export const brokerAuthorityAlerts = pgTable("broker_authority_alerts", {
  id: serial("id").primaryKey(),
  // FK to source entity
  brokerId: integer("broker_id").references(() => brokers.id, { onDelete: "set null" }),
  debtorId: integer("debtor_id").references(() => debtors.id, { onDelete: "set null" }),
  entityType: varchar("entity_type", { enum: ["broker", "debtor"] }).notNull(),
  entityId: integer("entity_id").notNull(),
  entityName: varchar("entity_name"),
  mcNumber: varchar("mc_number"),
  dotNumber: varchar("dot_number"),
  checkId: integer("check_id").references(() => brokerAuthorityChecks.id),
  alertType: varchar("alert_type", {
    enum: ["became_inactive", "authority_revoked", "status_changed", "not_found", "api_error", "insurance_lapsed"],
  }).notNull(),
  previousStatus: varchar("previous_status"),
  newStatus: varchar("new_status"),
  field: varchar("field"),
  severity: varchar("severity", { enum: ["low", "medium", "high", "critical"] }).default("high").notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  entityAlertIdx: index("baa_entity_idx").on(table.entityType, table.entityId),
  alertTypeIdx: index("baa_alert_type_idx").on(table.alertType),
  resolvedIdx: index("baa_resolved_at_idx").on(table.resolvedAt),
  brokerAlertIdx: index("baa_broker_id_idx").on(table.brokerId),
}));

export const insertBrokerAuthorityAlertSchema = createInsertSchema(brokerAuthorityAlerts).omit({
  id: true, createdAt: true, resolvedAt: true,
});
export type BrokerAuthorityAlert = typeof brokerAuthorityAlerts.$inferSelect;
export type InsertBrokerAuthorityAlert = z.infer<typeof insertBrokerAuthorityAlertSchema>;