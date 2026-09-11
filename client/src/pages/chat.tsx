import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Hash, MessageCircle, MoreHorizontal, Plus, Send, UserRound, Users, X } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

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

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`${response.status}: Unable to load chat`);
  return response.json();
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

const initials = (name: string) => name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
const timeLabel = (date: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(date));

export default function Chat() {
  const { user } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRequestRef = useRef(0);
  const selectedIdRef = useRef<string | number | null>(selectedId);
  selectedIdRef.current = selectedId;

  const selected = channels.find((channel) => String(channel.id) === String(selectedId));
  const visibleChannels = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return channels;
    return channels.filter((channel) => (channel.directName || channel.name).toLowerCase().includes(query));
  }, [channels, search]);

  const loadChannels = useCallback(async () => {
    try {
      const result = await getJson<Channel[]>("/api/chat/channels");
      setChannels(result);
      setSelectedId((current) => current ?? result[0]?.id ?? null);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load channels");
    } finally {
      setLoadingChannels(false);
    }
  }, []);

  const loadMessages = useCallback(async () => {
    if (selectedId === null) return;
    const channelId = selectedId;
    const requestId = ++messageRequestRef.current;
    setLoadingMessages(true);
    try {
      const result = await getJson<Message[]>(`/api/chat/channels/${channelId}/messages`);
      if (requestId !== messageRequestRef.current) return;
      setMessages(result);
      await sendJson(`/api/chat/channels/${channelId}/read`, "PATCH");
      if (requestId !== messageRequestRef.current) return;
      setChannels((current) => current.map((channel) => String(channel.id) === String(channelId) ? { ...channel, unreadCount: 0 } : channel));
    } catch (err) {
      if (requestId === messageRequestRef.current) setError(err instanceof Error ? err.message : "Unable to load messages");
    } finally {
      if (requestId === messageRequestRef.current) setLoadingMessages(false);
    }
  }, [selectedId]);

  useEffect(() => { loadChannels(); const timer = window.setInterval(loadChannels, 3000); return () => window.clearInterval(timer); }, [loadChannels]);
  useEffect(() => {
    setMessages([]);
    loadMessages();
    const timer = window.setInterval(loadMessages, 3000);
    return () => {
      messageRequestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [loadMessages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, selectedId]);
  useEffect(() => {
    getJson<ChatUser[]>("/api/chat/users").then(setUsers).catch(() => undefined);
  }, []);

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

  return (
    <AppShell title="Chat" subtitle="Coordinate with your team in real time" group="Workspace">
      <div className="flex h-[calc(100dvh-7.5rem)] min-h-[520px] overflow-hidden border-2 border-[#808080] bg-[#d4d0c8] shadow-[inset_1px_1px_#fff]">
        <aside className={cn("flex w-full max-w-[310px] shrink-0 flex-col border-r-2 border-[#808080] bg-[#c0c0c0]", selectedId !== null && "hidden md:flex")}>
          <div className="border-b-2 border-[#808080] bg-[#dff5f6] px-3 py-3">
            <div className="flex items-center justify-between">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#557277]">Workspace</p><h1 className="text-lg font-bold text-[#1a1a1a]">Messages</h1></div>
              <Button onClick={() => setPickerOpen(true)} title="New direct message" className="h-8 w-8 rounded-sm bg-[#098b9f] p-0 text-white hover:bg-[#087c8d]"><Plus className="h-4 w-4" /></Button>
            </div>
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a conversation..." className="mt-3 h-8 rounded-sm border-[#808080] bg-[#f0efea] text-xs" />
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loadingChannels ? <div className="space-y-2 p-1">{[1, 2, 3, 4].map((item) => <div key={item} className="h-12 animate-pulse bg-[#d4d0c8]" />)}</div>
              : error && !channels.length ? <div className="p-4 text-center text-xs text-[#7c3535]"><AlertCircle className="mx-auto mb-2 h-6 w-6" />{error}<Button onClick={loadChannels} variant="outline" className="mt-3 h-7 rounded-sm text-xs">Retry</Button></div>
              : !visibleChannels.length ? <div className="p-7 text-center text-xs text-[#555]"><MessageCircle className="mx-auto mb-2 h-7 w-7 text-[#098b9f]" />No conversations yet.<br />Start a direct message.</div>
              : visibleChannels.map((channel) => {
                const isDirect = channel.type === "direct" || Boolean(channel.directName);
                const label = isDirect ? channel.directName || channel.name : channel.name;
                return <button key={channel.id} onClick={() => setSelectedId(channel.id)} className={cn("flex w-full items-center gap-3 border-l-2 px-2.5 py-2.5 text-left hover:bg-[#d4d0c8]", String(selectedId) === String(channel.id) ? "border-[#098b9f] bg-[#dff5f6]" : "border-transparent")}>
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-xs font-bold", isDirect ? "bg-[#efc886] text-[#674c20]" : "bg-[#8bbfc1] text-[#154c51]")}>{isDirect ? initials(label) : <Hash className="h-4 w-4" />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#1a1a1a]">{label}</span><span className="block text-[10px] uppercase tracking-wider text-[#666]">{isDirect ? "Direct message" : `${channel.members?.length || 0} members`}</span></span>
                  {channel.unreadCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#b54444] px-1 text-[10px] font-bold text-white">{channel.unreadCount}</span>}
                </button>;
              })}
          </div>
        </aside>

        <section className={cn("flex min-w-0 flex-1 flex-col bg-[#efeee9]", selectedId === null && "hidden md:flex")}>
          {selected ? <><header className="flex items-center gap-3 border-b-2 border-[#808080] bg-[#d4d0c8] px-3 py-3 md:px-5">
            <button className="mr-1 text-xs text-[#098b9f] md:hidden" onClick={() => setSelectedId(null)}>Back</button>
            <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-[#8bbfc1] text-[#154c51]">{selected.type === "direct" || selected.directName ? <UserRound className="h-4 w-4" /> : <Hash className="h-4 w-4" />}</span>
            <div className="min-w-0"><h2 className="truncate text-base font-bold text-[#1a1a1a]">{selected.directName || selected.name}</h2><p className="text-[10px] uppercase tracking-wider text-[#666]">{selected.type === "direct" || selected.directName ? "Direct message" : "Team channel"}</p></div>
            <MoreHorizontal className="ml-auto h-5 w-5 text-[#777]" />
          </header>
          <div className="flex-1 overflow-y-auto px-3 py-5 md:px-7">
            {loadingMessages && !messages.length ? <div className="space-y-4">{[1, 2, 3].map((item) => <div key={item} className={cn("h-14 animate-pulse bg-[#d9d8d2]", item % 2 === 0 ? "ml-auto max-w-[60%]" : "max-w-[55%]")} />)}</div>
              : messages.length ? messages.map((message) => <div key={message.id} className={cn("mb-5 flex gap-2.5", String(message.senderId) === String(user?.id) ? "justify-end" : "justify-start")}>
                <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold", String(message.senderId) === String(user?.id) ? "order-2 bg-[#098b9f] text-white" : "bg-[#b7c9c7] text-[#31585a]")}>{initials(message.senderName)}</div>
                <div className={cn("max-w-[78%] md:max-w-[65%]", String(message.senderId) === String(user?.id) && "text-right")}><div className="mb-1 flex items-baseline gap-2 text-[10px] text-[#777]"><span className="font-semibold text-[#4e5554]">{message.senderName}</span><span>{timeLabel(message.createdAt)}</span></div><div className={cn("inline-block border-2 px-3 py-2 text-sm leading-relaxed shadow-[1px_1px_0_#aaa]", String(message.senderId) === String(user?.id) ? "border-[#087888] bg-[#098b9f] text-white" : "border-[#b8b7b0] bg-[#fffdf5] text-[#252525]")}>{message.body}</div></div>
              </div>) : <div className="flex h-full flex-col items-center justify-center text-center text-[#707371]"><MessageCircle className="mb-3 h-10 w-10 text-[#8bbfc1]" /><p className="font-semibold">No messages here yet</p><p className="mt-1 text-xs">Send the first note to this conversation.</p></div>}
            <div ref={bottomRef} />
          </div>
          <div className="border-t-2 border-[#808080] bg-[#d4d0c8] p-3 md:p-4"><div className="flex items-end gap-2 border-2 border-[#808080] border-r-white border-b-white bg-[#f9f8f2] p-1.5"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitMessage(); } }} placeholder={`Message ${selected.directName || selected.name}...`} rows={1} className="max-h-28 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none" /><Button onClick={submitMessage} disabled={!draft.trim()} className="h-9 rounded-sm bg-[#098b9f] px-3 text-white hover:bg-[#087c8d]"><Send className="mr-1.5 h-4 w-4" /><span className="hidden sm:inline">Send</span></Button></div><p className="mt-1.5 px-1 text-[10px] text-[#777]">Enter to send · Shift + Enter for a new line</p></div>
        </> : <div className="flex flex-1 flex-col items-center justify-center text-center text-[#666]"><Users className="mb-3 h-12 w-12 text-[#8bbfc1]" /><h2 className="font-bold text-[#333]">Your team, in sync</h2><p className="mt-1 max-w-xs text-xs">Choose a channel or start a direct message to begin.</p></div>}
        </section>
      </div>
      {error && channels.length > 0 && <div className="mt-2 flex items-center gap-2 text-xs text-[#8b4141]"><AlertCircle className="h-3.5 w-3.5" />{error}<button onClick={() => setError("")} aria-label="Dismiss"><X className="h-3 w-3" /></button></div>}
      {pickerOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#263b44]/30 p-4" onMouseDown={(event) => event.currentTarget === event.target && setPickerOpen(false)}><div className="w-full max-w-md border-2 border-[#808080] bg-[#d4d0c8] p-4 shadow-[3px_3px_0_#555]"><div className="mb-3 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-wider text-[#557277]">New conversation</p><h2 className="font-bold">Message a teammate</h2></div><button onClick={() => setPickerOpen(false)}><X className="h-4 w-4" /></button></div><div className="max-h-72 overflow-y-auto border-2 border-[#808080] bg-[#efeee9]">{users.length ? users.map((user) => <button key={user.id} onClick={() => startDirect(user.id)} className="flex w-full items-center gap-3 border-b border-[#c4c3bd] px-3 py-3 text-left last:border-0 hover:bg-[#dff5f6]"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#efc886] text-[10px] font-bold text-[#674c20]">{initials(user.name)}</span><span><span className="block text-sm font-semibold">{user.name}</span><span className="block text-[10px] uppercase text-[#777]">{user.role || "Team member"}</span></span></button>) : <p className="p-5 text-center text-xs text-[#666]">No teammates available.</p>}</div></div></div>}
    </AppShell>
  );
}