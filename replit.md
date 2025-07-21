# EllaFlow - Invoice Processing System

## Overview

EllaFlow is a comprehensive freight factoring workflow application designed to streamline invoice processing for freight companies. The system provides document management, client management, invoice tracking, and user authentication capabilities through a modern web interface.

## User Preferences

Preferred communication style: Simple, everyday language.

Layout preference: Modern dashboard with sidebar navigation (Dashboard, Clients, Invoices, Docs, Reports), top navigation bar (User menu, Notifications), and main content area with Invoice Summary, Load Details, Upload Zone, and Recent Activity/Payment Status sections.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Routing**: Wouter for client-side routing
- **State Management**: TanStack React Query for server state management
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens and CSS variables
- **Build Tool**: Vite with custom configuration for development and production

### Backend Architecture
- **Runtime**: Node.js with Express.js server
- **Language**: TypeScript with ES modules
- **API Pattern**: RESTful API design
- **Authentication**: Replit Auth with OpenID Connect integration
- **Session Management**: Express sessions with PostgreSQL storage
- **File Handling**: Multer for document uploads with file type validation

### Database Architecture
- **Database**: PostgreSQL (configured for Neon Database)
- **ORM**: Drizzle ORM with schema-first approach
- **Migrations**: Drizzle Kit for database migrations
- **Connection**: Connection pooling with @neondatabase/serverless

## Key Components

### Authentication System
- Replit Auth integration with OpenID Connect
- Session-based authentication with PostgreSQL session store
- Role-based access control (employee/manager roles)
- Automatic redirect handling for unauthorized users

### Data Models
- **Users**: Authentication and profile management
- **Clients**: Customer information and contact details
- **Loads**: Freight load tracking with origin/destination
- **Invoices**: Invoice management with status tracking
- **Documents**: File upload and document management system
- **Activities**: Audit trail and activity logging

### File Upload System
- Multer-based file handling with size limits (10MB)
- File type validation (PDF, JPEG, JPG, PNG)
- Document categorization (rate confirmations, bills of lading, driver IDs, carrier setup)

### API Structure
- RESTful endpoints for CRUD operations
- Search functionality for clients and invoices
- Dashboard statistics and metrics endpoints
- File upload endpoints with validation
- Authentication middleware protection

## Data Flow

1. **User Authentication**: Users authenticate via Replit Auth, sessions stored in PostgreSQL
2. **Document Upload**: Files uploaded via drag-and-drop interface, processed by Multer middleware
3. **Client Management**: Client data managed through forms with validation using react-hook-form and Zod
4. **Invoice Processing**: Invoice creation linked to loads and clients with status tracking
5. **Dashboard Updates**: Real-time statistics computed from database queries
6. **Activity Logging**: User actions automatically logged for audit trails

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

## Deployment Strategy

### Development Mode
- Vite dev server with HMR for frontend development
- tsx for running TypeScript backend with automatic restarts
- Database migrations handled through Drizzle Kit
- Environment variables for database and authentication configuration

### Production Build
- Vite builds frontend assets to `dist/public`
- esbuild bundles server code to `dist/index.js`
- Static file serving integrated with Express
- Session storage and authentication configured for production domains

### Database Management
- Schema defined in TypeScript with Drizzle ORM
- Migrations generated and applied through Drizzle Kit
- Database provisioning expected through environment variables
- Connection pooling configured for serverless environments

The system is designed as a full-stack application with clear separation between frontend React components and backend Express API, unified through shared TypeScript schemas for type safety across the entire application.

## Recent Changes

### January 21, 2025
- **TPF Fuel Card Services**: Implemented comprehensive fuel card application system with three complimentary tiers
  - Created TPF Base, Fleet, and Premium cards with escalating benefits (2¢, 4¢, 6¢ per gallon discounts)
  - Removed monthly fees to make all cards complimentary services for TPF carriers
  - Added comprehensive application form with company details, fleet size, and fuel spend tracking
  - Integrated fuel card navigation with dedicated page and status tracking
  - Implemented backend API for application management and activity logging
  - Added Fuel Card Admin page for managers to review, approve/reject applications
  - Created Document Viewer component for viewing uploaded documents associated with applications
  - Added application status tracking with detailed review capabilities and notes system
- **Global Search Implementation**: Successfully implemented comprehensive search functionality across the entire system
  - Created global `/api/search` endpoint that searches clients, invoices, and loads simultaneously
  - Added `searchLoads` method to storage interface with proper field references (pickupLocation/deliveryLocation)
  - Enhanced TopNav with interactive search dropdown showing categorized results with icons
  - Fixed query parameter handling to properly send search terms instead of object references
  - Added test data (clients, loads, invoices) for search functionality validation
  - Search activates after 3 characters and displays results in organized sections
- **Document Upload Separation**: Implemented separate document upload tabs for Rate Confirmations, Bills of Lading, and Driver Documents
  - Created tabbed interface in Documents page with individual upload zones for each document type
  - Modified DocumentUpload component to accept documentType parameter for specialized handling
  - Added document type filtering and categorization logic
  - Enhanced upload workflow with type-specific instructions and labels
- **Fixed Navigation Issues**: Resolved 404 errors for Activities and Reports pages
  - Created comprehensive Activities page with detailed activity tracking
  - Implemented Reports & Analytics page with business KPIs and metrics
  - Added proper routing for all navigation links
- **Fixed Quick Actions Functionality**: Updated Quick Actions to use proper navigation instead of console logging
  - Dashboard Quick Actions now navigate to appropriate pages (Invoices, Clients, Reports, Documents)
  - TopNav Quick Actions dropdown now uses real navigation instead of console.log
  - Enhanced Quick Actions UI with better icons, colors, and descriptions
  - Fixed upload field name from 'document' to 'file' to resolve MulterError
- **Activity Log Document Viewing**: Fixed document viewing functionality in activity log
  - Added "View Documents" button for document-related activities (document uploads, etc.)
  - Integrated DocumentViewer component with activity entries
  - Enhanced activity log with clickable document access for better audit trail functionality
  - Resolved issue where uploaded documents in activity log were not viewable
- **Document Management Enhancements**: Added document deletion functionality
  - Added delete button to DocumentViewer component with confirmation dialog
  - Implemented DELETE endpoint for removing documents from the system
  - Added activity logging for document deletion actions
  - Enhanced document management with complete CRUD operations (Create, Read, Update, Delete)
  - Fixed fuel card application document viewing integration