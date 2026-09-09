CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_name_idx" ON "clients" USING btree ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brokers_name_idx" ON "brokers" USING btree ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_invoice_number_idx" ON "invoices" USING btree ("invoice_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_client_id_idx" ON "invoices" USING btree ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_created_at_idx" ON "invoices" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_submitted_by_created_at_idx" ON "invoices" USING btree ("submitted_by", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_search_trgm_idx" ON "clients" USING gin ((
	coalesce("name", '') || ' ' ||
	coalesce("preferred_name", '') || ' ' ||
	coalesce("email", '') || ' ' ||
	coalesce("phone", '') || ' ' ||
	coalesce("contact_person", '') || ' ' ||
	coalesce("city", '') || ' ' ||
	coalesce("state", '') || ' ' ||
	coalesce("mc_number", '') || ' ' ||
	coalesce("dot_number", '')
) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brokers_search_trgm_idx" ON "brokers" USING gin ((
	coalesce("name", '') || ' ' ||
	coalesce("contact_person", '') || ' ' ||
	coalesce("email", '') || ' ' ||
	coalesce("phone", '') || ' ' ||
	coalesce("address", '') || ' ' ||
	coalesce("city", '') || ' ' ||
	coalesce("state", '') || ' ' ||
	coalesce("mc_number", '') || ' ' ||
	coalesce("dot_number", '') || ' ' ||
	coalesce("notes", '')
) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_search_trgm_idx" ON "invoices" USING gin ((
	coalesce("invoice_number", '') || ' ' ||
	coalesce("load_number", '') || ' ' ||
	coalesce("branch_name", '') || ' ' ||
	coalesce("bol_number", '') || ' ' ||
	coalesce("status", '')
) gin_trgm_ops);