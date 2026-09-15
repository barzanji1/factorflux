import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Send, Search, MessageCircle, ExternalLink, FileText, Image as ImageIcon } from "lucide-react";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ChatSummary = {
  chatId: string | number;
  carrierId: string | number;
  carrierName: string;
  mcNumber?: string | null;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  unreadCount: number;
};

type ChatMessage = {
  id: string | number;
  senderType: string;
  senderName: string;
  senderAvatar?: string | null;
  message: string;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  createdAt: string;
};

type ChatThread = {
  chat?: ChatSummary;
  messages: ChatMessage[];
};

const QUICK_REPLIES = [
  "We have received your documents and are processing your invoice",
  "Your payment has been sent via [ACH/Wire]",
  "Please upload your Rate Confirmation and Bill of Lading",
  "Your invoice is currently under review",
  "We need additional documentation for this invoice",
];

function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function isAgentMessage(message: ChatMessage) {
  return !["carrier", "client"].includes(message.senderType.toLowerCase());
}

export default function CarrierMessages() {
  const [location, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedCarrierId, setSelectedCarrierId] = useState<string | number | null>(null);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof window.Notification === "undefined" ? "denied" : window.Notification.permission,
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const requestedCarrierId = useMemo(() => {
    const query = location.includes("?") ? location.slice(location.indexOf("?") + 1) : "";
    return new URLSearchParams(query).get("carrierId");
  }, [location]);

  const { data: summaries = [], isLoading: summariesLoading } = useQuery<ChatSummary[]>({
    queryKey: ["/api/carrier-chat"],
    queryFn: async () => {
      const response = await fetch("/api/carrier-chat", { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load carrier conversations");
      const rows = await response.json();
      return (Array.isArray(rows) ? rows : []).map((row: any) => {
        const last = row.lastMessage && typeof row.lastMessage === "object" ? row.lastMessage : null;
        return {
          ...row,
          chatId: row.chatId ?? row.id,
          carrierName: row.carrierName || row.portalCompanyName || "Carrier",
          lastMessage: typeof row.lastMessage === "string" ? row.lastMessage : (last?.message || ""),
          lastMessageAt: row.lastMessageAt || last?.createdAt || row.updatedAt,
          unreadCount: Number(row.unreadCount || 0),
        };
      });
    },
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (requestedCarrierId) {
      setSelectedCarrierId(requestedCarrierId);
      return;
    }
    if (!summaries.length) {
      setSelectedCarrierId(null);
      return;
    }
    if (!selectedCarrierId || !summaries.some((chat) => String(chat.carrierId) === String(selectedCarrierId))) {
      setSelectedCarrierId(summaries[0].carrierId);
    }
  }, [summaries, requestedCarrierId, selectedCarrierId]);

  const selectedSummary = summaries.find((chat) => String(chat.carrierId) === String(selectedCarrierId));
  const filteredSummaries = summaries.filter((chat) => {
    const term = search.trim().toLowerCase();
    return !term || [chat.carrierName, chat.mcNumber, chat.lastMessage].some((value) => value?.toLowerCase().includes(term));
  });
  const { data: selectedCarrierProfile } = useQuery<{ name?: string | null; mcNumber?: string | null }>({
    queryKey: ["/api/clients", selectedCarrierId, "carrier-message-profile"],
    queryFn: async () => {
      const response = await fetch(`/api/clients/${selectedCarrierId}`, { credentials: "include" });
      if (!response.ok) return {};
      return response.json();
    },
    enabled: selectedCarrierId !== null && !selectedSummary?.mcNumber,
    retry: false,
  });

  const { data: thread, isLoading: threadLoading } = useQuery<ChatThread>({
    queryKey: ["/api/carrier-chat/thread", selectedCarrierId],
    queryFn: async () => {
      const response = await fetch(`/api/carrier-chat/${selectedCarrierId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load this conversation");
      const result = await response.json();
      return {
        ...result,
        messages: (Array.isArray(result.messages) ? result.messages : []).map((message: any) => ({
          ...message,
          message: message.message || "",
          attachmentName: message.attachmentName || message.attachment?.name || null,
          attachmentUrl: message.attachmentUrl || message.attachment?.viewUrl || null,
        })),
      };
    },
    enabled: selectedCarrierId !== null,
    refetchInterval: 5000,
  });
  const messages = thread?.messages || [];
  const activeSummary = selectedSummary || (selectedCarrierId !== null ? {
    chatId: thread?.chat?.chatId ?? `carrier-${selectedCarrierId}`,
    carrierId: selectedCarrierId,
    carrierName: thread?.chat?.carrierName || selectedCarrierProfile?.name || "Carrier",
    mcNumber: thread?.chat?.mcNumber || selectedCarrierProfile?.mcNumber,
    unreadCount: 0,
  } : undefined);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, selectedCarrierId]);

  const sendMessage = useMutation({
    mutationFn: async () => {
      if (selectedCarrierId === null || (!draft.trim() && !attachment)) throw new Error("Enter a message or choose an attachment");
      const form = new FormData();
      form.append("message", draft.trim());
      if (attachment) form.append("attachment", attachment);
      const response = await fetch(`/api/carrier-chat/${selectedCarrierId}/messages`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Unable to send message");
      }
      return response.json();
    },
    onSuccess: () => {
      setDraft("");
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-chat/thread", selectedCarrierId] });
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-chat"] });
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-chat/unread-count"] });
    },
  });

  const selectChat = (carrierId: string | number) => {
    setSelectedCarrierId(carrierId);
    navigate(`/carrier-messages?carrierId=${carrierId}`);
  };

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Carrier Messages" subtitle="Internal agent-to-carrier conversations" group="Workspace" />
        <main className="flex min-h-0 flex-1 overflow-hidden p-3 md:p-5">
          <div className="mx-auto flex min-h-0 w-full max-w-[1500px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <aside className="flex w-full max-w-sm shrink-0 flex-col border-r border-slate-200 dark:border-slate-700">
              <div className="border-b border-slate-200 p-4 dark:border-slate-700">
                <h1 className="mb-3 flex items-center gap-2 text-base font-semibold"><MessageCircle className="h-5 w-5 text-[#098b9f]" />Carrier conversations</h1>
                {notificationPermission === "default" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mb-3 w-full"
                    onClick={async () => setNotificationPermission(await window.Notification.requestPermission())}
                  >
                    Enable new-message notifications
                  </Button>
                )}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search carriers…" className="pl-9" />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {summariesLoading ? (
                  <p className="p-5 text-sm text-slate-500">Loading conversations…</p>
                ) : filteredSummaries.length === 0 ? (
                  <p className="p-5 text-sm text-slate-500">No carrier conversations found.</p>
                ) : filteredSummaries.map((chat) => {
                  const active = String(chat.carrierId) === String(selectedCarrierId);
                  return (
                    <button key={chat.chatId} type="button" onClick={() => selectChat(chat.carrierId)} className={cn("flex w-full gap-3 border-b border-slate-100 p-4 text-left transition-colors dark:border-slate-800", active ? "bg-cyan-50 dark:bg-cyan-950/30" : chat.unreadCount > 0 ? "bg-amber-50/60 hover:bg-amber-50 dark:bg-amber-950/20 dark:hover:bg-amber-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/50", chat.unreadCount > 0 && "font-medium")}>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dff5f6] text-sm font-semibold text-[#087d8d]">{chat.carrierName?.slice(0, 1).toUpperCase() || "C"}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm text-slate-800 dark:text-slate-100">{chat.carrierName}</p>
                          <span className="shrink-0 text-[11px] text-slate-400">{formatTime(chat.lastMessageAt)}</span>
                        </div>
                        <p className="text-xs text-slate-500">{chat.mcNumber ? `MC ${chat.mcNumber}` : "Carrier"}</p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <p className="truncate text-xs text-slate-500">{chat.lastMessage || "No messages yet"}</p>
                          {chat.unreadCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#b54444] px-1 text-[10px] font-bold text-white">{chat.unreadCount > 9 ? "9+" : chat.unreadCount}</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="flex min-w-0 flex-1 flex-col">
              {activeSummary ? (
                <>
                  <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-slate-900 dark:text-white">{activeSummary.carrierName}</h2>
                      <p className="text-xs text-slate-500">{activeSummary.mcNumber || selectedCarrierProfile?.mcNumber ? `MC ${activeSummary.mcNumber || selectedCarrierProfile?.mcNumber}` : "Carrier conversation"}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => navigate(`/clients/${activeSummary.carrierId}`)} className="shrink-0 gap-1"><ExternalLink className="h-3.5 w-3.5" />View profile</Button>
                  </header>
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-5 dark:bg-slate-950/30">
                    {threadLoading && <p className="text-center text-sm text-slate-500">Loading messages…</p>}
                    {!threadLoading && messages.length === 0 && <div className="flex h-full items-center justify-center text-sm text-slate-500">Start a conversation with this carrier.</div>}
                    {messages.map((message) => {
                      const agent = isAgentMessage(message);
                      return (
                        <div key={message.id} className={cn("flex", agent ? "justify-end" : "justify-start")}>
                          <div className={cn("max-w-[min(75%,38rem)] rounded-2xl px-4 py-3 shadow-sm", agent ? "rounded-br-sm bg-[#098b9f] text-white" : "rounded-bl-sm bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100")}>
                            <p className={cn("mb-1 text-[11px] font-semibold", agent ? "text-cyan-50" : "text-slate-500")}>{message.senderName}</p>
                            {message.message && <p className="whitespace-pre-wrap text-sm">{message.message}</p>}
                            {message.attachmentUrl && (
                              <a href={message.attachmentUrl} target="_blank" rel="noreferrer" className={cn("mt-2 flex items-center gap-2 text-xs underline", agent ? "text-white" : "text-[#087d8d]")}>
                                {message.attachmentName?.match(/\.(png|jpe?g|gif|webp)$/i) ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                                {message.attachmentName || "View attachment"}
                              </a>
                            )}
                            <p className={cn("mt-1 text-right text-[10px]", agent ? "text-cyan-100" : "text-slate-400")}>{formatTime(message.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                  <div className="border-t border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                    <div className="mb-3 flex flex-wrap gap-2">
                      {QUICK_REPLIES.map((reply) => <Button key={reply} type="button" variant="outline" size="sm" onClick={() => setDraft(reply)} className="h-7 text-xs">{reply}</Button>)}
                    </div>
                    {attachment && <p className="mb-2 flex items-center gap-1 text-xs text-slate-500"><Paperclip className="h-3.5 w-3.5" />{attachment.name}<button type="button" className="ml-1 underline" onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>Remove</button></p>}
                    <div className="flex items-end gap-2">
                      <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!sendMessage.isPending) sendMessage.mutate(); } }} placeholder="Write a message…" rows={2} className="min-h-0 resize-none" />
                      <input ref={fileInputRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) setAttachment(file); }} />
                      <Button type="button" variant="outline" size="icon" title="Attach PDF or image" onClick={() => fileInputRef.current?.click()}><Paperclip className="h-4 w-4" /></Button>
                      <Button type="button" size="icon" disabled={sendMessage.isPending || (!draft.trim() && !attachment)} onClick={() => sendMessage.mutate()} title="Send message"><Send className="h-4 w-4" /></Button>
                    </div>
                    {sendMessage.isError && <p className="mt-2 text-xs text-red-600">{(sendMessage.error as Error).message}</p>}
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Select a carrier conversation to begin.</div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}