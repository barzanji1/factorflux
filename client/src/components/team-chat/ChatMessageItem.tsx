import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CornerDownRight, MoreHorizontal, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";
import { NeuButton, NeuInput } from "@/styles/neu/components";
import { ChatAvatar } from "./ChatAvatar";
import { GifPicker } from "./GifPicker";
import { gifMessage, type ChatGif } from "@shared/chat-gif";
import { MentionAutocomplete, type ChatUser } from "./MentionAutocomplete";
import { MessageBody } from "./MessageBody";
import type { ChatMessage } from "./ThreadPanel";

type ReplyPage = { parent: ChatMessage; replies: ChatMessage[]; hasMore: boolean; nextCursor: number };

const timeLabel = (date: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(date));

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    let message = "";
    try { message = (await response.json()).message || ""; } catch { /* Use the status fallback. */ }
    throw new Error(message || `${response.status}: Chat action failed`);
  }
  return response.status === 204 ? undefined as T : response.json();
}

async function getAllReplies(channelId: string | number, messageId: string | number) {
  let cursor = 0;
  let hasMore = true;
  let parent: ChatMessage | null = null;
  const replies: ChatMessage[] = [];
  while (hasMore) {
    const page = await request<ReplyPage>(`/api/chat/channels/${channelId}/threads/${messageId}?afterId=${cursor}`);
    parent = page.parent;
    replies.push(...page.replies);
    const next = Number(page.nextCursor) || page.replies.reduce((max, reply) => Math.max(max, Number(reply.id) || 0), cursor);
    hasMore = page.hasMore && next > cursor;
    cursor = next;
  }
  return { parent, replies };
}

