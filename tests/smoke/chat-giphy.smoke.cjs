// Actual chat UI with isolated API/GIPHY fixtures; never writes staff chat or sends alerts.
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const user = { id: "self", firstName: "Pauli", lastName: "Agent", name: "Pauli Agent", role: "admin" };
const gif = { id: "gif1", title: "Truck celebration", rating: "g", images: {
  fixed_width: { url: "https://media.giphy.com/media/gif1/giphy.gif?cid=fixture", width: "200", height: "120" },
} };
// A real looping, two-frame GIF (red/blue). No remote GIF is copied or saved.
const gifBytes = Buffer.concat([
  Buffer.from("GIF89a", "ascii"), Buffer.from([1,0,1,0,128,0,0,255,0,0,0,0,255]),
  Buffer.from([33,255,11]), Buffer.from("NETSCAPE2.0"), Buffer.from([3,1,0,0,0]),
  ...[0x44, 0x4c].map(pixel => Buffer.from([33,249,4,0,50,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,pixel,1,0])),
  Buffer.from([59]),
]);
const msg = (id, channelId, body, parentMessageId = null) => ({
  id, channelId, senderId: "self", senderName: user.name, body, parentMessageId,
  mentions: [], replyCount: 0, createdAt: new Date().toISOString(),
});
const roots = { 901: [msg(11, 901, "Reply here")], 902: [msg(21, 902, "Direct message")] };
const replies = [];
const posts = [], providerRequests = [], errors = [];
let nextId = 100, chrome, ws;
(async () => {
  chrome = spawn("chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--ignore-certificate-errors",
    "--remote-debugging-port=9236", "--user-data-dir=/tmp/ff-chat-giphy-browser", "about:blank"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch("http://127.0.0.1:9236/json")).json(); if (targets.length) break; } catch {}
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
    if (event.method !== "Fetch.requestPaused") return;
    const { requestId, request } = event.params, url = new URL(request.url);
    let result = [], responseCode = 200, contentType = "application/json", body;
    try {
      if (url.hostname === "media.giphy.com") { contentType = "image/gif"; body = gifBytes.toString("base64"); }
      else if (url.hostname === "api.giphy.com") {
        assert.equal(url.searchParams.get("rating"), "g");
        providerRequests.push({ path: url.pathname, q: url.searchParams.get("q"), rating: "g" });
        result = { data: /\/(?:search|trending)$/.test(url.pathname) ? [gif] : gif };
      }
      else if (url.pathname === "/api/auth/verify") result = { ...user, user };
      else if (url.pathname === "/api/auth/user") result = user;
      else if (url.pathname === "/api/user/permissions") result = { permissions: ["chat", "dashboard"].map(permission => ({ permission, module: permission, canView: true, canCreate: true, granted: true })) };
      else if (url.pathname === "/api/chat/giphy-config") result = { apiKey: "public-fixture-only" };
      else if (url.pathname === "/api/chat/users") result = [{ ...user, handle: "pauli" }];
      else if (url.pathname === "/api/chat/channels") result = [
        { id: 901, name: "general", type: "channel", unreadCount: 0 },
        { id: 902, name: "", type: "direct", directName: "Maria Macedo", unreadCount: 0 },
      ];
      else if (/\/threads\/11$/.test(url.pathname)) result = { parent: roots[901][0], replies, hasMore: false, nextCursor: nextId };
      else if (/\/messages$/.test(url.pathname)) {
        const channel = Number(url.pathname.split("/")[4]);
        if (request.method === "POST") {
          const input = JSON.parse(request.postData); posts.push({ channel, ...input });
          result = msg(++nextId, channel, input.body, input.parentMessageId ?? null);
          if (input.parentMessageId) { replies.push(result); roots[901][0].replyCount++; } else roots[channel].push(result);
        } else result = roots[channel];
      }
      else if (url.pathname === "/api/chat/unread-count") result = { unreadCount: 0, mentions: 0, messages: [], nextCursor: nextId };
      await cdp("Fetch.fulfillRequest", { requestId, responseCode, responseHeaders: [
        { name: "content-type", value: contentType }, { name: "access-control-allow-origin", value: "*" },
        { name: "access-control-allow-headers", value: "*" }, { name: "access-control-allow-methods", value: "GET, OPTIONS" },
      ], body: body || Buffer.from(JSON.stringify(result)).toString("base64") });
    } catch (error) { errors.push(error.message); await cdp("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => {}); }
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*/api/*" }, { urlPattern: "https://api.giphy.com/*" }, { urlPattern: "https://media.giphy.com/*" }] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("isAuthenticated","true");localStorage.setItem("user",${JSON.stringify(JSON.stringify(user))});` });
  const evaluate = async expression => {
    const response = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); }
    fs.mkdirSync("generated-artifacts/chat-giphy", { recursive: true });
    fs.writeFileSync("generated-artifacts/chat-giphy/failure.png", Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
    console.error(JSON.stringify({ page: await evaluate("document.body.innerText.slice(-1800)"), providerRequests, errors }));
    throw new Error(`Timed out: ${expression}`);
  };
  const click = async expression => {
    const point = await evaluate(`(()=>{const e=${expression};if(!e)throw Error("Missing click target");e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  const selectGif = async button => {
    await click(button);
    await until(`!!document.querySelector('[data-testid="chat-gif-gif1"]')`);
    assert(await evaluate(`!!document.querySelector('[data-testid="chat-gif-picker"] img[alt="Powered by GIPHY"]')`));
    await click(`document.querySelector('[data-testid="chat-gif-gif1"]')`);
    await until(`!document.querySelector('[data-testid="chat-gif-picker"]')`);
  };
  await cdp("Page.navigate", { url: `https://${process.env.REPLIT_DEV_DOMAIN}/chat?channelId=901` });
  await until(`!!document.querySelector('[data-testid="chat-message-composer"]') && document.querySelectorAll('[data-testid="chat-root-message"]').length===1`);
  await click(`document.querySelector('[data-testid="chat-message-composer"]')`);
  await cdp("Input.insertText", { text: "keep this draft" });
  await click(`document.querySelector('[data-testid="chat-gif-button"]')`);
  await until(`!!document.querySelector('[data-testid="chat-gif-gif1"]')`);
  await click(`document.querySelector('input[placeholder="Search GIPHY…"]')`);
  await cdp("Input.insertText", { text: "truck" }); await sleep(500);
  await until(`!!document.querySelector('[data-testid="chat-gif-gif1"]')`);
  assert(providerRequests.some(request => request.q === "truck"), "Search must reach GIPHY directly");
  fs.mkdirSync("generated-artifacts/chat-giphy", { recursive: true });
  fs.writeFileSync("generated-artifacts/chat-giphy/picker.png", Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await click(`document.querySelector('[data-testid="chat-gif-gif1"]')`);
  await until(`!!document.querySelector('[data-testid="chat-inline-gif"] img[alt="Truck celebration"]')?.naturalWidth`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="chat-message-composer"]').value`), "keep this draft");
  const bounds = await evaluate(`(()=>{const r=document.querySelector('[data-testid="chat-inline-gif"] img').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);
  let previous = (await cdp("Page.captureScreenshot", { format: "png", clip: bounds })).data, animated = false;
  for (let i = 0; i < 8; i++) {
    await sleep(200);
    const next = (await cdp("Page.captureScreenshot", { format: "png", clip: bounds })).data;
    if (previous !== next) { animated = true; break; }
  }
  assert(animated, "Inline GIF frames must animate");
  await click(`document.querySelector('[data-testid="chat-reply-11"]')`);
  await until(`document.querySelectorAll('[data-testid="chat-gif-button"]').length===2`);
  await selectGif(`document.querySelectorAll('[data-testid="chat-gif-button"]')[1]`);
  await until(`!!document.querySelector('[data-testid="chat-thread-reply"] [data-testid="chat-inline-gif"] img')?.naturalWidth`);
  await click(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim().endsWith("Maria Macedo"))`);
  await until(`document.querySelector('[data-testid="chat-message-composer"]')?.placeholder==="Message Maria Macedo..."`);
  await selectGif(`document.querySelector('[data-testid="chat-gif-button"]')`);
  await until(`!!document.querySelector('[data-testid="chat-inline-gif"] img')?.naturalWidth`);
  assert.equal(posts.length, 3);
  assert.deepEqual(posts.map(p => [p.channel, p.parentMessageId ?? null]), [[901, null], [901, 11], [902, null]]);
  assert(posts.every(p => p.body === "[giphy:gif1]"));
  assert.equal(errors.length, 0, errors.join("; "));
  console.log(JSON.stringify({ passed: true, picker: true, directSearch: true, ratingLocked: "g", attribution: true, animation: true,
    channels: true, dms: true, threads: true, draftPreserved: true, noRealWritesOrAlerts: true }));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => { ws?.close(); chrome?.kill("SIGKILL"); });
