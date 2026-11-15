import { useEffect, useMemo, useState } from "react";
import { useSearch } from "wouter";
import { AlertCircle, Bell, Check, ChevronDown, ChevronUp, Clock3, LoaderCircle, MessageSquareText, Pencil, Plus, RefreshCw, Send, ShieldCheck, Trash2, X } from "lucide-react";
import type { Announcement, AnnouncementInput, AnnouncementSeverity } from "@shared/announcements";
import { ANNOUNCEMENT_MAX_WORDS, announcementWordCount } from "@shared/announcements";
import { useAnnouncements, useAnnouncementActions, type AnnouncementAction } from "@/hooks/use-announcements";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { NeuBadge, NeuButton, NeuCard, NeuSelect, NeuTextarea } from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ModalState =
  | { kind: "compose"; announcement?: Announcement }
  | { kind: "delete"; announcement: Announcement }
  | { kind: "review"; announcement: Announcement; decision: "approve" | "reject" }
  | null;

const severityMeta: Record<AnnouncementSeverity, { label: string; edge: string; tint: string; ink: string }> = {
  green: { label: "Informational", edge: "#49866d", tint: "#e4eee7", ink: "#356a53" },
  amber: { label: "Important", edge: "#bd8740", tint: "#f4ead8", ink: "#87602a" },
  red: { label: "Urgent", edge: "#b85c50", tint: "#f2e3df", ink: "#93483e" },
};

function formatDate(value: string | null | undefined) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function announcementDate(item: Announcement) {
  return item.postedAt || item.createdAt;
}

function LoadMore({ query, label }: { query: ReturnType<typeof useAnnouncements>; label: string }) {
  if (!query.hasNextPage) return null;
  return <div className="flex justify-center border-t border-[#c8cbc6] px-4 py-3">
    <NeuButton variant="secondary" size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} aria-label={`Load more ${label}`}>
      {query.isFetchingNextPage ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
      {query.isFetchingNextPage ? "Loading…" : "Load more"}
    </NeuButton>
  </div>;
}

function SectionError({ label, error, retry }: { label: string; error: unknown; retry: () => void }) {
  return <NeuNotice severity="block" role="alert" title={`${label} could not be loaded`} className="m-4">
    <p className="text-sm text-[#66716d]">{error instanceof Error ? error.message : "This section is temporarily unavailable."}</p>
    <NeuButton variant="accent" size="sm" className="mt-3" onClick={retry}><RefreshCw className="h-3.5 w-3.5" /> Retry</NeuButton>
  </NeuNotice>;
}

function LoadingNotice({ label }: { label: string }) {
  return <div role="status" aria-live="polite" className="flex items-center gap-3 px-5 py-6 text-sm text-[#68736f]">
    <LoaderCircle className="h-4 w-4 animate-spin text-[#168f99]" /> Loading {label}…
  </div>;
}

