import React, { createContext, ReactNode, useContext, useState, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { useLocation } from "wouter";

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
  prepareRoute: (href: string) => Promise<() => void>;
  hasPermission: (key: string) => boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function fetchPermissions(): Promise<string[]> {
  const res = await fetch("/api/auth/permissions", { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error("Unable to refresh access permissions. Please retry.");
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
  const [permissionLocation, setPermissionLocation] = useState<string | null>(null);
  const activeUser = useRef<string | undefined>();
  activeUser.current = user?.id;
  const locationRef = useRef(location);
  locationRef.current = location;
  const refreshSequence = useRef(0);
  const preparationSequence = useRef(0);
  const [preparedRoute, setPreparedRoute] = useState<{ path: string; userId: string; permissions: string[] } | null>(null);
  const preparedForLocation = !!preparedRoute && preparedRoute.userId === user?.id && preparedRoute.path === location;

  const prepareRoute = useCallback(async (href: string) => {
    const userId = activeUser.current;
    if (!userId) throw new Error("Please sign in again.");
    const sequence = ++preparationSequence.current;
    const next = await fetchPermissions();
    return () => {
      if (activeUser.current !== userId) throw new Error("Your session changed. Please sign in again.");
      if (sequence !== preparationSequence.current) throw new Error("Access changed while opening this page. Please retry.");
      // Commit only alongside the chosen navigation, never for an abandoned
      // click or a page whose code failed to download.
      ++refreshSequence.current;
      flushSync(() => {
        setPermissionsLoading(false);
        setPreparedRoute({ path: href.split(/[?#]/)[0], userId, permissions: next });
      });
    };
  }, []);

  const refreshPermissions = useCallback(async () => {
    const userId = user?.id;
    if (!userId) return;
    const sequence = ++refreshSequence.current;
    ++preparationSequence.current;
    setPreparedRoute(null);
    const path = locationRef.current;
    setPermissionsLoading(true);
    setPermissionsError(null);
    try {
      const next = await fetchPermissions();
      if (activeUser.current !== userId || sequence !== refreshSequence.current) return;
      setPermissions(next);
      setPermissionsLoaded(true);
      setPermissionLocation(path);
    } catch (error) {
      if (activeUser.current !== userId || sequence !== refreshSequence.current) return;
      setPermissionsError(error instanceof Error ? error.message : "Unable to refresh permissions.");
      setPermissionLocation(path);
    } finally {
      if (activeUser.current === userId && sequence === refreshSequence.current) setPermissionsLoading(false);
    }
  }, [user?.id]);

  const hasPermission = (key: string): boolean => {
    if (user?.role === "admin") return true;
    return (preparedForLocation ? preparedRoute!.permissions : permissions).includes(key);
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
          setPermissionLocation(locationRef.current);
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
        localStorage.setItem("isAuthenticated", "true");
        localStorage.setItem("user", JSON.stringify(result.user));
        // Wouter's history update is synchronous. Commit the verified session
        // first, even when the prepared destination resolves in this microtask.
        flushSync(() => {
          setUser(result.user);
          setIsAuthenticated(true);
          setPermissions(perms);
          setPermissionsLoaded(true);
          setPermissionLocation(locationRef.current);
          setPermissionsError(null);
          setPermissionsLoading(false);
          setPreparedRoute({ path: "/", userId: result.user.id, permissions: perms });
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
    ++refreshSequence.current;
    ++preparationSequence.current;
    setPreparedRoute(null);
    activeUser.current = undefined;
    setUser(null);
    setIsAuthenticated(false);
    setPermissions([]);
    setPermissionLocation(null);
    setPermissionsError(null);
    localStorage.removeItem("isAuthenticated");
    localStorage.removeItem("user");
    fetch("/api/auth/logout", { method: "POST" }).catch(console.error);
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!preparedForLocation || !preparedRoute) return;
    setPermissions(preparedRoute.permissions);
    setPermissionsLoaded(true);
    setPermissionsLoading(false);
    setPermissionsError(null);
    setPermissionLocation(location);
    setPreparedRoute(null);
  }, [location, preparedForLocation, preparedRoute]);

  // Revalidate before a newly navigated route makes an access decision.
  // The synchronous path comparison below also blocks the first render,
  // before this effect has had a chance to run.
  useEffect(() => {
    if (isAuthenticated && !isLoading && permissionLocation !== location && !preparedForLocation) void refreshPermissions();
  }, [location, permissionLocation, preparedForLocation, isAuthenticated, isLoading, refreshPermissions]);

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

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        permissions: preparedForLocation ? preparedRoute!.permissions : permissions,
        permissionsLoaded: preparedForLocation || permissionsLoaded,
        permissionsLoading: !preparedForLocation && (permissionsLoading || (isAuthenticated && permissionLocation !== location)),
        permissionsReadyForRoute: preparedForLocation || permissionLocation === location,
        permissionsError: preparedForLocation ? null : permissionsError,
        refreshPermissions,
        prepareRoute,
        hasPermission,
        login,
        logout,
        checkAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
