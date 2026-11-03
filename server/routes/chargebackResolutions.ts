import type { Express, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { ZodError } from "zod";
import { db } from "../db";
import { chargebackLifecycle, recordChargebackRefund, recordShortPayResolution, ResolutionError } from "../services/chargebackResolutions";

export function registerChargebackResolutionRoutes(app: Express, auth: RequestHandler,
  canAccess: (req: any, id: number) => Promise<boolean>) {
  const access: RequestHandler = async (req: any, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: "Invalid invoice id." });
      if (!await canAccess(req, id)) return res.status(403).json({ message: "You may only access your assigned invoices." });
      next();
    } catch { res.status(500).json({ message: "Unable to verify invoice access." }); }
  };
  const failed = (res: any, error: unknown) => {
    if (error instanceof ZodError) return res.status(400).json({ message: error.errors[0]?.message || "Invalid request." });
    if (error instanceof ResolutionError) return res.status(error.status).json({ message: error.message });
    if ((error as { code?: string })?.code === "23505" || (error as { cause?: { code?: string } })?.cause?.code === "23505")
      return res.status(409).json({ message: "This request or payment reference has already been recorded. Refresh before retrying." });
    console.error("[chargeback-resolution]", error instanceof Error ? error.message : "Unknown error");
    return res.status(500).json({ message: "Unable to record the financial resolution." });
  };
  app.get("/api/invoices/:id/chargeback/lifecycle", auth, access, async (req, res) => {
    try { res.set("Cache-Control", "no-store").json(await chargebackLifecycle(Number(req.params.id))); }
    catch (error) { failed(res, error); }
  });
  app.get("/api/invoices/:id/chargeback/approvers", auth, access, async (_req, res) => {
    try {
      const result = await db.execute(sql`SELECT id,trim(concat(first_name,' ',last_name)) AS name
        FROM users WHERE status='active' AND role IN ('manager','admin') AND is_test_account=false ORDER BY first_name,last_name,id`);
      res.set("Cache-Control", "no-store").json(result.rows);
    } catch (error) { failed(res, error); }
  });
  app.post("/api/invoices/:id/chargeback/refunds", auth, access, async (req: any, res) => {
    try { res.status(201).json(await recordChargebackRefund(Number(req.params.id), req.body, req.user.id)); }
    catch (error) { failed(res, error); }
  });
  app.post("/api/invoices/:id/short-pay/resolutions", auth, access, async (req: any, res) => {
    if (req.body?.status === "written_off" && !["manager","admin"].includes(req.user.role))
      return res.status(403).json({ message: "Only a manager or admin can write off a short pay." });
    try { res.status(201).json(await recordShortPayResolution(Number(req.params.id), req.body, req.user.id)); }
    catch (error) { failed(res, error); }
  });
}
