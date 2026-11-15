import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Link } from "wouter";
import {
  ChartNoAxesCombined,
  Clock3,
  FilePlus2,
  CircleDollarSign,
  TriangleAlert,
  Sparkles,
  ArrowUpRight,
  LockKeyhole,
  X,
} from "lucide-react";
import { NeuButton, NeuCard } from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";
import type { DashboardActionGrid } from "@shared/agent-dashboard";

type Props = {
  data?: DashboardActionGrid;
  isLoading: boolean;
  error?: unknown;
  onRetry: () => void;
  canVisit: (path: string) => boolean;
  onNavigate: (path: string) => void;
};

type ActionCard = {
  id: string;
  title: string;
  icon: typeof FilePlus2;
  tint: string;
  value?: number;
  destination: string;
  description: string;
};

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function TileSkeleton() {
  return <div className="ff-action-back-skeleton" aria-label="Loading action details"><i /><i /><i /></div>;
}

export function FloatingActionGrid({ data, isLoading, error, onRetry, canVisit, onNavigate }: Props) {
  const [faces, setFaces] = useState<Record<string, { isFlipped: boolean; isAnimating: boolean }>>({});
  const [draft, setDraft] = useState("");
  const transitionLocks = useRef(new Set<string>());
  const touchClicks = useRef<Record<string, number>>({});
  const touchMoved = useRef(false);
  const section = useRef<HTMLElement>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const focusAfterFlip = useRef<string | null>(null);
  const focusFrame = useRef<number | null>(null);
  const tiltFrame = useRef<number | null>(null);
  const pendingTilt = useRef<{ element: HTMLElement; x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    section.current?.querySelectorAll<HTMLElement>(".ff-action-face[aria-hidden]").forEach(face => {
      face.inert = face.getAttribute("aria-hidden") === "true";
    });
    const id = focusAfterFlip.current;
    if (!id || faces[id]?.isAnimating) return;
    const card = section.current?.querySelector<HTMLElement>(`[data-testid="action-card-${id}"]`);
    const target = faces[id]?.isFlipped ? '[data-action-go], .ff-action-close' : '.ff-action-front-button';
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    // In the no-animation path, allow inert/visibility and the pointer's
    // default focus action to settle before restoring keyboard focus.
    const restoreFocus = (remaining: number) => {
      focusFrame.current = null;
      if (!card?.isConnected || (document.activeElement !== document.body && !card.contains(document.activeElement))) return;
      const control = card.querySelector<HTMLElement>(target);
      if (!control) return;
      if (getComputedStyle(control).visibility === "visible" && !control.closest("[inert]")) control.focus({ preventScroll: true });
      if (document.activeElement !== control && remaining > 0) {
        focusFrame.current = requestAnimationFrame(() => restoreFocus(remaining - 1));
      }
    };
    focusFrame.current = requestAnimationFrame(() => restoreFocus(12));
    focusAfterFlip.current = null;
  }, [faces, error]);
  useEffect(() => {
    const root = section.current;
    const cancelled = (event: TransitionEvent) => {
      if (!(event.target instanceof HTMLElement) || !event.target.matches(".ff-action-rotator") || event.propertyName !== "transform") return;
      const id = event.target.closest<HTMLElement>("[data-testid]")?.dataset.testid?.replace("action-card-", "");
      if (id) finishFlip(id);
    };
    root?.addEventListener("transitioncancel", cancelled);
    return () => root?.removeEventListener("transitioncancel", cancelled);
  }, [error]);
  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    if (tiltFrame.current !== null) cancelAnimationFrame(tiltFrame.current);
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
  }, []);
  const finishFlip = (id: string) => {
    if (!transitionLocks.current.delete(id)) return;
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setFaces(previous => ({ ...previous, [id]: { ...previous[id], isAnimating: false } }));
  };
  const flip = (id: string) => {
    if (transitionLocks.current.has(id)) return;
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    focusAfterFlip.current = id;
    if (animate) {
      transitionLocks.current.add(id);
      // transitionend is not guaranteed after a motion preference/style change.
      timers.current.set(id, setTimeout(() => finishFlip(id), 700));
    }
    setFaces(previous => ({
      ...previous,
      [id]: { isFlipped: !previous[id]?.isFlipped, isAnimating: animate },
    }));
  };
  const clickFlip = (id: string) => {
    // A touch already changed state; ignore its compatibility click.
    if (Date.now() - (touchClicks.current[id] ?? 0) < 700) return;
    flip(id);
  };
  if (error) {
    return (
      <section className="ff-action-section" aria-label="Dashboard actions" data-testid="action-grid">
        <NeuNotice severity="block" role="alert" className="flex items-center justify-between gap-3">
          <div><strong>Action details could not be loaded.</strong><p>{error instanceof Error ? error.message : "Try again to reload your dashboard actions."}</p></div>
          <NeuButton variant="accent" onClick={onRetry}>Retry</NeuButton>
        </NeuNotice>
      </section>
    );
  }

  const cards: ActionCard[] = [
    { id: "invoices", title: "Create Invoice", icon: FilePlus2, tint: "mint", value: data?.docsPending, destination: "/invoices?create=1", description: "Documents pending" },
    { id: "fund", title: "Fund Queue", icon: CircleDollarSign, tint: "blue", value: data?.readyToFundCount, destination: "/sheets", description: "Ready to fund" },
    { id: "followups", title: "Follow-ups", icon: Clock3, tint: "amber", value: data?.openFollowups, destination: "/followups", description: "Open follow-ups" },
    { id: "chargebacks", title: "Chargebacks", icon: TriangleAlert, tint: "coral", value: data?.openChargebacks, destination: "/reports?tab=chargeback", description: "Open chargebacks" },
    { id: "reports", title: "Reports", icon: ChartNoAxesCombined, tint: "violet", value: data?.aging60Count, destination: "/reports", description: "Invoices aging 60+" },
    { id: "earl", title: "Ask Earl", icon: Sparkles, tint: "teal", destination: "/ai-assistant", description: "What do you need?" },
  ];

  const onMouseMove = (event: MouseEvent<HTMLElement>) => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    pendingTilt.current = { element: event.currentTarget, x: event.clientX, y: event.clientY };
    if (tiltFrame.current !== null) return;
    tiltFrame.current = requestAnimationFrame(() => {
      tiltFrame.current = null;
      const pointer = pendingTilt.current;
      pendingTilt.current = null;
      if (!pointer || !pointer.element.isConnected || pointer.element.classList.contains("is-flipped")) return;
      const bounds = pointer.element.getBoundingClientRect();
      const x = Math.max(-8, Math.min(8, ((pointer.x - bounds.left) / bounds.width - 0.5) * 16));
      const y = Math.max(-8, Math.min(8, ((pointer.y - bounds.top) / bounds.height - 0.5) * -16));
      pointer.element.style.setProperty("--tilt-x", `${y}deg`);
      pointer.element.style.setProperty("--tilt-y", `${x}deg`);
    });
  };
  const resetTilt = (event: MouseEvent<HTMLElement>) => {
    if (pendingTilt.current?.element === event.currentTarget) pendingTilt.current = null;
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
  };
  const sendDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!transitionLocks.current.has("earl") && canVisit("/ai-assistant")) {
      onNavigate(`/ai-assistant?draft=${encodeURIComponent(draft.trim())}`);
    }
  };

  return (
    <section ref={section} className="ff-action-section" aria-label="Dashboard actions" data-testid="action-grid">
      <div className="ff-action-grid">
        {cards.map((card, index) => {
          const Icon = card.icon;
          const { isFlipped = false, isAnimating = false } = faces[card.id] ?? {};
          const allowed = canVisit(card.destination.split("?")[0]);
          const destination = card.id === "earl" ? `/ai-assistant?draft=${encodeURIComponent(draft.trim())}` : card.destination;
          return (
            <article
              key={card.id}
              className={`ff-action-card ${isFlipped ? "is-flipped" : ""}`}
              style={{ animationDelay: `${index * 120}ms` }}
              onMouseMove={event => { if (!isFlipped && !isAnimating) onMouseMove(event); }}
              onMouseEnter={resetTilt}
              onMouseLeave={resetTilt}
              aria-busy={isAnimating}
              data-testid={`action-card-${card.id}`}
            >
              <div className="ff-action-tilt">
              <div className="ff-action-rotator" onTransitionEnd={event => {
                if (event.target === event.currentTarget && event.propertyName === "transform") finishFlip(card.id);
              }}>
                <NeuCard className="ff-action-face ff-action-front" aria-hidden={isFlipped}>
                  <button type="button" className={`ff-action-front-button tint-${card.tint}`}
                    aria-label={`${card.title}. Show details`}
                    onTouchStart={() => { touchMoved.current = false; }}
                    onTouchMove={() => { touchMoved.current = true; }}
                    onTouchEnd={() => {
                      touchClicks.current[card.id] = Date.now();
                      if (!touchMoved.current) flip(card.id);
                    }}
                    onClick={() => clickFlip(card.id)}>
                    <span className="ff-action-topline"><span className="ff-action-icon"><Icon aria-hidden="true" /></span>{card.id === "earl" ? <span className="ff-action-badge">Ask</span> : <span className={`ff-action-count ${card.value ? "has-count" : ""}`}>{isLoading ? <span className="ff-action-skeleton-value" aria-label="Loading count" /> : card.value?.toLocaleString()}</span>}</span>
                    <span className="ff-action-title">{card.title}</span>
                    <span className="ff-action-label">{card.description}</span>
                    <span className="ff-action-turn">Turn to explore <ArrowUpRight aria-hidden="true" /></span>
                  </button>
                </NeuCard>
                <NeuCard className="ff-action-face ff-action-back" tabIndex={-1} aria-hidden={!isFlipped} onClick={event => {
                  if (!(event.target as HTMLElement).closest("a,button,input,form") && isFlipped) clickFlip(card.id);
                }} onTouchStart={() => { touchMoved.current = false; }} onTouchMove={() => { touchMoved.current = true; }} onTouchEnd={event => {
                  if ((event.target as HTMLElement).closest("a,button,input,form")) return;
                  touchClicks.current[card.id] = Date.now();
                  if (!touchMoved.current && isFlipped) flip(card.id);
                }}>
                  <button type="button" className="ff-action-close" aria-label={`Close ${card.title} preview`} onClick={() => flip(card.id)}><X aria-hidden="true" /></button>
                  <div className="ff-action-back-inner">
                    <div className="ff-action-back-head"><span className={`ff-action-icon tint-${card.tint}`}><Icon aria-hidden="true" /></span><span>{card.title}</span></div>
                    {isLoading || !data ? <TileSkeleton /> : card.id === "invoices" ? (
                      <div className="ff-action-detail-list">
                        <p className="ff-action-detail-label">Latest invoices</p>
                        {data.recentInvoices.length ? data.recentInvoices.slice(0, 3).map(invoice => <div className="ff-action-invoice" key={invoice.id}><strong>{invoice.invoiceNumber}</strong><time>{new Date(invoice.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></div>) : <p className="ff-action-muted">No recent invoices</p>}
                      </div>
                    ) : card.id === "fund" ? <div className="ff-action-back-stat"><span>{data.readyToFundCount.toLocaleString()} ready</span><strong>{money.format(data.readyToFundAmount)}</strong><small>Available to fund</small></div>
                      : card.id === "followups" ? <div className="ff-action-back-stat"><span>{data.overdueFollowups.toLocaleString()} overdue</span><strong>{data.dueTodayFollowups.toLocaleString()}</strong><small>Due today</small></div>
                        : card.id === "chargebacks" ? <div className="ff-action-back-stat"><span>{money.format(data.chargebackAmount)}</span><strong>{data.oldestChargebackDays === null ? "—" : `${data.oldestChargebackDays}d`}</strong><small>Oldest open case</small></div>
                          : card.id === "reports" ? <div className="ff-action-back-stat"><span>{money.format(data.aging60Amount)}</span><strong>{data.brokerCount.toLocaleString()}</strong><small>Brokers represented</small></div>
                            : <form className="ff-earl-mini" onSubmit={sendDraft}><label htmlFor="ff-earl-draft">What do you need?</label><div><input id="ff-earl-draft" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask Earl…" /><button type="submit" aria-label="Open Earl with this draft"><ArrowUpRight aria-hidden="true" /></button></div></form>}
                    <div className="ff-action-back-footer">
                      {!allowed && <span className="ff-action-denied"><LockKeyhole aria-hidden="true" /> You don’t have access to this page.</span>}
                      {allowed ? <Link href={destination} data-action-go={card.id} className="ff-action-go" aria-label={`Go to ${card.title}`} onClick={event => {
                        if (transitionLocks.current.has(card.id)) { event.preventDefault(); return; }
                        if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                          event.preventDefault();
                          onNavigate(destination);
                        }
                      }}>Go →</Link> : <span className="ff-action-go" aria-disabled="true">Go →</span>}
                    </div>
                  </div>
                </NeuCard>
              </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
