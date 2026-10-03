export type ChatNotificationMode = "chime" | "voice" | "muted";
export const notificationPreferenceKey = (userId: string) => `team-chat:notification:${userId}`;
export const legacySoundKey = (userId: string) => `team-chat:sound:${userId}`;

export function readNotificationMode(storage: Pick<Storage, "getItem">, userId: string): ChatNotificationMode {
  const saved = storage.getItem(notificationPreferenceKey(userId));
  if (saved === "chime" || saved === "voice" || saved === "muted") return saved;
  // Preserve existing mute choices. Voice is always opt-in, never a migration default.
  return storage.getItem(legacySoundKey(userId)) === "muted" ? "muted" : "chime";
}

export function saveNotificationMode(storage: Pick<Storage, "setItem">, userId: string, mode: ChatNotificationMode) {
  storage.setItem(notificationPreferenceKey(userId), mode);
  storage.setItem(legacySoundKey(userId), mode === "muted" ? "muted" : "on");
}