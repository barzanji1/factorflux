// Normal sign-in only; records geometry/timing, never credentials, bodies or cookies.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const base = process.env.SIGNIN_TEST_URL;
assert(base, "Provide the verified app origin in SIGNIN_TEST_URL.");
assert(process.env.DEV_ADMIN_EMAIL && process.env.DEV_ADMIN_PASSWORD, "Test credentials unavailable.");
const output = process.env.SIGNIN_TEST_OUTPUT || "generated-artifacts/signin-debug";
const profile = await mkdtemp(path.join(tmpdir(), "signin-debug-"));
const local = new URL(base).hostname === process.env.REPLIT_DEV_DOMAIN;
const browser = spawn("/repl/tools/bin/chromium", [
  "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-pipe",
  ...(local ? [`--host-resolver-rules=MAP ${new URL(base).hostname} 127.0.0.1`, "--no-proxy-server",
    `--unsafely-treat-insecure-origin-as-secure=${base}`] : []),
  `--user-data-dir=${profile}`, "--no-first-run", "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let sequence = 0, session;
const pending = new Map(), responses = [], failures = [];
let exceptionCount = 0;
const decoder = new StringDecoder("utf8");
let buffered = "";
browser.stdio[4].on("data", chunk => {
  buffered += decoder.write(chunk);
  let boundary;
  while ((boundary = buffered.indexOf("\0")) !== -1) {
    const encoded = buffered.slice(0, boundary); buffered = buffered.slice(boundary + 1);
    if (!encoded) continue;
    const message = JSON.parse(encoded);
    if (message.method === "Runtime.exceptionThrown") exceptionCount++;
    if (message.method === "Network.responseReceived") {
      const response = message.params.response, url = new URL(response.url);
      if (url.pathname.startsWith("/api/auth/") || response.status >= 400) {
        responses.push({ path: url.pathname, status: response.status });
      }
    }
    if (message.method === "Network.loadingFailed") failures.push({ type: message.params.type, canceled: !!message.params.canceled });
    const request = pending.get(message.id);
    if (!request) continue;
    pending.delete(message.id); clearTimeout(request.timer);
    message.error ? request.reject(new Error("Browser protocol command failed")) : request.resolve(message.result);
  }
});
const send = (method, params = {}, scoped = true) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 20000);
  pending.set(id, { resolve, reject, timer });
  browser.stdio[3].write(`${JSON.stringify({ id, method, params, ...(scoped && session ? { sessionId: session } : {}) })}\0`);
});
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  assert(!result.exceptionDetails, "Browser evaluation failed.");
  return result.result.value;
};
const click = async selector => {
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
};
try {
  await mkdir(output, { recursive: true });
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: process.env.SIGNIN_MOBILE === "1" ? 390 : 1365, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  if (process.env.SIGNIN_REDUCED_MOTION === "1") await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `(()=>{
    window.__entryFrames=[];let count=0;
    const sample=()=>{
      const login=!!document.querySelector('#ff-login-email');
      window.__entryFrames.push({login,loading:document.body?.innerText.trim()==='Loading…',
        shell:!!document.querySelector('.ff-financial-dashboard-shell')});
      if(!login&&++count<600)requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  })()` });
  await send("Page.navigate", { url: `${base}${process.env.SIGNIN_ENTRY_PATH || "/login"}` });
  for (let i = 0; i < 120; i++) {
    if (await evaluate("!!document.querySelector('#ff-login-email')")) break;
    await wait(100);
  }
  assert(await evaluate("!!document.querySelector('#ff-login-email')"), "Login did not load.");
  await click("#ff-login-email"); await send("Input.insertText", { text: process.env.DEV_ADMIN_EMAIL });
  await click("#ff-login-password"); await send("Input.insertText", { text: process.env.DEV_ADMIN_PASSWORD });
  if (process.env.SIGNIN_SLOW_NETWORK === "1") await send("Network.emulateNetworkConditions", {
    offline: false, latency: 150, downloadThroughput: 150000, uploadThroughput: 750000, connectionType: "cellular4g",
  });
  await evaluate(`(()=>{
    window.__signinFrames=[];const start=performance.now();
    const sample=()=>{
      const overlay=document.querySelector('.ff-login-transition');
      const card=document.querySelector('.ff-login-card');
      const shell=document.querySelector('.ff-financial-dashboard-shell');
      const dashboard=document.querySelector('[data-testid="agent-dashboard"]');
      const r=card?.getBoundingClientRect();
      window.__signinFrames.push({
        ms:Math.round(performance.now()-start),path:location.pathname,
        overlay:!!overlay,opacity:overlay?Number(getComputedStyle(overlay).opacity):null,
        outwardRings:document.querySelectorAll('.ff-login-transition-ring').length,
        card:!!card,cardHeight:r?.height,cardTop:r?.top,
        shell:!!shell,dashboard:!!dashboard,
        loading:!!document.querySelector('[data-route-loading]'),
        documentHeight:document.documentElement.scrollHeight,
        bodyBackground:getComputedStyle(document.body).backgroundColor
      });
      if(performance.now()-start<10000)requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  })()`);
  await click(".ff-login-submit");
  await wait(10500);
  const frames = await evaluate("window.__signinFrames");
  const report = {
    origin: base, slowNetwork: process.env.SIGNIN_SLOW_NETWORK === "1", responses, failures, exceptionCount,
    entryFrames: await evaluate("window.__entryFrames"),
    finalPath: await evaluate("location.pathname"),
    firstOverlay: frames.find(frame => frame.overlay) ?? null,
    firstNavigation: frames.find(frame => frame.path !== "/login") ?? null,
    firstDashboard: frames.find(frame => frame.dashboard) ?? null,
    uncoveredLoadingFrames: frames.filter(frame => frame.path === "/" && !frame.dashboard && (!frame.overlay || frame.opacity < 0.95)).length,
    frames,
  };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  const { frames: _frames, entryFrames, ...summary } = report;
  console.log(JSON.stringify({
    ...summary, initialLoadingFrames: entryFrames.filter(frame => frame.loading || frame.shell).length,
  }, null, 2));
  // Close only this browser's session; do not alter user data.
  await evaluate("fetch('/api/auth/logout',{method:'POST',credentials:'include'}).then(()=>true)");
  assert.equal(report.finalPath, "/", "Sign-in did not reach the dashboard.");
  assert(report.firstDashboard, "Dashboard never rendered after sign-in.");
  assert.equal(frames.at(-1)?.overlay, false, "Login decoration remained over the dashboard.");
  if (process.env.SIGNIN_EXPECT_NO_EFFECT === "1") {
    assert(frames.every(frame => !frame.overlay && frame.outwardRings === 0), "A removed sign-in effect still appeared.");
    assert(report.entryFrames.every(frame => !frame.loading && !frame.shell), "Anonymous entry flashed a loading screen.");
    assert(report.entryFrames.some(frame => frame.login), "Entry did not render the login form.");
  }
  if (process.env.SIGNIN_EXPECT_CONTINUITY === "1") {
    assert.equal(report.uncoveredLoadingFrames, 0, "Login uncovered the loading route before the dashboard committed.");
  }
} finally {
  browser.kill("SIGTERM");
  await wait(250);
  await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
