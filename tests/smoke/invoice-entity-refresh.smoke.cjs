// Exercise the real invoice modal; all API traffic is isolated fixtures.
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let chrome, ws, revision = 1, fail = false, delay = 0;
const calls = [];
const user = { id: "refresh-fixture", role: "admin", firstName: "Refresh", lastName: "Fixture" };
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
    "--remote-debugging-port=9238", "--user-data-dir=/tmp/ff-invoice-refresh-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9238/json")).json(); if (targets.length) break; } catch {}
    await sleep(100);
  }
  assert(targets?.length, "Chromium unavailable");
  ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  let id = 0;
  const pending = new Map();
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id; pending.set(messageId, { resolve, reject });
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
  ws.on("message", async data => {
    const message = JSON.parse(data);
    if (message.id) {
      const call = pending.get(message.id); pending.delete(message.id);
      if (call) message.error ? call.reject(message.error) : call.resolve(message.result);
    }
    if (message.method !== "Fetch.requestPaused") return;
    const { requestId, request } = message.params;
    const url = new URL(request.url);
    calls.push({ path: url.pathname, method: request.method, revision });
    let body = [], status = 200;
    const entityRequest = /\/api\/(brokers\/701|clients\/702|carriers\/702|drivers)/.test(url.pathname);
    const r = revision;
    if (entityRequest && delay) await sleep(delay);
    if (entityRequest && fail) { status = 500; body = { message: "Refresh failed" }; }
    else if (url.pathname === "/api/auth/verify") body = { user, ...user };
    else if (url.pathname === "/api/auth/user") body = user;
    else if (url.pathname === "/api/user/permissions") body = { permissions: ["dashboard", "invoices", "carriers", "brokers", "documents", "loads", "admin"].map(module => ({ module, canView: true, canCreate: true, canEdit: true, canDelete: true })) };
    else if (url.pathname === "/api/clients") body = [{ id: 702, name: "REFRESH CARRIER", status: "active", notes: "LIST SNAPSHOT" }];
    else if (url.pathname === "/api/brokers") body = { data: [{ id: 701, name: "REFRESH BROKER", status: "active", notes: "LIST SNAPSHOT" }] };
    else if (url.pathname === "/api/brokers/701") body = { id: 701, name: "REFRESH BROKER", status: "active", notes: `BROKER CURRENT ${r}` };
    else if (url.pathname === "/api/brokers/701/branches") body = [{ id: 710 + r, branchName: `BRANCH CURRENT ${r}`, status: "active" }];
    else if (url.pathname === "/api/clients/702") body = { id: 702, name: "REFRESH CARRIER", status: "active", notes: `CARRIER CURRENT ${r}` };
    else if (url.pathname === "/api/carriers/702/bank-accounts") body = [{ id: 720 + r, bankName: `BANK CURRENT ${r}`, lastFour: "1234" }];
    else if (url.pathname === "/api/drivers") body = [{ id: 730 + r, carrierId: 702, firstName: `DRIVER${r}`, lastName: "CURRENT", status: "active" }];
    else if (url.pathname === "/api/invoices/preflight") body = { alerts: [] };
    else if (url.pathname === "/api/invoices") body = { data: [], total: 0 };
    await cdp("Fetch.fulfillRequest", { requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64") });
  });
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem("isAuthenticated", "true");
    localStorage.setItem("user", ${JSON.stringify(JSON.stringify(user))});
  ` });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-4500)")}`);
  };
  const click = async expression => {
    await until(`!!(${expression})`);
    await evaluate(`(${expression}).scrollIntoView({block:'center'})`);
    await sleep(250); // Wait for dialog/scroll animation before measuring the target.
    const point = await evaluate(`(()=>{const r=(${expression}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  const button = text => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const select = async (kind, name) => {
    await click(`document.querySelector('input[placeholder="Search ${kind}..."]')`);
    await click(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.startsWith(${JSON.stringify(name)}) && !e.textContent.includes('Create'))`);
  };
  const ready = async r => {
    await until(`document.body.innerText.includes('BROKER CURRENT ${r}') && document.body.innerText.includes('CARRIER CURRENT ${r}') && document.querySelector('#branchId').textContent.includes('BRANCH CURRENT ${r}')`);
    assert.equal(await evaluate("document.body.innerText.includes('LIST SNAPSHOT')"), false);
  };
  await cdp("Page.navigate", { url: `https://${process.env.REPLIT_DEV_DOMAIN}/invoices` });
  await click(button("Create Invoice"));
  await select("brokers", "REFRESH BROKER");
  await select("carriers", "REFRESH CARRIER");
  await ready(1);
  revision = 2; delay = 500;
  await select("brokers", "REFRESH BROKER");
  await until("document.body.innerText.includes('Refreshing broker and carrier data')");
  assert.equal(await evaluate("document.body.innerText.includes('BROKER CURRENT 1')"), false);
  await select("carriers", "REFRESH CARRIER");
  await ready(2);
  delay = 0;
  revision = 3;
  await click(button("Cancel"));
  await click(button("Create Invoice"));
  await select("brokers", "REFRESH BROKER");
  await select("carriers", "REFRESH CARRIER");
  await ready(3);
  for (const path of ["/api/brokers/701", "/api/brokers/701/branches", "/api/clients/702", "/api/carriers/702/bank-accounts", "/api/drivers"]) {
    for (const r of [1, 2, 3]) assert(calls.some(call => call.path === path && call.revision === r), `${path} refreshed in revision ${r}`);
  }
  fail = true;
  await select("brokers", "REFRESH BROKER");
  await until("document.body.innerText.includes('Unable to refresh broker or carrier data')");
  assert.equal(await evaluate("document.body.innerText.includes('BROKER CURRENT 3')"), false);
  assert(await evaluate(`(${button("Submit")}).disabled`));
  const writes = calls.filter(call => call.method !== "GET" && call.path !== "/api/invoices/preflight");
  assert.deepEqual(writes, [], "No business writes");
  console.log("PASS: selection, same-ID reselection, reopening, current branches/carrier/bank/driver data, cached-data masking and visible refresh failure. No business writes.");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  ws?.close(); chrome?.kill("SIGTERM");
});
