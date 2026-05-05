import { useMemo } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import factorFluxLogo from "@assets/FactorFlux_icon_1774282476113.png";
import {
  LayoutDashboard, FileText, Archive, Truck,
  BarChart3, Lock, Fuel, TrendingUp, ListTodo,
  Building2, LifeBuoy, Settings2, Wallet,
  ShieldCheck, ArrowRightLeft, AlertCircle,
  Activity, Radio, RotateCcw, FileCheck2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type UserRole = "manager" | "admin" | "employee";

type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
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

// ─── Navigation structure ─────────────────────────────────────────────────────

const navSections: NavSection[] = [
  {
    title: "Operations",
    items: [
      { name: "Command",        href: "/",          icon: LayoutDashboard },
      { name: "Carriers",       href: "/clients",   icon: Truck           },
      { name: "Load Ledger",    href: "/invoices",  icon: FileText        },
      { name: "Evidence Vault", href: "/documents", icon: Archive         },
      { name: "Workboard",      href: "/tasks",     icon: ListTodo        },
    ],
  },
  {
    title: "Finance",
    items: [
      { name: "Funding Pipeline", href: "/factoring",       icon: TrendingUp     },
      { name: "Settlements",      href: "/payouts",          icon: Wallet         },
      { name: "Remittance",       href: "/cash-application", icon: ArrowRightLeft },
      { name: "Fleet Float",      href: "/fuel-advance",     icon: Fuel           },
      { name: "Recovery",         href: "/collections",      icon: RotateCcw      },
      { name: "Insights",         href: "/reports",          icon: BarChart3      },
    ],
  },
  {
    title: "Risk",
    items: [
      { name: "Risk Screening",  href: "/credit-checks",   icon: ShieldCheck },
      { name: "Authority Watch", href: "/fmcsa-authority", icon: Radio       },
      { name: "Hold Queue",      href: "/exceptions",      icon: AlertCircle },
      { name: "Event Trail",     href: "/audit-log",       icon: Activity    },
    ],
  },
  {
    title: "Network",
    items: [
      { name: "Counterparties", href: "/brokers",         icon: Building2               },
      { name: "Secure Vault",   href: "/vault",           icon: Lock                    },
      { name: "Doc Policy",     href: "/document-rules",  icon: FileCheck2, role: "manager" },
    ],
  },
  {
    title: "System",
    items: [
      { name: "Support",       href: "/help",  icon: LifeBuoy                    },
      { name: "Control Panel", href: "/admin", icon: Settings2, role: "manager"  },
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

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export default function Sidebar({ mobile = false, onNavigate }: SidebarProps) {
  const [location, setLocation] = useLocation();
  const user = getUserData();

  const filteredSections = useMemo(() =>
    navSections
      .map(s => ({
        ...s,
        items: s.items.filter(i =>
          i.role === "manager" ? user.role === "manager" || user.role === "admin" : true
        ),
      }))
      .filter(s => s.items.length > 0),
    [user.role]
  );

  return (
    <aside
      className={cn(
        "w-72 shrink-0 flex flex-col",
        "bg-[#0B1120] border-r border-white/[0.05]",
        mobile ? "h-full" : "hidden h-screen md:flex"
      )}
    >
      {/* ── Brand ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/10 ring-1 ring-white/10">
          <img src={factorFluxLogo} alt="FactorFlux" className="h-7 w-7 object-contain" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-bold tracking-tight text-white">
            FactorFlux
          </h1>
          <p className="truncate text-[11px] text-slate-500">
            Freight Factoring OS
          </p>
        </div>
      </div>

      {/* ── User card ─────────────────────────────────────────────────────── */}
      <div className="border-b border-white/[0.06] px-4 py-3.5">
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5 ring-1 ring-white/[0.06]">
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1 ring-white/10">
            <img
              src={user.profileImageUrl || `https://ui-avatars.com/api/?name=${user.firstName}+${user.lastName}&background=2563EB&color=fff`}
              alt={`${user.firstName} ${user.lastName}`}
              className="h-full w-full object-cover"
              onError={e => { e.currentTarget.src = `https://ui-avatars.com/api/?name=${user.firstName}+${user.lastName}&background=2563EB&color=fff`; }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white">
              {user.firstName} {user.lastName}
            </p>
            <p className="truncate text-[11px] text-slate-500">
              {user.jobTitle || "Employee"}
            </p>
          </div>
          <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.8)]" />
        </div>
      </div>

      {/* ── Nav ───────────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 ff-sidebar-scroll">
        <div className="space-y-5">
          {filteredSections.map(section => (
            <div key={section.title}>
              <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">
                {section.title}
              </p>
              <div className="space-y-0.5">
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
                        "group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all duration-150",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50",
                        active
                          ? "bg-blue-500/10 text-white border-l-[2px] border-blue-500 pl-[10px]"
                          : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
                      )}
                    >
                      <Icon className={cn(
                        "h-[15px] w-[15px] shrink-0 transition-colors",
                        active ? "text-blue-400" : "text-slate-600 group-hover:text-slate-300"
                      )} />
                      <span className="truncate text-[13px] font-medium leading-none">
                        {item.name}
                      </span>
                      {active && (
                        <div className="ml-auto h-1 w-1 shrink-0 rounded-full bg-blue-400" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="border-t border-white/[0.06] px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-1 w-1 rounded-full bg-emerald-400" />
            <span className="text-[10px] text-slate-600">All systems operational</span>
          </div>
          <span className="text-[10px] font-mono text-slate-700">v2.0</span>
        </div>
      </div>
    </aside>
  );
}
