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
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations, sql } from "drizzle-orm";
import { LOAD_TYPES } from "./load-types";

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

// Encrypted application-level integration settings.
export const integrationSettings = pgTable("integration_settings", {
  key: varchar("key").primaryKey().notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Clients table
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull(),
  preferredName: varchar("preferred_name"),
  email: varchar("email"),
  phone: varchar("phone"),
  address: text("address"),
  city: varchar("city"),
  state: varchar("state"),
  zipCode: varchar("zip_code"),
  contactPerson: varchar("contact_person"),
  taxId: varchar("tax_id"),
  // Carrier / factoring fields
  mcNumber: varchar("mc_number"),
  dotNumber: varchar("dot_number"),
  creditLimit: decimal("credit_limit", { precision: 12, scale: 2 }).default("0"),
  maxLimit: decimal("max_limit", { precision: 12, scale: 2 }),
  ratePercent: decimal("rate_percent", { precision: 6, scale: 2 }),
  advanceRate: decimal("advance_rate", { precision: 7, scale: 2 }).default("80.00"),
  factoringFeeRate: decimal("factoring_fee_rate", { precision: 7, scale: 2 }).default("3.00"),
  cargoType: varchar("cargo_type", { enum: LOAD_TYPES }),
  language: varchar("language"),
  reviewed: timestamp("reviewed"),
  nextReview: timestamp("next_review"),
  reserves: decimal("reserves", { precision: 12, scale: 2 }).default("0"),
  shorts: decimal("shorts", { precision: 12, scale: 2 }).default("0"),
  owners: jsonb("owners").$type<Array<Record<string, unknown>>>().default([]),
  onboardingData: jsonb("onboarding_data").$type<Record<string, unknown>>().default({}),
  onboardingProfile: jsonb("onboarding_profile").$type<Record<string, unknown>>().default({}),
  source: varchar("source"),
  bankAccountEncrypted: text("bank_account_encrypted"),
  abaRoutingEncrypted: text("aba_routing_encrypted"),
  assignedProcessor: varchar("assigned_processor").references(() => users.id, { onDelete: "set null" }),
  status: varchar("status", { enum: ["new_client", "active", "inactive"] }).default("new_client").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("clients_name_idx").on(table.name),
  index("clients_assigned_processor_idx").on(table.assignedProcessor),
]);

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

// Loads table
export const loads = pgTable("loads", {
  id: integer("id").primaryKey(),
  loadNumber: varchar("load_number").unique().notNull(),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
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
  invoiceNumber: varchar("invoice_number").notNull(),
  loadId: integer("load_id").references(() => loads.id, { onDelete: "set null" }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  debtorId: integer("debtor_id").references(() => debtors.id),
  brokerId: integer("broker_id").references(() => brokers.id, { onDelete: "set null" }),
  branchId: integer("branch_id").references(() => brokerBranches.id, { onDelete: "set null" }),
  driverId: integer("driver_id").references(() => drivers.id, { onDelete: "set null" }),
  driverName: varchar("driver_name"),
  paymentType: varchar("payment_type", { enum: ["ACH", "Wire"] }).default("ACH"),
  bankAccountId: integer("bank_account_id").references(() => clientVault.id),
  loadNumber: varchar("load_number"),
  code: varchar("code"),
  branchName: varchar("branch_name"),
  buyout: boolean("buyout"),
  lumper: boolean("lumper"),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency").default("USD").notNull(),
  invoiceDate: timestamp("invoice_date"),
  dueDate: timestamp("due_date"),
  pickupLocation: text("pickup_location"),
  deliveryLocation: text("delivery_location"),
  loadType: varchar("load_type", {
    enum: LOAD_TYPES,
  }),
  bolNumber: varchar("bol_number"),
  instructionsSubject: varchar("instructions_subject"),
  instructionsDetails: text("instructions_details"),
  paymentReference: varchar("payment_reference"),
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
      "held",
    ],
  })
    .default("draft")
    .notNull(),
  heldReason: text("held_reason"),
  heldAt: timestamp("held_at"),
  heldBy: varchar("held_by").references(() => users.id),
  heldNotes: text("held_notes"),
  previousStatus: varchar("previous_status"),
  factoringStage: varchar("factoring_stage", {
    enum: [
      "document_intake",
      "verification",
      "approval",
      "advance",
      "collections",
      "payment_receipt",
      "reconciliation",
      "final_settlement",
    ],
  }).default("document_intake").notNull(),
  submittedBy: varchar("submitted_by").references(() => users.id),
  submittedAt: timestamp("submitted_at"),
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  fundedAt: timestamp("funded_at"),
  chargebackDate: timestamp("chargeback_date"),
  chargebackStatus: varchar("chargeback_status", {
    enum: ["none", "scheduled", "extended", "charged"],
  }).default("none").notNull(),
  chargebackExtendedBy: varchar("chargeback_extended_by").references(() => users.id),
  chargebackExtendedAt: timestamp("chargeback_extended_at"),
  chargebackExtensionReason: text("chargeback_extension_reason"),
  chargebackExtensionDate: timestamp("chargeback_extension_date"),
  assignedTo: varchar("assigned_to").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("invoices_invoice_number_idx").on(table.invoiceNumber),
  index("invoices_client_id_idx").on(table.clientId),
  uniqueIndex("invoices_client_invoice_number_unique")
    .on(table.clientId, table.invoiceNumber)
    .where(sql`${table.invoiceNumber} IS NOT NULL`),
  uniqueIndex("invoices_client_load_number_unique")
    .on(table.clientId, table.loadNumber)
    .where(sql`${table.loadNumber} IS NOT NULL`),
  index("invoices_broker_id_idx").on(table.brokerId),
  index("invoices_branch_id_idx").on(table.branchId),
  index("invoices_driver_id_idx").on(table.driverId),
  index("invoices_created_at_idx").on(table.createdAt),
  index("invoices_submitted_by_created_at_idx").on(table.submittedBy, table.createdAt),
]);

// Carrier and broker profile alerts share one polymorphic table. Alerts are
// retained when deactivated so the operational history remains auditable.
export const carrierAlerts = pgTable("carrier_alerts", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", { enum: ["carrier", "broker"] }).notNull(),
  entityId: integer("entity_id").notNull(),
  severity: varchar("severity", { enum: ["block", "ack", "info"] }).notNull(),
  title: varchar("title").notNull(),
  message: text("message").notNull(),
  active: boolean("active").default(true).notNull(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (table) => [
  index("carrier_alerts_entity_active_idx").on(table.entityType, table.entityId, table.active),
]);

export const invoiceAlertAcks = pgTable("invoice_alert_acks", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  alertCode: varchar("alert_code").notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  reason: text("reason"),
  ackedAt: timestamp("acked_at").defaultNow().notNull(),
}, (table) => [
  index("invoice_alert_acks_invoice_code_idx").on(table.invoiceId, table.alertCode),
]);

export const invoicePreflightSettings = pgTable("invoice_preflight_settings", {
  id: integer("id").primaryKey().default(1),
  rules: jsonb("rules").$type<Record<string, boolean>>().notNull().default({
    DUPLICATE_EXACT: true,
    DUPLICATE_NEAR: true,
    CARRIER_DORMANT: true,
    CARRIER_MANUAL_ALERT: true,
    BROKER_MANUAL_ALERT: true,
    BROKER_GRADE_LOW: true,
    BROKER_CHARGEBACKS: true,
    AUTHORITY_INACTIVE: true,
    DOCS_EXPIRED: true,
    CARRIER_OPEN_CHARGEBACK: true,
  }),
  dormantDays: integer("dormant_days").notNull().default(45),
  nearAmountTolerance: decimal("near_amount_tolerance", { precision: 12, scale: 2 }).notNull().default("1.00"),
  nearServiceDateDays: integer("near_service_date_days").notNull().default(3),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  check("invoice_preflight_settings_singleton_check", sql`${table.id} = 1`),
]);

// Append-only notes keep invoice collection context separate from the mutable
// invoice.notes field while preserving who entered each note and when.
export const invoiceNotes = pgTable("invoice_notes", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  body: text("body").notNull(),
  createdBy: varchar("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("invoice_notes_invoice_idx").on(table.invoiceId, table.createdAt),
]);

// Immutable chargeback lifecycle events support extension history and audit
// reconstruction without overwriting the current invoice snapshot.
export const invoiceChargebackEvents = pgTable("invoice_chargeback_events", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  eventType: varchar("event_type").notNull(),
  extensionDate: timestamp("extension_date"),
  reason: text("reason"),
  actorId: varchar("actor_id").references(() => users.id),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("invoice_chargeback_events_invoice_idx").on(table.invoiceId, table.createdAt),
]);

