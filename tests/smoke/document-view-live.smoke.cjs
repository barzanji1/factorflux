// Read-only live document verification. Uses configured login credentials without logging them.
const { spawn } = require("node:child_process");
const { rmSync, writeFileSync } = require("node:fs");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const profile = `/tmp/document-view-browser-${Date.now()}`;
let chrome, socket, cookie;

(async () => {
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.DEV_ADMIN_EMAIL, password: process.env.DEV_ADMIN_PASSWORD }) });
  assert.equal(login.status, 200, "Configured test login failed");
  const { user } = await login.json();
  const cookies = login.headers.getSetCookie().map(value => value.split(";")[0]);
  cookie = cookies.join("; ");
  const detailResponse = await fetch(`${base}/api/invoices/189/detail`, { headers: { Cookie: cookie } });
  assert.equal(detailResponse.status, 200);
  const detail = await detailResponse.json();
  const docs = detail.documents;
  assert.equal(docs.length, 4, "Exactly one linked row per file");
  assert(docs.every(doc => doc.uploadedBy === user.id && doc.uploadedByUser?.id === user.id));
  const doc = docs.find(doc => doc.id === 95);
  assert.equal(doc.candidateDocumentType, "freight_invoice");
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
    "--remote-debugging-port=9231", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const targets = async () => (await fetch("http://127.0.0.1:9231/json")).json();
  let pages;
  for (let i = 0; i < 100; i++) { try { pages = await targets(); if (pages.length) break; } catch {} await sleep(100); }
  const main = pages.find(page => page.type === "page");
  socket = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise(resolve => socket.once("open", resolve));
  let next = 0;
  const pending = new Map();
  const browserErrors = [];
  socket.on("message", raw => {
    const event = JSON.parse(String(raw));
    if (event.method === "Log.entryAdded") browserErrors.push(event.params.entry.text);
    if (!event.id) return;
    const cb = pending.get(event.id); pending.delete(event.id);
    if (event.error) cb.reject(new Error(event.error.message)); else cb.resolve(event.result);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); }
    console.log("Visible tabs:", await evaluate(`Array.from(document.querySelectorAll('[role="tab"]')).map(e=>({text:e.textContent,state:e.getAttribute('data-state')}))`));
    writeFileSync("generated-artifacts/document-view-debug.jpg", Buffer.from((await cdp("Page.captureScreenshot", { format: "jpeg", quality: 75 })).data, "base64"));
    throw new Error(`Browser condition timed out: ${expression}`);
  };
  const click = async selector => {
    const pos = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center',behavior:'instant'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...pos });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...pos });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...pos });
  };
  await cdp("Network.enable"); await cdp("Log.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const pair of cookies) {
    const split = pair.indexOf("=");
    await cdp("Network.setCookie", { name: pair.slice(0, split), value: pair.slice(split + 1), url: base, httpOnly: true, secure: true });
  }
  await cdp("Page.navigate", { url: `${base}/login` });
  await until("document.readyState === 'complete'");
  await evaluate(`localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(user))})`);
  await cdp("Page.navigate", { url: `${base}/documents` });
  await until(`!!document.querySelector('[data-testid="document-view-95"]')`);
  const documentsRow = await evaluate(`document.querySelector('[data-testid="document-view-95"]').closest('tr').textContent`);
  assert(documentsRow.includes("Freight Invoice"), `Document row: ${documentsRow}`);
  // Reproduce the old fetch-then-blob code to identify its real browser error.
  const oldFetch = await evaluate(`fetch('/api/documents/95/view',{credentials:'include'}).then(r=>({status:r.status})).catch(e=>({error:e.message}))`);
  console.log("Old view fetch:", oldFetch);
  const cors = browserErrors.find(message => /CORS|Access-Control-Allow-Origin/.test(message));
  if (cors) console.log("Browser diagnosis:", cors.replace(/https?:\/\/[^\s'"]+/g, "[URL redacted]"));

  const openAndVerify = async (selector, pageName) => {
    const before = new Set((await targets()).map(target => target.id));
    await click(selector);
    let child;
    for (let i = 0; i < 100; i++) {
      child = (await targets()).find(target => !before.has(target.id) && target.type === "page" && target.url.includes("amazonaws.com"));
      if (child) break;
      await sleep(100);
    }
    assert(child, `${pageName}: View did not open S3 document`);
    const response = await fetch(child.url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, 75409);
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    console.log(`PASS ${pageName}: eye/View opened real document 95; HTTP 200; PDF ${bytes.length} bytes`);
    await cdp("Target.closeTarget", { targetId: child.id });
  };
  await openAndVerify('[data-testid="document-view-95"]', "Documents");
  await cdp("Page.navigate", { url: `${base}/invoices/189` });
  await until(`document.querySelectorAll('[role="tab"]').length > 0`);
  await evaluate(`([...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent.includes('Paperwork'))).dataset.testid='live-paperwork-tab'`);
  await evaluate(`document.querySelector('[data-testid="live-paperwork-tab"]').focus()`);
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await until(`!!document.querySelector('[data-testid="invoice-document-view-95"]')`);
  const card = await evaluate(`document.querySelector('[data-testid="invoice-document-view-95"]').parentElement.parentElement.textContent`);
  assert(card.includes("Freight Invoice"));
  assert(!card.includes("Uploader unavailable"));
  const uploaderName = `${doc.uploadedByUser.firstName || ""} ${doc.uploadedByUser.lastName || ""}`.trim();
  assert(card.includes(uploaderName));
  await openAndVerify('[data-testid="invoice-document-view-95"]', "Invoice detail");
  writeFileSync("generated-artifacts/document-view-live.jpg", Buffer.from((await cdp("Page.captureScreenshot", { format: "jpeg", quality: 75 })).data, "base64"));
  console.log("PASS: one document per file, matching AI classification, current uploader visible on live invoice.");
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => {
  if (cookie) await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } }).catch(() => {});
  socket?.close(); chrome?.kill("SIGTERM"); await sleep(500); rmSync(profile, { recursive: true, force: true });
});
