// Read-only verification against actual directory data. Never logs credentials/cookies.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const profile = mkdtempSync("/tmp/ff-carrier-ar-search-");
let chrome, ws, cookie;
const pending = new Map(), requests = [];
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
  for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await sleep(100); }
  throw new Error(`Timed out: ${expression}`);
}
async function click(expression) {
  const point = await evaluate(`(()=>{const e=${expression};if(!e)throw Error("Missing control");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
async function search(placeholder, name) {
  const selector = `input[placeholder=${JSON.stringify(placeholder)}]`;
  await click(`document.querySelector(${JSON.stringify(selector)})`);
  await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(name)});e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));})()`);
  const choice = `Array.from(document.querySelectorAll("button")).find(e=>e.textContent.trim()===${JSON.stringify(name)})`;
  await until(`${choice}!==undefined`);
  await click(choice);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).value`), name);
}
(async () => {
  try {
    const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: process.env.DEV_ADMIN_EMAIL, password: process.env.DEV_ADMIN_PASSWORD }) });
    assert.equal(login.status, 200, "verification login");
    cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const { user } = await login.json();
    async function read(path) {
      const response = await fetch(base + path, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get("content-type"), /application\/json/);
      return response.json();
    }
    const legacy = await read("/api/debtors");
    const brokers = await read("/api/brokers?all=true");
    const carriers = await read("/api/clients?all=true");
    assert(Array.isArray(brokers) && brokers.length > 50, "full broker directory, beyond first page");
    assert(Array.isArray(carriers) && carriers.length > 0);
    const broker = brokers[brokers.length - 1], carrier = carriers[0];
    const serverSearch = await read(`/api/brokers?all=true&q=${encodeURIComponent(broker.name)}`);
    assert(serverSearch.some(row => row.id === broker.id), "existing server q parameter also finds target");
    chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9238", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    let targets;
    for (let i = 0; i < 100; i++) {
      try { targets = await (await fetch("http://127.0.0.1:9238/json")).json(); if (targets.length) break; } catch {}
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
      } else if (event.method === "Network.requestWillBeSent") {
        const url = new URL(event.params.request.url);
        if (url.pathname.startsWith("/api/")) requests.push({ method: event.params.request.method, path: url.pathname + url.search });
      }
    });
    await call("Page.enable"); await call("Runtime.enable"); await call("Network.enable");
    await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await call("Network.setCookies", { cookies: cookie.split("; ").map(part => {
      const index = part.indexOf("=");
      return { name: part.slice(0, index), value: part.slice(index + 1), url: "http://127.0.0.1:5000", httpOnly: true, sameSite: "Lax" };
    }) });
    await call("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(user))});` });
    await call("Page.navigate", { url: "http://127.0.0.1:5000/reports" });
    const tab = `Array.from(document.querySelectorAll('[role="tab"]')).find(e=>e.textContent.includes("Carrier AR"))`;
    await until(`${tab}!==undefined`);
    await click(tab);
    await until(`document.querySelector('input[placeholder="Search brokers..."]')!==null`);
    await search("Search brokers...", broker.name);
    await search("Search carriers...", carrier.name);
    assert(requests.some(row => row.path === "/api/brokers?all=true"), "frontend requests full broker directory");
    assert(!requests.some(row => row.path.startsWith("/api/debtors")), "report no longer requests legacy debtors");
    const submit = `Array.from(document.querySelectorAll("button")).find(e=>e.textContent.trim()==="Submit")`;
    assert.equal(await evaluate(`${submit}.disabled`), false, "both selections enable Submit");
    await click(submit);
    await until(`document.body.textContent.includes("Available Reports") && document.body.textContent.includes(${JSON.stringify(`${carrier.name} · ${broker.name}`)})`);
    assert(!requests.some(row => row.method !== "GET"), "browser verification performs no API mutations");
    const screenshot = await call("Page.captureScreenshot", { format: "jpeg", quality: 75 });
    writeFileSync("generated-artifacts/carrier-ar-broker-search.jpg", Buffer.from(screenshot.data, "base64"));
    console.log(JSON.stringify({ passed: true, legacyDebtors: legacy.length, brokers: brokers.length, carriers: carriers.length,
      selectedBrokerId: broker.id, selectedBrokerName: broker.name, selectedBeyondFirstPage: true,
      checks: ["real directory API and q parameter", "broker autocomplete selection", "carrier autocomplete selection", "correct frontend endpoint", "selected carrier/broker report header", "no mutations"] }));
  } finally {
    if (cookie) await fetch(base + "/api/auth/logout", { method: "POST", headers: { Cookie: cookie } });
    ws?.close(); chrome?.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
