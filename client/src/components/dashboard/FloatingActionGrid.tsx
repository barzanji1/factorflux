import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import {
  ChartNoAxesCombined,
  Clock3,
  FilePlus2,
  CircleDollarSign,
  TriangleAlert,
  Sparkles,
  ArrowUpRight,
  LockKeyhole,
} from "lucide-react";
import { NeuButton, NeuCard } from "@/styles/neu";
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
  const [flipped, setFlipped] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [denied, setDenied] = useState<string | null>(null);
  const flipTimer = useRef<ReturnType<typeof setTimeout>>();
  const holdTimer = useRef<ReturnType<typeof setTimeout>>();
  const pressStart = useRef<{ x: number; y: number } | null>(null);
  const skipClick = useRef(false);
  const cancelHold = () => {
    clearTimeout(holdTimer.current);
    pressStart.current = null;
  };
  useEffect(() => () => {
    clearTimeout(flipTimer.current);
    clearTimeout(holdTimer.current);
  }, []);
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".ff-action-face[aria-hidden]").forEach(face => {
      face.inert = face.getAttribute("aria-hidden") === "true";
    });
    if (flipped) {
      const goButton = document.querySelector<HTMLButtonElement>(`[data-action-go="${flipped}"]`);
      if (goButton && !goButton.disabled) goButton.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>(`.ff-action-card.is-flipped .ff-action-back`)?.focus({ preventScroll: true });
    }
  }, [flipped]);

  if (error) {
    return (
      <section className="ff-action-section" aria-labelledby="action-grid-title" data-testid="action-grid">
        <div className="ff-action-heading"><div><p className="ff-neu-eyebrow">Choose a direction</p><h2 id="action-grid-title" className="ff-neu-section-title">Your action grid</h2></div></div>
        <div className="ff-action-error" role="alert">
          <div><strong>Action details could not be loaded.</strong><p>{error instanceof Error ? error.message : "Try again to reload your dashboard actions."}</p></div>
          <NeuButton variant="accent" onClick={onRetry}>Retry</NeuButton>
        </div>
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

  const handleActivate = (card: ActionCard, path = card.destination) => {
    clearTimeout(flipTimer.current);
    cancelHold();
    if (!canVisit(path.split("?")[0])) {
      setDenied(card.id);
      setFlipped(card.id);
      return;
    }
    setDenied(null);
    onNavigate(path);
  };
  const activate = (card: ActionCard) => handleActivate(card, card.id === "earl"
    ? `/ai-assistant?draft=${encodeURIComponent(draft.trim())}` : card.destination);
  const startHold = (event: PointerEvent<HTMLButtonElement>, card: ActionCard) => {
    if (event.button !== 0 || !event.isPrimary) return;
    cancelHold();
    skipClick.current = false;
    pressStart.current = { x: event.clientX, y: event.clientY };
    holdTimer.current = setTimeout(() => {
      skipClick.current = true;
      activate(card);
    }, 600);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-8, Math.min(8, ((event.clientX - bounds.left) / bounds.width - 0.5) * 16));
    const y = Math.max(-8, Math.min(8, ((event.clientY - bounds.top) / bounds.height - 0.5) * -16));
    event.currentTarget.style.setProperty("--tilt-x", `${y}deg`);
    event.currentTarget.style.setProperty("--tilt-y", `${x}deg`);
  };
  const resetTilt = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
  };
  const sendDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleActivate(cards.find(card => card.id === "earl")!, `/ai-assistant?draft=${encodeURIComponent(draft.trim())}`);
  };

  return (
    <section className="ff-action-section" aria-labelledby="action-grid-title" data-testid="action-grid">
      <div className="ff-action-heading">
        <div><p className="ff-neu-eyebrow">Choose a direction</p><h2 id="action-grid-title" className="ff-neu-section-title">Action grid</h2></div>
        <span className="ff-action-hint">Click to preview · Double-click or hold to open</span>
      </div>
      <div className="ff-action-grid">
        {cards.map((card, index) => {
          const Icon = card.icon;
          const isFlipped = flipped === card.id;
          const allowed = canVisit(card.destination.split("?")[0]);
          return (
            <article
              key={card.id}
              className={`ff-action-card ${isFlipped ? "is-flipped" : ""}`}
              style={{ animationDelay: `${index * 120}ms` }}
              onPointerMove={event => { if (!isFlipped) onPointerMove(event); }}
              onPointerLeave={event => { resetTilt(event); cancelHold(); }}
              data-testid={`action-card-${card.id}`}
            >
              <div className="ff-action-rotator">
                <NeuCard className="ff-action-face ff-action-front" aria-hidden={isFlipped}>
                  <button type="button" className={`ff-action-front-button tint-${card.tint}`}
                    aria-label={`${card.title}. Show details; double-click or hold to open directly`}
                    onPointerDown={event => startHold(event, card)}
                    onPointerUp={cancelHold}
                    onPointerCancel={cancelHold}
                    onPointerMove={event => {
                      if (pressStart.current && Math.hypot(event.clientX - pressStart.current.x, event.clientY - pressStart.current.y) > 10) cancelHold();
                    }}
                    onClick={event => {
                      clearTimeout(flipTimer.current);
                      if (skipClick.current || event.detail > 1) return;
                      // Keep the front in place long enough for a native double-click.
                      if (event.detail === 0) setFlipped(card.id);
                      else flipTimer.current = setTimeout(() => setFlipped(card.id), 300);
                    }}
                    onDoubleClick={() => { if (!skipClick.current) activate(card); }}>
                    <span className="ff-action-topline"><span className="ff-action-icon"><Icon aria-hidden="true" /></span>{card.id === "earl" ? <span className="ff-action-badge">Ask</span> : <span className={`ff-action-count ${card.value ? "has-count" : ""}`}>{isLoading ? <span className="ff-action-skeleton-value" aria-label="Loading count" /> : card.value?.toLocaleString()}</span>}</span>
                    <span className="ff-action-title">{card.title}</span>
                    <span className="ff-action-label">{card.description}</span>
                    <span className="ff-action-turn">Turn to explore <ArrowUpRight aria-hidden="true" /></span>
                  </button>
                </NeuCard>
                <NeuCard className="ff-action-face ff-action-back" tabIndex={-1} aria-hidden={!isFlipped} onClick={event => {
                  if (!(event.target as HTMLElement).closest("button,input,form") && isFlipped) activate(card);
                }}>
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
                      {(!allowed || denied === card.id) && <span className="ff-action-denied"><LockKeyhole aria-hidden="true" /> You don’t have access to this page.</span>}
                      <NeuButton data-action-go={card.id} className="ff-action-go" aria-label={`Go to ${card.title}`} disabled={!allowed} onClick={() => activate(card)}>Go <ArrowUpRight aria-hidden="true" /></NeuButton>
                    </div>
                  </div>
                </NeuCard>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
