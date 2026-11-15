// Finite browser checks: real sign-in, with announcement-only browser fixtures.
// Database behavior is tested separately with rollback-only PostgreSQL tests.
// No test announcements, rejection alerts, or other content are saved.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const origin = process.env.ANNOUNCEMENT_TEST_URL;
assert(origin && process.env.DEV_ADMIN_EMAIL && process.env.DEV_ADMIN_PASSWORD, "Test origin and credentials required.");
const role = process.env.ANNOUNCEMENT_UI_ROLE || "admin";
const output = `/tmp/announcements-ui-${role}`;
const profile = await mkdtemp(path.join(tmpdir(), "announcement-browser-"));
const browser = spawn("/repl/tools/bin/chromium", [
  "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-pipe",
  `--host-resolver-rules=MAP ${new URL(origin).hostname} 127.0.0.1`, "--no-proxy-server",
  `--unsafely-treat-insecure-origin-as-secure=${origin}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let sequence = 0, session, viewerId, buffered = "", errors = 0, nextId = 10;
const pending = new Map(), decoder = new StringDecoder("utf8"), dismissed = new Set();
const data = [], actions = [];
const send = (method, params = {}, scoped = true) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 20000);
  pending.set(id, { resolve, reject, timer });
  browser.stdio[3].write(JSON.stringify({ id, method, params, ...(scoped && session ? { sessionId: session } : {}) }) + "\0");
});
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  assert(!result.exceptionDetails, "Browser evaluation failed");
  return result.result.value;
};
const click = async selector => {
  await until(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  let previous = "";
  for (let i = 0; i < 25; i++) {
    await wait(100);
    const state = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return{bounds:[r.x,r.y,r.width,r.height].map(Math.round).join(','),hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    if (state.hit && state.bounds === previous) break;
    previous = state.bounds;
    assert(i < 24, `Pointer target did not settle: ${selector}`);
  }
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  await wait(100);
};
const until = async expression => {
  for (let i = 0; i < 150; i++) {
    if (await evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`UI state did not arrive: ${expression}`);
};
const fill = async (selector, text) => {
  await click(selector);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
  await send("Input.insertText", { text });
  await wait(100);
};
const dialogButton = async text => {
  await evaluate(`(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing dialog action');b.dataset.qaAction='true'})()`);
  await click('[role=dialog] button[data-qa-action="true"]');
};

async function intercept(event) {
  const url = new URL(event.request.url);
  const fulfill = body => send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
  if (url.pathname === "/api/auth/login") {
    if (event.responseStatusCode !== 200) return send("Fetch.continueRequest", { requestId: event.requestId });
    const raw = await send("Fetch.getResponseBody", { requestId: event.requestId });
    const result = JSON.parse(Buffer.from(raw.body, raw.base64Encoded ? "base64" : "utf8").toString());
    viewerId = result.user.id;
    if (role === "employee") result.user.role = "employee"; // Stricter client UI only, never server authorization.
    return send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: 200,
      responseHeaders: event.responseHeaders.filter(h => !["content-length", "content-encoding"].includes(h.name.toLowerCase())),
      body: Buffer.from(JSON.stringify(result)).toString("base64") });
  }
  if (!data.length && nextId === 10) {
    for (const [id, severity, status, own] of [[1, "green", "approved", true], [2, "amber", "approved", false], [3, "red", "approved", false], [4, "amber", "pending", false], [5, "green", "pending", false], [6, "green", "rejected", true]]) {
      data.push({ id, message: `QA announcement ${id}`, authorId: own ? viewerId : "qa-other", authorName: own ? "QA Author" : "QA Colleague",
        severity, status, persistent: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        postedAt: status === "approved" ? new Date().toISOString() : null, expiresAt: new Date(Date.now() + 604800000).toISOString(),
        reviewedAt: null, reviewedBy: null, rejectionReason: status === "rejected" ? "Clarify the requested date." : null,
        version: 1, canManage: own || role !== "employee" });
    }
  }
  const parts = url.pathname.split("/").filter(Boolean), id = Number(parts[2]), action = parts[3];
  const body = event.request.postData ? JSON.parse(event.request.postData) : {};
  if (event.request.method === "GET") {
    const view = url.searchParams.get("view"), offset = Number(url.searchParams.get("offset") || 0);
    let rows = data.filter(item => view === "all" ? true : view === "mine" ? item.authorId === viewerId : view === "pending" ? item.status === "pending" : item.status === "approved" && !dismissed.has(item.id));
    if (view === "active") rows.sort((a, b) => ({ red: 0, amber: 1, green: 2 })[a.severity] - ({ red: 0, amber: 1, green: 2 })[b.severity] || b.id - a.id);
    return fulfill({ items: rows.slice(offset, offset + 15), total: rows.length, nextOffset: offset + 15 < rows.length ? offset + 15 : null, canReview: role !== "employee" });
  }
  const item = data.find(row => row.id === id);
  if (event.request.method === "POST" && parts.length === 2) {
    const created = { ...data[0], ...body, id: nextId++, authorId: viewerId, authorName: "QA Author", canManage: true,
      status: role === "employee" ? "pending" : "approved", version: 1 };
    data.push(created); actions.push("create"); return fulfill(created);
  }
  assert(item, "Unknown test announcement");
  actions.push(action || event.request.method.toLowerCase());
  if (event.request.method === "DELETE") { data.splice(data.indexOf(item), 1); return fulfill({ success: true }); }
  if (event.request.method === "PATCH") Object.assign(item, body, { version: item.version + 1, status: role === "employee" ? "pending" : "approved" });
  if (action === "dismiss") dismissed.add(id);
  if (action === "approve") Object.assign(item, { status: "approved", version: item.version + 1 });
  if (action === "reject") Object.assign(item, { status: "rejected", rejectionReason: body.reason || null, version: item.version + 1 });
  return fulfill(item);
}
browser.stdio[4].on("data", chunk => {
  buffered += decoder.write(chunk);
  let boundary;
  while ((boundary = buffered.indexOf("\0")) !== -1) {
    const packet = buffered.slice(0, boundary); buffered = buffered.slice(boundary + 1);
    if (!packet) continue;
    const message = JSON.parse(packet);
    if (message.method === "Runtime.exceptionThrown") errors++;
    if (message.method === "Fetch.requestPaused") void intercept(message.params).catch(() => { errors++; });
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(new Error("Browser protocol error")) : request.resolve(message.result);
    }
  }
});

