// Recovery UI checks with isolated fixtures. All real API traffic is intercepted.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = fs.mkdtempSync("/tmp/ff-recovery-neu-");
const stamp = new Date().toISOString(), year = new Date().getFullYear();
const actor = { id: "recovery-fixture-admin", firstName: "Recovery", lastName: "Fixture", role: "admin", status: "active" };
const task = { id: 701, clientId: 7, title: "Recovery Fixture Task", description: "Isolated task fixture", priority: "high", dueDate: stamp, status: "pending", createdAt: stamp, updatedAt: stamp, client: { id: 7, name: "Recovery Carrier", email: "fixture@example.invalid" } };
const settings = { enabled: false, mode: "dry_run", updatedAt: stamp, canManage: false, liveEmailsBlocked: false, liveEmailNotice: null };
const total = { count: 0, originalAmount: 0, cashApplied: 0, amount: 0, outstanding: 0, unknownAmounts: 0, refunded: 0, collected: 0, writtenOff: 0, recovered: 0, netOutstanding: 0, byType: {} };
const buckets = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 };
const reportTabs = ["Global Reports", "Aging", "Agent", "Agent Performance", "Broker", "Carrier", "Carrier AR", "Daily AR", "Monthly", "Chargeback"];
const requests = [], writes = [], errors = [];
let stage = "start", chrome, ws, sequence = 0;
const pending = new Map();
function fixture(url, method, raw) {
  const p = url.pathname; requests.push(p);
  if (method !== "GET") { writes.push({ path: p, method, raw }); throw Error(`Real writes blocked: ${method} ${p}`); }
  if (p === "/api/auth/verify") return { user: actor };
  if (p === "/api/auth/user" || p === "/api/user") return actor;
  if (p === "/api/auth/permissions") return { permissions: ["dashboard", "followups", "reports", "invoices"] };
  if (p === "/api/follow-ups") return [task];
  if (p === "/api/follow-up-clients" || p === "/api/clients") return [task.client];
  if (p === "/api/brokers") return [{ id: 8, name: "Recovery Broker" }];
  if (p === "/api/broker-follow-up-templates") return [{ id: 801, name: "Recovery Template", triggerType: "immediate", subject: "Recovery Fixture Subject", body: "Recovery fixture message", isDefault: true, createdAt: stamp, createdBy: actor.id }];
  if (p === "/api/broker-follow-ups") return [];
  if (p === "/api/broker-follow-up-reminders/delivery-summary") return { bounced: 1, failed: 0, spam: 0, total: 1 };
  if (p === "/api/broker-collections/settings") return settings;
  if (p === "/api/broker-collections") return { rows: [], total: 0, page: 1, pageSize: 50, settings };
  if (p === "/api/reports/agent") return [{ agentId: actor.id, agentName: "Recovery Agent", count: 1, totalFunded: 500, totalAmount: 500, avgDaysToFund: 1 }];
  if (p === "/api/reports/broker") return [{ brokerId: 8, debtorId: null, brokerName: "Recovery Broker", invoiceCount: 1, totalVolume: 500, outstanding: 500, paid: 0, creditLimit: 5000, avgDaysToPay: 20 }];
  if (p === "/api/reports/carrier") return [{ clientId: 7, carrierName: "Recovery Carrier", invoiceCount: 1, totalFunded: 500, outstanding: 500, avgInvoiceSize: 500 }];
  if (p === "/api/reports/daily-ar") return { totalAR: 500, outstanding: 500, collectedToday: 0, newToday: 500, date: stamp };
  if (p === "/api/reports/monthly") return { year, months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, label: new Date(year, i, 1).toLocaleString("en-US", { month: "short" }), invoiceCount: i + 1, totalVolume: (i + 1) * 500, totalFees: 20, totalAdvanced: 450 })) };
  if (p === "/api/reports/aging") return { view: url.searchParams.get("view") || "carrier", rows: [], totals: { invoiceCount: 0, buckets, total: 0 }, invoices: [] };
  if (p === "/api/reports/chargeback") return { chargebacks: [], shortPays: [], deductions: [], totals: { chargebacks: total, shortPays: total, deductions: total }, notices: [] };
  if (p.startsWith("/api/reports/global/")) return { title: "Recovery Global Report", columns: [{ key: "invoiceNumber", label: "Invoice", type: "text" }, { key: "amount", label: "Amount", type: "money" }], rows: [{ invoiceNumber: "RECOVERY-INV", amount: 500 }], summary: { count: 1, totalAmount: 500 } };
  if (p.startsWith("/api/reports/carrier-broker/") || p === "/api/reports/carrier-broker") return { rows: [], summary: { count: 0, totalAmount: 0, totalOutstanding: 0, totalShortPay: 0 } };
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
    try { const data = fixture(new URL(request.url), request.method, request.postData); await cdp("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(data)).toString("base64") }); }
    catch (error) { errors.push(String(error)); await cdp("Fetch.fulfillRequest", { requestId, responseCode: 500, body: Buffer.from('{"message":"Fixture blocked request"}').toString("base64") }); }
  });
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(actor))});` });
  const evaluate = async expression => { const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const until = async expression => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); } throw Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-2000)")}\n${errors.join("\n")}`); };
  const find = (selector, text) => `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getClientRects().length && e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
  const button = text => find("button", text), tab = text => find('[role="tab"]', text);
  const click = async expression => {
    await evaluate(`(${expression}).scrollIntoView({block:"center",behavior:"instant"})`); await sleep(250);
    const p = await evaluate(`(()=>{const r=(${expression}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, ...p, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) }); await sleep(150);
  };
  const style = expression => evaluate(`(()=>{const s=getComputedStyle(${expression});return{radius:parseFloat(s.borderRadius),border:s.borderTopWidth,bg:s.backgroundColor,shadow:s.boxShadow}})()`);
  const setInput = (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("input",{bubbles:true}));})()`);
  stage = "followups"; await cdp("Page.navigate", { url: "http://127.0.0.1:5000/followups" });
  await until(`!!document.querySelector(".recovery-neu-page") && document.body.textContent.includes("Open Manual Tasks")`);
  await click(tab("Manual Tasks")); await until(`document.body.textContent.includes("Recovery Fixture Task") && !!document.querySelector("main table")`);
  const card = await style(`document.querySelector("main .recovery-neu-surface")`); assert(card.radius >= 16 && card.border === "0px", JSON.stringify(card));
  const input = await style(`document.querySelector('main input[placeholder="Search follow-ups..."]')`); assert(input.radius >= 12 && input.shadow.includes("inset"), JSON.stringify(input));
  assert((await style(tab("Manual Tasks"))).shadow.includes("inset"));
  const tabList = await style(`document.querySelector('main [role="tablist"]')`);
  assert(tabList.radius >= 16 && tabList.border === "0px", JSON.stringify(tabList));
  await click(button("Add Follow Up")); await until(`!!document.querySelector('[role="dialog"]')`);
  const dialog = await style(`document.querySelector('[role="dialog"]')`); assert(dialog.radius >= 16 && dialog.bg === "rgb(224, 224, 224)", JSON.stringify(dialog));
  const close = `document.querySelector('[role="dialog"] > button:has(.sr-only)')`;
  const closeStyle = await style(close); assert(closeStyle.radius >= 16 && closeStyle.border === "0px", JSON.stringify(closeStyle)); await click(close);
  await click(tab("Templates")); await until(`document.body.textContent.includes("Recovery Template")`);
  await click(button("New Template")); await until(`!!document.querySelector('[role="dialog"]')`); await click(close);
  await click(tab("Broker Automations")); await until(`(${tab("Broker Automations")}).getAttribute("aria-selected")==="true"`);
  stage = "reports"; await cdp("Page.navigate", { url: "http://127.0.0.1:5000/reports" }); await until(`!!document.querySelector(".recovery-neu-page") && !!(${tab("Global Reports")})`);
  const reportTabList = await style(`document.querySelector('main [role="tablist"]')`);
  assert(reportTabList.radius >= 16 && reportTabList.border === "0px", JSON.stringify(reportTabList));
  for (const label of reportTabs) {
    stage = `report:${label}`; await click(tab(label)); await until(`(${tab(label)}).getAttribute("aria-selected")==="true"`);
    await sleep(300); assert((await style(tab(label))).shadow.includes("inset"), label);
    assert.equal(await evaluate(`document.body.innerText.includes("Something went wrong")`), false, label);
  }
  stage = "report customization"; await click(tab("Aging")); await until(`!!(${button("Customize columns")}) && !!document.querySelector('main table')`);
  await click(button("Customize columns")); await until(`!!document.querySelector(".recovery-neu-customization > .absolute")`);
  const menu = await style(`document.querySelector(".recovery-neu-customization > .absolute")`); assert(menu.radius >= 16 && menu.border === "0px", JSON.stringify(menu));
  const firstCheck = `document.querySelector('.recovery-neu-customization input[type="checkbox"]')`;
  const checked = await evaluate(`(${firstCheck}).checked`); await click(firstCheck); assert.equal(await evaluate(`(${firstCheck}).checked`), !checked);
  await setInput('.recovery-neu-customization input[aria-label="Template name"]', "Recovery Test View");
  await click(`document.querySelector('button[aria-label="Save template"]')`);
  await until(`Object.keys(localStorage).some(k=>k.startsWith("report-preferences:") && localStorage.getItem(k).includes("Recovery Test View"))`);
  await click(button("Customize columns")); await click(tab("Monthly")); await until(`!!document.querySelector(".recovery-neu-chart")`);
  const chart = await style(`document.querySelector(".recovery-neu-chart")`); assert(chart.radius >= 16 && chart.shadow.includes("inset"), JSON.stringify(chart));
  stage = "mobile"; await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click(tab("Aging")); await sleep(200); assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), "Mobile reports overflow");
  const screen = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/recovery-neu-mobile.png", Buffer.from(screen.data, "base64"));
  await cdp("Page.navigate", { url: "http://127.0.0.1:5000/followups" }); await until(`!!(${tab("Manual Tasks")})`); await click(tab("Manual Tasks"));
  await until(`document.body.textContent.includes("Recovery Fixture Task")`); assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), "Mobile followups overflow");
  assert.equal(writes.length, 0); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, reportTabs: reportTabs.length, followupTabs: true, dialogs: true, columnToggles: true, savedViews: true, concaveCharts: true, mobile: true, realWrites: 0 }));
})().catch(error => { console.error(stage, error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
