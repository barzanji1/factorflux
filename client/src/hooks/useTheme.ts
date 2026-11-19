import { useSyncExternalStore } from "react";
import { getTheme, setTheme, subscribeTheme } from "@/lib/theme";

/** One shared preference for the sidebar, Settings, and other browser tabs. */
export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => "light" as const);
  return { theme, setTheme };
}
