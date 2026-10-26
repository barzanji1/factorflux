import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

for (const mode of ["exception", "rejection"] as const) {
  test(`captures and flushes an unhandled ${mode} before exiting safely`, async () => {
    const events: Record<string, unknown>[] = [];
    const sink = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const lines = body.split("\n");
      for (let i = 1; i < lines.length - 1; i += 2) {
        if (JSON.parse(lines[i]).type === "event") events.push(JSON.parse(lines[i + 1]));
      }
      res.writeHead(200).end("{}");
    });
    await new Promise<void>(resolve => sink.listen(0, "127.0.0.1", resolve));
    try {
      const port = (sink.address() as AddressInfo).port;
      const script = `
        await import("./server/instrumentation.ts");
        const error = new Error("Fixture Person fixture@example.test");
        ${mode === "exception"
          ? "setImmediate(() => { throw error; });"
          : "Promise.reject(error);"}
      `;
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          // Synthetic local ingestion endpoint, never the real Sentry project.
          SENTRY_DSN: `http://public@127.0.0.1:${port}/1`,
          NODE_ENV: "test",
        },
        stdio: "ignore",
        timeout: 15000,
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
      assert.equal(code, 1, "fatal errors must not leave the process running");
      assert.equal(events.length, 1, "capture exactly once and flush before exit");
      const event = JSON.stringify(events[0]);
      assert(!event.includes("Fixture Person"));
      assert(!event.includes("fixture@example.test"));
      assert(event.includes("Application error (message withheld for privacy)"));
    } finally {
      sink.closeAllConnections();
      await new Promise<void>((resolve, reject) => sink.close(err => err ? reject(err) : resolve()));
    }
  });
}
