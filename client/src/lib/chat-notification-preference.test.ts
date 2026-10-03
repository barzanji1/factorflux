import { test } from "node:test";
import assert from "node:assert/strict";
import { readNotificationMode, saveNotificationMode } from "./chat-notification-preference";

test("voice is opt-in, existing mute is preserved, and preferences are user-isolated", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  assert.equal(readNotificationMode(storage, "agent-a"), "chime");
  storage.setItem("team-chat:sound:agent-b", "muted");
  assert.equal(readNotificationMode(storage, "agent-b"), "muted");
  saveNotificationMode(storage, "agent-a", "voice");
  assert.equal(readNotificationMode(storage, "agent-a"), "voice");
  assert.equal(readNotificationMode(storage, "agent-b"), "muted");
  assert.equal(readNotificationMode(storage, "agent-c"), "chime");
  saveNotificationMode(storage, "agent-b", "chime");
  assert.equal(readNotificationMode(storage, "agent-a"), "voice");
  assert.equal(readNotificationMode(storage, "agent-b"), "chime");
  saveNotificationMode(storage, "agent-a", "muted");
  assert.equal(storage.getItem("team-chat:sound:agent-a"), "muted");
  assert.equal(readNotificationMode(storage, "agent-a"), "muted");
});