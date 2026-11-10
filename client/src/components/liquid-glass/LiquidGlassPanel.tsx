import {
  useCallback,
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";
import "./LiquidGlassPanel.css";
import { createLensTexture } from "./optics";

export interface LiquidGlassScene {
  /** Replayed behind the lens and displaced at its perimeter. */
  src: string;
  /** Match the image's positioning on the real page (for example, "center 46%"). */
  position?: string;
  /** Match the image's sizing on the real page (usually "cover"). */
  size?: string;
  /** Optional treatment for the replay only; it never changes the actual backdrop. */
  filter?: string;
  /** Optional tint over the replay, applied after the scene's image filter. */
  overlay?: string;
  /** Element carrying the original cover image; defaults to the viewport. */
  containerRef?: { readonly current: HTMLElement | null };
}

export interface LiquidGlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * An optional, aligned image replay for actual SVG refraction in Chromium.
   * Without it the panel remains generic and uses native backdrop blur, tint,
   * and the same optical edge treatment.
   */
  scene?: LiquidGlassScene;
  /** Disable pointer wavelets while retaining the static material. */
  enableRipples?: boolean;
  /** SVG displacement strength in CSS pixels. */
  refraction?: number;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
}

interface SceneGeometry {
  backgroundSize: string;
  backgroundPosition: string;
  overlaySize: string;
  overlayPosition: string;
}

const CONTROL_TARGET = "input, textarea, select, button, a, label, [role='button'], [role='textbox'], [contenteditable], [data-liquid-glass-no-ripple]";
const RIPPLE_SIZE = 72;

/**
 * A reusable glass lens. SVG filtering is confined to the optional scene
 * replay and its optically mapped perimeter. Children stay in a separate,
 * unfiltered layer above all material effects.
 */
