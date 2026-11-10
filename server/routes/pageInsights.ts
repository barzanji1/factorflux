import type { Express, RequestHandler } from "express";
import { INSIGHT_ENTITIES } from "@shared/page-insights";
import { insightDefinitions, readPageInsights } from "../services/pageInsights";
import { z } from "zod";

const filters = z.object({
  entityId: z.coerce.number().int().positive().optional(),
  clientId: z.coerce.number().int().positive().optional(),
   section: z.enum(["users", "timetracking", "portal", "factoring", "documents", "audit",
     "global", "aging", "agent", "agent-performance", "broker", "carrier", "carrier-ar", "chargeback", "daily-ar", "monthly"]).optional(),
});
export function registerPageInsightRoutes(app: Express, dependencies: {
  requireAuth: RequestHandler;
  requireModulePermission: (permission: string) => RequestHandler;
  requireManagerOrAdmin: RequestHandler;
  requireAdmin: RequestHandler;
  requireInvoiceRead: RequestHandler;
}) {
  for (const entity of INSIGHT_ENTITIES) {
    const definition = insightDefinitions[entity];
    app.get(`/api/${entity}/stats`,
      // Documents already has a richer existing contract; keep it unless explicitly opted in.
      (req, _res, next) => entity !== "documents" || req.query.insights === "1" ? next() : next("route"),
      dependencies.requireAuth,
      entity === "invoices" ? dependencies.requireInvoiceRead :
        definition.permission === "all_authenticated" ? (_req, _res, next) => next() : dependencies.requireModulePermission(definition.permission),
      ...(entity === "admin" ? [dependencies.requireAdmin] : definition.restricted ? [dependencies.requireManagerOrAdmin] : []),
      async (req: any, res) => {
        const input = filters.safeParse(req.query);
        if (!input.success) return res.status(400).json({ message: "Invalid statistics filter" });
        if (entity === "vault" && !input.data.clientId) return res.status(400).json({ message: "Select a carrier before loading vault statistics" });
        try {
          res.setHeader("Cache-Control", "private, no-store");
          res.json(await readPageInsights(entity, req.user, input.data));
        } catch (error) {
          console.error(`[page-insights] ${entity} query failed`, error instanceof Error ? error.name : "Unknown error");
          res.status(500).json({ message: "Unable to load statistics" });
        }
      });
  }
}
