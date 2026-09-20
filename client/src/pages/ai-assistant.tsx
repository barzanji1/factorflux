import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Send, Sparkles, RotateCcw, Smile } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { FactorFluxLogo } from "@/components/brand/factorflux-logo";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

const STARTERS = [
  "Hi, I'm Earl. How can I help you with FactorFlux today?",
  "How do I factor an invoice?",
  "How do I put an invoice on hold?",
  "How do I approve a carrier in the portal?",
  "How do I match a payment in Lockbox?",
];

function MessageBubble({ msg, userInitials }: { msg: Message; userInitials: string }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex items-end gap-2 mb-4", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div className={cn(
        "ff-earl-avatar flex-shrink-0 flex items-center justify-center rounded-full w-8 h-8",
        isUser ? "ff-earl-user-avatar" : "ff-earl-assistant-avatar overflow-hidden"
      )}>
        {isUser
          ? <span className="text-[10px] font-extrabold">{userInitials}</span>
          : <FactorFluxLogo showWordmark={false} markClassName="h-6 w-6" />
        }
      </div>

      {/* Bubble */}
      <div className={cn(
        "ff-earl-message max-w-[75%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
        isUser
          ? "ff-earl-message-user rounded-br-sm"
          : "ff-earl-message-assistant rounded-bl-sm"
      )}>
        {msg.content}
        {msg.timestamp && (
          <div className={cn("ff-earl-timestamp mt-1.5", isUser ? "text-right text-white/75" : "text-slate-500")}>
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Permission guard — redirect to dashboard if user lacks "earl" access
  useEffect(() => {
    if (permissions.length > 0 && !permissions.includes("earl")) {
      toast({ title: "Access denied", description: "You don't have permission to use Earl.", variant: "destructive" });
      setLocation("/");
    }
  }, [permissions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const chatMutation = useMutation({
    mutationFn: async (msgs: Message[]) => {
      const res = await apiRequest("POST", "/api/ai/chat", {
        messages: msgs.map(({ role, content }) => ({ role, content })),
      });
      return res.json() as Promise<{ message: string }>;
    },
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.message, timestamp: new Date().toISOString() }]);
    },
    onError: (e: any) => {
      let msg = "Failed to get a response";
      try {
        const raw = e?.message ?? "";
        const jsonPart = raw.replace(/^\d+:\s*/, "");
        const parsed = JSON.parse(jsonPart);
        if (parsed?.message) msg = parsed.message;
      } catch {}
      toast({ title: msg, variant: "destructive" });
    },
  });

  function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || chatMutation.isPending) return;
    const updated: Message[] = [...messages, { role: "user", content, timestamp: new Date().toISOString() }];
    setMessages(updated);
    setInput("");
    chatMutation.mutate(updated);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function reset() {
    setMessages([]);
    setInput("");
  }

  const isEmpty = messages.length === 0;
  const userInitials = `${user?.firstName?.[0] ?? ""}${user?.lastName?.[0] ?? ""}`.toUpperCase() || "U";

  return (
    <div className="ff-earl-page flex h-screen overflow-hidden bg-[#d4d0c8]">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopNav />
        <div className="ff-earl-chat m-4 flex flex-col flex-1 overflow-hidden md:m-6">

          {/* Header */}
          <div className="ff-earl-header flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
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
              <Button variant="outline" size="sm" onClick={reset} className="gap-2 text-muted-foreground">
                <RotateCcw className="h-4 w-4" /> New conversation
              </Button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {isEmpty ? (
              <div className="flex flex-col items-center justify-center h-full gap-8 max-w-xl mx-auto text-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="ff-earl-assistant-avatar flex h-16 w-16 items-center justify-center rounded-full">
                    <FactorFluxLogo showWordmark={false} markClassName="h-10 w-10" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">Hi, I'm Earl!</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      I know FactorFlux inside and out — ask me anything about workflows, features, or troubleshooting.
                    </p>
                  </div>
                </div>

                {/* Starter chips */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                  {STARTERS.map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                       className="ff-earl-starter text-left px-4 py-3 text-sm transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="max-w-2xl mx-auto">
                {messages.map((msg, i) => (
                   <MessageBubble key={i} msg={msg} userInitials={userInitials} />
                ))}
                {chatMutation.isPending && (
                  <div className="flex items-end gap-2 mb-4">
                     <div className="ff-earl-avatar ff-earl-assistant-avatar flex-shrink-0 flex items-center justify-center rounded-full w-8 h-8 overflow-hidden">
                      <FactorFluxLogo showWordmark={false} markClassName="h-6 w-6" />
                    </div>
                     <div className="ff-earl-message ff-earl-message-assistant rounded-xl rounded-bl-sm px-4 py-3">
                      <div className="flex gap-1 items-center h-4">
                         <span className="ff-earl-typing-dot" style={{ animationDelay: "0ms" }} />
                         <span className="ff-earl-typing-dot" style={{ animationDelay: "150ms" }} />
                         <span className="ff-earl-typing-dot" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input */}
           <div className="flex-shrink-0 border-t border-border bg-[#d4d0c8] px-6 py-4">
             <div className="max-w-2xl mx-auto flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about FactorFlux… (Enter to send, Shift+Enter for new line)"
                 className="ff-earl-input resize-none min-h-[44px] max-h-[160px] text-sm"
                rows={1}
                disabled={chatMutation.isPending}
              />
               <div className="relative">
                 <Button
                   type="button"
                   variant="outline"
                   size="icon"
                   aria-label="Choose emoji"
                   className="ff-earl-icon-button h-11 w-11"
                   onClick={() => setEmojiOpen(open => !open)}
                 >
                   <Smile className="h-4 w-4" />
                 </Button>
                 {emojiOpen && (
                   <div className="ff-earl-emoji-picker absolute bottom-[calc(100%+8px)] right-0 z-20 grid grid-cols-5 gap-1 p-2">
                     {["👍", "✅", "🙂", "🎉", "🚚", "💵", "📄", "⚠️", "🙏", "👋"].map(emoji => (
                       <button
                         key={emoji}
                         type="button"
                         className="ff-earl-emoji-option"
                         onClick={() => { setInput(value => value + emoji); setEmojiOpen(false); textareaRef.current?.focus(); }}
                       >
                         {emoji}
                       </button>
                     ))}
                   </div>
                 )}
               </div>
               <Button
                onClick={() => send()}
                disabled={!input.trim() || chatMutation.isPending}
                size="icon"
                 className="flex-shrink-0 h-11 w-11"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-center text-[11px] text-muted-foreground mt-2 max-w-2xl mx-auto">
              AI responses are for guidance only. Always verify critical information.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