export const invoiceRefunds = pgTable("invoice_refunds", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  refundDate: timestamp("refund_date").defaultNow().notNull(),
  method: varchar("method").notNull(),
  reference: varchar("reference"),
  notes: text("notes"),
  createdBy: varchar("created_by").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("invoice_refunds_invoice_idx").on(table.invoiceId, table.refundDate),
]);

// Documents table
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  companyId: varchar("company_id"),
  filename: varchar("filename").notNull(),
  originalName: varchar("original_name").notNull(),
  mimeType: varchar("mime_type").notNull(),
  size: integer("size").notNull(),
  storageKey: varchar("storage_key"),
  s3Key: text("s3_key"),
  documentType: varchar("document_type", {
    enum: [
      "invoice",
      "rate_confirmation",
      "bill_of_lading",
      "bol",
      "commercial_invoice",
      "pod",
      "proof_of_delivery",
      "lumper_receipt",
      "receipt",
      "driver_id",
      "carrier_setup",
      "other",
    ],
  }).notNull(),
  candidateDocumentType: varchar("candidate_document_type", {
    enum: [
      "rate_confirmation",
      "bill_of_lading",
      "proof_of_delivery",
      "lumper_receipt",
      "invoice",
      "receipt",
      "other",
    ],
  }),
  finalDocumentType: varchar("final_document_type", {
    enum: [
      "rate_confirmation",
      "bill_of_lading",
      "proof_of_delivery",
      "lumper_receipt",
      "invoice",
      "receipt",
      "other",
    ],
  }),
  classificationConfidence: decimal("classification_confidence", { precision: 5, scale: 4 }),
  // AI classification fields
  aiDocumentType: varchar("ai_document_type"),
  aiClassificationConfidence: decimal("ai_classification_confidence", { precision: 5, scale: 4 }),
  aiClassificationSignals: jsonb("ai_classification_signals").$type<string[]>(),
  allClassificationScores: jsonb("all_classification_scores").$type<Record<string, number>>(),
  classificationSource: varchar("classification_source", {
    enum: ["rules", "ai", "agent"],
  }).default("rules"),
  aiClassifiedAt: timestamp("ai_classified_at"),
  aiClassificationModel: varchar("ai_classification_model"),
  loadId: integer("load_id").references(() => loads.id, { onDelete: "cascade" }),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }),
  documentCategory: varchar("document_category"),
  uploadedBy: varchar("uploaded_by").references(() => users.id).notNull(),
  sourceChannel: varchar("source_channel", {
    enum: ["portal", "manual", "email", "api", "drag_drop"],
  }).default("manual"),
  status: varchar("status", {
    enum: ["processing", "processed", "failed"],
  }).default("processing").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Durable retry queue for S3 objects that could not be removed during
// compensation or another cleanup operation.
export const s3CleanupQueue = pgTable("s3_cleanup_queue", {
  id: serial("id").primaryKey(),
  s3Key: text("s3_key").notNull().unique(),
  reason: text("reason"),
  attempts: integer("attempts").default(0).notNull(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => [
  index("s3_cleanup_queue_unresolved_created_idx").on(table.resolvedAt, table.createdAt),
]);

export const insertS3CleanupQueueSchema = createInsertSchema(s3CleanupQueue).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type S3CleanupQueue = typeof s3CleanupQueue.$inferSelect;
export type InsertS3CleanupQueue = z.infer<typeof insertS3CleanupQueueSchema>;
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
  id: serial("id").primaryKey(),
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
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
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

// Employee expense reimbursements. Amounts are stored as integer cents to avoid
// floating point rounding; the API exposes both amountCents and a fixed amount.
export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  submittedBy: varchar("submitted_by").references(() => users.id, { onDelete: "cascade" }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  title: varchar("title").notNull(),
  category: varchar("category", { enum: ["fuel", "office", "travel", "meals", "equipment", "software", "other"] }).notNull(),
  description: text("description"),
  merchant: varchar("merchant"),
  paymentMethod: varchar("payment_method"),
  notes: text("notes"),
  expenseDate: timestamp("expense_date").notNull(),
  status: varchar("status", { enum: ["draft", "submitted", "approved", "rejected", "reimbursed"] }).default("draft").notNull(),
  rejectionReason: text("rejection_reason"),
  receiptKey: text("receipt_key"),
  receiptName: varchar("receipt_name"),
  receiptMimeType: varchar("receipt_mime_type"),
  receiptSize: integer("receipt_size"),
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  rejectedBy: varchar("rejected_by").references(() => users.id),
  rejectedAt: timestamp("rejected_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("expenses_submitted_by_idx").on(table.submittedBy),
  index("expenses_status_idx").on(table.status),
  index("expenses_date_idx").on(table.expenseDate),
]);

export const insertExpenseSchema = createInsertSchema(expenses).omit({
  id: true, createdAt: true, updatedAt: true, approvedBy: true, approvedAt: true,
  rejectedBy: true, rejectedAt: true, rejectionReason: true, receiptKey: true,
  receiptName: true, receiptMimeType: true, receiptSize: true,
}).extend({
  amountCents: z.coerce.number().int().positive(),
  expenseDate: z.coerce.date(),
});
export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;

// Written corrective-action notices issued to employees. This is intentionally
// additive so historical personnel records are never overwritten.
export const writtenWarnings = pgTable("written_warnings", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  issuedBy: varchar("issued_by").references(() => users.id).notNull(),
  reason: text("reason").notNull(),
  severity: varchar("severity", { enum: ["verbal", "written", "final"] }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledged_at"),
}, (table) => [
  index("written_warnings_user_idx").on(table.userId),
  index("written_warnings_issued_by_idx").on(table.issuedBy),
]);

export const insertWrittenWarningSchema = createInsertSchema(writtenWarnings).omit({
  id: true,
  createdAt: true,
  acknowledgedAt: true,
});
export type WrittenWarning = typeof writtenWarnings.$inferSelect;
export type InsertWrittenWarning = z.infer<typeof insertWrittenWarningSchema>;

// Notifications table
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
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

// One durable alert per aging threshold. Acknowledgement is intentionally
// retained so collections history remains visible after resolution.
export const invoiceAgingAlerts = pgTable("invoice_aging_alerts", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  alertType: varchar("alert_type", { enum: ["day_60", "day_90"] }).notNull(),
  triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: varchar("acknowledged_by").references(() => users.id),
  status: varchar("status", { enum: ["pending", "acknowledged"] }).default("pending").notNull(),
}, (table) => [
  uniqueIndex("invoice_aging_alert_invoice_type_unique").on(table.invoiceId, table.alertType),
  index("invoice_aging_alert_status_idx").on(table.status),
  index("invoice_aging_alert_invoice_idx").on(table.invoiceId),
]);

export const insertInvoiceAgingAlertSchema = createInsertSchema(invoiceAgingAlerts).omit({
  id: true,
  triggeredAt: true,
  acknowledgedAt: true,
});
export type InvoiceAgingAlert = typeof invoiceAgingAlerts.$inferSelect;
export type InsertInvoiceAgingAlert = z.infer<typeof insertInvoiceAgingAlertSchema>;

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
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
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
  id: integer("id").primaryKey().generatedByDefaultAsIdentity({ name: "client_vault_id_seq", startWith: 3 }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
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
  createdBy: varchar("created_by").references(() => users.id),
  createdByPortalUserId: integer("created_by_portal_user_id").references(() => carrierPortalUsers.id, { onDelete: "set null" }),
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
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  assignedTo: varchar("assigned_to").references(() => users.id, { onDelete: "set null" }),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "set null" }),
  progress: integer("progress").default(0).notNull(),
  progressUpdatedAt: timestamp("progress_updated_at"),
  progressUpdatedBy: varchar("progress_updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Calendar appointments and reminders. Recurring events remain a single row;
// API consumers receive their materialized occurrences for the requested range.
export const calendarEvents = pgTable("calendar_events", {
  id: serial("id").primaryKey(),
  title: varchar("title").notNull(),
  description: text("description"),
  eventType: varchar("event_type", { enum: ["meeting", "deadline", "followup", "reminder", "holiday", "closure"] }).default("meeting").notNull(),
  status: varchar("status", { enum: ["scheduled", "completed", "cancelled"] }).default("scheduled").notNull(),
  color: varchar("color"),
  startAt: timestamp("start_at").notNull(),
  endAt: timestamp("end_at").notNull(),
  allDay: boolean("all_day").default(false).notNull(),
  recurrence: varchar("recurrence", { enum: ["none", "daily", "weekly", "monthly"] }).default("none").notNull(),
  recurrenceEndAt: timestamp("recurrence_end_at"),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: "cascade" }).notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  assignedTo: varchar("assigned_to").references(() => users.id, { onDelete: "set null" }),
  carrierId: integer("carrier_id").references(() => clients.id, { onDelete: "set null" }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  brokerId: integer("broker_id").references(() => brokers.id, { onDelete: "set null" }),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  reminderSentAt: timestamp("reminder_sent_at"),
  lastDigestDate: timestamp("last_digest_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("calendar_events_assigned_start_idx").on(table.assignedTo, table.startAt),
  index("calendar_events_range_idx").on(table.startAt, table.recurrenceEndAt),
]);

export const insertCalendarEventSchema = createInsertSchema(calendarEvents).omit({
  id: true, createdAt: true, updatedAt: true, reminderSentAt: true, lastDigestDate: true,
}).extend({
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  recurrenceEndAt: z.coerce.date().nullable().optional(),
});
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;

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
  currentAr: decimal("current_ar", { precision: 12, scale: 2 }).default("0"),
  creditGrade: varchar("credit_grade", { enum: ["A", "B", "C", "D", "F"] }),
  creditScore: integer("credit_score"),
  website: text("website"),
  fmcsaUrl: text("fmcsa_url"),
  source: varchar("source"),
  paymentTerms: varchar("payment_terms", { enum: ["net15", "net30", "net45", "net60", "quickpay"] }).default("net30").notNull(),
  status: varchar("status", { enum: ["active", "inactive", "suspended"] }).default("active").notNull(),
  notes: text("notes"),
  assignedProcessor: varchar("assigned_processor").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("brokers_name_idx").on(table.name),
  index("brokers_assigned_processor_idx").on(table.assignedProcessor),
]);

