// Finite production-asset verification. API calls use the running application
// and its normal authentication; this does not start schedulers or bypass auth.
import express from "express";
import compression from "compression";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { serveStatic, serveStaticAssets } from "../server/static";

const app = express();
const timings: Array<{ endpoint: string; status: number; milliseconds: number; bytes: number }> = [];
const measured = new Set(["/api/clients", "/api/brokers", "/api/invoices", "/api/documents", "/api/tasks", "/api/expenses"]);
app.use(compression());
serveStaticAssets(app);
app.use("/api", async (req, res) => {
  const start = performance.now();
  const endpoint = `/api${req.path}`;
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value && !["connection", "content-length", "accept-encoding"].includes(name)) headers.set(name, Array.isArray(value) ? value.join(",") : value);
    }
    headers.set("accept-encoding", "identity");
    const response = await fetch(`http://127.0.0.1:5000/api${req.url}`, {
      method: req.method, headers, redirect: "manual",
      ...(!["GET", "HEAD"].includes(req.method) ? { body: Readable.toWeb(req) as ReadableStream, duplex: "half" } : {}),
    } as RequestInit);
    for (const [name, value] of response.headers) {
      if (!["content-encoding", "content-length", "transfer-encoding", "set-cookie"].includes(name)) res.setHeader(name, value);
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("set-cookie", cookies);
    res.status(response.status);
    const body = Buffer.from(await response.arrayBuffer());
    if (measured.has(endpoint)) timings.push({ endpoint, status: response.status, milliseconds: Math.round(performance.now() - start), bytes: body.length });
    res.end(body);
  } catch {
    res.status(502).json({ message: "Production verification upstream unavailable" });
  }
});
serveStatic(app);
const server = app.listen(0, "0.0.0.0");
await new Promise<void>(resolve => server.once("listening", resolve));
const port = (server.address() as { port: number }).port;
try {
  const signInOnly = process.env.SIGNIN_TRANSITION_VERIFY === "1";
  const announcementsOnly = process.env.ANNOUNCEMENTS_UI_VERIFY === "1";
  const child = spawn(process.execPath, [announcementsOnly ? "scripts/verify-announcements-ui.mjs" : signInOnly ? "scripts/debug-signin-transition.mjs" : "scripts/verify-neu-pages.mjs"], {
    stdio: "inherit",
    env: {
      ...process.env,
      NEU_SMOKE_BASE_URL: `http://${process.env.REPLIT_DEV_DOMAIN}:${port}`,
      SIGNIN_TEST_URL: `http://${process.env.REPLIT_DEV_DOMAIN}:${port}`,
      ANNOUNCEMENT_TEST_URL: `http://${process.env.REPLIT_DEV_DOMAIN}:${port}`,
      NEU_SMOKE_OUTPUT: process.env.NEU_SMOKE_OUTPUT || "generated-artifacts/performance/browser",
      ALL_NAVIGATION_VERIFY: "1", LAYOUT_VERIFY: "1", PRODUCTION_PERFORMANCE_VERIFY: "1",
    },
  });
  const status = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", code => resolve(code ?? 1));
  });
  await writeFile("generated-artifacts/performance/api-timings.json", JSON.stringify(timings, null, 2));
  if (status !== 0) throw new Error("Production navigation verification failed");
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
