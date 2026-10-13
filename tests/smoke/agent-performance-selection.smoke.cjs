// The built UI uses an isolated in-process API: no live staff records are changed.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:http");
const { readFileSync, statSync } = require("node:fs");
const { resolve, extname } = require("node:path");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const user = { id: "fixture-manager", role: "manager", name: "Fixture Manager", firstName: "Fixture", lastName: "Manager" };
const agents = [
  { userId: "agent-a", firstName: "Alex", lastName: "Alpha", role: "employee", invoicesProcessed: 111, totalVolumeFunded: 11100,
    invoices: [{ id: 111, invoiceNumber: "INV-A-ONLY", amount: 11100, status: "funded" }] },
  { userId: "agent-b", firstName: "Morgan", lastName: "Beta", role: "employee", invoicesProcessed: 222, totalVolumeFunded: 22200,
    invoices: [{ id: 222, invoiceNumber: "INV-B-ONLY", amount: 22200, status: "funded" }] },
];
const warnings = [
  { id: 1, userId: "agent-a", agentName: "Alex Alpha", reason: "Warning A only", severity: "written", createdAt: "2025-01-01T12:00:00Z" },
  { id: 2, userId: "agent-b", agentName: "Morgan Beta", reason: "Warning B only", severity: "verbal", createdAt: "2025-01-01T12:00:00Z" },
];
const requests = [], pending = new Map();
const profile = mkdtempSync("/tmp/ff-performance-selection-");
let chrome, ws, staticServer, seq = 0, delayA = false, rejectA = false, cancelledRequests = 0, delayWarning = false, rejectWarning = false;
function call(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression) {
  for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await sleep(100); }
  throw new Error(`Timed out: ${expression}`);
}
async function click(expression) {
  let p;
  for (let i = 0; i < 200; i++) {
    p = await evaluate(`(()=>{const e=${expression};if(!e)return null;e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`);
    if (p) break;
    await sleep(50);
  }
  assert(p, `Control is still occluded: ${expression}`);
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
  await call("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", clickCount: 1 });
}
const element = id => `document.querySelector('[data-testid="${id}"]')`;
async function choose(trigger, text) {
  await until(`${element(trigger)} && !${element(trigger)}.disabled`);
  await click(element(trigger));
  const option = `Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  await until(`${option}!==undefined`);
  await click(option);
  // Let the Radix popup finish its exit before interacting with its parent dialog.
  await until(`document.querySelector('[role="listbox"]')===null`);
}
async function setValue(expression, value, textarea = false) {
  await evaluate(`(()=>{const e=${expression};Object.getOwnPropertyDescriptor(${textarea ? "HTMLTextAreaElement" : "HTMLInputElement"}.prototype,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));})()`);
}
async function escape() {
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until(`document.querySelector('[role="dialog"]')===null`);
}
async function fixture(event, response) {
  const url = new URL(event.request.url), path = url.pathname;
  requests.push({ method: event.request.method, path, agent: url.searchParams.get("userId"), start: url.searchParams.get("startDate"), end: url.searchParams.get("endDate") });
  assert(event.request.method === "GET" || path === "/api/warnings" || /^\/api\/warnings\/\d+\/acknowledge$/.test(path), "only isolated warning mutations allowed");
  let body = [], code = 200;
  if (path === "/api/auth/verify") body = { user };
  else if (path === "/api/auth/user") body = user;
  else if (path === "/api/auth/permissions") body = { permissions: ["reports", "invoices", "dashboard", "chat"] };
  else if (path === "/api/reports/agent-performance") {
    const id = url.searchParams.get("userId");
    const visible = user.role === "employee" ? agents.filter(agent => agent.userId === user.id) : agents;
    body = id ? structuredClone(visible.find(agent => agent.userId === id)) : structuredClone(visible);
    const delta = (url.searchParams.get("startDate") === "2026-01-01" ? 1000 : url.searchParams.get("startDate") === "2026-01-02" ? 1500 : 0)
      + (url.searchParams.get("endDate") === "2026-02-01" ? 2000 : 0);
    for (const row of Array.isArray(body) ? body : body ? [body] : []) {
      row.invoicesProcessed += delta;
      row.invoices[0].invoiceNumber += `:${url.searchParams.get("startDate")}:${url.searchParams.get("endDate")}`;
    }
    if (id === "agent-a" && rejectA) { code = 400; body = { message: "Fixture forbidden report" }; }
    if (id === "agent-a" && delayA) await sleep(1200);
  } else if (path === "/api/warnings" && event.request.method === "GET") {
    body = warnings.filter(warning => (!url.searchParams.get("userId") || warning.userId === url.searchParams.get("userId")) && (user.role !== "employee" || warning.userId === user.id));
  } else if (path === "/api/warnings" && event.request.method === "POST") {
    const draft = JSON.parse(event.request.postData);
    if (delayWarning) await sleep(1200);
    if (rejectWarning) { code = 400; body = { message: "Fixture warning save rejected" }; }
    else {
      body = { ...draft, id: warnings.length + 1, agentName: draft.userId === "agent-a" ? "Alex Alpha" : "Morgan Beta", createdAt: new Date().toISOString() };
      warnings.push(body);
    }
  } else if (/^\/api\/warnings\/\d+\/acknowledge$/.test(path)) {
    const warning = warnings.find(warning => warning.id === Number(path.split("/")[3]));
    assert.equal(warning.userId, user.id, "only own fixture warning can be acknowledged");
    await sleep(200); warning.acknowledgedAt = new Date().toISOString(); body = warning;
  } else if (path === "/api/reports/global") body = {};
  else if (path.endsWith("-count")) body = { count: 0 };
  if (!response.destroyed) { response.writeHead(code, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); }
}
const table = `document.querySelector('[data-testid="agent-performance-detail"] table tbody')`;
(async () => {
  try {
    // Test the actual production bundle, not the development error-overlay plugin.
    const root = resolve("dist/public");
    staticServer = createServer((request, response) => {
      if (request.url.startsWith("/api/")) {
        response.on("close", () => { if (!response.writableEnded) cancelledRequests++; });
        let postData = "";
        request.on("data", chunk => { postData += chunk; });
        request.on("end", () => fixture({ request: { url: `http://fixture${request.url}`, method: request.method, postData } }, response).catch(error => {
          console.error(error); process.exitCode = 1; response.writeHead(500); response.end("{}");
        }));
        return;
      }
      let file = resolve(root, "." + new URL(request.url, "http://fixture").pathname);
      if (!file.startsWith(root + "/")) file = resolve(root, "index.html");
      try { if (!statSync(file).isFile()) file = resolve(root, "index.html"); }
      catch { file = resolve(root, "index.html"); }
      const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
      response.setHeader("Content-Type", mime[extname(file)] ?? "application/octet-stream");
      response.end(readFileSync(file));
    });
    await new Promise(resolve => staticServer.listen(0, "127.0.0.1", resolve));
    const appUrl = `http://127.0.0.1:${staticServer.address().port}/reports`;
    chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9239", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    let targets;
    for (let i = 0; i < 100; i++) {
      try { targets = await (await fetch("http://127.0.0.1:9239/json")).json(); if (targets.length) break; } catch {}
      await sleep(100);
    }
    assert(targets?.length, "Chromium unavailable");
    ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
    await new Promise(resolve => ws.once("open", resolve));
    ws.on("message", raw => {
      const event = JSON.parse(raw);
      if (event.id) {
        const handler = pending.get(event.id); pending.delete(event.id);
        if (handler) event.error ? handler.reject(event.error) : handler.resolve(event.result);
      }
    });
    await call("Page.enable"); await call("Runtime.enable");
    await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await call("Browser.setDownloadBehavior", { behavior: "deny" });
    await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.__testErrors=[];window.__exports=[];const originalUrl=URL.createObjectURL;URL.createObjectURL=function(blob){blob.text().then(text=>window.__exports.push(text));return originalUrl.call(URL,blob)};window.addEventListener("error",e=>window.__testErrors.push({message:e.message,stack:e.error?.stack,target:e.target?.tagName,src:e.target?.src}),true);window.addEventListener("unhandledrejection",e=>window.__testErrors.push({rejection:String(e.reason),stack:e.reason?.stack}));localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(user))});` });
    await call("Page.navigate", { url: appUrl });
    const tab = `Array.from(document.querySelectorAll('[role="tab"]')).find(e=>e.textContent.includes("Agent Performance"))`;
    await until(`${tab}!==undefined`); await click(tab);
    await until(`${table}?.textContent.includes("Alex Alpha") && ${table}?.textContent.includes("Morgan Beta")`);
    await choose("performance-agent-select", "Alex Alpha");
    await until(`${table}?.textContent.includes("Alex Alpha") && !${table}?.textContent.includes("Morgan Beta")`);
    await click(`${table}.querySelector("tr")`);
    await until(`document.querySelector('[role="dialog"]')?.textContent.includes("INV-A-ONLY")`);
    await escape();
    await click(element("performance-issue-warning"));
    await until(`${element("performance-warning-dialog")}!==null`);
    await choose("performance-warning-agent", "Alex Alpha");
    await choose("performance-warning-severity", "Final");
    await setValue(element("performance-warning-reason"), "Draft belonging to agent A", true);
    await click(element("performance-warning-cancel"));
    await until(`${element("performance-warning-dialog")}===null`);
    await choose("performance-agent-select", "All Agents");
    await until(`${table}?.querySelectorAll("tr").length===2`);
    assert.equal(await evaluate(`${element("agent-performance-detail")}.dataset.agentId`), "all");
    await choose("performance-agent-select", "Morgan Beta");
    await until(`${table}?.textContent.includes("Morgan Beta") && !${table}?.textContent.includes("Alex Alpha")`);
    assert.equal(await evaluate(`${table}.querySelectorAll("tr").length`), 1);
    await click(element("performance-issue-warning"));
    await until(`${element("performance-warning-dialog")}!==null`);
    assert.equal(await evaluate(`${element("performance-warning-reason")}.value`), "", "new employee has no previous warning draft");
    assert.equal(await evaluate(`${element("performance-warning-agent")}.textContent`), "Select agent", "previous warning target cleared");
    assert.equal(await evaluate(`${element("performance-warning-severity")}.textContent`), "Verbal", "severity resets too");
    await click(element("performance-warning-cancel"));
    await until(`document.querySelector('[role="dialog"]')===null`);
    await click(`${table}.querySelector("tr")`);
    await until(`document.querySelector('[role="dialog"]')?.textContent.includes("INV-B-ONLY")`);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes("INV-A-ONLY")`), false);
    await escape();
    const readsA = requests.filter(request => request.agent === "agent-a").length;
    agents[0].invoicesProcessed = 333;
    await choose("performance-agent-select", "All Agents");
    await choose("performance-agent-select", "Alex Alpha");
    await until(`${table}?.textContent.includes("Alex Alpha")`);
    assert(requests.filter(request => request.agent === "agent-a").length > readsA, "revisited employee is refetched, not served an old cache entry");
    assert.equal(await evaluate(`${table}.querySelector("tr").children[2].textContent`), "333", "revisit shows changed server data");
    delayA = true;
    await setValue(element("performance-from-date"), "2026-01-01");
    assert.equal(await evaluate(`${element("performance-csv")}.disabled`), true, "exports disabled during fresh fetch");
    assert.equal(await evaluate(`${table}.textContent.includes("Alex Alpha")`), false, "no old rows during refresh");
    await until(`${element("performance-agent-select")}!==null`);
    await choose("performance-agent-select", "All Agents");
    await choose("performance-agent-select", "Morgan Beta");
    await until(`${table}?.textContent.includes("Morgan Beta")`);
    await sleep(1400);
    assert.equal(await evaluate(`${table}.textContent.includes("Alex Alpha")`), false, "late previous employee response never overwrites current employee");
    assert.equal(await evaluate(`${table}.querySelectorAll("tr").length`), 1);
    assert(cancelledRequests > 0, "previous context requests actually aborted");
    assert.equal(await evaluate(`${table}.querySelector("tr").children[2].textContent`), "1222", "From date affects the fresh report");
    delayA = false;
    await setValue(element("performance-through-date"), "2026-02-01");
    await until(`${table}?.querySelector("tr")?.children[2]?.textContent==="3222"`);
    assert(requests.some(request => request.agent === "agent-b" && request.start === "2026-01-01" && request.end === "2026-02-01"), "both dates sent together");
    // Exercise the browser calendar itself, not just React's input setter.
    await evaluate(`void(window.__fromNode=${element("performance-from-date")})`);
    await call("Runtime.evaluate", { expression: `${element("performance-from-date")}.showPicker()`, userGesture: true });
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await until(`${element("performance-from-date")}.value==="2026-01-02"`);
    await until(`${table}?.querySelector("tr")?.children[2]?.textContent==="3722"`);
    assert.equal(await evaluate(`window.__fromNode===${element("performance-from-date")}`), true, "own date entry preserves its focused native control");
    await click(element("performance-csv"));
    await until(`window.__exports.length===1`);
    assert.match(await evaluate(`window.__exports[0]`), /Morgan Beta/);
    assert.doesNotMatch(await evaluate(`window.__exports[0]`), /Alex Alpha/);
    const beforeInvalid = requests.filter(request => request.path === "/api/reports/agent-performance").length;
    await setValue(element("performance-through-date"), "2025-12-01");
    await until(`document.querySelector('[role="alert"]')?.textContent.includes("on or before")`);
    assert.equal(await evaluate(`${element("performance-csv")}.disabled`), true);
    assert.equal(await evaluate(`${table}.textContent.includes("Morgan Beta")`), false);
    await sleep(150);
    assert.equal(requests.filter(request => request.path === "/api/reports/agent-performance").length, beforeInvalid, "invalid date range does not fetch a fallback report");
    await setValue(element("performance-through-date"), "");
    await until(`document.querySelector('[role="alert"]')?.textContent.includes("valid From")`);
    await setValue(element("performance-through-date"), "2026-02-01");
    await until(`${table}?.textContent.includes("Morgan Beta")`);
    await until(`${element("performance-warnings")}?.textContent.includes("Warning B only")`);
    assert.equal(await evaluate(`${element("performance-warnings")}.textContent.includes("Warning A only")`), false);
    rejectA = true;
    await choose("performance-agent-select", "Alex Alpha");
    await until(`document.querySelector('[data-testid="agent-performance-detail"] [role="alert"]')?.textContent.includes("Fixture forbidden report")`);
    assert.equal(await evaluate(`${table}.textContent.includes("Unassigned")`), false, "API error is not rendered as a report row");
    await choose("performance-agent-select", "Morgan Beta");
    await until(`${table}?.textContent.includes("Morgan Beta")`);
    assert.equal(await evaluate(`document.querySelector('[data-testid="agent-performance-detail"] [role="alert"]')`), null);
    rejectA = false;
    // Old warning success must not close or wipe a draft opened for a new agent.
    await choose("performance-agent-select", "Alex Alpha");
    await until(`${table}?.textContent.includes("Alex Alpha")`);
    await click(element("performance-issue-warning"));
    await choose("performance-warning-agent", "Alex Alpha");
    await setValue(element("performance-warning-reason"), "Pending A save", true);
    delayWarning = true;
    await click(element("performance-warning-save"));
    await until(`${element("performance-warning-save")}.disabled`);
    await click(element("performance-warning-cancel"));
    await until(`document.querySelector('[role="dialog"]')===null`);
    await choose("performance-agent-select", "Morgan Beta");
    await until(`${table}?.textContent.includes("Morgan Beta")`);
    await click(element("performance-issue-warning"));
    await choose("performance-warning-agent", "Morgan Beta");
    await setValue(element("performance-warning-reason"), "New B draft must survive", true);
    await sleep(1400);
    assert.equal(await evaluate(`${element("performance-warning-reason")}.value`), "New B draft must survive");
    delayWarning = false; rejectWarning = true;
    await click(element("performance-warning-save"));
    await until(`${element("performance-warning-dialog")}?.textContent.includes("Fixture warning save rejected")`);
    assert.equal(await evaluate(`${element("performance-warning-reason")}.value`), "New B draft must survive");
    await click(element("performance-warning-cancel"));
    await until(`document.querySelector('[role="dialog"]')===null`);
    // Closing a detail then changing either date must produce a new detail snapshot.
    await click(`${table}.querySelector("tr")`);
    await until(`document.querySelector('[role="dialog"]')?.textContent.includes("2026-01-02:2026-02-01")`);
    await escape();
    await setValue(element("performance-through-date"), "2026-02-02");
    await until(`${table}?.textContent.includes("Morgan Beta")`);
    await click(`${table}.querySelector("tr")`);
    await until(`document.querySelector('[role="dialog"]')?.textContent.includes("2026-01-02:2026-02-02")`);
    assert.equal(await evaluate(`document.querySelector('[role="dialog"]').textContent.includes("2026-01-02:2026-02-01")`), false);
    await escape();
    assert.deepEqual(await evaluate(`window.__testErrors.filter(e=>e.rejection || e.stack || (e.message && !e.message.startsWith("ResizeObserver loop")))`), [], "no JavaScript exceptions");
    const image = await call("Page.captureScreenshot", { format: "jpeg", quality: 75 });
    writeFileSync("generated-artifacts/agent-performance-selection.jpg", Buffer.from(image.data, "base64"));
    Object.assign(user, { id: "agent-a", role: "employee", name: "Alex Alpha", firstName: "Alex", lastName: "Alpha" });
    await call("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("user",${JSON.stringify(JSON.stringify(user))});` });
    await call("Page.navigate", { url: appUrl });
    await until(`${tab}!==undefined`); await click(tab);
    await until(`${table}?.textContent.includes("Alex Alpha")`);
    assert.equal(await evaluate(`${table}.textContent.includes("Morgan Beta")`), false, "employee fixture sees only own scoped report");
    assert.equal(await evaluate(`${element("performance-issue-warning")}===null`), true, "employee cannot issue warnings");
    await until(`${element("performance-warnings")}?.textContent.includes("Warning A only")`);
    const ownAck = `Array.from(document.querySelectorAll('[data-testid="performance-warnings"] button')).find(e=>e.textContent==="Acknowledge")`;
    await click(ownAck);
    await until(`${ownAck}?.disabled===true`);
    await until(`${element("performance-warnings")}?.textContent.includes("Acknowledged")`);
    assert.equal(requests.filter(request => request.method === "PATCH").length, 1);
    console.log(JSON.stringify({ passed: true, checks: ["employee A → all → B", "revisit fetches changed server data", "both date boundaries", "native calendar selection", "date field identity/focus", "invalid and empty ranges", "CSV freshness", "scoped warning history", "target/severity/reason reset", "late warning success isolation", "warning failure preserves draft", "fresh invoice details after dates", "request cancellation", "report error isolation", "employee UI scope and acknowledgment"], cancelledRequests, isolatedWarningWrites: requests.filter(request => request.method !== "GET").length, liveApiWrites: 0 }));
  } catch (error) {
    if (ws?.readyState === WebSocket.OPEN) {
      console.error("UI state", await evaluate(`({pointerEvents:document.body.style.pointerEvents,agent:document.querySelector('[data-testid="agent-performance-detail"]')?.dataset.agentId,dialogs:Array.from(document.querySelectorAll('[role="dialog"]')).map(e=>({state:e.dataset.state,text:e.textContent.slice(0,80)})),listboxes:document.querySelectorAll('[role="listbox"]').length})`));
      console.error("Select hit", await evaluate(`(()=>{const e=document.querySelector('[data-testid="performance-agent-select"]');const r=e.getBoundingClientRect();return{rect:r.toJSON(),disabled:e.disabled,pointer:getComputedStyle(e).pointerEvents,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,800)}})()`));
      console.error("Window errors", await evaluate(`window.__testErrors`));
      const image = await call("Page.captureScreenshot", { format: "jpeg", quality: 75 });
      writeFileSync("generated-artifacts/agent-performance-selection-failure.jpg", Buffer.from(image.data, "base64"));
    }
    throw error;
  } finally {
    ws?.close(); chrome?.kill(); staticServer?.close(); await sleep(300); rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
