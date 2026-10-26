import type { Express, RequestHandler } from "express";
import { createHealthHandler } from "../services/health";
import { BackupInProgressError, runDatabaseBackup } from "../services/databaseBackup";

export function registerHealthRoute(app: Express, health = createHealthHandler()) {
  app.get("/api/health", health);
}

export function registerBackupRoute(
  app: Express,
  requireAuth: RequestHandler,
  backup = runDatabaseBackup,
) {
  app.post("/api/admin/backup", requireAuth, async (req, res) => {
    // DB exports require the actual admin role, not a delegated module toggle.
    const user = (req as typeof req & { user?: { role: string } }).user;
    if (user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
    try {
      return res.status(201).json({ status: "completed", ...await backup() });
    } catch (error) {
      return res.status(error instanceof BackupInProgressError ? 409 : 500).json({
        message: error instanceof BackupInProgressError ? error.message : "Database backup failed; alert attempted",
      });
    }
  });
}
