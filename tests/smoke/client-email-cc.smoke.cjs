// Browser-only API fixtures: no real emails or client records are created.
// Run: npx tsx tests/smoke/client-email-cc.smoke.cjs
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { ALL_PERMISSIONS } = require("../../shared/schema.ts");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let chrome, ws;
(async () => {
  const actor = { id: "cc-fixture", firstName: "CC", lastName: "Fixture", role: "employee", status: "active" };
  const client = { id: 123, name: "CC Test Client", email: "primary@example.test" };
  const sent = [], errors = [];
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
    "--remote-debugging-port=9241", "--user-data-dir=/tmp/ff-cc-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9241/json")).json(); if (targets.length) break; } catch {}
    await sleep(100);
  }
  assert.ok(targets?.length);
  ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  let sequence = 0;
  const pending = new Map();
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.on("message", async data => {
    const event = JSON.parse(data);
    if (event.id) {
      const call = pending.get(event.id); pending.delete(event.id);
      if (call) event.error ? call.reject(event.error) : call.resolve(event.result);
    }
    if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text);
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const path = new URL(request.url).pathname;
    let result = [], responseCode = 200;
    if (path === "/api/auth/verify") result = { user: actor };
    else if (path === "/api/auth/permissions") result = { permissions: [...ALL_PERMISSIONS] };
    else if (path === "/api/client-email/clients") result = [client];
    else if (path === "/api/client-email/config") result = { from: "notifications@truckingprosfinancial.com", replyTo: "dosh@truckingprosfinancial.com" };
    else if (path === "/api/client-email/send") {
      sent.push(JSON.parse(request.postData));
      responseCode = sent.length === 1 ? 503 : 201;
      result = sent.length === 1 ? { message: "Fixture temporary send failure" } : { status: "sent" };
    } else if (path.includes("unread") || path.endsWith("pending-count")) result = { count: 0, unreadCount: 0, messages: [] };
    await cdp("Fetch.fulfillRequest", { requestId, responseCode, responseHeaders: [{ name: "content-type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(result)).toString("base64") });
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source:
    `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(actor))});` });
  const evaluate = async expression => {
    const value = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(0,2500)")}\n${JSON.stringify(errors)}`);
  };
  const button = text => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width>0)`;
  const click = async expression => {
    await evaluate(`(()=>{const e=${expression};if(!e)throw Error("Missing target");e.scrollIntoView({block:"center",behavior:"instant"})})()`);
    await sleep(250);
    const point = await evaluate(`(()=>{const e=${expression};const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);if(!e.contains(hit))throw Error("Target intercepted by "+hit?.outerHTML?.slice(0,200));return{x,y}})()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", {
      type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
    });
    await sleep(100);
  };
  const fill = async (id, text) => {
    await click(`document.getElementById(${JSON.stringify(id)})`);
    if (!await evaluate(`document.activeElement?.id===${JSON.stringify(id)}`)) {
      await sleep(300);
      await click(`document.getElementById(${JSON.stringify(id)})`);
    }
    await until(`document.activeElement?.id===${JSON.stringify(id)}`);
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, commands: ["selectAll"] });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
    await cdp("Input.insertText", { text });
    await until(`document.getElementById(${JSON.stringify(id)}).value===${JSON.stringify(text)}`);
  };
  await cdp("Page.navigate", { url: `${process.env.TEST_APP_URL || "http://127.0.0.1:5000"}/client-email` });
  await until(`!!${button("Compose email")}`);
  await click(button("Compose email"));
  await until(`!!document.getElementById('client-email-recipient')`);
  await click(`document.getElementById('client-email-recipient')`);
  await until(`!!document.querySelector('[role="option"]')`);
  await click(`document.querySelector('[role="option"]')`);
  await fill("client-email-subject", "CC browser test");
  await fill("client-email-body", "Both the primary recipient and CC get this single message.");
  await fill("client-email-cc", "invalid-address");
  await until(`${button("Send email")}.disabled`);
  await fill("client-email-cc", "Copy@Example.com; copy@example.com, other@example.com");
  await until(`!${button("Send email")}.disabled`);
  await click(button("Send email"));
  await until(`!!document.querySelector('[role="dialog"] [role="alert"]')`);
  assert.equal(await evaluate(`document.getElementById('client-email-cc').value`), "Copy@Example.com; copy@example.com, other@example.com");
  await click(button("Send email"));
  await until(`document.getElementById('client-email-cc').value===''`);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].requestId, sent[1].requestId, "unchanged retries preserve identity");
  assert.deepEqual(sent[0].cc.map(value => value.toLowerCase()), ["copy@example.com", "other@example.com"]);
  assert.equal(sent[0].clientId, client.id);
  await fill("client-email-subject", "CC changed");
  await fill("client-email-body", "A separate draft.");
  await fill("client-email-cc", "new@example.com");
  await click(button("Send email"));
  await until(`document.getElementById('client-email-cc').value===''`);
  assert.notEqual(sent[2].requestId, sent[1].requestId);
  await fill("client-email-cc", "discard@example.com");
  await click(button("Cancel"));
  await until(`!document.querySelector('[role="dialog"]') && document.body.style.pointerEvents!=='none'`);
  await click(button("Compose email"));
  await until(`!!document.getElementById('client-email-cc')`);
  assert.equal(await evaluate(`document.getElementById('client-email-cc').value`), "");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(300);
  await fill("client-email-cc", "mobile@example.com");
  assert.ok(await evaluate(`(()=>{const r=document.getElementById('client-email-cc').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()`));
  fs.mkdirSync("generated-artifacts/client-email-cc", { recursive: true });
  const shot = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("generated-artifacts/client-email-cc/composer-mobile.png", Buffer.from(shot.data, "base64"));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, browserFixturesOnly: true, ccValidation: true, ccIncludedInSend: true,
    deduplication: true, failedDraftRetained: true, unchangedRetryIdentity: true, newDraftIdentity: true,
    resetOnReopen: true, mobileReadable: true, noRealEmailsSent: true }));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; })
  .finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
