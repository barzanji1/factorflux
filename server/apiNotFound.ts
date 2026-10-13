import type { RequestHandler } from "express";

// Registered after all API routes, before Vite/static SPA fallbacks.
export const apiNotFound: RequestHandler = (req, res) => {
  res.status(404).json({ message: "API endpoint not found.", method: req.method });
};
