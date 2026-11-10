-- These indexes are declared in shared/schema.ts but were absent from the
-- configured application database. Run outside a transaction to avoid blocking
-- ordinary directory reads/writes while the indexes are constructed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS clients_name_idx ON public.clients (name);
CREATE INDEX CONCURRENTLY IF NOT EXISTS brokers_name_idx ON public.brokers (name);
