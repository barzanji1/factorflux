import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileImage, FileText, Loader2, MessageCircle, Paperclip, Send, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import PortalLayout from "@/components/layout/portal-layout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface PortalUser {
  companyName: string;
}

interface Agent {
  name?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  avatarUrl?: string;
  profileImageUrl?: string;
}

interface ChatSummary {
  agent?: Agent;
  agentName?: string;
  agentAvatar?: string;
  unreadCount?: number;
  unread?: number;
  unreadMessages?: number;
}

interface ChatMessage {
  id: number | string;
  senderType: string;
  senderName: string;
  senderAvatar?: string | null;
  message: string;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  createdAt: string;
}

const QUICK_MESSAGES = [
  "What is the status of my invoice?",
  "I have uploaded my documents",
  "When will I receive my payment?",
  "I need a fuel advance",
] as const;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function responseMessages(value: unknown): ChatMessage[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { messages?: unknown }).messages)
      ? (value as { messages: unknown[] }).messages
      : [];
  return rows.map((message: any) => ({
    ...message,
    message: message.message || "",
    attachmentName: message.attachmentName || message.attachment?.name || null,
    attachmentUrl: message.attachmentUrl || message.attachment?.viewUrl || null,
  })) as ChatMessage[];
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (response.status === 401) {
    window.location.href = "/portal/login";
    throw new Error("Portal session expired");
  }
  if (!response.ok) throw new Error("Unable to load messages");
  return response.json() as Promise<T>;
}

