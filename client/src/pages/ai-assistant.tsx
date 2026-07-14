import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Send, Sparkles, Bot, User, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import factorFluxLogo from "@assets/FactorFlux_icon_1774282476113.png";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const STARTERS = [
  "Hi, I'm Earl. How can I help you with FactorFlux today?",
  "How do I factor an invoice?",
  "How do I put an invoice on hold?",
  "How do I approve a carrier in the portal?",
  "How do I match a payment in Lockbox?",
];

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex items-end gap-2 mb-4", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div className={cn(
        "flex-shrink-0 flex items-center justify-center rounded-full w-8 h-8",
        isUser ? "bg-primary text-primary-foreground" : "bg-background border border-border overflow-hidden"
      )}>
        {isUser
          ? <User className="h-4 w-4" />
          : <img src={factorFluxLogo} alt="Earl" className="w-6 h-6 object-contain" />
        }
      </div>

      {/* Bubble */}
      <div className={cn(
        "max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
        isUser
          ? "bg-primary text-primary-foreground rounded-br-sm"
          : "bg-muted text-foreground rounded-bl-sm"
      )}>
        {msg.content}
      </div>
    </div>
  );
}

export default function AIAssistant() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { permissions } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
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
      const res = await apiRequest("POST", "/api/ai/chat", { messages: msgs });
      return res.json() as Promise<{ message: string }>;
    },
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.message }]);
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
    const updated: Message[] = [...messages, { role: "user", content }];
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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopNav />
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Earl</h1>
                <p className="text-xs text-muted-foreground">Powered by Claude · FactorFlux knowledge base</p>
              </div>
            </div>
            {!isEmpty && (
              <Button variant="ghost" size="sm" onClick={reset} className="gap-2 text-muted-foreground">
                <RotateCcw className="h-4 w-4" /> New conversation
              </Button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {isEmpty ? (
              <div className="flex flex-col items-center justify-center h-full gap-8 max-w-xl mx-auto text-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <img src={factorFluxLogo} alt="Earl" className="w-10 h-10 object-contain" />
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
                      className="text-left rounded-xl border border-border bg-card hover:bg-accent/50 px-4 py-3 text-sm text-foreground transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="max-w-2xl mx-auto">
                {messages.map((msg, i) => (
                  <MessageBubble key={i} msg={msg} />
                ))}
                {chatMutation.isPending && (
                  <div className="flex items-end gap-2 mb-4">
                    <div className="flex-shrink-0 flex items-center justify-center rounded-full w-8 h-8 bg-background border border-border overflow-hidden">
                      <img src={factorFluxLogo} alt="Earl" className="w-6 h-6 object-contain" />
                    </div>
                    <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
                      <div className="flex gap-1 items-center h-4">
                        <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 rounded-full bg-muted-foreground/50 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex-shrink-0 border-t border-border bg-background px-6 py-4">
            <div className="max-w-2xl mx-auto flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about FactorFlux… (Enter to send, Shift+Enter for new line)"
                className="resize-none min-h-[44px] max-h-[160px] text-sm"
                rows={1}
                disabled={chatMutation.isPending}
              />
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
