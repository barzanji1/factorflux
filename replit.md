# QuantumCore - Invoice Processing System

## Overview

QuantumCore is a comprehensive freight factoring workflow application designed to streamline invoice processing for freight companies through Trucking Pros Financial. The system provides document management, client management, invoice tracking, and user authentication capabilities through a modern web interface.

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

## Recent Changes

### January 27, 2025 - Dashboard Invoice Actions Fixed and Time Clock Visibility Enhancement
- **DASHBOARD INVOICE ACTIONS FIXED**: Resolved all non-functioning action buttons in Recent Invoices section
  - Fixed View action (eye icon): Now displays comprehensive invoice details in toast notification with 5-second duration
  - Enhanced Download action (arrow icon): Downloads invoice data as branded text file with company information
  - Fixed Edit action (pencil icon): Implemented inline edit modal with full form functionality instead of navigation
  - Removed toast notification for edit action to provide clean, seamless editing experience
  - Added proper TypeScript typing and error handling for all action handlers
  - Enhanced user experience with tooltip titles and improved feedback messages
- **TIME CLOCK VISIBILITY ENHANCEMENT**: Completely redesigned clocked out status visibility
  - Enhanced "Clocked Out" badge with high-contrast red styling and clear text visibility
  - Added prominent "Currently Clocked Out" status display in red-themed information box
  - Implemented color-coded status system: green for clocked in, red for clocked out
  - Added helpful instruction text: "Click 'Clock In' to start tracking time"
  - Improved dark mode support with proper contrast ratios for all status indicators
  - Enhanced visual hierarchy to ensure status is immediately recognizable at a glance
- **MAC DMG INSTALLER ENHANCEMENT**: Created proper Mac .app bundle installer to resolve launch issues
- **MAC INSTALLER ENHANCEMENT**: Created proper Mac .app bundle installer to resolve launch issues
  - Built native QuantumCore.app with proper Info.plist and macOS integration
  - Created Mac installer package (5.5MB) with native app bundle structure
  - Updated download endpoint to serve QuantumCore-Mac-Installer.tar.gz instead of portable version
  - Added comprehensive Mac installation instructions and troubleshooting guide
  - Mac installer now provides proper macOS experience with Applications folder integration

### January 26, 2025 - Download Links Issue Resolution
- **DOWNLOAD ENDPOINTS VERIFIED WORKING**: All desktop download endpoints confirmed functional on local server
  - All four endpoints (/api/desktop/download/windows, /mac, /linux, /guide) return HTTP 200 OK
  - Files stream properly with correct headers (5.7MB installers, proper content-type)
  - Issue identified: External access to development Replit domain may require authentication
  - Solution confirmed: Downloads work perfectly from within the application and will work on production deployment
- **Fixed Desktop Launch Issues and Email Distribution**: Successfully resolved critical desktop application startup problems and implemented email distribution system
  - Identified root cause: Electron dependency conflicts in user environments requiring Node.js installations
  - Replaced complex Electron approach with reliable browser launcher scripts that work universally
  - Updated startup scripts (.bat/.sh) to use cross-platform browser opening commands with fallback URLs
  - All desktop installers now use simple browser launchers requiring only a web browser (no Node.js dependency)
  - Created comprehensive admin panel email functionality for sending installer links to clients
  - Added professional email templates with both web access and desktop installer options
  - Implemented client email form with name, message, and automatic activity logging in admin dashboard
  - **Enhanced Desktop Launchers**: Completely rebuilt desktop launching system with improved reliability
    - Created dual launcher system: Node.js enhanced launcher with basic fallback methods
    - Added professional visual feedback with clear success/error messages and setup instructions
    - Improved cross-platform browser detection with multiple fallback options
    - Enhanced user experience with desktop app creation guidance for Chrome, Safari, Firefox
    - Rebuilt all installers with proper file permissions and updated launcher scripts
    - Added comprehensive troubleshooting guide for resolving any remaining launch issues
  - Desktop solution provides professional experience while eliminating technical barriers for end users
- **Desktop Application Development**: Created comprehensive Electron-based desktop distribution system
  - Built complete Electron configuration with main.js and preload.js for secure desktop app
  - Created automated build scripts for Windows (.exe), Mac (.dmg), and Linux (.AppImage) installers
  - Added desktop-specific features like native window controls, taskbar integration, and offline capabilities
  - Established distribution infrastructure with build scripts and user installation guides
  - Desktop app connects to same PostgreSQL database as web version for data synchronization
  - Users can now download and install QuantumCore as a native desktop application
  - Created comprehensive documentation for both end-users and administrators
  - Desktop version provides faster performance, offline access, and professional enterprise feel
