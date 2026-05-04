# FactorFlux - Invoice Processing System

## Overview
FactorFlux is a comprehensive freight factoring workflow application designed to streamline invoice processing for freight companies through Trucking Pros Financial. It provides document management, client management, invoice tracking, user authentication, and a modern web interface. The system aims to enhance efficiency and provide a robust platform for financial operations in the trucking industry.

## User Preferences
Preferred communication style: Simple, everyday language.

## Recent Changes
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