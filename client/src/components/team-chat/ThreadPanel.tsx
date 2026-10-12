import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, CornerDownRight, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";
import { MentionAutocomplete, type ChatUser } from "./MentionAutocomplete";
import { MessageBody, type MessageMention } from "./MessageBody";
import { ChatAvatar } from "./ChatAvatar";

export type ChatMessage = {
  id: string | number;
  channelId: string | number;
  senderId: string | number;
  senderName: string;
  senderProfileImageUrl?: string | null;
  body: string;
  createdAt: string;
  parentMessageId: number | null;
  mentions: MessageMention[];
  replyCount: number;
};

async function getThreadPage(channelId: string | number, messageId: string | number, afterId: number) {
  const response = await fetch(`/api/chat/channels/${channelId}/threads/${messageId}?afterId=${afterId}`, { credentials: "include" });
  if (!response.ok) throw new Error(`${response.status}: Unable to load thread`);
  return response.json() as Promise<{ parent: ChatMessage; replies: ChatMessage[]; hasMore: boolean; nextCursor: number }>;
}

async function postReply(channelId: string | number, body: string, parentMessageId: number) {
  const response = await fetch(`/api/chat/channels/${channelId}/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, parentMessageId }),
  });
  if (!response.ok) {
    let message = "";
    try { message = (await response.json()).message || ""; } catch { /* status fallback */ }
    throw new Error(message || `${response.status}: Reply could not be sent`);
  }
}

const timeLabel = (date: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(date));

export function ThreadPanel({
  channelId, rootId, currentUserId, active, onClose, onChanged, highlightedMessageId,
}: {
  channelId: string | number;
  rootId: string | number;
  currentUserId?: string | number;
  active: boolean;
  onClose: () => void;
  onChanged: () => void;
  highlightedMessageId?: string | null;
}) {
  const [parent, setParent] = useState<ChatMessage | null>(null);
  const [replies, setReplies] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [requestVersion, setRequestVersion] = useState(0);
  const [userDirectory, setUserDirectory] = useState<ChatUser[]>([]);
  const requestRef = useRef(0);
  const directoryRequestRef = useRef(0);
  const threadLoadInFlightRef = useRef(false);
  const hasLoadedThreadRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const repliesCursorRef = useRef(0);
  const readCursorRef = useRef(0);
  const repliesRef = useRef<ChatMessage[]>([]);

  const refreshUserDirectory = useCallback(async () => {
    const requestId = ++directoryRequestRef.current;
    try {
      const response = await fetch(`/api/chat/users?channelId=${encodeURIComponent(String(channelId))}`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load mention directory");
      const directory = await response.json() as ChatUser[];
      if (requestId === directoryRequestRef.current) setUserDirectory(directory);
    } catch {
      if (requestId === directoryRequestRef.current) setUserDirectory([]);
    }
  }, [channelId]);

  useEffect(() => {
    setUserDirectory([]);
    directoryRequestRef.current += 1;
    void refreshUserDirectory();
    return () => { directoryRequestRef.current += 1; };
  }, [channelId, refreshUserDirectory]);

  const loadThread = useCallback(async () => {
    if (!active || threadLoadInFlightRef.current) return;
    threadLoadInFlightRef.current = true;
    const requestId = ++requestRef.current;
    if (!hasLoadedThreadRef.current) setLoading(true);
    setError("");
    try {
      let afterId = repliesCursorRef.current;
      let allReplies: ChatMessage[] = [...repliesRef.current];
      let first: { parent: ChatMessage; replies: ChatMessage[]; hasMore: boolean; nextCursor: number } | null = null;
      let hasMore = true;
      while (hasMore) {
        const page = await getThreadPage(channelId, rootId, afterId);
        if (requestId !== requestRef.current) return;
        if (!first) first = page;
        const alreadyLoaded = new Set(allReplies.map((reply) => String(reply.id)));
        allReplies = [...allReplies, ...page.replies.filter((reply) => !alreadyLoaded.has(String(reply.id)))];
        const next = Number(page.nextCursor) || page.replies.reduce((max, reply) => Math.max(max, Number(reply.id) || 0), afterId);
        hasMore = page.hasMore && next > afterId;
        if (hasMore) afterId = next;
      }
      if (requestId !== requestRef.current || !first) return;
      setParent(first.parent);
      repliesCursorRef.current = allReplies.reduce((max, reply) => Math.max(max, Number(reply.id) || 0), repliesCursorRef.current);
      repliesRef.current = allReplies;
      hasLoadedThreadRef.current = true;
      setReplies(allReplies);
      const newestReplyId = repliesCursorRef.current;
      if (
        newestReplyId > readCursorRef.current &&
        active &&
        document.visibilityState === "visible" &&
        document.hasFocus()
      ) {
        try {
          const response = await fetch(`/api/chat/channels/${channelId}/read`, {
            method: "PATCH",
            credentials: "include",
          });
          if (response.ok && requestId === requestRef.current) {
            readCursorRef.current = newestReplyId;
            queryClient.invalidateQueries({ queryKey: ["/api/chat/unread-count"] });
            queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
          }
        } catch {
          // The next successful thread poll retries the read watermark update.
        }
      }
    } catch (loadError) {
      if (requestId === requestRef.current) setError(loadError instanceof Error ? loadError.message : "Unable to load thread");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
      threadLoadInFlightRef.current = false;
    }
  }, [active, channelId, rootId, requestVersion]);

  useEffect(() => {
    setParent(null);
    setReplies([]);
    setDraft("");
    repliesRef.current = [];
    repliesCursorRef.current = 0;
    readCursorRef.current = 0;
    hasLoadedThreadRef.current = false;
  }, [channelId, rootId]);

  useEffect(() => {
    if (!active) return;
    void loadThread();
    const timer = window.setInterval(() => { void loadThread(); }, 3000);
    return () => {
      requestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [active, loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [replies.length]);
  useEffect(() => {
    if (!highlightedMessageId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`chat-message-${highlightedMessageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [highlightedMessageId, replies]);

  const submitReply = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      await postReply(channelId, body, Number(rootId));
      setDraft("");
      setRequestVersion((version) => version + 1);
      onChanged();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Reply could not be sent");
    } finally {
      setSending(false);
    }
  };

  return (
    <aside className="ff-chat-thread-panel absolute inset-0 z-20 flex min-h-0 min-w-0 flex-col border-l-2 border-[#808080] bg-[#f5f4ef] md:static md:inset-auto md:z-auto md:w-[340px] md:max-w-[42%] md:shrink-0" aria-label="Message thread" data-testid="chat-thread-panel">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[#a4a29b] bg-[#d4d0c8] px-2">
        <button type="button" onClick={onClose} aria-label="Close thread" className="flex h-6 w-6 items-center justify-center hover:bg-[#bcbab3]"><ArrowLeft className="h-4 w-4" /></button>
        <span className="min-w-0 flex-1 truncate text-xs font-bold">Thread</span>
        <button type="button" onClick={onClose} aria-label="Close thread" className="flex h-6 w-6 items-center justify-center hover:bg-[#bcbab3]"><X className="h-3.5 w-3.5" /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && !parent ? <div className="space-y-3" aria-label="Loading thread">{[0, 1, 2].map((item) => <div key={item} className="h-12 animate-pulse bg-[#dfded8]" />)}</div>
          : error && !parent ? <div role="alert" className="p-3 text-xs text-[#8b3030]"><AlertCircle className="mb-2 h-4 w-4" />{error}<Button onClick={() => setRequestVersion((version) => version + 1)} variant="outline" className="mt-2 h-7 rounded-sm text-xs">Retry</Button></div>
            : parent && <>
              <div className="mb-3 flex gap-1.5 border-b border-[#c9c7c0] pb-3" data-testid="chat-thread-parent">
                <ChatAvatar name={parent.senderName} profileImageUrl={parent.senderProfileImageUrl} />
                <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-baseline gap-1 text-[10px] text-[#777]"><strong className="text-[#444]">{parent.senderName}</strong><span>{timeLabel(parent.createdAt)}</span>{parent.mentions?.some((mention) => String(mention.userId) === String(currentUserId)) && <span className="rounded-sm border border-[#c99732] bg-[#fff0b8] px-1 font-bold text-[#684c08]">Mentioned you</span>}<span className="ml-auto text-[#17626a]">Original message</span></div>
                <div className="ff-team-chat-message ff-team-chat-message-other inline-block whitespace-pre-wrap break-words px-2 py-1 leading-snug text-xs"><MessageBody body={parent.body} mentions={parent.mentions} channelId={channelId} rootMessageId={rootId} /></div>
                </div>
              </div>
              {replies.map((reply) => (
                <article key={reply.id} id={`chat-message-${reply.id}`} data-testid="chat-thread-reply" className={cn("mb-3 flex gap-1.5", String(reply.id) === String(highlightedMessageId) && "rounded-sm bg-[#fff0b8] p-1")}>
                  <CornerDownRight className="mt-1 h-3 w-3 shrink-0 text-[#85837d]" />
                  <ChatAvatar name={reply.senderName} profileImageUrl={reply.senderProfileImageUrl} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex flex-wrap items-baseline gap-1 text-[10px] text-[#777]"><strong className="text-[#444]">{reply.senderName}</strong><span>{timeLabel(reply.createdAt)}</span>{reply.mentions?.some((mention) => String(mention.userId) === String(currentUserId)) && <span className="rounded-sm border border-[#c99732] bg-[#fff0b8] px-1 font-bold text-[#684c08]">Mentioned you</span>}</div>
                    <div className="whitespace-pre-wrap break-words text-xs leading-snug"><MessageBody body={reply.body} mentions={reply.mentions} channelId={channelId} rootMessageId={rootId} /></div>
                  </div>
                </article>
              ))}
              {!replies.length && !loading && <p className="py-2 text-center text-[11px] text-[#777]">No replies yet. Keep the discussion together here.</p>}
              {loading && <p className="py-2 text-center text-[10px] text-[#777]">Refreshing thread…</p>}
              <div ref={bottomRef} />
            </>}
      </div>
      {error && parent && <div role="alert" className="mx-2 mb-1 flex items-center gap-1 text-[10px] text-[#8b3030]"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{error}</div>}
      <div className="border-t border-[#808080] bg-[#d4d0c8] p-1.5">
        <div className="flex items-end gap-1">
          <MentionAutocomplete
            value={draft}
            onChange={setDraft}
            users={userDirectory}
            placeholder="Reply in thread…"
            onSubmit={submitReply}
            disabled={sending}
            onDirectoryRefresh={() => { void refreshUserDirectory(); }}
            data-testid="chat-thread-composer"
            className="ff-team-chat-input h-8 min-h-8 flex-1 resize-none overflow-hidden px-1.5 py-1 text-[11px] outline-none"
          />
          <Button onClick={submitReply} disabled={!draft.trim() || sending} aria-label="Send reply" data-testid="chat-send-reply" className="h-8 w-8 shrink-0 p-0"><Send className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    </aside>
  );
}
