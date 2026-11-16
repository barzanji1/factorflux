import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useSearch } from "wouter";
import { AlertCircle, ArrowLeft, ArrowRight, Bell, LoaderCircle, Pause, Pencil, Play, Plus, RefreshCw, Send, Trash2, X } from "lucide-react";
import type { Announcement, AnnouncementHighlight, AnnouncementInput } from "@shared/announcements";
import { announcementWordCount } from "@shared/announcements";
import { useAnnouncement, useAnnouncementActions, useAnnouncements } from "@/hooks/use-announcements";
import { NeuButton, NeuCard, NeuSelect, NeuTextarea } from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const colors: Record<Exclude<AnnouncementHighlight, null> | "neutral", { label: string; ink: string; wash: string; edge: string }> = {
  neutral: { label: "No highlight", ink: "#66716c", wash: "#e4e6e3", edge: "#8b9690" },
  teal: { label: "Teal", ink: "#176f70", wash: "#dcebea", edge: "#2b8988" },
  green: { label: "Green", ink: "#356a53", wash: "#e3eee7", edge: "#49866d" },
  amber: { label: "Amber", ink: "#87602a", wash: "#f2eadb", edge: "#bd8740" },
  red: { label: "Red", ink: "#93483e", wash: "#f1e3df", edge: "#b85c50" },
  blue: { label: "Blue", ink: "#3d6583", wash: "#e0e9ef", edge: "#648ba5" },
  purple: { label: "Purple", ink: "#66577e", wash: "#e9e4ef", edge: "#8b79a6" },
};

function postedAt(item: Announcement) {
  return item.postedAt || item.createdAt;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function useExpiryClock(shouldTick: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!shouldTick) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [shouldTick]);
  return now;
}

function useUnexpired(items: Announcement[], enabled: boolean) {
  const hasExpiringItems = enabled && items.some(item => Boolean(item.expiresAt));
  const now = useExpiryClock(hasExpiringItems);
  return useMemo(() => items.filter(item => !item.expiresAt || new Date(item.expiresAt).getTime() > now), [items, now]);
}

function useActiveAnnouncements(enabled = true) {
  const query = useAnnouncements("active", enabled);
  const items = useMemo(() => query.data?.pages.flatMap(page => page.items) ?? [], [query.data]);
  return { ...query, items: useUnexpired(items, enabled) };
}

export function TeamAnnouncementBanner({ compact = false }: { compact?: boolean }) {
  const [, setLocation] = useLocation();
  const { items, isLoading, isError, error, refetch } = useActiveAnnouncements(true);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const currentIndex = items.length ? index % items.length : 0;
  const item = items[currentIndex];
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  useEffect(() => { setIndex(0); }, [items.length]);
  useEffect(() => {
    if (items.length < 2 || paused || hovered || focused || reducedMotion) return;
    const timer = window.setInterval(() => setIndex(value => (value + 1) % items.length), 7500);
    return () => window.clearInterval(timer);
  }, [items.length, paused, hovered, focused, reducedMotion]);
  if (isLoading) return null;
  if (isError) return <NeuNotice severity="block" role="alert" className={`mb-5 flex items-center gap-3 ${compact ? "max-w-3xl" : ""}`} data-testid="team-announcement-error">
    <AlertCircle className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{error instanceof Error ? error.message : "Team updates are temporarily unavailable."}</span>
    <NeuButton size="sm" variant="secondary" onClick={() => void refetch()} aria-label="Retry loading team announcements"><RefreshCw className="h-3.5 w-3.5" /> Retry</NeuButton>
  </NeuNotice>;
  if (!item) return null;
  const tone = item.highlightColor ? colors[item.highlightColor] : colors.neutral;
  const goToDetail = () => setLocation(`/chat?announcement=${item.id}`);
  const move = (direction: number) => setIndex(value => (value + direction + items.length) % items.length);
  return <section
    className={compact ? "mb-5 max-w-3xl" : "mb-5"}
    data-testid="team-announcement-banner"
    aria-label="Team announcement"
    onMouseEnter={() => setHovered(true)}
    onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}
  >
    <div className="overflow-hidden rounded-2xl" style={{ borderLeft: `5px solid ${tone.edge}`, background: `linear-gradient(100deg, ${tone.wash} 0%, #e0e0e0 72%)` }}>
      <div className="flex min-h-[78px] items-center gap-3 px-4 py-3 sm:px-5">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#e0e0e0] shadow-[inset_3px_3px_6px_#c4c9c6,inset_-3px_-3px_6px_#f7f8f6]" style={{ color: tone.ink }}><Bell className="h-4 w-4" /></span>
        <button type="button" onClick={goToDetail} className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#168f99]" aria-label={`Open announcement: ${item.headline}`}>
          <span className="block text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: tone.ink }}>Team announcement</span>
          <span className="block truncate text-sm font-bold leading-5 text-[#35423e]">{item.headline}</span>
          <span className="mt-1 block truncate text-xs text-[#66736e]">{item.authorName} <span aria-hidden="true">·</span> {formatDate(postedAt(item))}</span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {items.length > 1 && <>
            <span className="hidden pr-1 font-mono text-[10px] text-[#6d7974] sm:inline">{currentIndex + 1} / {items.length}</span>
            <NeuButton size="icon" variant="ghost" aria-label="Previous team announcement" data-testid="team-announcement-previous" onClick={() => move(-1)} className="!h-8 !min-h-8 !w-8"><ArrowLeft className="h-4 w-4" /></NeuButton>
            <NeuButton size="icon" variant="ghost" aria-label="Next team announcement" data-testid="team-announcement-next" onClick={() => move(1)} className="!h-8 !min-h-8 !w-8"><ArrowRight className="h-4 w-4" /></NeuButton>
            <NeuButton size="icon" variant="ghost" aria-label={paused ? "Resume announcement rotation" : "Pause announcement rotation"} aria-pressed={paused} onClick={() => setPaused(value => !value)} className="!h-8 !min-h-8 !w-8">{paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}</NeuButton>
          </>}
          <NeuButton size="sm" variant="link" onClick={goToDetail} className="hidden !px-2 sm:inline-flex">Open in chat</NeuButton>
        </div>
      </div>
    </div>
  </section>;
}

