import React, { createContext, ReactNode, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import { useLocation } from "wouter";
import { createPermissionRefresh, samePermissions } from "@/lib/permission-refresh";
import { toast } from "@/hooks/use-toast";
import { clearStaffDataCache } from "@/lib/queryClient";

interface User {
  id: string;
  username: string;
  role: string;
  name?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  verified?: boolean;
  profileImageUrl?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  permissions: string[];
  permissionsLoaded: boolean;
  permissionsLoading: boolean;
  permissionsReadyForRoute: boolean;
  permissionsError: string | null;
  refreshPermissions: () => Promise<void>;
  hasPermission: (key: string) => boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);
type StaffIdentity = Pick<AuthContextType, "user" | "permissions" | "permissionsLoaded" | "isLoading">;
const StaffIdentityContext = createContext<StaffIdentity | null>(null);

async function fetchPermissions(): Promise<string[]> {
  const res = await fetch("/api/auth/permissions", { credentials: "include", cache: "no-store" });
  if (!res.ok) throw Object.assign(new Error("Unable to refresh access permissions. Please retry."), { status: res.status });
  const data = await res.json();
  if (!Array.isArray(data.permissions) || data.permissions.some((key: unknown) => typeof key !== "string")) {
    throw new Error("The server returned invalid permissions. Please retry.");
  }
  return data.permissions;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  const [permissionsLoading, setPermissionsLoading] = useState(true);
  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  const activeUser = useRef<string | undefined>();
  activeUser.current = user?.id;
  const refresh = useRef(createPermissionRefresh<string[]>());
  const refreshWarningShown = useRef(false);
  const lastPermissionPath = useRef(location);

  const clearSession = useCallback(() => {
    clearStaffDataCache();
    refresh.current.invalidate();
    activeUser.current = undefined;
    setUser(null);
    setIsAuthenticated(false);
    setPermissions([]);
    setPermissionsLoaded(false);
    setPermissionsLoading(false);
    setPermissionsError(null);
    localStorage.removeItem("isAuthenticated");
    localStorage.removeItem("user");
  }, []);

  const refreshPermissions = useCallback(async () => {
    const userId = user?.id;
    if (!userId) return;
    if (!permissionsLoaded) setPermissionsLoading(true);
    await refresh.current.run(userId, fetchPermissions, next => {
      if (activeUser.current !== userId) return;
      // An unchanged background result must not rerender every auth consumer.
      setPermissions(previous => samePermissions(previous, next) ? previous : next);
      setPermissionsLoaded(true);
      setPermissionsError(null);
      setPermissionsLoading(false);
      refreshWarningShown.current = false;
    }, error => {
      if (activeUser.current !== userId) return;
      if ((error as { status?: number })?.status === 401) {
        clearSession();
        return;
      }
      setPermissionsError(error instanceof Error ? error.message : "Unable to refresh permissions.");
      setPermissionsLoading(false);
      if (!refreshWarningShown.current) {
        refreshWarningShown.current = true;
        toast({ title: "Access refresh delayed", description: "Could not refresh your permissions. Retrying on your next navigation or focus.", variant: "destructive" });
      }
    });
  }, [user?.id, permissionsLoaded, clearSession]);

  const hasPermission = (key: string): boolean => {
    if (user?.role === "admin") return true;
    return permissions.includes(key);
  };

  const checkAuth = async () => {
    try {
      setPermissionsLoaded(false);
      setPermissionsLoading(true);
      console.log("Checking authentication...");
      const authFlag = localStorage.getItem("isAuthenticated");
      const userData = localStorage.getItem("user");

      console.log("LocalStorage - isAuthenticated:", authFlag, "userData:", !!userData);

      if (authFlag === "true" && userData) {
        const parsedUser = JSON.parse(userData);
        setUser(parsedUser);
        setIsAuthenticated(true);
        console.log("Setting authenticated state from localStorage");

        const response = await fetch("/api/auth/verify", { credentials: "include" });
        if (!response.ok) {
          console.log("Server verification failed, clearing auth state");
          localStorage.removeItem("isAuthenticated");
          localStorage.removeItem("user");
          setUser(null);
          setIsAuthenticated(false);
          setPermissions([]);
        } else {
          console.log("Server verification successful");
          const verifyData = await response.json();
          if (verifyData.user) {
            setUser(verifyData.user);
            localStorage.setItem("user", JSON.stringify(verifyData.user));
          }
          const perms = await fetchPermissions();
          setPermissions(perms);
          setPermissionsLoaded(true);
          setPermissionsError(null);
        }
      } else {
        console.log("No valid auth data in localStorage");
        setUser(null);
        setIsAuthenticated(false);
        setPermissions([]);
        setPermissionsLoaded(true);
      }
    } catch (error) {
      console.error("Auth check failed:", error);
      setUser(null);
      setIsAuthenticated(false);
      setPermissions([]);
      setPermissionsLoaded(true);
      localStorage.removeItem("isAuthenticated");
      localStorage.removeItem("user");
    } finally {
      setPermissionsLoading(false);
      setIsLoading(false);
    }
  };

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });

      if (response.ok) {
        const result = await response.json();
        // Finish the permission request before publishing authenticated state.
        // Otherwise the route-refresh effect starts a duplicate request.
        const perms = await fetchPermissions();
        clearStaffDataCache();
        refresh.current.invalidate();
        refreshWarningShown.current = false;
        lastPermissionPath.current = "/";
        localStorage.setItem("isAuthenticated", "true");
        localStorage.setItem("user", JSON.stringify(result.user));
        // Wouter's history update is synchronous. Commit the verified session
        // first, even when the prepared destination resolves in this microtask.
        flushSync(() => {
          setUser(result.user);
          setIsAuthenticated(true);
          setPermissions(perms);
          setPermissionsLoaded(true);
          setPermissionsError(null);
          setPermissionsLoading(false);
        });

        return true;
      }
      return false;
    } catch (error) {
      console.error("Login failed:", error);
      throw error;
    }
  };

  const logout = () => {
    clearSession();
    fetch("/api/auth/logout", { method: "POST" }).catch(console.error);
  };

  useEffect(() => {
    checkAuth();
  }, []);

  // Initial authentication still requires server verification and permissions.
  // Later navigations use that verified snapshot while revalidating in parallel.
  // Every staff API independently enforces current server-side permissions.
  useEffect(() => {
    if (!isAuthenticated || isLoading || location === "/login" || lastPermissionPath.current === location) return;
    lastPermissionPath.current = location;
    void refreshPermissions();
  }, [location, isAuthenticated, isLoading, refreshPermissions]);

  // Next-navigation refresh works across devices; focus and cross-tab signals
  // additionally refresh an already-open agent page without waiting for polling.
  useEffect(() => {
    if (!isAuthenticated) return;
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("factorflux-permissions") : null;
    const updated = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string }>).detail;
      channel?.postMessage(detail);
      if (detail?.userId === user?.id) void refreshPermissions();
    };
    if (channel) channel.onmessage = event => {
      if (event.data?.userId === user?.id) void refreshPermissions();
    };
    const focus = () => { void refreshPermissions(); };
    const visible = () => { if (document.visibilityState === "visible") focus(); };
    window.addEventListener("factorflux:permissions-changed", updated);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    const interval = setInterval(focus, 60000);
    return () => {
      clearInterval(interval);
      channel?.close();
      window.removeEventListener("factorflux:permissions-changed", updated);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [isAuthenticated, user?.id, refreshPermissions]);

  // Background permission-request status is not a change of staff identity.
  // Keep large page trees and the persistent rail subscribed to real identity/
  // permission changes, without withholding status from auth controls.
  const staffIdentity = useMemo(() => ({ user, permissions, permissionsLoaded, isLoading }),
    [user, permissions, permissionsLoaded, isLoading]);
  return (
    <StaffIdentityContext.Provider value={staffIdentity}><AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        permissions,
        permissionsLoaded,
        permissionsLoading,
        permissionsReadyForRoute: permissionsLoaded,
        permissionsError,
        refreshPermissions,
        hasPermission,
        login,
        logout,
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider></StaffIdentityContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export function useStaffIdentity() {
  const context = useContext(StaffIdentityContext);
  if (!context) throw new Error("useStaffIdentity must be used within an AuthProvider");
  return context;
}