export const LiquidGlassPanel = forwardRef<HTMLDivElement, LiquidGlassPanelProps>(
  function LiquidGlassPanel(
    {
      children,
      className,
      style,
      scene,
      enableRipples = true,
      refraction = 26,
      onPointerMove,
      onPointerEnter,
      ...divProps
    },
    forwardedRef,
  ) {
    const reactId = useId();
    const filterId = `lg-refraction-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const lastRipple = useRef({ x: -1000, y: -1000, at: 0 });
    const nextRippleId = useRef(0);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const rippleTimers = useRef(new Map<number, number>());
    const [ripples, setRipples] = useState<Ripple[]>([]);
    const [sceneGeometry, setSceneGeometry] = useState<SceneGeometry | null>(null);
    const [lensMap, setLensMap] = useState(LENS_MAP);
    const reduceMotion = useRef(false);
    const rippleFilterId = `${filterId}-wave`;

    const setPanelRef = useCallback(
      (node: HTMLDivElement | null) => {
        panelRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    useEffect(() => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = () => {
        reduceMotion.current = query.matches;
        if (query.matches) setRipples([]);
      };
      update();
      query.addEventListener?.("change", update);
      return () => query.removeEventListener?.("change", update);
    }, []);

    useEffect(() => {
      if (!scene) {
        setSceneGeometry(null);
        return;
      }

      const panel = panelRef.current;
      if (!panel) return;
      const image = new window.Image();
      let disposed = false;
      let naturalWidth = 0;
      let naturalHeight = 0;
      let textureSize = "";
      let frame = 0;

      const measure = () => {
        if (disposed || !naturalWidth || !naturalHeight) return;
        const bounds = panel.getBoundingClientRect();
        const sourceBounds = scene.containerRef?.current?.getBoundingClientRect();
        const viewportWidth = sourceBounds?.width ?? document.documentElement.clientWidth;
        const viewportHeight = sourceBounds?.height ?? window.innerHeight;
        const [width, height] = resolveSceneSize(
          scene.size ?? "cover",
          naturalWidth,
          naturalHeight,
          viewportWidth,
          viewportHeight,
        );
        const [positionX, positionY] = resolveScenePosition(
          scene.position ?? "center",
          viewportWidth - width,
          viewportHeight - height,
        );
        const next = {
          backgroundSize: `${width}px ${height}px`,
          backgroundPosition: `${positionX + (sourceBounds?.left ?? 0) - bounds.left}px ${positionY + (sourceBounds?.top ?? 0) - bounds.top}px`,
          overlaySize: `${viewportWidth}px ${viewportHeight}px`,
          overlayPosition: `${(sourceBounds?.left ?? 0) - bounds.left}px ${(sourceBounds?.top ?? 0) - bounds.top}px`,
        };
        setSceneGeometry((previous) =>
          previous && Object.keys(next).every((key) => previous[key as keyof SceneGeometry] === next[key as keyof SceneGeometry])
            ? previous : next);
        const radius = Number.parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 30;
        const sizeKey = `${bounds.width}:${bounds.height}:${radius}`;
        if (textureSize !== sizeKey && bounds.width > 0 && bounds.height > 0) {
          textureSize = sizeKey;
          const texture = createLensTexture(bounds.width, bounds.height, radius);
          if (texture) setLensMap(texture);
        }
      };
      const scheduleMeasure = () => {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); });
      };

      image.onload = () => {
        naturalWidth = image.naturalWidth;
        naturalHeight = image.naturalHeight;
        measure();
      };
      image.onerror = () => setSceneGeometry(null);
      image.src = scene.src;
      if (image.complete && image.naturalWidth) {
        naturalWidth = image.naturalWidth;
        naturalHeight = image.naturalHeight;
        measure();
      }

      const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
      resizeObserver?.observe(panel);
      if (scene.containerRef?.current) resizeObserver?.observe(scene.containerRef.current);
      window.addEventListener("resize", scheduleMeasure);
      window.addEventListener("scroll", scheduleMeasure, true);
      return () => {
        disposed = true;
        image.onload = null;
        image.onerror = null;
        resizeObserver?.disconnect();
        cancelAnimationFrame(frame);
        window.removeEventListener("resize", scheduleMeasure);
        window.removeEventListener("scroll", scheduleMeasure, true);
      };
    }, [scene?.position, scene?.size, scene?.src, scene?.containerRef]);

    useEffect(
      () => () => {
        rippleTimers.current.forEach((timer) => window.clearTimeout(timer));
        rippleTimers.current.clear();
      },
      [],
    );

    const removeRipple = (id: number) => {
      const timer = rippleTimers.current.get(id);
      if (timer !== undefined) window.clearTimeout(timer);
      rippleTimers.current.delete(id);
      setRipples((current) => current.filter((item) => item.id !== id));
    };

    const emitRipple = (event: ReactPointerEvent<HTMLDivElement>, force = false) => {
      if (!enableRipples || reduceMotion.current || event.pointerType === "touch" || event.defaultPrevented) return;
      if ((event.target as Element).closest(CONTROL_TARGET)) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const previous = lastRipple.current;
      const now = performance.now();
      if (!force && (Math.hypot(x - previous.x, y - previous.y) < 18 || now - previous.at < 90)) return;
      lastRipple.current = { x, y, at: now };
      const ripple = { id: nextRippleId.current++, x, y };
      const oldest = ripples.length >= 3 ? ripples[0].id : null;
      if (oldest !== null) {
        const timer = rippleTimers.current.get(oldest);
        if (timer !== undefined) window.clearTimeout(timer);
        rippleTimers.current.delete(oldest);
      }
      setRipples((current) => [...current.filter((item) => item.id !== oldest), ripple].slice(-3));
      rippleTimers.current.set(ripple.id, window.setTimeout(() => removeRipple(ripple.id), 700));
    };

    const sceneStyle: CSSProperties | undefined = scene
      ? {
          backgroundImage: `url("${scene.src.replace(/["\\]/g, "\\$&")}")`,
          backgroundPosition: sceneGeometry?.backgroundPosition ?? "center",
          backgroundSize: sceneGeometry?.backgroundSize ?? "cover",
        }
      : undefined;

    return (
      <div
        {...divProps}
        ref={setPanelRef}
        className={["liquid-glass-panel", className].filter(Boolean).join(" ")}
        style={style}
        onPointerMove={(event) => {
          onPointerMove?.(event);
          emitRipple(event);
        }}
        onPointerEnter={(event) => {
          onPointerEnter?.(event);
          emitRipple(event, true);
        }}
      >
        <svg className="liquid-glass-panel__filter-defs" aria-hidden="true" focusable="false">
          <defs>
            {scene && (
              <filter
                id={filterId}
                x="-3%"
                y="-3%"
                width="106%"
                height="106%"
                colorInterpolationFilters="sRGB"
              >
                <feImage
                  href={lensMap}
                  x="0"
                  y="0"
                  width="100%"
                  height="100%"
                  preserveAspectRatio="none"
                  result="lensMap"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="lensMap"
                  scale={Math.max(0, Math.min(72, refraction))}
                  xChannelSelector="R"
                  yChannelSelector="G"
                />
              </filter>
            )}
            <filter id={rippleFilterId} x="-12%" y="-12%" width="124%" height="124%" colorInterpolationFilters="sRGB">
              <feImage href={RIPPLE_MAP} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="waveMap" />
              <feDisplacementMap in="SourceGraphic" in2="waveMap" scale="12" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        </svg>
        {scene && (
          <>
            <div
              className="liquid-glass-panel__scene"
              aria-hidden="true"
              style={{
                ...sceneStyle,
                filter: `${scene.filter ? `${scene.filter} ` : ""}url(#${filterId})`,
              }}
            />
            {scene.overlay && (
              <div
                className="liquid-glass-panel__scene-overlay"
                aria-hidden="true"
                style={{
                  backgroundImage: scene.overlay,
                  backgroundSize: sceneGeometry?.overlaySize,
                  backgroundPosition: sceneGeometry?.overlayPosition,
                }}
              />
            )}
          </>
        )}
        <div className="liquid-glass-panel__surface" aria-hidden="true" />
        <div className="liquid-glass-panel__sheen" aria-hidden="true" />
        <svg className="liquid-glass-panel__reflections" viewBox="0 0 520 510" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={`${filterId}-silver`} x1="4" y1="225" x2="180" y2="0" gradientUnits="userSpaceOnUse">
              <stop stopColor="#b4dced" stopOpacity="0" />
              <stop offset=".35" stopColor="#b4dced" stopOpacity=".18" />
              <stop offset=".57" stopColor="#f1fbff" stopOpacity=".8" />
              <stop offset=".75" stopColor="#b9e9fa" stopOpacity=".28" />
              <stop offset="1" stopColor="#e2f8ff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${filterId}-warm`} x1="332" y1="510" x2="520" y2="310" gradientUnits="userSpaceOnUse">
              <stop stopColor="#c6e9fb" stopOpacity="0" />
              <stop offset=".4" stopColor="#badbec" stopOpacity=".24" />
              <stop offset=".7" stopColor="#fff1d8" stopOpacity=".75" />
              <stop offset=".87" stopColor="#ffe0b0" stopOpacity=".25" />
              <stop offset="1" stopColor="#d9edf9" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g stroke={`url(#${filterId}-silver)`}>
            <path d="M 2 225 C 3 140 15 103 69 88 C 122 73 135 22 180 1" strokeWidth="18" opacity=".13" />
            <path d="M 2 225 C 3 140 15 103 69 88 C 122 73 135 22 180 1" strokeWidth="3" opacity=".5" />
            <path d="M 2 225 C 3 140 15 103 69 88 C 122 73 135 22 180 1" strokeWidth=".8" />
          </g>
          <g stroke={`url(#${filterId}-warm)`}>
            <path d="M 332 509 C 410 493 458 508 489 463 C 515 424 509 364 519 310" strokeWidth="19" opacity=".12" />
            <path d="M 332 509 C 410 493 458 508 489 463 C 515 424 509 364 519 310" strokeWidth="3" opacity=".5" />
            <path d="M 332 509 C 410 493 458 508 489 463 C 515 424 509 364 519 310" strokeWidth=".8" />
          </g>
        </svg>
        <div className="liquid-glass-panel__ripples" aria-hidden="true">
          {ripples.map((ripple) => (
            <span
              className="liquid-glass-panel__ripple"
              key={ripple.id}
              style={{ left: ripple.x, top: ripple.y, width: RIPPLE_SIZE, height: RIPPLE_SIZE }}
              onAnimationEnd={() => removeRipple(ripple.id)}
            >
              {scene && (
                <span
                  className="liquid-glass-panel__ripple-scene"
                  aria-hidden="true"
                  style={{
                    backgroundImage: scene.overlay
                      ? `${scene.overlay}, url("${scene.src.replace(/["\\]/g, "\\$&")}")`
                      : `url("${scene.src.replace(/["\\]/g, "\\$&")}")`,
                    backgroundSize: scene.overlay
                      ? `100% 100%, ${sceneGeometry?.backgroundSize ?? "cover"}`
                      : sceneGeometry?.backgroundSize ?? "cover",
                    backgroundPosition: scene.overlay
                      ? `0 0, ${rippleBackgroundPosition(ripple.x, ripple.y, sceneGeometry?.backgroundPosition)}`
                      : rippleBackgroundPosition(ripple.x, ripple.y, sceneGeometry?.backgroundPosition),
                    filter: `${scene.filter ? `${scene.filter} ` : ""}url(#${rippleFilterId})`,
                  }}
                />
              )}
            </span>
          ))}
        </div>
        <div className="liquid-glass-panel__rim" aria-hidden="true" />
        <div className="liquid-glass-panel__content">{children}</div>
      </div>
    );
  },
);

