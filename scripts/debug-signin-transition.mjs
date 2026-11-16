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
          const interceptedPath = new URL(event.request.url).pathname;
          if (interceptedPath === "/api/__dashboard_freshness_probe" && process.env.SIGNIN_VERIFY_FRESHNESS === "1") {
            // Browser-only response: never creates/updates/deletes live records.
            await send("Fetch.fulfillRequest", { requestId: event.requestId, responseCode: event.request.method === "PUT" ? 409 : 204 });
            return;
          }
          if (process.env.SIGNIN_VERIFY_LOADING_STATES === "1") {
            if (interceptedPath.startsWith("/api/agent-dashboard/")) await wait(1800);
            if (/^\/assets\/index-[\w-]+\.js$/.test(interceptedPath)) await wait(700);
          }
          const permissionsRequest = new URL(event.request.url).pathname === "/api/auth/permissions";
          if (permissionsRequest && delayPermissions) await wait(400);
          if (!permissionsRequest && process.env.SIGNIN_DELAY_DATA === "1") await wait(700);
          if (permissionsRequest && permissionOverride !== null) {
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
const click = async (selector, hoverDelay = 0) => {
  if (selector.startsWith("aside")) {
    const rail = await evaluate("(()=>{const r=document.querySelector('aside').getBoundingClientRect();return{x:r.x+20,y:r.y+150}})()");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...rail });
    await wait(250);
  }
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  await wait(80);
  let point;
  for (let i = 0; i < 40; i++) {
    const target = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return{x,y,hit:e.contains(document.elementFromPoint(x,y))}})()`);
    if (target?.hit) { point = { x: target.x, y: target.y }; break; }
    await wait(50);
  }
  if (!point) {
    console.log(JSON.stringify({ blocked: selector, geometry: await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e?.getBoundingClientRect();const h=r?document.elementFromPoint(r.x+r.width/2,r.y+r.height/2):null;return{path:location.pathname,box:r?{x:r.x,y:r.y,w:r.width,h:r.height}:null,hit:h?.className,card:e?.closest('.ff-action-card')?.className,bodyPointer:getComputedStyle(document.body).pointerEvents,holding:document.documentElement.dataset.pageTransition,animations:document.getAnimations().map(a=>a.animationName).filter(Boolean).slice(0,8)}})()`) }));
    await send("Page.captureScreenshot", { format: "jpeg", quality: 75 }).then(r => writeFile(`${output}/blocked-pointer.jpg`, Buffer.from(r.data, "base64")));
  }
  assert(point, `Pointer target blocked: ${selector}`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  if (hoverDelay) await wait(hoverDelay);
  const finalTarget = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2,hit:e.contains(document.elementFromPoint(${point.x},${point.y})),actual:document.elementFromPoint(${point.x},${point.y})?.closest('button')?.getAttribute('aria-label')}:null})()`);
  if (!finalTarget?.hit) console.log(JSON.stringify({ movedPointerTarget: selector, before: point, after: finalTarget }));
  const clickTime = await evaluate("performance.now()");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  return clickTime;
};
try {
  await mkdir(output, { recursive: true });
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  const initialInterceptions = [];
  if (process.env.SIGNIN_TEST_EMPLOYEE === "1") initialInterceptions.push({ urlPattern: "*/api/auth/login", requestStage: "Response" });
  if (process.env.SIGNIN_VERIFY_LOADING_STATES === "1") initialInterceptions.push(
    { urlPattern: "*/assets/index-*.js", requestStage: "Request" },
    { urlPattern: "*/api/agent-dashboard/*", requestStage: "Request" },
  );
  if (initialInterceptions.length) await send("Fetch.enable", { patterns: initialInterceptions });
  await send("Emulation.setDeviceMetricsOverride", {
    width: process.env.SIGNIN_MOBILE === "1" ? 390 : 1365, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  if (process.env.SIGNIN_REDUCED_MOTION === "1") await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  if (process.env.SIGNIN_NO_VIEW_TRANSITION === "1") await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "document.startViewTransition = undefined;",
  });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `(()=>{
    performance.setResourceTimingBufferSize(5000);
    window.__entryFrames=[];let count=0;
    const sample=()=>{
      const login=!!document.querySelector('#ff-login-email');
      window.__entryFrames.push({ms:Math.round(performance.now()),login,loading:document.body?.innerText.trim()==='Loading…',
        splash:!!document.querySelector('.ff-startup-splash'),
        logoReady:!!document.querySelector('.ff-startup-splash svg')||!!document.querySelector('.ff-startup-splash img')?.naturalWidth,
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
  let splashCaptured = false;
  for (let i = 0; i < 120; i++) {
    if (await evaluate("!!document.querySelector('#ff-login-email')")) break;
    if (!splashCaptured && process.env.SIGNIN_VERIFY_LOADING_STATES === "1" && await evaluate("!!document.querySelector('.ff-startup-splash svg')")) {
      await send("Page.captureScreenshot", { format: "jpeg", quality: 75 }).then(r => writeFile(`${output}/startup-splash.jpg`, Buffer.from(r.data, "base64")));
      splashCaptured = true;
    }
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
        loginFade:document.documentElement.dataset.loginTransition==='fade',
        holding:document.documentElement.dataset.pageTransition==='holding',
        oldPageOpacity:document.documentElement.dataset.loginTransition==='fade'?Number(getComputedStyle(document.documentElement,'::view-transition-old(root)').opacity):null,
        newPageOpacity:document.documentElement.dataset.loginTransition==='fade'?Number(getComputedStyle(document.documentElement,'::view-transition-new(root)').opacity):null,
        fadeDuration:document.documentElement.dataset.loginTransition==='fade'?getComputedStyle(document.documentElement,'::view-transition-new(root)').animationDuration:null,
        overlay:!!overlay,opacity:overlay?Number(getComputedStyle(overlay).opacity):null,
        outwardRings:document.querySelectorAll('.ff-login-transition-ring').length,
        card:!!card,cardHeight:r?.height,cardTop:r?.top,
        shell:!!shell,dashboard:!!dashboard,
        dashboardLoading:!!document.querySelector('[data-dashboard-loading]'),
        dashboardSkeleton:!!document.querySelector('[data-dashboard-overview-loading]'),
        loading:!!document.querySelector('[data-route-loading]'),
        documentHeight:document.documentElement.scrollHeight,
        bodyBackground:getComputedStyle(document.body).backgroundColor
      });
      if(performance.now()-start<10000)requestAnimationFrame(sample);
    };requestAnimationFrame(sample);
  })()`);
  await click(".ff-login-submit");
  if (process.env.SIGNIN_VERIFY_LOADING_STATES === "1") {
    for (let i = 0; i < 100; i++) {
      if (await evaluate("!!document.querySelector('[data-dashboard-overview-loading]')&&!document.documentElement.dataset.loginTransition")) {
        await send("Page.captureScreenshot", { format: "jpeg", quality: 75 }).then(r => writeFile(`${output}/dashboard-loading.jpg`, Buffer.from(r.data, "base64")));
        break;
      }
      await wait(50);
    }
  }
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
  if (process.env.SIGNIN_VERIFY_CARDS === "1") {
    if (process.env.SIGNIN_DEBUG_FOCUS === "1") await evaluate(`(()=>{
      window.__cardFocusCalls=[];const original=HTMLElement.prototype.focus;
      HTMLElement.prototype.focus=function(...args){
        const card=this.closest('[data-testid^="action-card-"]');
        const entry=card?{target:this.className,flipped:card.classList.contains('is-flipped'),hidden:this.closest('[aria-hidden]')?.getAttribute('aria-hidden'),inert:!!this.closest('[inert]'),visibility:getComputedStyle(this).visibility,ms:Math.round(performance.now())}:null;
        const result=original.apply(this,args);if(entry){entry.succeeded=document.activeElement===this;window.__cardFocusCalls.push(entry)}return result;
      };
    })()`);
    const cards = [];
    for (const id of process.env.SIGNIN_CARDS_FAST === "1" ? [] : ["invoices", "fund", "followups", "chargebacks", "reports", "earl"]) {
      const selector = `[data-testid="action-card-${id}"]`;
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
      await wait(250);
      await click(`${selector} .ff-action-front-button`);
      await wait(700);
      const state = await evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(selector)}),b=c.querySelector('.ff-action-back'),r=b.getBoundingClientRect(),g=b.querySelector('[data-action-go]'),a=g?.getBoundingClientRect();return{id:${JSON.stringify(id)},flipped:c.classList.contains('is-flipped'),busy:c.getAttribute('aria-busy'),backVisible:getComputedStyle(b).visibility,backInert:b.inert,goHit:!g||g.contains(document.elementFromPoint(a.x+a.width/2,a.y+a.height/2)),focusBack:b.contains(document.activeElement),focusClass:document.activeElement.className,transform:getComputedStyle(b).transform}})()`);
      cards.push(state);
      if (process.env.SIGNIN_DEBUG_FOCUS === "1") console.log(JSON.stringify({ focus: await evaluate("window.__cardFocusCalls"), activeTag: await evaluate("document.activeElement.tagName"), manual: await evaluate(`(()=>{const b=document.querySelector('${selector} .ff-action-close');b.focus();return document.activeElement===b})()`) }));
      if (process.env.SIGNIN_ASSERT_CARDS === "1") assert(state.flipped && state.busy === "false" && !state.backInert && state.goHit && state.focusBack, `Card failed: ${JSON.stringify(state)}`);
      await send("Page.captureScreenshot", { format: "jpeg", quality: 75 }).then(r => writeFile(`${output}/card-${id}.jpg`, Buffer.from(r.data, "base64")));
      await click(`${selector} .ff-action-close`);
      await wait(650);
    }
    console.log(JSON.stringify({ cards }));
    if (process.env.SIGNIN_VERIFY_EXTRA_LINKS === "1") {
      const fund = '[data-testid="action-card-fund"]';
      const ready = async path => {
        for (let i = 0; i < 250; i++) {
          if (await evaluate(`location.pathname===${JSON.stringify(path)}&&document.documentElement.dataset.pageTransition!=='holding'&&!!document.querySelector('main')&&${path === "/" ? "!!" : "!"}document.querySelector('[data-testid=agent-dashboard]')`)) return;
          await wait(30);
        }
        throw new Error(`Link/history transition failed: ${path}`);
      };
      const length = await evaluate("history.length");
      await click(`${fund} .ff-action-front-button`); await wait(750);
      await click(`${fund} [data-action-go]`);
      await ready("/sheets");
      assert.equal(await evaluate("history.length"), length + 1);
      await evaluate("history.back()"); await ready("/");
      await evaluate("history.forward()"); await ready("/sheets");
      await evaluate("history.back()"); await ready("/");
      assert.equal(await evaluate("history.length"), length + 1, "Traversal added history entries");
      const first = '[data-testid="action-card-invoices"]';
      await click(`${first} .ff-action-front-button`);
      // Suppress the normal completion event to exercise the safety timer.
      await evaluate(`document.querySelector('${first} .ff-action-rotator').addEventListener('transitionend',e=>e.stopImmediatePropagation(),{once:true,capture:true})`);
      await wait(850);
      assert.equal(await evaluate(`document.querySelector('${first}').getAttribute('aria-busy')`), "false");
      await click(`${first} .ff-action-close`); await wait(750);
      // Closing restores keyboard focus to the front control.
      assert(await evaluate(`document.activeElement===document.querySelector('${first} .ff-action-front-button')`), "Closing did not restore front-button focus");
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await wait(750);
      assert(await evaluate(`document.querySelector('${first}').classList.contains('is-flipped')`));
      await click(`${first} .ff-action-close`); await wait(750);
      await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
      const point = await evaluate(`(()=>{const r=document.querySelector('${first} .ff-action-front-button').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await wait(850);
      assert(await evaluate(`document.querySelector('${first}').classList.contains('is-flipped')`), "Touch compatibility click double-flipped the card");
      await send("Emulation.setTouchEmulationEnabled", { enabled: false });
      await click(`${first} .ff-action-close`); await wait(750);
      console.log(JSON.stringify({ cardLink: true, backForward: true, boundedAnimationLock: true, keyboard: true, touch: true }));
    }
  }
  if (process.env.SIGNIN_VERIFY_NAVIGATION === "1") {
    await evaluate("window.__persistentSidebar=document.querySelector('aside');true");
    delayPermissions = true;
    await send("Fetch.enable", { patterns: [{ urlPattern: process.env.SIGNIN_DELAY_DATA === "1" ? "*/api/*" : "*/api/auth/permissions", requestStage: "Request" }] });
    const labels = await evaluate("Array.from(document.querySelectorAll('aside button[aria-label]'), el=>el.getAttribute('aria-label'))");
    const source = await readFile("client/src/components/layout/sidebar.tsx", "utf8");
    const routes = process.env.SIGNIN_ALL_ROUTES === "1"
      ? [...source.matchAll(/\{\s*name:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g)]
        .map(([, label, route]) => [label, route]).filter(([label]) => labels.includes(label))
      : [["Invoices", "/invoices"], ["Carriers", "/clients"], ["Brokers", "/brokers"], ["Documents", "/documents"], ["Calendar", "/calendar"]];
    const appSource = await readFile("client/src/App.tsx", "utf8");
    const modules = new Map([...appSource.matchAll(/lazyPage\((\[[^\]]*\]),\s*\(\)\s*=>\s*import\("@\/pages\/([^"]+)"\)/g)]
      .flatMap(([, paths, module]) => JSON.parse(paths).map(route => [route, module])));
    modules.set("/chat", "chat");
    if (process.env.SIGNIN_ALL_ROUTES === "1") {
      // Test an actual dashboard return, not only its initial same-address click.
      routes.push(["Agent Dashboard", "/"]);
    }
    for (const [label, path] of routes) {
      const selector = `aside button[aria-label="${label}"]`;
      assert(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), `${label} navigation missing`);
      const previousPath = await evaluate("location.pathname");
      await evaluate(`(()=>{window.__navigationFrames=[];window.__navigationActive=true;
        window.__navigationEpoch=(window.__navigationEpoch||0)+1;const epoch=window.__navigationEpoch;
        (function sample(){window.__navigationFrames.push({
          ms:performance.now(),
          path:location.pathname,loading:!!document.querySelector('[data-route-loading]'),
          pending:!!document.querySelector('[data-navigation-pending]'),
          checking:document.body.innerText.includes('Checking page access'),
          holding:document.documentElement.dataset.pageTransition==='holding',
          loadingCopy:document.querySelector('main')?.innerText.match(/\\bLoading\\b[^\\n]*/g)?.slice(0,3)||[],
        sidebarWidth:document.querySelector('aside')?.getBoundingClientRect().width,
          mainHeight:document.querySelector('main')?.getBoundingClientRect().height,
          contentHeight:document.querySelector('[data-route-viewport]')?.getBoundingClientRect().height,
          documentHeight:document.documentElement.scrollHeight
        });if(window.__navigationActive&&window.__navigationEpoch===epoch)requestAnimationFrame(sample)})()})()`);
      const clickTime = await click(selector, process.env.SIGNIN_VERIFY_LOADING_STATES === "1" ? 250 : 0);
      if (label === "Invoices" && process.env.SIGNIN_VERIFY_LOADING_STATES === "1") {
        await send("Page.captureScreenshot", { format: "jpeg", quality: 75 }).then(r => writeFile(`${output}/navigation-pending.jpg`, Buffer.from(r.data, "base64")));
      }
      for (let i = 0; i < 200; i++) {
        if (await evaluate(`location.pathname===${JSON.stringify(path.split("?")[0])}`)) break;
        await wait(50);
      }
      if (await evaluate("location.pathname") !== path.split("?")[0]) {
        console.log(JSON.stringify({ navigationFailure: label, responses: responses.slice(-8),
          state: await evaluate(`({path:location.pathname,pending:document.querySelector('[data-navigation-pending]')?.getAttribute('aria-label'),alerts:Array.from(document.querySelectorAll('[role="alert"]')).map(e=>e.textContent),active:document.activeElement?.getAttribute('aria-label')})`) }));
        await send("Page.captureScreenshot", { format: "jpeg", quality: 75 }).then(r => writeFile(`${output}/navigation-failure.jpg`, Buffer.from(r.data, "base64")));
      }
      assert.equal(await evaluate("location.pathname"), path.split("?")[0], `${label} never opened`);
      for (let i = 0; i < 100; i++) {
        if (await evaluate("document.documentElement.dataset.pageTransition!=='holding'")) break;
        await wait(25);
      }
      await wait(process.env.SIGNIN_ALL_ROUTES === "1" ? 1000 : 150);
      const samples = (await evaluate("window.__navigationActive=false;window.__navigationFrames")).filter(frame => frame.ms >= clickTime);
      const detail = { label, frames: samples.length,
        sidebarStable: await evaluate("document.querySelector('aside')===window.__persistentSidebar&&window.__persistentSidebar.isConnected"),
        clickToCommitMs: Math.round((samples.find(frame=>frame.path===path.split('?')[0])?.ms ?? clickTime)-clickTime),
        pendingFrames: samples.filter(f => f.pending).length,
        fallbackFrames: samples.filter(f => f.loading || f.checking).length,
        dataLoadingFrames: samples.filter(f => !f.holding && f.loadingCopy.length).length,
        loadingCopy: [...new Set(samples.filter(f => !f.holding).flatMap(f => f.loadingCopy))],
        heldFrames: samples.filter(f => f.holding).length,
        overflowFrames: samples.filter(f => f.documentHeight > 900).length,
        collapsedFrames: samples.filter(f => f.mainHeight != null && f.mainHeight < 300).length,
        sidebarWidthChange: Math.max(...samples.map(f => f.sidebarWidth ?? 0)) - Math.min(...samples.map(f => f.sidebarWidth ?? 0)),
      };
      if (process.env.SIGNIN_VERIFY_LOADING_STATES === "1" && path.split("?")[0] !== previousPath) {
        const prefix = `/assets/${modules.get(path.split("?")[0])?.split("/").at(-1) ?? path.split("/")[1]}-`;
        detail.intentPrefetched = await evaluate(`performance.getEntriesByType('resource').some(r=>new URL(r.name).pathname.startsWith(${JSON.stringify(prefix)})&&r.name.endsWith('.js')&&r.startTime<${clickTime})`);
        assert(detail.intentPrefetched, `${label} did not request its chunk before the sidebar click`);
      }
      navigation.push(detail);
      // Cached/preloaded pages can now commit within one frame: do not force
      // a visible loading overlay just to make the test observe a placeholder.
      assert(detail.sidebarStable, `${label} remounted the shared sidebar`);
      assert.equal(detail.fallbackFrames, 0, `${label} exposed an intermediate loading page`);
      assert.equal(detail.overflowFrames, 0, `${label} overflowed the document`);
      assert.equal(detail.collapsedFrames, 0, `${label} collapsed the content viewport`);
      assert(detail.sidebarWidthChange <= 1, `${label} changed sidebar width by ${detail.sidebarWidthChange}px`);
      if (process.env.SIGNIN_ALL_ROUTES === "1") {
        await send("Page.captureScreenshot", { format: "jpeg", quality: 60 })
          .then(r => writeFile(`${output}/route-${path.split("?")[0].replaceAll("/", "-") || "dashboard"}.jpg`, Buffer.from(r.data, "base64")));
      }
      if (process.env.SIGNIN_ASSERT_DATA_NOFLASH === "1") assert.equal(detail.dataLoadingFrames, 0, `${label} showed a data-loading flash`);
    }
    if (process.env.SIGNIN_TEST_EMPLOYEE === "1") {
      permissionOverride = "error";
      await click('aside button[aria-label="Invoices"]');
      await wait(1200);
      assert.equal(await evaluate("location.pathname"), "/invoices", "Background refresh blocked navigation");
      assert(await evaluate("document.body.innerText.includes('Access refresh delayed')"), "Background refresh error was silent");
      assert(!await evaluate("document.body.innerText.includes('Checking page access')"), "Background refresh unmounted the working page");
      permissionOverride = "deny";
      await click('aside button[aria-label="Carriers"]');
      await wait(1500);
      assert(!await evaluate("!!document.querySelector('aside button[aria-label=\"Invoices\"]')"), "Revoked permission remained in the sidebar");
      const deniedAt = await evaluate("performance.now()");
      await evaluate("history.pushState({},'', '/invoices');window.dispatchEvent(new Event('pushState'))");
      await wait(1000);
      const invoiceReads = await evaluate(`performance.getEntriesByType('resource').filter(r=>r.startTime>${deniedAt}&&new URL(r.name).pathname.startsWith('/api/invoices')).length`);
      assert.equal(invoiceReads, 0, "Denied destination mounted and fetched invoice data");
      assert(await evaluate("location.pathname!=='/invoices'||document.body.innerText.includes('Access Denied')"), "Denied destination was not blocked");
      navigation.push({ backgroundFailureKeptPage: true, revokedAccessBlocked: true });
      permissionOverride = null;
    }
    await send("Fetch.disable");
    await send("Page.captureScreenshot", { format: "jpeg", quality: 75 }).then(r => writeFile(`${output}/navigation.jpg`, Buffer.from(r.data, "base64")));
  }
  if (process.env.SIGNIN_VERIFY_FRESHNESS === "1") {
    // Run on the mounted dashboard after the all-route walk. Intercept the
    // synthetic write before it leaves Chromium; real dashboard reads remain
    // authenticated and use the application API without mocked data.
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/__dashboard_freshness_probe", requestStage: "Request" }] });
    const sections = ["followups", "activity", "alerts", "financial"];
    for (let i = 0; i < 200; i++) {
      if (await evaluate("!!document.querySelector('[data-testid=\"agent-dashboard\"]')&&!document.querySelector('[data-dashboard-loading]')")) break;
      await wait(50);
    }
    assert(await evaluate("!!document.querySelector('[data-testid=\"agent-dashboard\"]')"), "Freshness checks require the dashboard");
    for (const method of ["POST", "PATCH", "DELETE", "PUT", "GET"]) {
      const epoch = await evaluate("performance.now()");
      const status = await evaluate(`fetch('/api/__dashboard_freshness_probe',{method:${JSON.stringify(method)}}).then(r=>r.status)`);
      const shouldRefresh = !["PUT", "GET"].includes(method);
      let refreshed = [];
      for (let i = 0; i < (shouldRefresh ? 200 : 20); i++) {
        refreshed = await evaluate(`performance.getEntriesByType('resource').filter(r=>r.startTime>=${epoch}&&new URL(r.name).pathname.startsWith('/api/agent-dashboard/')).map(r=>new URL(r.name).pathname.split('/').at(-1))`);
        if (shouldRefresh && sections.every(section => refreshed.includes(section))) break;
        await wait(50);
      }
      for (const section of sections) assert.equal(refreshed.includes(section), shouldRefresh, `${method} dashboard ${section} invalidation`);
      navigation.push({ freshnessMethod: method, syntheticStatus: status, refreshedSections: [...new Set(refreshed)] });
    }
    await send("Fetch.disable");
  }
  if (process.env.SIGNIN_VERIFY_FUEL === "1") {
    const fuel = await evaluate(`(async()=>{
      const list=await fetch('/api/fuel-advances',{credentials:'include'});const rows=await list.json();
      const id=Array.isArray(rows)&&rows.length?rows[0].id:2147483647;
      const detail=await fetch('/api/fuel-advances/'+id,{credentials:'include'});
      return{listStatus:list.status,listValid:Array.isArray(rows),detailStatus:detail.status,hadExistingRecord:Array.isArray(rows)&&rows.length>0};
    })()`);
    assert.equal(fuel.listStatus, 200);
    assert(fuel.listValid);
    assert.equal(fuel.detailStatus, fuel.hadExistingRecord ? 200 : 404);
    console.log(JSON.stringify({ fuelAdvanceReads: fuel }));
    await click('aside button[aria-label="Fuel Advance"]');
    for (let i = 0; i < 200; i++) {
      if (await evaluate("location.pathname==='/fuel-advance'&&document.documentElement.dataset.pageTransition!=='holding'&&!!document.querySelector('main')")) break;
      await wait(30);
    }
    const fuelPage = await evaluate("({path:location.pathname,text:document.querySelector('main')?.innerText||'',holding:document.documentElement.dataset.pageTransition==='holding'})");
    assert.equal(fuelPage.path, "/fuel-advance");
    assert.equal(fuelPage.holding, false);
    assert(!/Failed to fetch fuel advances|Something went wrong/i.test(fuelPage.text));
    await send("Page.captureScreenshot", { format: "jpeg", quality: 80 }).then(r => writeFile(`${output}/fuel-advances.jpg`, Buffer.from(r.data, "base64")));
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
  assert.equal(frames.at(-1)?.loginFade, false, "Sign-in fade state was not cleaned up.");
  if (process.env.SIGNIN_EXPECT_FADE === "1") {
    const fading = frames.filter(frame => frame.loginFade && !frame.holding);
    if (process.env.SIGNIN_REDUCED_MOTION === "1" || process.env.SIGNIN_NO_VIEW_TRANSITION === "1") {
      assert.equal(fading.length, 0, "Reduced-motion or unsupported browser unexpectedly animated.");
    } else {
      assert(fading.length >= 8, "Successful sign-in did not crossfade gradually.");
      assert(fading.some(frame => frame.fadeDuration?.split(',').some(duration => duration.trim() === "0.65s")), "Login used the fast navigation duration instead of its gentle fade.");
      assert(fading.some(frame => frame.oldPageOpacity > 0.05 && frame.oldPageOpacity < 0.95), "The old login did not fade through intermediate opacity.");
      assert(fading.some(frame => frame.newPageOpacity > 0.05 && frame.newPageOpacity < 0.95), "The dashboard did not fade through intermediate opacity.");
    }
  }
  if (process.env.SIGNIN_EXPECT_NO_EFFECT === "1") {
    assert(frames.every(frame => !frame.overlay && frame.outwardRings === 0), "A removed sign-in effect still appeared.");
    assert(report.entryFrames.every(frame => !frame.loading && !frame.shell), "Anonymous entry flashed a loading screen.");
    assert(report.entryFrames.some(frame => frame.login), "Entry did not render the login form.");
  }
  if (process.env.SIGNIN_EXPECT_CONTINUITY === "1") {
    assert.equal(report.uncoveredLoadingFrames, 0, "Login uncovered the loading route before the dashboard committed.");
  }
  if (process.env.SIGNIN_VERIFY_LOADING_STATES === "1") {
    assert(report.entryFrames.some(frame => frame.splash && frame.logoReady && !frame.login), "Inline logo splash was not visible before the application loaded.");
    const structural = frames.find(frame => frame.dashboard && frame.dashboardSkeleton && frame.dashboardLoading);
    assert(structural, "Dashboard did not reveal a structural skeleton while its API was delayed.");
    const populated = frames.find(frame => frame.dashboard && !frame.dashboardLoading);
    assert(populated && populated.ms - structural.ms > 500, "Dashboard presentation waited for its delayed data.");
    // Measure the first sign-in cohort, not later dashboard revisits, periodic
    // refreshes, or the deliberate write-invalidation checks in the same run.
    const requests = ["followups", "activity", "alerts", "financial"].map(section =>
      report.resources.find(resource => resource.path === `/api/agent-dashboard/${section}`));
    assert(requests.every(Boolean), "The four dashboard section requests were not observed.");
    const starts = requests.map(request => request.start);
    assert(Math.max(...starts) - Math.min(...starts) < 250, "Dashboard requests did not start in parallel.");
  }
} finally {
  browser.kill("SIGTERM");
  await wait(250);
  await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
