// Actual sign-in + browser-only announcements. No announcement fixtures or
// notifications are broadcast to staff. Real PostgreSQL/API rules are covered
// separately by server/services/announcements.test.ts using rollback fixtures.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const origin = process.env.ANNOUNCEMENT_TEST_URL;
assert(origin && process.env.DEV_ADMIN_EMAIL && process.env.DEV_ADMIN_PASSWORD);
const role = process.env.ANNOUNCEMENT_UI_ROLE || "employee";
const announcementsOnly = process.env.ANNOUNCEMENT_UI_NO_CHAT === "1";
const output = `generated-artifacts/team-announcements-${announcementsOnly ? "restricted" : role}`;
const profile = await mkdtemp(path.join(tmpdir(), "team-announcement-browser-"));
const browser = spawn("/repl/tools/bin/chromium", [
  "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-pipe",
  `--host-resolver-rules=MAP ${new URL(origin).hostname} 127.0.0.1`, "--no-proxy-server",
  `--unsafely-treat-insecure-origin-as-secure=${origin}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let sequence = 0, session, viewerId, buffered = "", errors = 0, dialogWarnings = 0, privateChatRequests = 0, nextId = 10;
const pending = new Map(), decoder = new StringDecoder("utf8");
const data = [], actions = [];
const send = (method, params = {}, scoped = true) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 20000);
  pending.set(id, { resolve, reject, timer });
  browser.stdio[3].write(JSON.stringify({ id, method, params, ...(scoped && session ? { sessionId: session } : {}) }) + "\0");
});
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  assert(!result.exceptionDetails, `Browser evaluation failed: ${result.exceptionDetails?.text || ""}`);
  return result.result.value;
};
const until = async expression => {
  for (let i = 0; i < 180; i++) {
    if (await evaluate(expression)) return;
    await wait(100);
  }
  throw new Error(`UI state did not arrive: ${expression}`);
};
const click = async selector => {
  await until(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  let previous = "";
  for (let i = 0; i < 35; i++) {
    await wait(100);
    const state = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return{bounds:[r.x,r.y,r.width,r.height].map(Math.round).join(','),hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()`);
    if (state.hit && state.bounds === previous) break;
    previous = state.bounds;
    assert(i < 34, `Pointer target did not settle: ${selector}`);
  }
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
};
const fill = async (selector, text) => {
  await click(selector);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
  await send("Input.insertText", { text });
  await wait(80);
};
const present = row => ({ ...row, canEdit: row.authorId === viewerId, canDelete: row.authorId === viewerId || role === "admin", canManage: row.authorId === viewerId || role === "admin" });
async function intercept(event) {
  const url = new URL(event.request.url);
  const fulfill = (body, status = 200) => send("Fetch.fulfillRequest", {
    requestId: event.requestId, responseCode: status,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Cache-Control", value: "no-store" }],
    body: Buffer.from(JSON.stringify(body)).toString("base64"),
  });
  if (url.pathname === "/api/auth/login" || url.pathname === "/api/auth/verify" || url.pathname === "/api/auth/permissions") {
    if (event.responseStatusCode !== 200) return send("Fetch.continueRequest", { requestId: event.requestId });
    const raw = await send("Fetch.getResponseBody", { requestId: event.requestId });
    const result = JSON.parse(Buffer.from(raw.body, raw.base64Encoded ? "base64" : "utf8").toString());
    if (url.pathname !== "/api/auth/permissions") {
      viewerId = result.user.id;
      result.user.role = role; // Client-only stricter-role fixture; server auth is not changed.
    } else {
      assert(Array.isArray(result.permissions));
      result.permissions = result.permissions.filter(permission => permission !== "chat");
    }
    return send("Fetch.fulfillRequest", {
      requestId: event.requestId, responseCode: 200,
      responseHeaders: event.responseHeaders.filter(h => !["content-length", "content-encoding"].includes(h.name.toLowerCase())),
      body: Buffer.from(JSON.stringify(result)).toString("base64"),
    });
  }
  const parts = url.pathname.split("/").filter(Boolean), id = Number(parts[2]);
  const body = event.request.postData ? JSON.parse(event.request.postData) : {};
  if (event.request.method === "GET") {
    if (parts.length === 3) {
      const item = data.find(row => row.id === id);
      return item ? fulfill(present(item)) : fulfill({ message: "This announcement was removed." }, 404);
    }
    const view = url.searchParams.get("view"), offset = Number(url.searchParams.get("offset") || 0);
    const rows = data.filter(row => view === "mine" ? row.authorId === viewerId : row.status === "approved" && (!row.expiresAt || Date.parse(row.expiresAt) > Date.now()))
      .sort((a, b) => b.id - a.id);
    return fulfill({ items: rows.slice(offset, offset + 15).map(present), total: rows.length, nextOffset: offset + 15 < rows.length ? offset + 15 : null, canReview: role !== "employee" });
  }
  if (event.request.method === "POST" && parts.length === 2) {
    const now = new Date().toISOString();
    const created = { ...body, headline: body.headline || body.message.trim().split(/\s+/u).slice(0, 25).join(" "), id: nextId++, authorId: viewerId, authorName: "QA Author",
      message: body.message || body.headline, severity: "green", status: "approved", version: 1,
      persistent: body.persistent !== false, postedAt: now, createdAt: now, updatedAt: now,
      expiresAt: body.persistent === false ? new Date(Date.now() + 604800000).toISOString() : null,
      reviewedAt: null, reviewedBy: null, rejectionReason: null };
    data.push(created); actions.push("create"); return fulfill(present(created), 201);
  }
  const item = data.find(row => row.id === id);
  if (!item) return fulfill({ message: "Removed" }, 404);
  if (body.version !== item.version) return fulfill({ message: "This announcement changed." }, 409);
  if (event.request.method === "DELETE") {
    if (item.authorId !== viewerId && role !== "admin") return fulfill({ message: "Not permitted" }, 403);
    data.splice(data.indexOf(item), 1); actions.push("delete"); return fulfill({ success: true });
  }
  if (event.request.method === "PATCH") {
    if (item.authorId !== viewerId) return fulfill({ message: "Not permitted" }, 403);
    Object.assign(item, body, { headline: body.headline || body.message.trim().split(/\s+/u).slice(0, 25).join(" "), version: item.version + 1, status: "approved", updatedAt: new Date().toISOString() });
    actions.push("edit"); return fulfill(present(item));
  }
  return fulfill({ message: "Unexpected fixture operation" }, 400);
}
browser.stdio[4].on("data", chunk => {
  buffered += decoder.write(chunk);
  let boundary;
  while ((boundary = buffered.indexOf("\0")) !== -1) {
    const packet = buffered.slice(0, boundary); buffered = buffered.slice(boundary + 1);
    if (!packet) continue;
    const message = JSON.parse(packet);
    if (message.method === "Runtime.exceptionThrown") errors++;
    if (message.method === "Network.requestWillBeSent" && new URL(message.params.request.url).pathname.startsWith("/api/chat/")) privateChatRequests++;
    if (message.method === "Runtime.consoleAPICalled" && message.params.args.some(arg => typeof arg.value === "string" && arg.value.includes("DialogContent") && arg.value.includes("DialogTitle"))) dialogWarnings++;
    if (message.method === "Fetch.requestPaused") void intercept(message.params).catch(error => { errors++; console.error(error.message); });
    if (message.method === "Page.javascriptDialogOpening") void send("Page.handleJavaScriptDialog", { accept: true });
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
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/announcements*", requestStage: "Request" }, { urlPattern: "*/api/auth/login", requestStage: "Response" }, { urlPattern: "*/api/auth/verify", requestStage: "Response" }, ...(announcementsOnly ? [{ urlPattern: "*/api/auth/permissions", requestStage: "Response" }] : [])] });
  await send("Page.navigate", { url: `${origin}/login` });
  await until("!!document.querySelector('#ff-login-email')");
  await evaluate("document.fonts.ready.then(()=>true)");
  await fill("#ff-login-email", process.env.DEV_ADMIN_EMAIL);
  await fill("#ff-login-password", process.env.DEV_ADMIN_PASSWORD);
  await click(".ff-login-submit");
  await until("!!document.querySelector('[data-testid=agent-dashboard]')");
  assert.equal(await evaluate("!!document.querySelector('[data-testid=team-announcement-banner]')"), false);
  assert.equal(await evaluate("!!document.querySelector('[data-testid=team-announcement-new]')"), false, "Posting belongs in Team Chat, not dashboard");
  await click('aside button[aria-label="Team Chat"]');
  await click('[data-testid=team-announcement-new]');
  await fill('[data-testid=team-announcement-message]', "word ".repeat(51));
  assert(await evaluate("document.querySelector('[data-testid=team-announcement-submit]').disabled"));
  await fill('[data-testid=team-announcement-message]', "Team schedule update. Please review the updated operational schedule before taking your next assignment.");
  await click('[data-testid=team-announcement-submit]');
  await until("!document.querySelector('[data-testid=team-announcement-composer]')&&!!document.querySelector('[data-testid=team-announcement-banner]')");
  const ownId = data[0].id;
  assert.equal(data[0].status, "approved");
  await evaluate("(()=>{const b=[...document.querySelectorAll('aside button')].find(b=>b.getAttribute('aria-label')==='Agent Dashboard'||b.getAttribute('aria-label')==='Dashboard');if(!b)throw Error('Dashboard navigation missing');b.dataset.qaDashboard='true'})()");
  await click('aside button[data-qa-dashboard=true]');
  await until("location.pathname==='/'&&!!document.querySelector('[data-testid=team-announcement-banner]')");
  await click('[data-testid=team-announcement-banner] button[aria-label^="Open announcement:"]');
  await until(`location.pathname==='/chat'&&location.search.includes('announcement=${ownId}')&&!!document.querySelector('[data-testid=team-announcement-detail]')`);
  await until("document.querySelector('[data-testid=team-announcement-detail]').innerText.includes('updated operational schedule')");
  await click('button[aria-label="Edit this announcement"]');
  await fill('[data-testid=team-announcement-message]', "Revised team schedule. Please review the updated operational schedule before your next assignment.");
  await click('[data-testid=team-announcement-submit]');
  await until("!document.querySelector('[data-testid=team-announcement-composer]')&&document.querySelector('[data-testid=team-announcement-detail]').innerText.includes('Revised team schedule')");
  await click('button[aria-label="Delete this announcement"]');
  await until("!document.querySelector('[data-testid=team-announcement-banner]')");
  assert.equal(data.length, 0);
  // Other staff publish 17 active notices, including more than one API page.
  for (let i = 20; i < 37; i++) {
    data.push({ id: i, headline: `Shared staff announcement ${i}`, message: `Full text from a teammate for announcement ${i}.`,
      authorId: "qa-other", authorName: "QA Colleague", highlightColor: i % 2 ? "amber" : "blue", severity: "green",
      status: "approved", persistent: true, version: 1, createdAt: new Date().toISOString(), postedAt: new Date().toISOString(), expiresAt: null });
  }
  await until("!!document.querySelector('[data-testid=team-announcement-banner]')");
  await click('[data-testid=team-announcement-next]');
  assert(await evaluate("document.querySelector('[data-testid=team-announcement-banner]').innerText.includes('Shared staff announcement 35')"));
  await click('button[aria-label="Load more active announcements"]');
  await until("!!document.querySelector('[data-testid=team-announcement-item-20]')");
  assert.equal(await evaluate("!!document.querySelector('[data-testid=team-announcement-item-20] button[aria-label^=\"Edit announcement:\"]')"), false);
  assert.equal(await evaluate("!!document.querySelector('[data-testid=team-announcement-item-20] button[aria-label^=\"Delete announcement:\"]')"), role === "admin");
  if (role === "admin") {
    await click('[data-testid=team-announcement-item-20] button[aria-label^="Delete announcement:"]');
    await until("!document.querySelector('[data-testid=team-announcement-item-20]')");
  }
  await send("Page.captureScreenshot", { format: "jpeg", quality: 80 }).then(r => writeFile(`${output}/chat-desktop.jpg`, Buffer.from(r.data, "base64")));
  // Navigate through a real sidebar control; the same feed must appear on dashboard.
  await evaluate("(()=>{const b=[...document.querySelectorAll('aside button')].find(b=>b.getAttribute('aria-label')==='Agent Dashboard'||b.getAttribute('aria-label')==='Dashboard');if(!b)throw Error('Dashboard navigation missing');b.dataset.qaDashboard='true'})()");
  await click('aside button[data-qa-dashboard=true]');
  await until("location.pathname==='/'&&!!document.querySelector('[data-testid=team-announcement-banner]')");
  const placement = await evaluate("(()=>{const d=document.querySelector('[data-testid=agent-dashboard]');const b=d.querySelector('[data-testid=team-announcement-banner]');const q=d.querySelector('section[aria-label=\"Financial key performance indicators\"]');return !!q&&d.querySelector(':scope > section')===b&&!!(b.compareDocumentPosition(q)&Node.DOCUMENT_POSITION_FOLLOWING)&&b.getBoundingClientRect().bottom<=q.getBoundingClientRect().top&&b.getBoundingClientRect().width<d.getBoundingClientRect().width-24})()");
  assert(placement, "Compact announcement must be first on dashboard, above the queue carousel");
  await until("document.documentElement.dataset.pageTransition!=='holding'");
  await wait(250);
  await send("Page.captureScreenshot", { format: "jpeg", quality: 80 }).then(r => writeFile(`${output}/dashboard-desktop.jpg`, Buffer.from(r.data, "base64")));
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await wait(150);
  assert(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), "Dashboard mobile overflow");
  await send("Page.captureScreenshot", { format: "jpeg", quality: 80 }).then(r => writeFile(`${output}/dashboard-mobile.jpg`, Buffer.from(r.data, "base64")));
  await click('[data-testid=team-announcement-banner] button[aria-label^="Open announcement:"]');
  await until("location.pathname==='/chat'&&!!document.querySelector('[data-testid=team-announcement-detail]')");
  await until("document.documentElement.dataset.pageTransition!=='holding'");
  await wait(250);
  assert(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), "Mobile overflow");
  await send("Page.captureScreenshot", { format: "jpeg", quality: 80 }).then(r => writeFile(`${output}/chat-mobile.jpg`, Buffer.from(r.data, "base64")));
  for (const item of data) item.expiresAt = new Date(Date.now() + 6000).toISOString();
  // A fresh active query supplies the expiry dates to the client, then its
  // expiry clock must hide the strip, even without another navigation.
  await send("Page.navigate", { url: `${origin}/` });
  await until("!!document.querySelector('[data-testid=agent-dashboard]')&&!!document.querySelector('[data-testid=team-announcement-banner]')");
  await until("!document.querySelector('[data-testid=team-announcement-banner]')");
  assert.equal(errors, 0, "Browser exceptions");
  assert.equal(dialogWarnings, 0, "Announcement editor must have an accessible DialogTitle");
  if (announcementsOnly) assert.equal(privateChatRequests, 0, "Announcement-only access must never fetch private chat data");
  await send("Fetch.disable");
  const realRead = await evaluate("fetch('/api/announcements',{credentials:'include'}).then(async r=>({status:r.status,valid:Array.isArray((await r.json()).items)}))");
  assert.equal(realRead.status, 200);
  assert(realRead.valid);
  console.log(JSON.stringify({ role, announcementsOnly, browserFixtureOnly: true, actions, wordLimit50: true, chatOnlyPosting: true, directPublish: true, fullTextInChat: true, multiplePages: true, placement, expiryAndEmptyState: true, mobileOverflow: false, actualApiRead: true, ...(announcementsOnly ? { privateChatRequests } : {}), errors }));
  await evaluate("fetch('/api/auth/logout',{method:'POST',credentials:'include'}).then(()=>true)");
} catch (error) {
  await send("Page.captureScreenshot", { format: "jpeg", quality: 75 }).then(r => writeFile(`${output}/failure.jpg`, Buffer.from(r.data, "base64"))).catch(() => {});
  throw error;
} finally {
  browser.kill("SIGTERM");
  await wait(200);
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
