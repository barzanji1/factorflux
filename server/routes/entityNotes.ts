import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { EntityNoteError, entityNoteTarget, listEntityNotes, mutateEntityNote, type EntityNoteStore } from "../services/entityNotes";

const id = z.coerce.number().int().positive();
export function registerEntityNoteRoutes(app: Express, auth: RequestHandler, store?: EntityNoteStore) {
  const handle = (action: "list" | "create" | "edit" | "delete"): RequestHandler => async (req: any, res) => {
    try {
      if (action === "list") {
        const target = entityNoteTarget.parse(req.query);
        return void res.json(await listEntityNotes(target.entityType, target.entityId, store));
      }
      const noteId = action === "edit" || action === "delete" ? id.parse(req.params.id) : undefined;
      const note = await mutateEntityNote(action, req.body, req.user, noteId, store);
      res.status(action === "create" ? 201 : 200).json(action === "delete" ? { id: note.id, deletedAt: note.deletedAt } : note);
    } catch (error) {
      if (error instanceof z.ZodError) return void res.status(400).json({ message: error.issues[0]?.message || "Invalid note" });
      if (error instanceof EntityNoteError) return void res.status(error.statusCode).json({ message: error.message });
      console.error("[entity-notes] Request failed:", error instanceof Error ? error.name : "Unknown error");
      res.status(500).json({ message: "Could not save or load notes" });
    }
  };
  app.get("/api/notes", auth, handle("list"));
  app.post("/api/notes", auth, handle("create"));
  app.patch("/api/notes/:id", auth, handle("edit"));
  app.delete("/api/notes/:id", auth, handle("delete"));
}
