// Built UI + isolated API fixtures only. No real invoices, mail, or bell notifications.
const { spawn } = require("node:child_process");
const { createServer } = require("node:http");
const fs = require("node:fs");
const { resolve, extname } = require("node:path");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { ALL_PERMISSIONS } = require("../../shared/schema.ts");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, ws, server;
(async () => {
  let actor = { id: "collections-admin", role: "admin", firstName: "Collections", lastName: "Fixture", status: "active" };
  const config = { enabled: false, mode: "dry_run", updatedAt: "2026-10-21T00:00:00Z", canManage: true };
  const row = id => ({ invoiceId: id, invoiceNumber: `INV-FIXTURE-${id}`, loadNumber: `LOAD-${id}`, broker: "Fixture Broker",
    carrier: "Fixture Carrier", phase: "vp", mode: "dry_run", paused: false, escalatedPhase: null,
    vpAttempts: 1, rpsAttempts: 0, nextActionAt: "2026-10-23T00:00:00Z", vpConfirmedAt: null, paidAt: null,
    fundedAt: "2026-10-19T00:00:00Z", lastError: null, canManage: true });
  const rows = [row(101), row(102)];
  const writes = [], errors = [];
  const api = (url, method, body) => {
    const path = url.pathname;
    if (method !== "GET") writes.push({ path, body });
    if (path === "/api/auth/verify") return { user: actor, ...actor };
    if (path === "/api/auth/user") return actor;
    if (path === "/api/auth/permissions") return { permissions: [...ALL_PERMISSIONS] };
    if (path === "/api/user/permissions") return { permissions: ALL_PERMISSIONS.map(module => ({ module, canView: true, canCreate: true, canEdit: true, canDelete: true })) };
    if (path === "/api/broker-collections/settings") {
      if (method === "PATCH") {
        if (body.enabled && body.mode === "live") assert.equal(body.confirmLive, true);
        Object.assign(config, { enabled: body.enabled, mode: body.mode });
      }
      return { ...config, canManage: actor.role === "admin" };
    }
    if (path === "/api/broker-collections/run") return { checked: 2, processed: 1, errors: [], disabled: !config.enabled };
    if (path === "/api/broker-collections") {
      const phase = url.searchParams.get("phase"), q = url.searchParams.get("q");
      const selected = rows.filter(r => (!phase || (phase === "paused" ? r.paused : r.phase === phase)) && (!q || r.invoiceNumber.includes(q)));
      return { rows: selected.map(r => ({ ...r, canManage: actor.role === "admin" })), total: selected.length, page: 1, pageSize: 50, settings: { ...config, canManage: actor.role === "admin" } };
    }
    const match = path.match(/^\/api\/broker-collections\/(\d+)(\/action)?$/);
    if (match) {
      const r = rows.find(r => r.invoiceId === Number(match[1]));
      if (method === "POST") {
        if (body.action === "vp_confirmed") Object.assign(r, { phase: "rps", vpConfirmedAt: "2026-10-21T00:00:00Z" });
        if (body.action === "paid") Object.assign(r, { phase: "paid", nextActionAt: null, paidAt: "2026-10-21T00:00:00Z" });
        if (body.action === "pause") r.paused = true;
        if (body.action === "resume") r.paused = false;
        if (body.action === "stop") { r.phase = "stopped"; r.nextActionAt = null; }
        if (body.action === "start_live") { assert.equal(body.confirmLive, true); r.mode = "live"; }
      }
      return { row: { ...r, canManage: actor.role === "admin" }, events: [{
        id: 1, step: "vp_1", phase: "vp", mode: "dry_run", outcome: "simulated",
        scheduledAt: "2026-10-21T00:00:00Z", occurredAt: "2026-10-21T00:00:00Z",
        recipient: "broker@example.test", providerMessageId: null, error: null, details: { wouldSendEmail: true, wouldNotifyAlan: false },
      }] };
    }
    if (path.endsWith("unread-count")) return { count: 0 };
    if (path === "/api/notifications") return [];
    return [];
  };
  const root = resolve("dist/public");
  server = createServer((request, response) => {
    const path = new URL(request.url, "http://fixture").pathname;
    if (path.startsWith("/api/")) throw new Error("An API request escaped fixture interception");
    let file = resolve(root, "." + path);
    try { if (!file.startsWith(root + "/") || !fs.statSync(file).isFile()) file = resolve(root, "index.html"); }
    catch { file = resolve(root, "index.html"); }
    response.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png" })[extname(file)] ?? "application/octet-stream");
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9248",
    "--user-data-dir=/tmp/ff-broker-collections-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) { try { targets = await (await fetch("http://127.0.0.1:9248/json")).json(); if (targets.length) break; } catch {} await sleep(100); }
  assert(targets?.length);
  ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  let seq = 0; const pending = new Map();
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  ws.on("message", async raw => {
    const event = JSON.parse(raw);
    if (event.id) { const p = pending.get(event.id); pending.delete(event.id); if (p) event.error ? p.reject(event.error) : p.resolve(event.result); }
    if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text + " " + (event.params.exceptionDetails.exception?.description ?? ""));
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const result = api(new URL(request.url), request.method, request.postData ? JSON.parse(request.postData) : {});
    await cdp("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(result)).toString("base64") });
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  const evaluate = async expression => {
    const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
  };
  const until = async expression => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); } throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-7000)")}\n${JSON.stringify(errors)}`); };
  const button = text => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const click = async expression => {
    await until(`!!(${expression})`); await evaluate(`(${expression}).scrollIntoView({block:"center"})`); await sleep(200);
    const point = await evaluate(`(()=>{const r=(${expression}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  let injection;
  const login = async role => {
    actor = { ...actor, role }; if (injection) await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection });
    injection = (await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.clear();localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(actor))})` })).identifier;
    await cdp("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/follow-up` });
    await until(`!!document.querySelector('[data-testid="collections-automation"]') && document.body.innerText.includes("INV-FIXTURE-101")`);
  };
  await login("admin");
  assert.equal(writes.length, 0, "loading must not change settings or send");
  assert(await evaluate(`document.body.innerText.includes("Global automation is off.")`));
  await click(button("Pause")); await until(`!!(${button("Resume")})`);
  await click(button("Resume")); await until(`!(${button("Resume")})`);
  await click(button("VP confirmed")); await until(`document.querySelector('tbody tr')?.innerText.includes("Awaiting payment")`);
  await click(button("Audit")); await until(`!!document.querySelector('[role="dialog"]') && document.body.innerText.includes("SIMULATED") && document.body.innerText.includes("broker@example.test")`);
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await until(`!document.querySelector('[role="dialog"]')`);
  await click(button("Paid")); await until(`document.body.innerText.includes("does not reconcile cash")`);
  const beforePaid = writes.length; assert(!writes.at(-1)?.body.action?.includes("paid"));
  await click(button("Confirm")); await until(`document.body.innerText.includes("Workflow paid") && !document.querySelector('[role="dialog"]')`);
  assert.equal(writes.length, beforePaid + 1);
  await click(`document.querySelector('[data-testid="collections-automation"] input[type="checkbox"]')`);
  await until(`document.body.innerText.includes("Automation is on")`);
  const beforeLive = writes.length;
  await evaluate(`(()=>{const e=document.querySelector('[aria-label="Global automation mode"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,"live");e.dispatchEvent(new Event("change",{bubbles:true}));})()`);
  await until(`document.body.innerText.includes("Enable live broker automation?")`);
  assert.equal(writes.length, beforeLive, "live selection requires confirmation");
  await click(button("Cancel")); await until(`!document.querySelector('[role="dialog"]')`);
  assert.equal(config.mode, "dry_run");
  fs.mkdirSync("generated-artifacts/broker-collections", { recursive: true });
  const shot = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("generated-artifacts/broker-collections/queue.png", Buffer.from(shot.data, "base64"));
  await login("employee");
  assert.equal(await evaluate(`!!document.querySelector('[aria-label="Global automation mode"]')`), false);
  assert.equal(await evaluate(`!!(${button("Run now")})`), false);
  assert.equal(await evaluate(`!!(${button("Start live…")})`), false);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click(button("Paid")); await until(`document.body.innerText.includes("Mark collection workflow paid?")`);
  assert(await evaluate(`(()=>{const r=document.querySelector('[role="dialog"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()`));
  const phone = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("generated-artifacts/broker-collections/mobile-confirm.png", Buffer.from(phone.data, "base64"));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, defaultQueue: true, scopedActions: true, pauseResume: true, vpConfirmation: true,
    paidRequiresConfirmation: true, simulationAudit: true, explicitLiveConfirmation: true, adminControlsOnly: true,
    mobileDialog: true, realEmails: 0, realNotifications: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { ws?.close(); browser?.kill("SIGTERM"); server?.close(); });