// A broker may have multiple operating branches. Branches are kept separately
// so invoices can retain both a relational reference and a historical name
// snapshot in branchName.
export const brokerBranches = pgTable("broker_branches", {
  id: serial("id").primaryKey(),
  brokerId: integer("broker_id").references(() => brokers.id, { onDelete: "restrict" }).notNull(),
  branchName: varchar("branch_name").notNull(),
  address: varchar("address"),
  city: varchar("city"),
  state: varchar("state"),
  zip: varchar("zip"),
  phone: varchar("phone"),
  email: varchar("email"),
  contactName: varchar("contact_name"),
  status: varchar("status", { enum: ["active", "inactive"] }).default("active").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("broker_branches_broker_id_idx").on(table.brokerId),
  index("broker_branches_status_idx").on(table.status),
]);

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
  // Rebuild fields are additive; legacy columns above remain readable.
  type: varchar("type"),
  loadNumber: varchar("load_number"),
  carrierId: integer("carrier_id").references(() => clients.id, { onDelete: "set null" }),
  brokerId: integer("broker_id").references(() => brokers.id, { onDelete: "set null" }),
  rate: decimal("rate", { precision: 12, scale: 2 }),
  faPercent: decimal("fa_percent", { precision: 7, scale: 4 }),
  fees: decimal("fees", { precision: 12, scale: 2 }),
  owed: decimal("owed", { precision: 12, scale: 2 }),
  paymentMethod: varchar("payment_method"),
  deliveryDate: timestamp("delivery_date"),
  code: varchar("code"),
  referenceNumber: varchar("reference_number"),
  authorizedAgent: varchar("authorized_agent").references(() => users.id, { onDelete: "set null" }),
  rateConS3Key: text("rate_con_s3_key"),
  rateConName: varchar("rate_con_name"),
  rateConType: varchar("rate_con_type"),
  deliveryVerified: boolean("delivery_verified").default(false),
  paid: boolean("paid").default(false),
  account: varchar("account"),
  depositSlipS3Key: text("deposit_slip_s3_key"),
  depositSlipName: varchar("deposit_slip_name"),
  depositSlipType: varchar("deposit_slip_type"),
});

// Follow-ups table
export const followUps = pgTable("follow_ups", {
  id: integer("id").primaryKey(),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  title: varchar("title").notNull(),
  description: text("description"),
  priority: varchar("priority", { enum: ["low", "medium", "high"] }).default("medium").notNull(),
  status: varchar("status", { enum: ["pending", "in-progress", "completed"] }).default("pending").notNull(),
  dueDate: timestamp("due_date").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Internal support tickets and their chronological discussion.
export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  ticketNumber: varchar("ticket_number").notNull().unique(),
  title: varchar("title").notNull(),
  description: text("description").notNull(),
  category: varchar("category", { enum: ["billing", "technical", "carrier", "broker", "document", "payroll", "other"] }).notNull(),
  priority: varchar("priority", { enum: ["low", "medium", "high", "urgent"] }).default("medium").notNull(),
  status: varchar("status", { enum: ["open", "in-progress", "pending", "resolved", "closed"] }).default("open").notNull(),
  submittedBy: varchar("submitted_by").references(() => users.id).notNull(),
  assignedTo: varchar("assigned_to").references(() => users.id, { onDelete: "set null" }),
  carrierId: integer("carrier_id").references(() => clients.id, { onDelete: "set null" }),
  brokerId: integer("broker_id").references(() => brokers.id, { onDelete: "set null" }),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  resolution: text("resolution"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("tickets_status_idx").on(table.status),
  index("tickets_assigned_to_idx").on(table.assignedTo),
  index("tickets_submitted_by_idx").on(table.submittedBy),
  index("tickets_created_at_idx").on(table.createdAt),
]);

export const ticketComments = pgTable("ticket_comments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").references(() => tickets.id, { onDelete: "cascade" }).notNull(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  comment: text("comment").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("ticket_comments_ticket_created_idx").on(table.ticketId, table.createdAt),
]);

export const insertTicketSchema = createInsertSchema(tickets).omit({
  id: true, ticketNumber: true, createdAt: true, updatedAt: true, resolvedAt: true,
  submittedBy: true,
}).extend({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(10000),
});
export const insertTicketCommentSchema = createInsertSchema(ticketComments).omit({
  id: true, createdAt: true, userId: true,
}).extend({ comment: z.string().trim().min(1).max(10000) });
export type Ticket = typeof tickets.$inferSelect;
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type TicketComment = typeof ticketComments.$inferSelect;
export type InsertTicketComment = z.infer<typeof insertTicketCommentSchema>;

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  invoices: many(invoices),
  documents: many(documents),
  activities: many(activities),
  timeEntries: many(timeEntries),
  notifications: many(notifications),
  acknowledgedAgingAlerts: many(invoiceAgingAlerts),
}));

export const debtorsRelations = relations(debtors, ({ many }) => ({
  invoices: many(invoices),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  assignedProcessorUser: one(users, { fields: [clients.assignedProcessor], references: [users.id] }),
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

export const invoiceAgingAlertsRelations = relations(invoiceAgingAlerts, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceAgingAlerts.invoiceId], references: [invoices.id] }),
  acknowledgedByUser: one(users, { fields: [invoiceAgingAlerts.acknowledgedBy], references: [users.id] }),
}));
// Added new invoice relations 3/29/26
export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  load: one(loads, { fields: [invoices.loadId], references: [loads.id] }),
  client: one(clients, { fields: [invoices.clientId], references: [clients.id] }),
  debtor: one(debtors, { fields: [invoices.debtorId], references: [debtors.id] }),
  broker: one(brokers, { fields: [invoices.brokerId], references: [brokers.id] }),
  branch: one(brokerBranches, { fields: [invoices.branchId], references: [brokerBranches.id] }),
  driver: one(drivers, { fields: [invoices.driverId], references: [drivers.id] }),
  submittedByUser: one(users, { fields: [invoices.submittedBy], references: [users.id] }),
  approvedByUser: one(users, { fields: [invoices.approvedBy], references: [users.id] }),
  assignedToUser: one(users, { fields: [invoices.assignedTo], references: [users.id] }),
  documents: many(documents),
  agingAlerts: many(invoiceAgingAlerts),
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

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  submittedByUser: one(users, { fields: [tickets.submittedBy], references: [users.id] }),
  assignedToUser: one(users, { fields: [tickets.assignedTo], references: [users.id] }),
  carrier: one(clients, { fields: [tickets.carrierId], references: [clients.id] }),
  broker: one(brokers, { fields: [tickets.brokerId], references: [brokers.id] }),
  invoice: one(invoices, { fields: [tickets.invoiceId], references: [invoices.id] }),
  comments: many(ticketComments),
}));
export const ticketCommentsRelations = relations(ticketComments, ({ one }) => ({
  ticket: one(tickets, { fields: [ticketComments.ticketId], references: [tickets.id] }),
  author: one(users, { fields: [ticketComments.userId], references: [users.id] }),
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
  createdByUser: one(users, { fields: [tasks.createdBy], references: [users.id] }),
  progressUpdatedByUser: one(users, { fields: [tasks.progressUpdatedBy], references: [users.id] }),
}));

