// Real browser/UI with isolated API fixtures; no auth bypass or business writes.
// node tests/smoke/documents-ocr.smoke.cjs
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const user = { id: "ocr-ui-fixture", role: "admin", firstName: "OCR", lastName: "Fixture" };
let ws, chrome, failRetry = true, retryCalls = 0, status = "failed";
const doc = () => ({
  id: 101, originalName: "OCR fixture.pdf", filename: "fixture.pdf", size: 1000,
  invoiceId: 901, documentType: "invoice", status, uploadedBy: user.id,
  createdAt: "2026-10-08T12:00:00Z",
  ocrJob: { id: 202, status: status === "failed" ? "failed" : "queued",
    errorMessage: status === "failed" ? "Textract fixture failure" : null, parserName: "textract" },
});

(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
    "--remote-debugging-port=9229", "--user-data-dir=/tmp/ff-ocr-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9229/json")).json(); if (targets.length) break; } catch {}
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
    const event = JSON.parse(String(data));
    if (event.method === "Runtime.exceptionThrown") {
      console.error("Browser exception:", event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text);
    }
    if (event.id) {
      const callback = pending.get(event.id); pending.delete(event.id);
      if (event.error) callback?.reject(new Error(JSON.stringify(event.error))); else callback?.resolve(event.result);
      return;
    }
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params, url = new URL(request.url);
    let result = [], responseCode = 200;
    if (url.pathname === "/api/auth/verify" || url.pathname === "/api/user") result = { ...user, user };
    else if (url.pathname === "/api/auth/permissions") result = { permissions: ["documents", "invoices", "carriers", "dashboard"] };
    else if (url.pathname === "/api/documents") result = [doc()];
    else if (url.pathname === "/api/load-documents/101/retry-extraction") {
      retryCalls++;
      if (failRetry) { result = { message: "Fixture retry rejected" }; responseCode = 503; }
      else { status = "processing"; result = { jobId: 203, status: "queued" }; }
    } else if (url.pathname === "/api/invoices/901/ocr-alerts") {
      result = { alerts: [{
        code: "DOCS_OCR_FAILED", severity: "info", title: "Document OCR failed",
        message: "OCR fixture.pdf: Textract fixture failure", link: "/documents",
      }] };
    } else if (url.pathname === "/api/invoices/901/detail") {
      result = { id: 901, invoiceNumber: "INV-901", amount: "1000.00", invoiceDate: "2026-10-08",
        status: "pending", factoringStage: "document_intake", client: { id: 1, name: "Fixture Carrier" },
        broker: { id: 2, name: "Fixture Broker" }, chargeback: { status: "none" },
        notes: [], documents: [], history: [], payments: [], tasks: [] };
    } else if (/document-status$/.test(url.pathname)) result = { documents: [], requirements: [], completenessPercent: 0 };
    else if (/unread-count|\/count$/.test(url.pathname)) result = { count: 0 };
    else if (/\/stats|\/summary/.test(url.pathname)) result = {};
    try {
      await cdp("Fetch.fulfillRequest", { requestId, responseCode,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(result)).toString("base64") });
    } catch {}
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
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
    console.error(await evaluate("document.body.innerText.slice(-3000)"));
    throw Error("Timed out: " + expression);
  };
  const click = async selector => {
    const point = await evaluate(`(()=>{
      const e=document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'center'});
      const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  await cdp("Page.navigate", { url: `${base}/documents` });
  await until(`document.querySelector('[data-testid="ocr-failed-101"]')?.textContent.includes('Textract fixture failure')`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="ocr-retry-101"]').disabled`), false);
  await click('[data-testid="ocr-retry-101"]');
  await until(`document.body.innerText.includes('Fixture retry rejected')`);
  assert.equal(retryCalls, 1);
  assert(await evaluate(`document.querySelector('[data-testid="ocr-retry-101"]') != null`), "failed request retains Retry");
  failRetry = false;
  await click('[data-testid="ocr-retry-101"]');
  await until(`document.querySelector('tbody')?.textContent.includes('processing')`);
  assert.equal(retryCalls, 2);
  assert.equal(await evaluate(`document.querySelector('[data-testid="ocr-retry-101"]') == null`), true);
  await cdp("Page.navigate", { url: `${base}/invoices/901` });
  await until(`document.querySelector('[data-testid="invoice-ocr-failed"]')?.textContent.includes('DOCS_OCR_FAILED')`);
  assert(await evaluate(`document.querySelector('[data-testid="invoice-ocr-failed"]').textContent.includes('Info')`));
  assert(await evaluate(`document.querySelector('[data-testid="invoice-ocr-failed"]').textContent.includes('Textract fixture failure')`));
  fs.writeFileSync("/tmp/invoice-ocr-smoke.jpg", Buffer.from((await cdp("Page.captureScreenshot", { format: "jpeg", quality: 75 })).data, "base64"));
  console.log("PASS: failed OCR error visible, Retry rejection preserved, successful retry shows processing, invoice DOCS_OCR_FAILED info alert visible; isolated fixtures only.");
  ws.close(); chrome.kill("SIGTERM");
})().catch(error => { console.error(error); ws?.close(); chrome?.kill("SIGTERM"); process.exitCode = 1; });
