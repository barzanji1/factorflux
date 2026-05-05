# FactorFlux

FactorFlux is a freight factoring workflow application that streamlines invoice processing for freight companies.

## Run & Operate

*   **Run**: `npm run dev`
*   **Build**: `npm run build`
*   **Typecheck**: `npm run typecheck`
*   **Codegen**: `drizzle-kit generate`
*   **DB Push**: `drizzle-kit push:pg`
*   **Env Vars**: `DATABASE_URL`, `PORT`, `SESSION_SECRET`, `FMCSA_WEBKEY`, `FMCSA_CRON`, `SENDGRID_API_KEY`

## Stack

*   **Frontend**: React, TypeScript, Wouter, TanStack React Query, shadcn/ui, Tailwind CSS, Vite
*   **Backend**: Node.js, Express.js, TypeScript
*   **Database**: PostgreSQL (Neon Database), Drizzle ORM, Drizzle Kit
*   **Authentication**: Local (bcrypt, express-session)
*   **Validation**: Zod (schema validation), react-hook-form (form state management)

## Where things live

*   **Frontend Source**: `client/src/`
*   **Backend Source**: `server/src/`
*   **Database Schema**: `server/src/db/schema.ts`
*   **API Routes**: `server/src/routes/`
*   **UI Components**: `client/src/components/`
*   **Styling/Theme**: `client/src/index.css`, `tailwind.config.js`
*   **Document Extraction Logic**: `server/services/documentExtraction.ts` (hybrid PDF+OCR)
*   **Background Job Queue**: `server/services/jobQueue.ts` (retry, backoff, audit)
*   **Invoice Stage Management**: `server/src/services/invoiceStage.ts`
*   **FMCSA Integration**: `server/src/services/fmcsa.ts`, `server/src/services/authorityScheduler.ts`
*   **Document Rules**: `server/src/services/docValidation.ts`

## Architecture decisions

*   **ORM Choice**: Drizzle ORM was chosen for its type-safety and schema-first approach, leveraging TypeScript benefits directly in database interactions.
*   **Frontend State Management**: TanStack React Query is used for server state, clearly separating it from UI state and providing powerful caching, synchronization, and error handling.
*   **API Design**: A RESTful API pattern is consistently applied across the backend for predictable and standardized resource interaction.
*   **Session Management**: Express sessions with PostgreSQL storage are used for robust and scalable session persistence.
*   **Document Processing**: Hybrid pipeline — `pdf-parse` native extraction first; Tesseract.js OCR fallback for scanned/image PDFs; image files OCR directly. Background job queue (`jobQueue.ts`) keeps all heavy OCR off the request cycle with retry + exponential backoff.
*   **Document Classification**: Rule-based multi-signal scoring engine in `documentExtraction.ts` — 7 types (Rate Con, BOL, POD, Lumper, Invoice, Receipt, Other), confidence score, signal list. `candidateDocumentType` auto-set on extraction; `finalDocumentType` set by agent override via `PATCH /api/load-documents/:id/document-type`.
*   **Field Extraction**: 16 named fields (amount, load#, invoice#, reference#, broker, carrier, MC/DOT, pickup/delivery location+date, BOL#, lumper amount, POD signature) saved to `doc_field_candidates` with confidence and source snippet.
*   **Unified Workflow Model**: An 8-stage factoring lifecycle is implemented with `factoringStage` field on `invoices`, driving auto-advancement and providing a comprehensive invoice timeline.

## Product

*   **Invoice Processing**: End-to-end management of freight invoices from intake to final settlement.
*   **Document Management**: Secure upload (drag-and-drop), categorization, OCR-based data extraction, and viewing.
*   **Client & Broker Management**: Comprehensive client and broker profiles, credit checks, and FMCSA authority monitoring.
*   **Financial Operations**: Cash application, exception management, and detailed payout tracking.
*   **User & Role Management**: Secure authentication, role-based access control (employee, manager, admin), and audit logging.
*   **Workflow Customization**: Configurable factoring pipeline with stages, SLAs, and notification settings.
*   **Communication**: Direct messaging to clients/carriers via email.
*   **Time Tracking**: Employee clock-in/out functionality.
*   **Reporting**: Integration with TPF forms for dynamic reports.
*   **Desktop Distribution**: Native desktop installers for Windows, Mac, and Linux.

## User preferences

Preferred communication style: Simple, everyday language.

## Gotchas

*   **Database Migrations**: Always run `drizzle-kit generate` and `drizzle-kit push:pg` after schema changes to keep the database in sync.
*   **FMCSA Webkey**: The `FMCSA_WEBKEY` environment variable is required for FMCSA authority checks; without it, the service operates in a graceful `no_key` mode.
*   **Document Approval Lock**: Invoices will not advance past specific stages if required documents (as per configured `documentRules`) are missing.
*   **Workflow Builder Changes**: Changes in the Workflow Builder are auto-saved to `localStorage` but require an explicit "Save" button click to commit to the backend.

## Pointers

*   **React Query Docs**: [https://tanstack.com/query/latest/docs/react/overview](https://tanstack.com/query/latest/docs/react/overview)
*   **Drizzle ORM Docs**: [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
*   **Tailwind CSS Docs**: [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
*   **shadcn/ui Docs**: [https://ui.shadcn.com/docs](https://ui.shadcn.com/docs)
*   **FMCSA SAFER API Docs**: [https://fmcsa.dot.gov/developer/qcapi](https://fmcsa.dot.gov/developer/qcapi)