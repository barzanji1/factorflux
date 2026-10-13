// Actual built UI, isolated API fixtures. No live documents or invoices are changed.
const { spawn } = require("node:child_process");
const { createServer } = require("node:http");
const { readFileSync, statSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { resolve, extname } = require("node:path");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = mkdtempSync("/tmp/invoice-doc-flow-");
const user = { id: "fixture-manager", role: "manager", firstName: "Fixture", lastName: "Manager", name: "Fixture Manager" };
let server, chrome, ws, seq = 0, ready = false;
const pending = new Map(), requests = [];
const doc = (id, aiDocumentType) => ({ id, invoiceId: 741, originalName: `fixture-${id}.pdf`, filename: `fixture-${id}.pdf`,
  documentType: "other", finalDocumentType: "other", candidateDocumentType: aiDocumentType, aiDocumentType,
  classificationSource: "ai", mimeType: "application/pdf", size: 100, status: "processed", createdAt: "2026-01-01T12:00:00Z" });
function api(pathname) {
  requests.push(pathname);
  if (pathname === "/api/auth/verify") return { user };
  if (pathname === "/api/auth/user") return user;
  if (pathname === "/api/auth/permissions") return { permissions: ["dashboard", "invoices", "documents", "factoring"] };
  if (pathname.endsWith("/detail")) return {
    id: 741, invoiceNumber: "DOC-FLOW-FIXTURE", loadNumber: "FIXTURE-741", amount: "100.00",
    status: ready ? "under_review" : "docs_pending", factoringStage: ready ? "verification" : "document_intake",
    clientId: 1, client: { id: 1, name: "Fixture carrier", advanceRate: "80", factoringFeeRate: "3" },
    broker: { id: 1, name: "Fixture broker" }, documents: [doc(501, "rate_confirmation"), doc(502, ready ? "bill_of_lading" : "other")],
    chargeback: { status: "none", date: null, extendedAt: null },
    notes: [], activities: [], statusHistory: [], payments: [], payouts: [],
  };
  if (pathname.endsWith("/document-status")) return {
    canStartReview: ready, canApprove: ready, completenessPercent: ready ? 100 : 50,
    missingForReview: ready ? [] : ["Bill of Lading"], missingForApproval: [], overrideApplied: null, reviews: [],
    rules: [["rate_confirmation", "Rate Confirmation", true], ["bill_of_lading", "Bill of Lading", ready]].map(([documentType, label, present]) =>
      ({ documentType, label, present, required: true, requiredForStage: "start_review", document: present ? doc(documentType === "rate_confirmation" ? 501 : 502, documentType) : null })),
  };
  if (pathname.endsWith("/available-transitions")) return [{
    id: ready ? "approve" : "start_review", to: ready ? "approved" : "under_review",
    label: ready ? "Approve Invoice" : "Begin Review", description: "Fixture lifecycle action",
    requiredRole: "manager_or_admin", variant: "primary", allowed: ready,
    canPerform: ready, canExecute: ready, blocked: !ready,
    blockers: ready ? [] : [{ code: "missing_review_docs", message: "Missing documents: Bill of Lading", severity: "error" }],
  }];
  if (pathname.endsWith("/ocr-alerts") || pathname.endsWith("/preflight")) return { alerts: [] };
  if (pathname.endsWith("/broker-confirmation")) return {
    status: "pending", events: [], canReassign: false, canResend: false,
    lastSentAt: null, confirmedAt: null, assignedAgentId: null,
  };
  if (pathname.endsWith("/timeline")) return { timeline: [] };
  if (pathname.endsWith("-count")) return { count: 0 };
  return [];
}
function call(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression) {
  for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); }
  throw new Error(`Timed out: ${expression}`);
}
async function click(expression) {
  const point = await evaluate(`(()=>{const e=${expression};e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
const tab = text => `Array.from(document.querySelectorAll('[role="tab"]')).find(e=>e.textContent.includes(${JSON.stringify(text)}))`;
const overrides = `Array.from(document.querySelectorAll("button")).filter(e=>e.textContent.includes("Override & Approve"))`;
(async () => {
  try {
    const root = resolve("dist/public");
    server = createServer((request, response) => {
      const path = new URL(request.url, "http://fixture").pathname;
      if (path.startsWith("/api/")) {
        assert.equal(request.method, "GET", "no API mutations in browser test");
        response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(api(path))); return;
      }
      let file = resolve(root, "." + path);
      try { if (!file.startsWith(root + "/") || !statSync(file).isFile()) file = resolve(root, "index.html"); }
      catch { file = resolve(root, "index.html"); }
      response.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png" })[extname(file)] ?? "application/octet-stream");
      response.end(readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9244", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore", detached: true });
    let targets;
    for (let i = 0; i < 100; i++) { try { targets = await (await fetch("http://127.0.0.1:9244/json")).json(); if (targets.length) break; } catch {} await sleep(100); }
    assert(targets?.length, "Chromium unavailable");
    ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
    await new Promise(resolve => ws.once("open", resolve));
    ws.on("message", raw => { const event = JSON.parse(raw); if (event.id) { const handler = pending.get(event.id); pending.delete(event.id); if (handler) event.error ? handler.reject(event.error) : handler.resolve(event.result); } });
    await call("Page.enable"); await call("Runtime.enable");
    await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await call("Page.addScriptToEvaluateOnNewDocument", { source: `window.__errors=[];window.addEventListener("error",e=>{if(e.error?.stack)window.__errors.push(e.error.stack)});window.addEventListener("unhandledrejection",e=>window.__errors.push(String(e.reason)));localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(user))});` });
    await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/invoices/741` });
    await until(`${tab("Paperwork")}!==undefined`);
    await click(tab("Paperwork"));
    await until(`document.body.textContent.includes("Missing: Bill of Lading")`);
    assert.equal(await evaluate(`${overrides}.length`), 0, "no override on docs_pending paperwork");
    assert.equal(await evaluate(`document.body.textContent.includes("Rate Confirmation")`), true, "AI Rate Confirmation appears despite Other upload type");
    await click(tab("Broker"));
    await until(`${tab("Broker")}.dataset.state==="active"`);
    assert.equal(await evaluate(`${overrides}.length`), 0, "no override on docs_pending broker checklist");
    const detailReads = requests.filter(path => path.endsWith("/detail")).length;
    // Simulate the server's background OCR completion (real transition logic is
    // covered separately by the rollback-only database integration test).
    ready = true;
    await until(`Array.from(document.querySelectorAll("button")).some(e=>e.textContent.trim()==="Approve Invoice")`);
    assert(requests.filter(path => path.endsWith("/detail")).length > detailReads, "pending invoice automatically refreshed without manual navigation");
    await click(tab("Paperwork"));
    await until(`document.body.textContent.includes("Document readiness: 100%")`);
    assert.equal(await evaluate(`document.body.textContent.includes("Missing: Bill of Lading")`), false);
    assert.equal(await evaluate(`${overrides}.length`), 1, "manager override is available only after review begins");
    assert.deepEqual(await evaluate(`window.__errors`), []);
    const image = await call("Page.captureScreenshot", { format: "jpeg", quality: 75 });
    writeFileSync("generated-artifacts/invoice-document-workflow.jpg", Buffer.from(image.data, "base64"));
    console.log(JSON.stringify({ passed: true, checks: ["AI display despite Other placeholder", "correct missing review list", "no override in both pending views", "automatic background refresh", "100% readiness after classification", "manager override only under_review"], liveApiWrites: 0 }));
  } catch (error) {
    if (ws?.readyState === WebSocket.OPEN) console.error(await evaluate(`({text:document.body.textContent.slice(-2500),errors:window.__errors})`));
    throw error;
  } finally {
    ws?.close();
    if (chrome?.pid) { try { process.kill(-chrome.pid, "SIGKILL"); } catch {} }
    if (server) await new Promise(resolve => server.close(resolve));
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (error) { console.error("Temporary browser cleanup:", error.code); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
