import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Image as ImageIcon, Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: string | number;
  senderType: string;
  senderName: string;
  message: string;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  createdAt: string;
};

type ChatThread = {
  chat?: {
    carrierName?: string | null;
    mcNumber?: string | null;
  };
  messages: ChatMessage[];
};

type CarrierChatError = Error & { status?: number };

export interface CarrierChatThreadProps {
  carrierId: string | number;
  carrierName?: string | null;
  mcNumber?: string | null;
  className?: string;
}

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

async function getChatError(response: Response, fallback: string): Promise<CarrierChatError> {
  const body = await response.json().catch(() => ({}));
  const error = new Error(
    response.status === 404
      ? "Carrier has no portal account"
      : body.message || body.error || fallback,
  ) as CarrierChatError;
  error.status = response.status;
  return error;
}

export default function CarrierChatThread({
  carrierId,
  carrierName,
  mcNumber,
  className,
}: CarrierChatThreadProps) {
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);

  const threadQuery = useQuery<ChatThread>({
    queryKey: ["/api/carrier-chat/thread", carrierId],
    queryFn: async () => {
      const response = await fetch(`/api/carrier-chat/${carrierId}`, { credentials: "include" });
      if (!response.ok) throw await getChatError(response, "Unable to load this conversation");
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
    refetchInterval: 5000,
    retry: false,
  });
  const messages = threadQuery.data?.messages || [];
  const name = threadQuery.data?.chat?.carrierName || carrierName || "Carrier";
  const mc = threadQuery.data?.chat?.mcNumber || mcNumber;

  // The thread GET marks carrier messages read. Keep every unread/list surface synchronized.
  useEffect(() => {
    if (!threadQuery.data) return;
    queryClient.invalidateQueries({ queryKey: ["/api/carrier-chat"] });
    queryClient.invalidateQueries({ queryKey: ["/api/carrier-chat/unread-count"] });
  }, [threadQuery.data, queryClient]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, carrierId]);

  const sendMessage = useMutation({
    mutationFn: async () => {
      if (!draft.trim() && !attachment) throw new Error("Enter a message or choose an attachment");
      const form = new FormData();
      form.append("message", draft.trim());
      if (attachment) form.append("attachment", attachment);
      const response = await fetch(`/api/carrier-chat/${carrierId}/messages`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!response.ok) throw await getChatError(response, "Unable to send message");
      return response.json();
    },
    onSuccess: () => {
      setDraft("");
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-chat/thread", carrierId] });
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-chat"] });
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-chat/unread-count"] });
    },
  });

  const chooseAttachment = (file?: File) => {
    if (!file) return;
    const valid = ["application/pdf", "image/jpeg", "image/png"].includes(file.type)
      || /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (valid) {
      setAttachment(file);
    } else if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  if (threadQuery.isError) {
    const error = threadQuery.error as CarrierChatError;
    return (
      <div className={cn("flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm", className)}>
        <p className={error.status === 404 ? "text-slate-500" : "text-red-600"}>
          {error.status === 404 ? "Carrier has no portal account" : error.message}
        </p>
      </div>
    );
  }

  return (
    <section className={cn("flex min-h-0 flex-1 flex-col bg-white dark:bg-slate-900", className)}>
      <header className="shrink-0 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <h2 className="truncate font-semibold text-slate-900 dark:text-white">{name}</h2>
        <p className="text-xs text-slate-500">{mc ? `MC ${mc}` : "Carrier conversation"}</p>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-5 dark:bg-slate-950/30">
        {threadQuery.isLoading && <p className="text-center text-sm text-slate-500">Loading messages…</p>}
        {!threadQuery.isLoading && messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Start a conversation with this carrier.</div>
        )}
        {messages.map((message) => {
          const agent = isAgentMessage(message);
          return (
            <div key={message.id} className={cn("flex", agent ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[min(75%,38rem)] rounded-2xl px-4 py-3 shadow-sm", agent ? "rounded-br-sm bg-[#098b9f] text-white" : "rounded-bl-sm bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100")}>
                <p className={cn("mb-1 text-[11px] font-semibold", agent ? "text-cyan-50" : "text-slate-500")}>{message.senderName}</p>
                {message.message && <p className="whitespace-pre-wrap text-sm">{message.message}</p>}
                {message.attachmentUrl && (
                  <a href={message.attachmentUrl} target="_blank" rel="noreferrer" className={cn("mt-2 flex items-center gap-2 text-xs underline", agent ? "text-white" : "text-[#087d8d]")}>
                    {message.attachmentName?.match(/\.(png|jpe?g)$/i) ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
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
      <div className="shrink-0 border-t border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap gap-2">
          {QUICK_REPLIES.map((reply) => (
            <Button key={reply} type="button" variant="outline" size="sm" onClick={() => setDraft(reply)} className="h-7 text-xs">{reply}</Button>
          ))}
        </div>
        {attachment && (
          <p className="mb-2 flex items-center gap-1 text-xs text-slate-500">
            <Paperclip className="h-3.5 w-3.5" />{attachment.name}
            <button type="button" className="ml-1 underline" onClick={() => { setAttachment(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>Remove</button>
          </p>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!sendMessage.isPending) sendMessage.mutate();
              }
            }}
            placeholder="Write a message…"
            rows={2}
            className="min-h-0 resize-none"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(event) => chooseAttachment(event.target.files?.[0])}
          />
          <Button type="button" variant="outline" size="icon" title="Attach PDF, JPEG, or PNG" onClick={() => fileInputRef.current?.click()}>
            <Paperclip className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" disabled={sendMessage.isPending || (!draft.trim() && !attachment)} onClick={() => sendMessage.mutate()} title="Send message">
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {sendMessage.isError && <p className="mt-2 text-xs text-red-600">{(sendMessage.error as Error).message}</p>}
      </div>
    </section>
  );
}