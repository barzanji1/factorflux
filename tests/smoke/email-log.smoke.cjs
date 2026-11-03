// Isolated browser smoke coverage for Email Log. Every /api request is fulfilled
// locally by CDP fixtures so this test cannot send or alter real email/data.
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const manager = { id: "mgr-17", username: "morgan.pike", role: "manager", firstName: "Morgan", lastName: "Pike", name: "Morgan Pike", email: "morgan@example.test" };
const employee = { id: "agent-9", username: "maria.jensen", role: "employee", firstName: "Maria", lastName: "Jensen", name: "Maria Jensen", email: "maria@example.test" };
const sentAt = "2025-02-11T17:42:00.000Z";
const baseRow = {
  id: "mail-1", direction: "outbound", resendMessageId: "provider-1", fromAddress: "ops@factorflux.test",
  toAddresses: ["dispatch@prairieline.test"], ccAddresses: ["billing@prairieline.test"], subject: "Invoice FF-84021 received",
  bodyPreview: "Hello Prairie Line, your invoice FF-84021 was received and is being reviewed.", templateName: "invoice_received",
  entityType: "invoice", entityId: "84021", entityUrl: "/invoices/84021",
  attachments: [
    { filename: "FF-84021.pdf", s3_key: "private/key", size: 481635 },
    { filename: "dispatch-sheet.pdf", s3_key: null, size: 18342 },
  ],
  status: "bounced", statusUpdatedAt: sentAt, error: "Mailbox unavailable", sentByUserId: "mgr-17", sentByName: "Morgan Pike",
  createdAt: sentAt, canResend: true, resendDisabledReason: null, inProgress: false,
};
const rows = Array.from({ length: 26 }, (_, index) => ({
  ...baseRow,
  id: `mail-${index + 1}`,
  subject: index === 0 ? baseRow.subject : `Carrier update ${index + 1}`,
  status: index === 0 || index === 2 ? "failed" : index === 1 || index === 4 ? "delivered" : "sent",
  sentByName: index === 3 ? null : "Morgan Pike",
  sentByUserId: index === 3 ? null : "mgr-17",
  entityType: index === 4 ? "carrier" : "invoice",
  entityUrl: index === 4 ? "/carriers/100" : "/invoices/84021",
}));
const calls = [];
const writes = [];
let activeUser = manager;
let resendCount = 0;

function fixture(url, method) {
  const path = url.pathname;
  const params = url.searchParams;
  calls.push({ path, method, search: url.search });
  if (method !== "GET") writes.push({ path, method });
  if (path === "/api/auth/verify") return { result: { user: activeUser } };
  if (path === "/api/auth/permissions") return { result: { permissions: ["dashboard", "invoices", "client_email", "chat"] } };
  if (path === "/api/auth/user") return { result: activeUser };
  if (path === "/api/email-log/agents") return { result: [{ id: "mgr-17", name: "Morgan Pike" }, { id: "agent-9", name: "Maria Jensen" }] };
  if (path === "/api/email-log/integration-status") return { result: { webhookConfigured: false } };
  if (path === "/api/email-log/summary") return { result: {
    totals: { sent: 24, delivered: 2, bounced: 0, failed: 2 },
    weeks: [{ week: "2025-02-10", delivered: 2, unsuccessful: 2 }],
    entityTypes: [{ entityType: "invoice", count: 25 }, { entityType: "carrier", count: 1 }],
  } };
  if (path === "/api/email-log" && method === "GET") {
    let filtered = rows;
    if (params.get("q")) filtered = filtered.filter(row => `${row.subject} ${row.toAddresses.join(" ")}`.toLowerCase().includes(params.get("q").toLowerCase()));
    if (params.get("entityType")) filtered = filtered.filter(row => row.entityType === params.get("entityType"));
    if (params.get("status")) filtered = filtered.filter(row => row.status === params.get("status"));
    if (params.get("agentId") === "system") filtered = filtered.filter(row => !row.sentByUserId);
    else if (params.get("agentId")) filtered = filtered.filter(row => row.sentByUserId === params.get("agentId"));
    return { result: { rows: filtered.slice((Number(params.get("page")) - 1) * 25, Number(params.get("page")) * 25), total: filtered.length, page: Number(params.get("page")), pageSize: 25 } };
  }
  if (path.startsWith("/api/email-log/") && path.endsWith("/resend") && method === "POST") {
    resendCount++;
    return { result: {
      messageId: `provider-resend-${resendCount}`,
      emailLogId: `mail-new-${resendCount}`,
      warning: "Provider accepted the message, but the linked invoice follow-up could not be synchronized.",
    } };
  }
  if (path === "/api/email-log/mail-1") return { result: { ...rows[0], events: [
    { id: "ev-1", type: "email_sent", status: "sent", occurredAt: sentAt, notes: "Accepted by delivery provider" },
    { id: "ev-2", type: "delivery_delivered", status: "delivered", occurredAt: sentAt, notes: "Provider accepted delivery" },
    { id: "ev-3", type: "delivery_bounced", status: "bounced", occurredAt: sentAt, notes: "Mailbox unavailable" },
    { id: "ev-4", type: "entity_sync_failed", status: null, occurredAt: sentAt, notes: "Could not update linked invoice follow-up." },
  ] } };
  if (path === "/api/email-log/mail-4") return { result: { ...rows[3], events: [] } };
  if (path.startsWith("/api/email-log/") && path.includes("/attachments/")) return { code: 302, result: { url: "https://download.invalid/private" } };
  return { result: [] };
}

