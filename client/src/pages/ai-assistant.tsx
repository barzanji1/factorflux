import { useState, useRef, useEffect, type KeyboardEvent, type Ref } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  AlertCircle,
  Check,
  CircleDot,
  FileText,
  Landmark,
  Loader2,
  RotateCcw,
  Send,
  Smile,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { FactorFluxLogo } from "@/components/brand/factorflux-logo";

type Activity = {
  tool: string;
  label: string;
  status: "completed" | "failed" | "pending";
  detail?: string;
};

type DataCard = {
  type: "carrier" | "invoice" | "broker";
  id: string;
  title: string;
  fields: Array<{ label: string; value: string }>;
  href?: string;
  badge?: { label: string; tone?: string };
};

type Confirmation = {
  id: string;
  tool: string;
  title: string;
  description: string;
  expiresAt: string;
};

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  activities?: Activity[];
  cards?: DataCard[];
  confirmation?: Confirmation | null;
}

type AssistantEnvelope = {
  message: string;
  activities?: Activity[];
  cards?: DataCard[];
  confirmation?: Confirmation | null;
};

const STARTERS = [
  "Hi, I'm Earl. How can I help you with FactorFlux today?",
  "How do I factor an invoice?",
  "How do I put an invoice on hold?",
  "How do I approve a carrier in the portal?",
  "How do I match a payment in Lockbox?",
];

