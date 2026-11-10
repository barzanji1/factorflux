// Browser regression checks without account credentials or an authentication bypass.
// Usage: TEST_URL=https://<dev-host>/login node scripts/test-liquid-glass.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const url = process.env.TEST_URL;
assert(url, "Provide TEST_URL for the login or isolated material preview.");
const profile = await mkdtemp(path.join(tmpdir(), "liquid-glass-check-"));
const port = 9234;
const browser = spawn(process.env.CHROME_BIN || "chromium", [
  "--headless", "--no-sandbox", "--disable-dev-shm-usage",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
      if (ready) break;
    } catch { /* Browser is starting. */ }
    await sleep(100);
  }
  assert(ready, "Chromium did not start.");
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  const pending = new Map();
  let serial = 0;
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const move = (x, y) => cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  const click = async (selector) => {
    const rect = await evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await move(rect.x, rect.y);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...rect, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...rect, button: "left", clickCount: 1 });
  };
  const count = () => evaluate("document.querySelectorAll('.liquid-glass-panel__ripple').length");
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1024, height: 683, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url });
  let rendered = false;
  for (let i = 0; i < 80; i++) {
    rendered = await evaluate("Boolean(document.querySelector('.liquid-glass-panel__scene[style*=background]'))");
    if (rendered) break;
    await sleep(100);
  }
  assert(rendered, "Glass scene did not render.");
  await sleep(700);
  const state = await evaluate(`(() => {
    const p=document.querySelector('.liquid-glass-panel'), c=p.querySelector('.liquid-glass-panel__content');
    const r=p.getBoundingClientRect();
    return {
      rect:{x:r.x,y:r.y,width:r.width,height:r.height},
      contentFilter:getComputedStyle(c).filter, contentBackdrop:getComputedStyle(c).backdropFilter,
      decorations:[...p.children].filter(x=>x!==c).every(x=>getComputedStyle(x).pointerEvents==='none'),
      texture:p.querySelector('feImage').getAttribute('href').startsWith('data:image/png'),
      sceneSize:p.querySelector('.liquid-glass-panel__scene').style.backgroundSize,
      ids:[...document.querySelectorAll('svg [id]')].map(x=>x.id)
    };
  })()`);
  assert.equal(state.contentFilter, "none");
  assert.equal(state.contentBackdrop, "none");
  assert(state.decorations, "Decorative layer can intercept pointer events.");
  assert(state.texture, "Rounded lens texture did not initialize.");
  assert.match(state.sceneSize, /px/);
  assert.equal(new Set(state.ids).size, state.ids.length);
  const r = state.rect;
  await evaluate("document.fonts.ready.then(()=>true)");
  const capturePixels = async () => {
    const { data } = await cdp("Page.captureScreenshot", { format: "png" });
    const image = await loadImage(Buffer.from(data, "base64"));
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  };
  const refracted = await capturePixels();
  const scale = await evaluate(`(() => {const d=document.querySelector('feDisplacementMap');const s=d.getAttribute('scale');d.setAttribute('scale','0');return s})()`);
  await sleep(100);
  const flat = await capturePixels();
  await evaluate(`document.querySelector('feDisplacementMap').setAttribute('scale', ${JSON.stringify(scale)})`);
  let edgeChanges = 0;
  let centerChanges = 0;
  for (let y = Math.ceil(r.y); y < Math.floor(r.y + r.height); y++) {
    for (let x = Math.ceil(r.x); x < Math.floor(r.x + r.width); x++) {
      const index = (y * 1024 + x) * 4;
      const difference = Math.abs(refracted[index] - flat[index])
        + Math.abs(refracted[index + 1] - flat[index + 1])
        + Math.abs(refracted[index + 2] - flat[index + 2]);
      if (difference < 6) continue;
      const edgeDistance = Math.min(x - r.x, r.x + r.width - x, y - r.y, r.y + r.height - y);
      if (edgeDistance < 65) edgeChanges++;
      else centerChanges++;
    }
  }
  assert(edgeChanges > 30, "SVG filter is defined but is not visibly refracting the scene.");
  assert(centerChanges < edgeChanges * 0.1, "Refraction is affecting the clear center rather than only the perimeter.");
  await move(r.x + 20, r.y + 90);
  await sleep(60);
  assert(await count() > 0, "Pointer did not emit a ripple.");
  for (let i = 0; i < 8; i++) {
    await sleep(125);
    await move(r.x + 20 + i * 45 % (r.width - 40), r.y + 85 + i % 2 * 35);
    assert(await count() <= 3, "Ripple count exceeded GPU-conscious bound.");
  }
  await sleep(1050);
  assert.equal(await count(), 0, "Ripple layers did not expire.");
  const isLogin = await evaluate("Boolean(document.querySelector('#ff-login-email'))");
  const control = isLogin ? "#ff-login-email" : ".lg-study__control";
  await click(control);
  assert.equal(await count(), 0, "Pointer interaction with a control triggered a ripple.");
  if (isLogin) {
    await cdp("Input.insertText", { text: "example" });
    assert.equal(await evaluate("document.querySelector('#ff-login-email').value"), "example");
    await click(".ff-login-toggle");
    assert.equal(await evaluate("document.querySelector('#ff-login-password').type"), "text");
    await click(".ff-login-toggle");
    assert.equal(await evaluate("document.querySelector('#ff-login-password').type"), "password");
  }
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(100);
  await move(0, 0);
  await move(r.x + 20, r.y + 50);
  assert.equal(await count(), 0, "Reduced motion still creates ripples.");
  await cdp("Emulation.setEmulatedMedia", { features: [] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await sleep(250);
  assert(await evaluate("document.documentElement.scrollWidth <= 390"), "Mobile layout overflows.");
  if (isLogin) {
    // Exercise only the visual helper, not auth or application routing.
    await evaluate(`(async () => {
      const {playLoginSuccess}=await import('/src/lib/login-ripple.ts');
      window.__glassReveal=false;
      window.__glassTransition=playLoginSuccess(document.querySelector('.ff-login-card'),()=>{window.__glassReveal=true},document.querySelector('.ff-login-submit'));
    })()`);
    const overlay = await evaluate(`(() => {
      const o=document.querySelector('.ff-login-transition');
      const allIds=[...document.querySelectorAll('[id]')].map(x=>x.id);
      const references=[...o.querySelectorAll('*')].flatMap(x=>[...x.attributes].flatMap(a=>[...a.value.matchAll(/url\\(["']?#([^"')]+)["']?\\)/g)].map(m=>m[1])));
      return {safe:[...o.querySelectorAll('input')].every(x=>!x.value&&!x.hasAttribute('id')),unique:new Set(allIds).size===allIds.length,filters:references.every(id=>Boolean(o.querySelector('[id="'+id+'"]')))};
    })()`);
    assert(overlay.safe && overlay.unique && overlay.filters, "Transition leaked input state or lost its SVG filters.");
    await sleep(1450);
    assert.equal(await evaluate("window.__glassReveal"), true);
    assert.equal(await evaluate("Boolean(document.querySelector('.ff-login-transition'))"), false);
    await evaluate(`(async () => {const {playLoginSuccess}=await import('/src/lib/login-ripple.ts');window.__cancelledReveal=false;const t=playLoginSuccess(document.querySelector('.ff-login-card'),()=>{window.__cancelledReveal=true});t.cancel()})()`);
    await sleep(800);
    assert.equal(await evaluate("window.__cancelledReveal"), false);
  }
  console.log(JSON.stringify({ passed: true, url: new URL(url).pathname, refractionPixelCheck: {edgeChanges, centerChanges}, checks: ["layer isolation", "rendered perimeter refraction", "SVG texture", "unique definitions", "pointer pass-through", "bounded ripple cleanup", "control interaction", "reduced motion", "mobile layout", ...(isLogin ? ["credential-free transition", "SVG clone remapping", "transition cancellation"] : [])] }, null, 2));
} finally {
  socket?.close();
  browser.kill("SIGTERM");
  await sleep(200);
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
