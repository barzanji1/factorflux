import { useCallback, useEffect, useRef, useState } from "react";
import Picker from "@emoji-mart/react";
import emojiData from "@emoji-mart/data";
import { AlertCircle, Bell, BellOff, Hash, MessageCircle, Minus, MoreHorizontal, Plus, Send, Smile, UserRound, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";

type Channel = {
  id: string | number;
  name: string;
  type: string;
  unreadCount: number;
  members?: unknown[];
  directName?: string;
};
type ChatUser = { id: string | number; name: string; role?: string };
type Message = {
  id: string | number;
  channelId: string | number;
  senderId: string | number;
  senderName: string;
  body: string;
  createdAt: string;
};
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

const customEmojiSources: Record<string, { src: string; label: string }> = {
  "tpf-logo": { src: "/emojis/tpf-logo.png", label: "TPF Logo" },
  "ff-logo": { src: "/emojis/ff-logo.png", label: "FactorFlux Logo" },
  tpf4life: { src: "/emojis/tpf4life.png", label: "TPF 4Life" },
  "gm-tpf": { src: "/emojis/gm-tpf.png", label: "GM TPF" },
  "tpf-truck": { src: "/emojis/tpf-truck.png", label: "TPF Truck" },
  funded: { src: "/emojis/funded.png", label: "Funded" },
  invoice: { src: "/emojis/invoice.png", label: "Invoice" },
  approved: { src: "/emojis/approved.png", label: "Approved" },
};

const customEmojiPattern = /:(tpf-logo|ff-logo|tpf4life|gm-tpf|tpf-truck|funded|invoice|approved):/g;

function renderMessageBody(body: string) {
  return body.split(customEmojiPattern).map((part, index) => {
    const emoji = customEmojiSources[part];
    return emoji
      ? <img key={`${part}-${index}`} src={emoji.src} alt={`:${part}:`} title={emoji.label} className="mx-0.5 inline-block h-6 w-6 align-middle object-contain" />
      : part;
  });
}

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
  if (!response.ok) throw new Error(`${response.status}: Chat action failed`);
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

const initials = (name: string) => name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
const timeLabel = (date: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(date));

let chatAudioContext: AudioContext | null = null;

function getChatAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  chatAudioContext ??= new AudioContextConstructor();
  return chatAudioContext;
}

function activateChatAudio() {
  const context = getChatAudioContext();
  if (context?.state === "suspended") void context.resume().catch(() => undefined);
}

function playChatNotificationTone() {
  const context = getChatAudioContext();
  if (!context) return;

  const play = () => {
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(620, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.15);
  };

  if (context.state === "suspended") {
    void context.resume().then(play).catch(() => undefined);
  } else {
    play();
  }
}

type ChatPanelProps = {
  docked?: boolean;
};

