/* Isolated browser fixtures: no authentication bypass in the app and no real writes. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
// CDP fixtures use loopback; the workspace proxy rejects this container browser's Host header.
const origin = process.env.NUMERIC_TEST_ORIGIN || "http://127.0.0.1:5000";
const port = 9448;
const actor = { id: "numeric-admin-fixture", role: "admin", firstName: "Numeric", lastName: "Fixture", email: "fixture@example.invalid", status: "active" };
const stamp = "2026-11-03T12:00:00.000Z";
const insights = { total: 31, open: 19, keyMetric: { label: "Total amount", value: 28000, format: "currency" }, breakdown: [{ name: "open", value: 19 }, { name: "completed", value: 12 }], series: ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"].map((period, i) => ({ period, count: i + 1, amount: 1000 * (i + 1) })) };
const docs = Array.from({ length: 31 }, (_, i) => ({ id: i + 1, filename: `fixture-${i + 1}.pdf`, originalName: `Fixture document ${i + 1}.pdf`, mimeType: "application/pdf", size: 1000, documentType: "rate_confirmation", aiDocumentType: "rate_confirmation", classificationSource: "ai", status: "processed", processingState: "processed", createdAt: stamp, invoiceId: 100 + i, invoiceNumber: `FIX-${i + 1}`, carrierName: "Fixture carrier", uploadedBy: actor.id, ocrConfidence: 0.95, ocrJob: { status: "completed" } }));
const tasks = Array.from({ length: 31 }, (_, i) => ({ id: i + 1, title: `Fixture task ${i + 1}`, description: "Read-only fixture", type: "task", status: "pending", priority: "medium", createdAt: stamp, updatedAt: stamp, dueDate: "2026-12-01", assignedTo: actor.id, createdBy: actor.id, progress: 0, client: null }));
const events = Array.from({ length: 31 }, (_, i) => ({ id: i + 1, eventType: "invoice_created", entityType: "invoice", entityId: 100 + i, actorId: actor.id, actorName: "Numeric Fixture", actorType: "user", createdAt: stamp, payloadJson: {} }));
const seen = [], errors = [], pending = new Map();
let browser, ws, seq = 0, stage = "start";
function response(url, method) {
  const p = url.pathname, headers = [];
  if (p.endsWith("/envelope/")) return { body: { ok: true }, headers };
  if (method !== "GET") {
    if (p === "/api/time-tracking/start-session" || p === "/api/time-tracking/end-session") return { body: { session: null }, headers };
    throw Error(`Unexpected write blocked: ${method} ${p}`);
  }
  let body = [];
  if (p === "/api/auth/verify" || p === "/api/auth/user") body = { user: actor };
  else if (p === "/api/auth/permissions") body = { permissions: ["admin", "dashboard", "documents", "tasks", "logs", "bank_transfers"] };
  else if (p === "/api/admin/users") body = [actor];
  else if (p === "/api/bank-transfers") body = Array.from({ length: 31 }, (_, i) => ({
    id: i + 1, carrierId: 11, carrierName: "Fixture carrier", transferType: "ACH", amount: String(100 + i),
    status: "pending", bankAccountName: "Fixture bank", accountLast4: "1234", memo: `Fixture transfer ${i + 1}`, transferDate: stamp, createdAt: stamp,
  }));
  else if (p.endsWith("/stats") && (url.searchParams.get("insights") === "1" || p !== "/api/documents/stats")) body = insights;
  else if (p === "/api/documents/stats") body = { total: 31, pendingReview: 0, processed: 31, failedOcr: 0, averageConfidence: 0.95, unknownConfidence: 0, types: [{ type: "rate_confirmation", label: "Rate Confirmation", count: 31 }], statuses: [{ status: "processed", label: "Processed", count: 31 }], confidence: [{ bucket: "High", count: 31 }], uploads: [{ month: "2026-11", count: 31 }] };
  else if (p === "/api/documents" || p === "/api/tasks" || p === "/api/audit/events" || p === "/api/admin/audit-log") {
    const source = p === "/api/documents" ? docs : p === "/api/tasks" ? tasks : events;
    const page = Number(url.searchParams.get("page") || 1), limit = Number(url.searchParams.get("limit") || 15);
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const filtered = q ? source.filter(r => JSON.stringify(r).toLowerCase().includes(q)) : source;
    body = url.searchParams.get("all") === "true" ? source : filtered.slice((page - 1) * limit, page * limit);
    headers.push({ name: "X-Total-Count", value: String(filtered.length) }, { name: "X-Page", value: String(page) }, { name: "X-Filter-Options", value: JSON.stringify({ entities: ["invoice"], actions: ["invoice_created"], actors: ["Numeric Fixture"] }) });
  } else if (p === "/api/clients" || p === "/api/brokers") body = url.searchParams.get("all") === "true" ? [] : { data: [], total: 0, page: 1, limit: 15, totalPages: 1 };
  else if (p.endsWith("/count") || p.endsWith("-count")) body = { count: 0 };
  else if (p === "/api/time-tracking/current-session") body = { session: null };
  else if (p === "/api/it-support/meta") body = { contact: null, isContact: false };
  return { body, headers };
}
async function cdp(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function until(expression) {
  for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); }
  throw Error(`Timed out: ${expression}`);
}
async function click(expression) {
  const box = await evaluate(`(()=>{const el=${expression}; if(!el)throw Error("Missing target");el.scrollIntoView({block:"center",behavior:"instant"});const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(document.elementFromPoint(x,y)?.closest('button')!==el.closest('button'))throw Error("Pointer target is covered");return{x,y};})()`);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...box, button: "left", clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...box, button: "left", clickCount: 1 });
}
(async () => {
  browser = spawn("chromium", ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/numeric-insights-${process.pid}`, "about:blank"], { stdio: "ignore" });
  let tabs;
  for (let i = 0; i < 100; i++) {
    try { tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  ws = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  ws.on("message", async raw => {
    const event = JSON.parse(raw);
    if (event.id) { const p = pending.get(event.id); pending.delete(event.id); if (p) event.error ? p.reject(event.error) : p.resolve(event.result); }
    if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    if (event.method !== "Fetch.requestPaused") return;
    const { request, requestId } = event.params;
    try {
      const url = new URL(request.url); seen.push(url.pathname + url.search);
      const r = response(url, request.method);
      await cdp("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }, ...r.headers], body: Buffer.from(JSON.stringify(r.body)).toString("base64") });
    } catch (e) { errors.push(String(e)); await cdp("Fetch.fulfillRequest", { requestId, responseCode: 500, body: Buffer.from('{"message":"Fixture blocked request"}').toString("base64") }); }
  });
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(actor))});` });
  stage = "charts";
  await cdp("Page.navigate", { url: origin + "/bank-transfers" });
  await until(`document.querySelectorAll('[data-insights-entity="bank-transfers"] .insight-chart svg.recharts-surface').length===3`);
  const style = await evaluate(`(()=>{const c=document.querySelector('.insight-chart'),n=document.querySelector('.insight-number');return{radius:getComputedStyle(c).borderRadius,shadow:getComputedStyle(c).boxShadow,color:getComputedStyle(n).color,stats:document.querySelectorAll('.insight-stat').length};})()`);
  assert.equal(style.radius, "16px"); assert(style.shadow.includes("inset")); assert.equal(style.color, "rgb(39, 170, 184)"); assert.equal(style.stats, 3);
  await until(`document.querySelectorAll('main tbody tr').length===15`);
  const firstRow = await evaluate(`document.querySelector('main tbody tr').textContent`);
  await click(`Array.from(document.querySelectorAll('[aria-label="Table pagination"] button')).find(b=>b.textContent==='Next')`);
  await until(`document.querySelector('[aria-label="Table pagination"]').textContent.includes('Page 2 of 3')`);
  assert.equal(await evaluate(`document.querySelectorAll('main tbody tr').length`), 15);
  assert.notEqual(await evaluate(`document.querySelector('main tbody tr').textContent`), firstRow);
  const shot = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/numeric-insights-desktop.png", Buffer.from(shot.data, "base64"));
  stage = "documents";
  await cdp("Page.navigate", { url: origin + "/documents" });
  await until(`document.querySelectorAll('[data-testid^="document-row-"]').length===15`);
  await click(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Next'&&!b.disabled)`);
  await until(`!!document.querySelector('[data-testid="document-row-16"]')`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid^="document-row-"]').length`), 15);
  assert(seen.some(p => p.startsWith("/api/documents?") && p.includes("page=2") && p.includes("limit=15")));
  stage = "audit pagination";
  await cdp("Page.navigate", { url: origin + "/audit-log" });
  await until(`document.body.textContent.includes('Page 1 of 3')`);
  await click(`Array.from(document.querySelectorAll('[aria-label="History pagination"] button')).find(b=>b.textContent==='Next')`);
  await until(`document.body.textContent.includes('Page 2 of 3')`);
  stage = "mobile";
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp("Page.navigate", { url: origin + "/bank-transfers" });
  await until(`!!document.querySelector('.insight-chart svg')`);
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), "Mobile document overflow");
  const mobile = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/numeric-insights-mobile.png", Buffer.from(mobile.data, "base64"));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, charts: 3, statCards: 3, sqlPageSize: 15, sharedTableNextPage: true, documentNextPage: true, auditNextPage: true, mobile: true, realWrites: 0 }));
})().catch(async error => {
  console.error(stage, error);
  console.error(JSON.stringify({ errors, requests: seen.slice(-15), page: await evaluate("document.body.innerText.slice(0, 1000)").catch(() => "unavailable") }));
  process.exitCode = 1;
}).finally(() => { ws?.close(); browser?.kill("SIGKILL"); });
