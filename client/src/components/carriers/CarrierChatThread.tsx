import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Image as ImageIcon, Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ChatAvatar } from "@/components/team-chat/ChatAvatar";
import { NeuButton } from "@/styles/neu/components";

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

const carrierMessagesKey = (carrierId: string | number | null | undefined) =>
  ["carrier-messages", Number(carrierId)] as const;

function normalizeMessage(message: any): ChatMessage {
  return {
    ...message,
    message: message.message || "",
    attachmentName: message.attachmentName || message.attachment?.name || null,
    attachmentUrl: message.attachmentUrl || message.attachment?.viewUrl || null,
  };
}

function sortMessages(messages: ChatMessage[]) {
  return [...messages].sort((a, b) => {
    const timeDifference = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (timeDifference !== 0) return timeDifference;
    return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  });
}

type CarrierChatError = Error & { status?: number };

export interface CarrierChatThreadProps {
  carrierId: string | number;
  carrierName?: string | null;
  mcNumber?: string | null;
  className?: string;
  neu?: boolean;
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
  neu = false,
}: CarrierChatThreadProps) {
  const queryClient = useQueryClient();
  const numericCarrierId = Number(carrierId);
  const queryKey = carrierMessagesKey(numericCarrierId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);

  const threadQuery = useQuery<ChatMessage[]>({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/carrier-chat/${numericCarrierId}`, {
        credentials: "include",
        signal,
      });
      if (!response.ok) throw await getChatError(response, "Unable to load this conversation");
      const result = await response.json() as ChatThread;
      return sortMessages((Array.isArray(result.messages) ? result.messages : []).map(normalizeMessage));
    },
    refetchInterval: (query) => {
      const error = query.state.error as CarrierChatError | null;
      if (error?.status === 404) return false;
      return queryClient.isMutating({
        mutationKey: ["send-carrier-message", numericCarrierId],
      }) ? false : 5000;
    },
    staleTime: 4000,
    retry: false,
    enabled: !!numericCarrierId,
    refetchOnMount: false,
    refetchOnReconnect: (query) => (query.state.error as CarrierChatError | null)?.status !== 404,
  });
  const messages = threadQuery.data || [];
  const name = carrierName || "Carrier";
  const mc = mcNumber;

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
    mutationKey: ["send-carrier-message", numericCarrierId],
    mutationFn: async ({ text, file }: { text: string; file: File | null; tempId: string; createdAt: string }) => {
      const form = new FormData();
      form.append("message", text);
      if (file) form.append("attachment", file);
      const response = await fetch(`/api/carrier-chat/${numericCarrierId}/messages`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!response.ok) throw await getChatError(response, "Unable to send message");
      return normalizeMessage(await response.json());
    },
    onMutate: async ({ text, file, tempId, createdAt }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ChatMessage[]>(queryKey) || [];
      queryClient.setQueryData<ChatMessage[]>(queryKey, sortMessages([
        ...previous,
        {
          id: tempId,
          senderType: "agent",
          senderName: "TPF Agent",
          message: text,
          attachmentName: file?.name || null,
          attachmentUrl: null,
          createdAt,
        },
      ]));
      return { previous, tempId };
    },
    onSuccess: (created, _variables, context) => {
      queryClient.setQueryData<ChatMessage[]>(queryKey, (current = []) =>
        sortMessages(current.map((message) => message.id === context?.tempId ? created : message)));
      setDraft("");
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const submitMessage = () => {
    const text = draft.trim();
    if ((!text && !attachment) || sendMessage.isPending) return;
    sendMessage.mutate({
      text,
      file: attachment,
      tempId: `temp-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
    });
  };

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
      <div className={cn("flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm", neu ? "text-[#777]" : "", className)}>
        <p className={error.status === 404 ? "text-slate-500" : "text-red-600"}>
          {error.status === 404 ? "Carrier has no portal account" : error.message}
        </p>
      </div>
    );
  }

  return (
    <section className={cn("flex min-h-0 flex-1 flex-col", neu ? "bg-[#e0e0e0] text-[#333]" : "bg-white dark:bg-slate-900", className)}>
      <header className={cn("shrink-0 px-5 py-4", neu ? "border-b border-[#c9c9c9]" : "border-b border-slate-200 dark:border-slate-700")}>
        <div className="flex min-w-0 items-center gap-3">
          {neu && <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#d5e8e8] text-sm font-semibold text-[#267b82]">{name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</div>}
          <div className="min-w-0">
            <h2 className={cn("truncate font-semibold", neu ? "text-[#333]" : "text-slate-900 dark:text-white")}>{name}</h2>
            <p className="text-xs text-slate-500">{mc ? `MC ${mc}` : "Carrier conversation"}</p>
          </div>
        </div>
      </header>
      <div className={cn("min-h-0 flex-1 space-y-3 overflow-y-auto p-5", neu ? "bg-[#e0e0e0]" : "bg-slate-50/70 dark:bg-slate-950/30")}>
        {threadQuery.isLoading && <p className="text-center text-sm text-slate-500">Loading messages…</p>}
        {!threadQuery.isLoading && messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Start a conversation with this carrier.</div>
        )}
        {messages.map((message) => {
          const agent = isAgentMessage(message);
          return (
            <div key={message.id} className={cn("flex", neu && "gap-2", agent ? "justify-end" : "justify-start")}>
              {neu && <ChatAvatar name={message.senderName} className={cn("h-7 w-7 shrink-0 text-[10px]", agent && "order-2")} />}
              <div className={cn("max-w-[min(75%,38rem)] px-1 py-2", neu
                ? agent ? "rounded-xl bg-[#27aab8]/[0.06] text-[#333]" : "text-[#444]"
                : cn("rounded-2xl px-4 py-3 shadow-sm", agent ? "rounded-br-sm bg-[#098b9f] text-white" : "rounded-bl-sm bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100"))}>
                <p className={cn("mb-1 text-[11px] font-semibold", neu ? "text-[#444]" : agent ? "text-cyan-50" : "text-slate-500")}>{message.senderName}</p>
                {message.message && <p className="whitespace-pre-wrap break-words text-sm">{message.message}</p>}
                {message.attachmentUrl && (
                  <a href={message.attachmentUrl} target="_blank" rel="noreferrer" className={cn("mt-2 flex items-center gap-2 break-all text-xs underline", neu ? "text-[#087d8d]" : agent ? "text-white" : "text-[#087d8d]")}>
                    {message.attachmentName?.match(/\.(png|jpe?g)$/i) ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                    {message.attachmentName || "View attachment"}
                  </a>
                )}
                <p className={cn("mt-1 text-right text-[10px]", neu ? "text-[#888]" : agent ? "text-cyan-100" : "text-slate-400")}>{formatTime(message.createdAt)}</p>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
      <div className={cn("shrink-0 border-t p-4", neu ? "border-[#c9c9c9] bg-[#e0e0e0]" : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900")}>
        <div className="mb-3 flex flex-wrap gap-2">
          {QUICK_REPLIES.map((reply) => (
            neu
              ? <NeuButton key={reply} type="button" onClick={() => setDraft(reply)} className="min-h-8 rounded-lg px-2 py-1 text-xs">{reply}</NeuButton>
              : <Button key={reply} type="button" variant="outline" size="sm" onClick={() => setDraft(reply)} className="h-7 text-xs">{reply}</Button>
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
                submitMessage();
              }
            }}
            placeholder="Write a message…"
            rows={2}
            className={cn("min-h-0 resize-none", neu && "[&&]:!rounded-xl [&&]:!border-0 [&&]:!bg-[#e0e0e0] [&&]:!text-[#333] [&&]:!shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff]")}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(event) => chooseAttachment(event.target.files?.[0])}
          />
          {neu ? <NeuButton type="button" title="Attach PDF, JPEG, or PNG" aria-label="Attach PDF, JPEG, or PNG" className="min-h-10 h-10 w-10 p-0" onClick={() => fileInputRef.current?.click()}>
            <Paperclip className="h-4 w-4" />
          </NeuButton> : <Button type="button" variant="outline" size="icon" title="Attach PDF, JPEG, or PNG" onClick={() => fileInputRef.current?.click()}>
            <Paperclip className="h-4 w-4" />
          </Button>}
          {neu ? <NeuButton type="button" variant="accent" disabled={sendMessage.isPending || (!draft.trim() && !attachment)} onClick={submitMessage} title="Send message" className="min-h-10 h-10 w-10 p-0">
            <Send className="h-4 w-4" />
          </NeuButton> : <Button type="button" size="icon" disabled={sendMessage.isPending || (!draft.trim() && !attachment)} onClick={submitMessage} title="Send message">
            <Send className="h-4 w-4" />
          </Button>}
        </div>
        {sendMessage.isError && <p className="mt-2 text-xs text-red-600">{(sendMessage.error as Error).message}</p>}
      </div>
    </section>
  );
}