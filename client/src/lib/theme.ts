export type Theme = "light" | "dark";
const THEME_EVENT = "factorflux:theme";

export function normalizeTheme(value: unknown): Theme {
  return value === "dark" ? "dark" : "light";
}

export function getTheme(): Theme {
  return normalizeTheme(document.documentElement.dataset.theme);
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // Retain Tailwind dark: variants while data-theme controls our palette.
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function setTheme(value: Theme) {
  const theme = normalizeTheme(value);
  applyTheme(theme);
  try { localStorage.setItem("theme", theme); }
  catch { /* Restricted storage still permits changing this tab's appearance. */ }
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function subscribeTheme(listener: () => void) {
  const syncStorage = (event: StorageEvent) => {
    if (event.key !== "theme" && event.key !== null) return;
    applyTheme(normalizeTheme(event.newValue));
    listener();
  };
  window.addEventListener(THEME_EVENT, listener);
  window.addEventListener("storage", syncStorage);
  return () => {
    window.removeEventListener(THEME_EVENT, listener);
    window.removeEventListener("storage", syncStorage);
  };
}