type ComposerProps = { onClose: () => void; announcement?: Announcement };

export function AnnouncementComposer({ onClose, announcement }: ComposerProps) {
  const actions = useAnnouncementActions();
  const [message, setMessage] = useState(announcement?.message ?? "");
  const [highlightColor, setHighlightColor] = useState<AnnouncementHighlight | null>(announcement?.highlightColor ?? null);
  const [persistent, setPersistent] = useState(announcement?.persistent ?? true);
  const [error, setError] = useState("");
  const bodyWords = announcementWordCount(message);
  const busy = actions.isPending;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!message.trim() || bodyWords > 50) return;
    const input: AnnouncementInput = { message: message.trim(), highlightColor, persistent };
    try {
      if (announcement) await actions.mutateAsync({ action: "edit", id: announcement.id, version: announcement.version, input });
      else await actions.mutateAsync({ action: "create", input });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your update could not be saved. Try again.");
    }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent showCloseButton={false} data-testid="team-announcement-composer" className="rounded-2xl border-0 bg-[#e0e0e0] p-5 text-[#35423e] shadow-[-8px_-8px_18px_#fff,8px_8px_18px_#b8b8b8] sm:p-6">
      <div className="mb-1 flex items-start justify-between gap-3">
        <DialogHeader className="text-left">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#168f99]">Shared team notice</p>
          <DialogTitle className="mt-1 text-lg font-bold">{announcement ? "Edit team update" : "Post a team update"}</DialogTitle>
          <DialogDescription className="mt-1 text-xs text-[#6d7974]">Visible to staff as soon as you post. It stays active until removed or expired.</DialogDescription>
        </DialogHeader>
        <NeuButton variant="ghost" size="icon" onClick={onClose} disabled={busy} aria-label="Close announcement editor"><X className="h-4 w-4" /></NeuButton>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="team-announcement-message" className="mb-1.5 block text-xs font-semibold">Announcement</label>
          <NeuTextarea id="team-announcement-message" data-testid="team-announcement-message" value={message} maxLength={10000} disabled={busy} onChange={event => setMessage(event.target.value)} placeholder="Share the update your team needs…" className="min-h-32 resize-y" aria-describedby="team-announcement-word-count" required />
          <p id="team-announcement-word-count" data-testid="team-announcement-word-count" className={`mt-1 text-right font-mono text-[10px] ${bodyWords > 50 ? "text-[#a3483e]" : "text-[#77817e]"}`}>{bodyWords} / 50 words</p>
        </div>
        <div>
          <label htmlFor="team-announcement-highlight" className="mb-1.5 block text-xs font-semibold">Highlight color</label>
          <NeuSelect id="team-announcement-highlight" value={highlightColor ?? ""} disabled={busy} onChange={event => setHighlightColor((event.target.value || null) as AnnouncementHighlight)} className="!min-h-10">
            <option value="">No highlight</option>{Object.entries(colors).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
          </NeuSelect>
        </div>
        <div>
          <label htmlFor="team-announcement-lifetime" className="mb-1.5 block text-xs font-semibold">How long should it stay active?</label>
          <NeuSelect id="team-announcement-lifetime" value={persistent ? "persistent" : "seven-days"} disabled={busy} onChange={event => setPersistent(event.target.value === "persistent")} className="!min-h-10">
            <option value="persistent">Until removed</option>
            <option value="seven-days">Expire after 7 days</option>
          </NeuSelect>
        </div>
        {error && <NeuNotice severity="block" role="alert"><span className="flex items-start gap-2 text-sm"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</span></NeuNotice>}
        <div className="flex justify-end gap-2 pt-1">
          <NeuButton variant="secondary" onClick={onClose} disabled={busy}>Cancel</NeuButton>
          <NeuButton type="submit" variant="accent" data-testid="team-announcement-submit" disabled={busy || !message.trim() || bodyWords > 50}>
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{busy ? "Posting…" : announcement ? "Save update" : "Post update"}
          </NeuButton>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

function AnnouncementCard({ item, onEdit, onDelete, onOpen }: { item: Announcement; onEdit: (item: Announcement) => void; onDelete: (item: Announcement) => void; onOpen?: (item: Announcement) => void }) {
  const tone = item.highlightColor ? colors[item.highlightColor] : colors.neutral;
  return <article className="border-b border-[#c8cbc6] px-4 py-3 last:border-b-0" data-testid={`team-announcement-item-${item.id}`}>
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tone.edge }} />
      <div className="min-w-0 flex-1">
        {onOpen ? <button type="button" onClick={() => onOpen(item)} className="break-words text-left text-sm font-bold leading-5 text-[#35423e] hover:text-[#168f99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#168f99]" aria-label={`Open announcement: ${item.headline}`}>{item.headline}</button> : <h3 className="break-words text-sm font-bold leading-5 text-[#35423e]">{item.headline}</h3>}
        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-[#56635e]">{item.message || item.headline}</p>
        <p className="mt-2 text-[10px] text-[#77817e]"><span className="font-semibold text-[#55615c]">{item.authorName}</span> <span aria-hidden="true">·</span> <time dateTime={postedAt(item)}>{formatDate(postedAt(item))}</time></p>
      </div>
      {(item.canEdit || item.canDelete) && <div className="flex shrink-0 gap-1">
        {item.canEdit && <NeuButton variant="ghost" size="icon" onClick={() => onEdit(item)} aria-label={`Edit announcement: ${item.headline}`} className="!h-8 !min-h-8 !w-8"><Pencil className="h-3.5 w-3.5" /></NeuButton>}
        {item.canDelete && <NeuButton variant="ghost" size="icon" onClick={() => onDelete(item)} aria-label={`Delete announcement: ${item.headline}`} className="!h-8 !min-h-8 !w-8 !text-[#a3483e]"><Trash2 className="h-3.5 w-3.5" /></NeuButton>}
      </div>}
    </div>
  </article>;
}