LiquidGlassPanel.displayName = "LiquidGlassPanel";

/**
 * Smooth, deterministic rounded-lens map: the inner field is neutral gray
 * (no displacement), with a shallow directional ramp at each edge. No
 * turbulence/noisy texture is used, so the center of the image stays clear.
 */
function makeLensMap(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
    <defs>
      <linearGradient id="top" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#80ae80"/><stop offset="1" stop-color="#808080"/></linearGradient>
      <linearGradient id="bottom" x1="0" y1="1" x2="0" y2="0"><stop stop-color="#805280"/><stop offset="1" stop-color="#808080"/></linearGradient>
      <linearGradient id="left" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#ae8080"/><stop offset="1" stop-color="#808080"/></linearGradient>
      <linearGradient id="right" x1="1" y1="0" x2="0" y2="0"><stop stop-color="#528080"/><stop offset="1" stop-color="#808080"/></linearGradient>
      <clipPath id="roundedLens"><rect width="600" height="600" rx="70"/></clipPath>
    </defs>
    <g clip-path="url(#roundedLens)">
      <rect width="600" height="600" fill="#808080"/>
      <rect width="600" height="94" fill="url(#top)"/>
      <rect y="506" width="600" height="94" fill="url(#bottom)"/>
      <rect width="94" height="600" fill="url(#left)"/>
      <rect x="506" width="94" height="600" fill="url(#right)"/>
    </g>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const LENS_MAP = makeLensMap();

function makeRippleMap(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs>
      <radialGradient id="wave" cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="#808080"/>
        <stop offset=".28" stop-color="#808080"/>
        <stop offset=".34" stop-color="#b0b080"/>
        <stop offset=".39" stop-color="#808080"/>
        <stop offset=".53" stop-color="#808080"/>
        <stop offset=".59" stop-color="#505080"/>
        <stop offset=".65" stop-color="#808080"/>
        <stop offset=".79" stop-color="#808080"/>
        <stop offset=".85" stop-color="#b0b080"/>
        <stop offset=".9" stop-color="#808080"/>
        <stop offset="1" stop-color="#808080"/>
      </radialGradient>
    </defs>
    <rect width="256" height="256" fill="url(#wave)"/>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const RIPPLE_MAP = makeRippleMap();

function resolveSceneSize(
  size: string,
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): [number, number] {
  if (size === "cover" || size === "contain") {
    const scale =
      size === "cover"
        ? Math.max(viewportWidth / naturalWidth, viewportHeight / naturalHeight)
        : Math.min(viewportWidth / naturalWidth, viewportHeight / naturalHeight);
    return [naturalWidth * scale, naturalHeight * scale];
  }

  const parts = size.trim().split(/\s+/);
  const parseLength = (value: string | undefined, natural: number, viewport: number) => {
    if (!value || value === "auto") return null;
    if (value.endsWith("%")) return (Number.parseFloat(value) / 100) * viewport;
    if (value.endsWith("vw")) return (Number.parseFloat(value) / 100) * window.innerWidth;
    if (value.endsWith("vh")) return (Number.parseFloat(value) / 100) * window.innerHeight;
    const pixels = Number.parseFloat(value);
    return Number.isFinite(pixels) ? pixels : natural;
  };
  const width = parseLength(parts[0], naturalWidth, viewportWidth);
  const height = parseLength(parts[1], naturalHeight, viewportHeight);
  if (width === null && height === null) return [naturalWidth, naturalHeight];
  if (width === null) return [naturalWidth * (height as number) / naturalHeight, height as number];
  if (height === null) return [width, naturalHeight * width / naturalWidth];
  return [width, height];
}

function resolveScenePosition(position: string, leftoverX: number, leftoverY: number): [number, number] {
  const tokens = position.trim().toLowerCase().split(/\s+/);
  let [xToken, yToken] = tokens;
  if (!yToken) {
    if (xToken === "top" || xToken === "bottom") {
      yToken = xToken;
      xToken = "center";
    } else {
      yToken = "center";
    }
  }
  const resolveAxis = (token: string, leftover: number) => {
    if (token === "center") return leftover * 0.5;
    if (token === "right" || token === "bottom") return leftover;
    if (token === "left" || token === "top") return 0;
    if (token.endsWith("%")) return leftover * Number.parseFloat(token) / 100;
    return Number.parseFloat(token) || 0;
  };
  return [resolveAxis(xToken, leftoverX), resolveAxis(yToken, leftoverY)];
}

function rippleBackgroundPosition(x: number, y: number, position = "0px 0px"): string {
  const [left = "0px", top = "0px"] = position.split(/\s+/);
  const subtract = (coordinate: string, offset: number) => {
    const parsed = Number.parseFloat(coordinate);
    return `${parsed - offset}px`;
  };
  return `${subtract(left, x - RIPPLE_SIZE / 2)} ${subtract(top, y - RIPPLE_SIZE / 2)}`;
}
