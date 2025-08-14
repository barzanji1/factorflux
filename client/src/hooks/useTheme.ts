import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

type Theme = "light" | "dark" | "system";

export function useTheme() {
  const { user } = useAuth();
  const [theme, setTheme] = useState<Theme>("system");

  // Apply theme to document - Force light theme always
  const applyTheme = (newTheme: Theme) => {
    const root = document.documentElement;
    // Always remove dark class to force light theme
    root.classList.remove("dark");
  };

  // Initialize theme from user settings or localStorage - Force light theme
  useEffect(() => {
    const initialTheme = "light"; // Force light theme always
    
    setTheme(initialTheme);
    applyTheme(initialTheme);
  }, [user]);

  // Listen for system theme changes when using system theme
  useEffect(() => {
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => {
        if (theme === "system") {
          applyTheme("system");
        }
      };

      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
  }, [theme]);

  const updateTheme = (newTheme: Theme) => {
    setTheme(newTheme);
    applyTheme(newTheme);
    localStorage.setItem("theme", newTheme);
  };

  return {
    theme,
    setTheme: updateTheme,
  };
}