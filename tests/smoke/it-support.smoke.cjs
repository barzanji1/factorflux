// Real UI + real API/Neon, with test identities only and every write rolled back.
// Run: npx tsx tests/smoke/it-support.smoke.cjs (dev workflow must be running).
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const express = require("express");
const { eq, sql } = require("drizzle-orm");
const { db, pool } = require("../../server/db.ts");
const { users, itSupportRequests, itSupportResponses, itSupportNotifications } = require("../../shared/schema.ts");
const { registerItSupportRoutes } = require("../../server/routes/itSupport.ts");
const { IT_CONTACT_USER_ID } = require("../../server/services/itSupport.ts");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let chrome, ws, server, actor, injection;
const errors = [], confirmedDeletes = [], apiCalls = [];
const rollback = new Error("Rollback smoke fixtures");
const directory = "generated-artifacts/it-support";
fs.mkdirSync(directory, { recursive: true });
(async () => {
  await db.transaction(async tx => {
    const prefix = `it-ui-${randomUUID()}`;
    const people = Object.fromEntries(["admin", "staff"].map(key => [key, {
      id: `${prefix}-${key}`, firstName: "IT", lastName: `${key} Fixture`, role: key === "admin" ? "admin" : "employee",
      status: "active", isTestAccount: false,
    }]));
    await tx.insert(users).values(Object.values(people));
    const [handler] = await tx.select({
      id: users.id, firstName: users.firstName, lastName: users.lastName,
      role: users.role, status: users.status,
    }).from(users).where(eq(users.id, IT_CONTACT_USER_ID));
    assert.equal(handler?.status, "active");
    people.handler = handler;
    const app = express();
    app.use(express.json());
    registerItSupportRoutes(app, (req, res, next) => {
      if (!Object.values(people).some(person => person.id === req.header("x-fixture-user"))) return res.status(401).json({ message: "Fixture authentication required" });
      req.user = { id: req.header("x-fixture-user") }; next();
    }, tx);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const apiBase = `http://127.0.0.1:${server.address().port}`;
    chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
      "--remote-debugging-port=9237", "--user-data-dir=/tmp/ff-it-support-browser", "about:blank"], { stdio: "ignore" });
    let targets;
    for (let i = 0; i < 100; i++) {
      try { targets = await (await fetch("http://127.0.0.1:9237/json")).json(); if (targets.length) break; } catch {}
      await sleep(100);
    }
    assert(targets?.length, "Chromium unavailable");
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
      if (event.method === "Page.javascriptDialogOpening") {
        confirmedDeletes.push(event.params.message);
        await cdp("Page.handleJavaScriptDialog", { accept: true });
      }
      if (event.method !== "Fetch.requestPaused") return;
      const { requestId, request } = event.params, url = new URL(request.url);
      let result = [], responseCode = 200;
      try {
        if (url.pathname.startsWith("/api/it-support/")) {
          const response = await fetch(apiBase + url.pathname + url.search, {
            method: request.method, headers: { "Content-Type": "application/json", "x-fixture-user": actor.id },
            ...(request.postData ? { body: request.postData } : {}),
          });
          responseCode = response.status; result = await response.json();
          apiCalls.push({ method: request.method, path: url.pathname, status: responseCode });
        } else if (url.pathname === "/api/auth/verify") result = { ...actor, user: actor };
        else if (url.pathname === "/api/auth/user") result = actor;
        // Deliberately no module grants: IT Support must still be visible.
        else if (url.pathname === "/api/user/permissions") result = { permissions: [] };
        else if (url.pathname.includes("unread")) result = { count: 0, unreadCount: 0, mentions: 0, messages: [] };
        await cdp("Fetch.fulfillRequest", { requestId, responseCode,
          responseHeaders: [{ name: "content-type", value: "application/json" }],
          body: Buffer.from(JSON.stringify(result)).toString("base64") });
      } catch (error) {
        // Navigation cancels old-page interceptions while the local API finishes.
        if (error.message?.includes("Invalid InterceptionId")) return;
        errors.push(error.message);
        await cdp("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => {});
      }
    });
    await cdp("Page.enable"); await cdp("Runtime.enable");
    await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const evaluate = async expression => {
      const response = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
      return response.result.value;
    };
    const shot = async name => fs.writeFileSync(`${directory}/${name}.png`, Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
    const until = async expression => {
      for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); }
      await shot("failure"); console.error(await evaluate("document.body.innerText.slice(-1000)"));
      console.error(JSON.stringify({ apiCalls, errors }));
      throw new Error(`Timed out: ${expression}`);
    };
    const click = async expression => {
      const point = await evaluate(`(()=>{const e=${expression};if(!e)throw Error("Missing click target");e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
      await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
      await sleep(80);
    };
    const button = text => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width>0)`;
    const choose = async (selector, text) => {
      await click(selector);
      await until(`Array.from(document.querySelectorAll('[role="option"]')).some(e=>e.textContent.trim()===${JSON.stringify(text)})`);
      await click(`Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.textContent.trim()===${JSON.stringify(text)})`);
      await until(`!document.querySelector('[role="listbox"]') && ${selector}?.textContent.includes(${JSON.stringify(text)})`);
    };
    const login = async (key, suffix = "") => {
      actor = people[key];
      if (injection) await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection });
      injection = (await cdp("Page.addScriptToEvaluateOnNewDocument", { source:
        `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(actor))});` })).identifier;
      await cdp("Page.navigate", { url: `https://${process.env.REPLIT_DEV_DOMAIN}/it-support${suffix}` });
      await until(`!!document.querySelector('h1')?.textContent.includes('IT Support') && document.body.innerText.includes('Designated IT contact:') || document.body.innerText.includes('No IT contact is assigned.')`);
    };
    const count = async key => (await (await fetch(apiBase + "/api/it-support/unread-count", { headers: { "x-fixture-user": people[key].id } })).json()).count;
    await login("admin");
    assert.equal(await evaluate(`document.body.innerText.includes('Save contact')`), false);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('a')).some(a=>a.getAttribute('href')==='/tickets')`), false);
    assert.equal(await count("handler"), 0);
    await login("staff");
    await click(button("Submit Request"));
    await click(`document.querySelector('input[aria-label="Request title"]')`);
    await cdp("Input.insertText", { text: "PDF preview software issue" });
    await click(`document.querySelector('textarea[aria-label="Request description"]')`);
    await cdp("Input.insertText", { text: "The document preview button fails. Please investigate the software." });
    await choose(`document.querySelectorAll('button[role="combobox"]')[1]`, "High priority");
    await click(button("Send request"));
    await until(`document.body.innerText.includes('Your request has been submitted.') && location.search.includes('requestId=')`);
    const requestId = Number(await evaluate(`new URLSearchParams(location.search).get('requestId')`));
    assert.equal(await count("handler"), 1); assert.equal(await count("staff"), 0);
    assert.equal(await evaluate(`!!document.querySelector('#it-response')`), false);
    await login("handler");
    await until(`!!document.querySelector('[aria-label="1 unread IT support requests"]')`);
    await shot("triage-desktop");
    // IT contact must be able to select the separate personal-request view.
    await click(button("My requests"));
    await until(`document.body.innerText.includes('Requests submitted from your account')`);
    await click(button("Triage"));
    await until(`Array.from(document.querySelectorAll('button')).some(e=>e.textContent.includes('PDF preview software issue'))`);
    await click(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('PDF preview software issue'))`);
    await until(`!!document.querySelector('#it-response')`);
    assert.equal(await count("handler"), 0);
    await choose(`document.querySelector('button[role="combobox"]')`, "In Progress");
    await until(`document.body.innerText.includes('Status changed: submitted → in progress')`);
    await click(`document.querySelector('#it-response')`);
    await cdp("Input.insertText", { text: "Fixed the document preview handler. Please retry." });
    await click(button("Send response"));
    await until(`document.body.innerText.includes('Fixed the document preview handler. Please retry.')`);
    await choose(`document.querySelector('button[role="combobox"]')`, "Resolved");
    await until(`document.body.innerText.includes('Status changed: in progress → resolved')`);
    await shot("resolved-desktop");
    assert.equal(await count("staff"), 3);
    await login("staff");
    await until(`!!document.querySelector('[aria-label="3 unread IT support updates"]')`);
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await click(`document.querySelector('button:has(svg.lucide-menu)')`);
    await until(`(()=>{const r=document.querySelector('[data-state="open"][role="dialog"]')?.getBoundingClientRect();return !!r&&r.x>=-0.5})()`);
    await until(`Array.from(document.querySelectorAll('[aria-label="3 unread IT support updates"]')).some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.x>=0&&r.x<390})`);
    await shot("submitter-mobile-bell");
    await click(`Array.from(document.querySelectorAll('button')).find(e=>{const r=e.getBoundingClientRect();return e.textContent.trim().startsWith('IT Support')&&r.width>0&&r.x>=0&&r.x<390})`);
    await until(`!document.querySelector('[role="dialog"]') && document.body.style.pointerEvents!=="none"`);
    await click(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('PDF preview software issue'))`);
    await until(`document.body.innerText.includes('Fixed the document preview handler. Please retry.')`);
    assert.equal(await count("staff"), 0);
    assert.equal(await evaluate(`!!document.querySelector('#it-response')`), false);
    assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), "Mobile page must not overflow horizontally");
    await shot("submitter-mobile-detail");
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await login("handler", `?requestId=${requestId}`);
    await until(`!!${button("Delete resolved request")}`);
    await click(button("Delete resolved request"));
    await until(`document.body.innerText.includes('Resolved request deleted.')`);
    assert.equal(confirmedDeletes.length, 1);
    for (const table of [itSupportRequests, itSupportResponses, itSupportNotifications]) {
      const column = table === itSupportRequests ? table.id : table.requestId;
      const [row] = await tx.select({ count: sql`count(*)::int` }).from(table).where(eq(column, requestId));
      assert.equal(row.count, 0);
    }
    assert.equal(await count("staff"), 0); assert.equal(await count("handler"), 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, realDatabaseAndApi: true, permanentContact: true, singleMenu: true, noContactSelector: true, staffSubmit: true,
      triageBell: true, personalView: true, respondAndResolve: true, submitterBell: true,
      mobileBellAndDetail: true, scopedClearing: true, confirmedDelete: true, noOrphans: true, rolledBackFixtures: true }));
    throw rollback;
  }).catch(error => { if (error !== rollback) throw error; });
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; })
  .finally(async () => { ws?.close(); chrome?.kill("SIGKILL"); if (server) await new Promise(resolve => server.close(resolve)); await pool.end(); });
