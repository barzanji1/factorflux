import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Picker from "@emoji-mart/react";
import emojiData from "@emoji-mart/data";
import { AlertCircle, ArrowLeft, Hash, MessageCircle, MoreHorizontal, Plus, Send, Smile, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useChatFontSize } from "@/hooks/useChatFontSize";
import { useChatNotificationPreference } from "@/hooks/useChatNotificationPreference";
import {
  activateChatAudio,
  playChatNotification,
  preloadChatVoice,
  stopChatNotificationSounds,
} from "@/lib/chat-notification-sound";
import { queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { MentionAutocomplete, type ChatUser } from "@/components/team-chat/MentionAutocomplete";
import { GifPicker } from "@/components/team-chat/GifPicker";
import { gifMessage, type ChatGif } from "@shared/chat-gif";
import type { ChatMessage } from "@/components/team-chat/ThreadPanel";
import { ChatMessageItem } from "@/components/team-chat/ChatMessageItem";
import { ChatAvatar } from "@/components/team-chat/ChatAvatar";
import { NeuBadge, NeuButton, NeuCard, NeuPageShell, NeuSelect } from "@/styles/neu/components";
import { NeuNotice } from "@/components/shared/NeuNotice";

type Channel = {
  id: string | number;
  name: string;
  type: string;
  unreadCount: number;
  members?: unknown[];
  directName?: string;
  directProfileImageUrl?: string | null;
};
type Message = ChatMessage;
type EmojiSelection = { id?: string; native?: string };

const tpfEmojiDefinitions = [
  { id: "tpf-logo", name: "TPF Logo", keywords: ["tpf", "logo"], skins: [{ src: "/emojis/tpf-logo.png" }] },
  { id: "ff-logo", name: "FactorFlux Logo", keywords: ["factorflux", "ff", "logo"], skins: [{ src: "/emojis/ff-logo.png" }] },
  { id: "tpf4life", name: "TPF 4Life", keywords: ["tpf", "4life"], skins: [{ src: "/emojis/tpf4life.png" }] },
  { id: "gm-tpf", name: "GM TPF", keywords: ["good morning", "tpf", "wave"], skins: [{ src: "/emojis/gm-tpf.png" }] },
  { id: "tpf-truck", name: "TPF Truck", keywords: ["tpf", "truck"], skins: [{ src: "/emojis/tpf-truck.png" }] },
  { id: "funded", name: "Funded", keywords: ["funded", "money", "dollar"], skins: [{ src: "/emojis/funded.png" }] },
  { id: "invoice", name: "Invoice", keywords: ["invoice", "document"], skins: [{ src: "/emojis/invoice.png" }] },
  { id: "approved", name: "Approved", keywords: ["approved", "check"], skins: [{ src: "/emojis/approved.png" }] },
];

const emojiPickerData = {
  ...emojiData,
  categories: [
    { id: "tpf", name: "TPF", emojis: tpfEmojiDefinitions.map((emoji) => emoji.id) },
    ...emojiData.categories,
  ],
  emojis: {
    ...Object.fromEntries(tpfEmojiDefinitions.map((emoji) => [emoji.id, emoji])),
    ...emojiData.emojis,
  },
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`${response.status}: Unable to load chat`);
  return response.json();
}

async function getChannelSnapshot() {
  const response = await fetch("/api/chat/channels", { credentials: "include" });
  if (!response.ok) throw new Error(`${response.status}: Unable to load chat`);
  const channels = await response.json() as Channel[];
  const cursor = Number(response.headers.get("X-Chat-Message-Cursor") ?? 0);
  return {
    channels,
    cursor: Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0,
  };
}

async function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    let message = "";
    try {
      const payload = await response.json() as { message?: unknown };
      if (typeof payload.message === "string") message = payload.message;
    } catch {
      // Keep the status-based fallback for non-JSON error responses.
    }
    throw new Error(message || `${response.status}: Chat action failed`);
  }
  return response.json();
}

async function getMessagesAfter(channelId: string | number, startingCursor: number) {
  const messages: Message[] = [];
  let cursor = startingCursor;

  while (true) {
    const page = await getJson<Message[]>(
      `/api/chat/channels/${channelId}/messages?afterId=${cursor}&limit=100`
    );
    messages.push(...page);
    if (page.length < 100) return messages;

    const nextCursor = page.reduce(
      (maximum, message) => Math.max(maximum, Number(message.id) || 0),
      cursor
    );
    if (nextCursor <= cursor) return messages;
    cursor = nextCursor;
  }
}

type ChatPanelProps = {
  active: boolean;
};