export function TeamAnnouncementWorkspace({ active }: { active: boolean }) {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const requested = new URLSearchParams(search).get("announcement");
  const selectedId = active && requested && /^\d+$/.test(requested) ? Number(requested) : null;
  const list = useActiveAnnouncements(active);
  const detailQuery = useAnnouncement(selectedId);
  const actions = useAnnouncementActions();
  const [composer, setComposer] = useState<Announcement | null | false>(false);
  const [actionError, setActionError] = useState("");
  const items = list.items;
  const detailNow = useExpiryClock(active && Boolean(detailQuery.data?.expiresAt));
  const selectedExpired = Boolean(!detailQuery.isError && detailQuery.data?.expiresAt && new Date(detailQuery.data.expiresAt).getTime() <= detailNow);
  const selected = detailQuery.isError ? undefined : detailQuery.data
    ? selectedExpired ? undefined : detailQuery.data
    : items.find(item => item.id === selectedId);
  const selectedTone = selected?.highlightColor ? colors[selected.highlightColor] : colors.neutral;
  if (!active) return null;
  const openAnnouncement = (item: Announcement) => setLocation(`/chat?announcement=${item.id}`);
  const deleteAnnouncement = async (item: Announcement) => {
    if (!window.confirm(`Delete “${item.headline}” from team announcements?`)) return;
    setActionError("");
    try {
      await actions.mutateAsync({ action: "delete", id: item.id, version: item.version });
      if (selectedId === item.id) setLocation("/chat");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "This update could not be deleted. Refresh and try again.");
    }
  };
  const loadMore = () => { if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage(); };
  return <section className="mb-3 max-h-[38dvh] min-h-0 shrink-0 overflow-y-auto overscroll-contain" aria-label="Team announcements" data-testid="team-announcement-workspace">
    {selectedId === null && <TeamAnnouncementBanner />}
    <div className="grid gap-3">
      <NeuCard className="overflow-hidden p-0">
        <header className="flex items-center gap-3 border-b border-[#c8cbc6] px-4 py-3">
          <div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#168f99]">Team noticeboard</p><h2 className="text-sm font-bold text-[#35423e]">{selected ? "Announcement details" : "Latest team updates"}</h2></div>
          <NeuButton variant="accent" size="sm" onClick={() => setComposer(null)} data-testid="team-announcement-new" aria-label="Write a new announcement"><Plus className="h-3.5 w-3.5" /> New update</NeuButton>
        </header>
        {actionError && <NeuNotice severity="block" role="alert" className="m-3 text-xs">{actionError}</NeuNotice>}
        {actions.isPending && <p role="status" aria-live="polite" className="px-4 pt-3 text-xs text-[#64716c]">Saving announcement changes…</p>}
        {selectedId !== null && <div data-testid="team-announcement-detail" aria-label="Selected announcement">
          {detailQuery.isLoading && <div className="m-4 h-24 animate-pulse rounded-xl bg-[#d7dbd8]" aria-label="Loading announcement details" />}
          {detailQuery.isError && <NeuNotice severity="block" role="alert" className="m-3">
            <p className="text-sm">{detailQuery.error instanceof Error ? detailQuery.error.message : "This announcement could not be loaded."}</p>
            <div className="mt-2 flex gap-2"><NeuButton size="sm" variant="secondary" onClick={() => void detailQuery.refetch()}><RefreshCw className="h-3.5 w-3.5" /> Retry</NeuButton><NeuButton size="sm" variant="ghost" onClick={() => setLocation("/chat")}>Back to chat</NeuButton></div>
          </NeuNotice>}
          {selectedExpired && <NeuNotice severity="info" role="status" className="m-3 text-sm">This announcement has expired and is no longer active.</NeuNotice>}
          {selected && <article className="m-3 rounded-xl px-4 py-4" style={{ borderLeft: `4px solid ${selectedTone.edge}`, backgroundColor: selectedTone.wash }}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: selectedTone.ink }}>Team announcement</p>
                <h3 className="mt-1 break-words text-base font-bold leading-6 text-[#35423e]">{selected.headline}</h3>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[#45514c]">{selected.message || selected.headline}</p>
                <p className="mt-4 text-xs text-[#64716c]"><span className="font-semibold text-[#46534e]">{selected.authorName}</span> <span aria-hidden="true">·</span> <time dateTime={postedAt(selected)}>{formatDate(postedAt(selected))}</time></p>
              </div>
              <div className="flex gap-1">
                {selected.canEdit && <NeuButton variant="ghost" size="icon" onClick={() => setComposer(selected)} aria-label="Edit this announcement"><Pencil className="h-4 w-4" /></NeuButton>}
                {selected.canDelete && <NeuButton variant="ghost" size="icon" onClick={() => void deleteAnnouncement(selected)} disabled={actions.isPending} aria-label="Delete this announcement"><Trash2 className="h-4 w-4" /></NeuButton>}
                <NeuButton variant="ghost" size="icon" onClick={() => setLocation("/chat")} aria-label="Close announcement details"><X className="h-4 w-4" /></NeuButton>
              </div>
            </div>
          </article>}
        </div>}
        <div className="max-h-44 overflow-y-auto" data-testid="team-announcement-list" aria-label="Other active announcements">
          {list.isLoading ? <div className="space-y-2 p-4" role="status" aria-label="Loading announcements">{[1, 2, 3].map(row => <div key={row} className="h-10 animate-pulse rounded-lg bg-[#d7dbd8]" />)}</div>
            : list.isError ? <NeuNotice severity="block" role="alert" className="m-3 flex items-center gap-2 text-xs"><span className="min-w-0 flex-1">{list.error instanceof Error ? list.error.message : "Announcements could not be loaded."}</span><NeuButton size="sm" onClick={() => void list.refetch()} aria-label="Retry loading announcements">Retry</NeuButton></NeuNotice>
              : items.filter(item => item.id !== selectedId).length ? items.filter(item => item.id !== selectedId).map(item => <AnnouncementCard key={item.id} item={item} onOpen={openAnnouncement} onEdit={setComposer} onDelete={item => void deleteAnnouncement(item)} />)
                : !selected && <p className="px-4 py-4 text-xs text-[#75817c]">No other active announcements.</p>}
        </div>
        {list.hasNextPage && <div className="border-t border-[#c8cbc6] px-4 py-2.5 text-center">
          <NeuButton size="sm" variant="secondary" onClick={loadMore} disabled={list.isFetchingNextPage} aria-label="Load more active announcements">
            {list.isFetchingNextPage ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
            {list.isFetchingNextPage ? "Loading…" : "Load more announcements"}
          </NeuButton>
        </div>}
      </NeuCard>
      {composer !== false && <AnnouncementComposer announcement={composer || undefined} onClose={() => setComposer(false)} />}
    </div>
  </section>;
}
