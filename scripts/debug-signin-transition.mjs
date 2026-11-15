// Normal sign-in only; records geometry/timing, never credentials, bodies or cookies.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
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
const pending = new Map(), responses = [], failures = [], authLifecycle = [];
let exceptionCount = 0;
let delayPermissions = false;
let permissionOverride = null;
const decoder = new StringDecoder("utf8");
let buffered = "";
browser.stdio[4].on("data", chunk => {
  buffered += decoder.write(chunk);
  let boundary;
  while ((boundary = buffered.indexOf("\0")) !== -1) {
    const encoded = buffered.slice(0, boundary); buffered = buffered.slice(boundary + 1);
    if (!encoded) continue;
    const message = JSON.parse(encoded);
    if (message.method === "Runtime.consoleAPICalled") {
      const args = message.params.args;
      if (/^(ProtectedRoute -|Not authenticated,|Authenticated, rendering|Checking authentication|No valid auth|Server verification|Setting authenticated|Auth check failed)/.test(args[0]?.value ?? "")) {
        authLifecycle.push(args.map(arg => ["string", "boolean"].includes(arg.type) ? arg.value : arg.type));
      }
    }
    if (message.method === "Fetch.requestPaused") {
      const event = message.params;
      void (async () => {
        if (event.responseStatusCode && process.env.SIGNIN_TEST_EMPLOYEE === "1") {
          const body = await send("Fetch.getResponseBody", { requestId: event.requestId });
          const result = JSON.parse(Buffer.from(body.body, body.base64Encoded ? "base64" : "utf8").toString());
          // Exercise stricter client guards with an actual authenticated test
          // session. Server authentication/authorization is never intercepted.
          result.user.role = "employee";
          await send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: event.responseStatusCode,
            responseHeaders: event.responseHeaders.filter(h => !["content-length", "content-encoding"].includes(h.name.toLowerCase())),
            body: Buffer.from(JSON.stringify(result)).toString("base64") });
        } else {
          if (delayPermissions) await wait(400);
          if (permissionOverride !== null) {
            await send("Fetch.fulfillRequest", { requestId: event.requestId,
              responseCode: permissionOverride === "error" ? 503 : 200,
              responseHeaders: [{ name: "Content-Type", value: "application/json" }],
              body: Buffer.from(JSON.stringify(permissionOverride === "error" ? { message: "Test-only unavailable" } : { permissions: [] })).toString("base64") });
          } else await send("Fetch.continueRequest", { requestId: event.requestId });
        }
      })().catch(() => failures.push({ type: "Test interception failed" }));
    }
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
  if (selector.startsWith("aside")) {
    const rail = await evaluate("(()=>{const r=document.querySelector('aside').getBoundingClientRect();return{x:r.x+20,y:r.y+150}})()");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...rail });
    await wait(250);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
    await wait(80);
  }
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
  if (process.env.SIGNIN_TEST_EMPLOYEE === "1") await send("Fetch.enable", {
    patterns: [{ urlPattern: "*/api/auth/login", requestStage: "Response" }],
  });
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
      window.__entryFrames.push({ms:Math.round(performance.now()),login,loading:document.body?.innerText.trim()==='Loading…',
        criticalScene:document.documentElement.hasAttribute('data-login-entry'),
        background:document.body?getComputedStyle(document.body).backgroundColor:null,
        shell:!!document.querySelector('.ff-financial-dashboard-shell')});
      if(!login&&++count<600)requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  })()` });
  if (process.env.SIGNIN_SLOW_ENTRY === "1") await send("Network.emulateNetworkConditions", {
    offline: false, latency: 150, downloadThroughput: 150000, uploadThroughput: 750000, connectionType: "cellular4g",
  });
  await send("Page.navigate", { url: `${base}${process.env.SIGNIN_ENTRY_PATH || "/login"}` });
  for (let i = 0; i < 120; i++) {
    if (await evaluate("!!document.querySelector('#ff-login-email')")) break;
    await wait(100);
  }
  assert(await evaluate("!!document.querySelector('#ff-login-email')"), "Login did not load.");
  await evaluate("document.fonts.ready.then(()=>true)");
  const entryResources = await evaluate(`performance.getEntriesByType('resource').map(r=>({
    path:new URL(r.name).pathname,start:Math.round(r.startTime),end:Math.round(r.responseEnd),
    duration:Math.round(r.duration),bytes:r.transferSize
  }))`);
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
  console.log(JSON.stringify({ signInCheck: {
    path: await evaluate("location.pathname"), responses, exceptionCount,
    dashboardFrame: frames.find(frame => frame.dashboard) ?? null,
    loginMarks: await evaluate("performance.getEntriesByType('mark').filter(m=>m.name.startsWith('staff-login:')).map(m=>({name:m.name,ms:Math.round(m.startTime)}))"),
    authLifecycle,
    alert: await evaluate("document.querySelector('.ff-login-error')?.innerText || null"),
  } }));
  if (!frames.some(frame => frame.dashboard)) {
    console.log(JSON.stringify({ diagnosticResources: await evaluate(`performance.getEntriesByType('resource').map(r=>({path:new URL(r.name).pathname,ms:Math.round(r.duration)}))`) }));
    await send("Page.captureScreenshot", { format: "jpeg", quality: 75 }).then(r => writeFile(`${output}/failed-signin.jpg`, Buffer.from(r.data, "base64")));
  }
  const navigation = [];
  if (process.env.SIGNIN_VERIFY_NAVIGATION === "1") {
    delayPermissions = true;
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/auth/permissions", requestStage: "Request" }] });
    const labels = await evaluate("Array.from(document.querySelectorAll('aside button[aria-label]'), el=>el.getAttribute('aria-label'))");
    const source = await readFile("client/src/components/layout/sidebar.tsx", "utf8");
    const routes = process.env.SIGNIN_ALL_ROUTES === "1"
      ? [...source.matchAll(/\{\s*name:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g)]
        .map(([, label, route]) => [label, route]).filter(([label]) => labels.includes(label))
      : [["Invoices", "/invoices"], ["Carriers", "/clients"], ["Brokers", "/brokers"], ["Documents", "/documents"], ["Calendar", "/calendar"]];
    for (const [label, path] of routes) {
      const selector = `aside button[aria-label="${label}"]`;
      assert(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `${label} navigation missing`);
      await evaluate(`(()=>{window.__navigationFrames=[];window.__navigationActive=true;
        window.__navigationEpoch=(window.__navigationEpoch||0)+1;const epoch=window.__navigationEpoch;
        (function sample(){window.__navigationFrames.push({
          path:location.pathname,loading:!!document.querySelector('[data-route-loading]'),
          checking:document.body.innerText.includes('Checking page access'),
        sidebarWidth:document.querySelector('aside')?.getBoundingClientRect().width,
          documentHeight:document.documentElement.scrollHeight
        });if(window.__navigationActive&&window.__navigationEpoch===epoch)requestAnimationFrame(sample)})()})()`);
      await click(selector);
      for (let i = 0; i < 200; i++) {
        if (await evaluate(`location.pathname===${JSON.stringify(path.split("?")[0])}`)) break;
        await wait(50);
      }
      assert.equal(await evaluate("location.pathname"), path.split("?")[0], `${label} never opened`);
      await wait(150);
      const samples = await evaluate("window.__navigationActive=false;window.__navigationFrames");
      const detail = { label, frames: samples.length,
        fallbackFrames: samples.filter(f => f.loading || f.checking).length,
        overflowFrames: samples.filter(f => f.documentHeight > 900).length };
      navigation.push(detail);
      assert.equal(detail.fallbackFrames, 0, `${label} exposed an intermediate loading page`);
      assert.equal(detail.overflowFrames, 0, `${label} overflowed the document`);
    }
    if (process.env.SIGNIN_TEST_EMPLOYEE === "1") {
      const previousPath = await evaluate("location.pathname");
      permissionOverride = "error";
      await click('aside button[aria-label="Invoices"]');
      await wait(1200);
      assert.equal(await evaluate("location.pathname"), previousPath, "Failed access preparation changed the page");
      assert(await evaluate("document.body.innerText.includes('Page could not open')"), "Access preparation error was silent");
      permissionOverride = "deny";
      const deniedAt = await evaluate("performance.now()");
      await click('aside button[aria-label="Invoices"]');
      await wait(1500);
      const invoiceReads = await evaluate(`performance.getEntriesByType('resource').filter(r=>r.startTime>${deniedAt}&&new URL(r.name).pathname.startsWith('/api/invoices')).length`);
      assert.equal(invoiceReads, 0, "Denied destination mounted and fetched invoice data");
      assert(await evaluate("location.pathname!=='/invoices'||document.body.innerText.includes('Access Denied')"), "Denied destination was not blocked");
      navigation.push({ failedAccessStayedOnPage: true, revokedAccessBlocked: true });
      permissionOverride = null;
    }
    await send("Fetch.disable");
    await send("Page.captureScreenshot", { format: "jpeg", quality: 75 }).then(r => writeFile(`${output}/navigation.jpg`, Buffer.from(r.data, "base64")));
  }
  const report = {
    origin: base, slowNetwork: process.env.SIGNIN_SLOW_NETWORK === "1", responses, failures, exceptionCount, navigation,
    entryFrames: await evaluate("window.__entryFrames"),
    entryResources,
    resources: await evaluate(`performance.getEntriesByType('resource').filter(r=>new URL(r.name).origin===location.origin).map(r=>({
      path:new URL(r.name).pathname,start:Math.round(r.startTime),end:Math.round(r.responseEnd),duration:Math.round(r.duration)
    }))`),
    finalPath: frames.at(-1)?.path,
    firstOverlay: frames.find(frame => frame.overlay) ?? null,
    firstNavigation: frames.find(frame => frame.path !== "/login") ?? null,
    firstDashboard: frames.find(frame => frame.dashboard) ?? null,
    uncoveredLoadingFrames: frames.filter(frame => frame.path === "/" && !frame.dashboard && (!frame.overlay || frame.opacity < 0.95)).length,
    frames,
  };
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  const { frames: _frames, entryFrames, resources: _resources, entryResources: _entryResources, ...summary } = report;
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