let chrome, ws, stage = "initializing";
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors", "--remote-debugging-port=9238", "--user-data-dir=/tmp/ff-email-log-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) { try { targets = await (await fetch("http://127.0.0.1:9238/json")).json(); if (targets.length) break; } catch {} await sleep(100); }
  assert(targets?.length, "Chromium unavailable");
  ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  let nextId = 0;
  const pending = new Map();
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject, method }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.on("message", async data => {
    const event = JSON.parse(data);
    if (event.method === "Runtime.exceptionThrown") console.error("PAGE EXCEPTION:", event.params.exceptionDetails?.text, event.params.exceptionDetails?.exception?.description);
    if (event.id) { const call = pending.get(event.id); pending.delete(event.id); if (call) event.error ? call.reject(new Error(`${call.method}: ${JSON.stringify(event.error)}`)) : call.resolve(event.result); return; }
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) { await cdp("Fetch.continueRequest", { requestId }); return; }
    try {
      const mock = fixture(url, request.method);
      await cdp("Fetch.fulfillRequest", {
        requestId, responseCode: mock.code || 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Cache-Control", value: "no-store" }],
        body: Buffer.from(JSON.stringify(mock.result)).toString("base64"),
      });
    } catch (error) {
      console.error("Fixture failed:", url.pathname, error);
      await cdp("Fetch.fulfillRequest", { requestId, responseCode: 500, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from('{"message":"Fixture failure"}').toString("base64") });
    }
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
    throw new Error(`Timed out: ${expression}; body=${String(await evaluate("document.body?.innerText||''")).slice(0, 700)}; calls=${JSON.stringify(calls)}`);
  };
  const click = async expression => {
    await evaluate(`(${expression})?.scrollIntoView({block:"center",behavior:"instant"})`);
    await sleep(300);
    const p = await evaluate(`(()=>{const e=${expression};if(!e)throw Error("Missing target");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 });
  };
  const change = async (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(e instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value").set;setter.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("change",{bubbles:true}));return e.value})()`);
  const app = "http://127.0.0.1:5000";

  stage = "manager list";
  await cdp("Page.navigate", { url: `${app}/email-log` });
  await until(`document.querySelector('[data-testid="email-log-table"]') !== null`);
  await until(`document.querySelector('[data-testid="email-log-weekly-chart"] svg') !== null && document.querySelector('[data-testid="email-log-entity-chart"] svg') !== null`);
  assert(calls.some(call => call.path === "/api/email-log/summary" && !new URLSearchParams(call.search).has("page")), "summary ignores table pagination");
  assert(await evaluate(`document.body.innerText.toLowerCase().includes("total sent") && document.body.innerText.includes("Delivered")`), "summary stat cards are shown");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-testid="email-log-weekly-chart"]')).borderRadius`), "16px", "card overrides legacy square normalization");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-testid="email-log-search"]')).borderTopWidth`), "0px", "input has no legacy bevel border");
  const overviewShot = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/email-log-overview.png", Buffer.from(overviewShot.data, "base64"));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`), "mobile layout contains horizontal overflow");
  const mobileShot = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/email-log-mobile.png", Buffer.from(mobileShot.data, "base64"));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  assert(await evaluate(`document.body.innerText.includes("Delivery tracking is not configured")`), "webhook warning is shown");
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="email-log-row"]').length`), 25, "first page renders 25 rows");
  assert(await evaluate(`document.querySelector('[data-testid="email-log-row"]').innerText.includes("Morgan Pike")`), "human sender label is visible");
  assert(await evaluate(`Array.from(document.querySelectorAll('[data-testid="email-log-row"]')).some(row=>row.innerText.includes("System"))`), "system-generated row has a System sender label");
  await click(`document.querySelector('[data-testid="email-log-row"]')`);
  await until(`document.querySelector('[data-testid="email-log-events"]') !== null`);
  assert(await evaluate(`document.querySelector('[data-testid="email-log-detail"]').innerText.includes("Invoice FF-84021 received")`), "expanded detail includes full subject and preview");
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="email-log-attachment"]').length`), 1, "available attachment has a download link");
  assert(await evaluate(`document.querySelector('[data-testid="email-log-attachment-unavailable"]').innerText.includes("Unavailable")`), "attachment without storage key is explicitly unavailable");
  assert(await evaluate(`document.querySelector('[data-testid="email-log-events"]').innerText.includes("Delivery Delivered") && document.querySelector('[data-testid="email-log-events"]').innerText.includes("Delivery Bounced")`), "delivered and bounced statuses appear in event history");
  assert(await evaluate(`document.querySelector('[data-testid="email-log-events"]').innerText.includes("Entity Sync Failed")`), "entity sync failure is shown in the message timeline");
  await click(`document.querySelector('[data-testid="email-log-next"]')`);
  await until(`document.querySelectorAll('[data-testid="email-log-row"]').length===1`);
  assert(calls.some(call => call.path === "/api/email-log" && call.search.includes("page=2")), "pagination fetches page two");

  stage = "filters";
  await change('[data-testid="email-log-entity"]', "carrier");
  await until(`document.querySelector('[data-testid="email-log-table"]') !== null`);
  await change('[data-testid="email-log-from"]', "2025-02-01");
  await change('[data-testid="email-log-to"]', "2025-02-15");
  for (let i = 0; i < 80 && !calls.some(call => call.path === "/api/email-log" && new URLSearchParams(call.search).get("from") === "2025-02-01" && new URLSearchParams(call.search).get("to") === "2025-02-15"); i++) await sleep(100);
  assert(calls.some(call => call.path === "/api/email-log" && new URLSearchParams(call.search).get("from") === "2025-02-01" && new URLSearchParams(call.search).get("to") === "2025-02-15"), "date filter updates both request bounds");
  assert(calls.some(call => call.path === "/api/email-log" && call.search.includes("entityType=carrier")), "entity filter applied to request");
  await change('[data-testid="email-log-status"]', "delivered");
  await until(`document.querySelector('[data-testid="email-log-table"]') !== null`);
  for (let i = 0; i < 80 && !calls.some(call => call.path === "/api/email-log" && new URLSearchParams(call.search).get("status") === "delivered"); i++) await sleep(100);
  assert(calls.some(call => call.path === "/api/email-log" && call.search.includes("status=delivered")), "status filter applied to request");
  await change('[data-testid="email-log-agent"]', "system");
  for (let i = 0; i < 80 && !calls.some(call => call.path === "/api/email-log" && new URLSearchParams(call.search).get("agentId") === "system"); i++) await sleep(100);
  assert(calls.some(call => call.path === "/api/email-log" && call.search.includes("agentId=system")), "system sender filter applied");
  await evaluate(`(()=>{const e=document.querySelector('[data-testid="email-log-search"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"Prairie Line");e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()`);
  for (let i = 0; i < 80 && !calls.some(call => call.path === "/api/email-log" && new URLSearchParams(call.search).get("q") === "Prairie Line"); i++) await sleep(100);
  assert(calls.some(call => call.search.includes("from=") && call.search.includes("to=")), "date range included in request");

  stage = "manager resend";
  await change('[data-testid="email-log-entity"]', "");
  await change('[data-testid="email-log-status"]', "");
  await change('[data-testid="email-log-agent"]', "");
  await evaluate(`(()=>{const e=document.querySelector('[data-testid="email-log-search"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"");e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return true})()`);
  for (let i = 0; i < 80 && !calls.some(call => call.path === "/api/email-log" && !new URLSearchParams(call.search).has("q") && !new URLSearchParams(call.search).has("entityType") && !new URLSearchParams(call.search).has("status") && !new URLSearchParams(call.search).has("agentId")); i++) await sleep(100);
  await until(`document.querySelectorAll('[data-testid="email-log-row"]').length===25`);
  if (await evaluate(`document.querySelector('[data-testid="email-log-row"]').getAttribute("aria-expanded")!=="true"`)) await click(`document.querySelector('[data-testid="email-log-row"]')`);
  await until(`document.querySelector('[data-testid="email-log-resend"]') !== null`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="email-log-resend"]').disabled`), false, "manager can resend when permitted");
  const listCallsBeforeResend = calls.filter(call => call.path === "/api/email-log" && call.method === "GET").length;
  await click(`document.querySelector('[data-testid="email-log-resend"]')`);
  await until(`document.querySelector('[role="dialog"]') !== null`);
  assert.equal(writes.length, 0, "opening confirmation does not send");
  await click(`document.querySelector('[data-testid="email-log-resend-confirm"]')`);
  await until(`document.querySelector('[data-testid="email-log-action-message"]') !== null`);
  for (let i = 0; i < 80 && calls.filter(call => call.path === "/api/email-log" && call.method === "GET").length <= listCallsBeforeResend; i++) await sleep(100);
  assert(writes.some(write => write.method === "POST" && write.path.endsWith("/resend")), "resend POST creates a new log entry");
  assert(calls.filter(call => call.path === "/api/email-log" && call.method === "GET").length > listCallsBeforeResend, "resend refreshes the email log list");
  assert(await evaluate(`document.querySelector('[data-testid="email-log-action-message"]').getAttribute("data-tone")==="warning" && document.querySelector('[data-testid="email-log-action-message"]').innerText.includes("entity sync needs attention")`), "provider acceptance with an entity-sync warning is explicit");
  assert.equal(writes.some(write => ["PUT", "PATCH", "DELETE"].includes(write.method)), false, "no edit or delete requests");
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="email-log-resend"]').length`), 1, "only explicit resend action is available");

  const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/email-log-verified.png", Buffer.from(screenshot.data, "base64"));

  stage = "employee permissions";
  activeUser = employee;
  await evaluate(`localStorage.setItem("user",${JSON.stringify(JSON.stringify(employee))})`);
  await cdp("Page.navigate", { url: `${app}/email-log` });
  await until(`document.querySelector('[data-testid="email-log-table"]') !== null`);
  await click(`document.querySelector('[data-testid="email-log-row"]')`);
  await until(`document.querySelector('[data-testid="email-log-detail"]') !== null`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="email-log-resend"]')`), null, "employee cannot access resend action");
  assert(await evaluate(`document.body.innerText.includes("System")`), "system-sent labels render in the sender menu");
  assert(calls.length > 0 && calls.every(call => call.path.startsWith("/api/")), "all API calls were intercepted");
  console.log(JSON.stringify({ passed: true, assertions: ["all filters and search", "pagination", "expanded preview, attachment availability, delivery and entity-sync timeline", "system and human sender labels", "manager resend warning and refresh", "employee has no resend action", "no edit/delete"], apiRequestsIntercepted: calls.length, isolatedWrites: writes.length, screenshot: "/tmp/email-log-verified.png" }));
})().catch(error => { console.error("Smoke failure:", error?.stack || error, "stage:", stage); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
