# QuantumCore/TPF Pulse OS Design Guidelines

## Design Approach
**System:** shadcn/ui component library with Tailwind CSS
**Reference Inspiration:** Linear (productivity excellence), Stripe Dashboard (financial clarity), Vercel (clean interface patterns)
**Philosophy:** Professional efficiency over decoration. Every element serves the workflow. Dark/light themes as first-class citizens, not afterthoughts.

## Typography
- **Primary Font:** Inter (Google Fonts) for all UI text
- **Monospace:** JetBrains Mono for invoice numbers, tracking IDs, financial data
- **Hierarchy:**
  - Page titles: text-3xl font-semibold
  - Section headers: text-xl font-semibold
  - Card titles: text-lg font-medium
  - Body text: text-sm
  - Labels: text-xs font-medium uppercase tracking-wide
  - Data fields: text-sm font-mono

## Layout System
**Spacing Primitives:** Use Tailwind units of 2, 4, 6, 8, 12, 16, 24
- Component padding: p-6
- Card spacing: space-y-6
- Form field gaps: gap-4
- Section margins: mb-8, mb-12
- Sidebar width: w-64
- Main content: max-w-7xl with proper margins

## Application Structure

### Sidebar Navigation (w-64, fixed left)
- Company logo/branding at top (h-16)
- Primary navigation groups with section headers
- Active state with subtle background indicator
- Collapsed state option (icon-only, w-16)
- User profile/settings at bottom with avatar
- Navigation items: py-2 px-4 with icons (20px) and labels

### Top Bar (h-16, border-b)
- Breadcrumb navigation (left)
- Global search bar (center, max-w-md)
- Notifications bell icon + theme toggle + user menu (right)
- All items aligned with gap-4

### Main Content Area
- Container: px-8 py-6
- Page header with title + primary action button
- Content organized in cards/sections with consistent spacing

## Core Components

### Forms (Invoice Processing Priority)
- **Layout:** Two-column grid (grid-cols-2 gap-6) for desktop, single column mobile
- **Input Fields:** Full shadcn/ui form components with labels, placeholders, helper text
- **Required Fields:** Asterisk in label, clear validation states
- **File Upload Zones:** Dashed border dropzones with drag-drop, file type/size indicators
- **Action Buttons:** Primary (right-aligned), Secondary (left or inline), Cancel (ghost variant)
- **Progress Indicators:** Multi-step forms show step indicator at top

### Data Tables
- Striped rows for readability
- Sortable columns with icon indicators
- Row actions (kebab menu or inline buttons)
- Pagination footer with results count
- Filters in header area (not inline)
- Empty states with helpful messaging

### Cards
- Default: border with subtle shadow, p-6
- Header with title + optional action button
- Content area with consistent internal spacing
- Card grids: grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6

### Status Badges
- Pill shape (rounded-full px-3 py-1)
- Color-coded: Success (green), Pending (yellow), Rejected (red), Processing (blue)
- Text: text-xs font-medium

### Dashboard Widgets
- KPI cards: Large number (text-3xl font-bold), label, trend indicator
- Recent activity feed: Timeline layout with timestamps
- Quick actions: Grid of icon buttons with labels

## Theme Implementation
**Critical:** Design all components with both themes in mind from start
- Light: White backgrounds, subtle grays for borders/dividers
- Dark: True dark backgrounds (not gray), proper contrast ratios
- Use CSS variables for theme switching (shadcn/ui built-in system)
- Test all form states, buttons, inputs in both themes

## Images
**Hero Image:** None - this is a business application, not a marketing site
**Application Images:**
- Company logos in client management sections (40px height max)
- Document thumbnails in upload previews (120px x 160px aspect)
- User avatars (32px in sidebar, 40px in profiles)
- Empty state illustrations (max 200px, centered)

## Animations
**Minimal Use Only:**
- Page transitions: None (instant navigation)
- Modal overlays: Fast fade-in (150ms)
- Dropdown menus: Slide down (100ms)
- Form validation: Shake animation on error
- Loading states: Spinner or skeleton screens (no elaborate animations)

## Critical Workflow Patterns
- **Invoice Submission:** Multi-step wizard with save-draft capability
- **Document Review:** Split view (document preview left, form right)
- **Batch Operations:** Checkbox selection with bulk action bar
- **Search/Filter:** Persistent filter sidebar that collapses on mobile

**Priority:** Form usability, data clarity, fast navigation, professional appearance. Every design choice optimizes for daily workflow efficiency.