function ChatPanel({ docked = false }: ChatPanelProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(!docked);
  const [closed, setClosed] = useState(false);
  const soundStorageKey = `team-chat:sound:${user?.id ?? "anonymous"}`;
  const [soundEnabled, setSoundEnabled] = useState(
    () => window.localStorage.getItem(soundStorageKey) !== "muted"
  );
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const messageRequestRef = useRef(0);
  const selectedIdRef = useRef<string | number | null>(selectedId);
  const openRef = useRef(open);
  const soundEnabledRef = useRef(soundEnabled);
  const currentUserIdRef = useRef(user?.id);
  const notificationCursorRef = useRef<Record<string, number>>({});
  const notificationGlobalCursorRef = useRef(0);
  const notificationBaselineReadyRef = useRef(false);
  const notificationScanInFlightRef = useRef(false);
  const channelLoadInFlightRef = useRef(false);
  const pendingToneQueueRef = useRef<Message[]>([]);
  const toneQueueTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const hasInitializedSelectionRef = useRef(false);
  const lastReadMessageRef = useRef<Record<string, string>>({});
  selectedIdRef.current = selectedId;
  openRef.current = open;
  soundEnabledRef.current = soundEnabled;
  currentUserIdRef.current = user?.id;

  const selected = channels.find((channel) => String(channel.id) === String(selectedId));
  const visibleChannels = channels;

  const isConversationActivelyViewed = useCallback((channelId: string | number) => (
    openRef.current &&
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
  }, []);

  const runToneQueue = useCallback(() => {
    if (!mountedRef.current) return;
    if (toneQueueTimerRef.current !== null) return;

    const playNext = () => {
      if (!mountedRef.current) {
        pendingToneQueueRef.current = [];
        toneQueueTimerRef.current = null;
        return;
      }
      const message = pendingToneQueueRef.current.shift();
      if (!message) {
        toneQueueTimerRef.current = null;
        return;
      }
      if (
        soundEnabledRef.current &&
        !isConversationActivelyViewed(message.channelId)
      ) {
        playChatNotificationTone();
      }
      toneQueueTimerRef.current = window.setTimeout(() => {
        toneQueueTimerRef.current = null;
        playNext();
      }, 180);
    };

    playNext();
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
      channelResults.forEach(({ channel, messages: channelMessages }) => {
        const channelKey = String(channel.id);
        const latestCursor = channelMessages.reduce(
          (maximum, message) => Math.max(maximum, Number(message.id) || 0),
          notificationCursorRef.current[channelKey] ?? startingGlobalCursor
        );
        notificationCursorRef.current[channelKey] = latestCursor;

        messagesToNotify.push(
          ...(baselineReady ? channelMessages : [])
            .filter((message) => String(message.senderId) !== String(currentUserIdRef.current))
        );
      });

      notificationGlobalCursorRef.current = Math.max(
        notificationGlobalCursorRef.current,
        snapshotCursor
      );
      notificationBaselineReadyRef.current = true;
      if (messagesToNotify.length) {
        pendingToneQueueRef.current.push(
          ...messagesToNotify.sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
        );
        runToneQueue();
      }
    } catch {
      // Preserve existing cursors so transient polling failures cannot replay history.
    } finally {
      notificationScanInFlightRef.current = false;
    }
  }, [runToneQueue]);

  const loadChannels = useCallback(async () => {
    if (channelLoadInFlightRef.current) return;
    channelLoadInFlightRef.current = true;
    try {
      const { channels: result, cursor: snapshotCursor } = await getChannelSnapshot();
      if (!mountedRef.current) return;
      setChannels((current) => JSON.stringify(current) === JSON.stringify(result) ? current : result);
      void scanForNewMessages(result, snapshotCursor);
      setSelectedId((current) => {
        if (hasInitializedSelectionRef.current) return current;
        if (!result.length) return null;
        hasInitializedSelectionRef.current = true;
        const requestedId = window.sessionStorage.getItem("chat:open-channel");
        if (requestedId) {
          window.sessionStorage.removeItem("chat:open-channel");
          const requestedChannel = result.find((channel) => String(channel.id) === requestedId);
          if (requestedChannel) return requestedChannel.id;
        }
        return result[0]?.id ?? null;
      });
      setError("");
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Unable to load channels");
    } finally {
      if (mountedRef.current) setLoadingChannels(false);
      channelLoadInFlightRef.current = false;
    }
  }, [scanForNewMessages]);

  const loadMessages = useCallback(async (showLoading = false) => {
    if (selectedId === null || (docked && (!open || closed))) return;
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
  }, [selectedId, docked, open, closed, isConversationActivelyViewed]);

  useEffect(() => { loadChannels(); const timer = window.setInterval(loadChannels, 3000); return () => window.clearInterval(timer); }, [loadChannels]);
  useEffect(() => {
    setMessages([]);
    loadMessages(true);
    const timer = window.setInterval(() => loadMessages(false), 3000);
    return () => {
      messageRequestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [loadMessages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, selectedId]);
  useEffect(() => {
    getJson<ChatUser[]>("/api/chat/users").then(setUsers).catch(() => undefined);
  }, []);
  useEffect(() => {
    const enabled = window.localStorage.getItem(soundStorageKey) !== "muted";
    setSoundEnabled(enabled);
    soundEnabledRef.current = enabled;
    if (!enabled) clearToneQueue();
  }, [soundStorageKey, clearToneQueue]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearToneQueue();
    };
  }, [clearToneQueue]);
  useEffect(() => {
    if (!soundEnabled) return;
    const activateOnce = () => activateChatAudio();
    window.addEventListener("pointerdown", activateOnce, { once: true, capture: true });
    window.addEventListener("keydown", activateOnce, { once: true, capture: true });
    return () => {
      window.removeEventListener("pointerdown", activateOnce, { capture: true });
      window.removeEventListener("keydown", activateOnce, { capture: true });
    };
  }, [soundEnabled]);
  useEffect(() => {
    if (!docked) return;
    const openDock = (event: Event) => {
      const channelId = (event as CustomEvent<{ channelId?: string | number }>).detail?.channelId;
      if (channelId !== undefined) {
        hasInitializedSelectionRef.current = true;
        window.sessionStorage.removeItem("chat:open-channel");
        setSelectedId(channelId);
      }
      setOpen(true);
      setClosed(false);
    };
    window.addEventListener("team-chat:open", openDock);
    return () => window.removeEventListener("team-chat:open", openDock);
  }, [docked]);
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
    const channelId = selectedId;
    setDraft("");
    try {
      await sendJson(`/api/chat/channels/${channelId}/messages`, "POST", { body });
      if (String(selectedIdRef.current) === String(channelId)) await loadMessages();
    } catch (err) {
      if (String(selectedIdRef.current) === String(channelId)) {
        setError(err instanceof Error ? err.message : "Message could not be sent");
        setDraft(body);
      }
    }
  };

  const startDirect = async (userId: string | number) => {
    try {
      const channel = await sendJson<Channel>("/api/chat/channels/direct", "POST", { userId });
      await loadChannels();
      setSelectedId(channel.id);
      setPickerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start direct message");
    }
  };

  const unreadTotal = channels.reduce((total, channel) => total + channel.unreadCount, 0);
  const toggleSound = () => {
    const nextEnabled = !soundEnabled;
    setSoundEnabled(nextEnabled);
    soundEnabledRef.current = nextEnabled;
    window.localStorage.setItem(soundStorageKey, nextEnabled ? "on" : "muted");
    if (nextEnabled) activateChatAudio();
    else clearToneQueue();
  };

  if (docked && closed) {
    return (
      <div className="pointer-events-none fixed bottom-0 right-4 z-50">
        <button type="button" onClick={() => { activateChatAudio(); setClosed(false); setOpen(false); }} aria-label="Open Team Chat" title="Open Team Chat" className="pointer-events-auto relative flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#075d68] bg-[#098b9f] text-white shadow-[2px_3px_0_rgba(20,45,48,.35)] transition-transform hover:-translate-y-0.5 hover:bg-[#087c8d]">
          <MessageCircle className="h-5 w-5" />
          {unreadTotal > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-[#d4d0c8] bg-[#b54444] px-1 text-[9px] font-bold text-white">{unreadTotal >= 10 ? "9+" : unreadTotal}</span>}
        </button>
       </div>
    );
  }

  return (
    <div
      id={docked ? "team-chat-dock-panel" : undefined}
      className={cn(
        "flex flex-col bg-[#c0c0c0]",
        docked
          ? cn(
              "pointer-events-auto fixed bottom-0 right-4 z-50 w-[min(320px,calc(100vw-1rem))] border-2 border-[#808080] shadow-[3px_3px_0_rgba(50,50,50,.28)]",
              open ? "h-[min(420px,100dvh)]" : "h-12"
            )
          : "h-full"
      )}
      aria-label="Team Chat"
    >
      {docked && (
        <header className="flex h-12 w-full shrink-0 items-center bg-[#098b9f] px-1.5 text-white">
          <button type="button" onClick={() => setOpen((value) => !value)} className="flex h-full min-w-0 flex-1 items-center gap-2 px-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-white" aria-label={open ? "Collapse Team Chat" : "Expand Team Chat"} aria-expanded={open}>
            <MessageCircle className="h-4 w-4 shrink-0" />
            <span className="text-[13px] font-bold">Team Chat</span>
            {selected && <span className="min-w-0 truncate text-[11px] text-[#dff5f6]">— {selected.directName || selected.name}</span>}
          </button>
          <button type="button" onClick={toggleSound} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-white/80 hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" aria-label={soundEnabled ? "Mute Team Chat sounds" : "Unmute Team Chat sounds"} aria-pressed={!soundEnabled} title={soundEnabled ? "Mute chat sounds" : "Unmute chat sounds"}>
            {soundEnabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
          </button>
          <button type="button" onClick={() => setOpen((value) => !value)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-white/80 hover:bg-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" aria-label={open ? "Collapse Team Chat" : "Expand Team Chat"} aria-expanded={open}>
            <Minus className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => { setOpen(false); setClosed(true); setPickerOpen(false); setEmojiPickerOpen(false); }} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-white/80 hover:bg-[#b54444] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" aria-label="Close Team Chat" title="Close Team Chat">
            <X className="h-4 w-4" />
          </button>
        </header>
      )}
      {open && <div className={cn(
        "flex min-h-0 w-full flex-1 overflow-hidden border-2 border-[#808080] bg-[#d4d0c8] shadow-[inset_1px_1px_#fff]",
        docked && "flex-1"
      )}>
        <aside className="flex w-[120px] shrink-0 flex-col border-r-2 border-[#808080] bg-[#c0c0c0]">
          <div className="flex h-10 items-center justify-center border-b-2 border-[#808080] bg-[#dff5f6]">
            <button type="button" onClick={() => setPickerOpen(true)} title="New direct message" aria-label="New direct message" className="flex h-7 w-7 items-center justify-center rounded-sm bg-[#098b9f] text-white hover:bg-[#087c8d]"><Plus className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loadingChannels ? <div className="space-y-2 p-1">{[1, 2, 3, 4].map((item) => <div key={item} className="h-12 animate-pulse bg-[#d4d0c8]" />)}</div>
              : error && !channels.length ? <div className="p-4 text-center text-xs text-[#7c3535]"><AlertCircle className="mx-auto mb-2 h-6 w-6" />{error}<Button onClick={loadChannels} variant="outline" className="mt-3 h-7 rounded-sm text-xs">Retry</Button></div>
              : !visibleChannels.length ? <div className="p-3 text-center text-[10px] text-[#555]"><MessageCircle className="mx-auto mb-2 h-6 w-6 text-[#098b9f]" />No conversations</div>
              : visibleChannels.map((channel) => {
                const isDirect = channel.type === "direct" || Boolean(channel.directName);
                const label = isDirect ? channel.directName || channel.name : channel.name;
                  return <button key={channel.id} onClick={() => setSelectedId(channel.id)} title={label} aria-label={label} className={cn("relative flex h-11 w-full items-center justify-center border-l-2 text-left hover:bg-[#d4d0c8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#098b9f]", String(selectedId) === String(channel.id) ? "border-[#098b9f] bg-[#dff5f6]" : "border-transparent")}>
                   <span className={cn("flex h-8 w-8 items-center justify-center rounded-sm text-[10px] font-bold", isDirect ? "bg-[#efc886] text-[#674c20]" : "bg-[#8bbfc1] text-[#154c51]")}>{isDirect ? initials(label) : <Hash className="h-4 w-4" />}</span>
                   {channel.unreadCount > 0 && <span className="absolute right-3 top-1.5 h-2.5 w-2.5 rounded-full border border-[#c0c0c0] bg-[#b54444]" aria-label={`${channel.unreadCount} unread`} />}
                </button>;
              })}
          </div>
        </aside>

         <section className="flex min-w-0 flex-1 flex-col bg-[#efeee9]">
           {selected ? <><header className="flex h-9 shrink-0 items-center gap-2 border-b border-[#808080] bg-[#d4d0c8] px-2">
             <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-[#8bbfc1] text-[#154c51]">{selected.type === "direct" || selected.directName ? <UserRound className="h-3 w-3" /> : <Hash className="h-3 w-3" />}</span>
             <div className="min-w-0"><h2 className="truncate text-xs font-bold text-[#1a1a1a]">{selected.directName || selected.name}</h2></div>
             <MoreHorizontal className="ml-auto h-4 w-4 text-[#777]" />
          </header>
           <div className="flex-1 overflow-y-auto px-2 py-2">
            {loadingMessages && !messages.length ? <div className="space-y-4">{[1, 2, 3].map((item) => <div key={item} className={cn("h-14 animate-pulse bg-[#d9d8d2]", item % 2 === 0 ? "ml-auto max-w-[60%]" : "max-w-[55%]")} />)}</div>
               : messages.length ? messages.map((message) => <div key={message.id} className={cn("mb-2 flex gap-1.5", String(message.senderId) === String(user?.id) ? "justify-end" : "justify-start")}>
                 <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[7px] font-bold", String(message.senderId) === String(user?.id) ? "order-2 bg-[#098b9f] text-white" : "bg-[#b7c9c7] text-[#31585a]")}>{initials(message.senderName)}</div>
                  <div className={cn("max-w-[84%]", String(message.senderId) === String(user?.id) && "text-right")}><div className="mb-0.5 flex items-baseline gap-1 text-[8px] text-[#777]"><span className="font-semibold text-[#4e5554]">{message.senderName}</span><span>{timeLabel(message.createdAt)}</span></div><div className={cn("inline-block whitespace-pre-wrap break-words border px-2 py-1 text-[11px] leading-snug shadow-[1px_1px_0_#bbb]", String(message.senderId) === String(user?.id) ? "border-[#087888] bg-[#098b9f] text-white" : "border-[#b8b7b0] bg-[#fffdf5] text-[#252525]")}>{renderMessageBody(message.body)}</div></div>
              </div>) : <div className="flex h-full flex-col items-center justify-center text-center text-[#707371]"><MessageCircle className="mb-3 h-10 w-10 text-[#8bbfc1]" /><p className="font-semibold">No messages here yet</p><p className="mt-1 text-xs">Send the first note to this conversation.</p></div>}
            <div ref={bottomRef} />
          </div>
           <div className="border-t border-[#808080] bg-[#d4d0c8] p-1.5"><div className="relative flex items-center gap-1 border-2 border-[#808080] border-r-white border-b-white bg-[#f9f8f2] p-0.5"><textarea ref={textareaRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitMessage(); } }} placeholder={`Message ${selected.directName || selected.name}...`} rows={1} className="h-7 min-h-7 flex-1 resize-none overflow-hidden bg-transparent px-1.5 py-1 text-[11px] outline-none" /><div ref={emojiPickerRef} className="relative shrink-0"><Button type="button" variant="ghost" onClick={() => setEmojiPickerOpen((open) => !open)} aria-label="Choose emoji" aria-expanded={emojiPickerOpen} className="h-7 w-7 rounded-sm p-0 text-[#666] hover:bg-[#dff5f6] hover:text-[#098b9f]"><Smile className="h-4 w-4" /></Button>{emojiPickerOpen && <div className="absolute bottom-[calc(100%+0.65rem)] right-0 z-40 w-[min(352px,calc(100vw-2.5rem))] max-h-[min(420px,60vh)] overflow-auto rounded-md border border-[#808080] bg-white shadow-lg"><Picker data={emojiPickerData} onEmojiSelect={insertEmoji} categories={["tpf", "frequent", "people", "nature", "foods", "activity", "places", "objects", "symbols"]} categoryIcons={{ tpf: { src: "/emojis/tpf-logo.png" } }} previewPosition="none" skinTonePosition="search" width="100%" height={380} /></div>}</div><Button onClick={submitMessage} disabled={!draft.trim()} aria-label="Send message" title="Send message" className="h-7 w-7 rounded-sm bg-[#098b9f] p-0 text-white hover:bg-[#087c8d]"><Send className="h-3.5 w-3.5" /></Button></div></div>
        </> : <div className="flex flex-1 flex-col items-center justify-center text-center text-[#666]"><Users className="mb-3 h-12 w-12 text-[#8bbfc1]" /><h2 className="font-bold text-[#333]">Your team, in sync</h2><p className="mt-1 max-w-xs text-xs">Choose a channel or start a direct message to begin.</p></div>}
        </section>
       </div>}
       {error && channels.length > 0 && <div className="absolute bottom-1 left-1 right-1 z-30 flex items-center gap-2 bg-[#fff3d6] px-1.5 py-1 text-[10px] text-[#8b4141]"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}<button onClick={() => setError("")} aria-label="Dismiss" className="ml-auto"><X className="h-3 w-3" /></button></div>}
      {pickerOpen && <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#263b44]/30 p-4" onMouseDown={(event) => event.currentTarget === event.target && setPickerOpen(false)}><div className="w-full max-w-md border-2 border-[#808080] bg-[#d4d0c8] p-4 shadow-[3px_3px_0_#555]"><div className="mb-3 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-wider text-[#557277]">New conversation</p><h2 className="font-bold">Message a teammate</h2></div><button onClick={() => setPickerOpen(false)}><X className="h-4 w-4" /></button></div><div className="max-h-72 overflow-y-auto border-2 border-[#808080] bg-[#efeee9]">{users.length ? users.map((user) => <button key={user.id} onClick={() => startDirect(user.id)} className="flex w-full items-center gap-3 border-b border-[#c4c3bd] px-3 py-3 text-left last:border-0 hover:bg-[#dff5f6]"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#efc886] text-[10px] font-bold text-[#674c20]">{initials(user.name)}</span><span><span className="block text-sm font-semibold">{user.name}</span><span className="block text-[10px] uppercase text-[#777]">{user.role || "Team member"}</span></span></button>) : <p className="p-5 text-center text-xs text-[#666]">No teammates available.</p>}</div></div></div>}
    </div>
  );
}

export function TeamChatDock() {
  const { user, permissions, isLoading } = useAuth();
  const [location] = useLocation();
  const canUseChat = !!user && (user.role === "admin" || (!isLoading && permissions.includes("chat")));
  const isPortalRoute = location === "/portal" || location.startsWith("/portal/");
  const isInternalRoute = location !== "/login" && !isPortalRoute;
  return canUseChat && isInternalRoute ? <ChatPanel docked /> : null;
}

export default function Chat() {
  return <ChatPanel />;
}