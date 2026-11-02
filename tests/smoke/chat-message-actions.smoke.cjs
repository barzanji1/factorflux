// Actual browser pointer/keyboard interactions against isolated API fixtures.
// All /api/* requests are intercepted: never creates live messages or alerts.
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const user = { id: "self", firstName: "QA", lastName: "Agent", role: "admin", name: "QA Agent" };
const now = new Date().toISOString();
let roots = [
  { id: 11, channelId: 901, senderId: "self", senderName: "QA Agent", body: "Original topic", createdAt: now, parentMessageId: null, mentions: [], replyCount: 1 },
  { id: 12, channelId: 901, senderId: "other", senderName: "Other Agent", body: "Other topic", createdAt: now, parentMessageId: null, mentions: [], replyCount: 0 },
];
let replies = [{ ...roots[0], id: 21, parentMessageId: 11, body: "Existing reply", replyCount: 0 }];
const actions = [];
const withPreview = root => ({ ...root, replyCount: root.id === 11 ? replies.length : 0, latestReply: root.id === 11 ? replies.at(-1) ?? null : null });
let chrome, ws;
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu",
    "--remote-debugging-port=9236", `--user-data-dir=/tmp/ff-chat-actions-${process.pid}`, "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9236/json")).json(); if (targets.length) break; } catch {}
    await sleep(100);
  }
  assert(targets?.length, "Chromium unavailable");
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.once("open", resolve));
  let id = 0;
  const pending = new Map();
  const errors = [];
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id; pending.set(requestId, { resolve, reject });
    ws.send(JSON.stringify({ id: requestId, method, params }));
  });
  ws.on("message", async raw => {
    const event = JSON.parse(raw);
    if (event.id) {
      const call = pending.get(event.id); pending.delete(event.id);
      if (call) event.error ? call.reject(event.error) : call.resolve(event.result);
    }
    if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.text);
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params;
    const url = new URL(request.url), method = request.method;
    let result = [];
    if (url.pathname === "/api/auth/verify") result = { ...user, user };
    else if (url.pathname === "/api/auth/user") result = user;
    else if (url.pathname === "/api/auth/permissions") result = { permissions: ["chat", "dashboard"] };
    else if (url.pathname === "/api/user/permissions") result = { permissions: [] };
    else if (url.pathname === "/api/chat/users") result = [user, { id: "other", name: "Other Agent", handle: "other", role: "employee" }];
    else if (url.pathname === "/api/chat/channels") result = [
      { id: 901, name: "general", type: "channel", unreadCount: 0 },
      { id: 902, name: "", type: "direct", directName: "Other Agent", unreadCount: 0 },
    ];
    else if (/\/threads\/11$/.test(url.pathname)) result = { parent: withPreview(roots[0]), replies, hasMore: false, nextCursor: replies.at(-1)?.id ?? 0 };
    else if (/\/messages\/\d+$/.test(url.pathname)) {
      const messageId = Number(url.pathname.split("/").at(-1));
      const item = [...roots, ...replies].find(m => m.id === messageId);
      actions.push({ method, messageId });
      if (method === "PATCH") { item.body = JSON.parse(request.postData).body; item.editedAt = now; result = item; }
      if (method === "DELETE") { roots = roots.filter(m => m.id !== messageId); replies = replies.filter(m => m.id !== messageId); result = { success: true }; }
    } else if (/\/messages$/.test(url.pathname)) {
      if (method === "POST") {
        const body = JSON.parse(request.postData);
        assert.equal(body.parentMessageId, 11, "reply must be tied to its parent");
        result = { ...roots[0], id: 22, parentMessageId: 11, body: body.body };
        replies.push(result);
        actions.push({ method, messageId: 22, parentMessageId: body.parentMessageId });
      } else result = url.searchParams.has("afterId") ? [] : roots.map(withPreview);
    } else if (/\/unread-count$/.test(url.pathname)) result = { count: 0 };
    else if (/\/read$/.test(url.pathname)) result = { success: true };
    await cdp("Fetch.fulfillRequest", { requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "X-Chat-Message-Cursor", value: "100" }],
      body: Buffer.from(JSON.stringify(result)).toString("base64") });
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__CHAT_ACTION_FIXTURE__=true;
    localStorage.setItem("isAuthenticated","true");
    localStorage.setItem("user",${JSON.stringify(JSON.stringify(user))});
  ` });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(100); }
    console.error(await evaluate(`({url:location.href,text:document.body.innerText.slice(0,2200),fixture:window.__CHAT_ACTION_FIXTURE__})`));
    throw new Error(`Timed out: ${expression}`);
  };
  const click = async expression => {
    const point = await evaluate(`(()=>{const e=${expression};if(!e)throw Error("Missing click target");e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
    await sleep(120);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  const button = (scope, text) => `Array.from((${scope}).querySelectorAll('button')).find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const root = `document.querySelector('#chat-message-11')`;
  const ownReply = `document.querySelector('#chat-message-21')`;
  const openMenu = scope => click(`(${scope}).querySelector('button[aria-label="Message actions"]')`);
  const key = async name => {
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name, windowsVirtualKeyCode: name === "Enter" ? 13 : 27 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name });
  };
  await cdp("Page.navigate", { url: "http://127.0.0.1:5000/chat?channelId=901" });
  await until(`window.__CHAT_ACTION_FIXTURE__ && document.querySelectorAll('[data-testid="chat-root-message"]').length===2`);
  assert(await evaluate(`!!document.querySelector('button[data-testid="chat-replies-11"]') && document.body.textContent.includes("Existing reply")`));
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="chat-thread-reply"]').length`), 0);
  await openMenu(root); await click(button(root, "Edit"));
  await until(`document.activeElement?.getAttribute('aria-label')==="Edit message"`);
  await key("Escape");
  await until(`!document.querySelector('input[aria-label="Edit message"]')`);
  assert.equal(actions.length, 0);
  await openMenu(root); await click(button(root, "Edit"));
  await until(`document.activeElement?.getAttribute('aria-label')==="Edit message"`);
  await evaluate(`(()=>{const e=document.activeElement;e.select();return document.hasFocus()})()`);
  await cdp("Input.insertText", { text: "Edited topic" }); await key("Enter");
  await until(`(${root}).textContent.includes("Edited topic") && (${root}).textContent.includes("(edited)")`);
  await click(`document.querySelector('[data-testid="chat-replies-11"]')`);
  await until(`document.querySelectorAll('[data-testid="chat-thread-reply"]').length===1`);
  await openMenu(ownReply); await click(button(ownReply, "Edit"));
  await until(`document.activeElement?.getAttribute('aria-label')==="Edit message"`);
  await evaluate(`document.activeElement.select()`);
  await cdp("Input.insertText", { text: "Edited reply" });
  await click(button(ownReply, "Save"));
  await until(`(${ownReply}).textContent.includes("Edited reply") && (${ownReply}).textContent.includes("(edited)")`);
  await click(`document.querySelector('[data-testid="chat-thread-composer-11"]')`);
  assert(await evaluate(`document.hasFocus() && document.activeElement?.placeholder==="Reply..."`));
  await cdp("Input.insertText", { text: "New inline reply" });
  await click(`(${root}).querySelector('button[aria-label="Send reply"]')`);
  await until(`document.querySelectorAll('[data-testid="chat-thread-reply"]').length===2`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-testid="chat-root-message"]').length`), 2);
  await openMenu(ownReply); await click(button(ownReply, "Delete"));
  await click(button(ownReply, "No"));
  assert(await evaluate(`!!document.querySelector('#chat-message-21')`));
  await openMenu(ownReply); await click(button(ownReply, "Delete")); await click(button(ownReply, "Yes"));
  await until(`!document.querySelector('#chat-message-21')`);
  const other = `document.querySelector('#chat-message-12')`;
  await openMenu(other);
  assert.equal(await evaluate(`!!(${button(other, "Edit")})`), false, "admin cannot edit another author's message");
  await click(button(other, "Delete")); await click(button(other, "Yes"));
  await until(`!document.querySelector('#chat-message-12')`);
  // A different client's changes must replace already-loaded replies, not append
  // only new IDs and leave stale edited/deleted content behind.
  replies[0].body = "Remote reply edit";
  await until(`document.querySelector('#chat-message-22')?.textContent.includes("Remote reply edit")`);
  replies = [];
  await until(`!document.querySelector('#chat-message-22')`);
  await click(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim().endsWith("Other Agent"))`);
  await until(`document.querySelector('[data-testid="chat-message-composer"]')?.placeholder==="Message Other Agent..."`);
  await openMenu(root);
  assert(await evaluate(`!!(${button(root, "Edit")})`), "own message editing must also work in DMs");
  await click(button(root, "Edit"));
  await key("Escape");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await sleep(400);
  assert(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`), "mobile must not overflow");
  fs.writeFileSync("/tmp/chat-actions-mobile.png", Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, inlineReply: true, editEnterEscape: true, replyEditDelete: true, inlineDeleteYesNo: true,
    managementDeleteOnly: true, remoteEditsAndDeletesRefresh: true, dms: true, mobile375: true, actions, noLiveMessages: true }));
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
