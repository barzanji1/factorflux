// Isolated browser API fixtures. Never sends real notifications or changes real accounts.
// Run: npx tsx tests/smoke/notification-message.smoke.cjs
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { ALL_PERMISSIONS } = require("../../shared/schema.ts");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = "generated-artifacts/notification-message";
fs.mkdirSync(directory, { recursive: true });
const admin = { id: "notification-admin-fixture", firstName: "Admin", lastName: "Fixture", role: "admin", status: "active" };
const employee = { id: "notification-employee-fixture", firstName: "Employee", lastName: "Fixture", email: "fixture@example.test", role: "employee", status: "active" };
const subject = "Complete admin message — browser verification";
const message = "Hello employee,\n\n" + "Please read this complete internal message, including all instructions. ".repeat(18)
  + "\n\n<script>window.__notificationXss=true</script>\n"
  + "Long reference: " + "X".repeat(150) + "\n\nEND OF COMPLETE MESSAGE — final instruction.";
const notifications = [];
let chrome, ws, injection, actor, nextId = 1, failRead = true;
const exceptions = [], readCalls = [];
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
    "--remote-debugging-port=9239", "--user-data-dir=/tmp/ff-notification-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9239/json")).json(); if (targets.length) break; } catch {}
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
    if (event.method === "Runtime.exceptionThrown") exceptions.push(event.params.exceptionDetails.text);
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const url = new URL(request.url);
    let result = [], responseCode = 200;
    const owned = notifications.filter(row => row.userId === actor?.id);
    try {
      if (url.pathname === "/api/auth/verify") result = { user: actor };
      else if (url.pathname === "/api/auth/permissions") result = { permissions: [...ALL_PERMISSIONS] };
      else if (url.pathname === "/api/admin/users") result = [employee];
      else if (url.pathname === "/api/admin/notify-carrier") {
        assert.equal(actor.id, admin.id);
        const body = JSON.parse(request.postData);
        const row = { id: nextId++, userId: body.userId, title: body.subject, message: body.message,
          type: "warning", read: false, actionUrl: null, entityType: null, entityId: null,
          metadata: JSON.stringify({ trigger: "admin_request_info", emailBody: body.message, sentBy: admin.id }),
          createdAt: new Date().toISOString() };
        notifications.push(row);
        result = { success: true, notification: row };
      } else if (url.pathname === "/api/notifications") result = owned;
      else if (url.pathname === "/api/notifications/unread-count") result = { count: owned.filter(row => !row.read).length };
      else if (/^\/api\/notifications\/\d+\/read$/.test(url.pathname)) {
        const id = Number(url.pathname.split("/")[3]);
        const row = owned.find(item => item.id === id);
        readCalls.push(id);
        if (!row) { result = { message: "Notification not found" }; responseCode = 404; }
        else if (failRead) { failRead = false; result = { message: "Fixture temporary read failure" }; responseCode = 503; }
        else { row.read = true; result = { message: "Notification marked as read" }; }
      } else if (url.pathname.includes("unread") || url.pathname.endsWith("pending-count")) result = { count: 0, unreadCount: 0, mentions: 0, messages: [] };
      else if (url.pathname === "/api/client-email/config") result = { from: "notifications@truckingprosfinancial.com", replyTo: "dosh@truckingprosfinancial.com" };
      await cdp("Fetch.fulfillRequest", { requestId, responseCode,
        responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "cache-control", value: "no-store" }],
        body: Buffer.from(JSON.stringify(result)).toString("base64") });
    } catch (error) {
      if (String(error.message).includes("Invalid InterceptionId")) return;
      exceptions.push(error.message);
      await cdp("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => {});
    }
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const evaluate = async expression => {
    const value = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
    return value.result.value;
  };
  const shot = async name => fs.writeFileSync(`${directory}/${name}.png`, Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  const until = async expression => {
    for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); }
    await shot("failure"); console.error(await evaluate("document.body.innerText.slice(-2000)"));
    throw Error(`Timeout: ${expression}`);
  };
  const click = async expression => {
    const point = await evaluate(`(()=>{const e=${expression};if(!e)throw Error("Missing target: "+${JSON.stringify(expression)});e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", {
      type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
    });
    await sleep(100);
  };
  const button = text => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width>0)`;
  const login = async (who, path) => {
    actor = who;
    if (injection) await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection });
    injection = (await cdp("Page.addScriptToEvaluateOnNewDocument", { source:
      `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(who))});` })).identifier;
    await cdp("Page.navigate", { url: `https://${process.env.REPLIT_DEV_DOMAIN}${path}` });
  };
  await login(admin, "/admin");
  await until(`!!${button("Notify User")}`);
  await click(button("Notify User"));
  await until(`!!document.querySelector('[role="dialog"] button[role="combobox"]')`);
  await click(`document.querySelector('[role="dialog"] button[role="combobox"]')`);
  await until(`!!document.querySelector('[role="option"]')`);
  await click(`document.querySelector('[role="option"]')`);
  await until(`!document.querySelector('[role="listbox"]')`);
  // These placeholders belong to the existing admin notification form.
  await click(`document.querySelector('[role="dialog"] input')`);
  await cdp("Input.insertText", { text: subject });
  await click(`document.querySelector('[role="dialog"] textarea')`);
  await cdp("Input.insertText", { text: message });
  await click(button("Send Notification"));
  await until(`!document.querySelector('[role="dialog"]')`);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].userId, employee.id);
  assert.equal(notifications[0].message, message);
  const messageId = notifications[0].id;
  notifications.push({ ...notifications[0], id: nextId++, title: "Linked notification regression", message: "Open the email page", actionUrl: "/client-email", metadata: null, entityType: "carrier" });
  await login(employee, "/help");
  await until(`!!document.querySelector('button[aria-label*="Notifications"]')`);
  await click(`document.querySelector('button[aria-label*="Notifications"]')`);
  await until(`Array.from(document.querySelectorAll('button')).some(e=>e.innerText.includes(${JSON.stringify(subject)}))`);
  await click(`Array.from(document.querySelectorAll('button')).find(e=>e.innerText.includes(${JSON.stringify(subject)}))`);
  await until(`!!document.querySelector('[role="dialog"]') && document.querySelector('[role="dialog"]').innerText.includes('END OF COMPLETE MESSAGE')`);
  assert.ok(await evaluate(`document.querySelector('[role="dialog"]').innerText.includes(${JSON.stringify(message)})`));
  assert.equal(await evaluate(`window.__notificationXss===true`), false);
  await until(`document.querySelector('[role="dialog"]').innerText.toLowerCase().includes('retry')`);
  assert.equal(notifications[0].read, false, "failed read acknowledgement must retain unread");
  await shot("full-message-read-retry");
  await click(`Array.from(document.querySelectorAll('[role="dialog"] button')).find(e=>e.innerText.toLowerCase().includes('retry'))`);
  for (let i = 0; i < 50 && !notifications[0].read; i++) await sleep(100);
  assert.equal(notifications[0].read, true);
  await until(`document.querySelector('button[aria-label*="Notifications"]').innerText.trim()==='1'`);
  await shot("full-message-read");
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await until(`!document.querySelector('[role="dialog"]') && document.body.style.pointerEvents!=='none'`);
  await click(`document.querySelector('button[aria-label*="Notifications"]')`);
  await click(`Array.from(document.querySelectorAll('button')).find(e=>e.innerText.includes('Linked notification regression'))`);
  await until(`location.pathname==='/client-email'`);
  await until(`document.querySelector('button[aria-label*="Notifications"]').innerText.trim()===''`);
  assert.equal(await evaluate(`!!document.querySelector('[role="dialog"]')`), false);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await click(`document.querySelector('button[aria-label*="Notifications"]')`);
  await click(`Array.from(document.querySelectorAll('button')).find(e=>e.innerText.includes(${JSON.stringify(subject)}))`);
  await until(`!!document.querySelector('[role="dialog"]') && document.querySelector('[role="dialog"]').innerText.includes('END OF COMPLETE MESSAGE')`);
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('[role="dialog"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.height<=innerHeight})()`));
  await shot("full-message-mobile");
  assert.equal(readCalls.filter(id => id === messageId).length, 2, "reopening a read message must not mark it again");
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ passed: true, browserFixturesOnly: true, adminSendForm: true, fullMessageOpens: true,
    safePlainText: true, failedReadRetry: true, unreadBellDecrements: true, linkedNavigationPreserved: true,
    mobileReadable: true, readReopenIdempotent: true, noRealNotificationsSent: true }));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; })
  .finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
