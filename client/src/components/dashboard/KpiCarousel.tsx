import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "wouter";

export type KpiCarouselItem = {
  key: string;
  href: string;
  label: string;
  content: ReactNode;
};

type KpiCarouselProps = {
  items: KpiCarouselItem[];
  speedPixelsPerSecond?: number;
};

export function getKpiCarouselPeriod(setWidth: number, gap: number) {
  return Math.max(0, setWidth) + Math.max(0, gap);
}

export function wrapKpiCarouselPhase(value: number, divisor: number) {
  if (divisor <= 0) return 0;
  return ((value % divisor) + divisor) % divisor;
}

export function KpiCarousel({ items, speedPixelsPerSecond = 30 }: KpiCarouselProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const firstSetRef = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(0);
  const periodRef = useRef(0);
  const pauseReasons = useRef(new Set<string>());
  const dragRef = useRef<{ pointerId: number; startX: number; startPhase: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const [copyCount, setCopyCount] = useState(3);
  const [dragging, setDragging] = useState(false);

  const applyPhase = useCallback((value: number) => {
    const period = periodRef.current;
    phaseRef.current = wrapKpiCarouselPhase(value, period);
    if (trackRef.current) {
      trackRef.current.style.transform = `translate3d(${-phaseRef.current}px, 0, 0)`;
    }
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    const firstSet = firstSetRef.current;
    if (!viewport || !track || !firstSet) return;

    const measure = () => {
      const gap = Number.parseFloat(window.getComputedStyle(track).columnGap) || 0;
      const period = getKpiCarouselPeriod(firstSet.getBoundingClientRect().width, gap);
      if (!period) return;
      periodRef.current = period;
      applyPhase(phaseRef.current);
      setCopyCount(Math.max(3, Math.ceil(viewport.clientWidth / period) + 2));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(firstSet);
    return () => observer.disconnect();
  }, [applyPhase, items.length]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let prior = 0;
    let frame = 0;
    const animate = (time: number) => {
      if (prior && !media.matches && pauseReasons.current.size === 0 && !dragRef.current) {
        applyPhase(phaseRef.current + ((time - prior) * speedPixelsPerSecond) / 1000);
      }
      prior = time;
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [applyPhase, speedPixelsPerSecond]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const delta = event.clientX - drag.startX;
      if (Math.abs(delta) > 6) {
        drag.moved = true;
        setDragging(true);
        if (event.cancelable) event.preventDefault();
      }
      if (drag.moved) applyPhase(drag.startPhase - delta);
    };
    const finishDrag = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      pauseReasons.current.delete("drag");
      setDragging(false);
      if (drag.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      }
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [applyPhase]);

  const nudge = (direction: -1 | 1) => {
    const distance = Math.min(240, periodRef.current * 0.28);
    applyPhase(phaseRef.current + direction * distance);
  };

  const keepFocusedCardVisible = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return;
    const card = target.closest<HTMLElement>("[data-kpi-original]");
    const viewport = viewportRef.current;
    if (!card || !viewport) return;
    const cardRect = card.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    if (cardRect.left < viewportRect.left) applyPhase(phaseRef.current - (viewportRect.left - cardRect.left));
    else if (cardRect.right > viewportRect.right) applyPhase(phaseRef.current + (cardRect.right - viewportRect.right));
  };

  const renderSet = (copyIndex: number) => (
    <div
      key={`kpi-set-${copyIndex}`}
      ref={copyIndex === 0 ? firstSetRef : undefined}
      className="ff-neu-kpi-set"
      aria-hidden={copyIndex !== 0}
    >
      {items.map(item => (
        <Link
          key={item.key}
          href={item.href}
          draggable={false}
          onDragStart={event => event.preventDefault()}
          className="ff-neu-kpi-link"
          tabIndex={copyIndex === 0 ? undefined : -1}
          aria-hidden={copyIndex !== 0}
          aria-label={item.label}
          data-kpi-original={copyIndex === 0 ? "true" : undefined}
          onClickCapture={event => {
            if (suppressClickRef.current) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          {item.content}
        </Link>
      ))}
    </div>
  );

  return (
    <div
      className={`ff-neu-kpi-carousel ${dragging ? "is-dragging" : ""}`}
      role="region"
      aria-roledescription="carousel"
      aria-label="Financial key performance indicators"
      tabIndex={0}
      data-testid="financial-kpi-carousel"
      onMouseEnter={() => pauseReasons.current.add("hover")}
      onMouseLeave={() => pauseReasons.current.delete("hover")}
      onFocusCapture={event => {
        pauseReasons.current.add("focus");
        keepFocusedCardVisible(event.target);
      }}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) pauseReasons.current.delete("focus");
      }}
      onPointerDown={event => {
        if (event.target instanceof Element && event.target.closest("button")) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startPhase: phaseRef.current,
          moved: false,
        };
        pauseReasons.current.add("drag");
      }}
      onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          nudge(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <div className="ff-neu-kpi-window" ref={viewportRef}>
        <div className="ff-neu-kpi-track" ref={trackRef}>
          {Array.from({ length: copyCount }, (_, index) => renderSet(index))}
        </div>
      </div>
      <button className="ff-neu-kpi-arrow left" type="button" aria-label="Scroll metrics left" onClick={() => nudge(-1)}>
        <ChevronLeft aria-hidden="true" />
      </button>
      <button className="ff-neu-kpi-arrow right" type="button" aria-label="Scroll metrics right" onClick={() => nudge(1)}>
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  );
}
