import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { BroadcastError, emailBroadcastService, type createEmailBroadcastService } from "../services/emailBroadcast";

const uuid = z.string().uuid();
export function registerEmailBroadcastRoutes(app: Express, {
  requireAuth, requireAdmin, service = emailBroadcastService,
}: { requireAuth: RequestHandler; requireAdmin: RequestHandler; service?: ReturnType<typeof createEmailBroadcastService> }) {
  const wrap = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    try { await handler(req, res, next); }
    catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0]?.message ?? "Invalid broadcast" });
      if (error instanceof BroadcastError) return res.status(error.statusCode).json({ message: error.message });
      console.error("[emailBroadcast] request failed:", error instanceof Error ? error.message : "Unknown error");
      return res.status(500).json({ message: "Unable to process broadcast. Your draft has not been discarded; check its status before retrying." });
    }
  };
  // Apply to every method/path, including future additions. The exact role is
  // checked again by the service, so delegated admin-module managers cannot send.
  app.use("/api/email-broadcasts", requireAuth, requireAdmin);
  app.get("/api/email-broadcasts/options", wrap(async (req: any, res) => res.json(await service.options(req.user.id))));
  app.get("/api/email-broadcasts/recipients", wrap(async (req: any, res) => res.json(await service.recipients(req.user.id, req.query))));
  app.post("/api/email-broadcasts/preview", wrap(async (req: any, res) => res.status(201).json(await service.preview(req.user.id, req.body))));
  app.get("/api/email-broadcasts/scheduled", wrap(async (req: any, res) => res.json(await service.scheduled(req.user.id))));
  app.get("/api/email-broadcasts", wrap(async (req: any, res) => res.json(await service.list(req.user.id))));
  app.get("/api/email-broadcasts/:id", wrap(async (req: any, res) => res.json(await service.read(req.user.id, uuid.parse(req.params.id)))));
  app.post("/api/email-broadcasts/:id/edit-preview", wrap(async (req: any, res) => res.json(await service.editPreview(req.user.id, uuid.parse(req.params.id), req.body))));
  app.post("/api/email-broadcasts/:id/confirm", wrap(async (req: any, res) => {
    const { recipientCount, expectedRevision } = z.object({
      recipientCount: z.number().int().positive(), expectedRevision: z.number().int().positive().optional(),
    }).strict().parse(req.body);
    res.json(await service.confirm(req.user.id, uuid.parse(req.params.id), recipientCount, expectedRevision));
  }));
  app.post("/api/email-broadcasts/:id/cancel", wrap(async (req: any, res) => res.json(await service.cancel(req.user.id, uuid.parse(req.params.id)))));
}
