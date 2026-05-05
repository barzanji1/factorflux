# FactorFlux - Invoice Processing System

## Overview
FactorFlux is a comprehensive freight factoring workflow application designed to streamline invoice processing for freight companies through Trucking Pros Financial. It provides document management, client management, invoice tracking, user authentication, and a modern web interface. The system aims to enhance efficiency and provide a robust platform for financial operations in the trucking industry.

## User Preferences
Preferred communication style: Simple, everyday language.

## Recent Changes
- **May 5, 2026**: Workflow Builder page added (`/workflow-builder`) — drag-and-drop pipeline customization
  - Native HTML5 drag-and-drop to reorder all 8 factoring stages without any extra library
  - Per-stage configuration panel: SLA hours, auto-advance trigger condition, manager-gated toggle, entry/exit notifications, internal notes
  - Live pipeline preview showing enabled stages in flow order with auto-advance and gate indicators
  - Enable/disable individual stages (disabled stages are skipped in the pipeline)
  - Changes auto-save to localStorage; explicit Save button required to commit; Reset to defaults dialog
  - Read-only mode for employees; full edit access for managers and admins
  - Linked from sidebar under Admin → "Pipeline Builder" (manager/admin only)
  - Document rules integration: shows required docs for review/approval stages inline when expanded
- **May 5, 2026**: Queue-first operations UI refactor — all three core operations pages rebuilt as work queues
  - **`factoring.tsx`** — 7 queue-state tabs (All/New/Docs Pending/Under Review/Approved/Funded/Held), sticky filter bar, bulk actions, aging badges (`AgeBadge`), fast row actions via `POST /api/invoices/:id/transition`, reason dialog for reject/request_docs, pipeline summary strip
  - **`collections.tsx`** — 6 queue tabs incl. Overdue pseudo-tab, priority-sorted dense table, bulk status updates, `OverduePill` aging indicator, create/edit dialog preserved, footer totals
  - **`exceptions.tsx`** — Converted card-list → dense table, checkbox + bulk resolve/waive/review, aging column, severity left-border indicator (`border-l-[3px]`), `AgeBadge`, sticky filter bar retained
  - All three pages use `useStickyState` hook (sessionStorage) to persist active queue tab across navigations
  - All three pages use `ff-data-table` CSS class and `FFBadge`/`ff-badge-*` design system tokens
- **May 5, 2026**: Unified load-to-cash model implemented — full 8-stage factoring lifecycle wired across all modules
  - **`factoringStage` field added to `invoices`** — 8-stage enum: `document_intake → verification → approval → advance → collections → payment_receipt → reconciliation → final_settlement`; DB schema pushed
  - **`invoiceId` FK added to `collections`** — collections now link to a specific invoice (set null on delete) enabling per-invoice collection queries
  - **Stage service** (`server/services/invoiceStage.ts`): `STAGE_META` definitions, `stageFromInvoiceStatus()` mapping, `advanceInvoiceStage()` (forward-only, writes to `eventLedger`), `getInvoiceDetail()` (invoice + all related records), `getInvoiceTimeline()` (merged events from 7 sources sorted by timestamp)
  - **Auto-advancement hooks** wired into existing routes: invoice status PUT → deriveStage; invoice approve → "approval"; payout POST → "advance"; payout PATCH advance_paid → "collections", reserve_pending/released → "reconciliation", complete → "final_settlement"; cash-app apply → "payment_receipt" for each affected invoice
  - **New API endpoints**: `GET /api/invoices/:id/detail` (full record with client, debtor, payout, docs, collections, cashAppLines, exceptions, statusHistory); `GET /api/invoices/:id/timeline` (unified event stream)
  - **Invoice Detail page** (`/invoices/:id`, `client/src/pages/invoice-detail.tsx`): 8-step stage pipeline with connector line + step numbers, header card with quick stats (advance/fee/reserve/doc count), 7-tab layout (Overview | Documents | Payout | Collections | Cash Application | Exceptions | Timeline), timeline with color-coded event type icons, deep-links to existing module pages
  - **Invoices list** updated: ChevronRight action button on each row navigates to `/invoices/:id` detail page
