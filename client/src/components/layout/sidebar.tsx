import { useMemo } from "react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import factorFluxLogo from "@assets/FactorFlux_icon_1774282476113.png";
import {
  LayoutDashboard,
  FileText,
  FolderOpen,
  Users,
  BarChart3,
  Shield,
  Fuel,
  DollarSign,
  CheckSquare,
  Phone,
  Building,
  HelpCircle,
  Briefcase,
  Wallet,
  ShieldCheck,
  ArrowRightLeft,
  AlertTriangle,
  ClipboardList,
  Radio,
} from "lucide-react";

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

const navSections: NavSection[] = [
  {
    title: "Core",
    items: [
      { name: "Dashboard", href: "/", icon: LayoutDashboard },
      { name: "Clients", href: "/clients", icon: Users },
      { name: "Invoices", href: "/invoices", icon: FileText },
      { name: "Documents", href: "/documents", icon: FolderOpen },
      { name: "Tasks", href: "/tasks", icon: CheckSquare },
    ],
  },
  {
    title: "Finance",
    items: [
      { name: "Factoring", href: "/factoring", icon: DollarSign },
      { name: "Payouts", href: "/payouts", icon: Wallet },
      { name: "Cash Application", href: "/cash-application", icon: ArrowRightLeft },
      { name: "Fuel Advance", href: "/fuel-advance", icon: Fuel },
      { name: "Collections", href: "/collections", icon: Phone },
      { name: "Reports", href: "/reports", icon: BarChart3 },
    ],
  },
  {
    title: "Risk & Compliance",
    items: [
      { name: "Credit Checks", href: "/credit-checks", icon: ShieldCheck },
      { name: "FMCSA Authority", href: "/fmcsa-authority", icon: Radio },
      { name: "Exceptions", href: "/exceptions", icon: AlertTriangle },
      { name: "Audit Log", href: "/audit-log", icon: ClipboardList },
    ],
  },
  {
    title: "Operations",
    items: [
      { name: "Brokers", href: "/brokers", icon: Building },
      { name: "Vault", href: "/vault", icon: Shield },
      { name: "Doc Rules", href: "/document-rules", icon: ClipboardList, role: "manager" },
    ],
  },
  {
    title: "Admin",
    items: [
      { name: "Help", href: "/help", icon: HelpCircle },
      { name: "Admin", href: "/admin", icon: Briefcase, role: "manager" },
    ],
  },
];

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

  const savedUserData = window.localStorage.getItem("currentUser");

  if (savedUserData) {
    try {
      return { ...defaultUser, ...JSON.parse(savedUserData) };
    } catch {
      return defaultUser;
    }
  }

  return defaultUser;
}

function isRouteActive(currentPath: string, itemHref: string) {
  if (itemHref === "/") return currentPath === "/";
  return currentPath === itemHref || currentPath.startsWith(`${itemHref}/`);
}

export default function Sidebar({
  mobile = false,
  onNavigate,
}: SidebarProps) {
  const [location, setLocation] = useLocation();
  const user = getUserData();

  const filteredSections = useMemo(() => {
    return navSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          if (item.role === "manager") {
            return user.role === "manager" || user.role === "admin";
          }
          return true;
        }),
      }))
      .filter((section) => section.items.length > 0);
  }, [user.role]);

  return (
    <aside
      className={cn(
        "w-72 shrink-0 border-r border-[hsl(var(--border))] bg-white/95 backdrop-blur dark:bg-[hsl(var(--card))]",
        mobile ? "flex h-full" : "hidden h-screen md:flex"
      )}
    >
      <div className="flex h-full w-full flex-col">
        <div className="border-b border-[hsl(var(--border))] px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow-[0_12px_28px_rgba(37,99,235,0.25)] overflow-hidden">
              <img src={factorFluxLogo} alt="FactorFlux" className="h-9 w-9 object-contain" />
            </div>

            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                FactorFlux
              </h1>
              <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                Trucking Pros Financial
              </p>
            </div>
          </div>
        </div>

        <div className="border-b border-[hsl(var(--border))] px-5 py-4">
          <div className="qc-card flex items-center gap-3 rounded-2xl border px-3 py-3 shadow-sm">
            <div className="h-11 w-11 overflow-hidden rounded-full border-2 border-slate-200 dark:border-slate-700">
              <img
                src={
                  user.profileImageUrl ||
                  `https://ui-avatars.com/api/?name=${user.firstName}+${user.lastName}&background=2563EB&color=fff`
                }
                alt={`${user.firstName} ${user.lastName}`}
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.src = `https://ui-avatars.com/api/?name=${user.firstName}+${user.lastName}&background=2563EB&color=fff`;
                }}
              />
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                {user.firstName} {user.lastName}
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {user.jobTitle || "Employee"}
              </p>
            </div>
          </div>
        </div>

        <nav className="custom-scrollbar flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-6">
            {filteredSections.map((section) => (
              <div key={section.title}>
                <div className="mb-2 px-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                    {section.title}
                  </p>
                </div>

                <div className="space-y-1.5">
                  {section.items.map((item) => {
                    const isActive = isRouteActive(location, item.href);
                    const Icon = item.icon;

                    return (
                      <button
                        key={item.name}
                        type="button"
                        onClick={() => {
                          setLocation(item.href);
                          onNavigate?.();
                        }}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-200",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2",
                          "ring-offset-[hsl(var(--background))]",
                          isActive
                            ? "qc-sidebar-item-active text-blue-700 dark:text-blue-300"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-white"
                        )}
                      >
                        <div
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
                            isActive
                              ? "bg-white/80 text-blue-600 shadow-sm dark:bg-slate-900/40 dark:text-blue-400"
                              : "bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:group-hover:bg-slate-700"
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </div>

                        <div className="flex min-w-0 flex-1 items-center justify-between">
                          <span className="truncate text-sm font-medium">
                            {item.name}
                          </span>

                          {isActive && (
                            <div className="h-2 w-2 rounded-full bg-blue-600 dark:bg-blue-400" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <div className="border-t border-[hsl(var(--border))] px-5 py-4">
          <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3 dark:bg-slate-800/60">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white overflow-hidden shadow-sm">
              <img src={factorFluxLogo} alt="FactorFlux" className="h-8 w-8 object-contain" />
            </div>

            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                FactorFlux OS
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Internal operations suite
              </p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}