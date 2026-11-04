import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { DEFAULT_PAGE_SIZE } from "@shared/pagination";
import { brokerCollectionsService, CollectionError, collectionRunHttpStatus } from "../services/brokerCollections";

export function registerBrokerCollectionsRoutes(app: Express, deps: {
  requireAuth: RequestHandler; service?: typeof brokerCollectionsService;
}) {
  const service = deps.service ?? brokerCollectionsService;
  const wrap = (handler: (req: any, res: any) => Promise<void>): RequestHandler => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof z.ZodError) { res.status(400).json({ message: "Invalid collections request", errors: error.errors }); return; }
      if (error instanceof CollectionError) { res.status(error.status).json({ message: error.message }); return; }
      console.error("[brokerCollections] request failed:", error);
      res.status(500).json({ message: "Unable to process broker collections." });
    }
  };
  const id = (req: any) => z.coerce.number().int().positive().parse(req.params.id);
  app.get("/api/broker-collections/settings", deps.requireAuth, wrap(async (req, res) => {
    res.json(await service.settings(req.user.id));
  }));
  app.patch("/api/broker-collections/settings", deps.requireAuth, wrap(async (req, res) => {
    res.json(await service.updateSettings(req.user.id, req.body));
  }));
  app.post("/api/broker-collections/run", deps.requireAuth, wrap(async (req, res) => {
    const config = await service.settings(req.user.id);
    if (!config.canManage) throw new CollectionError(403, "Administrators only.");
    z.object({}).strict().parse(req.body ?? {});
    const result = await service.tick();
    if (result.failed) console.error("[brokerCollections] manual run failed:", result.errors);
    res.status(collectionRunHttpStatus(result)).json(result);
  }));
  app.get("/api/broker-collections", deps.requireAuth, wrap(async (req, res) => {
    const query = z.object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
      q: z.string().trim().max(200).optional(),
      phase: z.enum(["vp", "rps", "paid", "stopped", "escalated", "paused"]).optional(),
    }).strict().parse(req.query);
    res.json(await service.queue(req.user.id, query));
  }));
  app.get("/api/broker-collections/:id", deps.requireAuth, wrap(async (req, res) => {
    res.json(await service.detail(req.user.id, id(req)));
  }));
  app.post("/api/broker-collections/:id/action", deps.requireAuth, wrap(async (req, res) => {
    res.json(await service.action(req.user.id, id(req), req.body));
  }));
}