- **May 4, 2026 (2)**: FMCSA daily broker authority check system added
  - **FMCSA Authority page** (`/fmcsa-authority`): Admin dashboard with status table (color-coded Active/Inactive/Not Found), stat cards, history drill-down per entity, alerts panel with resolve workflow, and FMCSA web key configuration UI
  - **FMCSA service** (`server/services/fmcsa.ts`): Wraps FMCSA SAFER REST API — query by DOT or MC number, parses `commonAuthorityStatus`, `brokerAuthorityStatus`, `allowedToOperate`, graceful `no_key` mode when `FMCSA_WEBKEY` is unset
  - **Authority scheduler** (`server/services/authorityScheduler.ts`): `node-cron` daily job (06:00 UTC, configurable via `FMCSA_CRON`), diffs each check against the previous result, auto-creates `broker_authority_alerts` on status changes, inactive/revoked detections, or disappearing records
  - **New DB tables**: `broker_authority_checks` (full FMCSA response per entity per check), `broker_authority_alerts` (change events with previous/new status, field, resolve workflow)
  - **API endpoints**: `GET /api/authority-checks/latest`, `GET /api/authority-checks/history`, `POST /api/authority-checks/run` (admin — manual trigger), `POST /api/authority-checks/configure-key` (admin — set webkey), `GET /api/authority-alerts`, `PATCH /api/authority-alerts/:id/resolve`
  - **Sidebar**: "FMCSA Authority" added to Risk & Compliance section
  - **Env var**: `FMCSA_WEBKEY` — FMCSA developer web key (get from fmcsa.dot.gov/developer/qcapi); `FMCSA_CRON` — optional cron override
- **May 4, 2026**: Broker credit checking, audit logging, ACH payment settings, cash application/reconciliation, and exception management built
  - **Credit Checks** (`/credit-checks`): Full rewrite with real DB — assess debtors/brokers with risk scores (0–100), visual score bar, risk tiers (Low/Medium/High/Critical), credit limits, avg days-to-pay, one-click Approve/Decline/Re-review workflow
  - **Cash Application** (`/cash-application`): Record incoming ACH/wire/check payments, match them to invoices with short-pay/overpay variance detection, auto-creates exceptions on discrepancies, status tracks unapplied → partially → fully applied → overpaid
  - **Exception Management** (`/exceptions`): Exception queue with severity tiers (Low/Medium/High/Critical), type-tagged (short pay, overpay, doc missing, credit limit, duplicate, unapplied payment), status workflow (Open → Under Review → Resolved/Waived), resolve dialog with notes
  - **Audit Log** (`/audit-log`): Unified timeline combining eventLedger + invoice status history, filterable by entity type and actor (user/system), search, refresh, timeAgo display
  - **ACH Settings**: GET/PUT `/api/ach-settings/:clientId` and verify endpoint for manager sign-off
  - **New schema tables**: `credit_checks`, `ach_settings`, `cash_applications`, `payment_application_lines`, `exceptions`
  - **New sidebar section**: "Risk & Compliance" with Credit Checks, Exceptions, Audit Log; Cash Application added to Finance section
  - **Debtors API** now exposed: GET/POST/PATCH/DELETE `/api/debtors`
- **April 28, 2026**: Client Messaging System implemented — agents can email clients/carriers directly from the Help Center Contact tab. Includes SendGrid delivery via Support@Truckingprosfinancial.com, client_messages table for audit logging (id, clientId, sentBy, subject, messageType, body, sentAt, status), GET /api/messages?clientId= and POST /api/messages/send routes, sent messages history log per client. Contact cards fixed (Primary Contact/Dosh Barzanji, Support Email, Emergency Line — no duplicates).
- **April 28, 2026**: Vault feature fully debugged and operational — AES-256-GCM server-side encryption, auto-increment sequence added directly via SQL, Drizzle alias() fix for double leftJoin, route order fixed (entry/:id before :clientId wildcard), frontend rewritten to send plaintext to server.
- **August 22, 2025**: Complete production authentication system implemented and time clock feature fully operational
- Secure login page with professional design and form validation
- Session-based authentication using express-session with bcrypt password hashing
- Three production user accounts: agent1, manager1, admin1 (password: tpf2025!)
- All application routes protected - authentication required for access
- AuthProvider context properly managing authentication state
- Logout functionality in user profile dropdown menu
- Enhanced authentication flow with proper session cookie handling
- Fixed race condition issues between login success and route protection
- Hard redirect after login to ensure proper state synchronization
- Time clock feature debugged and operational with proper database user records
- Production users (prod-1, prod-2, prod-3) created in database for time tracking functionality
- Authentication middleware properly applied to all time tracking endpoints
- **August 21, 2025**: Successfully implemented micro-interactions for form validation
- Created FormFieldWithValidation component with real-time animated feedback
- Built AnimatedButton with loading, success states, and smooth transitions  
- Developed useFormValidation hook with debounced validation and async support
- Updated local login page with new micro-interaction components
- Added comprehensive demo page at /form-demo showcasing all validation features

