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