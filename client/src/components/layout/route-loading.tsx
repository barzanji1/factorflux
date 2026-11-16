import { AppShell } from "./AppShell";
import { useLocation } from "wouter";
import { PageSkeleton } from "@/components/loading/PageSkeleton";
import { RoutePlaceholder } from "@/components/loading/PageSnapshotFrame";

export default function RouteLoading({ title: providedTitle }: { title?: string } = {}) {
  const [path] = useLocation();
  const title = providedTitle ?? (path === "/" ? "Agent Dashboard" : path.split("/")[1]
    .split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" "));
  return (
    <RoutePlaceholder.Provider value={true}><AppShell title={title} neu>
      <PageSkeleton title={title} />
    </AppShell></RoutePlaceholder.Provider>
  );
}
