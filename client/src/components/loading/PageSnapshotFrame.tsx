import { createContext, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { createPageSnapshot } from "@/lib/page-snapshot";

const InsideSnapshot = createContext(false);
const SnapshotScope = createContext<ReturnType<typeof createPageSnapshot> | null>(null);
export const RoutePlaceholder = createContext(false);
const block = (width: string, height: number) => ({ width, height, borderRadius: 7, background: "#d8d8d8" });
const card = { borderRadius: 16, padding: 16, background: "hsl(var(--card))", boxShadow: "var(--neu-shadow-sm, 0 2px 8px #00000009)" };

/** Fixed structural slots, not spinners or text masquerading as chart content. */
export function FirstVisitSkeleton({ dashboard = false }: { dashboard?: boolean }) {
  return <div data-first-visit-skeleton aria-hidden="true" className="space-y-4">
    {dashboard && <>
      <div className="space-y-2 py-2"><div style={block("25%", 10)} /><div style={block("38%", 12)} /></div>
      <div style={block("14%", 10)} />
      <div className="flex gap-4 overflow-hidden pb-5">
        {Array.from({ length: 6 }, (_, i) => <div key={i} style={{ ...card, flex: "0 0 230px", height: 132 }}>
          <div style={block("65%", 10)} /><div className="my-4" style={block("40%", 24)} /><div style={block("55%", 10)} />
        </div>)}
      </div>
    </>}
    <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${dashboard ? "mx-auto max-w-[944px] py-3" : "xl:grid-cols-4"}`}>
      {Array.from({ length: dashboard ? 6 : 3 }, (_, i) => <div key={i} style={{ ...card, padding: 12, height: dashboard ? 184 : 88 }}>
        <div style={block("45%", 12)} /><div className="my-2" style={block("65%", 24)} /><div style={block("80%", 10)} />
      </div>)}
    </div>
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2" style={{ gridAutoRows: dashboard ? 318 : 278 }}>
      {Array.from({ length: dashboard ? 2 : 4 }, (_, i) => <div key={i} style={card}>
        <div className="mb-3" style={block("40%", 12)} /><div style={block("100%", dashboard ? 250 : 210)} />
      </div>)}
    </div>
    <div style={card}>{Array.from({ length: 8 }, (_, i) => <div key={i} className="my-3" style={block("100%", 22)} />)}</div>
  </div>;
}

function Snapshot({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [route] = useLocation();
  const scoped = useContext(SnapshotScope);
  const placeholder = useContext(RoutePlaceholder);
  const local = useMemo(() => createPageSnapshot(client, route), [client, route]);
  const snapshot = scoped ?? local;
  const content = useRef<HTMLDivElement>(null);
  useSyncExternalStore(snapshot.subscribe, snapshot.getSnapshot, snapshot.getSnapshot);
  useLayoutEffect(() => scoped ? undefined : snapshot.start(), [snapshot, scoped]);
  useLayoutEffect(() => placeholder ? undefined : snapshot.mountContent(), [snapshot, placeholder]);
  const held = !snapshot.ready;
  useLayoutEffect(() => { if (content.current) content.current.inert = held; }, [held]);
  return <InsideSnapshot.Provider value={true}>
    {held && <div data-page-first-visit style={{ position: "absolute", inset: 0, zIndex: 2, padding: "inherit" }}>
      {snapshot.timedOut
        ? <div role="alert" className="rounded-xl bg-white p-5"><p>This page could not retrieve all of its data.</p><button type="button" className="mt-3 underline" onClick={() => void snapshot.retry()}>Retry</button></div>
        : <FirstVisitSkeleton dashboard={route === "/"} />}
    </div>}
    <div ref={content} data-page-snapshot-content data-snapshot-ready={snapshot.ready ? "true" : "false"}
      aria-hidden={held || undefined} style={{ display: "contents", visibility: held ? "hidden" : undefined }}>
      {children}
    </div>
  </InsideSnapshot.Provider>;
}

/** Own the barrier above Suspense/record loading, not inside a temporary fallback. */
export function PageSnapshotScope({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [route] = useLocation();
  const snapshot = useMemo(() => createPageSnapshot(client, route), [client, route]);
  useLayoutEffect(() => snapshot.start(), [snapshot]);
  return <SnapshotScope.Provider value={snapshot}>{children}</SnapshotScope.Provider>;
}

export function PageSnapshotFrame({ children }: { children: ReactNode }) {
  const nested = useContext(InsideSnapshot);
  const [path] = useLocation();
  if (nested || path === "/login" || path === "/portal" || path.startsWith("/portal/")) return <>{children}</>;
  return <Snapshot>{children}</Snapshot>;
}
