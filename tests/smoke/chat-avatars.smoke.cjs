// Render the actual Team Chat UI against isolated API fixtures. No staff writes or alerts.
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const photo = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#265e84"/><circle cx="16" cy="12" r="7" fill="#ffe0b2"/><path d="M4 32Q4 18 16 20Q28 18 28 32" fill="#fff"/></svg>');
const people = [
  { id: "self", name: "Pauli Agent", handle: "pauli", role: "admin", profileImageUrl: photo },
  { id: "maria", name: "Maria Macedo", handle: "maria", role: "employee", profileImageUrl: null },
  { id: "blake", name: "Blake Agent", handle: "blake", role: "employee", profileImageUrl: "/chat-avatar-broken.png" },
];
const user = { ...people[0], firstName: "Pauli", lastName: "Agent" };
const message = (id, person, extra = {}) => ({
  id, channelId: 901, senderId: person.id, senderName: person.name, senderProfileImageUrl: person.profileImageUrl,
  body: "Avatar verification", createdAt: new Date().toISOString(), parentMessageId: null, mentions: [], replyCount: 0, ...extra,
});
const roots = people.map((person, index) => message(11 + index, person, { replyCount: index === 0 ? 3 : 0 }));
const replies = [people[1], people[2], people[0]].map((person, index) => message(21 + index, person, { parentMessageId: 11 }));
let chrome, ws;
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
    "--remote-debugging-port=9234", "--user-data-dir=/tmp/ff-chat-avatar-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9234/json")).json(); if (targets.length) break; } catch {}
    await sleep(100);
  }
  assert(targets?.length, "Chromium unavailable");
  ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  let id = 0;
  const pending = new Map();
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id; pending.set(requestId, { resolve, reject });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
  ws.on("message", async data => {
    const event = JSON.parse(data);
    if (event.id) {
      const call = pending.get(event.id); pending.delete(event.id);
      if (call) event.error ? call.reject(event.error) : call.resolve(event.result);
    }
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const url = new URL(request.url);
    let result = [], responseCode = 200;
    if (url.pathname === "/chat-avatar-broken.png") responseCode = 404;
    else if (url.pathname === "/api/auth/verify") result = { ...user, user };
    else if (url.pathname === "/api/auth/user") result = user;
    else if (url.pathname === "/api/user/permissions") result = { permissions: ["chat", "dashboard"].map(permission => ({ permission, module: permission, canView: true, canCreate: true, granted: true })) };
    else if (url.pathname === "/api/chat/users") result = people;
    else if (url.pathname === "/api/chat/channels") result = [
      { id: 901, name: "general", type: "channel", unreadCount: 0 },
      { id: 902, name: "", type: "direct", directName: "Maria Macedo", directProfileImageUrl: null, unreadCount: 0 },
    ];
    else if (/\/api\/chat\/channels\/\d+\/threads\//.test(url.pathname)) result = { parent: roots[0], replies, hasMore: false, nextCursor: 23 };
    else if (/\/api\/chat\/channels\/\d+\/messages$/.test(url.pathname)) result = request.url.includes("afterId=") ? [] : roots;
    else if (/\/unread-count$/.test(url.pathname)) result = { count: 0 };
    else if (/\/read$/.test(url.pathname)) result = { success: true };
    try {
      await cdp("Fetch.fulfillRequest", { requestId, responseCode,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "X-Chat-Message-Cursor", value: "100" }],
        body: Buffer.from(JSON.stringify(result)).toString("base64") });
    } catch {}
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }, { urlPattern: "*/chat-avatar-broken.png" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
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
    for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error(`Timed out: ${expression}`);
  };
  const click = async expression => {
    const point = await evaluate(`(()=>{const e=${expression};if(!e)throw Error("Missing click target");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  await cdp("Page.navigate", { url: `https://${process.env.REPLIT_DEV_DOMAIN}/chat?channelId=901` });
  const rows = `Array.from(document.querySelectorAll('[data-testid="chat-root-message"]'))`;
  await until(`${rows}.length===3 && ${rows}[0].querySelector('[data-testid="chat-agent-avatar"] img')?.naturalWidth>0`);
  assert.deepEqual(await evaluate(`${rows}.slice(1).map(e=>e.querySelector('[data-testid="chat-agent-avatar"]').textContent.trim())`), ["MM", "BA"]);
  await click(`${rows}[0].querySelector('[role="button"]')`);
  await until(`document.querySelectorAll('[data-testid="chat-thread-reply"]').length===3`);
  const threadRows = `Array.from(document.querySelectorAll('[data-testid="chat-thread-reply"]'))`;
  await until(`${threadRows}[2].querySelector('[data-testid="chat-agent-avatar"] img')?.naturalWidth>0`);
  assert.deepEqual(await evaluate(`${threadRows}.slice(0,2).map(e=>e.querySelector('[data-testid="chat-agent-avatar"]').textContent.trim())`), ["MM", "BA"]);
  assert(await evaluate(`document.querySelector('[data-testid="chat-thread-parent"] [data-testid="chat-agent-avatar"] img').naturalWidth>0`));
  await click(`document.querySelector('[data-testid="chat-message-composer"]')`);
  await cdp("Input.insertText", { text: "@" });
  await until(`document.querySelectorAll('[role="option"]').length===3`);
  assert(await evaluate(`document.querySelector('[role="option"] [data-testid="chat-agent-avatar"] img').naturalWidth>0`));
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('[role="option"]'))[1].querySelector('[data-testid="chat-agent-avatar"]').textContent.trim()`), "MM");
  const screenshot = await cdp("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/chat-avatars-verified.png", Buffer.from(screenshot.data, "base64"));
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await click(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim().endsWith("Maria Macedo"))`);
  await until(`document.querySelector('[data-testid="chat-message-composer"]')?.placeholder==="Message Maria Macedo..." && ${rows}.length===3`);
  assert(await evaluate(`${rows}[0].querySelector('[data-testid="chat-agent-avatar"] img').naturalWidth>0`));
  assert.equal(await evaluate(`${rows}[1].querySelector('[data-testid="chat-agent-avatar"]').textContent.trim()`), "MM");
  console.log(JSON.stringify({ passed: true, channels: true, dms: true, threadParent: true, replies: true, mentions: true,
    missingImageInitials: "MM", brokenImageInitials: "BA", screenshot: "/tmp/chat-avatars-verified.png", noStaffWritesOrAlerts: true }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
