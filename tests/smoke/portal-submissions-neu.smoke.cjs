// Presentation regression test with isolated browser API fixtures. No live writes.
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const user = { id: "portal-ui-qa", firstName: "Portal", lastName: "Reviewer", role: "admin" };
const now = new Date().toISOString();
const submissions = [
  { id: 801, portalUserId: 41, carrierId: 701, companyName: "Alpha Hauling", invoiceNumber: "QA-100",
    loadNumber: "LOAD-100", brokerName: "Alpha Broker", amount: "2500", status: "submitted", submittedAt: now,
    documents: [{ id: 91, documentType: "rate_confirmation", originalName: "rate-confirmation.pdf", mimeType: "application/pdf" }] },
  { id: 802, portalUserId: 42, carrierId: 702, companyName: "Beta Hauling", invoiceNumber: "QA-101",
    loadNumber: "LOAD-101", brokerName: "Beta Broker", amount: "1800", status: "approved", submittedAt: "2026-01-03T15:00:00Z", reviewedAt: now, documents: [] },
  { id: 803, portalUserId: 43, companyName: "Gamma Hauling", invoiceNumber: "QA-102",
    loadNumber: "LOAD-102", amount: "900", status: "rejected", submittedAt: now, reviewedAt: now, documents: [] },
];
const registrations = [
  { id: 51, companyName: "New Alpha Carrier", mcNumber: "123456", dotNumber: "654321", email: "alpha@example.test", phone: "555-0100", createdAt: now, status: "pending" },
  { id: 52, companyName: "New Beta Carrier", mcNumber: "234567", email: "beta@example.test", createdAt: now, status: "pending" },
];
const messages = [{ id: 1, senderType: "carrier", senderName: "Alpha Hauling", message: "Please review our documents.", createdAt: now }];
const mutations = [];
let chrome, socket;
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=9241",
    `--user-data-dir=/tmp/portal-neu-smoke-${process.pid}`, "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9241/json")).json(); if (targets.length) break; } catch {}
    await sleep(100);
  }
  assert(targets?.length, "Chromium unavailable");
  socket = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => socket.once("open", resolve));
  let sequence = 0;
  const pending = new Map(), errors = [];
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  socket.on("message", async raw => {
    const event = JSON.parse(raw);
    if (event.id) {
      const call = pending.get(event.id); pending.delete(event.id);
      if (call) event.error ? call.reject(event.error) : call.resolve(event.result);
    }
    if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text);
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const path = new URL(request.url).pathname;
    let result = [];
    if (path === "/api/auth/verify") result = { user };
    else if (path === "/api/auth/permissions") result = { permissions: ["portal_submissions", "chat"] };
    else if (path === "/api/carrier-portal/submissions") result = submissions;
    else if (path === "/api/carrier-portal/users") result = registrations;
    else if (path === "/api/carrier-portal/pending-count") result = { count: registrations.filter(r => r.status === "pending").length };
    else if (path === "/api/portal-submissions/unreviewed-count") result = { count: submissions.filter(s => !s.reviewedAt).length };
    else if (path === "/api/carrier-chat") result = [{ carrierId: 701, carrierName: "Alpha Hauling", mcNumber: "123456", unreadCount: 1, lastMessage: "Please review our documents.", lastMessageAt: now }];
    else if (path === "/api/carrier-chat/701") result = { carrierId: 701, messages };
    else if (path === "/api/carrier-chat/701/messages") {
      const text = /name="message"\r?\n\r?\n([\s\S]*?)\r?\n--/.exec(request.postData || "")?.[1] || "Browser fixture reply";
      result = { id: 2, senderType: "agent", senderName: "Portal Reviewer", message: text, createdAt: now };
      messages.push(result); mutations.push({ path, method: request.method });
    } else if (/\/api\/carrier-portal\/submissions\/\d+(\/review)?$/.test(path)) {
      const item = submissions.find(s => path.includes(`/${s.id}`));
      if (path.endsWith("/review")) { item.reviewedAt = now; result = item; }
      else { Object.assign(item, JSON.parse(request.postData)); result = item; }
      mutations.push({ path, method: request.method });
    } else if (/\/api\/carrier-portal\/users\/\d+\/(approve|reject)$/.test(path)) {
      const item = registrations.find(r => path.includes(`/${r.id}/`));
      item.status = path.endsWith("/approve") ? "active" : "rejected";
      result = { ...item, emailSent: true }; mutations.push({ path, method: request.method, body: request.postData });
    } else if (path.endsWith("/unread-count")) result = { count: 0 };
    await cdp("Fetch.fulfillRequest", { requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(result)).toString("base64") });
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__PORTAL_FIXTURE__=true;
    localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(user))});
  ` });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(100); }
    console.error(await evaluate("({url:location.href,text:document.body.innerText.slice(-3000)})"));
    throw new Error(`Timed out: ${expression}`);
  };
  const click = async expression => {
    const point = await evaluate(`(()=>{const e=${expression};if(!e)throw Error("Missing target");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  const tab = name => `Array.from(document.querySelectorAll('[role="tab"]')).find(e=>e.textContent.includes(${JSON.stringify(name)}))`;
  const button = (name, scope = "document") => `Array.from((${scope}).querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(name)})`;
  const panel = `document.querySelector('[role="tabpanel"]:not([hidden])')`;
  await cdp("Page.navigate", { url: "http://127.0.0.1:5000/portal-submissions" });
  await until(`window.__PORTAL_FIXTURE__ && document.querySelectorAll('[role="tabpanel"]:not([hidden]) tbody tr').length===3`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('main')).backgroundColor`), "rgb(224, 224, 224)");
  assert(await evaluate(`document.body.textContent.includes("Total Submissions") && document.body.textContent.includes("Pending Review")`));
  fs.writeFileSync("/tmp/portal-neu-list.png", Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await click(`Array.from(document.querySelectorAll('tbody tr')).find(e=>e.textContent.includes("QA-100"))`);
  await until(`!!document.querySelector('[role="dialog"]')`);
  await evaluate(`window.__openedDocuments=[];window.open=url=>{window.__openedDocuments.push(url);return null;}`);
  await click(`document.querySelector('button[aria-label="View rate-confirmation.pdf"]')`);
  assert.deepEqual(await evaluate(`window.__openedDocuments`), ["/api/portal/submissions/801/documents/91/view"]);
  assert(await evaluate(`!!document.querySelector('button[aria-label="Download rate-confirmation.pdf"]')`));
  fs.writeFileSync("/tmp/portal-neu-detail.png", Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await click(`document.querySelector('button[aria-label="Close dialog"]')`);
  await until(`!document.querySelector('[role="dialog"]')`);
  await click(button("Approve", panel));
  await until(`!!document.querySelector('#submission-status') && document.querySelector('#submission-status').value==="approved"`);
  await click(button("Approve submission", `document.querySelector('[role="dialog"]')`));
  await until(`document.body.textContent.includes("Submission updated")`);
  assert.equal(submissions[0].status, "approved");
  await click(`document.querySelector('button[aria-label="Close dialog"]')`);
  await until(`!document.querySelector('[role="dialog"]')`);
  await click(tab("Pending Registrations"));
  await until(`document.querySelectorAll('[role="tabpanel"]:not([hidden]) tbody tr').length===2`);
  await click(button("View details", panel));
  await until(`!!document.querySelector('[role="dialog"]') && document.querySelector('[role="dialog"]').textContent.includes("654321")`);
  await click(`document.querySelector('button[aria-label="Close dialog"]')`);
  await until(`!document.querySelector('[role="dialog"]')`);
  await click(button("Approve", panel));
  await until(`document.querySelectorAll('[role="tabpanel"]:not([hidden]) tbody tr').length===1`);
  await click(button("Reject", panel));
  await until(`!!document.querySelector('[role="dialog"] textarea')`);
  await click(`document.querySelector('[role="dialog"] textarea')`);
  await cdp("Input.insertText", { text: "Isolated test reason" });
  await click(button("Reject registration", `document.querySelector('[role="dialog"]')`));
  await until(`!document.querySelector('[role="dialog"]') && document.querySelectorAll('[role="tabpanel"]:not([hidden]) tbody tr').length===0 && document.body.textContent.includes("No registrations")`);
  await click(tab("Messages"));
  await until(`document.body.textContent.includes("Alpha Hauling")`);
  await click(`Array.from(document.querySelectorAll('[role="tabpanel"] button')).find(e=>e.textContent.includes("Alpha Hauling"))`);
  await until(`document.body.textContent.includes("Please review our documents.") && !!document.querySelector('textarea[placeholder="Write a message…"]')`);
  await click(`document.querySelector('textarea[placeholder="Write a message…"]')`);
  assert(await evaluate(`document.hasFocus() && document.activeElement.placeholder==="Write a message…"`));
  await cdp("Input.insertText", { text: "Isolated browser reply" });
  await click(`document.querySelector('button[title="Send message"]')`);
  await until(`document.body.textContent.includes("Isolated browser reply") && document.querySelector('textarea[placeholder="Write a message…"]').value===""`);
  fs.writeFileSync("/tmp/portal-neu-messages.png", Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await sleep(350);
  assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), "mobile page must not overflow");
  await evaluate(`document.querySelector('textarea[placeholder="Write a message…"]').scrollIntoView({block:"center"})`);
  assert(await evaluate(`Array.from(document.querySelectorAll('[role="tabpanel"]:not([hidden]) textarea,[role="tabpanel"]:not([hidden]) button')).filter(e=>e.getBoundingClientRect().width).every(e=>e.getBoundingClientRect().right<=innerWidth+1)`), "mobile controls must fit");
  fs.writeFileSync("/tmp/portal-neu-mobile.png", Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, detailsAndDocumentLinks: true, submissionApproval: true, registrationDetailsApproveReject: true, messageSend: true,
    mobile375: true, noLiveWrites: true, mutations }));
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { socket?.close(); chrome?.kill("SIGKILL"); });
