import { useEffect, useState } from "react";
import {
  type ChatNotificationMode,
  legacySoundKey,
  notificationPreferenceKey,
  readNotificationMode,
  saveNotificationMode,
} from "@/lib/chat-notification-preference";

function readPreference(userId?: string): { notificationMode: ChatNotificationMode; notificationPreferenceError: string } {
  if (!userId) return { notificationMode: "chime", notificationPreferenceError: "" };
  try {
    return { notificationMode: readNotificationMode(window.localStorage, userId), notificationPreferenceError: "" };
  } catch {
    return { notificationMode: "muted", notificationPreferenceError: "Your notification choice could not be loaded. Audio is muted until you choose a sound." };
  }
}

export function useChatNotificationPreference(userId?: string) {
  const [preference, setPreference] = useState(() => ({ userId, ...readPreference(userId) }));
  useEffect(() => {
    setPreference({ userId, ...readPreference(userId) });
    const onStorage = (event: StorageEvent) => {
      if (userId && (event.key === null || event.key === notificationPreferenceKey(userId) || event.key === legacySoundKey(userId))) {
        setPreference({ userId, ...readPreference(userId) });
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  const current = preference.userId === userId ? preference : readPreference(userId);
  const setNotificationMode = (notificationMode: ChatNotificationMode) => {
    if (!userId) return;
    let notificationPreferenceError = "";
    try {
      saveNotificationMode(window.localStorage, userId, notificationMode);
    } catch {
      notificationPreferenceError = "Your notification choice changed for now, but could not be saved. Browser storage is unavailable.";
    }
    setPreference({ userId, notificationMode, notificationPreferenceError });
  };
  return { notificationMode: current.notificationMode, notificationPreferenceError: current.notificationPreferenceError, setNotificationMode };
}