import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { Client, Invoice, Load, Notification } from "@shared/schema";
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
  FolderOpen,
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

interface TopNavProps {
  title: string;
  subtitle?: string;
  group?: string;
}

interface SearchResults {
  clients?: Client[];
  invoices?: Invoice[];
  loads?: Load[];
}

function useDebouncedValue<T>(value: T, delay = 250) {
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

export default function TopNav({ title, subtitle, group }: TopNavProps) {
  const { user: authUser, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [notifFilter, setNotifFilter] = useState<"all" | "unread">("all");
  const searchRef = useRef<HTMLDivElement>(null);
  const debouncedSearchQuery = useDebouncedValue(searchQuery.trim(), 250);

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    retry: false,
    staleTime: 20000,
    refetchInterval: 30000,
  });

  const { data: unreadCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    retry: false,
    staleTime: 20000,
    refetchInterval: 30000,
  });
  const unreadCount = unreadCountData?.count ?? 0;

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: number) => {
      const res = await fetch(`/api/notifications/${notificationId}/read`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to mark as read");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notifications/mark-all-read", {
        method: "PATCH",
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

  const searchEnabled = debouncedSearchQuery.length > 2;
  const { data: searchResults, isFetching: isSearching } = useQuery<SearchResults>({
    queryKey: ["/api/search", debouncedSearchQuery],
    enabled: searchEnabled,
    queryFn: async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(debouncedSearchQuery)}`, { credentials: "include" });
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
  });
  const totalSearchResults = useMemo(() => (
    (searchResults?.clients?.length ?? 0) +
    (searchResults?.invoices?.length ?? 0) +
    (searchResults?.loads?.length ?? 0)
  ), [searchResults]);

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
  }, [searchEnabled, searchResults, isSearching]);

  const handleNotificationClick = (n: Notification) => {
    if (!n.read) markAsReadMutation.mutate(n.id);
    const url = (n as any).actionUrl;
    if (url) setLocation(url);
  };

  const handleSearchItemClick = (type: "client" | "invoice" | "load") => {
    setSearchQuery("");
    setShowSearchResults(false);
    const routes = { client: "/clients", invoice: "/invoices", load: "/loads" };
    setLocation(routes[type]);
  };

  const quickActions = [
    { label: "New Load Entry",   icon: FileText,  action: () => setLocation("/invoices")  },
    { label: "Add Carrier",      icon: Users,     action: () => setLocation("/clients")   },
    { label: "Upload Evidence",  icon: FolderOpen, action: () => setLocation("/documents") },
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
  const avatarSrc =
    authUser?.profileImageUrl ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=2563EB&color=fff`;

  const filteredNotifications = notifFilter === "unread"
    ? notifications.filter((n) => !n.read)
    : notifications;

  return (
    <>
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[290px] p-0 sm:max-w-none">
          <Sidebar mobile onNavigate={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <header className="sticky top-0 z-30 border-b border-[hsl(var(--border))] bg-white/90 px-6 py-4 backdrop-blur dark:bg-[hsl(var(--card))]/90">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-4 lg:flex-row lg:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="mt-1 h-10 w-10 shrink-0 rounded-xl border border-slate-200 bg-white md:hidden dark:border-slate-800 dark:bg-slate-900"
                onClick={() => setMobileNavOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div className="min-w-0">
                {group && (
                  <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
                    <span>{group}</span>
                    <ChevronRight className="h-3 w-3" />
                    <span className="text-slate-500 dark:text-slate-400">{title}</span>
                  </div>
                )}
                <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
                {subtitle && <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
              </div>
            </div>

            <div className="relative w-full max-w-2xl lg:ml-4" ref={searchRef}>
              <Search className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="text"
                placeholder="Search carriers, load ledger, counterparties..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchEnabled && setShowSearchResults(true)}
                className="qc-topbar-search h-12 w-full pl-11 pr-4 text-sm"
              />
              {showSearchResults && (
                <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.14)] dark:bg-slate-900">
                  <div className="custom-scrollbar max-h-96 overflow-y-auto p-2">
                    {isSearching ? (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">Searching...</div>
                    ) : (
                      <>
                        {searchResults?.clients && searchResults.clients.length > 0 && (
                          <div className="mb-2">
                            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Clients</div>
                            {searchResults.clients.slice(0, 3).map((client) => (
                              <button key={`client-${client.id}`} type="button" onClick={() => handleSearchItemClick("client")}
                                className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"><Users className="h-4 w-4" /></div>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{client.name}</div>
                                  <div className="truncate text-xs text-slate-500">{client.contactPerson}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        {searchResults?.invoices && searchResults.invoices.length > 0 && (
                          <div className="mb-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Invoices</div>
                            {searchResults.invoices.slice(0, 3).map((invoice) => (
                              <button key={`invoice-${invoice.id}`} type="button" onClick={() => handleSearchItemClick("invoice")}
                                className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"><FileText className="h-4 w-4" /></div>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">Invoice #{invoice.invoiceNumber}</div>
                                  <div className="truncate text-xs text-slate-500">${invoice.amount}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                        {searchResults?.loads && searchResults.loads.length > 0 && (
                          <div className="border-t border-slate-100 pt-2 dark:border-slate-800">
                            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Loads</div>
                            {searchResults.loads.slice(0, 3).map((load) => (
                              <button key={`load-${load.id}`} type="button" onClick={() => handleSearchItemClick("load")}
                                className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800">
                                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"><FolderOpen className="h-4 w-4" /></div>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">Load #{load.id}</div>
                                  <div className="truncate text-xs text-slate-500">{(load as any).pickupLocation} → {(load as any).deliveryLocation}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
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
              <Button variant="outline" size="sm" onClick={() => setLocation("/")}
                className="h-11 rounded-xl border-blue-200 bg-white px-4 text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:bg-slate-900 dark:text-blue-400 dark:hover:bg-blue-950/20">
                <Home className="mr-2 h-4 w-4" />
                Home
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="h-11 rounded-xl bg-blue-600 px-4 text-white shadow-[0_10px_24px_rgba(37,99,235,0.22)] hover:bg-blue-700">
                  <Plus className="mr-2 h-4 w-4" />
                  New
                  <ChevronDown className="ml-2 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-2xl border border-[hsl(var(--border))] p-2">
                {quickActions.map((action) => (
                  <DropdownMenuItem key={action.label} onClick={action.action} className="cursor-pointer rounded-xl px-3 py-2.5">
                    <action.icon className="mr-2 h-4 w-4" />
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* ── Notification Bell ── */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm"
                  className="relative h-11 w-11 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800">
                  <Bell className="h-5 w-5 text-slate-700 dark:text-slate-300" />
                  {unreadCount > 0 && (
                    <Badge variant="destructive"
                      className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px]">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-[380px] rounded-2xl border border-[hsl(var(--border))] p-0">
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
                      return (
                        <button
                          key={notification.id}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800",
                            !notification.read && "bg-blue-50/50 dark:bg-blue-950/10"
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
                            <div className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
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

            {/* ── User menu ── */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost"
                  className="h-11 rounded-xl border border-slate-200 bg-white px-2 pr-3 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800">
                  <div className="mr-3 h-8 w-8 overflow-hidden rounded-full border border-slate-200 dark:border-slate-700">
                    <img src={avatarSrc} alt="User Profile" className="h-full w-full object-cover"
                      onError={(e) => { e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=2563EB&color=fff`; }} />
                  </div>
                  <div className="hidden text-left md:block">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{fullName}</p>
                      {authUser?.verified && <BadgeCheck className="h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />}
                    </div>
                    <p className="text-xs capitalize text-slate-500 dark:text-slate-400">{userRole}</p>
                  </div>
                  <ChevronDown className="ml-2 h-4 w-4 text-slate-500" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-2xl border border-[hsl(var(--border))] p-2">
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
    </>
  );
}
