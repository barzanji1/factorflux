// Isolated broker receipt UI smoke test. Every /api request is fulfilled by CDP fixtures;
// no request is allowed to reach the application API or create real follow-up/email activity.
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const manager = { id: "mgr-17", username: "morgan.pike", role: "manager", firstName: "Morgan", lastName: "Pike", name: "Morgan Pike", email: "morgan@example.test" };
const admin = { ...manager, id: "admin-1", username: "admin", role: "admin", firstName: "Ari", lastName: "Admin", name: "Ari Admin" };
const invoiceId = 84021;
const timestamp = "2025-02-11T17:42:00.000Z";
const confirmation = {
  invoiceId, status: "sent", sentAt: timestamp, confirmedAt: null, remindedCount: 1,
  assignedAgentId: null, assignedAgentName: null, emailOnFile: true,
  canReassign: true, canResend: true, canMarkConfirmed: true,
  events: [{ id: 1, event: "email_sent", actor: "Morgan Pike", notes: "Receipt request sent", createdAt: timestamp }],
};
const followUpTask = {
  id: 701, invoiceId, invoiceNumber: "FF-84021", brokerName: "Summit Freight Brokerage",
  title: "Broker has not confirmed receipt", description: "Confirm invoice delivery with broker.",
  priority: "urgent", status: "todo", dueDate: "2025-02-14T00:00:00.000Z",
  assignedTo: "mgr-17", agentName: "Morgan Pike", kind: "disputed", confirmationStatus: "disputed",
};
const settings = { maxReminders: 2, reminderDays: [3, 7, 14], publicBaseUrl: "https://confirm.factorflux.test" };
const calls = [];
const writeCalls = [];
let activeUser = manager;
let taskStatus = "todo";
let previewFixture = false;
let firstSendFixture = false;

