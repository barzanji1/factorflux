import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { get } from "node:http";
import express from "express";
import compression from "compression";
import { serveStatic, serveStaticAssets } from "./static";

test("production assets are compressed and cached without session lookups; HTML revalidates", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "performance-static-"));
  await mkdir(path.join(dir, "assets"));
  await writeFile(path.join(dir, "assets/app-a1B2c3D4.js"), "console.log('asset');\n".repeat(300));
  await writeFile(path.join(dir, "index.html"), "<!doctype html><title>Fixture</title>");
  const app = express();
  let sessions = 0;
  app.use(compression());
  serveStaticAssets(app, dir);
  app.use((_req, _res, next) => { sessions++; next(); });
  serveStatic(app, dir);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const asset = await fetch(`${base}/assets/app-a1B2c3D4.js`, { headers: { "Accept-Encoding": "gzip" } });
    assert.match(asset.headers.get("cache-control")!, /31536000.*immutable/);
    assert.equal(asset.headers.get("content-encoding"), "gzip");
    assert.match(asset.headers.get("vary")!, /Accept-Encoding/);
    assert.equal(sessions, 0);
    const cachedStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(`${base}/assets/app-a1B2c3D4.js`, { headers: { "If-None-Match": asset.headers.get("etag")! } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).on("error", reject);
    });
    assert.equal(cachedStatus, 304);
    const root = await fetch(`${base}/`);
    assert.equal(root.headers.get("cache-control"), "no-cache");
    assert.equal(sessions, 0);
    const missing = await fetch(`${base}/assets/removed-a1B2c3D4.js`);
    assert.equal(missing.status, 404);
    assert.equal(sessions, 0);
    const page = await fetch(`${base}/invoices/123`);
    assert.equal(page.headers.get("cache-control"), "no-cache");
    assert.match(await page.text(), /Fixture/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
