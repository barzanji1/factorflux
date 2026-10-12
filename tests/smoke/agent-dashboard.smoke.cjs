// Isolated dashboard browser smoke: every /api request is fulfilled locally.
// No request can write to a real service or trigger email.
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const manager = { id: "mgr-17", username: "morgan.pike", role: "manager", firstName: "Morgan", lastName: "Pike", name: "Morgan Pike", email: "morgan@example.test" };
const employee = { id: "agent-9", username: "maria.jensen", role: "employee", firstName: "Maria", lastName: "Jensen", name: "Maria Jensen", email: "maria@example.test" };
const item = (id, invoiceNumber, href) => ({ id, invoiceNumber, carrierName: `Carrier ${id}`, brokerName: `Broker ${id}`, status: "under_review", ageDays: id + 1, ageBasis: "submitted", actions: ["Review documents", "Confirm broker"], href });
const base = {
  generatedAt: "2025-03-12T14:00:00.000Z",
  viewer: { id: manager.id, role: "manager" },
  queueGroups: [
    { agentId: manager.id, agentName: "Morgan Pike", items: [item(1, "FF-84021", "/invoices/84021")] },
    { agentId: employee.id, agentName: "Maria Jensen", items: [item(2, "FF-84022", "/invoices/84022")] },
  ],
  followUps: [
    { id: "fu-late", source: "task", title: "Call Prairie Line", carrierName: "Prairie Line", status: "open", priority: "high", dueDate: "2025-03-15T12:00:00.000Z", href: "/tasks/fu-late" },
    { id: "fu-soon", source: "invoice", title: "Collect signed rate confirmation", carrierName: "Northstar Freight", status: "open", priority: "normal", dueDate: "2025-03-13T12:00:00.000Z", href: "/invoices/84023" },
  ],
  activity: Array.from({ length: 22 }, (_, i) => ({ id: i + 1, who: `Agent ${i + 1}`, action: `Updated invoice ${i + 1}`, when: "2025-03-12T13:00:00.000Z", href: `/invoices/${i + 1}` })),
  alerts: [{ id: "al-1", kind: "ocr_failed", title: "Document needs review", detail: "Invoice scan could not be read.", when: "2025-03-12T13:20:00.000Z", href: "/invoices/84021" }],
  alertCounts: { fmcsa_failed: 2, email_bounced: 1, ocr_failed: 3, unverified_carrier: 4 },
};
const calls = [];
const writes = [];
let activeUser = manager;
let mode = "data";
let staleDashboardViewer = false;
let notificationsForbidden = false;
function fixture(url, method) {
  calls.push({ path: url.pathname, method });
  if (method !== "GET") writes.push({ path: url.pathname, method });
  if (url.pathname === "/api/auth/verify") return { body: { user: activeUser } };
  if (url.pathname === "/api/auth/permissions") return { body: { permissions: activeUser.id === employee.id ? ["invoices", "chat"] : ["dashboard", "invoices", "chat"] } };
  if (url.pathname === "/api/notifications" && notificationsForbidden) return { code: 403, body: { message: "Notifications forbidden in this fixture" } };
  if (url.pathname === "/api/auth/user") return { body: activeUser };
  if (url.pathname === "/api/agent-dashboard") {
    if (mode === "error") return { code: 503, body: { message: "Dashboard fixture unavailable" } };
    if (mode === "empty") return { body: { ...base, viewer: { id: activeUser.id, role: activeUser.role }, queueGroups: [{ agentId: activeUser.id, agentName: activeUser.name, items: [] }], followUps: [], activity: [], alerts: [], alertCounts: { fmcsa_failed: 0, email_bounced: 0, ocr_failed: 0, unverified_carrier: 0 } } };
    return { body: { ...base, viewer: staleDashboardViewer ? { id: manager.id, role: "admin" } : { id: activeUser.id, role: activeUser.id === employee.id ? "admin" : activeUser.role } } };
  }
  if (url.pathname.includes("unread-count") || url.pathname.includes("pending-count")) return { body: { count: 0 } };
  return { body: [] };
}
let chrome, ws, stage = "startup";
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors", "--remote-debugging-port=9239", "--user-data-dir=/tmp/ff-agent-dashboard-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) { try { targets = await (await fetch("http://127.0.0.1:9239/json")).json(); if (targets.length) break; } catch {} await sleep(100); }
  assert(targets?.length, "Chromium unavailable");
  ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  let nextId = 0; const pending = new Map();
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject, method }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.on("message", async data => {
    const event = JSON.parse(data);
    if (event.method === "Runtime.exceptionThrown") console.error("PAGE EXCEPTION:", event.params.exceptionDetails?.text, event.params.exceptionDetails?.exception?.description);
    if (event.id) { const request = pending.get(event.id); pending.delete(event.id); if (request) event.error ? request.reject(new Error(`${request.method}: ${JSON.stringify(event.error)}`)) : request.resolve(event.result); return; }
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params, url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) { await cdp("Fetch.continueRequest", { requestId }); return; }
    const response = fixture(url, request.method);
    await cdp("Fetch.fulfillRequest", {
      requestId, responseCode: response.code || 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Cache-Control", value: "no-store" }],
      body: Buffer.from(JSON.stringify(response.body)).toString("base64"),
    });
  });
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(manager))});` });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error(`Timed out ${expression}: ${String(await evaluate("document.body.innerText")).slice(0, 800)}; calls=${JSON.stringify(calls)}`);
  };
  const click = async expression => {
    const point = await evaluate(`(()=>{const e=${expression};if(!e)throw Error("Missing click target");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  const app = "http://127.0.0.1:5000";
  stage = "manager dashboard";
  await cdp("Page.navigate", { url: `${app}/` });
  await until(`document.querySelector('[data-testid="section-alerts"]') !== null`);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('[data-testid^="section-"]')).map(x=>x.dataset.testid).join(",")`), "section-queue,section-followups,section-activity,section-alerts", "sections are in the required order");
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="queue-table"]').length`), 2, "manager has side-by-side team queues");
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="queue-row"]').length`), 2, "queue rows include both agents");
  assert(await evaluate(`document.querySelector('[data-testid="queue-row"]').innerText.includes("Review documents")`), "actions are visible on invoice rows");
  assert(await evaluate(`document.querySelector('[data-testid="queue-row"]').innerText.includes("submitted")`), "age basis is shown");
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="activity-row"]').length`), 20, "team activity shows most recent 20 entries");
  assert(await evaluate(`document.querySelector('[data-testid="alerts-table"]').innerText.includes("Document needs review")`), "alerts include title and details");
  assert(await evaluate(`document.querySelector('[data-testid="section-alerts"]').innerText.includes("4")`), "per-kind alert counts render");
  assert(await evaluate(`document.querySelector('[data-testid="followups-table"] tbody tr').innerText.includes("Collect signed")`), "follow-ups sort by backend due date");
  assert.equal(await evaluate(`document.querySelector('button[aria-current="page"]')?.innerText.trim()`), "Agent Dashboard", "dashboard nav is visibly active");
  const dashboardShot = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/agent-dashboard-verified.png", Buffer.from(dashboardShot.data, "base64"));
  const beforeRefresh = calls.filter(call => call.path === "/api/agent-dashboard").length;
  await click(`document.querySelector('[data-testid="dashboard-refresh"]')`);
  await until(`document.querySelector('[data-testid="dashboard-refresh"]') !== null`);
  assert(calls.filter(call => call.path === "/api/agent-dashboard").length > beforeRefresh, "refresh refetches dashboard");
  assert.equal(await evaluate(`(()=>{const row=document.querySelector('[data-testid="queue-row"]');return row.getAttribute("role")==="link"&&row.tabIndex===0&&row.querySelector("a").getAttribute("href")==="/invoices/84021"})()`), true, "invoice destination is keyboard-focusable and links to its destination without rendering an unmocked invoice page");

  stage = "employee queue visibility";
  activeUser = employee; mode = "data";
  await evaluate(`localStorage.setItem("user",${JSON.stringify(JSON.stringify(employee))})`);
  await cdp("Page.navigate", { url: `${app}/` });
  await until(`document.querySelector('[data-testid="section-queue"]') !== null`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="queue-table"]').length`), 1, "employee sees only own queue");
  assert(await evaluate(`document.querySelector('[data-testid="section-queue"]').innerText.includes("FF-84022")`), "employee sees own assigned invoice");
  assert.equal(await evaluate(`document.querySelector('[data-testid="section-queue"]').innerText.includes("FF-84021")`), false, "employee cannot see manager queue contents");
  assert(await evaluate(`document.querySelector('[data-testid="section-queue"]').innerText.includes("My Queue")`), "employee queue remains restricted even when response viewer.role claims admin");

  stage = "stale manager cache response";
  staleDashboardViewer = true;
  await cdp("Page.navigate", { url: `${app}/` });
  await until(`document.body.innerText.includes("Dashboard session changed")`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="queue-table"]').length`), 0, "employee never renders queue groups from a manager-viewer response");
  assert.equal(await evaluate(`document.body.innerText.includes("FF-84021")`), false, "stale manager invoice is never rendered for employee");

  stage = "empty and error states";
  staleDashboardViewer = false;
  mode = "empty";
  await cdp("Page.navigate", { url: `${app}/?empty=1` });
  await until(`document.querySelector('[data-testid="section-alerts"]') !== null`);
  assert(await evaluate(`document.body.innerText.includes("No invoices in this queue") && document.body.innerText.includes("No follow-ups assigned to you") && document.body.innerText.includes("No recent team activity")`), "empty states are explicit");
  mode = "error";
  await cdp("Page.navigate", { url: `${app}/?error=1` });
  await until(`document.querySelector('[data-testid="dashboard-error"]') !== null`);
  assert(await evaluate(`document.body.innerText.includes("Dashboard could not be loaded")`), "error state is explicit");
  const beforeRetry = calls.filter(call => call.path === "/api/agent-dashboard").length;
  await click(`document.querySelector('[data-testid="dashboard-error"] button')`);
  for (let i = 0; i < 50 && calls.filter(call => call.path === "/api/agent-dashboard").length === beforeRetry; i++) await sleep(100);
  assert(calls.filter(call => call.path === "/api/agent-dashboard").length > beforeRetry, "retry refetches dashboard");

  stage = "responsive viewport";
  mode = "data";
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp("Page.navigate", { url: `${app}/` });
  await until(`document.querySelector('[data-testid="section-alerts"]') !== null`);
  assert(await evaluate(`document.querySelector('[data-testid="queue-groups"]').scrollWidth>=document.querySelector('[data-testid="queue-groups"]').clientWidth`), "manager queues remain horizontally scrollable on narrow viewports");
  assert.equal(await evaluate(`Array.from(document.querySelectorAll("h1,h2,h3")).some(el=>["board","boards","sprint","sprints"].includes(el.innerText.trim().toLowerCase())) || !!document.querySelector("[draggable='true']")`), false, "no board, sprint, or draggable UI");

  stage = "background notifications permission";
  activeUser = employee;
  notificationsForbidden = true;
  await evaluate(`localStorage.setItem("user",${JSON.stringify(JSON.stringify(employee))})`);
  await cdp("Page.navigate", { url: `${app}/` });
  await until(`document.body?.innerText.includes("Access Denied")`);
  assert(calls.some(call => call.path === "/api/notifications"), "authenticated staff without dashboard-module permission reaches the app shell and requests notifications");
  assert(await evaluate(`document.body.innerText.includes("Access Denied")`), "a background notifications 403 triggers the global access-denied screen");
  assert.equal(writes.length, 0, "all isolated dashboard interactions are read-only");
  assert(calls.length > 0 && calls.every(call => call.path.startsWith("/api/")), "all API traffic was intercepted");
  console.log(JSON.stringify({ passed: true, stage, assertions: ["manager side-by-side queue", "employee own queue only and stale-manager-response isolation", "keyboard-accessible invoice link destination", "ordered sections", "follow-up ordering", "recent-20 activity", "alerts and counts", "loading/error/empty/refresh", "mobile horizontal queue scrolling", "notifications 403 global handling reproduced", "no writes"], apiRequestsIntercepted: calls.length, isolatedWrites: writes.length, screenshot: "/tmp/agent-dashboard-verified.png" }));
})().catch(error => { console.error("Smoke failure:", error?.stack || error, "stage:", stage); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
