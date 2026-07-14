import { useMemo } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import factorFluxLogo from "@assets/FactorFlux_icon_1774282476113.png";
import {
  LayoutDashboard, FileText, Archive, Building2,
  BarChart3, Lock, Fuel, TrendingUp, ListTodo,
  LifeBuoy, Settings2, Wallet, ShieldCheck,
  ArrowRightLeft, AlertCircle, Activity, Radio,
  RotateCcw, FileCheck2, Users, Workflow, Headset, Truck, Landmark, BadgeDollarSign, Layers, MailOpen, Globe,
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
  const user = getUserData();
  const { permissions, user: authUser } = useAuth();

  const isAdmin = (authUser?.role ?? user.role) === "admin";

  const filteredSections = useMemo(() =>
    navSections
      .map(s => ({
        ...s,
        items: s.items.filter(i => {
          // Admins always see everything
          if (isAdmin) return true;
          // Role gate for manager-only items
          if (i.role === "manager" && user.role !== "manager" && user.role !== "admin") return false;
          // Permission gate
          if (i.permission && permissions.length > 0 && !permissions.includes(i.permission)) return false;
          return true;
        }),
      }))
      .filter(s => s.items.length > 0),
    [user.role, isAdmin, permissions]
  );

  return (
    <aside
      className={cn(
        "w-[230px] shrink-0 flex flex-col",
        "bg-[#0B1120] border-r border-white/[0.05]",
        mobile ? "h-full" : "hidden h-screen md:flex"
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/10 ring-1 ring-white/10">
          <img src={factorFluxLogo} alt="FactorFlux" className="h-6 w-6 object-contain" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[14px] font-bold tracking-tight text-white leading-none">
            FactorFlux
          </h1>
          <p className="truncate text-[10px] text-slate-600 mt-0.5">
            Freight Factoring OS
          </p>
        </div>
      </div>

      {/* User */}
      <div className="border-b border-white/[0.06] px-3 py-2.5">
        <div className="flex items-center gap-2.5 rounded-lg bg-white/[0.04] px-2.5 py-2 ring-1 ring-white/[0.05]">
          <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full ring-1 ring-white/10">
            <img
              src={user.profileImageUrl || `https://ui-avatars.com/api/?name=${user.firstName}+${user.lastName}&background=2563EB&color=fff`}
              alt={`${user.firstName} ${user.lastName}`}
              className="h-full w-full object-cover"
              onError={e => {
                e.currentTarget.src = `https://ui-avatars.com/api/?name=${user.firstName}+${user.lastName}&background=2563EB&color=fff`;
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-white leading-none">
              {user.firstName} {user.lastName}
            </p>
            <p className="truncate text-[10px] text-slate-500 mt-0.5">
              {user.jobTitle || "Employee"}
            </p>
          </div>
          <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.7)]" />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3 ff-sidebar-scroll">
        <div className="space-y-4">
          {filteredSections.map(section => (
            <div key={section.title}>
              <p className="mb-1 px-2 text-[9.5px] font-bold uppercase tracking-[0.2em] text-slate-700">
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
                      onClick={() => { setLocation(item.href); onNavigate?.(); }}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all duration-100",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50",
                        active
                          ? "bg-blue-500/10 text-white border-l-2 border-blue-500 pl-[9px]"
                          : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
                      )}
                    >
                      <Icon className={cn(
                        "h-[14px] w-[14px] shrink-0 transition-colors",
                        active ? "text-blue-400" : "text-slate-600 group-hover:text-slate-300"
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
      <div className="border-t border-white/[0.05] px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="h-1 w-1 rounded-full bg-emerald-400" />
            <span className="text-[9.5px] text-slate-700">Systems nominal</span>
          </div>
          <span className="text-[9.5px] font-mono text-slate-800">v2.0</span>
        </div>
      </div>
    </aside>
  );
}
