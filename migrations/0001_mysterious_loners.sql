CREATE TABLE "brokers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"contact_person" varchar NOT NULL,
	"email" varchar NOT NULL,
	"phone" varchar NOT NULL,
	"address" varchar,
	"city" varchar,
	"state" varchar,
	"zip_code" varchar,
	"mc_number" varchar,
	"dot_number" varchar,
	"credit_limit" integer DEFAULT 0,
	"payment_terms" varchar DEFAULT 'net30' NOT NULL,
	"status" varchar DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "client_vault" (
	"id" integer PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"data_type" varchar NOT NULL,
	"label" varchar NOT NULL,
	"encrypted_data" text NOT NULL,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_accessed_at" timestamp,
	"last_accessed_by" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"created_by" varchar NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" integer PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"description" text NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"priority" varchar DEFAULT 'medium' NOT NULL,
	"due_date" timestamp NOT NULL,
	"last_contact_date" timestamp,
	"notes" text,
	"assigned_to" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" integer PRIMARY KEY NOT NULL,
	"client_id" integer NOT NULL,
	"title" varchar NOT NULL,
	"description" text,
	"priority" varchar DEFAULT 'medium' NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"due_date" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fuel_advances" (
	"id" serial PRIMARY KEY NOT NULL,
	"carrier_name" varchar NOT NULL,
	"advance_amount" numeric(10, 2) NOT NULL,
	"advance_date" timestamp NOT NULL,
	"pickup_state" varchar(2) NOT NULL,
	"delivery_state" varchar(2) NOT NULL,
	"processed_by" varchar NOT NULL,
	"load_id" integer,
	"notes" text,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" integer PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"title" varchar NOT NULL,
	"message" text NOT NULL,
	"type" varchar DEFAULT 'info' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"entity_type" varchar,
	"entity_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"email" varchar NOT NULL,
	"subject" varchar NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar NOT NULL,
	"description" text,
	"type" varchar NOT NULL,
	"priority" varchar DEFAULT 'medium' NOT NULL,
	"status" varchar DEFAULT 'todo' NOT NULL,
	"due_date" timestamp,
	"client_id" integer,
	"assigned_to" varchar NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" integer PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"clock_in_time" timestamp NOT NULL,
	"clock_out_time" timestamp,
	"total_hours" numeric(4, 2),
	"status" varchar DEFAULT 'clocked_in' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "fuel_card_applications" ALTER COLUMN "id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "loads" ALTER COLUMN "id" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_type" varchar DEFAULT 'replit';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "location" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" varchar DEFAULT 'America/New_York';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "language" varchar DEFAULT 'en';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_notifications" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sms_notifications" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "desktop_notifications" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "start_time" varchar DEFAULT '09:00';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "end_time" varchar DEFAULT '17:00';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "work_days" varchar DEFAULT 'monday,tuesday,wednesday,thursday,friday';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "theme" varchar DEFAULT 'system';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "date_format" varchar DEFAULT 'MM/dd/yyyy';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "time_format" varchar DEFAULT '12h';--> statement-breakpoint
ALTER TABLE "client_vault" ADD CONSTRAINT "client_vault_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_vault" ADD CONSTRAINT "client_vault_last_accessed_by_users_id_fk" FOREIGN KEY ("last_accessed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_vault" ADD CONSTRAINT "client_vault_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_advances" ADD CONSTRAINT "fuel_advances_processed_by_users_id_fk" FOREIGN KEY ("processed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_advances" ADD CONSTRAINT "fuel_advances_load_id_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;