function fixture(path, method, request) {
  const body = request.postData ? (() => { try { return JSON.parse(request.postData); } catch { return {}; } })() : {};
  calls.push({ path, method });
  if (method !== "GET") writeCalls.push({ path, method, body });
  if (path === "/api/auth/verify") return { result: { user: activeUser } };
  if (path === "/api/auth/permissions") return { result: { permissions: ["dashboard", "invoices", "followups", "reports", "settings", "admin"] } };
  if (path === "/api/auth/user") return { result: activeUser };
  if (path === `/api/invoices/${invoiceId}/detail`) return { result: {
    id: invoiceId, invoiceId, invoiceNumber: "FF-84021", loadNumber: "LD-84021",
    status: "funded", displayStatus: "funded", factoringStage: "collections",
    amount: "4816.35", paymentType: "ACH", submittedAt: "2025-02-10T00:00:00.000Z",
    client: { id: 100, name: "Prairie Line Hauling" }, broker: { id: 200, name: "Summit Freight Brokerage" },
    clientId: 100, brokerId: 200, documents: [], collections: [], cash: { applications: [] }, cashAppLines: [],
    exceptions: [], timeline: [], payout: { advanceAmount: "3901.23", feeAmount: "144.49", reserveAmount: "770.63" },
    chargeback: { status: "none", history: [], refunds: [], refundedAmount: 0, extension: null },
    collectionsDetail: { brokerFollowUps: [] }, brokerHistory: { invoices: [], credit: {} },
    pickupLocation: "Denver, CO", deliveryLocation: "Phoenix, AZ",
  } };
  if (path === `/api/invoices/${invoiceId}/broker-confirmation` && method === "GET") {
    const result = structuredClone(confirmation);
    result.deliveryNotice = previewFixture ? "Email sending is disabled in Preview until this build is published." : null;
    if (previewFixture) {
      result.status = "sent";
      result.confirmedAt = null;
      result.canResend = false;
      result.canMarkConfirmed = true;
    }
    if (firstSendFixture) {
      result.status = "pending";
      result.sentAt = null;
      result.remindedCount = 0;
      result.events = [];
    }
    return { result };
  }
  if (path === `/api/invoices/${invoiceId}/broker-confirmation/resend` && method === "POST") {
    confirmation.status = "sent";
    confirmation.sentAt = "2025-02-12T15:00:00.000Z";
    confirmation.remindedCount += 1;
    confirmation.events.push({ id: confirmation.events.length + 1, event: "email_resent", actor: activeUser.name, notes: "Receipt reminder sent", createdAt: confirmation.sentAt });
    return { result: { message: "Receipt request accepted" } };
  }
  if (path === `/api/invoices/${invoiceId}/broker-confirmation/mark-confirmed` && method === "POST") {
    if (typeof body.notes !== "string" || body.notes.trim().length < 3 || body.notes.length > 2000) return { code: 400, result: { message: "Notes must be 3–2000 characters" } };
    confirmation.status = "confirmed";
    confirmation.confirmedAt = "2025-02-12T15:18:00.000Z";
    confirmation.canMarkConfirmed = false;
    confirmation.canResend = false;
    confirmation.events.push({ id: confirmation.events.length + 1, event: "marked_confirmed", actor: activeUser.name, notes: body.notes, createdAt: confirmation.confirmedAt });
    return { result: { message: "Confirmation recorded" } };
  }
  if (path === `/api/invoices/${invoiceId}/broker-confirmation/assignment` && method === "PATCH") {
    confirmation.assignedAgentId = body.agentId || null;
    confirmation.assignedAgentName = body.agentId ? (body.agentId === "mgr-17" ? "Morgan Pike" : "Maria Jensen") : null;
    confirmation.events.push({ id: confirmation.events.length + 1, event: body.agentId ? "assignment_changed" : "assignment_cleared", actor: activeUser.name, notes: null, createdAt: new Date().toISOString() });
    return { result: { message: "Assignment updated" } };
  }
  if (path === `/api/invoices/${invoiceId}/broker-confirmation/agents`) return { result: [{ id: "mgr-17", name: "Morgan Pike" }, { id: "agent-9", name: "Maria Jensen" }] };
  if (path === "/api/confirmation-follow-ups") return { result: [{ ...followUpTask, status: taskStatus }] };
  if (path === `/api/confirmation-follow-ups/${followUpTask.id}` && method === "PATCH") {
    taskStatus = body.status;
    return { result: { ...followUpTask, status: taskStatus } };
  }
  if (path === "/api/broker-confirmation-settings" && method === "GET") return { result: structuredClone(settings) };
  if (path === "/api/broker-confirmation-settings" && method === "PATCH") {
    settings.maxReminders = body.maxReminders;
    settings.reminderDays = body.reminderDays;
    settings.publicBaseUrl = body.publicBaseUrl;
    return { result: structuredClone(settings) };
  }
  if (path === "/api/reports/confirmation-aging") return { result: [{
    invoiceId, invoiceNumber: "FF-84021", carrier: "Prairie Line Hauling", broker: "Summit Freight Brokerage",
    amount: 4816.35, outstanding: 912.4, ageDays: 7, fundedAt: "2025-02-05T18:20:00.000Z", confirmationStatus: "disputed",
  }] };
  if (path === "/api/reports/aging") return { result: Object.fromEntries(["0-30", "31-60", "61-90", "90+"].map(bucket => [bucket, { count: 0, total: 0, carriers: {}, brokers: {} }])) };
  if (path === "/api/payout-settings") return { result: { advanceRate: "80", feeRate: "3" } };
  if (path === "/api/invoices/preflight/settings") return { result: {
    rules: {}, dormantDays: 45, nearAmountTolerance: 1, nearServiceDateDays: 3,
  } };
  if (path === "/api/invoices/preflight/settings" && method === "PATCH") return { result: body };
  if (path === "/api/invoices/84021/available-transitions") return { result: [] };
  if (path === `/api/invoices/${invoiceId}/timeline`) return { result: [] };
  if (path === `/api/invoices/${invoiceId}/receipts`) return { result: [] };
  if (path === `/api/invoices/${invoiceId}/ocr-alerts`) return { result: { alerts: [] } };
  if (path === `/api/invoices/${invoiceId}/document-status`) return { result: { canApprove: true, missing: [] } };
  if (path === "/api/carriers/100/bank-accounts") return { result: [] };
  if (path === "/api/follow-ups") return { result: [] };
  if (path === "/api/follow-up-clients") return { result: [] };
  if (path === "/api/broker-follow-ups") return { result: [] };
  if (path === "/api/broker-follow-up-templates") return { result: [] };
  if (path === "/api/broker-follow-up-reminders/delivery-summary") return { result: { bounced: 0, failed: 0, spam: 0, total: 0 } };
  if (path === "/api/admin/users") return { result: [] };
  if (path === "/api/admin/doc-requirements") return { result: [] };
  if (path === "/api/admin/audit-log") return { result: [] };
  if (path === "/api/time-tracking/summary" || path === "/api/time-tracking/live") return { result: [] };
  if (path === "/api/carrier-portal/users" || path === "/api/carrier-portal/submissions") return { result: [] };
  if (path === "/api/reports/global") return { result: {} };
  return { result: [] };
}

