import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.NEON_DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { fetchWithRetry } = await import("./client");
const { pool } = await import("../../db");
after(() => pool.end());

test("429 and 5xx retry three times with exponential backoff", async () => {
  const original = globalThis.fetch;
  const times: number[] = [];
  globalThis.fetch = async () => {
    times.push(Date.now());
    return times.length < 4
      ? new Response("", { status: times.length === 1 ? 429 : 503 })
      : Response.json({ ok: true });
  };
  try {
    const result = await fetchWithRetry(() => "https://example.test", "test", "fixture",
      { timeoutMs: 100, maxRetries: 4 });
    assert.equal(result.attempts, 4);
    assert.deepEqual(result.raw, { ok: true });
    for (let i = 1; i < times.length; i++) {
      assert(times[i] - times[i - 1] >= [0, 950, 1950, 3950][i]);
    }
  } finally { globalThis.fetch = original; }
});

test("timeout remains active during response body decoding and retries", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls === 2) return Response.json({ recovered: true });
    return {
      ok: true, status: 200,
      json: () => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new DOMException("operation was aborted", "AbortError")), { once: true });
      }),
    } as Response;
  };
  try {
    const result = await fetchWithRetry(() => "https://example.test", "test", "fixture",
      { timeoutMs: 10, maxRetries: 2 });
    assert.equal(result.attempts, 2);
    assert.deepEqual(result.raw, { recovered: true });
  } finally { globalThis.fetch = original; }
});

test("definitive 4xx errors do not retry", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("", { status: 403 }); };
  try {
    await assert.rejects(fetchWithRetry(() => "https://example.test", "test", "fixture",
      { timeoutMs: 10, maxRetries: 4 }), /HTTP 403/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("run cancellation interrupts backoff and prevents further requests", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("", { status: 503 }); };
  const timer = setTimeout(() => controller.abort(), 20);
  try {
    await assert.rejects(fetchWithRetry(() => "https://example.test", "test", "fixture",
      { timeoutMs: 100, maxRetries: 4, signal: controller.signal }), { name: "AbortError" });
    assert.equal(calls, 1);
  } finally { clearTimeout(timer); globalThis.fetch = original; }
});