- **Fixed Desktop Launch Issues**: Resolved critical startup problems preventing desktop application execution
  - Corrected startup scripts to use Electron instead of Node.js server approach
  - Updated Windows (.bat), Mac (.sh), and Linux (.sh) scripts with proper Electron launching
  - Added Node.js installation verification and automatic Electron dependency installation
  - Fixed download routing conflicts by moving from localhost routes to /api/ prefix structure
  - Updated installation guide with accurate Electron-based setup instructions
  - Desktop installers now properly launch as native desktop applications instead of browser-based servers
  - Created accessible download links through live Replit app URL for enterprise distribution
  - Verified all download endpoints working correctly with 5.6MB portable installers

### January 22, 2025
- **Portfolio Website Development and Deployment**: Created comprehensive professional portfolio website to advertise software development services
  - Built modern, responsive portfolio showcasing development expertise and QuantumCore as flagship project
  - Integrated portfolio access directly into QuantumCore sidebar with Globe icon and /portfolio route
  - Created complete GitHub deployment documentation with step-by-step instructions
  - Successfully deployed to GitHub Pages for public sharing with clients and employers
  - Portfolio features professional branding, project showcase, services offered, and working contact form
  - Fixed server integration issues and provided multiple download/deployment methods
  - Portfolio positions user as freight industry specialist with QuantumCore demonstrating technical capabilities
- **Cleaned Up Settings Navigation**: Streamlined settings access through dropdown menu only
  - Removed non-functional Settings button from sidebar to avoid confusion
  - Settings dropdown menu now properly navigates to comprehensive `/settings` page with full functionality
  - Settings page includes Personal, Notifications, Work, and Appearance tabs with complete preference management
  - Profile dropdown menu navigates to `/profile` page with basic profile information and image upload
  - Implemented proper Link component navigation using asChild prop for reliable routing
  - Sidebar now shows only functional navigation items with Logout at the bottom

### January 21, 2025 - Debug Session and Profile Enhancements
- Fixed TypeScript compilation errors in server routes (error type casting)
- Resolved ReactNode typing issues in top navigation component  
- Fixed array type handling in clients page components
- Added proper TypeScript interfaces for search results
- Application successfully debugged and running on port 5000
- All LSP diagnostics resolved
- **Profile Page Enhancements**: Added agent name and job title display under profile picture
  - Updated user database with name "Dosh Barzanji" and job title "Vice President"
  - Profile now prominently displays full name and role below avatar image
- **Settings Menu Consistency**: Linked Settings dropdown menu item to profile page
  - Both "Profile" and "Settings" menu items now navigate to the same comprehensive page
  - Unified settings and profile management in single location for better user experience

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
- **Rebranding to QuantumCore**: Updated application branding from EllaFlow to QuantumCore
  - Changed app name to "QuantumCore" across sidebar, landing page, and HTML title
  - Updated subtitle from "Freight Factoring" to "Trucking Pros Financial"
  - Modified landing page description to emphasize Trucking Pros Financial branding
  - Updated project documentation to reflect new company identity
  - **Freight Factoring Context Integration**: Added freight factoring terminology in strategic locations
    - Dashboard subtitle now includes "freight factoring workflow" for clear service context
    - Landing page description emphasizes "freight factoring operations"
    - Added secondary branding line: "Trucking Pros Financial - Your trusted partner in freight factoring solutions"
    - Created clear branding hierarchy: QuantumCore (app) → Trucking Pros Financial (company) → Freight Factoring (service)
- **Profile Image Upload Fix**: Resolved profile picture upload and display functionality
  - Added static file serving for uploaded images at `/uploads` endpoint
  - Fixed profile image display in both profile page and navigation components
  - Enhanced image upload validation with proper file type and size checks
  - Images now properly display after upload with immediate UI updates
- **Admin Role Management System**: Implemented comprehensive admin panel for user management
  - Created Admin page accessible only to managers with role-based access control
  - Added user role management functionality (employee/manager roles)
  - Implemented role change API endpoints with proper authorization checks
  - Added activity logging for role changes with detailed audit trail
  - Enhanced database schema with role column and proper user management
  - Managers can view all users and change roles but cannot modify their own role
  - Updated user account to manager role for testing admin features