let chrome, ws;
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
    "--remote-debugging-port=9235", "--user-data-dir=/tmp/ff-broker-confirmation-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9235/json")).json(); if (targets.length) break; } catch {}
    await sleep(100);
  }
  assert(targets?.length, "Chromium unavailable");
  ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  let nextId = 0;
  const pending = new Map();
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.on("message", async data => {
    const event = JSON.parse(data);
    if (event.method === "Runtime.exceptionThrown") console.error("PAGE EXCEPTION:", event.params.exceptionDetails?.text, event.params.exceptionDetails?.exception?.description);
    if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") console.error("PAGE CONSOLE ERROR:", event.params.args?.map(arg => arg.value ?? arg.description).join(" "));
    if (event.id) {
      const call = pending.get(event.id); pending.delete(event.id);
      if (call) event.error ? call.reject(event.error) : call.resolve(event.result);
      return;
    }
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      await cdp("Fetch.continueRequest", { requestId });
      return;
    }
    try {
      const mock = fixture(url.pathname, request.method, request);
      await cdp("Fetch.fulfillRequest", {
        requestId, responseCode: mock.code || 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Cache-Control", value: "no-store" }],
        body: Buffer.from(JSON.stringify(mock.result)).toString("base64"),
      });
    } catch (error) {
      console.error("API fixture failure:", url.pathname, error);
      await cdp("Fetch.fulfillRequest", { requestId, responseCode: 500,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify({ message: "Isolated fixture error" })).toString("base64") });
    }
  });
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Log.enable"); await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1024, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem("isAuthenticated","true");
    localStorage.setItem("user",${JSON.stringify(JSON.stringify(manager))});
  ` });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 160; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error(`Timed out: ${expression}; location=${await evaluate("location.href")}; body=${String(await evaluate("document.body?.innerText || ''")).slice(0, 700)}; api=${JSON.stringify(calls)}`);
  };
  const click = async selectorExpression => {
    const point = await evaluate(`(()=>{const e=${selectorExpression};if(!e)throw Error("Missing pointer target: "+${JSON.stringify(selectorExpression)});e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  const typeInto = async (selector, text) => {
    await click(`document.querySelector(${JSON.stringify(selector)})`);
    return evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));return e.value})()`);
  };
  const press = async (key, code = key) => {
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code });
  };
  const app = "http://127.0.0.1:5000";

  // Invoice confirmation panel and manager actions.
  await cdp("Page.navigate", { url: `${app}/invoices/${invoiceId}` });
  await until(`document.body?.innerText.includes("Load #LD-84021")`);
  await click(`Array.from(document.querySelectorAll('[role="tab"]')).find(e=>e.textContent.includes("Broker"))`);
  await until(`document.querySelector('[data-testid="broker-confirmation-panel"] [data-testid="confirmation-status-sent"]') !== null`);
  assert(await evaluate(`document.querySelector('[data-testid="broker-confirmation-panel"]').innerText.includes("2025")`), "sent timestamp should be visible");
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="confirmation-audit-event"]').length`), 1, "initial audit event is rendered");
  assert(await evaluate(`document.querySelector('[data-testid="confirmation-audit-event"]').innerText.includes("Receipt request sent")`), "audit notes visible");
  assert.equal(await evaluate(`document.querySelector('[data-testid="confirmation-mark-confirmed"]').disabled`), true, "phone confirmation requires notes before submission");

  await click(`document.querySelector('[data-testid="confirmation-resend"]')`);
  await until(`document.querySelectorAll('[data-testid="confirmation-audit-event"]').length===2 && document.querySelector('[data-testid="broker-confirmation-panel"]').innerText.includes("2")`);
  assert(writeCalls.some(call => call.path.endsWith("/resend") && call.method === "POST"), "resend POST issued");
  assert(await evaluate(`document.querySelector('[data-testid="broker-confirmation-panel"]').innerText.includes("Reminders recorded")`), "reminder summary remains visible");

  const agentSelect = `document.querySelector('[data-testid="confirmation-agent-select"]')`;
  await click(agentSelect); await press("ArrowDown", "ArrowDown"); await press("Enter", "Enter");
  await click(`document.querySelector('[data-testid="confirmation-assign"]')`);
  await until(`document.querySelector('[data-testid="broker-confirmation-panel"]').innerText.includes("Assigned agent") && document.querySelector('[data-testid="confirmation-agent-select"]').value==="mgr-17"`);
  assert(writeCalls.some(call => call.path.endsWith("/assignment") && call.body.agentId === "mgr-17"), "manager assignment PATCH issued");
  await click(agentSelect); await press("ArrowUp", "ArrowUp"); await press("Enter", "Enter");
  await click(`document.querySelector('[data-testid="confirmation-assign"]')`);
  await until(`document.querySelector('[data-testid="confirmation-agent-select"]').value==="" && document.querySelector('[data-testid="broker-confirmation-panel"]').innerText.includes("Unassigned")`);
  assert(writeCalls.some(call => call.path.endsWith("/assignment") && call.body.agentId === ""), "manager can clear assignment using empty agentId");

  const phoneNotes = "Called broker contact; Dana confirmed the invoice was received on Feb 12.";
  await typeInto('[data-testid="confirmation-notes"]', phoneNotes);
  assert.equal(await evaluate(`document.querySelector('[data-testid="confirmation-mark-confirmed"]').disabled`), false, "valid notes enable phone confirmation");
  await click(`document.querySelector('[data-testid="confirmation-mark-confirmed"]')`);
  await until(`document.querySelector('[data-testid="confirmation-status-confirmed"]')!==null`);
  assert(writeCalls.some(call => call.path.endsWith("/mark-confirmed") && call.body.notes === phoneNotes), "phone-confirmation POST includes required notes");
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="confirmation-audit-event"]').length`), 5, "audit history contains resend, assignment, clear, and confirmation events");
  const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/broker-confirmation-verified.png", Buffer.from(screenshot.data, "base64"));

  previewFixture = true;
  await cdp("Page.navigate", { url: `${app}/invoices/${invoiceId}` });
  await until(`document.body?.innerText.includes("Load #LD-84021")`);
  await click(`Array.from(document.querySelectorAll('[role="tab"]')).find(e=>e.textContent.includes("Broker"))`);
  await until(`document.querySelector('[data-testid="confirmation-delivery-notice"]')!==null`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="confirmation-resend"]').disabled`), true, "preview resend action is disabled");
  assert.equal(await evaluate(`document.querySelector('[data-testid="confirmation-resend"]').textContent.trim()`), "Resend");
  firstSendFixture = true;
  await click(`document.querySelector('[data-testid="confirmation-retry"]')`);
  await until(`document.querySelector('[data-testid="broker-confirmation-panel"]').textContent.includes("Not sent")`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="confirmation-resend"]').textContent.trim()`), "Send", "first send must not say Resend");
  assert.equal(await evaluate(`document.querySelector('[data-testid="confirmation-resend"]').disabled`), true, "first send also retains preview restriction");
  assert(await evaluate(`document.querySelector('[data-testid="confirmation-delivery-notice"]').innerText.includes("disabled in Preview")`), "preview delivery notice explains disabled resend");

  // A distinct operations category in Followups, with an actual status mutation.
  await cdp("Page.navigate", { url: `${app}/follow-up` });
  await until(`document.body?.innerText.includes("Followups")`);
  await click(`document.querySelector('[data-testid="confirmation-followups-tab"]')`);
  await until(`document.querySelector('[data-testid="confirmation-followup-row"]')!==null`);
  assert(await evaluate(`document.querySelector('[data-testid="confirmation-followup-row"]').innerText.toLowerCase().includes("urgent")`), "urgent priority is shown");
  assert(await evaluate(`document.querySelector('[data-testid="confirmation-followup-row"]').innerText.includes("Morgan Pike")`), "task assignment is shown");
  assert(await evaluate(`document.querySelector('[data-testid="confirmation-followup-invoice"]').getAttribute("href")==="/invoices/${invoiceId}"`), "task links to invoice detail");
  const taskSelect = `document.querySelector('[data-testid="confirmation-followup-status"]')`;
  await click(taskSelect); await press("ArrowDown", "ArrowDown"); await press("Enter", "Enter");
  await until(`document.querySelector('[data-testid="confirmation-followup-status"]').value==="in_progress"`);
  assert(writeCalls.some(call => call.path.endsWith(`/confirmation-follow-ups/${followUpTask.id}`) && call.body.status === "in_progress"), "follow-up task status PATCH issued");

  // Settings are kept in Admin > Factoring Settings; switch the isolated session to admin.
  activeUser = admin;
  await evaluate(`localStorage.setItem("user",${JSON.stringify(JSON.stringify(admin))})`);
  await cdp("Page.navigate", { url: `${app}/admin` });
  await until(`document.body?.innerText.includes("Admin Panel") || document.body?.innerText.includes("Team Settings") || document.body?.innerText.includes("Factoring Rate Configuration")`);
  await click(`Array.from(document.querySelectorAll('[role="tab"]')).find(e=>e.textContent.includes("Factoring Settings"))`);
  await until(`document.querySelector('[data-testid="confirmation-settings"]')!==null`);
  await typeInto('[data-testid="confirmation-max-reminders"]', "1");
  await typeInto('[data-testid="confirmation-reminder-day-1"]', "4");
  await typeInto('[data-testid="confirmation-public-url"]', "https://receipt.factorflux.test");
  await click(`document.querySelector('[data-testid="confirmation-settings-save"]')`);
  await until(`document.querySelector('[data-testid="confirmation-max-reminders"]').value==="1" && document.querySelector('[data-testid="confirmation-reminder-day-1"]').value==="4" && document.querySelector('[data-testid="confirmation-public-url"]').value==="https://receipt.factorflux.test"`);
  assert(writeCalls.some(call => call.path === "/api/broker-confirmation-settings" && call.method === "PATCH" && call.body.maxReminders === 1 && call.body.reminderDays.join(",") === "4,7,14" && call.body.publicBaseUrl === "https://receipt.factorflux.test"), "settings PATCH has edited values");

  // Aging preserves its report and adds a confirmation status column for funded balances.
  await cdp("Page.navigate", { url: `${app}/reports` });
  await until(`document.body?.innerText.includes("Reports")`);
  await click(`Array.from(document.querySelectorAll('[role="tab"]')).find(e=>e.textContent.trim()==="Aging")`);
  await until(`document.querySelector('[data-testid="confirmation-aging-row"]')!==null`);
  assert(await evaluate(`document.querySelector('[data-testid="confirmation-aging-table"]').innerText.toLowerCase().includes("confirmation status")`), "Aging has a confirmation status column");
  assert(await evaluate(`document.querySelector('[data-testid="confirmation-aging-row"]').innerText.toLowerCase().includes("disputed")`), "Aging row renders disputed status");
  assert(await evaluate(`document.querySelector('[data-testid="confirmation-aging-row"] a').getAttribute("href")==="/invoices/${invoiceId}"`), "Aging invoice links to detail");

  assert(calls.length > 0 && calls.every(call => call.path.startsWith("/api/")), "all API calls were intercepted");
  assert.equal(writeCalls.length, 6, "only isolated resend, assignment, unassignment, confirmation, task, and settings writes occurred");
  console.log(JSON.stringify({
    passed: true,
    assertions: [
      "invoice sent status, timestamp, and audit log",
      "resend action recorded an email-reminder event",
      "phone confirmation disabled without notes and POSTed notes when valid",
      "manager assigned and unassigned invoice follow-up",
      "Preview delivery notice explains unavailable resend action",
      "receipt-confirmation Followups category, urgency, assignment, invoice link, and status update",
      "Admin Factoring Settings reminder configuration saved",
      "Aging confirmation-status column and invoice link",
    ],
    apiRequestsIntercepted: calls.length,
    isolatedWrites: writeCalls.length,
    screenshot: "/tmp/broker-confirmation-verified.png",
  }));
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
