import express, { type Express } from "express";
import path from "path";
import fs from "fs";

export function serveStatic(app: Express) {
  const distPath = path.resolve(process.cwd(), "dist/public");

  if (!fs.existsSync(distPath)) {
    console.warn(
      `[static] Build directory not found: ${distPath}. Serving fallback response.`
    );
    app.use("*", (_req, res) => {
      res.status(503).send(
        "Service temporarily unavailable — frontend build not found. Please run npm run build."
      );
    });
    return;
  }

  app.use(express.static(distPath));

  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
