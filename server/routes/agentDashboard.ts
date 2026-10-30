import type { Express, RequestHandler } from "express";
import { performance } from "node:perf_hooks";
import { readAgentDashboard, dashboardReaders, type DashboardViewer } from "../services/agentDashboard";
import { decodeActivityCursor } from "../services/dashboardActivity";

export function registerAgentDashboardRoutes(app: Express, requireAuth: RequestHandler,
  read: (viewer: DashboardViewer) => Promise<unknown> = readAgentDashboard,
  readers = dashboardReaders) {
  const handler = (section?: keyof typeof dashboardReaders): RequestHandler => async (req: any, res) => {
    if (!req.user?.id || !["employee", "manager", "admin"].includes(req.user.role)) {
      return void res.status(403).json({ message: "Staff account required" });
    }
    // Identity/scope is always server-owned, never a query-string selection.
    if (Object.keys(req.query).some(key => section !== "activity" || key !== "cursor")) {
      return void res.status(400).json({ message: "Dashboard scope cannot be overridden" });
    }
    const cursor = req.query.cursor;
    if (section === "activity") {
      try {
        if (cursor !== undefined && typeof cursor !== "string") throw Error();
        decodeActivityCursor(cursor);
      } catch { return void res.status(400).json({ message: "Invalid activity cursor" }); }
    }
    res.setHeader("Cache-Control", "private, no-store");
    const start = performance.now();
    try {
      const viewer = { id: req.user.id, role: req.user.role } as DashboardViewer;
      const result = await (section === "activity"
        ? readers.activity(viewer, undefined, undefined, { cursor })
        : section ? readers[section](viewer) : read(viewer));
      const duration = (performance.now() - start).toFixed(1);
      res.setHeader("Server-Timing", `dashboard;dur=${duration}`);
      const degraded = !section && !!result && typeof result === "object" && "sectionErrors" in result
        && Object.keys(result.sectionErrors as object).length > 0;
      console.info(`[agent-dashboard] endpoint=${section ?? "all"} duration_ms=${duration} ok=${!degraded}`);
      res.status(degraded ? 207 : 200).json(result);
    } catch (error) {
      const duration = (performance.now() - start).toFixed(1);
      res.setHeader("Server-Timing", `dashboard;dur=${duration}`);
      console.info(`[agent-dashboard] endpoint=${section ?? "all"} duration_ms=${duration} ok=false`);
      console.error("[agent-dashboard] Read failed:", error instanceof Error ? error.name : "Unknown error");
      res.status(500).json({ message: `Unable to load ${section ?? "the work queue"}. Please retry.`, section: section ?? "all" });
    }
  };
  app.get("/api/agent-dashboard", requireAuth, handler());
  for (const section of ["queue", "followups", "activity", "alerts", "financial"] as const)
    app.get(`/api/agent-dashboard/${section}`, requireAuth, handler(section));
}
