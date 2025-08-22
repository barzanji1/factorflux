import React, { createContext, ReactNode, useContext, useState, useEffect } from "react";
import { queryClient } from "../lib/queryClient";

interface User {
  id: string;
  username: string;
  role: string;
  name?: string;
  email?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const checkAuth = async () => {
    try {
      console.log("Checking authentication...");
      // Check localStorage first
      const authFlag = localStorage.getItem("isAuthenticated");
      const userData = localStorage.getItem("user");
      
      console.log("LocalStorage - isAuthenticated:", authFlag, "userData:", !!userData);
      
      if (authFlag === "true" && userData) {
        const parsedUser = JSON.parse(userData);
        setUser(parsedUser);
        setIsAuthenticated(true);
        console.log("Setting authenticated state from localStorage");
        
        // Verify with server in background (don't block the UI)
        setTimeout(async () => {
          try {
            const response = await fetch("/api/auth/verify", {
              credentials: "include"
            });
            if (!response.ok) {
              console.log("Server verification failed, clearing auth state");
              localStorage.removeItem("isAuthenticated");
              localStorage.removeItem("user");
              setUser(null);
              setIsAuthenticated(false);
            } else {
              console.log("Server verification successful");
            }
          } catch (error) {
            console.log("Network error during verification:", error);
          }
        }, 100);
      } else {
        console.log("No valid auth data in localStorage");
        setUser(null);
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error("Auth check failed:", error);
      setUser(null);
      setIsAuthenticated(false);
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
        credentials: "include" // Important for session cookies
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log("Login response:", result);
        setUser(result.user);
        setIsAuthenticated(true);
        localStorage.setItem("isAuthenticated", "true");
        localStorage.setItem("user", JSON.stringify(result.user));
        console.log("Auth state updated - authenticated:", true);
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
    localStorage.removeItem("isAuthenticated");
    localStorage.removeItem("user");
    
    // Call logout endpoint
    fetch("/api/auth/logout", { method: "POST" }).catch(console.error);
  };

  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
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