export function ChatMessageItem({
  message, currentUserId, currentUserRole, onChanged, compact = false, allowReply = true,
  initiallyExpanded = false, highlightedMessageId, active = true,
}: {
  message: ChatMessage;
  currentUserId?: string | number;
  currentUserRole?: string;
  onChanged: () => void;
  compact?: boolean;
  allowReply?: boolean;
  initiallyExpanded?: boolean;
  highlightedMessageId?: string | null;
  active?: boolean;
}) {
  const isAuthor = String(message.senderId) === String(currentUserId);
  const canManage = ["manager", "admin"].includes((currentUserRole || "").toLowerCase());
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.body);
  const [savingEdit, setSavingEdit] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [replies, setReplies] = useState<ChatMessage[]>([]);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyUsers, setReplyUsers] = useState<ChatUser[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [replyError, setReplyError] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const fetchVersionRef = useRef(0);
  const readReplyRef = useRef<string>("");
  const rootId = message.parentMessageId ?? message.id;
  const isHighlighted = String(message.id) === String(highlightedMessageId);

  useEffect(() => {
    if (initiallyExpanded) setExpanded(true);
  }, [initiallyExpanded]);

  const refreshReplies = useCallback(async () => {
    const version = ++fetchVersionRef.current;
    setLoadingReplies(true);
    try {
      const result = await getAllReplies(message.channelId, message.id);
      if (version === fetchVersionRef.current) {
        setReplies(result.replies); setReplyError("");
        const newest = String(result.replies.at(-1)?.id ?? "");
        if (newest && newest !== readReplyRef.current && active &&
            document.visibilityState === "visible" && document.hasFocus()) {
          await request(`/api/chat/channels/${message.channelId}/read`, "PATCH");
          readReplyRef.current = newest;
          void queryClient.invalidateQueries({ queryKey: ["/api/chat/unread-count"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
        }
      }
    } catch (err) {
      if (version === fetchVersionRef.current) setReplyError(err instanceof Error ? err.message : "Unable to load replies");
    } finally {
      if (version === fetchVersionRef.current) setLoadingReplies(false);
    }
  }, [message.channelId, message.id, active]);

  useEffect(() => {
    if (!active || !allowReply || !expanded) return;
    void refreshReplies();
    const timer = window.setInterval(() => { void refreshReplies(); }, 3000);
    return () => {
      fetchVersionRef.current += 1;
      window.clearInterval(timer);
    };
  }, [active, allowReply, expanded, refreshReplies]);

  useEffect(() => {
    if (!allowReply || !expanded) return;
    let cancelled = false;
    fetch(`/api/chat/users?channelId=${encodeURIComponent(String(message.channelId))}`, { credentials: "include" })
      .then((response) => response.ok ? response.json() as Promise<ChatUser[]> : [])
      .then((users) => { if (!cancelled) setReplyUsers(users); })
      .catch(() => { if (!cancelled) setReplyUsers([]); });
    return () => { cancelled = true; };
  }, [allowReply, expanded, message.channelId]);

  useEffect(() => {
    if (editing) window.requestAnimationFrame(() => editInputRef.current?.focus());
  }, [editing]);

  const saveEdit = async () => {
    const body = editDraft.trim();
    if (!body || body === message.body || savingEdit) {
      if (body === message.body) setEditing(false);
      return;
    }
    setSavingEdit(true);
    setActionError("");
    try {
      await request(`/api/chat/channels/${message.channelId}/messages/${message.id}`, "PATCH", { body });
      setEditing(false);
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Message could not be edited");
    } finally { setSavingEdit(false); }
  };

  const deleteMessage = async () => {
    setBusy(true);
    setActionError("");
    try {
      await request(`/api/chat/channels/${message.channelId}/messages/${message.id}`, "DELETE");
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Message could not be deleted");
      setConfirmDelete(false);
    } finally { setBusy(false); }
  };

  const submitReply = async () => {
    const body = replyDraft.trim();
    if (!body || busy) return;
    setBusy(true);
    setReplyError("");
    try {
      await request(`/api/chat/channels/${message.channelId}/messages`, "POST", {
        body, parentMessageId: Number(message.id),
      });
      setReplyDraft("");
      await refreshReplies();
      onChanged();
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Reply could not be sent");
    } finally { setBusy(false); }
  };

  const sendGif = async (gif: ChatGif) => {
    setBusy(true);
    setReplyError("");
    try {
      await request(`/api/chat/channels/${message.channelId}/messages`, "POST", {
        body: gifMessage(gif.id), parentMessageId: Number(message.id),
      });
      await refreshReplies();
      onChanged();
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "GIF could not be sent");
    } finally { setBusy(false); }
  };

  const handleEditKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); void saveEdit(); }
    if (event.key === "Escape") { setEditDraft(message.body); setEditing(false); }
  };

  const latestPreview = allowReply && message.latestReply;
  const canDelete = isAuthor || canManage;

  return (
    <article
      id={`chat-message-${message.id}`}
      data-testid={compact ? "chat-thread-reply" : "chat-root-message"}
      className={cn(
        "group mb-2 min-w-0",
        !compact && "flex gap-1.5",
        !compact && isAuthor && "justify-end",
        compact && "flex gap-1.5 pl-2 [&&]:!text-[0.85em]",
        isHighlighted && "rounded-sm bg-[#fff0b8] p-1",
      )}
    >
      {!compact && <ChatAvatar name={message.senderName} profileImageUrl={message.senderProfileImageUrl} className={cn(isAuthor && "order-2")} />}
      {compact && (
        <>
          <CornerDownRight className="mt-1 h-3 w-3 shrink-0 text-[#208894]" />
          <ChatAvatar name={message.senderName} profileImageUrl={message.senderProfileImageUrl} className="h-7 w-7 shrink-0 text-[9px]" />
        </>
      )}
      <div className={cn("min-w-0", compact ? "w-full" : "max-w-[84%]", !compact && isAuthor && "text-right")}>
        <div className={cn("mb-0.5 flex flex-wrap items-baseline gap-1 text-[10px] text-[#888]", !compact && isAuthor && "justify-end")}>
          <span className="font-bold text-[#444]">{message.senderName}</span>
          <span>{timeLabel(message.createdAt)}</span>
          {message.editedAt && <span className="text-[#999]">(edited)</span>}
          {message.mentions?.some((mention) => String(mention.userId) === String(currentUserId)) && (
            <span className="rounded-full bg-[#f2e7c9] px-2 py-0.5 font-bold text-[#684c08]">Mentioned you</span>
          )}
          {(
            <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              {allowReply && <button type="button" onClick={() => setExpanded(true)} data-testid={`chat-reply-${message.id}`} className="rounded-full px-2 py-1 text-[10px] font-semibold text-[#208894] hover:bg-[#27aab8]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#27aab8]">Reply</button>}
              {(isAuthor || canManage) && (
                <div className="relative">
                  <NeuButton type="button" aria-label="Message actions" aria-expanded={menuOpen} onClick={() => { setMenuOpen((open) => !open); setConfirmDelete(false); }} className="!min-h-7 !h-7 !w-7 !rounded-full !p-0 text-[#6f7777]">
                    <MoreHorizontal className="h-4 w-4" />
                  </NeuButton>
                  {menuOpen && (
                    <div className="absolute right-0 top-full z-30 mt-1 min-w-36 rounded-xl bg-[#e0e0e0] p-1 text-left shadow-[-5px_-5px_12px_#fff,5px_5px_12px_#b8b8b8]">
                      {isAuthor && <button type="button" onClick={() => { setEditDraft(message.body); setEditing(true); setMenuOpen(false); }} className="block w-full rounded-lg px-3 py-2 text-left text-xs text-[#444] hover:bg-[#27aab8]/10">Edit</button>}
                      {canDelete && <button type="button" onClick={() => { setConfirmDelete(true); setMenuOpen(false); }} className="block w-full rounded-lg px-3 py-2 text-left text-xs text-[#8b4141] hover:bg-[#8b4141]/10">Delete</button>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {editing ? (
          <div className="min-w-0">
            <NeuInput
              ref={editInputRef}
              aria-label="Edit message"
              value={editDraft}
              onChange={(event) => setEditDraft(event.target.value)}
              onKeyDown={handleEditKey}
              disabled={savingEdit}
              className="!min-h-9 !px-3 !py-1.5 text-left text-sm"
            />
            <div className={cn("mt-1.5 flex gap-1.5", isAuthor && !compact ? "justify-end" : "justify-start")}>
              <NeuButton type="button" variant="accent" onClick={() => void saveEdit()} disabled={!editDraft.trim() || savingEdit} className="!min-h-7 !rounded-lg !px-3 !py-1 text-[10px]">{savingEdit ? "Saving…" : "Save"}</NeuButton>
              <NeuButton type="button" onClick={() => { setEditDraft(message.body); setEditing(false); setActionError(""); }} disabled={savingEdit} className="!min-h-7 !rounded-lg !px-3 !py-1 text-[10px]">Cancel</NeuButton>
            </div>
          </div>
        ) : (
          <div className={cn("inline-block max-w-full whitespace-pre-wrap break-words rounded-xl px-2.5 py-1.5 leading-snug", compact ? "text-xs" : "text-sm", isAuthor && "bg-[#27aab8]/[0.08]")}>
            <MessageBody body={message.body} mentions={message.mentions} channelId={message.channelId} rootMessageId={rootId} />
          </div>
        )}
        {confirmDelete && (
          <div className={cn("mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[#8b4141]", isAuthor && !compact && "justify-end")}>
            <span>Delete this message?</span>
            <NeuButton type="button" variant="accent" onClick={() => void deleteMessage()} disabled={busy} className="!min-h-7 !rounded-lg !px-2.5 !py-1 text-[10px]">Yes</NeuButton>
            <NeuButton type="button" onClick={() => setConfirmDelete(false)} disabled={busy} className="!min-h-7 !rounded-lg !px-2.5 !py-1 text-[10px]">No</NeuButton>
          </div>
        )}
        {actionError && <p role="alert" className="mt-1 text-left text-[10px] text-[#8b3030]">{actionError}</p>}
        {allowReply && (
          <>
            {message.replyCount > 0 && (
              <button type="button" onClick={() => setExpanded((open) => !open)} data-testid={`chat-replies-${message.id}`} aria-expanded={expanded} className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold text-[#208894] hover:bg-[#27aab8]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#27aab8]">
                {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"} {expanded ? "−" : "+"}
              </button>
            )}
            {latestPreview && (
              <button type="button" onClick={() => setExpanded(true)} className="mt-1 flex w-full items-start gap-2 rounded-lg border-l-2 border-[#27aab8] bg-[#27aab8]/[0.04] px-2 py-1.5 text-left hover:bg-[#27aab8]/[0.08]">
                <ChatAvatar name={message.latestReply!.senderName} profileImageUrl={message.latestReply!.senderProfileImageUrl} className="h-5 w-5 text-[8px]" />
                <span className="min-w-0 flex-1 truncate text-[10px] text-[#666]"><strong className="text-[#444]">{message.latestReply!.senderName}</strong> {message.latestReply!.body}</span>
                <span className="shrink-0 text-[9px] text-[#999]">{timeLabel(message.latestReply!.createdAt)}</span>
              </button>
            )}
            {expanded && (
              <section aria-label={`Replies to ${message.senderName}'s message`} className="mt-2 border-l-2 border-[#27aab8] pl-2 sm:ml-2 sm:pl-3">
                {loadingReplies && !replies.length ? <div className="h-8 animate-pulse rounded-lg bg-[#d7d7d7]" aria-label="Loading replies" /> : null}
                {replies.map((reply) => (
                  <ChatMessageItem key={reply.id} message={reply} currentUserId={currentUserId} currentUserRole={currentUserRole} onChanged={() => { void refreshReplies(); onChanged(); }} compact allowReply={false} highlightedMessageId={highlightedMessageId} active={active} />
                ))}
                {!loadingReplies && !replies.length && <p className="py-1 text-[10px] text-[#777]">No replies yet. Start the thread here.</p>}
                {replyError && <p role="alert" className="py-1 text-[10px] text-[#8b3030]">{replyError}<button type="button" onClick={() => void refreshReplies()} className="ml-2 underline">Retry</button></p>}
                <div className="mt-1 flex items-end gap-1.5 rounded-xl bg-[#e0e0e0] p-1.5 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">
                  <MentionAutocomplete value={replyDraft} onChange={setReplyDraft} users={replyUsers} placeholder="Reply..." onSubmit={submitReply} disabled={busy} onDirectoryRefresh={() => undefined} data-testid={`chat-thread-composer-${message.id}`} className="!min-h-8 flex-1 resize-none overflow-hidden !border-0 !bg-transparent px-2 py-1.5 text-xs !text-[#333] outline-none placeholder:!text-[#888] !shadow-none focus-visible:!outline-none" />
                  <GifPicker key={`inline-thread-${message.id}`} onSelect={sendGif} disabled={busy} />
                  <NeuButton type="button" variant="accent" onClick={() => void submitReply()} disabled={!replyDraft.trim() || busy} aria-label="Send reply" className="!min-h-8 !h-8 !w-8 !rounded-lg !p-0"><Send className="h-3.5 w-3.5" /></NeuButton>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </article>
  );
}