Layout preference: Modern dashboard with sidebar navigation (Dashboard, Clients, Invoices, Docs, Reports), top navigation bar (User menu, Notifications), and main content area with Invoice Summary, Load Details, Upload Zone, and Recent Activity/Payment Status sections.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Routing**: Wouter for client-side routing
- **State Management**: TanStack React Query for server state management
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens and CSS variables
- **Build Tool**: Vite

### Backend Architecture
- **Runtime**: Node.js with Express.js server
- **Language**: TypeScript with ES modules
- **API Pattern**: RESTful API design
- **Authentication**: Local authentication with bcrypt password hashing
- **Session Management**: Express sessions with PostgreSQL storage
- **File Handling**: Multer for document uploads with file type validation

### Database Architecture
- **Database**: PostgreSQL (configured for Neon Database)
- **ORM**: Drizzle ORM with schema-first approach
- **Migrations**: Drizzle Kit for database migrations
- **Connection**: Connection pooling with @neondatabase/serverless

### Key Features and System Design
- **Authentication System**: Local authentication system with session-based authentication, role-based access control (employee/manager/admin roles), secure password hashing with bcrypt, and automatic redirect handling.
- **Data Models**: Users, Clients, Loads, Invoices, Documents, Activities for comprehensive data management.
- **File Upload System**: Multer-based, with size limits (10MB) and file type validation (PDF, JPEG, JPG, PNG), supporting specific document categorization (rate confirmations, bills of lading, driver IDs, carrier setup).
- **API Structure**: RESTful endpoints for CRUD, search, dashboard statistics, and file uploads.
- **Workflow & Data Flow**: User authentication, secure document upload via drag-and-drop, client management with form validation (react-hook-form, Zod), invoice processing, dashboard updates with real-time statistics, and automatic activity logging.
- **Branding**: Integrated Trucking Pros Financial logo and branding elements across the application, including a personalized dashboard message.
- **Notification System**: Real-time, comprehensive notification system with database storage, API endpoints, and automatic notification creation for key system activities.
- **Document Viewing**: Secure document access and viewing functionality from various application points.
- **Badge Visibility**: Enhanced high-contrast badge styling for status indicators across the application.
- **Desktop Distribution**: Provides native desktop application installers for Windows, Mac, and Linux, leveraging browser launchers for reliability and email distribution for clients.
- **Portfolio Integration**: A professional portfolio website showcasing development expertise is integrated into the application's sidebar.
- **User Settings & Profile**: Comprehensive settings page with personal, notification, work, and appearance preferences, including a full theme system (Light/Dark/System). Profile page displays user name and job title.
- **Admin Role Management**: Admin panel for managers to manage user roles with audit trails.
- **Unified Fuel Card Services**: Consolidated fuel card management system combining customer applications with agent tools in a single interface. Features complimentary tiers (Base, Fleet, Premium), streamlined application forms, admin review portal, analytics dashboard, and integrated communication tools.
- **Global Search**: Comprehensive search functionality across clients, invoices, and loads.
- **Document Management**: Separate tabbed upload interfaces for different document types and document deletion functionality.
- **Time Tracking**: Employee time clock functionality with clock-in/out, duration tracking, and activity logging.
- **Navigation**: Standardized navigation using TopNav component across all pages, including a consistent Home button for quick dashboard access and streamlined settings menu access. Consolidated fuel card functionality into single "TPF Fuel Cards" tab with four main sections: Overview, Fuel Cards, Applications, and Analytics.
- **Activity Log Management**: Option to reset activity history.
- **TPF Form Integration**: Embedded form system from Trucking Pros Financial integrated within the Reports tab enabling direct integration of WordPress forms within FactorFlux interface with dynamic loading and error handling, plus backup native form implementation.
- **Document-to-Approval Rules**: Configurable required-document checklist with `documentRules` and `invoiceDocReviews` DB tables, `docValidation` service, per-invoice completeness tracking, missing-document warnings, approval lock via lifecycle engine guards, reviewer notes for managers. `/document-rules` admin page (manager/admin), `Doc Checklist` tab on every invoice detail, DB-seeded defaults (Rate Confirmation + BOL for review; Invoice + POD for approval).

## External Dependencies

### Core Dependencies
- **@neondatabase/serverless**: PostgreSQL database connectivity
- **drizzle-orm**: Type-safe database operations
- **express**: Web server framework
- **passport**: Authentication middleware
- **multer**: File upload handling
- **react-query**: Server state synchronization

### UI Dependencies
- **@radix-ui/***: Headless UI component primitives
- **tailwindcss**: Utility-first CSS framework
- **wouter**: Lightweight React routing
- **react-hook-form**: Form state management
- **zod**: Schema validation

### Development Dependencies
- **vite**: Build tool and development server
- **typescript**: Type checking
- **tsx**: TypeScript execution for development