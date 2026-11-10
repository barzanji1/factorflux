import { AppShell } from "./AppShell";
import { useLocation } from "wouter";

export default function RouteLoading() {
  const [path] = useLocation();
  const title = path === "/" ? "Agent Dashboard" : path.split("/")[1]
    .split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  return (
    <AppShell title={title} neu>
      <div data-route-loading role="status" aria-live="polite" className="flex items-center gap-3 py-6 text-sm text-slate-500">
        <span aria-hidden="true" className="h-1 w-10 rounded-full bg-teal-500" />
        Loading {title.toLowerCase()}…
      </div>
    </AppShell>
  );
}
