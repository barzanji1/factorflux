import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { db } from "../db";
import * as support from "../services/itSupport";

type SupportDatabase = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute" | "transaction">;
export function registerItSupportRoutes(app: Express, requireAuth: RequestHandler, database: SupportDatabase = db) {
  const id = z.coerce.number().int().positive();
  const wrap = (fn: (req: any) => Promise<unknown>, status = 200): RequestHandler => async (req: any, res) => {
    try { res.status(status).json(await fn(req)); }
    catch (error) {
      if (error instanceof z.ZodError) return void res.status(400).json({ message: error.errors[0]?.message || "Invalid request" });
      if (error instanceof support.ItSupportError) return void res.status(error.status).json({ message: error.message });
      console.error("[IT Support] Request failed", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ message: "IT Support could not complete this request." });
    }
  };
  app.get("/api/it-support/meta", requireAuth, wrap(req => support.supportMeta(database, req.user.id)));
  app.all("/api/it-support/contact", requireAuth, (_req, res) => {
    res.status(405).json({ message: "Dosh Barzanji is the permanent IT contact. Contact assignment cannot be changed." });
  });
  // The retired Tickets tables were verified empty at consolidation. Keep the
  // tables intact; old bookmarks fail explicitly rather than opening another ID.
  app.get("/api/it-support/legacy/:id", requireAuth, (_req, res) => {
    res.status(404).json({ message: "This legacy ticket does not exist. Open IT Support to submit or view requests." });
  });
  app.get("/api/it-support/unread-count", requireAuth, wrap(req => support.supportUnread(database, req.user.id)));
  app.get("/api/it-support/requests", requireAuth, wrap(req => support.supportList(database, req.user.id, z.enum(["mine", "triage"]).parse(req.query.scope ?? "mine"))));
  app.post("/api/it-support/requests", requireAuth, wrap(req => database.transaction(tx => support.createSupportRequest(tx, req.user.id, req.body)), 201));
  app.get("/api/it-support/requests/:id", requireAuth, wrap(req => database.transaction(tx => support.supportDetail(tx, req.user.id, id.parse(req.params.id)))));
  app.patch("/api/it-support/requests/:id", requireAuth, wrap(req => database.transaction(tx => support.updateSupportRequest(tx, req.user.id, id.parse(req.params.id), req.body))));
  app.delete("/api/it-support/requests/:id", requireAuth, wrap(req => database.transaction(tx => support.deleteSupportRequest(tx, req.user.id, id.parse(req.params.id), req.body))));
  app.all(["/api/it-support", "/api/it-support/*"], requireAuth, (_req, res) => { res.status(404).json({ message: "IT Support endpoint not found" }); });
}
