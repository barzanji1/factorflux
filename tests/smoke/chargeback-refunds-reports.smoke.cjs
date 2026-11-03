// Real rendered UI with isolated API fixtures. No real refunds, emails or cash are created.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } = require("node:fs");
const WebSocket = require("ws");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = mkdtempSync("/tmp/chargeback-reports-");
const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000";
const user = { id: "fixture-finance-admin", role: "admin", firstName: "Fixture", lastName: "Admin", name: "Fixture Admin" };
const zero = { count: 0, originalAmount: 0, cashApplied: 0, amount: 0, outstanding: 0, unknownAmounts: 0,
  refunded: 0, collected: 0, writtenOff: 0, recovered: 0, netOutstanding: 0, byType: {} };
const row = { id: "chargeback/741", section: "chargebacks", date: "2026-10-20T12:00:00Z", invoiceId: 741,
  invoiceNumber: "REFUND-FIXTURE", carrierId: 1, carrierName: "Fixture Carrier", brokerId: 1, brokerName: "Fixture Broker",
  originalAmount: 500, cashApplied: 0, amount: 500, outstanding: 500, reason: "Aged", status: "open", kind: "Chargeback",
  amountSource: "Recorded", refundDate: null, refundedAmount: 0, netChargeback: 500, paymentReference: null,
  recoveredAmount: 0, originalShortPay: 500, collectedAmount: 0, writtenOffAmount: 0 };
const report = { chargebacks: [row], shortPays: [{ ...row, id: "short-pay/741", section: "shortPays", kind: "Short pay" }],
  deductions: [{ ...row, id: "adjustment/1", section: "deductions", kind: "reserve movement", amount: 25 }],
  totals: { chargebacks: { ...zero, count: 1, amount: 500, outstanding: 500, netOutstanding: 500 },
    shortPays: { ...zero, count: 1, amount: 500, outstanding: 500 },
    deductions: { ...zero, count: 1, amount: 25, byType: { reserve_movement: 25 } } }, notices: [] };
const lifecycle = { invoiceId: 741, carrierName: "Fixture Carrier", originalAmount: 500, verifiedDebit: 500,
  refundedAmount: 0, refundableAmount: 500, resolutionStatus: "open", blockedReason: null, refunds: [],
  events: [{ id: 1, eventType: "chargeback_applied", createdAt: "2026-10-20T12:00:00Z", actorName: "Fixture Admin", amount: "500", reason: "Aged" }] };
