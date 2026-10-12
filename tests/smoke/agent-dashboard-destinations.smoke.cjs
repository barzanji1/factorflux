// All /api calls are fulfilled by local fixtures. This smoke never resends,
// retries OCR, updates tasks, or writes to a real service.
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const manager = { id: "mgr-17", username: "morgan.pike", role: "manager", firstName: "Morgan", lastName: "Pike", name: "Morgan Pike", email: "morgan@example.test" };
const task = { id: 771, title: "Review assigned invoice", description: "Verify the final paperwork.", type: "task", priority: "high", status: "todo", dueDate: "2025-04-05", progress: 20, assignedTo: manager.id, createdBy: manager.id, createdAt: "2025-03-01T12:00:00.000Z", updatedAt: "2025-03-01T12:00:00.000Z", assignedAgent: { id: manager.id, firstName: "Morgan", lastName: "Pike" }, creator: { firstName: "Morgan", lastName: "Pike" }, client: { id: 10, name: "Prairie Line" } };
const followUp = { id: 882, clientId: 10, title: "Confirm POD receipt", description: "Check with the carrier.", priority: "high", dueDate: "2025-04-06", status: "pending", createdAt: "2025-03-02T12:00:00.000Z", updatedAt: "2025-03-02T12:00:00.000Z", client: { id: 10, name: "Prairie Line", email: "ops@prairieline.test" } };
const email = {
  id: 901, direction: "outbound", resendMessageId: null, fromAddress: "ops@factorflux.test",
  toAddresses: ["dispatch@prairieline.test"], ccAddresses: [], subject: "POD confirmation for FF-901",
  bodyPreview: "Please confirm receipt of the proof of delivery.", templateName: "pod_confirmation",
  entityType: "invoice", entityId: "84021", entityUrl: "/invoices/84021", attachments: [],
  status: "delivered", statusUpdatedAt: "2025-03-04T12:30:00.000Z", error: null,
  sentByUserId: manager.id, sentByName: "Morgan Pike", createdAt: "2025-03-04T12:00:00.000Z",
  canResend: false, resendDisabledReason: null, inProgress: false,
  events: [{ id: 1, type: "delivery_delivered", status: "delivered", occurredAt: "2025-03-04T12:30:00.000Z", notes: "Delivered" }],
};
const listEmail = { ...email, id: "mail-117", subject: "A different message", bodyPreview: "List row preview", events: undefined };
const document = {
  id: 944, originalName: "failed-rate-confirmation.pdf", size: 10452, invoiceId: 84021, loadId: null,
  finalDocumentType: "rate_confirmation", candidateDocumentType: "rate_confirmation",
  classificationConfidence: "0.41", classificationSource: "rules", aiClassificationSignals: [],
  allClassificationScores: null, aiDocumentType: null, aiClassificationModel: null, aiClassifiedAt: null,
  status: "failed", createdAt: "2025-03-03T12:00:00.000Z",
  ocrJob: { id: 3, status: "failed", errorMessage: "Low image quality", parserName: "ocr" },
};
const calls = [], writes = [];
function fixture(url, method) {
  calls.push({ path: url.pathname, method });
  if (method !== "GET") writes.push({ path: url.pathname, method });
  if (url.pathname === "/api/auth/verify") return { body: { user: manager } };
  if (url.pathname === "/api/auth/permissions") return { body: { permissions: ["dashboard", "tasks", "followups", "email_log", "documents", "chat"] } };
  if (url.pathname === "/api/auth/user") return { body: manager };
  if (url.pathname === "/api/tasks") return { body: [task] };
  if (url.pathname === "/api/users" || url.pathname === "/api/clients") return { body: [] };
  if (url.pathname === "/api/follow-ups") return { body: [followUp] };
  if (url.pathname === "/api/follow-up-clients" || url.pathname === "/api/broker-follow-ups" || url.pathname === "/api/broker-follow-up-templates") return { body: [] };
  if (url.pathname === "/api/broker-follow-up-reminders/delivery-summary") return { body: { bounced: 0, failed: 0, spam: 0, total: 0 } };
  if (url.pathname === "/api/email-log/agents") return { body: [] };
  if (url.pathname === "/api/email-log/integration-status") return { body: { webhookConfigured: true } };
  if (url.pathname === "/api/email-log" && method === "GET") return { body: { rows: [listEmail], total: 34, page: 1, pageSize: 25 } };
  if (url.pathname === "/api/email-log/901" && method === "GET") return { body: email };
  if (url.pathname === "/api/documents") return { body: [document] };
  if (url.pathname.includes("unread-count") || url.pathname.includes("pending-count")) return { body: { count: 0 } };
  return { body: [] };
}
let chrome, ws, stage = "startup";
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors", "--remote-debugging-port=9240", "--user-data-dir=/tmp/ff-dashboard-destinations-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) { try { targets = await (await fetch("http://127.0.0.1:9240/json")).json(); if (targets.length) break; } catch {} await sleep(100); }
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
    await cdp("Fetch.fulfillRequest", { requestId, responseCode: response.code || 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Cache-Control", value: "no-store" }], body: Buffer.from(JSON.stringify(response.body)).toString("base64") });
  });
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(manager))});` });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 180; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error(`Timed out ${expression}: ${String(await evaluate("document.body.innerText")).slice(0, 700)}; calls=${JSON.stringify(calls)}`);
  };
  const app = "http://127.0.0.1:5000";

  stage = "existing task dialog";
  await cdp("Page.navigate", { url: `${app}/tasks?taskId=771` });
  await until(`document.querySelector('[data-testid="task-edit-dialog"]') !== null`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="task-edit-dialog"] input[name="title"]')?.value`), "Review assigned invoice", "task query opens the prefilled authorized task dialog");

  stage = "manual follow-up focus";
  await cdp("Page.navigate", { url: `${app}/follow-up?followupId=882` });
  await until(`document.activeElement?.id === "manual-followup-882"`);
  assert(await evaluate(`document.querySelector('[data-testid="followup-show-all"]')?.innerText.includes("Show all")`), "manual follow-up has a clear Show all link");
  await evaluate(`document.querySelector('[data-testid="followup-show-all"]').click()`);
  await until(`location.pathname==="/follow-up"&&location.search===""`);

  stage = "email detail outside list page";
  await cdp("Page.navigate", { url: `${app}/email-log?emailId=901` });
  await until(`document.querySelector('[data-email-id="901"][aria-expanded="true"]') !== null`);
  assert(await evaluate(`document.querySelector('[data-testid="email-log-detail"]').innerText.includes("Please confirm receipt")`), "numeric email serial loads and expands exact detail outside current list rows");
  assert(await evaluate(`document.querySelector('[data-testid="email-log-show-all"]')?.innerText.includes("Show all")`), "focused email has a clear Show all link");
  assert(calls.some(call => call.path === "/api/email-log/901"), "email serial was requested using normalized string ID");
  await evaluate(`document.querySelector('[data-testid="email-log-show-all"]').click()`);
  await until(`location.pathname==="/email-log"&&location.search===""`);

  stage = "failed OCR document focus";
  await cdp("Page.navigate", { url: `${app}/documents?documentId=944` });
  await until(`document.activeElement?.id === "document-row-944"`);
  assert(await evaluate(`document.querySelector('[data-testid="ocr-retry-944"]')?.innerText.includes("Retry")`), "failed document retry control is immediately reachable");
  assert(await evaluate(`document.querySelector('[data-testid="documents-show-all"]')?.innerText.includes("Show all")`), "focused document has a clear Show all link");
  await evaluate(`document.querySelector('[data-testid="documents-show-all"]').click()`);
  await until(`location.pathname==="/documents"&&location.search===""`);
  assert.equal(writes.length, 0, "navigation and focus triggered no API writes, email, or OCR retry");
  assert(calls.length > 0 && calls.every(call => call.path.startsWith("/api/")), "all API requests were intercepted");
  console.log(JSON.stringify({ passed: true, stage, assertions: ["authorized task dialog prefill", "manual follow-up focused row/show all", "out-of-filter email detail expansion/Show all/numeric ID", "failed OCR document focus/retry visibility/Show all", "all API intercepted", "zero writes"], apiRequestsIntercepted: calls.length, isolatedWrites: writes.length }));
})().catch(error => { console.error("Destination smoke failure:", error?.stack || error, "stage:", stage); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
