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

// User storage table (required for Replit Auth)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().notNull(),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  phone: varchar("phone"),
  jobTitle: varchar("job_title"),
  department: varchar("department"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role", { enum: ["employee", "manager"] }).default("employee").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Clients table
export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
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
  id: serial("id").primaryKey(),
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
  id: serial("id").primaryKey(),
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
  id: serial("id").primaryKey(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  type: varchar("type").notNull(),
  description: text("description").notNull(),
  entityType: varchar("entity_type"),
  entityId: integer("entity_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Fuel card applications table
export const fuelCardApplications = pgTable("fuel_card_applications", {
  id: serial("id").primaryKey(),
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

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  invoices: many(invoices),
  documents: many(documents),
  activities: many(activities),
}));

export const clientsRelations = relations(clients, ({ many }) => ({
  loads: many(loads),
  invoices: many(invoices),
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

// Insert schemas
export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true, updatedAt: true });
export const insertLoadSchema = createInsertSchema(loads).omit({ id: true, createdAt: true, updatedAt: true });
export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true, createdAt: true, updatedAt: true });
export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true, createdAt: true });
export const insertActivitySchema = createInsertSchema(activities).omit({ id: true, createdAt: true });
export const insertFuelCardApplicationSchema = createInsertSchema(fuelCardApplications).omit({ 
  id: true, 
  createdAt: true, 
  updatedAt: true, 
  status: true, 
  reviewedBy: true, 
  reviewedAt: true, 
  notes: true 
});

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
