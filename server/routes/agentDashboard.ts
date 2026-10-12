import type { Express, RequestHandler } from "express";
import { readAgentDashboard, type DashboardViewer } from "../services/agentDashboard";

export function registerAgentDashboardRoutes(app: Express, requireAuth: RequestHandler,
  read: typeof readAgentDashboard = readAgentDashboard) {
  app.get("/api/agent-dashboard", requireAuth, async (req: any, res) => {
    if (!req.user?.id || !["employee", "manager", "admin"].includes(req.user.role)) {
      return void res.status(403).json({ message: "Staff account required" });
    }
    // Identity/scope is always server-owned, never a query-string selection.
    if (Object.keys(req.query).length) return void res.status(400).json({ message: "Dashboard scope cannot be overridden" });
    res.setHeader("Cache-Control", "private, no-store");
    try {
      res.json(await read({ id: req.user.id, role: req.user.role } as DashboardViewer));
    } catch (error) {
      console.error("[agent-dashboard] Read failed:", error instanceof Error ? error.name : "Unknown error");
      res.status(500).json({ message: "Unable to load the work queue. Please retry." });
    }
  });
}
