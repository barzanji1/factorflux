// Exercise the real invoice modal; all API traffic is isolated fixtures.
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const { mkdirSync, writeFileSync, readFileSync, statSync } = require("node:fs");
const { createServer } = require("node:http");
const { resolve, extname } = require("node:path");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const creationHold = process.argv.includes("--creation-hold");
const created = [];
let chrome, ws, server, revision = 1, fail = false, delay = 0;
const calls = [];
const user = { id: "refresh-fixture", role: creationHold ? "employee" : "admin", firstName: "Refresh", lastName: "Fixture" };
(async () => {
  // Verify the built frontend without development-only external overlays.
  const root = resolve("dist/public");
  server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://fixture").pathname;
    let file = resolve(root, "." + pathname);
    try { if (!file.startsWith(root + "/") || !statSync(file).isFile()) file = resolve(root, "index.html"); }
    catch { file = resolve(root, "index.html"); }
    response.setHeader("Content-Type", ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png" })[extname(file)] ?? "application/octet-stream");
    response.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
    "--remote-debugging-port=9238", "--user-data-dir=/tmp/ff-invoice-refresh-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9238/json")).json(); if (targets.length) break; } catch {}
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
    calls.push({ path: url.pathname, method: request.method, revision });
    let body = [], status = 200;
    const entityRequest = /\/api\/(brokers\/701|clients\/702|carriers\/702)/.test(url.pathname);
    const r = revision;
    if (entityRequest && delay) await sleep(delay);
    if (entityRequest && fail) { status = 500; body = { message: "Refresh failed" }; }
    else if (url.pathname === "/api/auth/verify") body = { user, ...user };
    else if (url.pathname === "/api/auth/user") body = user;
    else if (url.pathname === "/api/auth/permissions") body = { permissions: ["dashboard", "invoices", "carriers", "brokers", "documents", "loads", "factoring"] };
    else if (url.pathname === "/api/user/permissions") body = { permissions: ["dashboard", "invoices", "carriers", "brokers", "documents", "loads", "admin"].map(module => ({ module, canView: true, canCreate: true, canEdit: true, canDelete: true })) };
    else if (url.pathname === "/api/clients") body = [{ id: 702, name: "REFRESH CARRIER", status: "active", notes: "LIST SNAPSHOT" }];
    else if (url.pathname === "/api/brokers") body = { data: [{ id: 701, name: "REFRESH BROKER", status: "active", notes: "LIST SNAPSHOT" }] };
    else if (url.pathname === "/api/brokers/701") body = { id: 701, name: "REFRESH BROKER", status: "active", notes: `BROKER CURRENT ${r}` };
    else if (url.pathname === "/api/brokers/701/branches") body = [{ id: 710 + r, branchName: `BRANCH CURRENT ${r}`, status: "active" }];
    else if (url.pathname === "/api/clients/702") body = { id: 702, name: "REFRESH CARRIER", status: "active", notes: `CARRIER CURRENT ${r}` };
    else if (url.pathname === "/api/carriers/702/bank-accounts") body = [{ id: 720 + r, bankName: `BANK CURRENT ${r}`, lastFour: "1234" }];
    else if (url.pathname === "/api/invoices/hold-recipients") body = { options: [
      ...["Managers", "Mia", "Jose", "Alan"].map(label => ({ value: label.toLowerCase(), label, available: true })),
      { value: "jess", label: "Jess", available: false, unavailableReason: "No active staff account found." },
    ] };
    else if (url.pathname === "/api/invoices/preflight") body = { alerts: [] };
    else if (url.pathname === "/api/invoices/with-documents") {
      const multipart = request.postData;
      assert(multipart, "Creation request includes multipart metadata");
      const match = multipart.match(/\r\n\r\n(\{[^\r\n]+\})\r\n/);
      assert(match, "Invoice metadata found in multipart payload");
      const metadata = JSON.parse(match[1]);
      if (metadata.lumper === true) assert(multipart.includes('name="lumperReceipt";'), "Lumper Yes includes receipt file");
      created.push(metadata);
      body = { id: 741, invoiceNumber: "INV-FIXTURE", status: metadata.holdForManagerReview ? "held" : "submitted" };
    }
    else if (url.pathname === "/api/invoices") body = { data: [], total: 0 };
    await cdp("Fetch.fulfillRequest", { requestId, responseCode: status,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64") });
  });
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem("isAuthenticated", "true");
    localStorage.setItem("user", ${JSON.stringify(JSON.stringify(user))});
  ` });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error(`Timed out: ${expression}\n${await evaluate("document.body.innerText.slice(-4500)")}`);
  };
  const click = async expression => {
    await until(`!!(${expression})`);
    await evaluate(`(${expression}).scrollIntoView({block:'center'})`);
    await sleep(250); // Wait for dialog/scroll animation before measuring the target.
    const point = await evaluate(`(()=>{const r=(${expression}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  const button = text => `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const select = async (kind, name) => {
    await click(`document.querySelector('input[placeholder="Search ${kind}..."]')`);
    await click(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.startsWith(${JSON.stringify(name)}) && !e.textContent.includes('Create'))`);
  };
  const ready = async r => {
    await until(`document.body.innerText.includes('BROKER CURRENT ${r}') && document.body.innerText.includes('CARRIER CURRENT ${r}') && document.querySelector('#branchId').textContent.includes('BRANCH CURRENT ${r}')`);
    assert.equal(await evaluate("document.body.innerText.includes('LIST SNAPSHOT')"), false);
  };
  await cdp("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/invoices` });
  await click(button("Create Invoice"));
  await select("brokers", "REFRESH BROKER");
  await select("carriers", "REFRESH CARRIER");
  await ready(1);
  if (creationHold) {
    const setInput = async (id, value) => evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("input",{bubbles:true}));})()`);
    const choose = async (trigger, value) => {
      await click(trigger);
      await click(`Array.from(document.querySelectorAll('[role="option"]')).find(e=>e.textContent.trim()===${JSON.stringify(value)})`);
    };
    const lumperSelect = `Array.from(document.querySelectorAll('label')).find(e=>e.textContent.trim()==="Lumper").parentElement.querySelector('[role="combobox"]')`;
    const target = name => `Array.from(document.querySelectorAll('label')).find(e=>e.querySelector('[role="checkbox"]') && e.textContent.includes(${JSON.stringify(name)})).querySelector('[role="checkbox"]')`;
    const fill = async () => {
      await setInput("loadNumber", "HOLD-FIXTURE");
      await setInput("rateAmount", "125");
      await setInput("lumperTotal", "45.50");
      await evaluate(`(()=>{
        const inputs=Array.from(document.querySelectorAll('input[type="file"]:not([multiple])'));
        if(inputs.length<2)throw new Error("Paperwork inputs missing");
        for(let i=0;i<2;i++){const dt=new DataTransfer();dt.items.add(new File(["%PDF-1.4\\nfixture"],"fixture-"+i+".pdf",{type:"application/pdf"}));inputs[i].files=dt.files;inputs[i].dispatchEvent(new Event("change",{bubbles:true}));}
      })()`);
    };
    for (const id of ["driverName", "bolNumber", "amount"]) assert.equal(await evaluate(`!!document.getElementById(${JSON.stringify(id)})`), false, `${id} removed`);
    assert.equal(await evaluate(`Array.from(document.querySelectorAll('label')).some(e=>["Driver","Driver Name","BOL #","Invoice Amount"].includes(e.textContent.trim()))`), false);
    assert.equal(await evaluate(`!!document.querySelector('input[placeholder="Instructions Subject"]')`), false);
    assert(await evaluate(`!!document.querySelector('textarea[placeholder="please be clear and specific"]')`), "instructions body retained");
    assert(await evaluate(`!!document.querySelector('[aria-label="Upload Bill of Lading (required)"]') || Array.from(document.querySelectorAll('[role="button"]')).some(e=>e.getAttribute("aria-label")?.startsWith("Upload Bill of Lading"))`), "BOL upload retained");
    assert(await evaluate(`!!document.querySelector('#holdForManagerReview')`), "employee sees hold option");
    assert.equal(await evaluate(`document.querySelector('#holdForManagerReview').getAttribute("aria-checked")`), "false");
    await fill();
    await until(`!(${button("Submit")}).disabled`);
    await click(button("Submit"));
    await until(`!document.querySelector('#holdForManagerReview')`);
    assert.equal(created.length, 1);
    assert.equal(created[0].lumper, null, "empty lumper submits");
    assert.equal(created[0].holdForManagerReview, false);
    assert.equal(Number(created[0].amount), 125, "Rate is canonical invoice amount");
    assert.equal(created[0].lumperTotal, "45.50", "lumper total remains separate");
    for (const field of ["driverId", "driverName", "instructionsSubject", "rate"]) assert.equal(field in created[0], false, `${field} not sent`);
    for (const [index, reason] of ["Missing docs", "Missing signature on BOL", "Missing signature on Rate Con"].entries()) {
      await click(button("Create Invoice"));
      await select("brokers", "REFRESH BROKER");
      await select("carriers", "REFRESH CARRIER");
      await ready(1);
      assert.equal(await evaluate(`document.querySelector('#holdForManagerReview').getAttribute("aria-checked")`), "false", "hold resets on reopen");
      await fill();
      await choose(lumperSelect, "No");
      await until(`!(${button("Submit")}).disabled`);
      if (index === 0) {
        await choose(lumperSelect, "Yes");
        await until(`(${button("Submit")}).disabled`);
        assert(await evaluate(`document.body.innerText.includes("Lumper Receipt is required")`));
        await evaluate(`(()=>{const e=Array.from(document.querySelectorAll('input[type="file"]:not([multiple])'))[2];const dt=new DataTransfer();dt.items.add(new File(["%PDF-1.4\\nreceipt"],"receipt.pdf",{type:"application/pdf"}));e.files=dt.files;e.dispatchEvent(new Event("change",{bubbles:true}));})()`);
        await until(`!(${button("Submit")}).disabled`);
      }
      await click(`document.querySelector('#holdForManagerReview')`);
      await until(`!!document.querySelector('#holdReason')`);
      assert(await evaluate(`(${button("Submit")}).disabled`), "hold missing reason/recipient blocks submission");
      await choose(`document.getElementById('holdReason')`, reason);
      assert(await evaluate(`(${button("Submit")}).disabled`), "hold missing recipient blocks submission");
      assert(await evaluate(`(${target("Jess")}).disabled`), "unknown Jess is visibly unavailable");
      await click(target("Mia"));
      await click(target("Jose"));
      await until(`!(${button("Submit")}).disabled`);
      if (index === 0) {
        mkdirSync("generated-artifacts/invoice-intake", { recursive: true });
        await evaluate(`document.getElementById('holdReason').scrollIntoView({block:"center"})`);
        const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
        writeFileSync("generated-artifacts/invoice-intake/hold-routing.png", Buffer.from(screenshot.data, "base64"));
      }
      await click(button("Submit"));
      await until(`!document.querySelector('#holdForManagerReview')`);
      const metadata = created.at(-1);
      assert.equal(metadata.holdForManagerReview, true);
      assert.equal(metadata.holdReason, reason);
      assert.deepEqual(metadata.heldFor, ["mia", "jose"]);
      assert.equal(metadata.lumper, index === 0);
    }
    assert.equal(created.length, 4);
    assert(!calls.some(call => call.path.startsWith("/api/drivers")), "removed driver query stays removed");
    console.log("PASS: removed fields, retained BOL upload/instructions, Rate amount, independent Lumper Total, optional empty/No lumper, required Yes receipt, all hold reasons, multi-recipient routing, unavailable staff and modal reset; all writes intercepted.");
    return;
  }
  revision = 2; delay = 500;
  await select("brokers", "REFRESH BROKER");
  await until("document.body.innerText.includes('Refreshing broker and carrier data')");
  assert.equal(await evaluate("document.body.innerText.includes('BROKER CURRENT 1')"), false);
  await select("carriers", "REFRESH CARRIER");
  await ready(2);
  delay = 0;
  revision = 3;
  await click(button("Cancel"));
  await click(button("Create Invoice"));
  await select("brokers", "REFRESH BROKER");
  await select("carriers", "REFRESH CARRIER");
  await ready(3);
  for (const path of ["/api/brokers/701", "/api/brokers/701/branches", "/api/clients/702", "/api/carriers/702/bank-accounts"]) {
    for (const r of [1, 2, 3]) assert(calls.some(call => call.path === path && call.revision === r), `${path} refreshed in revision ${r}`);
  }
  fail = true;
  await select("brokers", "REFRESH BROKER");
  await until("document.body.innerText.includes('Unable to refresh broker or carrier data')");
  assert.equal(await evaluate("document.body.innerText.includes('BROKER CURRENT 3')"), false);
  assert(await evaluate(`(${button("Submit")}).disabled`));
  const writes = calls.filter(call => call.method !== "GET" && call.path !== "/api/invoices/preflight");
  assert.deepEqual(writes, [], "No business writes");
  console.log("PASS: selection, same-ID reselection, reopening, current branches/carrier/bank data, cached-data masking and visible refresh failure. No business writes.");
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  ws?.close(); chrome?.kill("SIGTERM");
  server?.close();
});
