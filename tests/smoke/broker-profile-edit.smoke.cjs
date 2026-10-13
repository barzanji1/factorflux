// Isolated browser fixture: intercept ALL API calls; never edit real broker records.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const user = { id: "fixture-admin", role: "admin", name: "Fixture Admin", firstName: "Fixture", lastName: "Admin" };
const broker = {
  id: 88107, name: "FIXTURE BROKER LLC", contactPerson: "Fixture Contact",
  email: "fixture@example.test", phone: "3035550101", address: "123 Fixture Street",
  city: "Denver", state: "CO", zipCode: "80202", mcNumber: "881234", dotNumber: "881235",
  creditLimit: 29000, currentAr: "0", paymentTerms: "net45", status: "inactive",
  notes: "Preserve these notes", assignedProcessor: user.id, creditGrade: null,
};
const writes = [];
let rejectUpdate = false, brokerReads = 0, chrome, ws;
const profile = mkdtempSync("/tmp/ff-broker-edit-");
const pending = new Map();
let seq = 0;
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression) {
  for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); }
  throw new Error(`Timed out: ${expression}`);
}
async function click(selector) {
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error("Missing control");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
async function typeName(value) {
  await evaluate(`(()=>{const e=document.querySelector('[data-testid="broker-edit-name"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));})()`);
}
async function fixture(event) {
  const request = event.request;
  const path = new URL(request.url).pathname;
  let body = [], code = 200;
  if (path === "/api/auth/verify") body = { user };
  else if (path === "/api/auth/user") body = user;
  else if (path === "/api/auth/permissions") body = { permissions: ["brokers", "invoices", "dashboard", "chat"] };
  else if (path === `/api/brokers/${broker.id}` && request.method === "GET") { body = structuredClone(broker); brokerReads++; }
  else if (request.method !== "GET") {
    assert.equal(path, `/api/brokers/${broker.id}`);
    assert.equal(request.method, "PATCH");
    const updates = JSON.parse(request.postData);
    writes.push({ path, method: request.method, updates });
    if (rejectUpdate) { code = 400; body = { message: "Isolated fixture rejection" }; }
    else { Object.assign(broker, updates); body = structuredClone(broker); }
  } else if (path.endsWith("/credit")) body = { current: null, history: [] };
  else if (path.startsWith("/api/invoices")) body = [];
  else if (path === "/api/users") body = [user];
  else if (path.endsWith("-count")) body = { count: 0 };
  await call("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: code,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }],
    body: Buffer.from(JSON.stringify(body)).toString("base64") });
}
(async () => {
  try {
    chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9237", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    let targets;
    for (let i = 0; i < 100; i++) {
      try { targets = await (await fetch("http://127.0.0.1:9237/json")).json(); if (targets.length) break; } catch {}
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
      } else if (event.method === "Fetch.requestPaused") fixture(event.params).catch(error => { console.error(error); process.exitCode = 1; });
    });
    await call("Page.enable");
    await call("Runtime.enable");
    await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await call("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    await call("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(user))});` });
    await call("Page.navigate", { url: `http://127.0.0.1:5000/brokers/${broker.id}` });
    await until(`document.querySelector('[data-testid="broker-profile-edit"]')!==null`);
    await click('[data-testid="broker-profile-edit"]');
    await until(`document.querySelector('[data-testid="broker-edit-dialog"]')!==null`);
    assert.equal(await evaluate("location.pathname"), `/brokers/${broker.id}`);
    for (const key of ["name", "contactPerson", "email", "phone", "address", "city", "state", "zipCode", "mcNumber", "dotNumber", "creditLimit", "notes"]) {
      assert.equal(await evaluate(`document.querySelector('[data-testid="broker-edit-${key}"]').value`), String(broker[key]), `prefilled ${key}`);
    }
    assert.equal(await evaluate(`document.querySelector('[data-testid="broker-edit-status"]').textContent`), "Inactive");
    assert.equal(await evaluate(`document.querySelector('[data-testid="broker-edit-paymentTerms"]').textContent`), "Net 45");
    await typeName("UNSAVED CHANGE");
    await click('[data-testid="broker-edit-cancel"]');
    await until(`document.querySelector('[data-testid="broker-edit-dialog"]')===null`);
    assert.equal(writes.length, 0);
    broker.phone = "3035550199";
    await click('[data-testid="broker-profile-edit"]');
    await until(`document.querySelector('[data-testid="broker-edit-dialog"]')!==null`);
    assert.equal(await evaluate(`document.querySelector('[data-testid="broker-edit-name"]').value`), broker.name, "cancel discards edits");
    assert.equal(await evaluate(`document.querySelector('[data-testid="broker-edit-phone"]').value`), broker.phone, "reopening refetches current data");
    await typeName("");
    await click('[data-testid="broker-edit-save"]');
    await until(`document.querySelector('[data-testid="broker-edit-dialog"]').textContent.includes("Broker name is required")`);
    assert.equal(writes.length, 0, "invalid form never submits");
    await typeName("FIXTURE BROKER UPDATED LLC");
    rejectUpdate = true;
    await click('[data-testid="broker-edit-save"]');
    await until(`document.querySelector('[data-testid="broker-edit-dialog"]').textContent.includes("Isolated fixture rejection")`);
    assert.equal(await evaluate(`document.querySelector('[data-testid="broker-edit-name"]').value`), "FIXTURE BROKER UPDATED LLC", "failed save preserves draft");
    rejectUpdate = false;
    await until(`document.querySelector('[data-testid="broker-edit-save"]').disabled===false`);
    await click('[data-testid="broker-edit-save"]');
    await until(`document.querySelector('[data-testid="broker-edit-dialog"]')===null && document.body.textContent.includes("FIXTURE BROKER UPDATED LLC")`);
    assert.equal(await evaluate("location.pathname"), `/brokers/${broker.id}`);
    assert.equal(writes.length, 2);
    assert.equal(writes[1].updates.status, "inactive");
    assert.equal(writes[1].updates.paymentTerms, "net45");
    assert.equal(writes[1].updates.creditLimit, 29000);
    assert.equal(writes[1].updates.notes, "Preserve these notes");
    await click('[data-testid="broker-profile-edit"]');
    await until(`document.querySelector('[data-testid="broker-edit-dialog"]')!==null`);
    assert.equal(await evaluate(`document.querySelector('[data-testid="broker-edit-name"]').value`), broker.name, "saved values reopen correctly");
    const image = await call("Page.captureScreenshot", { format: "jpeg", quality: 75 });
    writeFileSync("generated-artifacts/broker-profile-edit.jpg", Buffer.from(image.data, "base64"));
    console.log(JSON.stringify({ passed: true, brokerReads, isolatedPatchAttempts: writes.length, checks: ["profile URL unchanged", "all fields prefilled", "fresh data on reopen", "cancel without write", "required-field validation", "failed save preserves draft", "correct broker PATCH and preserved fields", "profile refresh and saved-value reopen"] }));
  } finally {
    ws?.close(); chrome?.kill();
    await sleep(300); rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
