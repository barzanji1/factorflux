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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Clients table
export const clients = pgTable("clients", {
  id: integer("id").primaryKey(),
  name: varchar("name").notNull(),
  email: varchar("email"),
  phone: varchar("phone"),
  address: text("address"),
  contactPerson: varchar("contact_person"),
  taxId: varchar("tax_id"),
  status: varchar("status", { enum: ["active", "inactive"] }).default("active").notNull(),
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
  id: integer("id").primaryKey(),
  invoiceNumber: varchar("invoice_number").unique().notNull(),
  loadId: integer("load_id").references(() => loads.id).notNull(),
  clientId: integer("client_id").references(() => clients.id).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: varchar("status", {
    enum: ["draft", "submitted", "approved", "rejected", "paid"]
  }).default("draft").notNull(),
  submittedBy: varchar("submitted_by").references(() => users.id),
  submittedAt: timestamp("submitted_at"),
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Documents table
export const documents = pgTable("documents", {
  id: integer("id").primaryKey(),
  filename: varchar("filename").notNull(),
  originalName: varchar("original_name").notNull(),
  mimeType: varchar("mime_type").notNull(),
  size: integer("size").notNull(),
  documentType: varchar("document_type", {
    enum: ["rate_confirmation", "bill_of_lading", "driver_id", "carrier_setup", "other"]
  }).notNull(),
  loadId: integer("load_id").references(() => loads.id),
  invoiceId: integer("invoice_id").references(() => invoices.id),
  uploadedBy: varchar("uploaded_by").references(() => users.id).notNull(),
  status: varchar("status", { enum: ["processing", "processed", "failed"] }).default("processing").notNull(),
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
  entityType: varchar("entity_type"), // Optional reference to related entity
  entityId: integer("entity_id"), // Optional reference to related entity
  createdAt: timestamp("created_at").defaultNow(),
});

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

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  load: one(loads, { fields: [invoices.loadId], references: [loads.id] }),
  client: one(clients, { fields: [invoices.clientId], references: [clients.id] }),
  submittedByUser: one(users, { fields: [invoices.submittedBy], references: [users.id] }),
  approvedByUser: one(users, { fields: [invoices.approvedBy], references: [users.id] }),
  documents: many(documents),
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

export type UpdateUserProfile = z.infer<typeof updateUserProfileSchema>;

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