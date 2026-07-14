import React, { createContext, ReactNode, useContext, useState, useEffect } from "react";
import { queryClient } from "../lib/queryClient";

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
  hasPermission: (key: string) => boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

async function fetchPermissions(): Promise<string[]> {
  try {
    const res = await fetch("/api/auth/permissions", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      return data.permissions ?? [];
    }
  } catch {}
  return [];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [permissions, setPermissions] = useState<string[]>([]);

  const hasPermission = (key: string): boolean => {
    if (user?.role === "admin") return true;
    return permissions.includes(key);
  };

  const checkAuth = async () => {
    try {
      console.log("Checking authentication...");
      const authFlag = localStorage.getItem("isAuthenticated");
      const userData = localStorage.getItem("user");

      console.log("LocalStorage - isAuthenticated:", authFlag, "userData:", !!userData);

      if (authFlag === "true" && userData) {
        const parsedUser = JSON.parse(userData);
        setUser(parsedUser);
        setIsAuthenticated(true);
        console.log("Setting authenticated state from localStorage");

        setTimeout(async () => {
          try {
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
              const perms = await fetchPermissions();
              setPermissions(perms);
            }
          } catch (error) {
            console.log("Network error during verification:", error);
          }
        }, 100);
      } else {
        console.log("No valid auth data in localStorage");
        setUser(null);
        setIsAuthenticated(false);
        setPermissions([]);
      }
    } catch (error) {
      console.error("Auth check failed:", error);
      setUser(null);
      setIsAuthenticated(false);
      setPermissions([]);
      localStorage.removeItem("isAuthenticated");
      localStorage.removeItem("user");
    } finally {
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
        console.log("Login response:", result);
        setUser(result.user);
        setIsAuthenticated(true);
        localStorage.setItem("isAuthenticated", "true");
        localStorage.setItem("user", JSON.stringify(result.user));
        console.log("Auth state updated - authenticated:", true);

        const perms = await fetchPermissions();
        setPermissions(perms);

        return true;
      }
      return false;
    } catch (error) {
      console.error("Login failed:", error);
      return false;
    }
  };

  const logout = () => {
    setUser(null);
    setIsAuthenticated(false);
    setPermissions([]);
    localStorage.removeItem("isAuthenticated");
    localStorage.removeItem("user");
    fetch("/api/auth/logout", { method: "POST" }).catch(console.error);
  };

  useEffect(() => {
    checkAuth();
  }, []);

  // Poll permissions every 60 seconds while authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(async () => {
      const perms = await fetchPermissions();
      setPermissions(perms);
    }, 60000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        permissions,
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
