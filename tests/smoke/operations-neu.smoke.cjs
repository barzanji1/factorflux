// Runs against isolated browser API fixtures: never creates real operational records or sends letters.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = fs.mkdtempSync("/tmp/ff-operations-neu-");
const actor = { id: "operations-fixture-admin", firstName: "Operations", lastName: "Fixture", role: "admin", status: "active" };
const stamp = "2026-11-01T10:00:00Z";
const dispatchers = [{ id: 81, firstName: "OpFixture", lastName: "Dispatcher", email: null, phone: null, carrierId: 7, status: "active", notes: "Fixture notes", createdAt: stamp }];
const trucks = [{ id: 82, truckNumber: "TRK-FIXTURE", vin: "12345678901234567", make: "Fixture", model: "Truck", year: 2024, licensePlate: "TEST81", state: "UT", carrierId: 7, dispatcherId: 81, status: "active", notes: "Fixture notes", createdAt: stamp }];
const letters = [{ id: 83, carrierId: 7, brokerId: 8, invoiceId: 9, letterType: "standard", status: "draft", sentAt: null, acknowledgedAt: null, createdAt: stamp, content: "OPERATIONS-LETTER-FIXTURE\nThis is an isolated release letter preview for verification." }];
let chrome, ws, sequence = 0, stage = "start";
const pending = new Map(), errors = [], writes = [];
function fixture(url, method, raw) {
  const p = url.pathname;
  if (method !== "GET") {
    assert(/^\/api\/(dispatchers|trucks)(\/\d+)?$/.test(p) && ["POST", "PATCH"].includes(method), `Unexpected write: ${method} ${p}`);
    const payload = JSON.parse(raw), rows = p.includes("dispatchers") ? dispatchers : trucks;
    writes.push({ method, path: p, payload });
    if (method === "POST") { const row = { id: 90 + writes.length, createdAt: stamp, ...payload }; rows.push(row); return row; }
    const row = rows.find(r => r.id === Number(p.split("/").pop())); Object.assign(row, payload); return row;
  }
  if (p === "/api/auth/verify") return { user: actor };
  if (p === "/api/auth/user" || p === "/api/user") return actor;
  if (p === "/api/auth/permissions") return { permissions: ["dashboard", "dispatchers", "trucks", "release_letters", "carriers", "brokers"] };
  if (p === "/api/dispatchers") return dispatchers;
  if (p === "/api/trucks") return trucks;
  if (p === "/api/release-letters") return letters;
  if (p === "/api/clients") return [{ id: 7, name: "Fixture Carrier" }];
  if (p === "/api/brokers") return [{ id: 8, name: "Fixture Broker", email: "fixture@example.invalid", contactPerson: "Fixture" }];
  if (p === "/api/invoices") return [{ id: 9, invoiceNumber: "OPERATIONS-INV-FIXTURE", clientId: 7, amount: "100", loadNumber: "OP-LOAD" }];
  if (p.includes("unread") || p.endsWith("pending-count")) return { count: 0, unreadCount: 0 };
  return [];
}
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 150 && !fs.existsSync(`${profile}/DevToolsActivePort`); i++) await sleep(100);
  const port = fs.readFileSync(`${profile}/DevToolsActivePort`, "utf8").split("\n")[0];
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  ws = new WebSocket(pages.find(p => p.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.on("message", async raw => {
    const event = JSON.parse(raw);
    if (event.id) { const call = pending.get(event.id); pending.delete(event.id); if (call) event.error ? call.reject(event.error) : call.resolve(event.result); }
    if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    try {
      const result = fixture(new URL(request.url), request.method, request.postData);
      await cdp("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(result)).toString("base64") });
    } catch (error) {
      errors.push(String(error));
      await cdp("Fetch.fulfillRequest", { requestId, responseCode: 500, body: Buffer.from('{"message":"Fixture blocked unexpected request"}').toString("base64") });
    }
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(actor))});` });
  const evaluate = async expression => {
    const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 250; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-1800)")}\n${errors.join("\n")}`);
  };
  const button = label => `Array.from(document.querySelectorAll("button")).find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
  const click = async expression => {
    await evaluate(`(${expression}).scrollIntoView({block:"center",behavior:"instant"})`); await sleep(250);
    const point = await evaluate(`(()=>{const r=(${expression}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
    await sleep(100);
  };
  const enter = async (selector, text) => {
    await click(`document.querySelector(${JSON.stringify(selector)})`);
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, commands: ["selectAll"] });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
    await cdp("Input.insertText", { text });
  };
  const style = expression => evaluate(`(()=>{const s=getComputedStyle(${expression});return{radius:parseFloat(s.borderRadius),border:s.borderTopWidth,bg:s.backgroundColor,shadow:s.boxShadow}})()`);
  const closeDialog = async () => {
    const x = `Array.from(document.querySelectorAll('[role="dialog"] > button')).find(e=>e.querySelector(".sr-only")?.textContent==="Close")`;
    const s = await style(x); assert(s.radius >= 16 && s.border === "0px", `Close button: ${JSON.stringify(s)}`);
    await click(x); await until(`!document.querySelector('[role="dialog"]')`);
  };
  const checkDialog = async () => {
    await until(`!!document.querySelector('[role="dialog"]')`);
    const s = await style(`document.querySelector('[role="dialog"]')`);
    assert(s.radius >= 16 && s.bg === "rgb(224, 224, 224)" && s.border === "0px", `Dialog: ${JSON.stringify(s)}`);
    if (await evaluate(`!!document.querySelector('[role="dialog"] input:not([type=hidden])')`)) {
      const i = await style(`document.querySelector('[role="dialog"] input:not([type=hidden])')`);
      assert(i.radius >= 12 && i.border === "0px" && i.shadow.includes("inset"), `Input: ${JSON.stringify(i)}`);
    }
  };
  const visit = async (path, text) => {
    stage = path; await cdp("Page.navigate", { url: `http://127.0.0.1:5000${path}` });
    await until(`!!document.querySelector("main table") && document.body.innerText.includes(${JSON.stringify(text)})`);
    const s = await style(`document.querySelector("main .operations-neu-surface")`);
    assert(s.radius >= 16 && s.border === "0px", `Card: ${JSON.stringify(s)}`);
    const h = await style(`document.querySelector("main th")`);
    assert(!["rgb(0, 0, 128)", "rgb(15, 23, 42)"].includes(h.bg), "Legacy table header");
  };
  await visit("/dispatchers", "OpFixture");
  await click(button("Add Dispatcher")); await checkDialog();
  await enter('[role="dialog"] input[name="firstName"]', "NewFixture");
  await enter('[role="dialog"] input[name="lastName"]', "Dispatcher");
  await click(`document.querySelector('[role="dialog"] form button[type="submit"]')`);
  await until(`!document.querySelector('[role="dialog"]') && document.body.innerText.includes("NewFixture")`);
  await click(`document.querySelector('button[aria-label="Edit OpFixture Dispatcher"]')`); await checkDialog();
  assert.equal(await evaluate(`document.querySelector('input[name="firstName"]').value`), "OpFixture");
  await enter('[role="dialog"] input[name="lastName"]', "Updated");
  await click(button("Save Changes")); await until(`!document.querySelector('[role="dialog"]') && document.body.innerText.includes("Updated")`);
  await visit("/trucks", "TRK-FIXTURE");
  await click(button("Add Truck")); await checkDialog();
  await enter('[role="dialog"] input[name="truckNumber"]', "TRK-NEW-FIXTURE");
  await click(`document.querySelector('[role="dialog"] form button[type="submit"]')`);
  await until(`!document.querySelector('[role="dialog"]') && document.body.innerText.includes("TRK-NEW-FIXTURE")`);
  await click(`document.querySelector('button[aria-label="Edit truck TRK-FIXTURE"]')`); await checkDialog();
  assert.equal(await evaluate(`document.querySelector('input[name="truckNumber"]').value`), "TRK-FIXTURE");
  await enter('[role="dialog"] input[name="make"]', "UpdatedFixture");
  await click(button("Save Changes")); await until(`!document.querySelector('[role="dialog"]')`);
  assert.equal(trucks[0].make, "UpdatedFixture");
  await visit("/release-letters", "Fixture Carrier");
  await click(button("Generate Letter")); await checkDialog(); await closeDialog();
  await click(`document.querySelector('button[aria-label="Actions for release letter 83"]')`);
  await until(`!!document.querySelector('[role="menu"]')`);
  const menuStyle = await style(`document.querySelector('[role="menu"]')`);
  assert(menuStyle.radius >= 12 && menuStyle.border === "0px", `Menu: ${JSON.stringify(menuStyle)}`);
  const preview = `Array.from(document.querySelectorAll('[role="menuitem"]')).find(e=>e.textContent.trim()==="Preview")`;
  await click(preview); await checkDialog();
  await until(`document.querySelector('[role="dialog"]').innerText.includes("OPERATIONS-LETTER-FIXTURE")`); await closeDialog();
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await visit("/trucks", "TRK-FIXTURE");
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), "Mobile overflow");
  const screen = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/operations-neu-mobile.png", Buffer.from(screen.data, "base64"));
  assert.equal(writes.length, 4); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, pages: ["dispatchers", "trucks", "release-letters"], fixtureCRUD: true, letterPreview: true, mobile: true, realWrites: 0 }));
})().catch(error => { console.error(stage, error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
