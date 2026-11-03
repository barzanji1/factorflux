// Isolated API fixtures only: this test never sends funds or changes real records.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = fs.mkdtempSync("/tmp/ff-funding-neu-");
const actor = { id: "funding-fixture-admin", firstName: "Funding", lastName: "Fixture", role: "admin", status: "active" };
const stamp = "2026-11-01T10:00:00Z";
const invoice = {
  id: 701, invoiceNumber: "FUNDING-FIXTURE", loadNumber: "LOAD-FIXTURE", clientId: 11, brokerId: 12,
  clientName: "Fixture Carrier", carrierName: "Fixture Carrier", brokerName: "Fixture Broker",
  client: { id: 11, name: "Fixture Carrier" }, broker: { id: 12, name: "Fixture Broker" },
  amount: "1000", balance: "1000", status: "under_review", factoringStage: "under_review", loadType: "OTR",
  createdAt: stamp, invoiceDate: stamp, updatedAt: stamp, paymentType: "ACH",
  assignedTo: actor.id, submittedBy: actor.id, documentsComplete: true, hasDocuments: true,
};
const sheets = [{ ...invoice, id: 702, status: "approved", factoringStage: "approved", netAdvance: "880", advanceAmount: "900",
  feeAmount: "20", reserveAmount: "100", canFund: true, readyToFund: true, documentCount: 3, blockerCount: 0, alerts: [],
  documentPresence: { rateConfirmation: true, billOfLading: true, lumper: true, readyToFund: true }, documents: [],
  payoutPreview: { grossAmount: "1000", advanceRate: "90", advanceAmount: "900", feeRate: "2", feeAmount: "20", reserveAmount: "100", netFundingAmount: "880" } }];
const payout = { id: 711, invoiceId: 701, invoiceNumber: invoice.invoiceNumber, clientId: 11, clientName: "Fixture Carrier",
  invoiceAmount: "1000", advanceRate: "90", feeRate: "2", advanceAmount: "900", feeAmount: "20", reserveAmount: "100",
  netPayout: "880", paymentMethod: "ach", paymentStatus: "pending_advance", createdAt: stamp, notes: null };
const transfer = { id: 721, carrierId: 11, carrierName: "Fixture Carrier", transferType: "ACH", amount: "500", status: "pending",
  bankAccountName: "Fixture bank", accountNumber: "1234", accountLast4: "1234", memo: "TRANSFER-FIXTURE", transferDate: stamp, createdAt: stamp };
const lockbox = { id: 731, payerName: "Fixture Broker", payorName: "Fixture Broker", checkNumber: "LOCKBOX-FIXTURE", referenceNumber: "LOCKBOX-FIXTURE",
  amount: "500", status: "unmatched", paymentMethod: "check", receivedDate: stamp, receivedAt: stamp, createdAt: stamp,
  matches: [], notes: null };
const cash = { id: 741, brokerId: 12, debtorId: 12, brokerName: "Fixture Broker", payorName: "Fixture Broker", paymentReference: "PAYMENT-FIXTURE",
  paymentMethod: "ach", paymentDate: stamp, totalReceived: "500", totalApplied: "0", unappliedAmount: "500", status: "unapplied", createdAt: stamp, lines: [] };
const fuel = { id: 751, carrierId: 11, carrierName: "Fixture Carrier", clientId: 11, brokerId: 12, brokerName: "Fixture Broker",
  loadNumber: "FUEL-FIXTURE", advanceAmount: "100", advanceDate: stamp, date: stamp, amount: "100", rate: "1000",
  invoiceAmount: "1000", loadAmount: "1000", balance: "900", deliveryVerified: false, paid: false, status: "pending",
  account: "1234", referenceNumber: "ADV-FIXTURE", createdAt: stamp };
