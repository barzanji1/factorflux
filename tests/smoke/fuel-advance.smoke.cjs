// Run from the project root: node tests/smoke/fuel-advance.smoke.cjs
// Uses Chromium and isolated API fixtures; it never writes financial records.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const user = { id: "fixture-fuel-agent", role: "employee", firstName: "Fuel", lastName: "Agent" };
let ws, chrome, rejectCreate = true;
const rows = [], posts = [];

(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
    "--remote-debugging-port=9227", "--user-data-dir=/tmp/ff-fuel-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9227/json")).json(); if (targets.length) break; } catch {}
    await sleep(100);
  }
  assert(targets?.length, "Chromium unavailable");
  ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  let id = 0;
  const pending = new Map();
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id; pending.set(key, { resolve, reject });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  ws.on("message", async raw => {
    const event = JSON.parse(raw);
    if (event.id) {
      const callback = pending.get(event.id); pending.delete(event.id);
      if (event.error) callback?.reject(new Error(JSON.stringify(event.error))); else callback?.resolve(event.result);
      return;
    }
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params, url = new URL(request.url);
    let result = [], responseCode = 200;
    if (url.pathname === "/api/auth/verify" || url.pathname === "/api/user") result = { ...user, user };
    else if (url.pathname === "/api/auth/permissions") result = { permissions: ["fuel_advance", "carriers", "dashboard"] };
    else if (url.pathname === "/api/clients") result = [{ id: 7, name: "Fixture Carrier", status: "active" }];
    else if (url.pathname === "/api/brokers") result = [{ id: 8, name: "Fixture Broker", status: "active" }];
    else if (url.pathname === "/api/fuel-advances") {
      if (request.method === "POST") {
        const payload = Object.fromEntries([...String(request.postData || "").matchAll(
          /name="([^"]+)"\r\n\r\n([^\r\n]*)/g,
        )].map(match => [match[1], match[2]]));
        posts.push(payload);
        if (rejectCreate) {
          responseCode = 503; result = { message: "Fixture fuel-advance rejection" };
        } else {
          const amount = Number(payload.advanceAmount), fees = amount * Number(payload.faPercent) / 100;
          result = {
            id: 501, ...payload, carrierId: 7, brokerId: 8,
            carrierName: "Fixture Carrier", brokerName: "Fixture Broker",
            fees, owed: amount + fees, paid: false, status: "pending", createdAt: new Date().toISOString(),
          };
          rows.push(result); responseCode = 201;
        }
      } else result = rows;
    } else if (/unread-count|\/count$/.test(url.pathname)) result = { count: 0 };
    else if (/\/stats|\/summary/.test(url.pathname)) result = {};
    try {
      await cdp("Fetch.fulfillRequest", { requestId, responseCode,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(result)).toString("base64") });
    } catch { /* closed browser */ }
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem("isAuthenticated","true");
    localStorage.setItem("user",${JSON.stringify(JSON.stringify(user))});
  ` });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 150; i++) { if (await evaluate(`Boolean(${expression})`)) return; await sleep(100); }
    console.error(await evaluate("document.body.innerText.slice(-2500)"));
    throw Error("Timed out: " + expression);
  };
  const pointerClick = async expression => {
    const point = await evaluate(`(()=>{
      const e=${expression}; e.scrollIntoView({block:'center'});
      const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  };
  const field = label => `Array.from(document.querySelectorAll('label')).find(e=>e.textContent===${JSON.stringify(label)}).parentElement`;
  const enter = (label, value) => evaluate(`(()=>{
    const e=${field(label)}.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});
    e.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  const select = async (label, text) => {
    await pointerClick(`${field(label)}.querySelector('[role="combobox"]')`);
    await until(`Array.from(document.querySelectorAll('[role="option"]')).some(e=>e.textContent.includes(${JSON.stringify(text)}))`);
    await pointerClick(`Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.textContent.includes(${JSON.stringify(text)}))`);
  };
  await cdp("Page.navigate", { url: `https://${process.env.REPLIT_DEV_DOMAIN}/fuel-advance` });
  await until(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='New advance')`);
  await pointerClick(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='New advance')`);
  await until(`Array.from(document.querySelectorAll('label')).some(e=>e.textContent==='Load # *')`);
  await enter("Load # *", "FA-SMOKE-1");
  await select("Carrier *", "Fixture Carrier");
  await select("Broker *", "Fixture Broker");
  await enter("Rate *", "2000");
  await enter("Advance amount *", "1100");
  await pointerClick(`document.querySelector('button[type="submit"]')`);
  await sleep(300);
  assert.equal(posts.length, 0, "browser must block advance above 50% of rate");
  await enter("Advance amount *", "500");
  await until(`${field("Owed")}.querySelector('input').value==='$510.00'`);
  await pointerClick(`document.querySelector('button[type="submit"]')`);
  await until(`document.body.innerText.includes('Fixture fuel-advance rejection')`);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].carrierId, "7"); assert.equal(posts[0].brokerId, "8");
  assert.equal(posts[0].rate, "2000"); assert.equal(posts[0].loadNumber, "FA-SMOKE-1");
  assert(!posts[0].carrierName && !posts[0].advanceDate, "current UI must use normalized, not legacy payload");
  assert.equal(await evaluate(`${field("Advance amount *")}.querySelector('input').value`), "500", "failed save retains draft");
  rejectCreate = false;
  await pointerClick(`document.querySelector('button[type="submit"]')`);
  await until(`document.querySelector('tbody')?.textContent.includes('FA-SMOKE-1')`);
  assert.equal(posts.length, 2);
  assert.equal(rows.length, 1);
  assert.equal(posts[1].faPercent, "2");
  assert(await evaluate(`document.querySelector('tbody').textContent.includes('$500.00')`));
  assert(await evaluate(`document.querySelector('tbody').textContent.includes('$10.00')`));
  fs.writeFileSync("/tmp/fuel-advance-smoke.jpg", Buffer.from((await cdp("Page.captureScreenshot", { format: "jpeg", quality: 80 })).data, "base64"));
  console.log("PASS: UI reaches POST /api/fuel-advances with normalized multipart payload; 50% cap, failed-save draft, retry, and displayed totals; no financial writes");
  ws.close(); chrome.kill("SIGTERM");
})().catch(error => { console.error(error); ws?.close(); chrome?.kill("SIGTERM"); process.exitCode = 1; });