function ActivityList({ activities }: { activities: Activity[] }) {
  if (!activities.length) return null;
  return (
    <div className="mt-3 space-y-1.5 border-t border-slate-300/70 pt-3" aria-label="Earl activity">
      {activities.map((activity, index) => {
        const StatusIcon = activity.status === "failed"
          ? AlertCircle
          : activity.status === "pending"
            ? CircleDot
            : Check;
        return (
          <div key={`${activity.tool}-${index}`} className="flex items-start gap-2 text-xs text-slate-600">
            <StatusIcon className={cn(
              "mt-0.5 h-3.5 w-3.5 flex-shrink-0",
              activity.status === "failed" ? "text-red-700" : activity.status === "pending" ? "text-amber-700" : "text-emerald-700",
            )} aria-hidden="true" />
            <span>
              <span className="font-medium text-slate-700">{activity.label}</span>
              {activity.detail && <span className="text-slate-500"> — {activity.detail}</span>}
              <span className="sr-only"> ({activity.status})</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StructuredCard({ card, cardRef }: { card: DataCard; cardRef?: Ref<HTMLElement> }) {
  const Icon = card.type === "carrier" ? Truck : card.type === "invoice" ? FileText : Landmark;
  return (
    <article
      ref={cardRef}
      data-type="structured-card"
      className="mt-3 scroll-mt-3 rounded-lg border border-slate-300 bg-[#e9e6df] p-3"
      aria-label={`${card.type} details`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 flex-shrink-0 text-slate-600" aria-hidden="true" />
          <h3 className="truncate text-xs font-bold uppercase tracking-wide text-slate-700">{card.title}</h3>
        </div>
        {card.badge && (
          <span className="flex-shrink-0 rounded border border-slate-400 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
            {card.badge.label}
          </span>
        )}
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {card.fields.map((field) => (
          <div key={`${card.id}-${field.label}`} className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{field.label}</dt>
            <dd className="break-words text-xs text-slate-800">{field.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function MessageBubble({
  msg,
  userInitials,
  onReview,
  structuredCardRef,
}: {
  msg: Message;
  userInitials: string;
  onReview: (confirmation: Confirmation) => void;
  structuredCardRef?: Ref<HTMLElement>;
}) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("mb-4 flex items-end gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
      <div className={cn(
        "ff-earl-avatar flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
        isUser ? "ff-earl-user-avatar" : "ff-earl-assistant-avatar overflow-hidden",
      )}>
        {isUser
          ? <span className="text-[10px] font-extrabold">{userInitials}</span>
          : <FactorFluxLogo showWordmark={false} markClassName="h-6 w-6" />}
      </div>
      <div className={cn(
        "ff-earl-message max-w-[75%] rounded-xl px-4 py-3 text-sm leading-relaxed",
        isUser
          ? "ff-earl-message-user whitespace-pre-wrap rounded-br-sm"
          : "ff-earl-message-assistant rounded-bl-sm",
      )}>
        <div className="whitespace-pre-wrap">{msg.content}</div>
        {!isUser && msg.activities && <ActivityList activities={msg.activities} />}
        {!isUser && msg.cards?.map((card, index) => (
          <StructuredCard
            key={card.id || `${card.type}-${index}`}
            card={card}
            cardRef={index === 0 ? structuredCardRef : undefined}
          />
        ))}
        {!isUser && msg.confirmation && (
          <div className="mt-3 border-t border-slate-300/70 pt-3">
            <p className="text-xs font-semibold text-slate-700">{msg.confirmation.title}</p>
            <p className="mt-1 text-xs text-slate-600">{msg.confirmation.description}</p>
            <Button type="button" size="sm" className="mt-3 h-8 text-xs" onClick={() => onReview(msg.confirmation!)}>
              Review action
            </Button>
          </div>
        )}
        {msg.timestamp && (
          <div className={cn("ff-earl-timestamp mt-1.5 text-[11px]", isUser ? "text-right text-white/75" : "text-slate-500")}>
            {new Date(msg.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AIAssistant() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { permissions, user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const messageThreadRef = useRef<HTMLDivElement>(null);
  const latestStructuredCardRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (permissions.length > 0 && !permissions.includes("earl")) {
      toast({ title: "Access denied", description: "You don't have permission to use Earl.", variant: "destructive" });
      setLocation("/");
    }
  }, [permissions, setLocation, toast]);

  useEffect(() => {
    const thread = messageThreadRef.current;
    if (!thread) return;
    const latestMessage = messages[messages.length - 1];
    if (latestMessage?.role === "assistant" && latestMessage.cards?.length) {
      latestStructuredCardRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "nearest",
      });
      return;
    }
    thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const appendEnvelope = (data: AssistantEnvelope) => {
    setMessages((prev) => [...prev, {
      role: "assistant",
      content: data.message,
      activities: data.activities,
      cards: data.cards,
      confirmation: data.confirmation ?? null,
      timestamp: new Date().toISOString(),
    }]);
  };

  const chatMutation = useMutation({
    mutationFn: async (msgs: Message[]) => {
      const res = await apiRequest("POST", "/api/ai/chat", {
        messages: msgs.map(({ role, content }) => ({ role, content })),
      });
      return res.json() as Promise<AssistantEnvelope>;
    },
    onSuccess: appendEnvelope,
    onError: (e: unknown) => {
      let msg = "Failed to get a response";
      try {
        const raw = e instanceof Error ? e.message : "";
        const parsed = JSON.parse(raw.replace(/^\d+:\s*/, ""));
        if (parsed?.message) msg = parsed.message;
      } catch { /* retain the concise fallback */ }
      toast({ title: msg, variant: "destructive" });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async (actionId: string) => {
      const res = await apiRequest("POST", `/api/ai/actions/${encodeURIComponent(actionId)}/confirm`);
      return res.json() as Promise<AssistantEnvelope>;
    },
    onSuccess: (data, actionId) => {
      setConfirmation(null);
      setMessages((prev) => prev.map((message) => (
        message.confirmation?.id === actionId ? { ...message, confirmation: null } : message
      )));
      appendEnvelope(data);
    },
    onError: () => toast({ title: "Action could not be completed", description: "Try again if the action is still available.", variant: "destructive" }),
  });

  function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || chatMutation.isPending || confirmMutation.isPending) return;
    const updated: Message[] = [...messages, { role: "user", content, timestamp: new Date().toISOString() }];
    setMessages(updated);
    setInput("");
    chatMutation.mutate(updated);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function reset() {
    if (chatMutation.isPending || confirmMutation.isPending) return;
    setMessages([]);
    setInput("");
  }

  const isEmpty = messages.length === 0;
  const isBusy = chatMutation.isPending || confirmMutation.isPending;
  const userInitials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`.toUpperCase() || "U";

  return (
    <div className="ff-earl-page flex h-[100dvh] overflow-hidden bg-[#d4d0c8]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Earl" />
        <div className="ff-earl-chat m-4 flex min-h-0 flex-1 flex-col overflow-hidden md:m-6">
          <div className="ff-earl-header flex flex-shrink-0 items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="ff-earl-assistant-avatar flex h-10 w-10 items-center justify-center rounded-full">
                <FactorFluxLogo showWordmark={false} markClassName="h-7 w-7" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Earl</h1>
                <p className="text-xs text-muted-foreground">AI Assistant powered by Claude</p>
              </div>
            </div>
            {!isEmpty && (
              <Button variant="outline" size="sm" onClick={reset} disabled={isBusy} className="gap-2 text-muted-foreground">
                <RotateCcw className="h-4 w-4" /> New conversation
              </Button>
            )}
          </div>

          <div ref={messageThreadRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {isEmpty ? (
              <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-8 text-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="ff-earl-assistant-avatar flex h-16 w-16 items-center justify-center rounded-full">
                    <FactorFluxLogo showWordmark={false} markClassName="h-10 w-10" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">Hi, I'm Earl!</h2>
                    <p className="mt-1 text-sm text-muted-foreground">I know FactorFlux inside and out — ask me anything about workflows, features, or troubleshooting.</p>
                  </div>
                </div>
                <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                  {STARTERS.map((q) => (
                    <button key={q} onClick={() => send(q)} disabled={isBusy} className="ff-earl-starter px-4 py-3 text-left text-sm transition-colors">{q}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-2xl">
                {messages.map((msg, i) => (
                  <MessageBubble
                    key={i}
                    msg={msg}
                    userInitials={userInitials}
                    onReview={setConfirmation}
                    structuredCardRef={i === messages.length - 1 ? latestStructuredCardRef : undefined}
                  />
                ))}
                {chatMutation.isPending && (
                  <div className="mb-4 flex items-end gap-2">
                    <div className="ff-earl-avatar ff-earl-assistant-avatar flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full">
                      <FactorFluxLogo showWordmark={false} markClassName="h-6 w-6" />
                    </div>
                    <div className="ff-earl-message ff-earl-message-assistant rounded-xl rounded-bl-sm px-4 py-3">
                      <div className="flex items-center gap-1" aria-label="Earl is thinking">
                        <span className="ff-earl-typing-dot" style={{ animationDelay: "0ms" }} />
                        <span className="ff-earl-typing-dot" style={{ animationDelay: "150ms" }} />
                        <span className="ff-earl-typing-dot" style={{ animationDelay: "300ms" }} />
                        <span className="ml-2 text-xs text-slate-500">Earl is thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex-shrink-0 border-t border-border bg-[#d4d0c8] px-6 py-4">
            <div className="mx-auto flex max-w-2xl items-end gap-2">
              <Textarea ref={textareaRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="Ask anything about FactorFlux… (Enter to send, Shift+Enter for new line)" className="ff-earl-input min-h-[44px] max-h-[160px] resize-none text-sm" rows={1} disabled={isBusy} />
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Choose emoji"
                  className="ff-earl-icon-button h-11 w-11"
                  onClick={() => setEmojiOpen((open) => !open)}
                  disabled={isBusy}
                >
                  <Smile className="h-4 w-4" />
                </Button>
                {emojiOpen && (
                  <div className="ff-earl-emoji-picker absolute bottom-[calc(100%+8px)] right-0 z-20 grid grid-cols-5 gap-1 p-2">
                    {["👍", "✅", "🙂", "🎉", "🚚", "💵", "📄", "⚠️", "🙏", "👋"].map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="ff-earl-emoji-option"
                        onClick={() => {
                          setInput((value) => value + emoji);
                          setEmojiOpen(false);
                          textareaRef.current?.focus();
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button onClick={() => send()} disabled={!input.trim() || isBusy} size="icon" className="h-11 w-11 flex-shrink-0" aria-label="Send message">
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="mx-auto mt-2 max-w-2xl text-center text-[11px] text-muted-foreground">AI responses are for guidance only. Always verify critical information.</p>
          </div>
        </div>
      </div>

      <AlertDialog open={Boolean(confirmation)} onOpenChange={(open) => !open && !confirmMutation.isPending && setConfirmation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title ?? "Confirm action"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.description}
              {confirmation?.expiresAt && <span className="mt-2 block text-xs">This confirmation expires {new Date(confirmation.expiresAt).toLocaleString()}.</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmMutation.isPending || !confirmation}
              onClick={(event) => {
                event.preventDefault();
                if (confirmation && !confirmMutation.isPending) confirmMutation.mutate(confirmation.id);
              }}
            >
              {confirmMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}