function ChatPanel({ active }: ChatPanelProps) {
  const { user } = useAuth();
  const { fontSize, setFontSize, preferenceError } = useChatFontSize(user?.id);
  const { notificationMode, setNotificationMode, notificationPreferenceError } = useChatNotificationPreference(user?.id);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [mentionUsers, setMentionUsers] = useState<ChatUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const draftsByChannelRef = useRef<Record<string, string>>({});
  const [threadRootId, setThreadRootId] = useState<string | number | null>(null);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [mobileShowChannels, setMobileShowChannels] = useState(false);
  const [channelNameDraft, setChannelNameDraft] = useState("");
  const [channelNameError, setChannelNameError] = useState("");
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const channelNameInputRef = useRef<HTMLInputElement>(null);
  const messageRequestRef = useRef(0);
  const selectedIdRef = useRef<string | number | null>(selectedId);
  const activeRef = useRef(active);
  const notificationModeRef = useRef(notificationMode);
  const currentUserIdRef = useRef(user?.id);
  const notificationCursorRef = useRef<Record<string, number>>({});
  const notificationGlobalCursorRef = useRef(0);
  const notificationBaselineReadyRef = useRef(false);
  const notificationScanInFlightRef = useRef(false);
  const channelLoadInFlightRef = useRef(false);
  const pendingToneQueueRef = useRef<Message[]>([]);
  const toneQueueTimerRef = useRef<number | null>(null);
  const toneQueueRunningRef = useRef(false);
  const toneQueueGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const hasInitializedSelectionRef = useRef(false);
  const lastReadMessageRef = useRef<Record<string, string>>({});
  const channelLoadQueuedRef = useRef(false);
  const loadChannelsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const optimisticChannelsRef = useRef<Record<string, Channel>>({});
  const mentionDirectoryRequestRef = useRef(0);
  selectedIdRef.current = selectedId;
  activeRef.current = active;
  notificationModeRef.current = notificationMode;
  currentUserIdRef.current = user?.id;

  const selected = channels.find((channel) => String(channel.id) === String(selectedId));
  const selectedIsDirect = selected?.type === "direct" || Boolean(selected?.directName);
  const selectedLabel = selected ? (selectedIsDirect ? selected.directName || selected.name : `#${selected.name}`) : "";
  const visibleChannels = channels;

  const selectChannel = (channelId: string | number | null) => {
    if (selectedIdRef.current !== null) draftsByChannelRef.current[String(selectedIdRef.current)] = draft;
    setSelectedId(channelId);
    selectedIdRef.current = channelId;
    setDraft(channelId === null ? "" : draftsByChannelRef.current[String(channelId)] || "");
    setThreadRootId(null);
    setHighlightMessageId(null);
    setMobileShowChannels(false);
  };

  const refreshMentionUsers = useCallback(async (channelId: string | number) => {
    const requestId = ++mentionDirectoryRequestRef.current;
    try {
      const directory = await getJson<ChatUser[]>(`/api/chat/users?channelId=${encodeURIComponent(String(channelId))}`);
      if (
        mountedRef.current &&
        requestId === mentionDirectoryRequestRef.current &&
        String(selectedIdRef.current) === String(channelId)
      ) setMentionUsers(directory);
    } catch {
      if (requestId === mentionDirectoryRequestRef.current && String(selectedIdRef.current) === String(channelId)) {
        setMentionUsers([]);
      }
    }
  }, []);

  const isConversationActivelyViewed = useCallback((channelId: string | number) => (
    activeRef.current &&
    String(selectedIdRef.current) === String(channelId) &&
    document.visibilityState === "visible" &&
    document.hasFocus()
  ), []);

  const clearToneQueue = useCallback(() => {
    if (toneQueueTimerRef.current !== null) {
      window.clearTimeout(toneQueueTimerRef.current);
      toneQueueTimerRef.current = null;
    }
    pendingToneQueueRef.current = [];
    toneQueueGenerationRef.current += 1;
    toneQueueRunningRef.current = false;
    stopChatNotificationSounds();
  }, []);

  const runToneQueue = useCallback(() => {
    if (!mountedRef.current || toneQueueRunningRef.current) return;
    toneQueueRunningRef.current = true;
    const generation = toneQueueGenerationRef.current;

    const playNext = async () => {
      if (generation !== toneQueueGenerationRef.current) return;
      if (!mountedRef.current) {
        pendingToneQueueRef.current = [];
        toneQueueTimerRef.current = null;
        toneQueueRunningRef.current = false;
        return;
      }
      const message = pendingToneQueueRef.current.shift();
      if (!message) {
        toneQueueTimerRef.current = null;
        toneQueueRunningRef.current = false;
        return;
      }
      const mode = notificationModeRef.current;
      const isMention = Boolean(message.mentions?.some(
        (mention) => String(mention.userId) === String(currentUserIdRef.current)
      ));
      let spacing = 0;
      if (
        mode !== "muted" &&
        (isMention || !isConversationActivelyViewed(message.channelId))
      ) {
        spacing = await playChatNotification(mode, () =>
          mountedRef.current &&
          generation === toneQueueGenerationRef.current &&
          notificationModeRef.current === mode &&
          String(message.senderId) !== String(currentUserIdRef.current) &&
          (isMention || !isConversationActivelyViewed(message.channelId)),
          (audioError) => setError(audioError),
        );
      }
      if (generation !== toneQueueGenerationRef.current) return;
      toneQueueTimerRef.current = window.setTimeout(() => {
        toneQueueTimerRef.current = null;
        void playNext();
      }, Math.max(50, spacing));
    };

    void playNext();
  }, [isConversationActivelyViewed]);

  const scanForNewMessages = useCallback(async (
    availableChannels: Channel[],
    snapshotCursor: number
  ) => {
    if (notificationScanInFlightRef.current) return;
    notificationScanInFlightRef.current = true;
    const baselineReady = notificationBaselineReadyRef.current;
    const startingGlobalCursor = notificationGlobalCursorRef.current;

    try {
      const channelResults = await Promise.all(
        availableChannels.map(async (channel) => ({
          channel,
          messages: baselineReady
            ? await getMessagesAfter(
                channel.id,
                notificationCursorRef.current[String(channel.id)] ?? startingGlobalCursor
              )
            : await getJson<Message[]>(`/api/chat/channels/${channel.id}/messages`),
        }))
      );
      if (!mountedRef.current) return;

      const messagesToNotify: Message[] = [];
      let receivedMention = false;
      channelResults.forEach(({ channel, messages: channelMessages }) => {
        const channelKey = String(channel.id);
        const cursorFloor = baselineReady
          ? notificationCursorRef.current[channelKey] ?? startingGlobalCursor
          : snapshotCursor;
        const latestCursor = channelMessages.reduce(
          (maximum, message) => Math.max(maximum, Number(message.id) || 0),
          cursorFloor
        );
        notificationCursorRef.current[channelKey] = latestCursor;

        const incoming = (baselineReady ? channelMessages : [])
          .filter((message) => String(message.senderId) !== String(currentUserIdRef.current));
        if (incoming.some((message) => message.mentions?.some(
          (mention) => String(mention.userId) === String(currentUserIdRef.current)
        ))) receivedMention = true;
        messagesToNotify.push(...incoming);
      });

      notificationGlobalCursorRef.current = Math.max(
        notificationGlobalCursorRef.current,
        snapshotCursor
      );
      notificationBaselineReadyRef.current = true;
      if (receivedMention) {
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
        queryClient.invalidateQueries({ queryKey: ["/api/chat/unread-count"] });
      }
      if (messagesToNotify.length) {
        pendingToneQueueRef.current.push(...messagesToNotify);
        pendingToneQueueRef.current.sort((a, b) => {
            const aDirected = a.mentions?.some((mention) => String(mention.userId) === String(currentUserIdRef.current)) ? 1 : 0;
            const bDirected = b.mentions?.some((mention) => String(mention.userId) === String(currentUserIdRef.current)) ? 1 : 0;
            return bDirected - aDirected || (Number(a.id) || 0) - (Number(b.id) || 0);
          });
        runToneQueue();
      }
    } catch {
      // Preserve existing cursors so transient polling failures cannot replay history.
    } finally {
      notificationScanInFlightRef.current = false;
    }
  }, [runToneQueue]);

  const loadChannels = useCallback(async () => {
    if (channelLoadInFlightRef.current) {
      channelLoadQueuedRef.current = true;
      return;
    }
    channelLoadInFlightRef.current = true;
    try {
      const { channels: result, cursor: snapshotCursor } = await getChannelSnapshot();
      if (!mountedRef.current) return;
      const receivedIds = new Set(result.map((channel) => String(channel.id)));
      receivedIds.forEach((id) => { delete optimisticChannelsRef.current[id]; });
      const mergedChannels = [
        ...result,
        ...Object.entries(optimisticChannelsRef.current)
          .filter(([id]) => !receivedIds.has(id))
          .map(([, channel]) => channel),
      ];
      setChannels((current) => JSON.stringify(current) === JSON.stringify(mergedChannels) ? current : mergedChannels);
      void scanForNewMessages(result, snapshotCursor);
      setSelectedId((current) => {
        if (hasInitializedSelectionRef.current) return current;
        if (!result.length) return null;
        hasInitializedSelectionRef.current = true;
        const deepLinkChannelId = new URLSearchParams(window.location.search).get("channelId");
        const deepLinkChannel = deepLinkChannelId && result.find((channel) => String(channel.id) === deepLinkChannelId);
        if (deepLinkChannel) return deepLinkChannel.id;
        const requestedId = window.sessionStorage.getItem("chat:open-channel");
        if (requestedId) {
          const requestedChannel = result.find((channel) => String(channel.id) === requestedId);
          if (requestedChannel) {
            window.sessionStorage.removeItem("chat:open-channel");
            return requestedChannel.id;
          }
        }
        return result[0]?.id ?? null;
      });
      setError("");
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Unable to load channels");
    } finally {
      if (mountedRef.current) setLoadingChannels(false);
      channelLoadInFlightRef.current = false;
      if (channelLoadQueuedRef.current) {
        channelLoadQueuedRef.current = false;
        window.setTimeout(() => { void loadChannelsRef.current(); }, 0);
      }
    }
  }, [scanForNewMessages]);
  loadChannelsRef.current = loadChannels;

  const loadMessages = useCallback(async (showLoading = false) => {
    if (!activeRef.current || selectedId === null) return;
    const channelId = selectedId;
    const requestId = ++messageRequestRef.current;
    if (showLoading) setLoadingMessages(true);
    try {
      const result = await getJson<Message[]>(`/api/chat/channels/${channelId}/messages`);
      if (requestId !== messageRequestRef.current) return;
      setMessages((current) => JSON.stringify(current) === JSON.stringify(result) ? current : result);
      const latestMessageId = result.at(-1)?.id;
      const channelKey = String(channelId);
      if (
        latestMessageId !== undefined &&
        lastReadMessageRef.current[channelKey] !== String(latestMessageId) &&
        isConversationActivelyViewed(channelId)
      ) {
        await sendJson(`/api/chat/channels/${channelId}/read`, "PATCH");
        if (requestId !== messageRequestRef.current) return;
        lastReadMessageRef.current[channelKey] = String(latestMessageId);
        setChannels((current) => current.map((channel) => String(channel.id) === channelKey && channel.unreadCount !== 0 ? { ...channel, unreadCount: 0 } : channel));
        queryClient.invalidateQueries({ queryKey: ["/api/chat/unread-count"] });
      }
    } catch (err) {
      if (requestId === messageRequestRef.current) setError(err instanceof Error ? err.message : "Unable to load messages");
    } finally {
      if (requestId === messageRequestRef.current) setLoadingMessages(false);
    }
  }, [active, selectedId, isConversationActivelyViewed]);

  useEffect(() => { loadChannels(); const timer = window.setInterval(loadChannels, 3000); return () => window.clearInterval(timer); }, [loadChannels]);
  useEffect(() => {
    if (!active || selectedId === null) {
      messageRequestRef.current += 1;
      return;
    }
    setMessages([]);
    loadMessages(true);
    const timer = window.setInterval(() => loadMessages(false), 3000);
    return () => {
      messageRequestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [active, selectedId, loadMessages]);
  useEffect(() => {
    if (active) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active, messages.length, selectedId]);
  useEffect(() => {
    getJson<ChatUser[]>("/api/chat/users").then(setUsers).catch(() => undefined);
  }, []);
  useEffect(() => {
    setMentionUsers([]);
    mentionDirectoryRequestRef.current += 1;
    if (selectedId === null) return;
    void refreshMentionUsers(selectedId);
  }, [selectedId, refreshMentionUsers]);
  useEffect(() => {
    if (!active || selectedId === null) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("channelId") !== String(selectedId)) return;
    const requestedThread = params.get("threadId");
    const requestedMessage = params.get("messageId");
    if (requestedThread) setThreadRootId(requestedThread);
    if (requestedMessage) setHighlightMessageId(requestedMessage);
  }, [active, selectedId]);
  useEffect(() => {
    if (!active || !highlightMessageId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`chat-message-${highlightMessageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, highlightMessageId, messages, threadRootId]);
  useEffect(() => {
    // Stop the previous mode immediately, including delayed audio loading.
    clearToneQueue();
    if (notificationMode !== "muted") activateChatAudio();
    if (notificationMode !== "voice") return;
    let cancelled = false;
    void preloadChatVoice().catch(error => {
      if (!cancelled) setError(error instanceof Error ? error.message : "Voice notification could not be loaded.");
    });
    return () => { cancelled = true; };
  }, [notificationMode, clearToneQueue]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearToneQueue();
    };
  }, [clearToneQueue]);
  useEffect(() => {
    if (notificationMode === "muted") return;
    const activateOnce = () => activateChatAudio();
    window.addEventListener("pointerdown", activateOnce, { once: true, capture: true });
    window.addEventListener("keydown", activateOnce, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", activateOnce, { capture: true });
      window.removeEventListener("keydown", activateOnce, { capture: true });
    };
  }, [notificationMode]);
  useEffect(() => {
    const openConversation = (event: Event) => {
      const detail = (event as CustomEvent<{ channelId?: string | number; threadId?: string | number; messageId?: string | number }>).detail;
      const channelId = detail?.channelId;
      if (channelId !== undefined) {
        if (selectedIdRef.current !== null) draftsByChannelRef.current[String(selectedIdRef.current)] = draft;
        hasInitializedSelectionRef.current = true;
        window.sessionStorage.removeItem("chat:open-channel");
        setSelectedId(channelId);
        selectedIdRef.current = channelId;
        setDraft(draftsByChannelRef.current[String(channelId)] || "");
        setThreadRootId(detail.threadId ?? null);
        setHighlightMessageId(detail.messageId === undefined ? null : String(detail.messageId));
      }
    };
    window.addEventListener("team-chat:open", openConversation);
    return () => window.removeEventListener("team-chat:open", openConversation);
  }, [draft]);
  useEffect(() => {
    if (!active) return;
    const requestedId = window.sessionStorage.getItem("chat:open-channel");
    if (!requestedId) return;
    const requestedChannel = channels.find((channel) => String(channel.id) === requestedId);
    if (!requestedChannel) return;
    hasInitializedSelectionRef.current = true;
    window.sessionStorage.removeItem("chat:open-channel");
    selectChannel(requestedChannel.id);
  }, [active, channels]);
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);
  useEffect(() => {
    if (!emojiPickerOpen) return;
    const closeOnOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (!emojiPickerRef.current?.contains(event.target as Node)) setEmojiPickerOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("touchstart", closeOnOutsideClick);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("touchstart", closeOnOutsideClick);
    };
  }, [emojiPickerOpen]);
  useEffect(() => {
    if (!channelDialogOpen) return;
    window.requestAnimationFrame(() => channelNameInputRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !creatingChannel) {
        setChannelDialogOpen(false);
        setChannelNameDraft("");
        setChannelNameError("");
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [channelDialogOpen, creatingChannel]);

  const insertEmoji = (emoji: EmojiSelection) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? draft.length;
    const end = textarea?.selectionEnd ?? start;
    const insertedEmoji = emoji.native || (emoji.id ? `:${emoji.id}:` : "");
    if (!insertedEmoji) return;
    const nextDraft = `${draft.slice(0, start)}${insertedEmoji}${draft.slice(end)}`;
    const nextCursor = start + insertedEmoji.length;
    setDraft(nextDraft);
    setEmojiPickerOpen(false);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const submitMessage = async () => {
    const body = draft.trim();
    if (!body || selectedId === null) return;
    const originalDraft = draft;
    const channelId = selectedId;
    setDraft("");
    draftsByChannelRef.current[String(channelId)] = "";
    try {
      await sendJson(`/api/chat/channels/${channelId}/messages`, "POST", { body });
      if (String(selectedIdRef.current) === String(channelId)) await loadMessages();
    } catch (err) {
      draftsByChannelRef.current[String(channelId)] = originalDraft;
      if (String(selectedIdRef.current) === String(channelId)) {
        setError(err instanceof Error ? err.message : "Message could not be sent");
        setDraft(originalDraft);
      }
    }
  };

  const sendGif = async (gif: ChatGif) => {
    if (selectedId === null) throw new Error("Choose a conversation first.");
    const channelId = selectedId;
    await sendJson(`/api/chat/channels/${channelId}/messages`, "POST", { body: gifMessage(gif.id) });
    if (String(selectedIdRef.current) === String(channelId)) void loadMessages();
  };

  const startDirect = async (userId: string | number) => {
    try {
      const channel = await sendJson<Channel>("/api/chat/channels/direct", "POST", { userId });
      await loadChannels();
      selectChannel(channel.id);
      setPickerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start direct message");
    }
  };

  const normalizedChannelName = channelNameDraft
    .trim()
    .replace(/^#+/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  const closeChannelDialog = () => {
    if (creatingChannel) return;
    setChannelDialogOpen(false);
    setChannelNameDraft("");
    setChannelNameError("");
  };

  const submitNewChannel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = normalizedChannelName;
    if (!name) {
      setChannelNameError("Enter a channel name.");
      return;
    }
    if (name.length > 50) {
      setChannelNameError("Channel names must be 50 characters or fewer.");
      return;
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
      setChannelNameError("Use letters, numbers, hyphens, or underscores.");
      return;
    }

    setChannelNameError("");
    setCreatingChannel(true);
    try {
      const channel = await sendJson<Channel>("/api/chat/channels", "POST", { name });
      hasInitializedSelectionRef.current = true;
      optimisticChannelsRef.current[String(channel.id)] = channel;
      setChannels((current) => current.some((item) => String(item.id) === String(channel.id))
        ? current
        : [...current, channel]);
      selectChannel(channel.id);
      setChannelDialogOpen(false);
      setChannelNameDraft("");
      setChannelNameError("");
      queryClient.invalidateQueries({ queryKey: ["/api/chat/channels"] });
      void loadChannels();
    } catch (err) {
      setChannelNameError(err instanceof Error ? err.message : "Channel could not be created.");
    } finally {
      setCreatingChannel(false);
    }
  };

  return (
    <NeuPageShell
      className="ff-team-chat relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden !bg-[#e0e0e0] p-3 text-[#333] [&_button]:!rounded-xl [&_select]:!rounded-xl sm:p-4"
      data-chat-font-size={fontSize}
      aria-label="Team Chat"
    >
      <header className="mb-3 flex w-full shrink-0 flex-wrap items-center gap-2 px-1">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e0e0e0] text-[#27aab8] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">
          <MessageCircle className="h-4 w-4 shrink-0" />
        </span>
        {!selected && !mobileShowChannels && <NeuButton type="button" onClick={() => setMobileShowChannels(true)} aria-label="Show channels" className="!min-h-8 !px-2 md:hidden"><ArrowLeft className="h-4 w-4" />Channels</NeuButton>}
        <span className="shrink-0 text-sm font-bold tracking-tight text-[#333]">Team Chat</span>
        {selected && <span className="min-w-0 flex-1 truncate text-sm text-[#777]">/ {selectedLabel}</span>}
        <label className="sr-only" htmlFor="team-chat-font-size">Chat text size</label>
        <NeuSelect
          id="team-chat-font-size"
          aria-label="Chat text size"
          value={fontSize}
          onChange={(event) => setFontSize(event.target.value as "small" | "medium" | "large")}
          className="!min-h-8 !w-auto !rounded-lg !px-2 !py-1 text-xs"
        >
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </NeuSelect>
        <label className="sr-only" htmlFor="team-chat-notification-sound">Chat notification sound</label>
        <NeuSelect
          id="team-chat-notification-sound"
          aria-label="Chat notification sound"
          value={notificationMode}
          onChange={(event) => setNotificationMode(event.target.value as "chime" | "voice" | "muted")}
          title={'Voice plays the original AI-generated recording saying "You have got a message" (the actual clip says "You’ve got a message").'}
          className="!min-h-8 !w-auto !rounded-lg !px-2 !py-1 text-xs"
        >
          <option value="chime">Chime</option>
          <option value="voice">Voice</option>
          <option value="muted">Mute</option>
        </NeuSelect>
      </header>
      {preferenceError && <NeuNotice severity="block" role="alert" className="mb-2 flex shrink-0 items-start gap-2 text-xs"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{preferenceError}</span></NeuNotice>}
      {notificationPreferenceError && <NeuNotice severity="block" role="alert" className="mb-2 flex shrink-0 items-start gap-2 text-xs"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{notificationPreferenceError}</span></NeuNotice>}
      <div className="flex min-h-0 w-full flex-1 gap-4">
        <NeuCard className={cn("flex w-full min-w-0 flex-col overflow-hidden p-3 md:w-[270px] md:shrink-0", mobileShowChannels ? "flex" : "hidden md:flex")}>
          <div className="mb-3 flex items-center justify-between gap-2 px-1">
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-[#777]">Channels</h2>
            <div className="flex gap-2">
              <NeuButton type="button" onClick={() => setPickerOpen(true)} title="New direct message" aria-label="New direct message" className="!min-h-8 !rounded-lg !px-2 text-[11px] text-[#208894]"><Users className="h-3.5 w-3.5" /><span className="sr-only">New DM</span></NeuButton>
              <NeuButton type="button" onClick={() => { setChannelNameDraft(""); setChannelNameError(""); setChannelDialogOpen(true); }} aria-label="Create channel" title="Create channel" className="!min-h-8 !rounded-lg !px-2 text-[11px] text-[#208894]"><Plus className="h-3.5 w-3.5" /><span className="sr-only">Channel</span></NeuButton>
            </div>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-1">
            {loadingChannels ? <div className="space-y-3 p-1" aria-label="Loading channels">{[1, 2, 3, 4].map((item) => <div key={item} className="h-11 animate-pulse rounded-xl bg-[#d7d7d7]" />)}</div>
              : error && !channels.length ? <div className="p-4 text-center text-xs text-[#7c3535]"><AlertCircle className="mx-auto mb-2 h-6 w-6" />{error}<NeuButton onClick={loadChannels} className="mt-3 !min-h-8 !rounded-lg !px-3 text-xs">Retry</NeuButton></div>
              : !visibleChannels.length ? <div className="p-3 text-center text-[10px] text-[#555]"><MessageCircle className="mx-auto mb-2 h-6 w-6 text-[#098b9f]" />No conversations</div>
              : visibleChannels.map((channel) => {
                const isDirect = channel.type === "direct" || Boolean(channel.directName);
                 const label = isDirect ? channel.directName || channel.name : `#${channel.name}`;
                      return <button key={channel.id} onClick={() => selectChannel(channel.id)} title={label} aria-label={label} data-testid={`chat-channel-${channel.id}`} className={cn("relative flex h-11 w-full items-center justify-start gap-2 rounded-xl px-2 text-left text-[#444] transition-[transform,box-shadow,color] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#27aab8]", String(selectedId) === String(channel.id) ? "bg-[#e0e0e0] text-[#208894] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]" : "bg-[#e0e0e0] shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#c1c1c1] hover:text-[#208894]")}>
                    {isDirect ? <ChatAvatar name={label} profileImageUrl={channel.directProfileImageUrl} className="h-8 w-8 text-[10px]" /> : <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e0e0e0] text-[#27aab8] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#fff]"><Hash className="h-4 w-4" /></span>}
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{label}</span>
                    {channel.unreadCount > 0 && <NeuBadge tone="accent" className="absolute right-1 top-1 !bg-[#27aab8] !px-2 !py-0.5 !text-[10px] !text-white !shadow-none" aria-label={`${channel.unreadCount} unread`}>{channel.unreadCount > 9 ? "9+" : channel.unreadCount}</NeuBadge>}
                </button>;
              })}
          </div>
        </NeuCard>

          <NeuCard className={cn("relative min-w-0 flex-1 flex-col overflow-hidden p-3", mobileShowChannels ? "hidden md:flex" : "flex")} data-testid="chat-conversation">
            {selected ? <div className="flex min-h-0 min-w-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <header className="mb-2 flex min-h-10 shrink-0 items-center gap-2 border-b border-[#c7c7c7] px-1 pb-2">
             <NeuButton type="button" onClick={() => setMobileShowChannels(true)} aria-label="Back to channels" className="!min-h-8 !rounded-lg !px-2 text-xs md:hidden"><ArrowLeft className="h-4 w-4" /> Channels</NeuButton>
             {selectedIsDirect ? <ChatAvatar name={selectedLabel} profileImageUrl={selected.directProfileImageUrl} /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e0e0e0] text-[#27aab8] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#fff]"><Hash className="h-3 w-3" /></span>}
              <div className="min-w-0"><h2 className="truncate text-sm font-bold text-[#333]">{selectedLabel}</h2></div>
             <MoreHorizontal className="ml-auto h-4 w-4 text-[#888]" />
          </header>
            <div className="flex-1 overflow-y-auto px-2 py-2">
             {loadingMessages && !messages.length ? <div className="space-y-4" aria-label="Loading messages">{[1, 2, 3].map((item) => <div key={item} className={cn("h-12 animate-pulse rounded-xl bg-[#d7d7d7]", item % 2 === 0 ? "ml-auto max-w-[60%]" : "max-w-[55%]")} />)}</div>
                : messages.length ? messages.map((message) => <ChatMessageItem
                  key={message.id}
                  message={message}
                  currentUserId={user?.id}
                  currentUserRole={user?.role}
                  active={active}
                  onChanged={() => { void loadMessages(); }}
                  initiallyExpanded={String(threadRootId) === String(message.id)}
                  highlightedMessageId={highlightMessageId}
                />) : <div className="flex h-full flex-col items-center justify-center text-center text-[#707371]"><MessageCircle className="mb-3 h-10 w-10 text-[#8bbfc1]" /><p className="font-semibold">No messages here yet</p><p className="mt-1 text-xs">Send the first note to this conversation.</p></div>}
            <div ref={bottomRef} />
          </div>
            <div className="mt-2 rounded-xl bg-[#e0e0e0] p-2 shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#fff]"><div className="relative flex items-center gap-2">
              <MentionAutocomplete value={draft} onChange={(value) => { setDraft(value); draftsByChannelRef.current[String(selected.id)] = value; }} users={mentionUsers} onDirectoryRefresh={() => { void refreshMentionUsers(selected.id); }} onSubmit={submitMessage} placeholder={`Message ${selected.directName || selected.name}...`} textareaRef={(node) => { textareaRef.current = node; }} data-testid="chat-message-composer" className="!min-h-10 flex-1 resize-none overflow-hidden !border-0 !bg-transparent px-2 py-2 text-sm !text-[#333] outline-none placeholder:!text-[#888] !shadow-none focus-visible:!outline-none" />
              <GifPicker key={String(selected.id)} onSelect={sendGif} />
              <div ref={emojiPickerRef} className="shrink-0"><NeuButton type="button" onClick={() => setEmojiPickerOpen((open) => !open)} aria-label="Choose emoji" aria-expanded={emojiPickerOpen} className="!min-h-9 !w-9 !rounded-lg !p-0 text-[#27aab8]"><Smile className="h-4 w-4" /></NeuButton>{emojiPickerOpen && <div className="absolute bottom-[calc(100%+0.65rem)] right-0 z-40 max-h-[min(420px,calc(100dvh-26rem))] w-[min(352px,calc(100vw-2.5rem))] max-w-full overflow-auto rounded-2xl bg-[#e0e0e0] p-2 shadow-[-7px_-7px_16px_#fff,7px_7px_16px_#b8b8b8] [--rgb-background:224,224,224] [--rgb-input:224,224,224] [--rgb-color:51,51,51] [--rgb-accent:39,170,184] [&_em-emoji-picker]:!w-full"><Picker data={emojiPickerData} dynamicWidth onEmojiSelect={insertEmoji} categories={["tpf", "frequent", "people", "nature", "foods", "activity", "places", "objects", "symbols"]} categoryIcons={{ tpf: { src: "/emojis/tpf-logo.png" } }} previewPosition="none" skinTonePosition="search" width="100%" height={380} /></div>}</div><NeuButton variant="accent" onClick={submitMessage} disabled={!draft.trim()} aria-label="Send message" title="Send message" className="!min-h-9 !w-9 !rounded-lg !p-0"><Send className="h-4 w-4" /></NeuButton></div></div>
            </div>
            </div> : <div className="flex flex-1 flex-col items-center justify-center text-center text-[#666]"><Users className="mb-3 h-12 w-12 text-[#8bbfc1]" /><h2 className="font-bold text-[#333]">Your team, in sync</h2><p className="mt-1 max-w-xs text-xs">Choose a channel or start a direct message to begin.</p></div>}
          </NeuCard>
        </div>
       {error && channels.length > 0 && <NeuNotice severity="block" role="alert" className="absolute bottom-1 left-1 right-1 z-30 flex items-center gap-2 text-xs"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}<button onClick={() => setError("")} aria-label="Dismiss" className="ml-auto rounded-full p-1 hover:bg-[#eadbbd]"><X className="h-3 w-3" /></button></NeuNotice>}
        {channelDialogOpen && <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#263b44]/35 p-4" onMouseDown={(event) => event.currentTarget === event.target && closeChannelDialog()}>
           <section role="dialog" aria-modal="true" aria-labelledby="new-channel-title" aria-describedby="new-channel-help" className="w-full max-w-sm rounded-2xl bg-[#e0e0e0] p-5 text-[#333] shadow-[-8px_-8px_18px_#fff,8px_8px_18px_#b8b8b8]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div><p className="text-[10px] font-bold uppercase tracking-wider text-[#557277]">Team space</p><h2 id="new-channel-title" className="text-base font-bold text-[#1a1a1a]">Create a channel</h2></div>
               <NeuButton type="button" onClick={closeChannelDialog} disabled={creatingChannel} aria-label="Close create channel dialog" className="!min-h-8 !w-8 !rounded-lg !p-0 text-[#666]"><X className="h-4 w-4" /></NeuButton>
            </div>
            <form onSubmit={submitNewChannel}>
              <label htmlFor="new-channel-name" className="mb-1 block text-xs font-semibold text-[#333]">Channel name</label>
               <div className="flex items-center rounded-xl bg-[#e0e0e0] px-3 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff] focus-within:outline focus-within:outline-2 focus-within:outline-[#27aab8]">
                <span aria-hidden="true" className="mr-1 text-sm font-bold text-[#098b9f]">#</span>
                <input
                  ref={channelNameInputRef}
                  id="new-channel-name"
                  name="name"
                  type="text"
                  autoComplete="off"
                  maxLength={50}
                  value={channelNameDraft}
                  onChange={(event) => { setChannelNameDraft(event.target.value); setChannelNameError(""); }}
                  aria-invalid={Boolean(channelNameError)}
                  aria-describedby={channelNameError ? "new-channel-error" : "new-channel-help"}
                  placeholder="project-updates"
                   className="min-w-0 flex-1 bg-transparent py-3 text-sm text-[#333] outline-none placeholder:text-[#888]"
                />
              </div>
              <p id="new-channel-help" className="mt-2 text-[11px] leading-relaxed text-[#555]">Public channels are visible to all staff. Spaces become hyphens; names support letters, numbers, hyphens, and underscores (50 characters max).</p>
              {channelNameError && <p id="new-channel-error" role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-semibold text-[#8b3030]"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{channelNameError}</p>}
              {channelNameDraft.trim() && <p className="mt-2 text-[10px] text-[#777]">Channel address: <span className="font-mono text-[#17626a]">#{normalizedChannelName}</span></p>}
              <div className="mt-5 flex justify-end gap-2">
                 <NeuButton type="button" onClick={closeChannelDialog} disabled={creatingChannel} className="!min-h-9 !rounded-lg !px-4 text-xs">Cancel</NeuButton>
                 <NeuButton type="submit" variant="accent" disabled={creatingChannel} className="!min-h-9 !rounded-lg !px-4 text-xs">{creatingChannel ? "Creating…" : "Create channel"}</NeuButton>
              </div>
            </form>
           </section>
        </div>}
         {pickerOpen && <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#333]/20 p-4" onMouseDown={(event) => event.currentTarget === event.target && setPickerOpen(false)}><div role="dialog" aria-modal="true" aria-labelledby="staff-picker-title" className="w-full max-w-md rounded-2xl bg-[#e0e0e0] p-5 shadow-[-8px_-8px_18px_#fff,8px_8px_18px_#b8b8b8]"><div className="mb-3 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-wider text-[#208894]">New conversation</p><h2 id="staff-picker-title" className="font-bold">Message a teammate</h2></div><NeuButton type="button" onClick={() => setPickerOpen(false)} aria-label="Close teammate picker" className="!min-h-8 !w-8 !rounded-lg !p-0"><X className="h-4 w-4" /></NeuButton></div><div className="max-h-72 overflow-y-auto rounded-xl bg-[#e0e0e0] p-2 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">{users.length ? users.map((user) => <button key={user.id} onClick={() => startDirect(user.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[#27aab8]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#27aab8]"><ChatAvatar name={user.name} profileImageUrl={user.profileImageUrl} className="h-8 w-8 text-[10px]" /><span><span className="block text-sm font-semibold">{user.name}</span><span className="block text-[10px] uppercase text-[#777]">{user.role || "Team member"}</span></span></button>) : <p className="p-5 text-center text-xs text-[#666]">No teammates available.</p>}</div></div></div>}
    </NeuPageShell>
  );
}

export function TeamChatWorkspace() {
  const { user, permissions, permissionsLoaded, isLoading } = useAuth();
  const [location, setLocation] = useLocation();
  const canUseChat = !!user && !isLoading && (
    user.role === "admin" ||
    (permissionsLoaded && permissions.includes("chat"))
  );
  const isInternalRoute = location !== "/login" && location !== "/portal" && !location.startsWith("/portal/");
  const active = location.split("?")[0] === "/chat";

  useEffect(() => {
    if (!canUseChat || !isInternalRoute) return;
    const openChat = (event: Event) => {
      const detail = (event as CustomEvent<{ messageId?: string | number }>).detail;
      setLocation(detail?.messageId ? `${window.location.pathname}${window.location.search}` : "/chat");
    };
    window.addEventListener("team-chat:open", openChat);
    return () => window.removeEventListener("team-chat:open", openChat);
  }, [setLocation, canUseChat, isInternalRoute]);

  if (!canUseChat || !isInternalRoute) return null;

  return (
    <div className={cn(
      "h-full min-h-0",
      active ? "flex min-w-0 flex-1" : "hidden"
    )}>
      {active && <Sidebar />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {active && <TopNav title="Team Chat" subtitle="Conversations across your team" group="Workspace" neu />}
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#e0e0e0]">
          <ChatPanel active={active} />
        </main>
      </div>
    </div>
  );
}