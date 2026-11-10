import express, { type Express } from "express";
import path from "path";
import fs from "fs";

const publicPath = () => path.resolve(process.cwd(), "dist/public");

/** Public files never need a session database lookup or JSON/body middleware. */
export function serveStaticAssets(app: Express, distPath = publicPath()) {
  if (!fs.existsSync(distPath)) return;
  app.use(express.static(distPath, {
    index: "index.html",
    etag: true,
    setHeaders(res, file) {
      if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
      else if (/[-_][\w-]{8}\.(?:js|css)$/.test(path.basename(file))) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    },
  }));
  // Missing chunks must be 404s, not HTML masquerading as JavaScript.
  app.use("/assets", (_req, res) => res.sendStatus(404));
}

export function serveStatic(app: Express, distPath = publicPath()) {

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

  app.get("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