export default function PortalChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const latestCreatedAtRef = useRef("");
  const latestMessageIdRef = useRef(0);
  const requestRef = useRef(0);

  const { data: me } = useQuery<PortalUser>({
    queryKey: ["/api/portal/me"],
    retry: false,
  });
  const { data: summary } = useQuery<ChatSummary>({
    queryKey: ["/api/portal/chat"],
    refetchInterval: 5000,
    retry: false,
  });

  const agent = useMemo(() => {
    const summaryAgent = summary?.agent;
    const agentFullName = [summaryAgent?.firstName, summaryAgent?.lastName].filter(Boolean).join(" ");
    return {
      name: summaryAgent?.name || agentFullName || summary?.agentName || "TPF Support",
      avatar: summaryAgent?.profileImageUrl || summaryAgent?.avatarUrl || summaryAgent?.avatar || summary?.agentAvatar || "",
    };
  }, [summary]);

  const loadMessages = useCallback(async (initial = false) => {
    const requestId = ++requestRef.current;
    const since = initial ? "" : latestCreatedAtRef.current;
    const url = since
      ? `/api/portal/chat/messages?since=${encodeURIComponent(since)}&afterId=${latestMessageIdRef.current}`
      : "/api/portal/chat/messages";

    try {
      const result = responseMessages(await getJson<unknown>(url));
      if (requestId !== requestRef.current) return;
      if (result.length) {
        setMessages((current) => {
          const byId = new Map<string, ChatMessage>();
          [...current, ...result].forEach((message) => byId.set(String(message.id), message));
          return Array.from(byId.values()).sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
        });
        for (const message of result) {
          const messageTime = new Date(message.createdAt).getTime();
          const latestTime = latestCreatedAtRef.current ? new Date(latestCreatedAtRef.current).getTime() : -1;
          const messageId = Number(message.id);
          if (messageTime > latestTime || (messageTime === latestTime && messageId > latestMessageIdRef.current)) {
            latestCreatedAtRef.current = message.createdAt;
            latestMessageIdRef.current = messageId;
          }
        }
      }
      setError("");
    } catch (err) {
      if (requestId === requestRef.current) {
        setError(err instanceof Error ? err.message : "Unable to load messages");
      }
    } finally {
      if (requestId === requestRef.current) setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    loadMessages(true);
    const timer = window.setInterval(() => loadMessages(false), 5000);
    return () => {
      requestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const submitMessage = async () => {
    const text = draft.trim();
    if ((!text && !attachment) || sending) return;
    setSending(true);
    setError("");
    const formData = new FormData();
    formData.append("message", text);
    if (attachment) formData.append("attachment", attachment);

    try {
      const response = await fetch("/api/portal/chat/messages", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || "Message could not be sent");
      }
      setDraft("");
      setAttachment(null);
      await loadMessages(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message could not be sent");
    } finally {
      setSending(false);
    }
  };

  return (
    <PortalLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Messages</h1>
          <p className="mt-0.5 text-sm text-slate-500">Connect with your TPF support team.</p>
        </div>

        <Card className="flex h-[calc(100dvh-12rem)] min-h-[500px] flex-col overflow-hidden rounded-2xl">
          <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
            <Avatar className="h-10 w-10 border border-blue-100">
              <AvatarImage src={agent.avatar} alt="" />
              <AvatarFallback className="bg-blue-50 text-sm font-semibold text-blue-700">{initials(agent.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{agent.name}</p>
              <p className="text-xs text-emerald-600">TPF Support</p>
            </div>
            <MessageCircle className="ml-auto h-5 w-5 text-blue-500" />
          </div>

          <CardContent className="flex-1 overflow-y-auto bg-slate-50/70 p-4 sm:p-6">
            {loadingMessages && !messages.length ? (
              <div className="flex h-full items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-blue-500" /></div>
            ) : messages.length ? (
              <div className="space-y-4">
                {messages.map((item) => {
                  const isCarrier = item.senderType === "carrier";
                  const sender = item.senderName || (isCarrier ? me?.companyName || "You" : agent.name);
                  const attachmentIsImage = /\.(jpe?g|png|gif|webp|svg)$/i.test(item.attachmentName || "");
                  return (
                    <div key={item.id} className={`flex items-end gap-2 ${isCarrier ? "justify-end" : "justify-start"}`}>
                      {!isCarrier && (
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarImage src={item.senderAvatar || agent.avatar} alt="" />
                          <AvatarFallback className="bg-blue-100 text-[10px] font-semibold text-blue-700">{initials(sender)}</AvatarFallback>
                        </Avatar>
                      )}
                      <div className={`max-w-[85%] sm:max-w-[70%] ${isCarrier ? "items-end" : "items-start"}`}>
                        <div className={`mb-1 flex items-center gap-2 text-[11px] text-slate-400 ${isCarrier ? "justify-end" : ""}`}>
                          <span className="font-medium text-slate-600">{sender}</span>
                          <span>{formatMessageTime(item.createdAt)}</span>
                        </div>
                        <div className={`rounded-2xl px-4 py-2.5 text-sm shadow-sm ${isCarrier ? "rounded-br-sm bg-blue-600 text-white" : "rounded-bl-sm border border-slate-200 bg-white text-slate-700"}`}>
                          {item.message && <p className="whitespace-pre-wrap break-words">{item.message}</p>}
                          {item.attachmentUrl && (
                            <a href={item.attachmentUrl} target="_blank" rel="noreferrer" className={`mt-2 flex items-center gap-2 rounded-lg p-2 text-xs ${isCarrier ? "bg-blue-500 text-white" : "bg-slate-50 text-blue-700"}`}>
                              {attachmentIsImage ? <FileImage className="h-4 w-4 shrink-0" /> : <FileText className="h-4 w-4 shrink-0" />}
                              <span className="truncate">{item.attachmentName || "Attachment"}</span>
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <MessageCircle className="mb-3 h-10 w-10 text-blue-200" />
                <p className="font-medium text-slate-700">Start a conversation</p>
                <p className="mt-1 text-sm text-slate-400">Send a message to your TPF support team.</p>
              </div>
            )}
          </CardContent>

          <div className="border-t border-slate-200 bg-white p-3 sm:p-4">
            {!messages.length && (
              <div className="mb-3 flex flex-wrap gap-2">
                {QUICK_MESSAGES.map((quickMessage) => (
                  <button key={quickMessage} type="button" onClick={() => setDraft(quickMessage)} className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-left text-xs text-blue-700 transition-colors hover:bg-blue-100">
                    {quickMessage}
                  </button>
                ))}
              </div>
            )}
            {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
            {attachment && (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
                {attachment.type.startsWith("image/") ? <FileImage className="h-4 w-4 text-blue-500" /> : <FileText className="h-4 w-4 text-blue-500" />}
                <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                <button type="button" onClick={() => setAttachment(null)} aria-label="Remove attachment" className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitMessage();
                  }
                }}
                placeholder="Write a message..."
                rows={1}
                className="max-h-28 min-h-10 flex-1 resize-none border-0 bg-transparent shadow-none focus:ring-0"
                aria-label="Message"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) setAttachment(file);
                  event.target.value = "";
                }}
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} aria-label="Attach a PDF or image" className="h-9 w-9 shrink-0 text-slate-500 hover:text-blue-600">
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button type="button" onClick={submitMessage} disabled={sending || (!draft.trim() && !attachment)} aria-label="Send message" className="h-9 w-9 shrink-0 rounded-lg bg-blue-600 p-0 hover:bg-blue-700">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-slate-400">Enter to send · Shift + Enter for a new line</p>
          </div>
        </Card>
      </div>
    </PortalLayout>
  );
}