let chrome, ws, seq = 0, stage = "start";
const pending = new Map(), errors = [], calls = [], checked = [];
function fixture(url, method, raw) {
  const path = url.pathname;
  calls.push({ path, method, search: url.search, body: raw });
  if (method !== "GET") return { __status: 409, message: "Financial writes are disabled in the styling fixture." };
  if (path === "/api/auth/verify") return { user: actor };
  if (path === "/api/auth/user") return actor;
  if (path === "/api/auth/permissions") return { permissions: ["admin", "dashboard", "factoring", "payments", "lockbox", "fuel_advance", "bank_transfers", "invoices", "carriers", "brokers", "chat"] };
  if (path === "/api/invoices/funding/queue") return { rows: sheets, total: 1 };
  if (path === "/api/invoices/aging-alerts") return [];
  if (path.endsWith("/preflight")) return { alerts: [], blocking: false, canFund: true };
  if (path === "/api/invoices") return [invoice];
  if (path === "/api/payout-settings") return { id: 1, advanceRate: "90", feeRate: "2" };
  if (path === "/api/payouts") return [payout];
  if (path === "/api/bank-transfers") return [transfer];
  if (path === "/api/lockbox") return [lockbox];
  if (path === "/api/cash-applications") return [cash];
  if (path === "/api/fuel-advances") return [fuel];
  if (path === "/api/fuel-advances/751") return fuel;
  if (path === "/api/clients" || path === "/api/carriers") return [{ id: 11, name: "Fixture Carrier" }];
  if (path === "/api/brokers" || path === "/api/debtors") return [{ id: 12, name: "Fixture Broker" }];
  if (path === "/api/loads") return [{ id: 13, loadNumber: "LOAD-FIXTURE", clientId: 11 }];
  if (path.includes("unread") || path.endsWith("pending-count")) return { count: 0, unreadCount: 0 };
  return [];
}
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 150 && !fs.existsSync(`${profile}/DevToolsActivePort`); i++) await sleep(100);
  const port = fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.on("message", async raw => {
    const event = JSON.parse(raw);
    if (event.id) { const call = pending.get(event.id); pending.delete(event.id); if (call) event.error ? call.reject(event.error) : call.resolve(event.result); }
    if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    try {
      const result = fixture(new URL(request.url), request.method, request.postData);
      const { __status, ...body } = result;
      await cdp("Fetch.fulfillRequest", { requestId, responseCode: __status || 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(__status ? body : result)).toString("base64") });
    } catch (error) { errors.push(String(error)); }
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(actor))});` });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw Error(`Timed out: ${expression}; ${await evaluate("document.body.innerText.slice(-1800)")} ${errors.join("\n")}`);
  };
  const button = text => `Array.from(document.querySelectorAll("button")).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const click = async expression => {
    await evaluate(`(${expression}).scrollIntoView({block:"center",behavior:"instant"})`); await sleep(250);
    const point = await evaluate(`(()=>{const r=(${expression}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", {
      type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
    });
    await sleep(150);
  };
  const checkTable = async () => {
    const style = await evaluate(`(()=>{const e=document.querySelector("main table thead th"); const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color}})()`);
    assert(!["rgb(0, 0, 128)", "rgb(0, 0, 0)", "rgb(15, 23, 42)"].includes(style.background), `${stage}: dark table header`);
  };
  const checkDialog = async action => {
    await until(`!!(${button(action)})`); await click(button(action));
    await until(`document.querySelector('[role="dialog"]')!==null`);
    const style = await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('[role="dialog"]'));return{radius:parseFloat(s.borderRadius),border:s.borderTopWidth,bg:s.backgroundColor,shadow:s.boxShadow}})()`);
    assert(style.radius >= 12, `${stage}: modal radius ${JSON.stringify(style)}`);
    assert.equal(style.bg, "rgb(224, 224, 224)", `${stage}: modal background`);
    const x = `Array.from(document.querySelectorAll('[role="dialog"] button')).find(e=>e.querySelector(".sr-only")?.textContent==="Close")`;
    await until(`!!(${x})`);
    const xStyle = await evaluate(`(()=>{const s=getComputedStyle(${x});return{radius:parseFloat(s.borderRadius),border:s.borderTopWidth,shadow:s.boxShadow}})()`);
    assert(xStyle.radius >= 12 && xStyle.border === "0px", `${stage}: legacy close ${JSON.stringify(xStyle)}`);
    await click(x); await until(`document.querySelector('[role="dialog"]')===null`);
  };
  const visit = async (path, marker) => {
    stage = path;
    await cdp("Page.navigate", { url: `http://127.0.0.1:5000${path}` });
    await until(`document.querySelector("main")!==null && document.body.innerText.includes(${JSON.stringify(marker)})`);
    await checkTable();
    const styles = await evaluate(`(()=>{const e=document.querySelector("main .funding-neu-surface"),s=getComputedStyle(e);return{radius:parseFloat(s.borderRadius),border:s.borderTopWidth}})()`);
    assert(styles.radius >= 16 && styles.border === "0px", `${path}: card rim ${JSON.stringify(styles)}`);
    checked.push(path);
  };
  await visit("/factoring", "FUNDING-FIXTURE");
  await until(`document.querySelectorAll('[role="tab"]').length>=6`);
  await click(`Array.from(document.querySelectorAll('[role="tab"]')).find(e=>e.textContent.includes("Under Review"))`);
  await until(`Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).some(e=>e.textContent.includes("Under Review"))`);
  await visit("/sheets", "LOAD-FIXTURE");
  await click(`Array.from(document.querySelectorAll('[role="tab"]')).find(e=>e.textContent.trim()==="Dump")`);
  await sleep(250);
  assert(calls.some(call => call.path.includes("/funding/queue") && new URLSearchParams(call.search).get("loadType") === "dump_truck_ticket"),
    JSON.stringify({ queries: calls.filter(c => c.path.includes("/funding/queue")), tabs: await evaluate(`Array.from(document.querySelectorAll('[role="tab"]')).map(e=>({text:e.textContent,selected:e.getAttribute("aria-selected"),bounds:e.getBoundingClientRect().toJSON()}))`) }));
  await visit("/payouts", "FUNDING-FIXTURE");
  await checkDialog("New Payout");
  await visit("/cash-application", "PAYMENT-FIXTURE");
  await checkDialog("Record Payment");
  await visit("/lockbox", "Fixture Broker");
  await checkDialog("New Entry");
  await visit("/bank-transfers", "Fixture Carrier");
  await checkDialog("New Transfer");
  await visit("/fuel-advance", "FUEL-FIXTURE");
  await click(button("New advance"));
  await until(`document.body.innerText.includes("New fuel advance")`);
  const inputStyle = await evaluate(`(()=>{const e=Array.from(document.querySelectorAll("main input")).find(e=>e.type==="date"),s=getComputedStyle(e);return{radius:parseFloat(s.borderRadius),shadow:s.boxShadow,border:s.borderTopWidth}})()`);
  assert(inputStyle.radius >= 10 && inputStyle.shadow.includes("inset") && inputStyle.border === "0px", JSON.stringify(inputStyle));
  await click(button("Cancel"));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp("Page.navigate", { url: "http://127.0.0.1:5000/bank-transfers" });
  await until(`document.body.innerText.includes("Fixture Carrier")`);
  assert(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth+1`), "mobile page overflow");
  const screen = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/funding-neu-mobile.png", Buffer.from(screen.data, "base64"));
  assert.deepEqual(errors, []);
  assert.equal(calls.filter(call => call.method !== "GET").length, 0, "styling checks made a financial write");
  console.log(JSON.stringify({ passed: true, checked, isolatedFixtures: true, noFinancialWrites: true, mobile: true }));
})().catch(error => { console.error(stage, error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
