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
  User as UserIcon,
  Settings,
  LogOut,
  FileText,
  Users,
  FolderOpen,
  Home,
  Menu,
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

export default function TopNav({ title, subtitle }: TopNavProps) {
  const { user: authUser, logout } = useAuth();
  const [location, setLocation] = useLocation();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const debouncedSearchQuery = useDebouncedValue(searchQuery.trim(), 250);

  const { data: notifications = [], error: notificationsError } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    retry: false,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  const { data: unreadCountData, error: unreadCountError } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    retry: false,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  const unreadCount = unreadCountData?.count ?? 0;

  useEffect(() => {
    if (notificationsError) {
      console.error("Notifications fetch error:", notificationsError);
    }
    if (unreadCountError) {
      console.error("Unread count fetch error:", unreadCountError);
    }
  }, [notificationsError, unreadCountError]);

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: number) => {
      const response = await fetch(`/api/notifications/${notificationId}/read`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to mark notification as read: ${response.statusText}`);
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
    onError: (error) => {
      console.error("Failed to mark notification as read:", error);
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/notifications/mark-all-read", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to mark all notifications as read: ${response.statusText}`);
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
    onError: (error) => {
      console.error("Failed to mark all as read:", error);
    },
  });

  const searchEnabled = debouncedSearchQuery.length > 2;

  const { data: searchResults, isFetching: isSearching } = useQuery<SearchResults>({
    queryKey: ["/api/search", debouncedSearchQuery],
    enabled: searchEnabled,
    queryFn: async () => {
      const response = await fetch(`/api/search?q=${encodeURIComponent(debouncedSearchQuery)}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`);
      }

      return response.json();
    },
  });

  const totalSearchResults = useMemo(() => {
    return (
      (searchResults?.clients?.length ?? 0) +
      (searchResults?.invoices?.length ?? 0) +
      (searchResults?.loads?.length ?? 0)
    );
  }, [searchResults]);

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

  const handleNotificationClick = (notificationId: number, isRead: boolean) => {
    if (!isRead) {
      markAsReadMutation.mutate(notificationId);
    }
  };

  const handleLogout = () => {
    logout();
  };

  const handleSearchItemClick = (type: "client" | "invoice" | "load") => {
    setSearchQuery("");
    setShowSearchResults(false);

    switch (type) {
      case "client":
        setLocation("/clients");
        break;
      case "invoice":
        setLocation("/invoices");
        break;
      case "load":
        setLocation("/loads");
        break;
    }
  };

  const quickActions = [
    { label: "New Invoice", icon: FileText, action: () => setLocation("/invoices") },
    { label: "Add Client", icon: Users, action: () => setLocation("/clients") },
    { label: "Upload Document", icon: FolderOpen, action: () => setLocation("/documents") },
  ];

  const pagesWithHomeButton = [
    "/clients",
    "/invoices",
    "/factoring",
    "/tasks",
    "/documents",
    "/fuel-cards",
    "/credit-checks",
    "/reports",
    "/fuel-card-admin",
    "/admin",
    "/activities",
    "/brokers",
    "/collections",
    "/vault",
    "/help",
  ];

  const showHomeButton = pagesWithHomeButton.some((page) => location.startsWith(page));

  const fullName = `${authUser?.firstName || "Admin"} ${authUser?.lastName || "User"}`;
  const userRole = authUser?.role || "Employee";
  const avatarSrc =
    authUser?.profileImageUrl ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=2563EB&color=fff`;

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
                <h1 className="truncate text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">
                    {subtitle}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="relative w-full max-w-2xl lg:ml-4" ref={searchRef}>
              <Search className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="text"
                placeholder="Search loads, invoices, clients..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchEnabled && setShowSearchResults(true)}
                className="qc-topbar-search h-12 w-full pl-11 pr-4 text-sm"
              />

              {showSearchResults && (
                <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.14)] dark:bg-slate-900">
                  <div className="custom-scrollbar max-h-96 overflow-y-auto p-2">
                    {isSearching ? (
                      <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                        Searching...
                      </div>
                    ) : (
                      <>
                        {searchResults?.clients && searchResults.clients.length > 0 && (
                          <div className="mb-2">
                            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                              Clients
                            </div>
                            {searchResults.clients.slice(0, 3).map((client) => (
                              <button
                                key={`client-${client.id}`}
                                type="button"
                                onClick={() => handleSearchItemClick("client")}
                                className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                              >
                                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                                  <Users className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                    {client.name}
                                  </div>
                                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                                    {client.contactPerson}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}

                        {searchResults?.invoices && searchResults.invoices.length > 0 && (
                          <div className="mb-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                              Invoices
                            </div>
                            {searchResults.invoices.slice(0, 3).map((invoice) => (
                              <button
                                key={`invoice-${invoice.id}`}
                                type="button"
                                onClick={() => handleSearchItemClick("invoice")}
                                className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                              >
                                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                                  <FileText className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                    Invoice #{invoice.invoiceNumber}
                                  </div>
                                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                                    Load #{invoice.loadId} • ${invoice.amount}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}

                        {searchResults?.loads && searchResults.loads.length > 0 && (
                          <div className="border-t border-slate-100 pt-2 dark:border-slate-800">
                            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                              Loads
                            </div>
                            {searchResults.loads.slice(0, 3).map((load) => (
                              <button
                                key={`load-${load.id}`}
                                type="button"
                                onClick={() => handleSearchItemClick("load")}
                                className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                              >
                                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                                  <FolderOpen className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                    Load #{load.id}
                                  </div>
                                  <div className="truncate text-xs text-slate-500 dark:text-slate-400">
                                    {load.pickupLocation} → {load.deliveryLocation}
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}

                        {searchEnabled && totalSearchResults === 0 && (
                          <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                            No results found for "{debouncedSearchQuery}"
                          </div>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLocation("/")}
                className="h-11 rounded-xl border-blue-200 bg-white px-4 text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:bg-slate-900 dark:text-blue-400 dark:hover:bg-blue-950/20"
              >
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
                  <DropdownMenuItem
                    key={action.label}
                    onClick={action.action}
                    className="cursor-pointer rounded-xl px-3 py-2.5"
                  >
                    <action.icon className="mr-2 h-4 w-4" />
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="relative h-11 w-11 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  <Bell className="h-5 w-5 text-slate-700 dark:text-slate-300" />
                  {unreadCount > 0 && (
                    <Badge
                      variant="destructive"
                      className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px]"
                    >
                      {unreadCount}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-96 rounded-2xl border border-[hsl(var(--border))] p-0">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Notifications
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Recent system activity
                    </p>
                  </div>

                  {unreadCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markAllAsReadMutation.mutate()}
                      disabled={markAllAsReadMutation.isPending}
                      className="h-8 rounded-lg px-2 text-xs"
                    >
                      {markAllAsReadMutation.isPending ? "Marking..." : "Mark all read"}
                    </Button>
                  )}
                </div>

                <div className="custom-scrollbar max-h-96 overflow-y-auto p-2">
                  {notifications.length > 0 ? (
                    notifications.map((notification) => (
                      <DropdownMenuItem
                        key={notification.id}
                        className="cursor-pointer rounded-xl px-3 py-3"
                        onClick={() => handleNotificationClick(notification.id, notification.read)}
                      >
                        <div className="flex w-full items-start gap-3">
                          <div
                            className={cn(
                              "mt-1.5 h-2.5 w-2.5 rounded-full",
                              !notification.read ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600"
                            )}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-slate-900 dark:text-white">
                              {notification.message}
                            </p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {notification.createdAt
                                ? new Date(notification.createdAt).toLocaleString()
                                : "Just now"}
                            </p>
                          </div>
                        </div>
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                      No notifications
                    </div>
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-11 rounded-xl border border-slate-200 bg-white px-2 pr-3 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  <div className="mr-3 h-8 w-8 overflow-hidden rounded-full border border-slate-200 dark:border-slate-700">
                    <img
                      src={avatarSrc}
                      alt="User Profile"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(
                          fullName
                        )}&background=2563EB&color=fff`;
                      }}
                    />
                  </div>

                  <div className="hidden text-left md:block">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {fullName}
                    </p>
                    <p className="text-xs capitalize text-slate-500 dark:text-slate-400">
                      {userRole}
                    </p>
                  </div>

                  <ChevronDown className="ml-2 h-4 w-4 text-slate-500" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-52 rounded-2xl border border-[hsl(var(--border))] p-2">
                <DropdownMenuItem asChild className="rounded-xl px-3 py-2.5">
                  <Link to="/profile" className="flex cursor-pointer items-center">
                    <UserIcon className="mr-2 h-4 w-4" />
                    Profile
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuItem asChild className="rounded-xl px-3 py-2.5">
                  <Link to="/settings" className="flex cursor-pointer items-center">
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={handleLogout}
                  className="flex cursor-pointer items-center rounded-xl px-3 py-2.5 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/20"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
    </>
  );
}