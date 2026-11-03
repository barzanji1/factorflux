// Isolated Admin UI verification: no live users, payroll, vault, or workflow writes.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = fs.mkdtempSync("/tmp/ff-admin-neu-"), stamp = new Date().toISOString();
const actor = { id: "admin-neu-fixture", role: "admin", firstName: "Admin", lastName: "Fixture", email: "admin@example.invalid", status: "active" };
const staff = { id: "staff-neu-fixture", role: "employee", firstName: "Staff", lastName: "Fixture", email: "staff@example.invalid", status: "active", createdAt: stamp };
const tabs = ["Users", "Time Tracking", "Carrier Portal", "Factoring Settings", "Doc Requirements", "Audit Log"];
const reply = "Admin fixture response. No live AI request was made.";
const writes = [], errors = [], requests = [], pending = new Map();
let chrome, ws, sequence = 0, stage = "start";
function fixture(url, method, raw) {
  const p = url.pathname; requests.push(p);
  if (method !== "GET") {
    writes.push({ path: p, method, body: raw ? JSON.parse(raw) : null });
    if (p === "/api/ai/chat" && method === "POST") return { message: reply, activities: [], cards: [], confirmation: null };
    throw Error(`Blocked unexpected write ${method} ${p}`);
  }
  if (p === "/api/auth/verify" || p === "/api/auth/user") return { user: actor };
  if (p === "/api/auth/permissions") return { permissions: ["admin", "payroll", "expenses", "vault", "document_rules", "workflow_builder", "earl"] };
  if (p === "/api/admin/users") return [actor, staff];
  if (/^\/api\/admin\/users\/[^/]+\/permissions$/.test(p)) return { permissions: [] };
  if (p === "/api/payout-settings") return { advanceRate: "80", feeRate: "3" };
  if (p === "/api/invoices/preflight/settings") return {};
  if (p === "/api/admin/doc-requirements") return [{ id: 31, stage: "start_review", documentName: "Fixture Rate Confirmation", required: true, description: "Fixture requirement" }];
  if (p === "/api/admin/audit-log") return [{ id: 41, userId: actor.id, userName: "Admin", userLastName: "Fixture", type: "fixture", description: "Admin Fixture Audit Event", entityType: "user", entityId: 1, createdAt: stamp }];
  if (p === "/api/broker-confirmation-settings") return { maxReminders: 2, reminderDays: [3, 7, 14], publicBaseUrl: "", chargebackWarningDays: 80, dumpStatementIntervalDays: 10 };
  if (p === "/api/payroll") return [{ id: 51, employeeId: staff.id, payPeriodStart: stamp, payPeriodEnd: stamp, regularHours: "40", overtimeHours: "0", hourlyRate: "20", grossPay: "800", deductions: "0", netPay: "800", status: "draft", paidAt: null, notes: null, createdAt: stamp, deductionsList: [] }];
  if (p === "/api/clients") return [{ id: 1, name: "Admin Fixture Carrier" }];
  if (p === "/api/document-rules") return [{ id: 61, documentType: "rate_confirmation", label: "Fixture Rate Confirmation", description: "Fixture document rule", required: true, requiredForStage: "start_review", sortOrder: 1, active: true, createdAt: stamp }];
  if (p === "/api/workflow-config") return { stagesJson: [] };
  if (p.includes("unread") || p.endsWith("pending-count")) return { count: 0, unreadCount: 0 };
  return [];
}
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 150 && !fs.existsSync(`${profile}/DevToolsActivePort`); i++) await sleep(100);
  const port = fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(pages.find(p => p.type === "page").webSocketDebuggerUrl); await new Promise(resolve => ws.once("open", resolve));
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  ws.on("message", async raw => {
    const e = JSON.parse(raw);
    if (e.id) { const call = pending.get(e.id); pending.delete(e.id); if (call) e.error ? call.reject(e.error) : call.resolve(e.result); }
    if (e.method === "Runtime.exceptionThrown") errors.push(e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
    if (e.method !== "Fetch.requestPaused") return;
    const { requestId, request } = e.params;
    try { const data = fixture(new URL(request.url), request.method, request.postData); await cdp("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(data)).toString("base64") }); }
    catch (error) { errors.push(String(error)); await cdp("Fetch.fulfillRequest", { requestId, responseCode: 500, body: Buffer.from('{"message":"Fixture blocked write"}').toString("base64") }); }
  });
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(actor))});` });
  const evaluate = async expression => { const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const until = async expression => { for (let i = 0; i < 160; i++) { if (await evaluate(expression)) return; await sleep(100); } throw Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-2300)")}\n${errors.join("\n")}`); };
  const find = (selector, label) => `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getClientRects().length && e.textContent.trim().startsWith(${JSON.stringify(label)}))`;
  const tab = label => find('[role="tab"]', label);
  const click = async expression => {
    await evaluate(`(${expression}).scrollIntoView({block:"center",behavior:"instant"})`); await sleep(250);
    const point = await evaluate(`(()=>{const r=(${expression}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) }); await sleep(150);
  };
  const style = expression => evaluate(`(()=>{const s=getComputedStyle(${expression});return{radius:parseFloat(s.borderTopLeftRadius),border:s.borderTopWidth,bg:s.backgroundColor,shadow:s.boxShadow}})()`);
  const visit = async path => { stage = path; await cdp("Page.navigate", { url: `http://127.0.0.1:5000${path}` }); await until(`!!document.querySelector("main.admin-neu-page-shell")`); await sleep(250); };
  const assertSurface = async () => { const s = await style(`document.querySelector("main .admin-neu-surface")`); assert(s.radius >= 16 && s.border === "0px" && s.bg === "rgb(224, 224, 224)", JSON.stringify(s)); };
  const close = `document.querySelector('[role="dialog"] > button:has(.sr-only)')`;
  const checkDialog = async () => {
    await until(`!!document.querySelector('[role="dialog"]')`);
    const s = await style(`document.querySelector('[role="dialog"]')`); assert(s.radius >= 16 && s.border === "0px" && s.bg === "rgb(224, 224, 224)", JSON.stringify(s));
    const x = await style(close); assert(x.radius >= 16 && x.border === "0px", JSON.stringify(x));
  };
  await visit("/admin"); await until(`document.body.textContent.includes("staff@example.invalid")`); await assertSurface();
  const list = await style(`document.querySelector('main [role="tablist"]')`); assert(list.radius >= 16 && list.border === "0px", JSON.stringify(list));
  await click(`document.querySelector('main button[title="Manage Permissions"]')`); await checkDialog();
  await until(`document.querySelectorAll('[role="dialog"] [role="switch"]').length>=36`);
  const permissionSwitch = `document.querySelector('[role="dialog"] [role="switch"]')`;
  const before = await evaluate(`(${permissionSwitch}).getAttribute("aria-checked")`); await click(permissionSwitch); assert.notEqual(await evaluate(`(${permissionSwitch}).getAttribute("aria-checked")`), before);
  await click(close);
  for (const label of tabs) {
    stage = `/admin:${label}`; await click(tab(label)); await until(`(${tab(label)}).getAttribute("aria-selected")==="true"`); await sleep(200);
    assert((await style(tab(label))).shadow.includes("inset"), label);
    assert.equal(await evaluate(`document.body.innerText.includes("Something went wrong")`), false, label);
  }
  await visit("/payroll"); await until(`!!document.querySelector("main table")`); await assertSurface();
  await click(`document.querySelector('main button:has(svg.lucide-plus)')`); await checkDialog(); await click(close);
  await visit("/expenses"); await until(`!!document.querySelector("main table")`);
  await click(`document.querySelector('main button:has(svg.lucide-plus)')`); await checkDialog(); await click(close);
  await visit("/vault?clientId=1"); await until(`document.body.textContent.includes("Admin Fixture Carrier")`); await assertSurface();
  await click(find("main button", "Add Entry")); await checkDialog(); await click(close);
  await visit("/document-rules"); await until(`document.body.textContent.includes("Fixture Rate Confirmation")`);
  await click(`document.querySelector('main button:has(svg.lucide-plus)')`); await checkDialog(); await click(close);
  await visit("/workflow-builder"); await until(`document.querySelectorAll('main [draggable="true"]').length>0`);
  const stageCard = await style(`document.querySelector('main [draggable="true"]')`); assert(stageCard.radius >= 12 && stageCard.border === "0px", JSON.stringify(stageCard));
  const preview = await style(`document.querySelector("main .ff-workflow-preview")`); assert(preview.radius >= 16 && preview.shadow.includes("inset"), JSON.stringify(preview));
  await click(`document.querySelector('main button[title="Configure"]')`);
  await until(`!!document.querySelector('main [draggable="true"] input[type="number"]')`);
  const stageInput = await style(`document.querySelector('main [draggable="true"] input[type="number"]')`); assert(stageInput.shadow.includes("inset"));
  await visit("/ai-assistant"); await until(`!!document.querySelector('textarea.ff-earl-input')`); await assertSurface();
  const earlInput = await style(`document.querySelector("textarea.ff-earl-input")`); assert(earlInput.shadow.includes("inset") && earlInput.radius >= 12, JSON.stringify(earlInput));
  await evaluate(`(()=>{const e=document.querySelector("textarea.ff-earl-input");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,"Admin fixture question");e.dispatchEvent(new Event("input",{bubbles:true}));})()`);
  await until(`!document.querySelector('button[aria-label="Send message"]').disabled`);
  const send = await style(`document.querySelector('button[aria-label="Send message"]')`); assert.equal(send.bg, "rgb(39, 170, 184)");
  await click(`document.querySelector('button[aria-label="Send message"]')`); await until(`document.body.textContent.includes(${JSON.stringify(reply)})`);
  assert.equal(writes.length, 1); assert.equal(writes[0].path, "/api/ai/chat"); assert.equal(writes[0].body.messages.at(-1).content, "Admin fixture question");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await visit("/admin"); assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), "Mobile admin overflow");
  assert(await evaluate(`document.querySelector("main").scrollWidth<=document.querySelector("main").clientWidth+1`), "Mobile admin content overflow");
  const screenshot = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync("/tmp/admin-neu-mobile.png", Buffer.from(screenshot.data, "base64"));
  await visit("/ai-assistant"); assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), "Mobile Earl overflow");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, adminTabs: tabs.length, permissions: true, payroll: true, expenses: true, vault: true, rules: true, workflowStages: true, earlSend: true, dialogs: true, mobile: true, realWrites: 0 }));
})().catch(error => { console.error(stage, error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
