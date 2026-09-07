import { useLayoutEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { FactorFluxLogo } from "@/components/brand/factorflux-logo";
import {
  LayoutDashboard, FileText, Archive, Building2,
  BarChart3, Lock, Fuel, TrendingUp, ListTodo,
  LifeBuoy, Settings2, Wallet, ShieldCheck,
  ArrowRightLeft, AlertCircle, Activity, Radio,
  RotateCcw, FileCheck2, Users, Workflow, Headset, Truck, Landmark, BadgeDollarSign, Layers, MailOpen, Globe, Sparkles,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

// ─── Types ────────────────────────────────────────────────────────────────────

type UserRole = "manager" | "admin" | "employee";

type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  permission: string;
  role?: "manager";
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const sidebarScrollPositions = {
  desktop: 0,
  mobile: 0,
};

type CurrentUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
  profileImageUrl?: string;
  jobTitle?: string;
};

interface SidebarProps {
  mobile?: boolean;
  onNavigate?: () => void;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

const navSections: NavSection[] = [
  {
    title: "Workspace",
    items: [
      { name: "Dashboard",         href: "/",                   icon: LayoutDashboard, permission: "dashboard"          },
      { name: "Carriers",          href: "/clients",            icon: Users,           permission: "carriers"           },
      { name: "Invoices",          href: "/invoices",           icon: FileText,        permission: "invoices"           },
      { name: "Documents",         href: "/documents",          icon: Archive,         permission: "documents"          },
      { name: "Tasks",             href: "/tasks",              icon: ListTodo,        permission: "tasks"              },
      { name: "Bulk Invoices",     href: "/bulk-invoices",      icon: Layers,          permission: "bulk_invoices"      },
      { name: "Portal Submissions",href: "/portal-submissions", icon: Globe,           permission: "portal_submissions" },
    ],
  },
  {
    title: "Funding",
    items: [
      { name: "Factoring",      href: "/factoring",      icon: TrendingUp,     permission: "factoring"      },
      { name: "Payments",       href: "/payouts",        icon: Wallet,         permission: "payments"       },
      { name: "Lockbox",        href: "/lockbox",        icon: ArrowRightLeft, permission: "lockbox"        },
      { name: "Fuel Advance",   href: "/fuel-advance",   icon: Fuel,           permission: "fuel_advance"   },
      { name: "Bank Transfers", href: "/bank-transfers", icon: Landmark,       permission: "bank_transfers" },
    ],
  },
  {
    title: "Operations",
    items: [
      { name: "Dispatchers",     href: "/dispatchers",     icon: Headset,  permission: "dispatchers"     },
      { name: "Trucks",          href: "/trucks",          icon: Truck,    permission: "trucks"          },
      { name: "Release Letters", href: "/release-letters", icon: MailOpen, permission: "release_letters" },
    ],
  },
  {
    title: "Risk",
    items: [
      { name: "Brokers",     href: "/brokers",         icon: Building2,  permission: "brokers"    },
      { name: "C/B Reviews", href: "/credit-checks",   icon: ShieldCheck,permission: "cb_reviews" },
      { name: "MC Check",    href: "/fmcsa-authority", icon: Radio,      permission: "mc_check"   },
      { name: "Held",        href: "/held",            icon: AlertCircle,permission: "held"       },
      { name: "Logs",        href: "/audit-log",       icon: Activity,   permission: "logs"       },
    ],
  },
  {
    title: "Recovery",
    items: [
      { name: "Followups", href: "/collections", icon: RotateCcw, permission: "followups" },
      { name: "Reports",   href: "/reports",     icon: BarChart3, permission: "reports"   },
    ],
  },
  {
    title: "Admin",
    items: [
      { name: "Admin",            href: "/admin",            icon: ShieldCheck,     permission: "admin",            role: "manager" },
      { name: "Payroll",          href: "/payroll",          icon: BadgeDollarSign, permission: "payroll",          role: "manager" },
      { name: "Vault",            href: "/vault",            icon: Lock,            permission: "vault"                             },
      { name: "Help",             href: "/help",             icon: LifeBuoy,        permission: "help"                              },
      { name: "Rules",            href: "/document-rules",   icon: FileCheck2,      permission: "rules",            role: "manager" },
      { name: "Workflow Builder", href: "/workflow-builder", icon: Workflow,        permission: "workflow_builder", role: "manager" },
      { name: "Earl",              href: "/ai-assistant",     icon: Sparkles,        permission: "earl" },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const defaultUser: CurrentUser = {
  id: "1",
  firstName: "Admin",
  lastName: "User",
  email: "admin@tpf.com",
  role: "admin",
  profileImageUrl: "/uploads/c20bf48700fe065a95d9858e806bf4ce",
  jobTitle: "System Administrator",
};

function getUserData(): CurrentUser {
  if (typeof window === "undefined") return defaultUser;
  const saved = window.localStorage.getItem("currentUser");
  if (saved) {
    try { return { ...defaultUser, ...JSON.parse(saved) }; }
    catch { return defaultUser; }
  }
  return defaultUser;
}

function isRouteActive(current: string, href: string) {
  if (href === "/") return current === "/";
  return current === href || current.startsWith(`${href}/`);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Sidebar({ mobile = false, onNavigate }: SidebarProps) {
  const [location, setLocation] = useLocation();
  const { permissions, user: authUser } = useAuth();
  const navRef = useRef<HTMLElement>(null);
  const scrollPositionKey = mobile ? "mobile" : "desktop";

  const userRole = authUser?.role ?? "employee";
  const isAdmin = userRole === "admin";

  // Build display user entirely from auth context — never fall back to hardcoded admin values
  const user: CurrentUser = {
    id: authUser?.id ?? "",
    firstName: authUser?.firstName ?? "",
    lastName: authUser?.lastName ?? "",
    email: authUser?.email ?? authUser?.username ?? "",
    role: userRole as UserRole,
    profileImageUrl: authUser?.profileImageUrl ?? "",
    jobTitle: userRole.charAt(0).toUpperCase() + userRole.slice(1),
  };

  const filteredSections = useMemo(() =>
    navSections
      .map(s => ({
        ...s,
        items: s.items.filter(i => {
          // Admins always see everything
          if (isAdmin) return true;
          // Role gate for manager-only items
          if (i.role === "manager" && userRole !== "manager" && userRole !== "admin") return false;
          // Permission gate
          if (i.permission && permissions.length > 0 && !permissions.includes(i.permission)) return false;
          return true;
        }),
      }))
      .filter(s => s.items.length > 0),
    [userRole, isAdmin, permissions]
  );

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (nav) nav.scrollTop = sidebarScrollPositions[scrollPositionKey];
  }, [filteredSections, scrollPositionKey]);

  const navigateTo = (href: string) => {
    if (navRef.current) {
      sidebarScrollPositions[scrollPositionKey] = navRef.current.scrollTop;
    }
    setLocation(href);
    onNavigate?.();
  };

  return (
    <aside
      className={cn(
        "w-[230px] shrink-0 flex flex-col",
        "bg-[#c0c0c0] border-r-2 border-[#808080]",
        mobile ? "h-full" : "hidden h-screen md:flex"
      )}
    >
      {/* Brand */}
      <div className="border-b-2 border-[#808080] px-3 py-4">
        <FactorFluxLogo />
        <div className="min-w-0">
          <p className="truncate pl-11 text-[10px] text-[#444] mt-0.5">
            Freight Factoring OS
          </p>
          <p className="truncate pl-11 text-[8px] font-semibold uppercase tracking-[0.08em] text-[#5a5a5a]">
            Trucking Pros Financial
          </p>
        </div>
      </div>

      {/* User */}
      <div className="border-b-2 border-[#808080] px-3 py-2.5">
        <div className="flex items-center gap-2.5 border-2 border-[#fff] border-r-[#808080] border-b-[#808080] bg-[#d4d0c8] px-2.5 py-2">
          {user.profileImageUrl ? (
            <img
              src={user.profileImageUrl}
              alt={`${user.firstName} ${user.lastName}`}
              className="h-7 w-7 shrink-0 rounded-full border border-[#808080] object-cover"
            />
          ) : (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#098b9f] text-[11px] font-bold text-white">
              {(user.firstName[0] || "A")}{(user.lastName[0] || "U")}
            </div>
          )}
          <div className="min-w-0 flex-1">
             <p className="truncate text-[12px] font-semibold text-[#1a1a1a] leading-none">
              {user.firstName} {user.lastName}
            </p>
             <p className="truncate text-[10px] text-[#444] mt-0.5">
              {user.jobTitle || "Employee"}
            </p>
          </div>
           <div className="h-2 w-2 shrink-0 rounded-full bg-[#27aab8]" />
        </div>
      </div>

      {/* Nav */}
      <nav
        ref={navRef}
        onScroll={(event) => {
          sidebarScrollPositions[scrollPositionKey] = event.currentTarget.scrollTop;
        }}
        className="flex-1 overflow-y-auto px-2.5 py-3 ff-sidebar-scroll"
      >
        <div className="space-y-4">
          {filteredSections.map(section => (
            <div key={section.title}>
               <p className="mb-1 px-2 text-[9.5px] font-bold uppercase tracking-[0.2em] text-[#444]">
                {section.title}
              </p>
              <div className="space-y-px">
                {section.items.map(item => {
                  const active = isRouteActive(location, item.href);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => navigateTo(item.href)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                         "group flex w-full items-center gap-2 border-l-2 border-transparent px-2.5 py-2 text-left transition-colors duration-100",
                         "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#098b9f]",
                        active
                           ? "bg-[#dff5f6] text-[#1a1a1a] border-l-2 border-[#098b9f] pl-[9px]"
                           : "text-[#1a1a1a] hover:bg-[#d4d0c8] hover:border-[#27aab8]"
                      )}
                    >
                      <Icon className={cn(
                        "h-[14px] w-[14px] shrink-0 transition-colors",
                         active ? "text-[#098b9f]" : "text-[#666] group-hover:text-[#098b9f]"
                      )} />
                      <span className="truncate text-[12.5px] font-medium leading-none">
                        {item.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      {/* Footer */}
       <div className="border-t-2 border-[#808080] px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
             <div className="h-1.5 w-1.5 rounded-full bg-[#098b9f]" />
             <span className="text-[9.5px] text-[#444]">Systems nominal</span>
          </div>
           <span className="text-[9.5px] font-mono text-[#444]">v2.0</span>
        </div>
      </div>
    </aside>
  );
}
