import { useEffect, useState } from "react";

export type ChatFontSize = "small" | "medium" | "large";

const DEFAULT_SIZE: ChatFontSize = "medium";
const storageKey = (userId: string) => `team-chat:font-size:${userId}`;

function readPreference(userId?: string) {
  if (!userId) return { fontSize: DEFAULT_SIZE, preferenceError: "" };
  try {
    const saved = window.localStorage.getItem(storageKey(userId));
    const fontSize: ChatFontSize = saved === "small" || saved === "large" ? saved : DEFAULT_SIZE;
    return { fontSize, preferenceError: "" };
  } catch {
    return {
      fontSize: DEFAULT_SIZE,
      preferenceError: "Chat text size could not be loaded. Browser storage is unavailable.",
    };
  }
}

/** Browser-local, user-scoped preference; never changes the application theme. */
export function useChatFontSize(userId?: string) {
  const [preference, setPreference] = useState(() => ({ userId, ...readPreference(userId) }));

  useEffect(() => {
    setPreference({ userId, ...readPreference(userId) });
    const onStorage = (event: StorageEvent) => {
      if (userId && (event.key === storageKey(userId) || event.key === null)) {
        setPreference({ userId, ...readPreference(userId) });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  // Never display another user's preference, even during an identity change.
  const current = preference.userId === userId ? preference : readPreference(userId);
  const setFontSize = (fontSize: ChatFontSize) => {
    if (!userId) return;
    let preferenceError = "";
    try {
      window.localStorage.setItem(storageKey(userId), fontSize);
    } catch {
      preferenceError = "Chat text size changed for now, but could not be saved. Browser storage is unavailable.";
    }
    setPreference({ userId, fontSize, preferenceError });
  };

  return { fontSize: current.fontSize, preferenceError: current.preferenceError, setFontSize };
}