export const brokersRelations = relations(brokers, ({ one, many }) => ({
  assignedProcessorUser: one(users, { fields: [brokers.assignedProcessor], references: [users.id] }),
  branches: many(brokerBranches),
  invoices: many(invoices),
}));

export const brokerBranchesRelations = relations(brokerBranches, ({ one, many }) => ({
  broker: one(brokers, { fields: [brokerBranches.brokerId], references: [brokers.id] }),
  invoices: many(invoices),
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
export const insertDebtorSchema = createInsertSchema(debtors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBrokerBranchSchema = createInsertSchema(brokerBranches).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  branchName: z.string().trim().min(1),
  email: z.string().trim().email().nullable().optional(),
  status: z.enum(["active", "inactive"]).default("active"),
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
  updatedAt: true,
  progressUpdatedAt: true,
  progressUpdatedBy: true,
  createdBy: true,
}).extend({
  progress: z.coerce.number().int().min(0).max(100).optional(),
});

export const insertBrokerSchema = createInsertSchema(brokers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  creditGrade: true,
  creditScore: true,
});

export const insertFuelAdvanceSchema = createInsertSchema(fuelAdvances).omit({
  id: true,
  createdAt: true,
  updatedAt: true
}).extend({
  advanceDate: z.coerce.date(),
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

export type Debtor = typeof debtors.$inferSelect;
export type InsertDebtor = z.infer<typeof insertDebtorSchema>;

export type InvoiceStatusHistory = typeof invoiceStatusHistory.$inferSelect;
export type InsertInvoiceStatusHistory = z.infer<typeof insertInvoiceStatusHistorySchema>;

export type EventLedger = typeof eventLedger.$inferSelect;
export type InsertEventLedger = z.infer<typeof insertEventLedgerSchema>;

export type UpdateUserProfile = z.infer<typeof updateUserProfileSchema>;

// ─── Payout Settings ──────────────────────────────────────────────────────────
// One active row stores the current configurable factoring percentages
export const payoutSettings = pgTable("payout_settings", {
  id: serial("id").primaryKey(),
  advanceRate: decimal("advance_rate", { precision: 5, scale: 2 }).notNull().default("80.00"),
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
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  invoiceAmount: decimal("invoice_amount", { precision: 12, scale: 2 }).notNull(),
  advanceRate: decimal("advance_rate", { precision: 5, scale: 2 }).notNull(),
  feeRate: decimal("fee_rate", { precision: 5, scale: 2 }).notNull(),
  advanceAmount: decimal("advance_amount", { precision: 12, scale: 2 }).notNull(),
  feeAmount: decimal("fee_amount", { precision: 12, scale: 2 }).notNull(),
  reserveAmount: decimal("reserve_amount", { precision: 12, scale: 2 }).notNull(),
  netPayout: decimal("net_payout", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method", { enum: ["ach", "wire", "check"] }).default("ach").notNull(),
  bankAccountVaultId: integer("bank_account_vault_id").references(() => clientVault.id),
  paymentStatus: varchar("payment_status", {
    enum: ["pending_advance", "advance_paid", "reserve_pending", "reserve_released", "complete"],
  }).default("pending_advance").notNull(),
  advancePaidAt: timestamp("advance_paid_at"),
  advancePaidBy: varchar("advance_paid_by").references(() => users.id),
  reserveReleasedAt: timestamp("reserve_released_at"),
  notes: text("notes"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertPayoutSchema = createInsertSchema(payouts).omit({
  id: true, createdAt: true, updatedAt: true,
});

// Immutable funding receipts. A new row is created for every version; receipt
// rows are never updated or deleted by the application.
export const fundingReceipts = pgTable("funding_receipts", {
  id: serial("id").primaryKey(),
  receiptNo: varchar("receipt_no").notNull(),
  invoiceId: integer("invoice_id").references(() => invoices.id).notNull(),
  version: integer("version").notNull(),
  carrierId: integer("carrier_id").references(() => clients.id).notNull(),
  brokerId: integer("broker_id").references(() => brokers.id),
  invoiceAmount: decimal("invoice_amount", { precision: 12, scale: 2 }).notNull(),
  advancePct: decimal("advance_pct", { precision: 7, scale: 2 }).notNull(),
  feeAmount: decimal("fee_amount", { precision: 12, scale: 2 }).notNull(),
  reserveAmount: decimal("reserve_amount", { precision: 12, scale: 2 }).notNull(),
  netFunded: decimal("net_funded", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: varchar("payment_method", { enum: ["ach", "wire", "check"] }).notNull(),
  paymentReference: varchar("payment_reference"),
  fundedAt: timestamp("funded_at").notNull(),
  fundedByUserId: varchar("funded_by_user_id").references(() => users.id).notNull(),
  s3Key: text("s3_key").notNull(),
  auditHash: varchar("audit_hash", { length: 64 }).notNull(),
  createdAt: timestamp("created_at").notNull(),
}, (table) => [
  uniqueIndex("funding_receipts_receipt_no_version_uq").on(table.receiptNo, table.version),
  uniqueIndex("funding_receipts_invoice_version_uq").on(table.invoiceId, table.version),
  index("funding_receipts_invoice_idx").on(table.invoiceId, table.createdAt),
  index("funding_receipts_receipt_no_idx").on(table.receiptNo),
  check("funding_receipts_version_positive", sql`${table.version} > 0`),
]);

export const insertFundingReceiptSchema = createInsertSchema(fundingReceipts).omit({
  id: true,
});

export type PayoutSettings = typeof payoutSettings.$inferSelect;
export type InsertPayoutSettings = z.infer<typeof insertPayoutSettingsSchema>;
export type Payout = typeof payouts.$inferSelect;
export type InsertPayout = z.infer<typeof insertPayoutSchema>;
export type FundingReceipt = typeof fundingReceipts.$inferSelect;
export type InsertFundingReceipt = z.infer<typeof insertFundingReceiptSchema>;

export type FuelCardApplication = typeof fuelCardApplications.$inferSelect;
export type InsertFuelCardApplication = typeof fuelCardApplications.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Load = typeof loads.$inferSelect;
export type InsertLoad = z.infer<typeof insertLoadSchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type BrokerBranch = typeof brokerBranches.$inferSelect;
export type InsertBrokerBranch = z.infer<typeof insertBrokerBranchSchema>;
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

// ─── Lockbox Entries (raw incoming bank / remittance rows) ───────────────────
export const lockboxEntries = pgTable("lockbox_entries", {
  id: serial("id").primaryKey(),
  receivedDate: timestamp("received_date").notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  payorName: varchar("payor_name").notNull(),
  payorReference: varchar("payor_reference"),
  bankReference: varchar("bank_reference"),
  status: varchar("status", {
    enum: ["unmatched", "matched", "partial", "exception"],
  }).default("unmatched").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
});

export const insertLockboxEntrySchema = createInsertSchema(lockboxEntries).omit({
  id: true, createdAt: true,
});
export type LockboxEntry = typeof lockboxEntries.$inferSelect;
export type InsertLockboxEntry = z.infer<typeof insertLockboxEntrySchema>;

// ─── Cash Applications (incoming payment records) ────────────────────────────
export const cashApplications = pgTable("cash_applications", {
  id: serial("id").primaryKey(),
  lockboxEntryId: integer("lockbox_entry_id").references(() => lockboxEntries.id, { onDelete: "set null" }),
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
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
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

// Immutable broker credit calculations.  The broker snapshot is intentionally
// kept on each row so reports remain reproducible after the broker changes.
export const brokerCreditScores = pgTable("broker_credit_scores", {
  id: serial("id").primaryKey(),
  brokerId: integer("broker_id").references(() => brokers.id, { onDelete: "restrict" }).notNull(),
  grade: varchar("grade", { enum: ["A", "B", "C", "D", "F"] }).notNull(),
  score: integer("score").notNull(),
  paymentSpeedScore: integer("payment_speed_score").notNull(),
  paymentReliabilityScore: integer("payment_reliability_score").notNull(),
  chargebackScore: integer("chargeback_score").notNull(),
  shortPayScore: integer("short_pay_score").notNull(),
  avgDaysToPayment: integer("avg_days_to_payment"),
  totalInvoices: integer("total_invoices").notNull().default(0),
  totalPaid: decimal("total_paid", { precision: 14, scale: 2 }).notNull().default("0"),
  totalOutstanding: decimal("total_outstanding", { precision: 14, scale: 2 }).notNull().default("0"),
  totalChargebacks: integer("total_chargebacks").notNull().default(0),
  totalShortPays: integer("total_short_pays").notNull().default(0),
  totalDisputes: integer("total_disputes").notNull().default(0),
  lateInvoiceCount: integer("late_invoice_count").notNull().default(0),
  paidInvoiceCount: integer("paid_invoice_count").notNull().default(0),
  lastCalculatedAt: timestamp("last_calculated_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("broker_credit_scores_broker_idx").on(table.brokerId, table.lastCalculatedAt),
  check("broker_credit_scores_grade_check", sql`${table.grade} in ('A', 'B', 'C', 'D', 'F')`),
  check("broker_credit_scores_score_check", sql`${table.score} between 0 and 100`),
  check("broker_credit_scores_payment_speed_check", sql`${table.paymentSpeedScore} between 0 and 40`),
  check("broker_credit_scores_payment_reliability_check", sql`${table.paymentReliabilityScore} between 0 and 30`),
  check("broker_credit_scores_chargeback_check", sql`${table.chargebackScore} between 0 and 20`),
  check("broker_credit_scores_short_pay_check", sql`${table.shortPayScore} between 0 and 10`),
]);

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
    enum: ["running", "completed", "failed", "skipped"],
  }).notNull().default("running"),
  reason: text("reason"),
  detail: jsonb("detail"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  heartbeatAt: timestamp("heartbeat_at").defaultNow().notNull(),
  leaseToken: varchar("lease_token"),
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
    enum: ["ok", "error", "skipped"],
  }).default("ok").notNull(),
  authorityStatus: varchar("authority_status", {
    enum: ["ACTIVE", "INACTIVE", "NOT_AUTHORIZED", "UNKNOWN"],
  }),
  checkError: text("check_error"),
  // Legacy compatibility field. New code writes checkError as the canonical value.
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

// ─── FMCSA Carrier Authority Checks ──────────────────────────────────────────
// Append-only: every check is a new row. Never overwrite old records.
export const carrierAuthorityChecks = pgTable("carrier_authority_checks", {
  id: serial("id").primaryKey(),
  carrierId: integer("carrier_id").notNull().references(() => clients.id),
  mcNumber: varchar("mc_number"),
  dotNumber: varchar("dot_number"),
  authorityStatus: varchar("authority_status", {
    enum: ["ACTIVE", "INACTIVE", "NOT_AUTHORIZED", "UNKNOWN"],
  }),
  operatingStatus: varchar("operating_status"),
  checkStatus: varchar("check_status", {
    enum: ["ok", "error", "skipped"],
  }).default("ok").notNull(),
  checkError: text("check_error"),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
  checkedBy: varchar("checked_by"),
  integrationRunId: integer("integration_run_id").references(() => complianceIntegrationRuns.id),
  rawResponse: jsonb("raw_response"),
}, (table) => ({
  carrierIdx: index("cac_carrier_id_idx").on(table.carrierId),
  mcIdx: index("cac_mc_number_idx").on(table.mcNumber),
  dotIdx: index("cac_dot_number_idx").on(table.dotNumber),
  authorityStatusIdx: index("cac_authority_status_idx").on(table.authorityStatus),
  checkStatusIdx: index("cac_check_status_idx").on(table.checkStatus),
  checkedAtIdx: index("cac_checked_at_idx").on(table.checkedAt),
  integrationRunIdx: index("cac_integration_run_id_idx").on(table.integrationRunId),
}));

export const insertCarrierAuthorityCheckSchema = createInsertSchema(carrierAuthorityChecks).omit({
  id: true, checkedAt: true,
});
export type CarrierAuthorityCheck = typeof carrierAuthorityChecks.$inferSelect;
export type InsertCarrierAuthorityCheck = z.infer<typeof insertCarrierAuthorityCheckSchema>;

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

// ─── Document Validation Rules ────────────────────────────────────────────────
// Admin-configurable checklist of documents required at each lifecycle stage.
export const documentRules = pgTable("document_rules", {
  id: serial("id").primaryKey(),
  documentType: varchar("document_type").notNull().unique(),
  label: varchar("label").notNull(),
  description: text("description"),
  required: boolean("required").default(true).notNull(),
  requiredForStage: varchar("required_for_stage", {
    enum: ["start_review", "approve"],
  }).default("start_review").notNull(),
  sortOrder: integer("sort_order").default(0),
  active: boolean("active").default(true).notNull(),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDocumentRuleSchema = createInsertSchema(documentRules).omit({ id: true, createdAt: true, updatedAt: true });
export type DocumentRule = typeof documentRules.$inferSelect;
export type InsertDocumentRule = z.infer<typeof insertDocumentRuleSchema>;

// ─── Invoice Document Reviews ─────────────────────────────────────────────────
// Reviewer notes and approval status per invoice (written by managers/admins).
export const invoiceDocReviews = pgTable("invoice_doc_reviews", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "cascade" }).notNull(),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  status: varchar("status", {
    enum: ["approved", "needs_revision", "incomplete"],
  }).default("incomplete").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertInvoiceDocReviewSchema = createInsertSchema(invoiceDocReviews).omit({ id: true, createdAt: true });
export type InvoiceDocReview = typeof invoiceDocReviews.$inferSelect;
export type InsertInvoiceDocReview = z.infer<typeof insertInvoiceDocReviewSchema>;

// ─── Document OCR / Extraction Pipeline ───────────────────────────────────────
export const docExtractionJobs = pgTable("doc_extraction_jobs", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id")
    .references(() => documents.id, { onDelete: "cascade" })
    .notNull(),
  jobType: varchar("job_type", {
    enum: ["pdf_text", "ocr", "classify", "field_extract"],
  }).default("pdf_text").notNull(),
  status: varchar("status", {
    enum: ["queued", "processing", "completed", "failed"],
  }).default("queued").notNull(),
  parserName: varchar("parser_name"),
  attemptCount: integer("attempt_count").default(0),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  dejDocIdx:    index("dej_document_idx").on(table.documentId),
  dejStatusIdx: index("dej_status_idx").on(table.status),
}));

export const docExtractionResults = pgTable("doc_extraction_results", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id")
    .references(() => documents.id, { onDelete: "cascade" })
    .notNull(),
  jobId: integer("job_id")
    .references(() => docExtractionJobs.id, { onDelete: "cascade" }),
  fullText: text("full_text"),
  mainText: text("main_text"),
  pageTexts: jsonb("page_texts"),
  rawPayloadJson: jsonb("raw_payload_json"),
  confidenceScore: varchar("confidence_score"),
  extractionMethod: varchar("extraction_method"),
  pageCount: integer("page_count"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  derDocIdx: index("der_document_idx").on(table.documentId),
}));

export const docFieldCandidates = pgTable("doc_field_candidates", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id")
    .references(() => documents.id, { onDelete: "cascade" })
    .notNull(),
  fieldName: varchar("field_name").notNull(),
  fieldValue: text("field_value"),
  normalizedValue: text("normalized_value"),
  confidenceScore: varchar("confidence_score"),
  pageNumber: integer("page_number"),
  sourceSnippet: text("source_snippet"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  dfcDocIdx:   index("dfc_document_idx").on(table.documentId),
  dfcFieldIdx: index("dfc_field_name_idx").on(table.fieldName),
}));

export const docReviews = pgTable("doc_reviews", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id")
    .references(() => documents.id, { onDelete: "cascade" })
    .notNull(),
  reviewedByUserId: varchar("reviewed_by_user_id").references(() => users.id),
  reviewStatus: varchar("review_status", {
    enum: ["pending", "confirmed", "rejected", "unreadable"],
  }).default("pending").notNull(),
  reviewNotes: text("review_notes"),
  finalFieldsJson: jsonb("final_fields_json"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  drDocIdx: index("dr_document_idx").on(table.documentId),
}));

export const insertDocExtractionJobSchema = createInsertSchema(docExtractionJobs).omit({ id: true, createdAt: true });
export type DocExtractionJob  = typeof docExtractionJobs.$inferSelect;
export type InsertDocExtractionJob = z.infer<typeof insertDocExtractionJobSchema>;

export const insertDocReviewSchema = createInsertSchema(docReviews).omit({ id: true, createdAt: true, reviewedAt: true });
export type DocReview = typeof docReviews.$inferSelect;
export type InsertDocReview  = z.infer<typeof insertDocReviewSchema>;

// ─── Broker Follow-Up Automation Engine ──────────────────────────────────────
// Auto-created when a funded invoice enters collections-ready state.
// Supports configurable reminder cadences (immediate, due-date, overdue, weekly).

export interface CadenceConfig {
  sendImmediately: boolean;
  sendOnDueDate: boolean;
  overdueIntervals: number[];  // days past due date, e.g. [3, 7]
  weeklyCount: number;         // weekly reminders after last overdue step
  paused: boolean;
}

export const brokerFollowUps = pgTable("broker_follow_ups", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .references(() => invoices.id, { onDelete: "cascade" })
    .notNull(),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  brokerId: integer("broker_id").references(() => brokers.id, { onDelete: "set null" }),
  triggerType: varchar("trigger_type", { enum: ["auto", "manual"] }).default("auto").notNull(),
  triggerStatus: varchar("trigger_status").default("funded").notNull(),
  subject: varchar("subject").notNull(),
  body: text("body").notNull(),
  status: varchar("status", {
    enum: ["pending", "sent", "acknowledged", "failed"],
  }).default("pending").notNull(),
  sentAt: timestamp("sent_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  sentBy: varchar("sent_by").references(() => users.id),
  notes: text("notes"),
  cadenceConfig: jsonb("cadence_config").$type<CadenceConfig>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBrokerFollowUpSchema = createInsertSchema(brokerFollowUps).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type BrokerFollowUp = typeof brokerFollowUps.$inferSelect;
export type InsertBrokerFollowUp = z.infer<typeof insertBrokerFollowUpSchema>;

// ─── Broker Follow-Up Reminders (cadence instances) ──────────────────────────

export const brokerFollowUpReminders = pgTable("broker_follow_up_reminders", {
  id: serial("id").primaryKey(),
  followUpId: integer("follow_up_id")
    .references(() => brokerFollowUps.id, { onDelete: "cascade" })
    .notNull(),
  sequenceNumber: integer("sequence_number").notNull(),
  reminderType: varchar("reminder_type").notNull(),
  // reminderType values: immediate | due_date | 3d_overdue | 7d_overdue | weekly
  intervalDays: integer("interval_days"),
  // intervalDays = days from invoice due date (null for immediate)
  scheduledSendAt: timestamp("scheduled_send_at").notNull(),
  actualSendAt: timestamp("actual_send_at"),
  status: varchar("status", {
    enum: ["scheduled", "sending", "sent", "skipped", "paused", "canceled"],
  }).default("scheduled").notNull(),
  skipReason: varchar("skip_reason"),
  stopReason: varchar("stop_reason"),
  // stopReason values: invoice_paid | invoice_settled | exception_raised | cash_applied | agent_suppressed
  subject: varchar("subject").notNull(),
  body: text("body").notNull(),
  sendgridMessageId: text("sendgrid_message_id"),
  deliveryStatus: varchar("delivery_status").default("pending"),
  editedAt: timestamp("edited_at"),
  editedBy: varchar("edited_by").references(() => users.id),
  // deliveryStatus values: pending | delivered | bounced | failed | spam | unsubscribed
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertBrokerFollowUpReminderSchema = createInsertSchema(brokerFollowUpReminders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type BrokerFollowUpReminder = typeof brokerFollowUpReminders.$inferSelect;
export type InsertBrokerFollowUpReminder = z.infer<typeof insertBrokerFollowUpReminderSchema>;

// ─── Broker Follow-Up Templates ───────────────────────────────────────────────

export const brokerFollowUpTemplates = pgTable("broker_follow_up_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name").notNull(),
  triggerType: varchar("trigger_type", {
    enum: ["immediate", "due_date", "overdue", "escalation"],
  }).notNull(),
  subject: varchar("subject").notNull(),
  body: text("body").notNull(),
  // Placeholders: {{brokerName}} {{invoiceNumber}} {{loadNumber}} {{amountDue}} {{dueDate}} {{paymentInstructions}} {{contactName}}
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
});

export const insertBrokerFollowUpTemplateSchema = createInsertSchema(brokerFollowUpTemplates).omit({
  id: true,
  createdAt: true,
});
export type BrokerFollowUpTemplate = typeof brokerFollowUpTemplates.$inferSelect;
export type InsertBrokerFollowUpTemplate = z.infer<typeof insertBrokerFollowUpTemplateSchema>;

// ─── Dispatchers ──────────────────────────────────────────────────────────────
export const dispatchers = pgTable("dispatchers", {
  id: serial("id").primaryKey(),
  firstName: varchar("first_name").notNull(),
  lastName: varchar("last_name").notNull(),
  email: varchar("email"),
  phone: varchar("phone"),
  carrierId: integer("carrier_id").references(() => clients.id, { onDelete: "set null" }),
  status: varchar("status", { enum: ["active", "inactive"] }).default("active").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
});

export const insertDispatcherSchema = createInsertSchema(dispatchers).omit({
  id: true,
  createdAt: true,
});

export type Dispatcher = typeof dispatchers.$inferSelect;
export type InsertDispatcher = z.infer<typeof insertDispatcherSchema>;

// ─── Drivers ──────────────────────────────────────────────────────────────────
export const drivers = pgTable("drivers", {
  id: serial("id").primaryKey(),
  carrierId: integer("carrier_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  firstName: varchar("first_name").notNull(),
  lastName: varchar("last_name").notNull(),
  phone: varchar("phone"),
  email: varchar("email"),
  licenseNumber: varchar("license_number"),
  licenseState: varchar("license_state"),
  licenseExpiration: timestamp("license_expiration"),
  status: varchar("status", { enum: ["active", "inactive"] }).default("active").notNull(),
  photoS3Key: varchar("photo_s3_key"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
}, (table) => [
  index("drivers_carrier_id_idx").on(table.carrierId),
]);

export const insertDriverSchema = createInsertSchema(drivers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Driver = typeof drivers.$inferSelect;
export type InsertDriver = z.infer<typeof insertDriverSchema>;

export const driversRelations = relations(drivers, ({ one, many }) => ({
  carrier: one(clients, { fields: [drivers.carrierId], references: [clients.id] }),
  invoices: many(invoices),
}));

// ─── Trucks ───────────────────────────────────────────────────────────────────
export const trucks = pgTable("trucks", {
  id: serial("id").primaryKey(),
  truckNumber: varchar("truck_number").notNull(),
  vin: varchar("vin"),
  make: varchar("make"),
  model: varchar("model"),
  year: integer("year"),
  licensePlate: varchar("license_plate"),
  state: varchar("state"),
  carrierId: integer("carrier_id").references(() => clients.id, { onDelete: "set null" }),
  dispatcherId: integer("dispatcher_id").references(() => dispatchers.id, { onDelete: "set null" }),
  status: varchar("status", { enum: ["active", "inactive", "out-of-service"] }).default("active").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
});

export const insertTruckSchema = createInsertSchema(trucks).omit({
  id: true,
  createdAt: true,
});

export type Truck = typeof trucks.$inferSelect;
export type InsertTruck = z.infer<typeof insertTruckSchema>;

// ─── Bank Transfers ───────────────────────────────────────────────────────────
export const bankTransfers = pgTable("bank_transfers", {
  id: serial("id").primaryKey(),
  transferType: varchar("transfer_type", { enum: ["ACH", "wire"] }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  carrierId: integer("carrier_id").references(() => clients.id, { onDelete: "set null" }),
  bankAccountName: varchar("bank_account_name"),
  routingNumber: varchar("routing_number"),
  accountNumberEncrypted: varchar("account_number_encrypted"),
  memo: text("memo"),
  status: varchar("status", { enum: ["pending", "processing", "completed", "failed"] }).default("pending").notNull(),
  transferDate: timestamp("transfer_date"),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
});

export const insertBankTransferSchema = createInsertSchema(bankTransfers).omit({
  id: true,
  createdAt: true,
});

export type BankTransfer = typeof bankTransfers.$inferSelect;
export type InsertBankTransfer = z.infer<typeof insertBankTransferSchema>;

// ─── Payroll ──────────────────────────────────────────────────────────────────
export const payrollEntries = pgTable("payroll_entries", {
  id: serial("id").primaryKey(),
  employeeId: varchar("employee_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  payPeriodStart: timestamp("pay_period_start").notNull(),
  payPeriodEnd: timestamp("pay_period_end").notNull(),
  regularHours: decimal("regular_hours", { precision: 8, scale: 2 }).default("0").notNull(),
  overtimeHours: decimal("overtime_hours", { precision: 8, scale: 2 }).default("0").notNull(),
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }).notNull(),
  grossPay: decimal("gross_pay", { precision: 12, scale: 2 }).notNull(),
  deductions: decimal("deductions", { precision: 12, scale: 2 }).default("0").notNull(),
  netPay: decimal("net_pay", { precision: 12, scale: 2 }).notNull(),
  status: varchar("status", { enum: ["draft", "approved", "paid"] }).default("draft").notNull(),
  paidAt: timestamp("paid_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
});

export const payrollDeductions = pgTable("payroll_deductions", {
  id: serial("id").primaryKey(),
  payrollEntryId: integer("payroll_entry_id").references(() => payrollEntries.id, { onDelete: "cascade" }).notNull(),
  deductionType: varchar("deduction_type", { enum: ["tax", "insurance", "other"] }).notNull(),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description"),
});

export const insertPayrollEntrySchema = createInsertSchema(payrollEntries).omit({ id: true, createdAt: true });
export const insertPayrollDeductionSchema = createInsertSchema(payrollDeductions).omit({ id: true });

export type PayrollEntry = typeof payrollEntries.$inferSelect;
export type InsertPayrollEntry = z.infer<typeof insertPayrollEntrySchema>;
export type PayrollDeduction = typeof payrollDeductions.$inferSelect;
export type InsertPayrollDeduction = z.infer<typeof insertPayrollDeductionSchema>;

// ─── Bulk Invoices ────────────────────────────────────────────────────────────
export const bulkInvoiceBatches = pgTable("bulk_invoice_batches", {
  id: serial("id").primaryKey(),
  batchName: varchar("batch_name").notNull(),
  carrierId: integer("carrier_id").references(() => clients.id, { onDelete: "set null" }),
  brokerId: integer("broker_id").references(() => brokers.id, { onDelete: "restrict" }),
  requestHash: varchar("request_hash").unique(),
  reportDateStart: timestamp("report_date_start"),
  reportDateEnd: timestamp("report_date_end"),
  totalAmount: decimal("total_amount", { precision: 14, scale: 2 }).default("0").notNull(),
  totalRate: decimal("total_rate", { precision: 14, scale: 2 }).default("0").notNull(),
  invoiceCount: integer("invoice_count").default(0).notNull(),
  status: varchar("status", { enum: ["draft", "submitted", "processing", "completed", "failed"] }).default("draft").notNull(),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
}, (table) => [
  uniqueIndex("bulk_invoice_batches_request_hash_unique").on(table.requestHash),
]);

export const bulkInvoiceItems = pgTable("bulk_invoice_items", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").references(() => bulkInvoiceBatches.id, { onDelete: "cascade" }).notNull(),
  carrierId: integer("carrier_id").references(() => clients.id, { onDelete: "restrict" }),
  ticketNumber: varchar("ticket_number"),
  invoiceNumber: varchar("invoice_number").notNull(),
  loadNumber: varchar("load_number"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  rate: decimal("rate", { precision: 12, scale: 2 }),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  businessKey: varchar("business_key"),
  brokerName: varchar("broker_name"),
  status: varchar("status", { enum: ["pending", "approved", "rejected"] }).default("pending").notNull(),
  notes: text("notes"),
}, (table) => [
  uniqueIndex("bulk_invoice_items_business_key_unique").on(table.businessKey),
]);

export const insertBulkInvoiceBatchSchema = createInsertSchema(bulkInvoiceBatches).omit({ id: true, createdAt: true });
export const insertBulkInvoiceItemSchema = createInsertSchema(bulkInvoiceItems).omit({ id: true });

export type BulkInvoiceBatch = typeof bulkInvoiceBatches.$inferSelect;
export type InsertBulkInvoiceBatch = z.infer<typeof insertBulkInvoiceBatchSchema>;
export type BulkInvoiceItem = typeof bulkInvoiceItems.$inferSelect;
export type InsertBulkInvoiceItem = z.infer<typeof insertBulkInvoiceItemSchema>;

// ─── Release Letters ──────────────────────────────────────────────────────────
export const releaseLetters = pgTable("release_letters", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  carrierId: integer("carrier_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  brokerId: integer("broker_id").references(() => brokers.id, { onDelete: "set null" }),
  letterType: varchar("letter_type", { enum: ["standard", "conditional", "final"] }).default("standard").notNull(),
  status: varchar("status", { enum: ["draft", "sent", "acknowledged"] }).default("draft").notNull(),
  sentAt: timestamp("sent_at"),
  acknowledgedAt: timestamp("acknowledged_at"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  createdBy: varchar("created_by").references(() => users.id),
});

export const insertReleaseLetterSchema = createInsertSchema(releaseLetters).omit({ id: true, createdAt: true });
export type ReleaseLetter = typeof releaseLetters.$inferSelect;
export type InsertReleaseLetter = z.infer<typeof insertReleaseLetterSchema>;

// ─── Carrier Portal Users ──────────────────────────────────────────────────────
export const carrierPortalUsers = pgTable("carrier_portal_users", {
  id: serial("id").primaryKey(),
  email: varchar("email").notNull().unique(),
  passwordHash: varchar("password_hash").notNull(),
  carrierId: integer("carrier_id").references(() => clients.id),
  mcNumber: varchar("mc_number"),
  dotNumber: varchar("dot_number"),
  phone: varchar("phone"),
  companyName: varchar("company_name").notNull(),
  status: varchar("status", { enum: ["pending", "active", "suspended", "rejected"] }).default("pending").notNull(),
  rejectionReason: text("rejection_reason"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

export const insertCarrierPortalUserSchema = createInsertSchema(carrierPortalUsers).omit({
  id: true, createdAt: true, lastLoginAt: true, rejectionReason: true, reviewedAt: true, reviewedBy: true,
});
export type CarrierPortalUser = typeof carrierPortalUsers.$inferSelect;
export type InsertCarrierPortalUser = z.infer<typeof insertCarrierPortalUserSchema>;

// ─── Carrier/Portal Agent Chat ────────────────────────────────────────────────
export const portalChats = pgTable("portal_chats", {
  id: serial("id").primaryKey(),
  carrierId: integer("carrier_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  portalUserId: integer("portal_user_id").references(() => carrierPortalUsers.id, { onDelete: "cascade" }).notNull(),
  agentId: varchar("agent_id").references(() => users.id, { onDelete: "set null" }),
  carrierLastReadAt: timestamp("carrier_last_read_at"),
  agentLastReadAt: timestamp("agent_last_read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("portal_chats_carrier_portal_user_uidx").on(table.carrierId, table.portalUserId),
  index("portal_chats_carrier_idx").on(table.carrierId),
  index("portal_chats_portal_user_idx").on(table.portalUserId),
  index("portal_chats_agent_idx").on(table.agentId),
]);

export const portalChatMessages = pgTable("portal_chat_messages", {
  id: serial("id").primaryKey(),
  chatId: integer("chat_id").references(() => portalChats.id, { onDelete: "cascade" }).notNull(),
  senderType: varchar("sender_type", { enum: ["agent", "carrier"] }).notNull(),
  senderId: varchar("sender_id").notNull(),
  message: text("message"),
  attachmentS3Key: text("attachment_s3_key"),
  attachmentName: varchar("attachment_name"),
  attachmentMimeType: varchar("attachment_mime_type"),
  attachmentSize: integer("attachment_size"),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("portal_chat_messages_chat_created_idx").on(table.chatId, table.createdAt),
  index("portal_chat_messages_chat_read_idx").on(table.chatId, table.read),
  index("portal_chat_messages_sender_idx").on(table.senderType, table.senderId),
]);

export const insertPortalChatSchema = createInsertSchema(portalChats).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertPortalChatMessageSchema = createInsertSchema(portalChatMessages).omit({
  id: true, createdAt: true,
});
export type PortalChat = typeof portalChats.$inferSelect;
export type InsertPortalChat = z.infer<typeof insertPortalChatSchema>;
export type PortalChatMessage = typeof portalChatMessages.$inferSelect;
export type InsertPortalChatMessage = z.infer<typeof insertPortalChatMessageSchema>;

// ─── Carrier Submissions ───────────────────────────────────────────────────────
export const carrierSubmissions = pgTable("carrier_submissions", {
  id: serial("id").primaryKey(),
  carrierId: integer("carrier_id").references(() => clients.id),
  portalUserId: integer("portal_user_id").references(() => carrierPortalUsers.id).notNull(),
  invoiceNumber: varchar("invoice_number"),
  loadNumber: varchar("load_number"),
  loadType: varchar("load_type", { enum: LOAD_TYPES }),
  brokerId: integer("broker_id").references(() => brokers.id, { onDelete: "set null" }),
  brokerName: varchar("broker_name"),
  branchId: integer("branch_id").references(() => brokerBranches.id, { onDelete: "set null" }),
  branchName: varchar("branch_name"),
  code: varchar("code"),
  lumper: boolean("lumper"),
  driverName: varchar("driver_name"),
  bankAccountId: integer("bank_account_id").references(() => clientVault.id, { onDelete: "set null" }),
  instructionsSubject: varchar("instructions_subject"),
  instructionsDetails: text("instructions_details"),
  amount: decimal("amount", { precision: 12, scale: 2 }),
  paymentType: varchar("payment_type", { enum: ["ACH", "check", "wire"] }).default("ACH"),
  status: varchar("status", { enum: ["submitted", "under_review", "approved", "funded", "rejected"] }).default("submitted").notNull(),
  notes: text("notes"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCarrierSubmissionSchema = createInsertSchema(carrierSubmissions).omit({
  id: true, submittedAt: true, createdAt: true,
});
export type CarrierSubmission = typeof carrierSubmissions.$inferSelect;
export type InsertCarrierSubmission = z.infer<typeof insertCarrierSubmissionSchema>;

// Portal acknowledgements and preflight snapshots are separate from internal
// invoice acknowledgements because a portal submission is not an invoice yet.
export const carrierSubmissionAlertAcks = pgTable("carrier_submission_alert_acks", {
  id: serial("id").primaryKey(),
  submissionId: integer("submission_id")
    .references(() => carrierSubmissions.id, { onDelete: "cascade" })
    .notNull(),
  portalUserId: integer("portal_user_id")
    .references(() => carrierPortalUsers.id)
    .notNull(),
  alertCode: varchar("alert_code").notNull(),
  reason: text("reason"),
  ackedAt: timestamp("acked_at").defaultNow().notNull(),
}, (table) => [
  index("carrier_submission_alert_acks_submission_code_idx").on(table.submissionId, table.alertCode),
  index("carrier_submission_alert_acks_portal_user_idx").on(table.portalUserId),
]);

export const carrierSubmissionPreflightEvents = pgTable("carrier_submission_preflight_events", {
  id: serial("id").primaryKey(),
  submissionId: integer("submission_id")
    .references(() => carrierSubmissions.id, { onDelete: "cascade" })
    .notNull(),
  eventType: varchar("event_type").default("invoice_preflight").notNull(),
  alerts: jsonb("alerts").$type<Array<Record<string, unknown>>>().notNull(),
  acknowledgements: jsonb("acknowledgements").$type<Array<Record<string, unknown>>>().notNull(),
  portalUserId: integer("portal_user_id")
    .references(() => carrierPortalUsers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("carrier_submission_preflight_events_submission_created_idx").on(table.submissionId, table.createdAt),
  index("carrier_submission_preflight_events_portal_user_idx").on(table.portalUserId),
]);

// ─── Carrier Submission Documents ─────────────────────────────────────────────
export const carrierSubmissionDocs = pgTable("carrier_submission_documents", {
  id: serial("id").primaryKey(),
  submissionId: integer("submission_id").references(() => carrierSubmissions.id).notNull(),
  documentType: varchar("document_type", { enum: ["rate_confirmation", "bol", "lumper_receipt", "other"] }).default("other").notNull(),
  filename: varchar("filename").notNull(),
  originalName: varchar("original_name").notNull(),
  mimeType: varchar("mime_type"),
  size: integer("size"),
  s3Key: text("s3_key"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export const insertCarrierSubmissionDocSchema = createInsertSchema(carrierSubmissionDocs).omit({
  id: true, uploadedAt: true,
});
export type CarrierSubmissionDoc = typeof carrierSubmissionDocs.$inferSelect;
export type InsertCarrierSubmissionDoc = z.infer<typeof insertCarrierSubmissionDocSchema>;

// ─── Workflow Config (DB-persisted pipeline customization) ─────────────────────

export const workflowConfigs = pgTable("workflow_configs", {
  id: serial("id").primaryKey(),
  name: varchar("name").default("default").notNull(),
  stagesJson: jsonb("stages_json").notNull(),
  updatedBy: varchar("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWorkflowConfigSchema = createInsertSchema(workflowConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type WorkflowConfig = typeof workflowConfigs.$inferSelect;
export type InsertWorkflowConfig = z.infer<typeof insertWorkflowConfigSchema>;

// ─── User Permissions ──────────────────────────────────────────────────────────
export const userPermissions = pgTable("user_permissions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  permission: varchar("permission").notNull(),
  granted: boolean("granted").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
  updatedBy: varchar("updated_by"),
});
export type UserPermission = typeof userPermissions.$inferSelect;

// ─── AI Chat Logs ──────────────────────────────────────────────────────────────
export const aiChatLogs = pgTable("ai_chat_logs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id"),
  messages: jsonb("messages").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});
export const insertAiChatLogSchema = createInsertSchema(aiChatLogs).omit({ id: true, createdAt: true });
export type AiChatLog = typeof aiChatLogs.$inferSelect;
export type InsertAiChatLog = z.infer<typeof insertAiChatLogSchema>;

// Internal agent chat
export const chatChannels = pgTable("chat_channels", {
  id: serial("id").primaryKey(),
  name: varchar("name"),
  type: varchar("type", { enum: ["channel", "direct"] }).notNull(),
  directKey: varchar("direct_key").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("chat_channels_type_idx").on(table.type),
]);

export const chatMembers = pgTable("chat_members", {
  channelId: integer("channel_id").references(() => chatChannels.id, { onDelete: "cascade" }).notNull(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  lastReadAt: timestamp("last_read_at"),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.userId] }),
  index("chat_members_user_idx").on(table.userId),
]);

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  channelId: integer("channel_id").references(() => chatChannels.id, { onDelete: "cascade" }).notNull(),
  senderId: varchar("sender_id").references(() => users.id).notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  editedAt: timestamp("edited_at"),
}, (table) => [
  index("chat_messages_channel_created_idx").on(table.channelId, table.createdAt),
]);

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true, createdAt: true, editedAt: true,
}).extend({ body: z.string().trim().min(1).max(10000) });
export type ChatChannel = typeof chatChannels.$inferSelect;
export type ChatMember = typeof chatMembers.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;

export const ALL_PERMISSIONS = [
  "dashboard","carriers","invoices","documents","tasks","bulk_invoices","portal_submissions",
  "factoring","payments","lockbox","fuel_advance","bank_transfers",
  "dispatchers","trucks","release_letters",
  "brokers","cb_reviews","mc_check","held","logs","calendar","bulk_sms",
  "followups","reports",
  "payroll","expenses","vault","help","settings","rules","workflow_builder","admin",
  "earl","chat","tickets",
] as const;
export type PermissionKey = typeof ALL_PERMISSIONS[number];

export const ROLE_DEFAULT_PERMISSIONS: Record<string, PermissionKey[]> = {
  admin: [...ALL_PERMISSIONS],
  manager: [
    "dashboard","carriers","invoices","documents","tasks","bulk_invoices","portal_submissions",
    "factoring","payments","lockbox","fuel_advance","bank_transfers",
    "dispatchers","trucks","release_letters",
    "brokers","cb_reviews","mc_check","held","logs","calendar","bulk_sms",
    "followups","reports",
    "payroll","expenses","vault","help","settings","rules","workflow_builder",
    "chat","tickets",
  ],
  employee: [
    "dashboard","carriers","invoices","documents","tasks",
    "fuel_advance","expenses","vault","help","settings",
    "chat","tickets",
  ],
};