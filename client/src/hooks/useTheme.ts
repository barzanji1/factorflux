import { useEffect, useState } from "react";
// Authentication system removed

type Theme = "light" | "dark" | "system";

export function useTheme() {
  // Authentication system removed
  const [theme, setTheme] = useState<Theme>("system");

  // Apply theme to document
  const applyTheme = (newTheme: Theme) => {
    const root = document.documentElement;
    
    // Always remove dark class first to ensure clean state
    root.classList.remove("dark");
    
    if (newTheme === "dark") {
      root.classList.add("dark");
    } else if (newTheme === "light") {
      // Light theme: dark class already removed above
    } else if (newTheme === "system") {
      // Follow system preference
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark) {
        root.classList.add("dark");
      }
    }
    
    // Debug logging to verify theme application
    console.log(`Theme applied: ${newTheme}, Dark class present: ${root.classList.contains("dark")}`);
  };

  // Initialize theme from localStorage or default to system
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as Theme || "system";
    setTheme(savedTheme);
    applyTheme(savedTheme);
  }, []);

  // Listen for system theme changes when using system theme
  useEffect(() => {
    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handleChange = () => {
        if (theme === "system") {
          applyTheme(theme);
        }
      };

      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
  }, [theme]);

  const updateTheme = (newTheme: Theme) => {
    console.log(`Updating theme to: ${newTheme}`);
    setTheme(newTheme);
    applyTheme(newTheme);
    localStorage.setItem("theme", newTheme);
  };

  return {
    theme,
    setTheme: updateTheme,
  };
}