try {
  await mkdir(output, { recursive: true });
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/announcements*", requestStage: "Request" }, { urlPattern: "*/api/auth/login", requestStage: "Response" }] });
  await send("Page.navigate", { url: `${origin}/login` });
  await until("!!document.querySelector('#ff-login-email')");
  await evaluate("document.fonts.ready.then(()=>true)");
  await fill("#ff-login-email", process.env.DEV_ADMIN_EMAIL);
  await fill("#ff-login-password", process.env.DEV_ADMIN_PASSWORD);
  await click(".ff-login-submit");
  await until("!!document.querySelector('[data-testid=announcement-3]')");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('[data-testid^=\"announcement-\"]')].filter(e=>e.tagName==='ARTICLE').map(e=>Number(e.dataset.testid.split('-')[1]))"), [3, 2, 1]);
  assert.equal(await evaluate("!!document.querySelector('[data-testid=announcement-pending-toggle]')"), role !== "employee");
  await click('[data-testid="announcement-3"] button[aria-label="Dismiss announcement"]');
  await until("!document.querySelector('[data-testid=announcement-3]')");
  await click('[data-testid="announcement-create"]');
  await fill("#announcement-message", "word ".repeat(101));
  assert(await evaluate("[...document.querySelectorAll('[role=dialog] button')].find(b=>/Publish announcement|Submit for approval/.test(b.textContent)).disabled"));
  assert.match(await evaluate("document.querySelector('#announcement-word-count').textContent"), /101 \/ 100/);
  await fill("#announcement-message", "QA composed announcement");
  await evaluate("(()=>{const e=document.querySelector('#announcement-severity');e.value='amber';e.dispatchEvent(new Event('change',{bubbles:true}))})()");
  await click('[role=dialog] input[type=checkbox]');
  await dialogButton(role === "employee" ? "Submit for approval" : "Publish announcement");
  await until("!document.querySelector('[role=dialog]')");
  await click('[data-testid=announcement-mine-toggle]');
  await until("!!document.querySelector('[data-testid=my-announcement-10]')");
  assert.equal(data.find(row => row.id === 10).severity, "amber");
  assert.equal(data.find(row => row.id === 10).persistent, true);
  await click('[data-testid=my-announcement-10] button:first-of-type');
  await fill("#announcement-message", "QA edited announcement");
  await dialogButton("Save changes");
  await until("!document.querySelector('[role=dialog]')");
  assert.equal(data.find(row => row.id === 10).message, "QA edited announcement");
  await click('[data-testid=my-announcement-10] button:last-of-type');
  await dialogButton("Delete");
  await until("!document.querySelector('[role=dialog]')");
  await until("!document.querySelector('[data-testid=my-announcement-10]')");
  if (role !== "employee") {
    await click('[data-testid=announcement-pending-toggle]');
    await until("!!document.querySelector('[data-testid=pending-announcement-4]')");
    await evaluate("(()=>{const b=[...document.querySelectorAll('[data-testid=pending-announcement-4] button')].find(b=>b.textContent.includes('Approve'));b.dataset.qaApprove='true'})()");
    await click('[data-qa-approve=true]');
    await until("!!document.querySelector('[data-testid=announcement-4]')");
    await evaluate("(()=>{const b=[...document.querySelectorAll('[data-testid=pending-announcement-5] button')].find(b=>b.textContent.includes('Reject'));b.dataset.qaReject='true'})()");
    await click('[data-qa-reject=true]');
    await fill("#announcement-review-reason", "QA review note");
    await dialogButton("Reject announcement");
    await until("!document.querySelector('[data-testid=pending-announcement-5]')");
    await evaluate("(()=>{const b=[...document.querySelectorAll('[aria-label=\"Announcement management views\"] button')].find(b=>b.textContent==='All announcements');b.dataset.qaManage='true'})()");
    await click('[data-qa-manage=true]');
    await until("!!document.querySelector('[data-testid=my-announcement-5]')");
    assert.match(await evaluate("document.querySelector('[data-testid=my-announcement-5]').textContent"), /QA review note/);
  } else {
    assert.match(await evaluate("document.querySelector('[data-testid=my-announcement-6]').textContent"), /Clarify the requested date/);
    await click('[data-testid=my-announcement-6] button:first-of-type');
    await fill("#announcement-message", "QA clarified announcement");
    await dialogButton("Save changes");
    await until("!document.querySelector('[role=dialog]')");
    assert.equal(data.find(row => row.id === 6).status, "pending");
  }
  await evaluate("document.querySelector('[data-testid=section-announcements]').scrollIntoView({block:'start',behavior:'instant'})");
  await send("Page.captureScreenshot", { format: "jpeg", quality: 80 }).then(r => writeFile(`${output}/desktop.jpg`, Buffer.from(r.data, "base64")));
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await wait(250);
  assert(await evaluate("document.documentElement.scrollWidth<=390"), "Mobile horizontal overflow");
  await send("Page.captureScreenshot", { format: "jpeg", quality: 80 }).then(r => writeFile(`${output}/mobile.jpg`, Buffer.from(r.data, "base64")));
  assert.equal(errors, 0, "Browser exceptions");
  await send("Fetch.disable");
  const realRead = await evaluate("fetch('/api/announcements',{credentials:'include'}).then(async r=>({status:r.status,valid:Array.isArray((await r.json()).items)}))");
  assert.equal(realRead.status, 200, "Actual announcements route failed");
  assert.equal(realRead.valid, true);
  console.log(JSON.stringify({ role, browserFixtureOnly: true, actions, severityOrder: true, wordLimit: true, mobileOverflow: false, actualApiRead: true, errors }));
  await evaluate("fetch('/api/auth/logout',{method:'POST',credentials:'include'}).then(()=>true)");
} catch (error) {
  await send("Page.captureScreenshot", { format: "jpeg", quality: 75 }).then(r => writeFile(`${output}/failure.jpg`, Buffer.from(r.data, "base64"))).catch(() => {});
  console.log(JSON.stringify({ role, failureState: await evaluate("({focus:document.activeElement?.id,wordCount:document.querySelector('#announcement-word-count')?.textContent,dialogCount:document.querySelectorAll('[role=dialog]').length})").catch(() => null) }));
  throw error;
} finally {
  browser.kill("SIGTERM");
  await wait(200);
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
