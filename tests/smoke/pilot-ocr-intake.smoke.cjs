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
    else if (url.pathname === "/api/invoices/ocr-intake" && request.method === "POST") {
      uploads++; result = { documents: [
        { documentId: 501, filename: "0_CO150611_1791585912731.pdf", status: "queued" },
        { documentId: 502, filename: "0_INVOICE-LOAD-150611_1791563483824.pdf", status: "queued" },
        { documentId: 503, filename: "0_BOL150611_1791585926693.pdf", status: "queued" },
      ], status: "queued" };
    } else if (url.pathname === "/api/invoices/ocr-intake") {
      const selected = ["medium", "high"].includes(mode);
      const sources = {};
      for (const field of ["broker_name", "load_number", "rate", "pickup_date", "origin", "destination"]) {
        sources[field] = { documentId: 501, filename: "rate-con.pdf", docType: "rate_confirmation", confidence: .97 };
      }
      for (const field of ["invoice_number", "amount", "invoice_date"]) {
        sources[field] = { documentId: 502, filename: "invoice.pdf", docType: "invoice", confidence: .96 };
      }
      for (const field of ["delivery_date", "bol_number", "pod_signature"]) {
        sources[field] = { documentId: 503, filename: "bol.pdf", docType: "bol", confidence: .95 };
      }
      result = { status: mode === "failed" ? "failed" : "completed",
        error: mode === "failed" ? "Fixture provider error" : null,
        fields: { invoice_number: "9", load_number: "150611", load_number_label: "P.O. Number",
          amount: "250", rate: "250", invoice_date: "2026-09-25", broker_name: "TRANSJ ET CARGO LLC",
          pickup_date: "2026-09-23", delivery_date: "2026-09-25", origin: "Stoughton, MA",
          destination: "Natick, MA", bol_number: "BOL-55", pod_signature: mode === "mismatch" ? "false" : "true" },
        sources, missingTypes: [], tolerance: 0,
        documents: [
          { documentId: 501, filename: "0_CO150611_1791585912731.pdf", docType: "rate_confirmation", status: "completed", confidence: .97 },
          { documentId: 502, filename: "0_INVOICE-LOAD-150611_1791563483824.pdf", docType: "invoice", status: "completed", confidence: .96 },
          { documentId: 503, filename: "0_BOL150611_1791585926693.pdf", docType: "bol", status: mode === "failed" ? "failed" : "completed", confidence: .95, error: mode === "failed" ? "Fixture provider error" : null },
        ],
        alerts: mode === "mismatch" ? ["RATE_MISMATCH", "LOAD_MISMATCH", "DELIVERY_AFTER_INVOICE", "NO_SIGNATURE"].map(code => ({ code, severity: code === "NO_SIGNATURE" ? "info" : "ack", title: code, message: `${code} fixture cross-check` })) : [],
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
    await until(`!!document.querySelector('[data-testid="invoice-ocr-file-input"]')`);
  };
  const upload = async () => {
    await cdp("DOM.enable");
    const { root } = await cdp("DOM.getDocument");
    const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: '[data-testid="invoice-ocr-file-input"]' });
    await cdp("DOM.setFileInputFiles", { nodeId, files: [
      "0_CO150611_1791585912731.pdf", "0_INVOICE-LOAD-150611_1791563483824.pdf", "0_BOL150611_1791585926693.pdf",
    ].map(name => `${process.cwd()}/attached_assets/${name}`) });
    await until(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='Process document set' && !e.disabled)`);
    const point = await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Process document set');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  const brokerValue = `document.querySelector('input[placeholder="Search brokers..."]')?.value`;
  await cdp("Page.navigate", { url: `https://${process.env.REPLIT_DEV_DOMAIN}/invoices` });
  await open(); await upload();
  await until(`!!document.querySelector('[data-testid="invoice-ocr-verify-marker"]')`);
  assert.equal(await evaluate(brokerValue), "TRANSJET CARGO LLC");
  assert(await evaluate(`document.querySelector('[data-testid="invoice-ocr-source-load_number"]').textContent.includes('rate-con.pdf')`));
  assert(await evaluate(`document.querySelector('[data-testid="invoice-ocr-source-delivery_date"]').textContent.includes('bol.pdf')`));
  assert.equal(await evaluate(`document.querySelector('#invoiceDate').value`), "2026-09-25");
  assert.equal(await evaluate(`document.querySelector('#pickupDate').value`), "2026-09-23");
  assert.equal(await evaluate(`document.querySelector('#deliveryDate').value`), "2026-09-25");
  assert.equal(await evaluate(`document.querySelector('#origin').value`), "Stoughton, MA");
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-testid="invoice-ocr-dropzone"]')).borderRadius`), "0px");
  assert(await evaluate(`document.querySelector('[data-testid="invoice-ocr-signature"]').textContent.includes('Present')`));
  assert(await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] input')).some(e=>e.value==='150611')`));
  assert(await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] input')).some(e=>e.value==='9')`));
  fs.writeFileSync("/tmp/pilot-ocr-intake-ui.jpg", Buffer.from((await cdp("Page.captureScreenshot", { format: "jpeg", quality: 75 })).data, "base64"));
  for (const next of ["high", "ambiguous", "none", "mismatch", "failed"]) {
    mode = next;
    await evaluate(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(e=>e.textContent.trim()==='Cancel').click()`);
    await until(`!document.querySelector('[data-testid="invoice-ocr-file-input"]')`);
    await open(); await upload();
    if (mode === "failed") await until(`document.body.innerText.includes('Fixture provider error')`);
    else {
      await until(`!!document.querySelector('[data-testid="invoice-ocr-raw-broker"]')`);
      assert.equal(await evaluate(`!!document.querySelector('[data-testid="invoice-ocr-verify-marker"]')`), false);
      assert.equal(await evaluate(brokerValue), mode === "high" ? "TRANSJET CARGO LLC" : "");
      if (mode !== "high") assert(await evaluate(`document.querySelector('[data-testid="invoice-ocr-raw-broker"]').textContent.includes('TRANSJ ET CARGO LLC')`));
      if (mode === "mismatch") {
        assert.equal(await evaluate(`document.querySelectorAll('[data-testid="invoice-ocr-cross-check-alert"]').length`), 4);
        assert(await evaluate(`document.querySelector('[data-testid="invoice-ocr-signature"]').textContent.includes('Not detected')`));
      }
    }
  }
  assert.equal(uploads, 6);
  console.log("PASS: three-document staging/classification, square Win95 drop zone, field sources, rate/invoice/BOL precedence, dates and location prefill, signature, all four cross-check alerts, exact/fuzzy/ambiguous/missing brokers and failed provider. Isolated API fixtures only.");
  ws.close(); chrome.kill("SIGTERM");
})().catch(error => { console.error(error); ws?.close(); chrome?.kill("SIGTERM"); process.exitCode = 1; });
