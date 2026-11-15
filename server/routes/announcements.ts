import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { ANNOUNCEMENT_PAGE_SIZE } from "../../shared/announcements";
import { AnnouncementError, listAnnouncements, mutateAnnouncement, type AnnouncementOperation, type AnnouncementStore } from "../services/announcements";

const idSchema = z.coerce.number().int().positive();
const listInput = z.object({
  view: z.enum(["active", "mine", "pending", "all"]).default("active"),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  limit: z.coerce.number().int().min(1).max(ANNOUNCEMENT_PAGE_SIZE).default(ANNOUNCEMENT_PAGE_SIZE),
}).strict();

export function registerAnnouncementRoutes(app: Express, auth: RequestHandler, store?: AnnouncementStore) {
  const handler = (action: "list" | AnnouncementOperation): RequestHandler => async (req: any, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (action === "list") {
        const { view, offset, limit } = listInput.parse(req.query);
        return void res.json(await listAnnouncements(req.user.id, view, offset, limit, store));
      }
      const id = action === "create" ? undefined : idSchema.parse(req.params.id);
      const result = await mutateAnnouncement(action, req.user.id, req.body, id, store);
      res.status(action === "create" ? 201 : 200).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) return void res.status(400).json({ message: error.issues[0]?.message || "Invalid announcement." });
      if (error instanceof AnnouncementError) return void res.status(error.statusCode).json({ message: error.message });
      console.error("[announcements] Request failed:", error instanceof Error ? error.name : "Unknown error");
      res.status(500).json({ message: "Announcements could not be loaded or saved. Please retry." });
    }
  };
  app.get("/api/announcements", auth, handler("list"));
  app.post("/api/announcements", auth, handler("create"));
  app.patch("/api/announcements/:id", auth, handler("edit"));
  app.delete("/api/announcements/:id", auth, handler("delete"));
  for (const action of ["dismiss", "approve", "reject"] as const) {
    app.post(`/api/announcements/:id/${action}`, auth, handler(action));
  }
}
