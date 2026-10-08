# FactorFlux

FactorFlux is a freight factoring workflow application that streamlines invoice processing for freight companies.

## Run & Operate

*   **Run**: `npm run dev`
*   **Build**: `npm run build`
*   **Typecheck**: `npm run typecheck`
*   **DB Push**: `npm run db:push`
*   **Seed Demo Data**: `POST /api/admin/seed-demo` (admin auth required, idempotent)
*   **Env Vars**: `NEON_DATABASE_URL`, `PORT`, `SESSION_SECRET`, `FMCSA_WEBKEY`, `FMCSA_CRON`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
*   **OCR Provider**: `EXTRACTION_PROVIDER=hybrid` (default) | `native_pdf` | `tesseract_ocr`
*   **File Storage**: S3 bucket `factorflux-documents-tpf` (region `us-east-2`). New uploads go to S3 only; legacy local files in `uploads/` still served as fallback. S3 service: `server/services/s3Service.ts`.

## Stack

*   **Frontend**: React, TypeScript, Wouter, TanStack React Query, shadcn/ui, Tailwind CSS, Vite
*   **Backend**: Node.js, Express.js, TypeScript
*   **Database**: PostgreSQL (Neon Database), Drizzle ORM, Drizzle Kit
*   **Authentication**: Local (bcrypt, express-session)
*   **Validation**: Zod (schema validation), react-hook-form (form state management)

## Where things live

*   **Frontend Source**: `client/src/`
*   **Backend Source**: `server/`
*   **Database Schema**: `shared/schema.ts`
*   **API Routes**: `server/routes.ts`
*   **UI Components**: `client/src/components/`
*   **Styling/Theme**: `client/src/index.css`, `tailwind.config.js`
*   **OCR Provider Abstraction**: `server/services/ocr/` — `types.ts`, `nativePdfProvider.ts`, `tesseractProvider.ts`, `hybridProvider.ts`, `registry.ts`
*   **Document Extraction**: `server/services/documentExtraction.ts` (uses provider from registry)
*   **Background Job Queue**: `server/services/jobQueue.ts` (retry, backoff, audit)
*   **Invoice Stage Management**: `server/services/invoiceStage.ts`
*   **FMCSA Integration**: `server/services/fmcsa/`, `server/services/authorityScheduler.ts`
*   **Document Rules**: `server/services/docValidation.ts`
*   **Demo Seed**: `server/services/demoSeed.ts`

## Architecture decisions

*   **ORM Choice**: Drizzle ORM for type-safety and schema-first approach.
*   **Frontend State Management**: TanStack React Query for server state — caching, sync, error handling.
*   **API Design**: RESTful pattern consistently applied.
*   **Session Management**: Express sessions with PostgreSQL storage.
*   **OCR Provider Abstraction**: `ExtractionProvider` interface in `server/services/ocr/types.ts`. Three built-in providers (`native_pdf`, `tesseract_ocr`, `hybrid`). Config-driven via `EXTRACTION_PROVIDER` env var. Adding a new provider (e.g. Google Document AI) requires only a new file + one registry entry — no UI or route changes.
*   **Document Processing**: Hybrid pipeline — native pdf-parse first; Tesseract.js OCR fallback for scanned/image PDFs. Background job queue keeps OCR off the request cycle with retry + exponential backoff. Provider key written to `doc_extraction_jobs.parser_name` for audit traceability.
*   **Document Classification**: Two-pass AI-powered pipeline. Pass 1: enhanced rule-based multi-signal scoring (7 types, expanded vocabulary, structural signals). Pass 2: OpenAI GPT-4o-mini via `OPENAI_API_KEY` env var (graceful fallback to enhanced rules if key absent). Both passes return all-type score breakdowns stored in `documents.allClassificationScores` (jsonb). Best result (highest confidence) wins and is stored as `candidateDocumentType`. Agent override sets `finalDocumentType` and marks `classificationSource = agent`. On-demand re-classify: `POST /api/load-documents/:id/ai-classify`.
*   **Field Extraction**: 16 named fields saved to `doc_field_candidates` with confidence and source snippet.
*   **Unified Workflow Model**: 8-stage factoring lifecycle on `invoices.factoring_stage`, driving auto-advancement.

## Product

*   **Invoice Processing**: End-to-end management from intake to final settlement.
*   **Document Management**: Secure upload, categorization, OCR extraction, side-by-side review dialog. Each document shows a rich `ClassificationPanel` — confidence meter, all-types score bars, matched signal badges, AI/Rules/Agent source badge, Re-classify button.
*   **Document Review Panel**: Per-doc Review/Re-review button in invoice detail; Confirm/Reject/Unreadable/Retry actions; confidence warnings; saves to `doc_reviews`; updates `documents.documentType` to trigger lifecycle guards.
*   **Client & Broker Management**: Profiles, credit checks, FMCSA authority monitoring.
*   **Financial Operations**: Cash application, exception management, payout tracking with doc readiness indicator.
*   **User & Role Management**: Auth, RBAC (employee/manager/admin), audit logging.
*   **Fuel Advance Tracking**: Full CRUD for carrier fuel advances with state, agent, and load tracking.
*   **Communication**: Resend is the only email transport. All system, client, and installer email goes through `server/resendTransport.js`; never add a direct provider send elsewhere.
*   **Time Tracking**: Employee clock-in/out.

## User preferences

Preferred communication style: Simple, everyday language.

## Gotchas

*   **Database Migrations**: Run `npm run db:push` after schema changes.
*   **FMCSA Webkey**: `FMCSA_WEBKEY` required for authority checks; graceful `no_key` mode without it.
*   **Document Approval Lock**: Invoices won't advance past stages if required docs are missing per `documentRules`.
*   **Workflow Builder Changes**: Auto-saved to `localStorage`; requires explicit Save to commit to backend.
*   **Demo Seed Guard**: `seedDemoData()` checks for load `DEMO-2024-001` before inserting — safe to call repeatedly.
*   **loads.id**: The `loads` table uses `integer("id").primaryKey()` (not serial) — must specify id on insert.

## Pointers

*   **React Query Docs**: https://tanstack.com/query/latest/docs/react/overview
*   **Drizzle ORM Docs**: https://orm.drizzle.team/docs/overview
*   **Tailwind CSS Docs**: https://tailwindcss.com/docs
*   **shadcn/ui Docs**: https://ui.shadcn.com/docs
*   **FMCSA SAFER API Docs**: https://fmcsa.dot.gov/developer/qcapi
