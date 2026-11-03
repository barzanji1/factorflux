// Isolated API fixtures: no real review decisions, invoice releases, or FMCSA runs.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = fs.mkdtempSync("/tmp/ff-risk-neu-");
const actor = { id: "risk-fixture-admin", firstName: "Risk", lastName: "Fixture", role: "admin", status: "active" };
const stamp = new Date().toISOString();
const checks = [201, 202].map(id => ({ id, entityType: "broker", entityId: 7, entityName: `Review Fixture ${id}`, mcNumber: "123456", riskScore: 85, riskTier: "low", creditLimit: "1000", status: "pending", createdAt: stamp, updatedAt: stamp }));
const held = [{ id: 301, invoiceNumber: "RISK-HELD-FIXTURE", amount: "500", status: "held", heldReason: "Manual hold", heldAt: stamp, heldBy: actor.id, heldFor: ["managers"], heldNotes: "Fixture hold", clientName: "Risk Carrier", brokerName: "Risk Broker", loadNumber: "RISK-LOAD" }];
const authorities = [
  { id: 401, entityType: "broker", entityId: 7, entityName: "Risk Broker", mcNumber: "123456", legalName: "Risk Broker", brokerAuthorityStatus: "A", operatingStatus: "AUTHORIZED", allowedToOperate: true, authorityStatus: "ACTIVE", checkStatus: "ok", checkedAt: stamp, checkedBy: actor.id },
  { id: 402, entityType: "carrier", entityId: 8, entityName: "Risk Carrier", mcNumber: "456789", legalName: "Risk Carrier", commonAuthorityStatus: "I", operatingStatus: "INACTIVE", allowedToOperate: false, authorityStatus: "INACTIVE", checkStatus: "ok", checkedAt: stamp, checkedBy: actor.id },
];
const runs = [{ id: 501, runType: "manual", triggeredBy: actor.id, status: "completed", reason: null, startedAt: stamp, completedAt: stamp, totalChecked: 2, successCount: 2, failureCount: 0, notFoundCount: 0, noKeyCount: 0, alertsCreated: 0, errorLog: [] }];
const event = { id: 601, entityType: "invoice", entityId: 301, eventType: "invoice_status_changed", actorType: "user", actorId: actor.id, actorName: "LogFixture Actor", createdAt: stamp, payloadJson: { invoiceNumber: "RISK-INV-FIXTURE", from: "docs_pending", to: "under_review", reason: "RISK-DETAIL-FIXTURE" } };
let chrome, ws, sequence = 0, stage = "start";
const pending = new Map(), errors = [], writes = [];
function fixture(url, method, raw) {
  const p = url.pathname;
  if (method !== "GET") {
    const body = raw ? JSON.parse(raw) : undefined; writes.push({ method, path: p, body });
    if (method === "PATCH" && p.startsWith("/api/credit-checks/")) {
      const row = checks.find(c => c.id === Number(p.split("/").pop())); Object.assign(row, body); return row;
    }
    if (method === "POST" && p === "/api/invoices/301/release") { held.splice(0); return { status: "under_review" }; }
    if (method === "POST" && p === "/api/authority-checks/run") return { runId: 501, status: "completed", total: 2, success: 2, notFound: 0, apiError: 0, noKey: 0, alertsCreated: 0, errors: [] };
    throw Error(`Unexpected write: ${method} ${p}`);
  }
  if (p === "/api/auth/verify") return { user: actor };
  if (p === "/api/auth/user" || p === "/api/user") return actor;
  if (p === "/api/auth/permissions") return { permissions: ["dashboard", "cb_reviews", "mc_check", "held", "logs", "invoices"] };
  if (p === "/api/credit-checks") return checks;
  if (p === "/api/debtors") return [];
  if (p === "/api/brokers") return [{ id: 7, name: "Risk Broker", mcNumber: "123456" }];
  if (p === "/api/held") return held;
  if (p === "/api/fmcsa/status") return { configured: true, maskedKey: "fixture-only", source: "environment" };
  if (p === "/api/authority-checks/latest") return authorities;
  if (p === "/api/authority-alerts") return [];
  if (p === "/api/authority-checks/integration-runs") return runs;
  if (p === "/api/fmcsa/entities/7/history") return { entityType: "broker", entityId: 7, entityName: "Risk Broker", checks: [authorities[0]] };
  if (p === "/api/audit/events") return [event];
  if (p.includes("unread") || p.endsWith("pending-count")) return { count: 0, unreadCount: 0 };
  return [];
}
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 150 && !fs.existsSync(`${profile}/DevToolsActivePort`); i++) await sleep(100);
  const port = fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(pages.find(p => p.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  ws.on("message", async raw => {
    const e = JSON.parse(raw);
    if (e.id) { const call = pending.get(e.id); pending.delete(e.id); if (call) e.error ? call.reject(e.error) : call.resolve(e.result); }
    if (e.method === "Runtime.exceptionThrown") errors.push(e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
    if (e.method !== "Fetch.requestPaused") return;
    const { requestId, request } = e.params;
    try { const result = fixture(new URL(request.url), request.method, request.postData); await cdp("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(result)).toString("base64") }); }
    catch (error) { errors.push(String(error)); await cdp("Fetch.fulfillRequest", { requestId, responseCode: 500, body: Buffer.from('{"message":"Fixture blocked request"}').toString("base64") }); }
  });
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(actor))});` });
  const evaluate = async expression => { const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const until = async expression => { for (let i = 0; i < 250; i++) { if (await evaluate(expression)) return; await sleep(100); } throw Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-1800)")}\n${errors.join("\n")}`); };
  const button = label => `Array.from(document.querySelectorAll("button")).find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
  const tab = label => `Array.from(document.querySelectorAll('[role="tab"]')).find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
  const click = async expression => {
    await evaluate(`(${expression}).scrollIntoView({block:"center",behavior:"instant"})`); await sleep(250);
    const point = await evaluate(`(()=>{const r=(${expression}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) }); await sleep(100);
  };
  const style = expression => evaluate(`(()=>{const s=getComputedStyle(${expression});return{radius:parseFloat(s.borderRadius),border:s.borderTopWidth,bg:s.backgroundColor,shadow:s.boxShadow}})()`);
  const visit = async (path, text) => {
    stage = path; await cdp("Page.navigate", { url: `http://127.0.0.1:5000${path}` });
    await until(`!!document.querySelector("main table") && document.body.innerText.includes(${JSON.stringify(text)})`);
    const s = await style(`document.querySelector("main .risk-neu-surface")`); assert(s.radius >= 16 && s.border === "0px", JSON.stringify(s));
  };
  await visit("/credit-checks", "Review Fixture 201");
  await click(button("Approve")); await until(`document.body.innerText.includes("Approved") && document.querySelectorAll('main button').length>0`);
  await until(`Array.from(document.querySelectorAll("main button")).filter(e=>e.textContent.trim()==="Approve").length===1`);
  await click(button("Decline")); await until(`!Array.from(document.querySelectorAll("main button")).some(e=>e.textContent.trim()==="Decline")`);
  assert.equal(checks[0].status, "approved"); assert.equal(checks[1].status, "declined");
  await click(button("New Check")); await until(`!!document.querySelector('[role="dialog"]')`);
  const dialog = await style(`document.querySelector('[role="dialog"]')`); assert(dialog.radius >= 16 && dialog.bg === "rgb(224, 224, 224)", JSON.stringify(dialog));
  const close = `Array.from(document.querySelectorAll('[role="dialog"] > button')).find(e=>e.querySelector(".sr-only")?.textContent==="Close")`;
  const x = await style(close); assert(x.radius >= 16 && x.border === "0px", JSON.stringify(x)); await click(close);
  await visit("/held", "RISK-HELD-FIXTURE"); await click(button("Release")); await until(`!!document.querySelector('[role="dialog"]')`);
  await click(button("Release Invoice")); await until(`!document.querySelector('[role="dialog"]')`); assert.equal(held.length, 0);
  await visit("/fmcsa-authority", "Risk Broker");
  const header = await style(`document.querySelector('main .risk-neu-surface > [class~="space-y-1.5"]')`);
  assert(header.border === "0px" && header.bg === "rgb(224, 224, 224)", JSON.stringify(header));
  const run = await style(button("Run now")); assert.equal(run.bg, "rgb(39, 170, 184)");
  await click(`document.querySelector('main button:has(svg.lucide-history)')`); await until(`document.body.textContent.includes("Check History — Risk Broker")`);
  const history = await style(`document.querySelector("main .risk-neu-pressed")`); assert(history.shadow.includes("inset"));
  await click(tab("Carriers")); await until(`!document.querySelector("main table tbody").innerText.includes("Risk Broker")`);
  await click(tab("Inactive")); assert.equal(await evaluate(`(${tab("Carriers")}).getAttribute("aria-selected")`), "true");
  await click(tab("Run History")); await until(`Array.from(document.querySelectorAll("main table")).some(e=>e.getClientRects().length && e.textContent.toLowerCase().includes("completed"))`);
  await click(tab("Alerts")); await until(`(${tab("Alerts")}).getAttribute("aria-selected")==="true" && !document.body.innerText.includes("CHECK HISTORY — RISK BROKER")`);
  await click(tab("Authority Status")); await until(`document.querySelector("main table").innerText.includes("Risk Carrier")`);
  assert.equal(await evaluate(`(${tab("Inactive")}).getAttribute("aria-selected")`), "true");
  await click(button("Run now")); await until(`document.body.innerText.includes("Run complete") || document.body.innerText.includes("Run Complete") || !!document.querySelector(".risk-neu-toast")`);
  await visit("/audit-log", "LogFixture Actor");
  await click(`document.querySelector('button[aria-label="Expand log details"]')`);
  await until(`!!document.querySelector(".ff-audit-detail")`);
  const detail = await style(`document.querySelector(".ff-audit-detail")`); assert(detail.shadow.includes("inset"), JSON.stringify(detail));
  await click(button("Refresh"));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await visit("/fmcsa-authority", "Risk Carrier");
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), "Mobile overflow");
  const screen = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/risk-neu-mobile.png", Buffer.from(screen.data, "base64"));
  assert.equal(writes.length, 4); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, pages: ["credit-checks", "held", "fmcsa-authority", "audit-log"], reviewDecisions: true, release: true, authorityFiltersAndTabs: true, history: true, logExpansion: true, mobile: true, realWrites: 0 }));
})().catch(error => { console.error(stage, error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
