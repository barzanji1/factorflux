import { useEffect, useState } from "react";
// Authentication system removed

type Theme = "light" | "dark";

export function useTheme() {
  // Authentication system removed
  const [theme, setTheme] = useState<Theme>("light");

  // Apply theme to document
  const applyTheme = (newTheme: Theme) => {
    const root = document.documentElement;
    
    // Always remove dark class first to ensure clean state
    root.classList.remove("dark");
    
    if (newTheme === "dark") {
      root.classList.add("dark");
    }
    // Light theme: dark class already removed above
    
    // Debug logging to verify theme application
    console.log(`Theme applied: ${newTheme}, Dark class present: ${root.classList.contains("dark")}`);
  };

  // Initialize theme from localStorage or default to light
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as Theme || "light";
    console.log(`Initializing theme from localStorage: ${savedTheme}`);
    setTheme(savedTheme);
    applyTheme(savedTheme);
  }, []);

  // System theme functionality removed

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