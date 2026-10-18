// Browser-only fixtures; no real users, permissions or emails are modified.
// npx tsx tests/smoke/permission-refresh.smoke.cjs
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const WebSocket = require("ws");
const { ALL_PERMISSIONS } = require("../../shared/schema.ts");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = "generated-artifacts/permission-refresh";
fs.mkdirSync(directory, { recursive: true });
let chrome, ws, injection, actor, permissions, failPermissions = false, delayPermissions = 0, permissionReads = 0;
let savedPermissions;
const errors = [];
const admin = { id: "permission-admin-fixture", firstName: "Admin", lastName: "Fixture", role: "admin", status: "active" };
const agent = { id: "permission-agent-fixture", firstName: "Agent", lastName: "Fixture", email: "fixture@example.test", role: "employee", status: "active" };
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
    "--remote-debugging-port=9238", "--user-data-dir=/tmp/ff-permission-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9238/json")).json(); if (targets.length) break; } catch {}
    await sleep(100);
  }
  assert.ok(targets?.length);
  ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  let sequence = 0;
  const pending = new Map();
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
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
    const url = new URL(request.url);
    let result = [], responseCode = 200;
    try {
      if (url.pathname === "/api/auth/verify") result = { user: actor };
      else if (url.pathname === "/api/auth/permissions") {
        permissionReads++;
        const snapshot = [...permissions], failed = failPermissions;
        if (delayPermissions) await sleep(delayPermissions);
        result = failed ? { message: "Fixture refresh failure" } : { permissions: snapshot };
        responseCode = failed ? 503 : 200;
      } else if (url.pathname === "/api/admin/users") result = [agent];
      else if (/\/api\/admin\/users\/[^/]+\/permissions/.test(url.pathname)) {
        if (request.method === "PUT") {
          savedPermissions = JSON.parse(request.postData).permissions;
          result = { permissions: savedPermissions };
        } else result = { permissions: savedPermissions || [] };
      } else if (url.pathname === "/api/client-email/clients") result = [];
      else if (url.pathname === "/api/client-email/config") result = { from: "notifications@truckingprosfinancial.com", replyTo: "dosh@truckingprosfinancial.com" };
      else if (url.pathname.includes("unread") || url.pathname.endsWith("pending-count")) result = { count: 0, unreadCount: 0, mentions: 0, messages: [] };
      else if (url.pathname === "/api/it-support/meta") result = { contact: { id: admin.id, name: "Dosh Barzanji" }, isContact: false };
      await cdp("Fetch.fulfillRequest", { requestId, responseCode,
        responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "cache-control", value: "no-store" }],
        body: Buffer.from(JSON.stringify(result)).toString("base64") });
    } catch (error) {
      if (String(error.message).includes("Invalid InterceptionId")) return;
      errors.push(error.message);
      await cdp("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => {});
    }
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  const evaluate = async expression => {
    const value = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw Error(value.exceptionDetails.text);
    return value.result.value;
  };
  const shot = async name => fs.writeFileSync(`${directory}/${name}.png`, Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const until = async expression => {
    for (let i = 0; i < 180; i++) { if (await evaluate(expression)) return; await sleep(100); }
    await shot("failure");
    console.error(await evaluate("document.body.innerText.slice(-1800)"), errors);
    throw Error(`Timeout: ${expression}`);
  };
  const click = async expression => {
    const point = await evaluate(`(()=>{const e=${expression};if(!e)throw Error("Missing click target");e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
    await sleep(90);
  };
  const button = text => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width>0)`;
  const login = async (who, path, keys) => {
    actor = who; permissions = keys;
    if (injection) await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection });
    injection = (await cdp("Page.addScriptToEvaluateOnNewDocument", { source:
      `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(who))});` })).identifier;
    await cdp("Page.navigate", { url: `https://${process.env.REPLIT_DEV_DOMAIN}${path}` });
  };
  // Verify actual dialog controls and the actual outgoing save payload.
  await login(admin, "/admin", [...ALL_PERMISSIONS]);
  await until(`!!document.querySelector('button[title="Manage Permissions"]')`);
  await click(`document.querySelector('button[title="Manage Permissions"]')`);
  await until(`document.querySelectorAll('[role="dialog"] [id^="perm-"]').length===36`);
  for (const key of ALL_PERMISSIONS) assert.ok(await evaluate(`!!document.getElementById(${JSON.stringify(`perm-${key}`)})`));
  await click(button("admin defaults"));
  await until(`document.querySelectorAll('[role="dialog"] [role="switch"][aria-checked="true"]').length===36`);
  await shot("all-36-permissions");
  await click(button("Save Permissions"));
  await until(`!document.querySelector('[role="dialog"]')`);
  assert.deepEqual(savedPermissions, [...ALL_PERMISSIONS]);
  // Start denied, then grant at the server fixture without refreshing/relogging.
  await login(agent, "/client-email", ["help"]);
  await until(`document.body.innerText.includes('Access Denied')`);
  await evaluate(`window.history.pushState(null,"","/help")`);
  await until(`location.pathname==='/help' && !document.body.innerText.includes('Verifying authentication')`);
  permissions = ["help", "client_email"];
  delayPermissions = 500;
  const readsBefore = permissionReads, start = Date.now();
  // The previously denied link is hidden; exercise Wouter's standard SPA
  // history navigation without reloading the page or refreshing auth manually.
  await evaluate(`window.history.pushState(null,"","/client-email")`);
  await until(`location.pathname==='/client-email' && document.body.innerText.includes('No clients assigned to you')`);
  assert.ok(permissionReads > readsBefore, "navigation must fetch fresh permissions");
  assert.ok(Date.now() - start < 10000, "grant must not wait for 60s poll");
  assert.equal(await evaluate(`document.body.innerText.includes('Access Denied')`), false);
  await shot("agent-no-assigned-clients");
  delayPermissions = 0;
  // Background refresh must not unmount the composer and lose a draft.
  await click(button("Compose email"));
  await until(`document.body.innerText.includes('Ask an administrator to assign a client before sending email.') && !!document.querySelector('[role="dialog"]')`);
  await shot("composer-no-assigned-clients");
  const beforeSignal = permissionReads;
  await evaluate(`window.dispatchEvent(new CustomEvent('factorflux:permissions-changed',{detail:{userId:${JSON.stringify(agent.id)}}}))`);
  for (let i = 0; i < 40 && permissionReads === beforeSignal; i++) await sleep(100);
  assert.ok(permissionReads > beforeSignal);
  assert.ok(await evaluate(`!!document.querySelector('[role="dialog"]')`), "background permission refresh preserves open composer");
  // Explicit failure on next navigation is a retryable access check, not false denial.
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await until(`!document.querySelector('[role="dialog"]')`);
  failPermissions = true;
  await evaluate(`window.history.pushState(null,"","/help")`);
  await until(`document.body.innerText.includes('Retry access check')`);
  assert.equal(await evaluate(`document.body.innerText.includes('Access Denied')`), false);
  failPermissions = false;
  await click(button("Retry access check"));
  await until(`!document.body.innerText.includes('Retry access check') && !document.body.innerText.includes('Verifying authentication')`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, browserFixturesOnly: true, all36Visible: true, adminPresetAndSaveAll36: true,
    grantEffectiveOnNextNavigation: true, noAssignedClientsMessage: true, composerMessage: true,
    backgroundRefreshPreservesComposer: true, refreshFailureRetry: true, noRealAccountChanges: true }));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; })
  .finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
