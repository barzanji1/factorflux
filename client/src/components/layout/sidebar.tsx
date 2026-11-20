import { preloadPage } from "@/lib/lazy-page";
import "@/styles/ff-financial-dashboard.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getSidebarState, subscribeSidebarState, setSidebarHovered, toggleSidebarSection, requestSidebarFocus, consumeSidebarFocus } from "./sidebar-state";
import { useQuery } from "@tanstack/react-query";
import { useImmediateNavigation as useLocation } from "@/hooks/useImmediateNavigation";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { FactorFluxLogo } from "@/components/brand/factorflux-logo";
import {
  LayoutDashboard, FileText, Archive, Building2,
  BarChart3, Lock, Fuel, TrendingUp, ListTodo,
  LifeBuoy, Wallet, ShieldCheck,
  ArrowRightLeft, AlertCircle, Activity, Radio,
  RotateCcw, FileCheck2, Users, Workflow, Headset, Truck, Landmark, BadgeDollarSign, Layers, MailOpen, Globe, Sparkles, CalendarDays, Receipt, MessageCircle,
  ChevronDown, Pin, PinOff, Sun, Moon, Handshake,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import ItSupportBell from "@/components/it-support/ItSupportBell";
import { useToast } from "@/hooks/use-toast";
import { useSidebarHosted } from "./sidebar-host";
import { useTheme } from "@/hooks/useTheme";

// ─── Types ────────────────────────────────────────────────────────────────────

type UserRole = "manager" | "admin" | "employee";

type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  permission: string;
  role?: "manager";
  staffVisible?: boolean;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

type ChatChannelSummary = {
  id: string | number;
  name: string;
  type: string;
  unreadCount: number;
  directName?: string | null;
};

type ChatMessageSummary = {
  id: string | number;
  senderId: string | number;
  senderName: string;
};

const sidebarScrollPositions = {
  desktop: 0,
  mobile: 0,
};
const SIDEBAR_PIN_KEY = "factorflux-sidebar-pinned";

function readSidebarPinned() {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(SIDEBAR_PIN_KEY) === "true"; }
  catch { return false; }
}

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
      { name: "Agent Dashboard",   href: "/",                   icon: LayoutDashboard, permission: "dashboard", staffVisible: true },
      { name: "Carriers",          href: "/clients",            icon: Users,           permission: "carriers"           },
      { name: "Invoices",          href: "/invoices",           icon: FileText,        permission: "invoices"           },
      { name: "Documents",         href: "/documents",          icon: Archive,         permission: "documents"          },
      { name: "Tasks",             href: "/tasks",              icon: ListTodo,        permission: "tasks"              },
      { name: "IT Support",        href: "/it-support",         icon: LifeBuoy,         permission: "", staffVisible: true },
      { name: "Calendar",          href: "/calendar",            icon: CalendarDays,   permission: "dashboard"          },
      { name: "Team Chat",         href: "/chat",               icon: MessageCircle,  permission: "chat", staffVisible: true },
      { name: "Bulk Invoices",     href: "/bulk-invoices",      icon: Layers,          permission: "bulk_invoices"      },
      { name: "Portal Submissions",href: "/portal-submissions", icon: Globe,           permission: "portal_submissions" },
    ],
  },
  {
    title: "Communications",
    items: [
      { name: "Email Client", href: "/client-email?tab=log", icon: MailOpen, permission: "email_log", staffVisible: true },
    ],
  },
  {
    title: "Funding",
    items: [
      { name: "Factoring",      href: "/factoring",      icon: TrendingUp,     permission: "factoring"      },
      { name: "Sheets",         href: "/sheets",         icon: FileCheck2,     permission: "factoring", role: "manager" },
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
      { name: "Broker Activity", href: "/broker-activity", icon: Handshake, permission: "", role: "manager" },
      { name: "C/B Reviews", href: "/credit-checks",   icon: ShieldCheck,permission: "cb_reviews" },
      { name: "MC Check",    href: "/fmcsa-authority", icon: Radio,      permission: "mc_check"   },
      { name: "Held",        href: "/held",            icon: AlertCircle,permission: "held"       },
      { name: "Logs",        href: "/audit-log",       icon: Activity,   permission: "logs"       },
    ],
  },
  {
    title: "Recovery",
    items: [
      { name: "Followups", href: "/follow-up", icon: RotateCcw, permission: "followups" },
      { name: "Reports",   href: "/reports",     icon: BarChart3, permission: "reports"   },
    ],
  },
  {
    title: "Admin",
    items: [
      { name: "Admin",            href: "/admin",            icon: ShieldCheck,     permission: "admin",            role: "manager" },
      { name: "Pay Statements",   href: "/payroll",          icon: BadgeDollarSign, permission: "", staffVisible: true },
      { name: "Expenses",         href: "/expenses",         icon: Receipt,         permission: "expenses" },
      { name: "Vault",            href: "/vault",            icon: Lock,            permission: "vault"                             },
      { name: "Help",             href: "/help",             icon: LifeBuoy,        permission: "help"                              },
      { name: "Rules",            href: "/document-rules",   icon: FileCheck2,      permission: "rules",            role: "manager" },
      { name: "Workflow Builder", href: "/workflow-builder", icon: Workflow,        permission: "workflow_builder", role: "manager" },
      { name: "Earl",              href: "/ai-assistant",     icon: Sparkles,        permission: "earl" },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────



function isRouteActive(current: string, href: string) {
  const currentPath = current.split("?")[0];
  const hrefPath = href.split("?")[0];
  if (hrefPath === "/") return currentPath === "/";
  return currentPath === hrefPath || currentPath.startsWith(`${hrefPath}/`);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Sidebar(props: SidebarProps) {
  const hosted = useSidebarHosted();
  useLayoutEffect(() => {
    if (hosted && !props.mobile) return hosted(SidebarContent);
  }, [hosted, props.mobile]);
  // Existing page layouts and mobile drawers keep their public interface.
  // In the shared staff frame the desktop rail already exists above the routes.
  // A slot also keeps standalone pages (which never requested a rail) unchanged.
  if (hosted && !props.mobile) return null;
  return <SidebarContent {...props} />;
}

function SidebarContent({ mobile = false, onNavigate }: SidebarProps) {
  const { theme, setTheme } = useTheme();
  const [location, setLocation] = useLocation();
  const { permissions, permissionsLoaded, user: authUser, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const navigationSequence = useRef(0);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  useEffect(() => () => { ++navigationSequence.current; }, []);
  const userRole = authUser?.role ?? "employee";
  const isAdmin = userRole === "admin";
  const canUsePortalSubmissions = !!authUser && (isAdmin || (!authLoading && permissions.includes("portal_submissions")));
  const canUseInternalChat = !!authUser && (isAdmin || (!authLoading && permissions.includes("chat")));
  const canUseCarrierChat = !!authUser && (isAdmin || (!authLoading && (permissions.includes("chat") || permissions.includes("portal_submissions"))));
  const { data: carrierChatUnread } = useQuery<{ count: number }>({
    queryKey: ["/api/carrier-chat/unread-count"],
    refetchInterval: 5000,
    retry: false,
    enabled: canUseCarrierChat,
  });
  const { data: portalSubmissionsUnreviewed } = useQuery<{ count: number }>({
    queryKey: ["/api/portal-submissions/unreviewed-count"],
    refetchInterval: 30000,
    retry: false,
    enabled: canUsePortalSubmissions,
  });
  const { data: pendingRegistrations } = useQuery<{ count: number }>({
    queryKey: ["/api/carrier-portal/pending-count"],
    refetchInterval: 30000,
    retry: false,
    enabled: canUsePortalSubmissions,
  });
  const unreviewedSubmissionCount = portalSubmissionsUnreviewed?.count ?? 0;
  const pendingRegistrationCount = pendingRegistrations?.count ?? 0;
  const carrierUnreadCount = carrierChatUnread?.count ?? 0;
  const portalSubmissionsTotal = unreviewedSubmissionCount + pendingRegistrationCount + carrierUnreadCount;
  const portalSubmissionsBadgeLabel = `${unreviewedSubmissionCount} new submissions, ${pendingRegistrationCount} pending registrations, ${carrierUnreadCount} unread carrier messages`;
  const { data: notificationChannels } = useQuery<ChatChannelSummary[]>({
    queryKey: ["/api/chat/channels"],
    refetchInterval: 3000,
    retry: false,
    enabled: canUseInternalChat,
  });
  const previousChannelUnreadRef = useRef<Record<string, number> | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const [pinned, setPinned] = useState(readSidebarPinned);
  const sidebarState = useSyncExternalStore(subscribeSidebarState, getSidebarState, getSidebarState);
  const hoverExpanded = sidebarState.hovered;
  const [focusExpanded, setFocusExpanded] = useState(false);
  const openSections = sidebarState.sections[mobile ? "mobile" : "desktop"];
  const expanded = mobile || pinned || hoverExpanded || focusExpanded;
  const scrollPositionKey = mobile ? "mobile" : "desktop";

  const togglePinned = () => {
    setPinned(previous => {
      const next = !previous;
      try { window.localStorage.setItem(SIDEBAR_PIN_KEY, String(next)); } catch { /* Storage may be disabled. */ }
      return next;
    });
  };

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
          if (i.staffVisible) return !!authUser;
          // Admins always see everything
          if (isAdmin) return true;
          if (i.permission === "chat" && !permissions.includes("chat")) return false;
          if (i.name === "Portal Submissions" && !canUsePortalSubmissions && !canUseCarrierChat) return false;
          if (i.name === "Portal Submissions" && (canUsePortalSubmissions || canUseCarrierChat)) return true;
          // Role gate for manager-only items
          if (i.role === "manager" && userRole !== "manager" && userRole !== "admin") return false;
          // Permission gate
           if (i.permission && (!permissionsLoaded || !permissions.includes(i.permission))) return false;
          return true;
        }),
      }))
      .filter(s => s.items.length > 0),
     [userRole, isAdmin, permissions, permissionsLoaded, canUsePortalSubmissions, canUseCarrierChat, authUser]
  );

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (nav) nav.scrollTop = sidebarScrollPositions[scrollPositionKey];
  }, [filteredSections, scrollPositionKey]);

  useLayoutEffect(() => {
    if (!mobile && navRef.current?.getClientRects().length && consumeSidebarFocus(location)) {
      navRef.current.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus({ preventScroll: true });
    }
  }, [location, mobile]);

  useEffect(() => {
    if (!notificationChannels) return;
    const nextUnread = Object.fromEntries(notificationChannels.map((channel) => [String(channel.id), channel.unreadCount]));
    const previousUnread = previousChannelUnreadRef.current;
    previousChannelUnreadRef.current = nextUnread;
    if (!previousUnread || typeof Notification === "undefined" || Notification.permission !== "granted") return;

    notificationChannels.forEach((channel) => {
      const channelKey = String(channel.id);
      if (channel.unreadCount <= (previousUnread[channelKey] ?? 0)) return;
      fetch(`/api/chat/channels/${channel.id}/messages`, { credentials: "include" })
        .then((response) => response.ok ? response.json() as Promise<ChatMessageSummary[]> : [])
        .then((messages) => {
          const latest = messages.at(-1);
          if (!latest || String(latest.senderId) === String(authUser?.id)) return;
          const channelName = channel.type === "direct" ? (channel.directName || channel.name) : `#${channel.name}`;
          const notification = new Notification(`New message in ${channelName} from ${latest.senderName}`);
          notification.onclick = () => {
            window.focus();
            window.sessionStorage.setItem("chat:open-channel", channelKey);
            window.dispatchEvent(new CustomEvent("team-chat:open", { detail: { channelId: channelKey } }));
            notification.close();
          };
        })
        .catch(() => undefined);
    });
  }, [notificationChannels, authUser?.id]);

  const navigateTo = async (href: string) => {
    if (href === location && !pendingPath) return;
    const sequence = ++navigationSequence.current;
    setPendingPath(href);
    try {
      // The shared router now prepares code/access for every navigation source.
      // Preserve the rail's scroll/focus before it commits the destination.
      if (navRef.current) {
        sidebarScrollPositions[scrollPositionKey] = navRef.current.scrollTop;
        if (!mobile && navRef.current.contains(document.activeElement)) requestSidebarFocus(href.split("?")[0]);
      }
      await setLocation(href);
      if (sequence !== navigationSequence.current) return;
    } catch (error) {
      if (sequence !== navigationSequence.current) return;
      setPendingPath(null);
      toast({ title: "Page could not open", description: error instanceof Error ? error.message : "Please retry.", variant: "destructive" });
      return;
    }
    setPendingPath(null);
    onNavigate?.();
  };

  return (
    <aside
      onMouseEnter={() => !mobile && setSidebarHovered(true)}
      onMouseLeave={() => !mobile && setSidebarHovered(false)}
      onFocusCapture={() => !mobile && setFocusExpanded(true)}
      onBlurCapture={event => {
        if (!mobile && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusExpanded(false);
          setSidebarHovered(event.currentTarget.matches(":hover"));
        }
      }}
      className={cn(
        "ff-neu-sidebar relative z-30 flex shrink-0 flex-col",
        expanded ? "ff-neu-sidebar-expanded" : "ff-neu-sidebar-collapsed",
        mobile ? "h-full w-[248px]" : "hidden h-[100dvh] md:flex"
      )}
      aria-label="Primary navigation"
    >
      {/* Brand */}
      <div className="ff-neu-sidebar-brand">
        <FactorFluxLogo markSrc="/images/ff-logo-emboss.png" showWordmark={expanded} />
        {expanded && <div className="min-w-0 pl-11">
          <p className="truncate text-[10px] text-[#747e7a]">Freight Factoring OS</p>
          <p className="truncate text-[8px] font-semibold uppercase tracking-[0.08em] text-[#87918d]">Trucking Pros Financial</p>
        </div>}
      </div>

      {/* User */}
      <div className="ff-neu-sidebar-user-wrap">
        <div className={`ff-neu-sidebar-user ${expanded ? "" : "is-compact"}`} title={expanded ? undefined : `${user.firstName} ${user.lastName} — ${user.jobTitle}`}>
          {user.profileImageUrl ? (
            <img
              src={user.profileImageUrl}
              alt={`${user.firstName} ${user.lastName}`}
              className="h-7 w-7 shrink-0 rounded-full border border-[#808080] object-cover"
            />
          ) : (
              <div className="ff-neu-sidebar-initials">
              {(user.firstName[0] || "A")}{(user.lastName[0] || "U")}
            </div>
          )}
          {expanded && <div className="min-w-0 flex-1">
             <p className="truncate text-[12px] font-semibold text-[#1a1a1a] leading-none">
              {user.firstName} {user.lastName}
            </p>
             <p className="truncate text-[10px] text-[#444] mt-0.5">
              {user.jobTitle || "Employee"}
            </p>
          </div>}
          {expanded && <div className="h-2 w-2 shrink-0 rounded-full bg-[#27aab8]" />}
        </div>
      </div>

      {/* Nav */}
      <nav
        ref={navRef}
        onScroll={(event) => {
          sidebarScrollPositions[scrollPositionKey] = event.currentTarget.scrollTop;
        }}
        className="ff-neu-sidebar-nav flex-1 overflow-y-auto ff-sidebar-scroll"
        aria-label="Application sections"
      >
        <div className="space-y-3">
          {filteredSections.map(section => (
            <div key={section.title} className="ff-neu-sidebar-group">
              <button
                type="button"
                className="ff-neu-sidebar-group-toggle"
                onClick={() => toggleSidebarSection(scrollPositionKey, section.title)}
                aria-expanded={openSections[section.title] ?? true}
                aria-label={`${section.title} section`}
                title={expanded ? undefined : `${section.title} section`}
              >
                <span className="ff-neu-sidebar-group-label">{expanded ? section.title : <span className="ff-neu-group-marker">{section.title.slice(0, 1)}</span>}</span>
                {expanded && <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${openSections[section.title] === false ? "-rotate-90" : ""}`} />}
              </button>
              {(openSections[section.title] ?? true) && <div className="space-y-1">
                {section.items.map(item => {
                  const active = isRouteActive(location, item.href);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.name}
                      type="button"
                      onClick={() => navigateTo(item.href)}
                      onPointerEnter={() => preloadPage(item.href)}
                      onPointerDown={() => preloadPage(item.href)}
                      onFocus={() => preloadPage(item.href)}
                      aria-current={active ? "page" : undefined}
                      aria-busy={pendingPath === item.href}
                      title={expanded ? undefined : item.name}
                      aria-label={item.name}
                      className={cn(
                          "ff-neu-sidebar-button group flex min-h-10 w-full items-center gap-2 text-left transition-colors duration-100",
                          expanded ? "px-3 py-2" : "justify-center px-1 py-2",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]",
                        active
                           ? "text-[#1a1a1a]"
                           : "text-[#1f1f1f]"
                      )}
                    >
                      {pendingPath === item.href ? <RotateCcw className="h-[14px] w-[14px] shrink-0 animate-spin" aria-label="Opening page" /> : <Icon className={cn(
                        "h-[14px] w-[14px] shrink-0 transition-colors",
                         active ? "text-[#087c8d]" : "text-[#454545] group-hover:text-[#087c8d]"
                      )} />}
                       {expanded && <span className="truncate text-[13px] font-semibold leading-none tracking-[-0.01em]">
                        {item.name}
                      </span>}
                          {item.name === "IT Support" && <ItSupportBell />}
                          {item.name === "Portal Submissions" && portalSubmissionsTotal > 0 && <span
                            className={`ff-neu-sidebar-badge ${expanded ? "ml-auto" : "absolute right-0 top-0"}`}
                           title={portalSubmissionsBadgeLabel}
                           aria-label={portalSubmissionsBadgeLabel}
                         >
                            {portalSubmissionsTotal >= 10 ? "9+" : portalSubmissionsTotal}
                         </span>}
                    </button>
                  );
                })}
              </div>}
            </div>
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div className="ff-neu-sidebar-footer">
        <button
          type="button"
          className={`ff-neu-pin-button ${expanded ? "" : "justify-center"}`}
          role="switch"
          aria-checked={theme === "dark"}
          aria-label="Dark mode"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {expanded && <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>}
        </button>
        <button
          type="button"
          className={`ff-neu-pin-button ${expanded ? "" : "justify-center"}`}
          onClick={togglePinned}
          aria-pressed={pinned}
          aria-label={pinned ? "Unpin sidebar" : "Pin sidebar expanded"}
          title={pinned ? "Unpin sidebar" : "Pin sidebar expanded"}
        >
          {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          {expanded && <span>{pinned ? "Pinned open" : "Pin sidebar"}</span>}
        </button>
        {expanded && <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
             <div className="h-1.5 w-1.5 rounded-full bg-[#098b9f]" />
             <span className="text-[9.5px] text-[#444]">Systems nominal</span>
          </div>
           <span className="text-[9.5px] font-mono text-[#444]">v2.0</span>
        </div>}
      </div>
    </aside>
  );
}
