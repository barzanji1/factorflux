import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { emailTemplateService, type createEmailTemplateService } from "../services/emailTemplates";

export function registerEmailTemplateRoutes(app: Express, {
  requireAuth, requireEmailPermission, service = emailTemplateService,
}: {
  requireAuth: RequestHandler;
  requireEmailPermission: RequestHandler;
  service?: ReturnType<typeof createEmailTemplateService>;
}) {
  const wrap = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try { await handler(req, res, next); }
    catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message || "Invalid template" });
      console.error("[emailTemplates] request failed:", error instanceof Error ? error.message : "Unknown error");
      return res.status(500).json({ message: "Could not load or save email templates. Please retry; your composer draft is unchanged." });
    }
  };
  app.use("/api/client-email/templates", requireAuth, requireEmailPermission);
  app.get("/api/client-email/templates", wrap(async (_req, res) => res.json(await service.list())));
  app.post("/api/client-email/templates", wrap(async (req: any, res) => res.status(201).json(await service.create(req.body, req.user.id))));
}
