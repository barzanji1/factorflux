import { useState, useEffect, useRef, useMemo, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useImmediateNavigation as useLocation } from "@/hooks/useImmediateNavigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { Notification as AppNotification } from "@shared/schema";
import {
  Bell,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  User as UserIcon,
  Settings,
  LogOut,
  FileText,
  Users,
  Home,
  Menu,
  BadgeCheck,
  CheckCircle2,
  AlertTriangle,
  Info,
  XCircle,
  CheckCheck,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NeuButton, NeuInput } from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import Sidebar from "@/components/layout/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import TimeClock from "@/components/time-tracking/time-clock";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TopNavProps {
  title: string;
  subtitle?: string;
  group?: string;
  neu?: boolean;
  actions?: ReactNode;
}

function normalizeCarrierChatUrl(url?: string | null) {
  if (!url?.startsWith("/carrier-messages")) return url;
  const query = url.includes("?") ? url.slice(url.indexOf("?")) : "";
  return `/portal-submissions${query}`;
}

interface SearchResults {
  groups: SearchResultGroup[];
}

interface SearchResultItem {
  id: number;
  title: string;
  subtitle?: string;
  href: string;
}

interface SearchResultGroup {
  type: string;
  label: string;
  results: SearchResultItem[];
}

function useDebouncedValue<T>(value: T, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

function timeAgo(date: string | Date | null | undefined): string {
  if (!date) return "just now";
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const NOTIF_ICON: Record<string, { icon: typeof Info; className: string }> = {
  info:    { icon: Info,         className: "text-blue-500 bg-blue-50 dark:bg-blue-950/40" },
  success: { icon: CheckCircle2, className: "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40" },
  warning: { icon: AlertTriangle,className: "text-amber-500 bg-amber-50 dark:bg-amber-950/40" },
  error:   { icon: XCircle,      className: "text-red-500 bg-red-50 dark:bg-red-950/40" },
};

export default function TopNav({ title, subtitle, group, neu = true, actions }: TopNavProps) {
  const { user: authUser, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [notifFilter, setNotifFilter] = useState<"all" | "unread">("all");
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<AppNotification | null>(null);
  const [notificationDialogOpen, setNotificationDialogOpen] = useState(false);
  const [markReadError, setMarkReadError] = useState<string | null>(null);
  const selectedNotificationUserRef = useRef<string | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const previousNotificationIdsRef = useRef<Set<number> | null>(null);
  const debouncedSearchQuery = useDebouncedValue(searchQuery.trim(), 300);

  const { data: notifications = [] } = useQuery<AppNotification[]>({
    queryKey: ["/api/notifications", authUser?.id],
    queryFn: async () => {
      const managers = authUser?.role === "admin" || authUser?.role === "manager";
      const res = await fetch(managers ? "/api/internal/notifications" : "/api/notifications", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load notifications");
      const payload = await res.json();
      return managers ? payload.notifications : payload;
    },
    enabled: !!authUser?.id,
    retry: false,
    staleTime: 20000,
    refetchInterval: authUser?.role === "admin" || authUser?.role === "manager" ? 3000 : 30000,
  });

  const { data: unreadCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count", authUser?.id],
    queryFn: async () => {
      const managers = authUser?.role === "admin" || authUser?.role === "manager";
      const res = await fetch(managers ? "/api/internal/notifications/unread-count" : "/api/notifications/unread-count", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load unread notification count");
      return res.json();
    },
    enabled: !!authUser?.id,
    retry: false,
    staleTime: 20000,
    refetchInterval: authUser?.role === "admin" || authUser?.role === "manager" ? 3000 : 30000,
  });
  const unreadCount = unreadCountData?.count ?? 0;

  useEffect(() => {
    const currentIds = new Set(notifications.map(notification => notification.id));
    const previousIds = previousNotificationIdsRef.current;
    previousNotificationIdsRef.current = currentIds;
    if (!previousIds || typeof window.Notification === "undefined" || window.Notification.permission !== "granted") return;
    notifications
      .filter(notification =>
        ["carrier_submission", "portal_chat", "chat_mention"].includes(notification.entityType || "")
        && !previousIds.has(notification.id),
      )
      .forEach(item => {
        const browserNotification = item.entityType === "chat_mention"
          ? new window.Notification(item.title, { body: item.message })
          : new window.Notification(item.message);
        browserNotification.onclick = () => {
          window.focus();
          const actionUrl = normalizeCarrierChatUrl(item.actionUrl);
          setLocation(actionUrl || "/portal-submissions");
          if (item.entityType === "chat_mention" && actionUrl) {
            const params = new URL(actionUrl, window.location.origin).searchParams;
            window.dispatchEvent(new CustomEvent("team-chat:open", { detail: {
              channelId: params.get("channelId"), threadId: params.get("threadId"), messageId: params.get("messageId"),
            } }));
          }
          browserNotification.close();
        };
      });
  }, [notifications, setLocation]);

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: number) => {
      const managers = authUser?.role === "admin" || authUser?.role === "manager";
      const res = await fetch(managers ? `/api/internal/notifications/${notificationId}/read` : `/api/notifications/${notificationId}/read`, {
        method: managers ? "POST" : "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to mark as read");
      return res.json();
    },
    onSuccess: () => {
      setMarkReadError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
    onError: () => setMarkReadError("This notification could not be marked as read. Please try again."),
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const managers = authUser?.role === "admin" || authUser?.role === "manager";
      const res = await fetch(managers ? "/api/internal/notifications/read-all" : "/api/notifications/mark-all-read", {
        method: managers ? "POST" : "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to mark all as read");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const searchEnabled = debouncedSearchQuery.length >= 2;
  const { data: searchResults, isFetching: isSearching } = useQuery<SearchResults>({
    queryKey: ["/api/search", debouncedSearchQuery],
    enabled: searchEnabled,
    queryFn: async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(debouncedSearchQuery)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
  });
  const flattenedSearchResults = useMemo(
    () => searchResults?.groups.flatMap(group => group.results) ?? [],
    [searchResults],
  );
  const totalSearchResults = flattenedSearchResults.length;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setShowSearchResults(searchEnabled && (!!searchResults || isSearching));
    setActiveSearchIndex(-1);
  }, [searchEnabled, searchResults, isSearching]);

  useEffect(() => {
    setSearchQuery("");
    setShowSearchResults(false);
    setActiveSearchIndex(-1);
  }, [location]);

  const handleNotificationClick = (n: AppNotification) => {
    const notificationUrl = n.actionUrl;
    const url = normalizeCarrierChatUrl(notificationUrl);
    let metadata: Record<string, unknown> | null = null;
    try {
      metadata = n.metadata ? JSON.parse(n.metadata) : null;
    } catch {
      metadata = null;
    }
    const isAdminRequestInfo = metadata?.trigger === "admin_request_info";

    if (url && !isAdminRequestInfo) {
      if (!n.read) markAsReadMutation.mutate(n.id);
      if (n.entityType === "broker_response") setNotificationMenuOpen(false);
      setLocation(url);
      if (n.entityType === "chat_mention") {
        const params = new URL(url, window.location.origin).searchParams;
        window.dispatchEvent(new CustomEvent("team-chat:open", { detail: {
          channelId: params.get("channelId"), threadId: params.get("threadId"), messageId: params.get("messageId"),
        } }));
      }
      return;
    }

    setNotificationMenuOpen(false);
    setMarkReadError(null);
    // Let Radix finish dismissing the controlled dropdown before opening the dialog.
    window.setTimeout(() => {
      if (selectedNotificationUserRef.current !== n.userId) return;
      setSelectedNotification(n);
      setNotificationDialogOpen(true);
      if (!n.read) markAsReadMutation.mutate(n.id);
    }, 0);
  };

  useEffect(() => {
    const userId = authUser?.id ?? null;
    if (selectedNotificationUserRef.current === userId) return;
    selectedNotificationUserRef.current = userId;
    setSelectedNotification(null);
    setNotificationDialogOpen(false);
    setMarkReadError(null);
  }, [authUser?.id]);

  const openSelectedNotificationUrl = () => {
    if (!selectedNotification?.actionUrl) return;
    const url = normalizeCarrierChatUrl(selectedNotification.actionUrl);
    if (!url) return;
    setNotificationDialogOpen(false);
    setSelectedNotification(null);
    setLocation(url);
    if (selectedNotification.entityType === "chat_mention") {
      const params = new URL(url, window.location.origin).searchParams;
      window.dispatchEvent(new CustomEvent("team-chat:open", { detail: {
        channelId: params.get("channelId"), threadId: params.get("threadId"), messageId: params.get("messageId"),
      } }));
    }
  };

  const handleSearchItemClick = (item: SearchResultItem) => {
    setSearchQuery("");
    setShowSearchResults(false);
    setActiveSearchIndex(-1);
    setLocation(item.href);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setShowSearchResults(false);
      setActiveSearchIndex(-1);
      return;
    }
    if (!showSearchResults || flattenedSearchResults.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchIndex(index => (index + 1) % flattenedSearchResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchIndex(index => index <= 0 ? flattenedSearchResults.length - 1 : index - 1);
    } else if (event.key === "Enter" && activeSearchIndex >= 0) {
      event.preventDefault();
      handleSearchItemClick(flattenedSearchResults[activeSearchIndex]);
    }
  };

  const quickActions = [
    { label: "Carriers",   icon: Users,     action: () => setLocation("/clients") },
    { label: "Invoices",   icon: FileText,  action: () => setLocation("/invoices") },
    { label: "Brokers",    icon: BadgeCheck, action: () => setLocation("/brokers") },
    { label: "Follow Ups", icon: Clock,     action: () => setLocation("/follow-up") },
  ];

  const pagesWithHomeButton = [
    "/clients", "/invoices", "/factoring", "/tasks", "/documents",
    "/fuel-cards", "/credit-checks", "/reports", "/fuel-card-admin",
    "/admin", "/activities", "/brokers", "/collections", "/vault",
    "/help", "/payouts",
  ];
  const showHomeButton = pagesWithHomeButton.some((page) => location.startsWith(page));

  const displayFirstName = authUser?.firstName || "";
  const displayLastName = authUser?.lastName || "";
  const fullName = `${displayFirstName} ${displayLastName}`.trim() || "Agent";
  const userRole = authUser?.role || "Employee";
  const avatarSrc = authUser?.profileImageUrl || "";
  const initials = fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  const filteredNotifications = notifFilter === "unread"
    ? notifications.filter((n) => !n.read)
    : notifications;
  let selectedMetadata: Record<string, unknown> | null = null;
  try {
    selectedMetadata = selectedNotification?.metadata ? JSON.parse(selectedNotification.metadata) : null;
  } catch {
    selectedMetadata = null;
  }
  const selectedMessage = selectedNotification?.message
    || (typeof selectedMetadata?.emailBody === "string" ? selectedMetadata.emailBody : "")
    || "No message content is available.";

  return (
    <>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[290px] p-0 sm:max-w-none">
          <Sidebar mobile onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <header className={cn(
        "ff-top-nav sticky top-0 z-30 px-4 py-3",
        neu
          ? "ff-neu-top-nav border-0 bg-[#e0e0e0]"
          : "border-b-2 border-[#808080] !bg-[#c0c0c0]",
      )}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-4 lg:flex-row lg:items-center">
            <div className="flex min-w-0 items-start gap-3">
              {neu ? <NeuButton
                aria-label="Open navigation"
                className="mt-1 h-10 w-10 shrink-0 p-0 md:hidden"
                onClick={() => setMobileNavOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </NeuButton> : <Button
                variant="ghost"
                size="icon"
                 className="mt-1 h-10 w-10 shrink-0 rounded-sm border-2 border-[#808080] bg-white md:hidden"
                onClick={() => setMobileNavOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>}
              <div className="min-w-0">
                {group && (
                    <div className={cn("mb-1 flex items-center gap-1 text-[11px] font-medium", neu ? "text-[#7c8983]" : "text-[#444]")}>
                    <span>{group}</span>
                    <ChevronRight className="h-3 w-3" />
                     <span className={neu ? "text-[#394541]" : "text-[#1a1a1a]"}>{title}</span>
                  </div>
                )}
                <h1 className={cn("truncate text-xl font-bold tracking-tight", neu ? "text-[#394541]" : "text-[#1a1a1a]")}>{title}</h1>
                 {subtitle && <p className={cn("mt-0.5 truncate text-sm", neu ? "text-[#7d8883]" : "text-[#444]")}>{subtitle}</p>}
              </div>
            </div>

            <div className="relative w-full max-w-2xl lg:ml-4" ref={searchRef}>
               <Search className={cn("pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2", neu ? "text-[#8b9691]" : "text-[#666]")} />
              {neu ? <NeuInput
                type="text"
                placeholder="Search carriers, load ledger, counterparties..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setActiveSearchIndex(-1);
                  if (e.target.value.trim().length < 2) setShowSearchResults(false);
                }}
                onFocus={() => searchEnabled && setShowSearchResults(true)}
                onKeyDown={handleSearchKeyDown}
                role="combobox"
                aria-expanded={showSearchResults}
                aria-controls="global-search-results"
                className="ff-neu-top-search h-12 w-full pl-11 pr-4 text-sm"
              /> : <Input
                type="text"
                placeholder="Search carriers, load ledger, counterparties..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setActiveSearchIndex(-1);
                  if (e.target.value.trim().length < 2) setShowSearchResults(false);
                }}
                onFocus={() => searchEnabled && setShowSearchResults(true)}
                onKeyDown={handleSearchKeyDown}
                role="combobox"
                aria-expanded={showSearchResults}
                aria-controls="global-search-results"
                className="qc-topbar-search h-12 w-full pl-11 pr-4 text-sm"
              />}
              {showSearchResults && (
                  <div id="global-search-results" className={cn("ff-top-nav-menu absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden", neu ? "ff-neu-menu rounded-2xl bg-[#e0e0e0] shadow-[7px_7px_16px_#c1c5c2,-7px_-7px_16px_#fff]" : "rounded-sm border-2 border-[#808080] bg-white shadow-[2px_2px_0_#404040]")}>
                  <div className="custom-scrollbar max-h-96 overflow-y-auto p-2">
                    {isSearching ? (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">Searching...</div>
                    ) : (
                      <>
                        {searchResults?.groups.map((group, groupIndex) => {
                          const priorCount = searchResults.groups
                            .slice(0, groupIndex)
                            .reduce((count, priorGroup) => count + priorGroup.results.length, 0);
                          return (
                            <div key={group.type} className={cn(groupIndex > 0 && "border-t border-slate-100 pt-2")}>
                              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{group.label}</div>
                              {group.results.map((item, itemIndex) => {
                                const resultIndex = priorCount + itemIndex;
                                return (
                                  <button
                                    key={`${group.type}-${item.id}`}
                                    type="button"
                                    onMouseEnter={() => setActiveSearchIndex(resultIndex)}
                                    onClick={() => handleSearchItemClick(item)}
                                    className={cn(
                                      "flex w-full items-start gap-3 rounded-sm px-3 py-3 text-left hover:bg-[#dff5f6]",
                                      activeSearchIndex === resultIndex && "bg-[#dff5f6]",
                                    )}
                                  >
                                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[#c0c0c0] bg-[#dff5f6] text-[#098b9f]">
                                      <Search className="h-4 w-4" />
                                    </div>
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-semibold text-slate-900">{item.title}</div>
                                      {item.subtitle && <div className="truncate text-xs text-slate-500">{item.subtitle}</div>}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })}
                        {searchEnabled && totalSearchResults === 0 && (
                          <div className="px-4 py-8 text-center text-sm text-slate-500">No results for "{debouncedSearchQuery}"</div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {showHomeButton && (
              neu ? <NeuButton onClick={() => setLocation("/")}
                className="h-11 px-4 text-[#27aab8] transition-colors duration-200 hover:bg-[#27aab8] hover:text-white">
                <Home className="mr-2 h-4 w-4" />
                Home
              </NeuButton> : <Button variant="outline" size="sm" onClick={() => setLocation("/")}
                 className="h-11 rounded-sm border-2 border-[#808080] bg-[#d4d0c8] px-4 text-[#1a1a1a] hover:bg-[#dff5f6]">
                <Home className="mr-2 h-4 w-4" />
                Home
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                 {neu ? <NeuButton className="ff-neu-new-button h-11 rounded-xl px-4">
                   <Plus className="mr-2 h-4 w-4" />New<ChevronDown className="ml-2 h-4 w-4" />
                 </NeuButton> : <Button className="h-11 rounded-sm border-2 border-[#fff] bg-[#27aab8] px-4 text-white shadow-[2px_2px_0_#404040] hover:bg-[#098b9f]">
                  <Plus className="mr-2 h-4 w-4" />
                  New
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>}
              </DropdownMenuTrigger>
               <DropdownMenuContent align="end" className={cn("w-56 p-2", neu ? "ff-neu-menu rounded-2xl bg-[#e0e0e0] shadow-[7px_7px_16px_#c1c5c2,-7px_-7px_16px_#fff]" : "rounded-sm border-2 border-[#808080] bg-[#fff] shadow-[2px_2px_0_#404040]")}>
                {quickActions.map((action) => (
                   <DropdownMenuItem key={action.label} onClick={action.action} className="cursor-pointer rounded-sm px-3 py-2.5">
                    <action.icon className="mr-2 h-4 w-4" />
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {actions}

            {/* ── Notification Bell ── */}
            <DropdownMenu open={notificationMenuOpen} onOpenChange={setNotificationMenuOpen}>
              <DropdownMenuTrigger asChild>
                {neu ? <NeuButton
                    aria-label="Notifications"
                    aria-haspopup="menu"
                    aria-expanded={notificationMenuOpen}
                    className="relative h-10 w-10 rounded-xl p-0 text-[#53605b] shadow-[4px_4px_9px_#c1c5c2,-4px_-4px_9px_#fff]">
                    <Bell className="h-5 w-5 text-[#53605b]" />
                     {unreadCount > 0 && <span role="status" aria-label={`${unreadCount} unread notifications`} className="ff-neu-notification-count absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px]">{unreadCount > 99 ? "99+" : unreadCount}</span>}
                  </NeuButton> : <Button variant="ghost" size="sm"
                    aria-label="Notifications"
                    aria-haspopup="menu"
                    aria-expanded={notificationMenuOpen}
                   className="relative h-9 w-9 rounded-sm border-2 border-[#808080] bg-white hover:bg-[#dff5f6]">
                   <Bell className="h-5 w-5 text-[#1a1a1a]" />
                  {unreadCount > 0 && (
                    <Badge variant="destructive"
                      aria-label={`${unreadCount} unread notifications`}
                      className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px]">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </Badge>
                  )}
                </Button>}
              </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className={cn("ff-notification-panel w-[min(380px,calc(100vw-1rem))] p-0", neu ? "ff-neu-menu rounded-2xl bg-[#e0e0e0] shadow-[7px_7px_16px_#c1c5c2,-7px_-7px_16px_#fff]" : "rounded-sm border-2 border-[#808080] bg-white shadow-[2px_2px_0_#404040]")}>
                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {unreadCount > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => markAllAsReadMutation.mutate()}
                        disabled={markAllAsReadMutation.isPending}
                        className="h-7 gap-1 rounded-lg px-2 text-xs text-slate-500 hover:text-slate-700">
                        <CheckCheck className="h-3.5 w-3.5" />
                        Mark all read
                      </Button>
                    )}
                  </div>
                </div>

                {/* Filter tabs */}
                <div className="flex gap-1 border-b border-slate-100 dark:border-slate-800 px-3 py-2">
                  {(["all", "unread"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setNotifFilter(f)}
                      className={cn(
                        "rounded-lg px-3 py-1 text-xs font-medium capitalize transition-colors",
                        notifFilter === f
                          ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                          : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                      )}
                    >
                      {f}
                      {f === "unread" && unreadCount > 0 && (
                        <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] text-white">
                          {unreadCount}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Notification list */}
                <div className="custom-scrollbar max-h-[380px] overflow-y-auto p-2">
                  {filteredNotifications.length > 0 ? (
                    filteredNotifications.map((notification) => {
                      const notifType = (notification.type || "info") as keyof typeof NOTIF_ICON;
                      const iconData = NOTIF_ICON[notifType] ?? NOTIF_ICON.info;
                      const IconComp = iconData.icon;
                      let agingSeverity: "red" | "amber" | null = null;
                      try {
                        const metadata = notification.metadata ? JSON.parse(notification.metadata) : null;
                        if (metadata?.category === "invoice_aging" && (metadata.severity === "red" || metadata.severity === "amber")) agingSeverity = metadata.severity;
                      } catch { /* legacy notification metadata may not be JSON */ }
                      return (
                        <button
                          key={notification.id}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800",
                            !notification.read && "bg-blue-50/50 dark:bg-blue-950/10",
                            notification.entityType === "chat_mention" && "border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/20"
                          )}
                          onClick={() => handleNotificationClick(notification)}
                        >
                          <div className={cn("mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg", iconData.className)}>
                            <IconComp className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={cn("text-sm font-medium text-slate-900 dark:text-white leading-snug", !notification.read && "font-semibold")}>
                              {notification.title}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                              {notification.message}
                            </p>
                            <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                              <Clock className="h-2.5 w-2.5" />
                              {timeAgo(notification.createdAt)}
                            </p>
                          </div>
                          {!notification.read && (
                            <div className={cn("mt-2 h-2 w-2 flex-shrink-0 rounded-full", agingSeverity === "red" ? "bg-red-500" : agingSeverity === "amber" ? "bg-amber-500" : "bg-blue-500")} />
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
                        <Bell className="h-6 w-6 text-slate-300 dark:text-slate-600" />
                      </div>
                      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                        {notifFilter === "unread" ? "No unread notifications" : "No notifications yet"}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {notifFilter === "unread" ? "You're all caught up!" : "Activity will appear here"}
                      </p>
                    </div>
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {authUser?.id && <TimeClock key={authUser.id} />}

            {/* ── User menu ── */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {neu ? <NeuButton
                  className="h-10 rounded-xl px-2 pr-3 text-[#53605b] shadow-[4px_4px_9px_#c1c5c2,-4px_-4px_9px_#fff]">
                  <div className="ff-neu-profile-avatar mr-2 flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-[#27aab8] text-[10px] font-bold text-white">
                    {avatarSrc ? <img src={avatarSrc} alt="User Profile" className="h-full w-full object-cover" /> : initials}
                  </div>
                  <div className="hidden text-left md:block">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-[#394541]">{fullName}</p>
                      {authUser?.verified && <BadgeCheck className="h-4 w-4 flex-shrink-0 text-[#168f99]" />}
                    </div>
                    <p className="text-xs capitalize text-[#7d8883]">{userRole}</p>
                  </div>
                  <ChevronDown className="ml-2 h-4 w-4 text-[#7d8883]" />
                </NeuButton> : <Button variant="ghost"
                  className="h-9 rounded-sm border-2 border-[#808080] bg-white px-2 pr-3 hover:bg-[#dff5f6]">
                  <div className="mr-2 flex h-7 w-7 items-center justify-center overflow-hidden rounded-sm border border-[#808080] bg-[#098b9f] text-[10px] font-bold text-white">
                    {avatarSrc ? <img src={avatarSrc} alt="User Profile" className="h-full w-full object-cover" /> : initials}
                  </div>
                  <div className="hidden text-left md:block">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{fullName}</p>
                      {authUser?.verified && <BadgeCheck className="h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />}
                    </div>
                    <p className="text-xs capitalize text-slate-500 dark:text-slate-400">{userRole}</p>
                  </div>
                  <ChevronDown className="ml-2 h-4 w-4 text-slate-500" />
                </Button>}
              </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className={cn("w-56 p-2", neu ? "ff-neu-menu rounded-2xl bg-[#e0e0e0] shadow-[7px_7px_16px_#c1c5c2,-7px_-7px_16px_#fff]" : "rounded-sm border-2 border-[#808080] bg-white shadow-[2px_2px_0_#404040]")}>
                <div className="px-3 py-2">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{fullName}</p>
                  <p className="text-xs capitalize text-slate-500 dark:text-slate-400">{userRole}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setLocation("/profile")} className="cursor-pointer rounded-xl px-3 py-2.5">
                  <UserIcon className="mr-2 h-4 w-4" /> Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLocation("/settings")} className="cursor-pointer rounded-xl px-3 py-2.5">
                  <Settings className="mr-2 h-4 w-4" /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="cursor-pointer rounded-xl px-3 py-2.5 text-red-600 dark:text-red-400 focus:text-red-600">
                  <LogOut className="mr-2 h-4 w-4" /> Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <Dialog
        open={notificationDialogOpen}
        onOpenChange={(open) => {
          setNotificationDialogOpen(open);
          if (!open) {
            setSelectedNotification(null);
            setMarkReadError(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-xl flex-col gap-4 overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle className="break-words text-lg font-bold leading-snug text-[#1a1a1a]">
              {selectedNotification?.title || "Notification"}
            </DialogTitle>
            <DialogDescription className="sr-only">Full notification message</DialogDescription>
          </DialogHeader>
          <div
            className="custom-scrollbar max-h-[min(55dvh,32rem)] overflow-y-auto overscroll-contain rounded-sm border-2 border-[#808080] bg-white p-4 text-sm leading-relaxed text-[#1a1a1a] [overflow-wrap:anywhere] whitespace-pre-wrap"
            aria-label="Notification message"
          >
            {selectedMessage}
          </div>
          {markReadError && (
            <NeuNotice severity="block" role="alert" className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span>{markReadError}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={markAsReadMutation.isPending}
                onClick={() => {
                  if (!selectedNotification) return;
                  setMarkReadError(null);
                  markAsReadMutation.mutate(selectedNotification.id);
                }}
                className="rounded-sm border-2 border-[#808080] bg-[#d4d0c8] text-[#1a1a1a]"
              >
                {markAsReadMutation.isPending ? "Retrying…" : "Retry"}
              </Button>
            </NeuNotice>
          )}
          {selectedNotification?.actionUrl && (
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={openSelectedNotificationUrl}
                className="rounded-sm border-2 border-[#fff] bg-[#27aab8] text-white shadow-[2px_2px_0_#404040] hover:bg-[#098b9f]"
              >
                Open related item
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
