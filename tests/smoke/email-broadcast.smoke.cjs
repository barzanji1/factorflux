// Isolated browser API fixtures. No real broadcasts, clients, or emails.
// Run: npx tsx tests/smoke/email-broadcast.smoke.cjs
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { randomUUID } = require("node:crypto");
const { ALL_PERMISSIONS } = require("../../shared/schema.ts");
const { BUILT_IN_EMAIL_TEMPLATES } = require("../../shared/email-templates.ts");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let chrome, ws;
(async () => {
  let actor = { id: "broadcast-admin", firstName: "Broadcast", lastName: "Admin", role: "admin", status: "active" };
  let injection, stale = true, detailPolls = 0;
  const drafts = [], confirmations = [], jobs = [], errors = [], broadcastRequests = [];
  const savedTemplates = [], templateRequests = [];
  let failTemplateSave = true;
  const clients = [
    { id: 1, name: "Fixture One", email: "one@example.test", status: "active", assignedProcessor: "employee", canSend: true, skipReason: null },
    { id: 2, name: "Fixture Two", email: "two@example.test", status: "active", assignedProcessor: "employee", canSend: true, skipReason: null },
    { id: 3, name: "Fixture Bad", email: "bad-address", status: "active", assignedProcessor: "employee", canSend: false, skipReason: "Missing or invalid email address" },
    { id: 4, name: "Fixture Inactive", email: "inactive@example.test", status: "inactive", assignedProcessor: null, canSend: true, skipReason: null },
  ];
  const counts = rows => ({ total: rows.length, sendable: rows.filter(row => row.status !== "skipped").length,
    skipped: rows.filter(row => row.status === "skipped").length, pending: rows.filter(row => row.status === "pending").length,
    sent: rows.filter(row => row.status === "sent").length, failed: rows.filter(row => row.status === "failed").length, unconfirmed: 0 });
  const match = filters => clients.filter(row => (!filters.status || row.status === filters.status)
    && (!filters.assignedProcessor || row.assignedProcessor === filters.assignedProcessor)
    && (!filters.search || row.name.toLowerCase().includes(filters.search.toLowerCase())));
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
    "--remote-debugging-port=9243", "--user-data-dir=/tmp/ff-broadcast-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9243/json")).json(); if (targets.length) break; } catch {}
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
    const url = new URL(request.url), path = url.pathname;
    let result = [], responseCode = 200;
    try {
      if (path === "/api/auth/verify") result = { user: actor };
      else if (path === "/api/auth/permissions") result = { permissions: [...ALL_PERMISSIONS] };
      else if (path === "/api/client-email/clients") result = clients;
      else if (path === "/api/client-email/config") result = { from: "notifications@truckingprosfinancial.com", replyTo: "dosh@truckingprosfinancial.com" };
      else if (path === "/api/client-email/templates") {
        if (request.method === "POST") {
          const payload = JSON.parse(request.postData); templateRequests.push(payload);
          if (failTemplateSave) {
            failTemplateSave = false; responseCode = 503; result = { message: "Fixture save failure. Retry safely." };
          } else {
            result = { ...payload, id: `custom:${randomUUID()}`, kind: "custom" };
            savedTemplates.push(result); responseCode = 201;
          }
        } else result = [...BUILT_IN_EMAIL_TEMPLATES, ...savedTemplates];
      }
      else if (path.startsWith("/api/email-broadcasts")) {
        broadcastRequests.push({ role: actor.role, path });
        if (actor.role !== "admin") { responseCode = 403; result = { message: "Administrators only" }; }
        else if (path.endsWith("/options")) result = { statuses: ["new_client", "active", "inactive"], agents: [{ id: "employee", name: "Fixture Employee" }] };
        else if (path.endsWith("/recipients")) {
          const rows = match(Object.fromEntries(url.searchParams));
          result = { clients: rows, counts: { matched: rows.length, sendable: rows.filter(row => row.canSend).length, skipped: rows.filter(row => !row.canSend).length } };
        } else if (path.endsWith("/preview")) {
          const payload = JSON.parse(request.postData); drafts.push(payload);
          const recipients = match(payload.filters).map(row => ({ id: row.id, clientId: row.id, clientName: row.name,
            email: row.email, status: row.canSend ? "pending" : "skipped", error: row.skipReason, providerMessageId: null, sentAt: null }));
          const broadcast = { id: randomUUID(), subject: payload.subject, body: payload.body, templateName: payload.templateName ?? null,
            filters: payload.filters, status: "draft", createdBy: actor.id, createdByName: "Broadcast Admin",
            createdAt: new Date().toISOString(), confirmedAt: null, completedAt: null, counts: counts(recipients) };
          result = { broadcast, recipients }; jobs.push(result); responseCode = 201;
        } else if (path.endsWith("/confirm")) {
          const job = jobs.find(row => path.includes(row.broadcast.id));
          confirmations.push(JSON.parse(request.postData));
          if (stale) { stale = false; responseCode = 409; result = { message: "Recipients changed. Preview again." }; }
          else { job.broadcast.status = "queued"; job.broadcast.confirmedAt = new Date().toISOString(); result = job; }
        } else if (path.endsWith("/cancel")) {
          const job = jobs.find(row => path.includes(row.broadcast.id)); job.broadcast.status = "cancelled"; result = job;
        } else if (path === "/api/email-broadcasts") result = jobs.map(row => row.broadcast);
        else {
          const job = jobs.find(row => path.includes(row.broadcast.id));
          if (job?.broadcast.status === "queued" && ++detailPolls >= 2) {
            job.broadcast.status = "completed"; job.broadcast.completedAt = new Date().toISOString();
            job.recipients[0] = { ...job.recipients[0], status: "sent", providerMessageId: "isolated-provider", sentAt: new Date().toISOString() };
            job.recipients[1] = { ...job.recipients[1], status: "failed", error: "Isolated provider failure" };
            job.broadcast.counts = counts(job.recipients);
          }
          result = job;
        }
      } else if (path.includes("unread") || path.endsWith("pending-count")) result = { count: 0, unreadCount: 0, messages: [] };
      await cdp("Fetch.fulfillRequest", { requestId, responseCode, responseHeaders: [{ name: "content-type", value: "application/json" }],
        body: Buffer.from(JSON.stringify(result)).toString("base64") });
    } catch (error) { errors.push(error.message); await cdp("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => {}); }
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  const evaluate = async expression => {
    const value = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 300; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-3500)")}\n${JSON.stringify(errors)}`);
  };
  const button = text => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width>0)`;
  const click = async expression => {
    await evaluate(`(()=>{const e=${expression};if(!e)throw Error("Missing target: "+${JSON.stringify(expression)});e.scrollIntoView({block:"center",behavior:"instant"})})()`);
    await sleep(250); // Let Radix's popup positioning/scroll controls settle.
    const point = await evaluate(`(()=>{const e=${expression};const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);if(!e.contains(hit))throw Error("Target intercepted by "+hit?.outerHTML?.slice(0,200));return{x,y}})()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", {
      type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
    });
    await sleep(150);
  };
  const fill = async (id, text) => {
    await click(`document.getElementById(${JSON.stringify(id)})`);
    await until(`document.activeElement?.id===${JSON.stringify(id)}`);
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, commands: ["selectAll"] });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
    await cdp("Input.insertText", { text });
    await until(`document.getElementById(${JSON.stringify(id)}).value===${JSON.stringify(text)}`);
  };
  const chooseTemplate = async (id, text) => {
    const index = await evaluate(`Array.from(document.getElementById(${JSON.stringify(id)}).options).findIndex(e=>e.textContent===${JSON.stringify(text)})`);
    assert(index >= 0, `Missing option ${text}`);
    await click(`document.getElementById(${JSON.stringify(id)})`);
    const key = async key => {
      await cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code: key });
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code: key });
      await sleep(25);
    };
    await key("Home");
    for (let i = 0; i < index; i++) await key("ArrowDown");
    await key("Enter");
    await until(`document.getElementById(${JSON.stringify(id)}).selectedOptions[0]?.textContent===${JSON.stringify(text)}`);
  };
  const login = async role => {
    actor = { ...actor, id: `broadcast-${role}`, role };
    if (injection) await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection });
    injection = (await cdp("Page.addScriptToEvaluateOnNewDocument", { source:
      `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(actor))});` })).identifier;
    await cdp("Page.navigate", { url: `https://${process.env.REPLIT_DEV_DOMAIN}/client-email` });
    await until(`!!${button("Compose email")}`);
  };
  await login("admin");
  await until(`!!document.getElementById('broadcast-subject')`);
  await until(`!!document.getElementById('broadcast-template')`);
  assert.equal(await evaluate(`document.getElementById('broadcast-template').options.length`), 16);
  await chooseTemplate("broadcast-template", "Thanksgiving");
  await until(`document.getElementById('broadcast-subject').value==="Office closed — Thanksgiving"`);
  await until(`document.getElementById('broadcast-body').value.includes("Hello [Company]")`);
  await fill("broadcast-body", "Hello [Company],\nEdited holiday notice.");
  await click(button("Add custom template"));
  await until(`!!document.getElementById('broadcast-template-template-name')`);
  await fill("broadcast-template-template-name", "Fixture custom closure");
  await fill("broadcast-template-template-subject", "Custom closure for [Company]");
  await fill("broadcast-template-template-body", "Hello [Company],\nOur custom closure hours.");
  await click(button("Save shared template"));
  await until(`document.body.innerText.includes('Template not saved.')`);
  assert.equal(await evaluate(`document.getElementById('broadcast-body').value`), "Hello [Company],\nEdited holiday notice.");
  await click(button("Save shared template"));
  await until(`!document.querySelector('[role="dialog"]') && document.getElementById('broadcast-subject').value==="Custom closure for [Company]"`);
  assert.equal(savedTemplates.length, 1);
  await login("admin");
  await until(`!!document.getElementById('broadcast-template')`);
  await until(`Array.from(document.getElementById('broadcast-template').options).some(e=>e.textContent.includes('Fixture custom closure'))`);
  await chooseTemplate("broadcast-template", "Fixture custom closure · Shared");
  await until(`document.getElementById('broadcast-body').value.includes('Our custom closure hours.')`);
  await fill("broadcast-body", "Hello [Company],\nEdited after selecting saved template.");
  await click(`document.getElementById('broadcast-status')`);
  await until(`!!document.querySelector('[role="option"][data-state]')`);
  await click(`Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.textContent==='active')`);
  await until(`document.body.innerText.includes('Fixture Bad')`);
  await fill("broadcast-subject", "Private broadcast browser check");
  await fill("broadcast-body", "This one message will be sent separately to each selected client.");
  await click(button("Preview broadcast"));
  await until(`!!document.querySelector('[role="dialog"]')`);
  assert.equal(confirmations.length, 0);
  assert.ok(await evaluate(`document.querySelector('[role="dialog"]').innerText.includes('Missing or invalid email address')`));
  assert.ok(await evaluate(`!!${button("Confirm 2 emails")}`));
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await until(`!document.querySelector('[role="dialog"]') && document.body.style.pointerEvents!=='none'`);
  await fill("broadcast-subject", "Edited subject invalidates previous preview");
  await click(button("Preview broadcast"));
  await until(`!!${button("Confirm 2 emails")}`);
  assert.notEqual(drafts[0].requestId, drafts[1].requestId);
  await click(button("Confirm 2 emails"));
  await until(`!document.querySelector('[role="dialog"]') && document.body.style.pointerEvents!=='none'`);
  await until(`document.body.innerText.includes('recipient list changed')`);
  const staleRequestId = drafts.at(-1).requestId;
  await click(button("Preview broadcast"));
  await until(`!!${button("Confirm 2 emails")}`);
  assert.notEqual(drafts.at(-1).requestId, staleRequestId);
  const directory = "generated-artifacts/email-broadcast";
  fs.mkdirSync(directory, { recursive: true });
  const screenshot = async name => {
    const shot = await cdp("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(`${directory}/${name}.png`, Buffer.from(shot.data, "base64"));
  };
  await screenshot("confirm-count");
  await click(button("Confirm 2 emails"));
  await until(`!document.querySelector('[role="dialog"]')`);
  await until(`document.body.innerText.includes('Isolated provider failure')`);
  assert.deepEqual(confirmations, [{ recipientCount: 2 }, { recipientCount: 2 }]);
  for (const draft of drafts) { assert.equal(draft.cc, undefined); assert.equal(draft.bcc, undefined); }
  assert(drafts.every(draft => draft.templateName === savedTemplates[0].id));
  await screenshot("broadcast-results");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(300);
  await fill("broadcast-subject", "Mobile broadcast");
  await click(button("Preview broadcast"));
  await until(`!!${button("Confirm 2 emails")}`);
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('[role="dialog"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height<=innerHeight})()`));
  await screenshot("mobile-confirm");
  await cdp("Emulation.clearDeviceMetricsOverride");
  for (const role of ["employee", "manager"]) {
    await login(role);
    assert.equal(await evaluate(`!!document.getElementById('broadcast-subject')`), false);
  }
  await click(button("Compose email"));
  await until(`!!document.getElementById('email-template')`);
  await until(`Array.from(document.getElementById('email-template').options).some(e=>e.textContent.includes('Fixture custom closure'))`);
  await chooseTemplate("email-template", "Fixture custom closure · Shared");
  await until(`document.getElementById('client-email-subject').value==="Custom closure for [Company]"`);
  await fill("client-email-subject", "Edited single-client closure");
  assert.equal(broadcastRequests.some(row => row.role !== "admin"), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, isolatedFixturesOnly: true, filteredAudience: true, exactCountConfirmation: true,
    noSendBeforeConfirm: true, editsInvalidatePreview: true, stalePreviewRefresh: true, progressAndFailureVisible: true,
    adminOnlyEvenWithAllPermissions: true, mobileConfirmation: true, holidayAutofillEditable: true,
    customSaveFailurePreservesDraft: true, customTemplatesSurviveReload: true, sharedWithSingleComposer: true,
    noRealBroadcastsSent: true }));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; })
  .finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