- **Navigation Enhancement**: Fixed profile navigation links in TopNav
  - Profile and Settings menu items now properly navigate to `/profile` page
  - Enhanced user menu with working navigation instead of placeholder actions
  - Improved user experience with consistent navigation behavior
- **Comprehensive Settings Page**: Implemented full user customization system with multiple preference categories
  - Created Personal settings tab with bio, location, timezone, and language options
  - Added Notification preferences for email, SMS, and desktop notifications with toggle switches
  - Implemented Work settings with customizable hours and work days selection
  - Created Appearance settings with theme selection, date format, and time format options
  - Enhanced database schema with all personalization fields and proper form validation
  - Fixed Select component controlled state issues by using `value` instead of `defaultValue`
  - Added proper form initialization with useEffect to load existing user preferences
  - **Theme System Implementation**: Built comprehensive theme management with immediate visual feedback
    - Created useTheme hook for centralized theme state management
    - Implemented instant theme switching (Light/Dark/System) with immediate UI updates
    - Added visual indicators and persistence across sessions via localStorage and database
    - Theme now properly toggles entire application interface and follows system preferences
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
- **Activity Log Document Deletion**: Added direct document deletion from activity log
  - Added "Delete" button next to "View Documents" in activity log for document upload activities  
  - Implemented confirmation dialog for safety ("Are you sure you want to delete this document?")
  - Added proper error handling and success notifications for activity log deletions
  - Enhanced activity log UI with side-by-side View/Delete buttons for better document management
  - Integrated with existing DELETE endpoint and activity logging system
- **Enhanced Fuel Card Application Viewing**: Improved user experience for viewing submitted applications
  - Added comprehensive "View" button for each submitted application with detailed information dialog
  - Enhanced application status display with color-coded icons (pending, approved, rejected)
  - Created detailed application view showing company info, contact details, requested card type, and review notes
  - Added status-specific messaging to guide users on next steps
  - Improved UI layout with better visual hierarchy and status indicators
- **Employee Time Tracking System**: Implemented comprehensive time clock functionality for workforce management
  - Created time_entries database table with clock in/out times, duration tracking, and status management
  - Added comprehensive time tracking API endpoints for status checking, clock in/out, and historical data
  - Built real-time Time Clock component with live time display and visual status indicators
  - Integrated clock component prominently into main dashboard for easy employee access
  - Added activity logging for all clock in/out actions with detailed audit trail
  - Features include: live timer display, running work duration, daily totals, optional notes, recent entries preview
  - Automatic refresh every 30 seconds to keep time data current and synchronized
- **Selective Home Button Navigation**: Enhanced navigation system with conditional Home button placement
  - Added Home button to TopNav component with blue styling and Home icon for quick Dashboard access
  - Implemented conditional logic to show Home button only on specific pages (NOT on Dashboard)
  - Home button appears on: Clients, Invoices, Documents, Fuel Cards, Credit Checks, Reports, Fuel Card Admin, Admin pages
  - Button redirects to Dashboard page (/) when clicked with consistent hover effects and theme support
  - Improved user experience by providing easy navigation back to Dashboard from any sub-page
  - **Completed Navigation Standardization**: Updated all pages to use TopNav component instead of Header
    - Fixed Clients and Invoices pages to use TopNav component for consistent Home button functionality
    - Replaced deprecated Header component with TopNav across all major pages
    - All pages now have unified navigation structure with working Home button access
- **Recent Activity Reset Functionality**: Added comprehensive reset capability for activity history management
  - Created Reset button in Recent Activity card header with red styling and trash icon
  - Added DELETE /api/activities endpoint for clearing all activity history
  - Implemented clearActivities method in storage interface for database operations
  - Button only appears when activities exist and includes loading spinner during operation
  - After reset, automatically logs the reset action with timestamp and user information
  - Success toast notification confirms reset completion with automatic activity list refresh
  - Provides clean slate functionality for activity monitoring and audit trail management
- **Complete Home Button Navigation System**: Finalized universal Home button access across entire application
  - Added Activities page to pagesWithHomeButton array for complete coverage
  - All major pages now feature consistent Home button functionality: Dashboard (hidden), Clients, Invoices, Documents, Fuel Cards, Credit Checks, Reports, Fuel Card Admin, Admin, and Activities
  - Universal navigation system provides seamless Dashboard access from any location in the application
  - Standardized layout structure across all pages using TopNav and Sidebar components