export function Announcements() {
  const { user } = useAuth();
  const { toast } = useToast();
  const search = useSearch();
  const actions = useAnnouncementActions();
  const [mineOpen, setMineOpen] = useState(false);
  const [manageAll, setManageAll] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState<AnnouncementSeverity>("green");
  const [persistent, setPersistent] = useState(false);
  const [reviewReason, setReviewReason] = useState("");
  useEffect(() => {
    if (new URLSearchParams(search).get("announcements") === "mine") setMineOpen(true);
  }, [search]);
  const active = useAnnouncements("active");
  const isReviewer = user?.role === "admin" || user?.role === "manager";
  const mine = useAnnouncements(isReviewer && manageAll ? "all" : "mine", mineOpen);
  const pending = useAnnouncements("pending", isReviewer && pendingOpen);
  const activeItems = useMemo(() => active.data?.pages.flatMap(page => page.items) ?? [], [active.data]);
  const mineItems = useMemo(() => mine.data?.pages.flatMap(page => page.items) ?? [], [mine.data]);
  const pendingItems = useMemo(() => pending.data?.pages.flatMap(page => page.items) ?? [], [pending.data]);
  const wordCount = announcementWordCount(message);

  const beginCompose = (item?: Announcement) => {
    setMessage(item?.message ?? "");
    setSeverity(item?.severity ?? "green");
    setPersistent(item?.persistent ?? false);
    setModal({ kind: "compose", announcement: item });
  };

  const runAction = async (change: AnnouncementAction, successTitle: string, successText?: string) => {
    try {
      await actions.mutateAsync(change);
      toast({ title: successTitle, ...(successText ? { description: successText } : {}) });
      if (change.action !== "dismiss") {
        setModal(null);
        setMessage("");
        setReviewReason("");
      }
    } catch (error) {
      toast({ title: "Could not save announcement", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    }
  };

  const saveAnnouncement = () => {
    const input: AnnouncementInput = { message: message.trim(), severity, persistent };
    if (wordCount < 1 || wordCount > ANNOUNCEMENT_MAX_WORDS) return;
    const item = modal?.kind === "compose" ? modal.announcement : undefined;
    if (item) {
      void runAction({ action: "edit", id: item.id, version: item.version, input }, "Announcement updated", user?.role === "employee" ? "Your changes have been sent for approval." : "Your changes are live.");
    } else {
      void runAction({ action: "create", input }, "Announcement submitted", isReviewer ? "It is now visible to the team." : "It will appear after a manager or admin approves it.");
    }
  };

  const isExpired = (item: Announcement) => Boolean(item.expiresAt && new Date(item.expiresAt).getTime() <= Date.now());
  const allBusy = actions.isPending;

  return <section aria-labelledby="announcements-heading" data-testid="section-announcements" className="mb-5">
    <NeuCard className="ff-neu-work-section overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#c8cbc6] px-4 py-4 sm:px-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#dce9e5] text-[#356a62]"><Bell className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h2 id="announcements-heading" className="text-base font-bold tracking-tight text-[#3e4946]">Team announcements</h2>
          <p className="mt-0.5 text-xs text-[#77817e]">Funding notes, collections updates and team-wide changes.</p>
        </div>
        <NeuButton variant="accent" size="sm" disabled={allBusy} onClick={() => beginCompose()} data-testid="announcement-create">
          <Plus className="h-4 w-4" /> Post an update
        </NeuButton>
      </div>
      {active.isLoading ? <LoadingNotice label="team announcements" /> : active.isError ? <SectionError label="Announcements" error={active.error} retry={() => void active.refetch()} /> : <>
        {activeItems.length ? <div className="divide-y divide-[#c8cbc6]">
          {activeItems.map(item => {
            const tone = severityMeta[item.severity];
            return <article key={item.id} data-testid={`announcement-${item.id}`} className="relative px-4 py-4 pl-5 sm:px-5 sm:py-5" style={{ borderLeft: `4px solid ${tone.edge}`, background: `linear-gradient(90deg, ${tone.tint} 0%, rgba(224,224,224,0) 46%)` }}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.11em]" style={{ color: tone.ink, backgroundColor: `${tone.edge}20` }}>{tone.label}</span>
                    {item.persistent && <NeuBadge>Persistent</NeuBadge>}
                    {item.authorId === user?.id && <NeuBadge tone="success">Yours</NeuBadge>}
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[#3f4946]">{item.message}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#77817e]">
                    <span className="font-semibold text-[#56625e]">{item.authorName}</span><span aria-hidden="true">·</span>
                    <time dateTime={announcementDate(item)}>{formatDate(announcementDate(item))}</time>
                    {!item.persistent && item.expiresAt && <><span aria-hidden="true">·</span><span>Expires {formatDate(item.expiresAt)}</span></>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {item.canManage && <NeuButton variant="secondary" size="sm" disabled={allBusy} onClick={() => beginCompose(item)} aria-label={`Edit announcement by ${item.authorName}`}><Pencil className="h-3.5 w-3.5" /> Edit</NeuButton>}
                  {item.canManage && <NeuButton variant="destructive" size="sm" disabled={allBusy} onClick={() => setModal({ kind: "delete", announcement: item })} aria-label={`Delete announcement by ${item.authorName}`}><Trash2 className="h-3.5 w-3.5" /> Delete</NeuButton>}
                  <NeuButton variant="ghost" size="sm" disabled={allBusy} onClick={() => void runAction({ action: "dismiss", id: item.id, version: item.version }, "Announcement dismissed", "It is hidden from your dashboard only.")} aria-label="Dismiss announcement"><X className="h-3.5 w-3.5" /> Dismiss</NeuButton>
                </div>
              </div>
            </article>;
          })}
        </div> : <div className="px-5 py-9 text-center" data-testid="announcements-empty">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[#dce9e5] text-[#438373]"><MessageSquareText className="h-5 w-5" /></div>
          <h3 className="mt-3 text-sm font-semibold text-[#46514d]">No active announcements</h3>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[#77817e]">Share a funding update or an important collections note with the team.</p>
          <NeuButton variant="accent" size="sm" className="mt-4" disabled={allBusy} onClick={() => beginCompose()}><Plus className="h-4 w-4" /> Create announcement</NeuButton>
        </div>}
        <LoadMore query={active} label="announcements" />
      </>}

      <div className="border-t border-[#c8cbc6]">
        <button type="button" className="flex min-h-12 w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-[#53615c] transition-colors hover:bg-[#d9dcd8] sm:px-5" aria-expanded={mineOpen} onClick={() => setMineOpen(value => !value)} data-testid="announcement-mine-toggle">
          <Clock3 className="h-4 w-4 text-[#168f99]" /> {isReviewer && manageAll ? "Manage announcements" : "My submissions"}
          {mineOpen ? <ChevronUp className="ml-auto h-4 w-4" /> : <ChevronDown className="ml-auto h-4 w-4" />}
        </button>
        {mineOpen && <div className="border-t border-[#c8cbc6]">
          {isReviewer && <div className="flex flex-wrap gap-2 px-4 pt-3 sm:px-5" aria-label="Announcement management views">
            <NeuButton variant={manageAll ? "secondary" : "accent"} size="sm" onClick={() => setManageAll(false)}>My submissions</NeuButton>
            <NeuButton variant={manageAll ? "accent" : "secondary"} size="sm" onClick={() => setManageAll(true)}>All announcements</NeuButton>
          </div>}
          {mine.isLoading ? <LoadingNotice label="your submissions" /> : mine.isError ? <SectionError label="Your submissions" error={mine.error} retry={() => void mine.refetch()} /> : <>
            {mineItems.length ? <div className="divide-y divide-[#c8cbc6]">
              {mineItems.map(item => {
                const expired = isExpired(item);
                const status = item.status === "pending" ? "Pending approval" : item.status === "rejected" ? "Needs changes" : expired ? "Expired" : "Approved";
                return <article key={item.id} className="px-4 py-4 sm:px-5" data-testid={`my-announcement-${item.id}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><NeuBadge tone={item.status === "rejected" ? "warning" : item.status === "pending" ? "accent" : undefined}>{status}</NeuBadge><span className="text-xs text-[#77817e]">{formatDate(announcementDate(item))}</span></div>
                      {manageAll && <p className="mt-1 text-xs font-semibold text-[#56625e]">{item.authorName}</p>}
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[#49534f]">{item.message}</p>
                      {item.rejectionReason && <p className="mt-2 rounded-lg bg-[#f2e3df] px-3 py-2 text-xs leading-5 text-[#93483e]"><strong>Reviewer note:</strong> {item.rejectionReason}</p>}
                    </div>
                    {item.canManage && <div className="flex flex-wrap gap-2">
                      <NeuButton variant="secondary" size="sm" disabled={allBusy} onClick={() => beginCompose(item)}><Pencil className="h-3.5 w-3.5" /> {item.status === "rejected" ? "Edit & resubmit" : "Edit"}</NeuButton>
                      <NeuButton variant="destructive" size="sm" disabled={allBusy} onClick={() => setModal({ kind: "delete", announcement: item })}><Trash2 className="h-3.5 w-3.5" /> Delete</NeuButton>
                    </div>}
                  </div>
                </article>;
              })}
            </div> : <p className="px-5 py-6 text-sm text-[#77817e]">{manageAll ? "There are no announcements to manage." : "You have not submitted any announcements yet."}</p>}
            <LoadMore query={mine} label="submissions" />
          </>}
        </div>}
      </div>

      {isReviewer && <div className="border-t border-[#c8cbc6]">
        <button type="button" className="flex min-h-12 w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-[#53615c] transition-colors hover:bg-[#d9dcd8] sm:px-5" aria-expanded={pendingOpen} onClick={() => setPendingOpen(value => !value)} data-testid="announcement-pending-toggle">
          <ShieldCheck className="h-4 w-4 text-[#168f99]" /> Pending approvals
          {pendingOpen ? <ChevronUp className="ml-auto h-4 w-4" /> : <ChevronDown className="ml-auto h-4 w-4" />}
        </button>
        {pendingOpen && <div className="border-t border-[#c8cbc6]">
          {pending.isLoading ? <LoadingNotice label="pending approvals" /> : pending.isError ? <SectionError label="Pending approvals" error={pending.error} retry={() => void pending.refetch()} /> : <>
            {pendingItems.length ? <div className="divide-y divide-[#c8cbc6]">
              {pendingItems.map(item => <article key={item.id} className="px-4 py-4 sm:px-5" data-testid={`pending-announcement-${item.id}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: severityMeta[item.severity].ink, backgroundColor: severityMeta[item.severity].tint }}>{severityMeta[item.severity].label}</span><span className="text-xs text-[#77817e]">From {item.authorName} · {formatDate(item.createdAt)}</span></div>
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-[#45504c]">{item.message}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.canManage && <NeuButton variant="secondary" size="sm" disabled={allBusy} onClick={() => beginCompose(item)}><Pencil className="h-3.5 w-3.5" /> Edit</NeuButton>}
                    {item.canManage && <NeuButton variant="destructive" size="sm" disabled={allBusy} onClick={() => setModal({ kind: "delete", announcement: item })}><Trash2 className="h-3.5 w-3.5" /> Delete</NeuButton>}
                    <NeuButton variant="accent" size="sm" disabled={allBusy} onClick={() => void runAction({ action: "approve", id: item.id, version: item.version }, "Announcement approved", "It is now live for the team.")}><Check className="h-3.5 w-3.5" /> Approve</NeuButton>
                    <NeuButton variant="secondary" size="sm" disabled={allBusy} onClick={() => { setReviewReason(""); setModal({ kind: "review", announcement: item, decision: "reject" }); }}><AlertCircle className="h-3.5 w-3.5" /> Reject</NeuButton>
                  </div>
                </div>
              </article>)}
            </div> : <p className="px-5 py-6 text-sm text-[#77817e]">There are no announcements awaiting review.</p>}
            <LoadMore query={pending} label="pending approvals" />
          </>}
        </div>}
      </div>}
    </NeuCard>

    <Dialog open={modal?.kind === "compose"} onOpenChange={open => { if (!open && !allBusy) setModal(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{modal?.kind === "compose" && modal.announcement ? "Edit announcement" : "Post an announcement"}</DialogTitle>
          <DialogDescription>{isReviewer ? "Your update will be published to the team immediately." : "Your update will be sent to a manager or admin for approval."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label htmlFor="announcement-message" className="mb-1.5 block text-sm font-semibold text-[#4b5652]">Message</label>
            <NeuTextarea id="announcement-message" value={message} disabled={allBusy} onChange={event => setMessage(event.target.value)} maxLength={10000} aria-describedby="announcement-word-count" placeholder="Share the update your team needs…" className="min-h-32 resize-y" />
            <div id="announcement-word-count" className={`mt-1 text-right font-mono text-xs ${wordCount > ANNOUNCEMENT_MAX_WORDS ? "text-[#a3483e]" : "text-[#77817e]"}`} aria-live="polite">{wordCount} / {ANNOUNCEMENT_MAX_WORDS} words</div>
          </div>
          <div>
            <label htmlFor="announcement-severity" className="mb-1.5 block text-sm font-semibold text-[#4b5652]">Priority</label>
            <NeuSelect id="announcement-severity" value={severity} disabled={allBusy} onChange={event => setSeverity(event.target.value as AnnouncementSeverity)} aria-label="Announcement priority">
              <option value="green">Informational — green</option><option value="amber">Important — amber</option><option value="red">Urgent — red</option>
            </NeuSelect>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-[#d8dbd7] p-3.5">
            <input type="checkbox" checked={persistent} disabled={allBusy} onChange={event => setPersistent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#168f99]" />
            <span><span className="block text-sm font-semibold text-[#46514d]">Keep this announcement active</span><span className="mt-0.5 block text-xs text-[#77817e]">Otherwise it expires automatically after 7 days.</span></span>
          </label>
        </div>
        <DialogFooter>
          <NeuButton variant="secondary" disabled={allBusy} onClick={() => setModal(null)}>Cancel</NeuButton>
          <NeuButton variant="accent" disabled={allBusy || wordCount < 1 || wordCount > ANNOUNCEMENT_MAX_WORDS} onClick={saveAnnouncement}>
            {allBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {modal?.kind === "compose" && modal.announcement ? "Save changes" : isReviewer ? "Publish announcement" : "Submit for approval"}
          </NeuButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={modal?.kind === "delete"} onOpenChange={open => { if (!open && !allBusy) setModal(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Delete this announcement?</DialogTitle><DialogDescription>This permanently removes the announcement. Dismissing is a separate, personal action.</DialogDescription></DialogHeader>
        {modal?.kind === "delete" && <p className="rounded-xl bg-[#d8dbd7] p-3 text-sm text-[#4b5652]">{modal.announcement.message}</p>}
        <DialogFooter>
          <NeuButton variant="secondary" disabled={allBusy} onClick={() => setModal(null)}>Keep announcement</NeuButton>
          <NeuButton variant="destructive" disabled={allBusy} onClick={() => { if (modal?.kind === "delete") void runAction({ action: "delete", id: modal.announcement.id, version: modal.announcement.version }, "Announcement deleted"); }}>
            {allBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete
          </NeuButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={modal?.kind === "review"} onOpenChange={open => { if (!open && !allBusy) setModal(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reject announcement</DialogTitle><DialogDescription>Add an optional note to help the author revise and resubmit. They will be notified.</DialogDescription></DialogHeader>
        <label htmlFor="announcement-review-reason" className="text-sm font-semibold text-[#4b5652]">Reviewer note <span className="font-normal text-[#77817e]">(optional)</span></label>
        <NeuTextarea id="announcement-review-reason" value={reviewReason} onChange={event => setReviewReason(event.target.value)} maxLength={500} placeholder="What should the author change?" className="min-h-24" />
        <DialogFooter>
          <NeuButton variant="secondary" disabled={allBusy} onClick={() => setModal(null)}>Cancel</NeuButton>
          <NeuButton variant="destructive" disabled={allBusy || reviewReason.length > 500} onClick={() => { if (modal?.kind === "review") void runAction({ action: "reject", id: modal.announcement.id, version: modal.announcement.version, ...(reviewReason.trim() ? { reason: reviewReason.trim() } : {}) }, "Announcement rejected", "The author will be notified."); }}>
            {allBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Reject announcement
          </NeuButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}

export default Announcements;
