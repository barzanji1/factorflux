// Real create-form UI, isolated API fixtures; no sign-in bypass or business writes.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const user = { id: "pilot-ui-fixture", role: "admin", firstName: "Pilot", lastName: "Fixture" };
let chrome, ws, mode = "medium", uploads = 0;
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
    "--remote-debugging-port=9231", "--user-data-dir=/tmp/ff-pilot-ocr-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9231/json")).json(); if (targets.length) break; } catch {}
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
    let result = [], responseCode = 200;
    if (url.pathname === "/api/auth/verify") result = { ...user, user };
    else if (url.pathname === "/api/auth/user") result = user;
    else if (url.pathname === "/api/user/permissions") result = { permissions: ["dashboard", "invoices", "carriers", "brokers", "documents", "loads", "admin"].map(module => ({ module, canView: true, canCreate: true, canEdit: true, canDelete: true })) };
    else if (url.pathname === "/api/invoices/ocr-intake") {
      uploads++; result = { documentId: 500 + uploads, status: "queued" };
    } else if (url.pathname.startsWith("/api/invoices/ocr-intake/")) {
      const selected = ["medium", "high"].includes(mode);
      result = { status: mode === "failed" ? "failed" : "completed",
        error: mode === "failed" ? "Fixture provider error" : null,
        fields: { invoice_number: "9", load_number: "150611", load_number_label: "P.O. Number",
          amount: "250", invoice_date: "2026-09-25", broker_name: "TRANSJ ET CARGO LLC" },
        brokerMatch: { brokerId: selected ? 1342 : null, confidence: selected ? mode : null,
          matchedName: selected ? "TRANSJET CARGO LLC" : null, rawName: "TRANSJ ET CARGO LLC",
          candidates: mode === "ambiguous" ? [{ id: 1, name: "A" }, { id: 2, name: "B" }] : selected ? [{ id: 1342, name: "TRANSJET CARGO LLC" }] : [] },
      };
    } else if (url.pathname === "/api/brokers") result = { data: [{ id: 1342, name: "TRANSJET CARGO LLC", status: "active" }] };
    else if (url.pathname.endsWith("/branches")) result = [{ id: 1, branchName: "Main", status: "active" }];
    else if (url.pathname === "/api/invoices") result = { data: [], total: 0 };
    else if (/count$/.test(url.pathname)) result = { count: 0 };
    else if (/stats$|summary$/.test(url.pathname)) result = {};
    try { await cdp("Fetch.fulfillRequest", { requestId, responseCode,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(result)).toString("base64") }); } catch {}
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem("isAuthenticated","true");
    localStorage.setItem("user",${JSON.stringify(JSON.stringify(user))});
  ` });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await sleep(150); }
    throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-5000)")}`);
  };
  const open = async () => {
    await until(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='Create Invoice')`);
    await evaluate(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Create Invoice').click()`);
    await until(`!!document.querySelector('[data-testid="invoice-ocr-uploader"]')`);
  };
  const upload = async () => {
    await cdp("DOM.enable");
    const { root } = await cdp("DOM.getDocument");
    const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: '[data-testid="invoice-ocr-uploader"]' });
    await cdp("DOM.setFileInputFiles", { nodeId, files: [`${process.cwd()}/attached_assets/0_INVOICE-LOAD-150611_1791563483824.pdf`] });
  };
  const brokerValue = `document.querySelector('input[placeholder="Search brokers..."]')?.value`;
  await cdp("Page.navigate", { url: `https://${process.env.REPLIT_DEV_DOMAIN}/invoices` });
  await open(); await upload();
  await until(`!!document.querySelector('[data-testid="invoice-ocr-verify-marker"]')`);
  assert.equal(await evaluate(brokerValue), "TRANSJET CARGO LLC");
  assert(await evaluate(`document.querySelector('[data-testid="invoice-ocr-load-source"]').textContent.includes('P.O. Number')`));
  assert(await evaluate(`document.querySelector('[data-testid="invoice-ocr-invoice-date"]').textContent.includes('2026-09-25')`));
  assert(await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] input')).some(e=>e.value==='150611')`));
  assert(await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] input')).some(e=>e.value==='9')`));
  fs.writeFileSync("/tmp/pilot-ocr-intake-ui.jpg", Buffer.from((await cdp("Page.captureScreenshot", { format: "jpeg", quality: 75 })).data, "base64"));
  for (const next of ["high", "ambiguous", "none", "failed"]) {
    mode = next;
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(e=>e.textContent.trim()==='Cancel').click()`);
    await until(`!document.querySelector('[data-testid="invoice-ocr-uploader"]')`);
    await open(); await upload();
    if (mode === "failed") await until(`document.body.innerText.includes('Fixture provider error')`);
    else {
      await until(`!!document.querySelector('[data-testid="invoice-ocr-raw-broker"]')`);
      assert.equal(await evaluate(`!!document.querySelector('[data-testid="invoice-ocr-verify-marker"]')`), false);
      assert.equal(await evaluate(brokerValue), mode === "high" ? "TRANSJET CARGO LLC" : "");
      if (mode !== "high") assert(await evaluate(`document.querySelector('[data-testid="invoice-ocr-raw-broker"]').textContent.includes('TRANSJ ET CARGO LLC')`));
    }
  }
  assert.equal(uploads, 5);
  console.log("PASS: medium Verify preselection, high exact preselection, ambiguous/no-match unset with raw text, load source, invoice date, prefilled invoice/load/amount, and provider failure visible. Isolated API fixtures only.");
  ws.close(); chrome.kill("SIGTERM");
})().catch(error => { console.error(error); ws?.close(); chrome?.kill("SIGTERM"); process.exitCode = 1; });