let chrome, ws, seq = 0, refunded = false;
const pending = new Map(), errors = [], requests = [], refunds = [];
function fixture(url, method, body) {
  const path = url.pathname;
  requests.push({ path, query: url.searchParams.toString(), method });
  if (path === "/api/auth/verify") return { user };
  if (path === "/api/auth/user") return user;
  if (path === "/api/auth/permissions") return { permissions: ["reports", "invoices", "dashboard"] };
  if (path === "/api/reports/chargeback") return report;
  if (path.endsWith("/chargeback/lifecycle")) return path.includes("/742/") ? { ...lifecycle, verifiedDebit: 0,
    refundableAmount: 0, blockedReason: "No verified reserve debit is recorded for this chargeback." } : lifecycle;
  if (path.endsWith("/chargeback/approvers")) return [{ id: user.id, name: user.name }];
  if (path.endsWith("/chargeback/refunds") && method === "POST") {
    refunds.push(JSON.parse(body));
    if (refunds.length === 1) return { __status: 503, message: "Fixture temporary failure; retry is safe." };
    refunded = true; lifecycle.refundedAmount = 100; lifecycle.refundableAmount = 400;
    lifecycle.refunds = [{ id: 1, amount: "100", refundDate: "2026-10-20T12:00:00Z", reference: "FIXTURE-ACH", notes: "Broker settled",
      approvedBy: user.id, approverName: user.name, actorName: user.name, emailStatus: "failed", emailError: "Mock email rejection" }];
    return { refund: lifecycle.refunds[0], emailStatus: "failed", emailError: "Mock email rejection" };
  }
  if (path.endsWith("/detail")) return {
    id: path.includes("/742/") ? 742 : 741, invoiceNumber: "REFUND-FIXTURE", loadNumber: "FIXTURE-741", amount: "500",
    status: "funded", factoringStage: "funded", fundedAt: "2026-07-01", clientId: 1,
    client: { id: 1, name: "Fixture Carrier", advanceRate: "80", factoringFeeRate: "3" },
    broker: { id: 1, name: "Fixture Broker" }, documents: [], chargeback: { status: "charged", chargebackDate: "2026-10-20", history: [] },
    notes: [], activities: [], statusHistory: [], payments: [], payouts: [],
  };
  if (path.endsWith("/document-status")) return { rules: [], missingForReview: [], missingForApproval: [], completenessPercent: 100 };
  if (path.endsWith("/ocr-alerts") || path.endsWith("/preflight")) return { alerts: [] };
  if (path.includes("/timeline")) return { timeline: [] };
  if (path.includes("/unread")) return { count: 0, unreadCount: 0 };
  if (path === "/api/notifications") return [];
  return [];
}
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 150 && !existsSync(`${profile}/DevToolsActivePort`); i++) await sleep(100);
  const port = readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(r => ws.once("open", r));
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.on("message", async raw => {
    const event = JSON.parse(raw);
    if (event.id) { const item = pending.get(event.id); if (item) { pending.delete(event.id); event.error ? item.reject(event.error) : item.resolve(event.result); } }
    if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text + " " + event.params.exceptionDetails.exception?.description);
    if (event.method === "Fetch.requestPaused") {
      const { requestId, request } = event.params, url = new URL(request.url);
      try {
        let value = fixture(url, request.method, request.postData), status = value.__status || 200;
        if (value.__status) { value = { ...value }; delete value.__status; }
        await cdp("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(value)).toString("base64") });
      } catch (error) {
        // Navigating away cancels in-flight fixture requests in Chromium.
        if (!String(error?.message).includes("Invalid InterceptionId"))
          errors.push(JSON.stringify({ path: url.pathname, message: error?.message || String(error) }));
      }
    }
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(user))});` });
  const evaluate = async expression => { const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description); return r.result.value; };
  const until = async expression => {
    for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); }
    console.error("Fixture diagnostics:", await evaluate(`({path:location.pathname,text:document.body.innerText.slice(-3500)})`), errors, requests.slice(-12));
    throw Error(`Timed out: ${expression}`);
  };
  const click = async expression => {
    await until(`!!(${expression})`); const point = await evaluate(`(()=>{const e=${expression};e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 }); await sleep(180);
  };
  const button = text => `Array.from(document.querySelectorAll("button")).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const label = text => `Array.from(document.querySelectorAll("label")).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const fill = async (expression, text) => {
    await click(expression); await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 }); await cdp("Input.insertText", { text }); await sleep(70);
  };
  await cdp("Page.navigate", { url: `${base}/reports?tab=chargeback` });
  await until(`document.body.textContent.includes("Fixture Carrier") && !!(${button("Customize columns")})`);
  await click(button("Customize columns"));
  await click(`${label("Broker")}.querySelector("input")`);
  await until(`!Array.from(document.querySelectorAll("thead th")).some(e=>e.textContent.trim()==="Broker")`);
  await fill(`document.querySelector('[aria-label="Template name"]')`, "Refund review");
  await click(`document.querySelector('[aria-label="Save template"]')`);
  await until(`document.querySelector('[aria-label="Saved report templates"]').options.length===2`);
  await click(`${label("Carrier")}.querySelector("input")`);
  await evaluate(`(()=>{const e=document.querySelector('[aria-label="Saved report templates"]');e.value=e.options[1].value;e.dispatchEvent(new Event("change",{bubbles:true}))})()`);
  await click(button("Apply"));
  assert(await evaluate(`Array.from(document.querySelectorAll("thead th")).some(e=>e.textContent.trim()==="Carrier")`));
  await cdp("Page.reload");
  await until(`document.body.textContent.includes("Fixture Carrier")`);
  assert(!await evaluate(`Array.from(document.querySelectorAll("thead th")).some(e=>e.textContent.trim()==="Broker")`));
  assert(await evaluate(`Object.keys(localStorage).some(k=>k.includes("fixture-finance-admin")&&k.includes("chargeback"))`));
  await cdp("Page.captureScreenshot", { format: "png" }).then(r => writeFileSync("/tmp/chargeback-report-ui.png", Buffer.from(r.data, "base64")));
  await cdp("Page.navigate", { url: `${base}/invoices/741` });
  await until(`document.body.textContent.includes("REFUND-FIXTURE")`);
  await click(`Array.from(document.querySelectorAll('[role="tab"]')).find(e=>e.textContent.trim()==="Chargeback")`);
  await click(button("Record refund"));
  const inDialog = field => `Array.from(document.querySelector('[role="dialog"]').querySelectorAll("label")).find(e=>e.textContent.startsWith(${JSON.stringify(field)}))`;
  await fill(`${inDialog("Amount")}.querySelector("input")`, "100");
  await fill(`${inDialog("Payment reference")}.querySelector("input")`, "FIXTURE-ACH");
  await fill(`${inDialog("Refund reason")}.querySelector("textarea")`, "Broker settled");
  await evaluate(`(()=>{const e=Array.from(document.querySelector('[role="dialog"]').querySelectorAll("select"))[0];e.value=${JSON.stringify(user.id)};e.dispatchEvent(new Event("change",{bubbles:true}))})()`);
  await click(button("Confirm refund"));
  await until(`document.body.textContent.includes("Fixture temporary failure")`);
  await click(button("Confirm refund"));
  await until(`document.body.textContent.includes("Mock email rejection") && !document.querySelector('[aria-labelledby="refund-title"]')`);
  assert(refunded); assert.equal(refunds.length, 2); assert.equal(refunds[0].idempotencyKey, refunds[1].idempotencyKey);
  assert.match(refunds[0].idempotencyKey, /^[a-f0-9-]{36}$/);
  assert.equal(refunds[1].amount, 100); assert.equal(refunds[1].approvedBy, user.id);
  assert(await evaluate(`document.body.textContent.includes("Approved by Fixture Admin")`));
  await cdp("Page.captureScreenshot", { format: "png" }).then(r => writeFileSync("/tmp/chargeback-refund-ui.png", Buffer.from(r.data, "base64")));
  await cdp("Page.navigate", { url: `${base}/invoices/742` });
  await until(`document.body.textContent.includes("REFUND-FIXTURE")`);
  await click(`Array.from(document.querySelectorAll('[role="tab"]')).find(e=>e.textContent.trim()==="Chargeback")`);
  await until(`document.body.textContent.includes("No verified reserve debit")`);
  assert(await evaluate(`(${button("Record refund")}).disabled`));
  assert.deepEqual(errors, []);
  console.log("PASS: report column checklist, user-scoped persistence, template save/recall, invoice refund form, stable retry UUID, truthful email failure, approver name, missing-debit block. All API writes intercepted.");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill("SIGKILL"); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 300); });
