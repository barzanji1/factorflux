// Browser smoke checks use the normal login form and existing development-only
// test credentials. No credential, session cookie or client contents are logged.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const out = process.env.NEU_SMOKE_OUTPUT || "generated-artifacts/neu-rollout";
// Keep the development hostname/Host header, while selecting the workflow's
// known application port rather than an unrelated port on Preview's proxy.
const host = process.env.REPLIT_DEV_DOMAIN;
const base = `http://${host}:5000`;
const routes = process.env.NEU_SMOKE_ROUTES?.split(",").filter(Boolean) || ["/client-email", "/client-email?tab=log", "/email-log", "/factoring", "/sheets", "/payouts",
  "/cash-application", "/lockbox", "/fuel-advance", "/bank-transfers", "/dispatchers", "/trucks", "/release-letters",
  "/credit-checks", "/fmcsa-authority", "/held", "/audit-log", "/followups", "/reports", "/admin", "/payroll",
  "/expenses", "/vault", "/document-rules", "/workflow-builder"];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(path.join(tmpdir(), "neu-browser-"));
let browser, socket;
try {
  if (!process.env.DEV_ADMIN_EMAIL || !process.env.DEV_ADMIN_PASSWORD) throw new Error("Development test credentials unavailable");
  await mkdir(out, { recursive: true });
  // Pipe transport opens no extra port that could confuse Preview routing.
  browser = spawn("/repl/tools/bin/chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe",
    `--host-resolver-rules=MAP ${host} 127.0.0.1`, "--no-proxy-server",
    `--unsafely-treat-insecure-origin-as-secure=${base}`,
    `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  socket = { send: data => browser.stdio[3].write(`${data}\0`), close: () => browser.stdio[3].end() };
  let id = 0, session, uncaught = 0, exceptions = [];
  const pending = new Map();
  const handleMessage = message => {
    if (message.method === "Runtime.exceptionThrown") {
      uncaught++;
      exceptions.push((message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[REDACTED]").slice(0,1000));
    }
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      message.error ? request.reject(new Error("Browser protocol command failed")) : request.resolve(message.result);
    }
  };
  let buffered = "";
  const decoder = new StringDecoder("utf8");
  browser.stdio[4].on("data", chunk => {
    buffered += decoder.write(chunk);
    let boundary;
    while ((boundary = buffered.indexOf("\0")) !== -1) {
      const encoded = buffered.slice(0,boundary);
      buffered = buffered.slice(boundary+1);
      if (encoded) handleMessage(JSON.parse(encoded));
    }
  });
  const send = (method, params = {}, scoped = true) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(new Error(`Browser command timed out: ${method}`)); }, 20_000);
    pending.set(key, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: key, method, params, ...(scoped && session ? { sessionId: session } : {}) }));
  });
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Page.enable"); await send("Runtime.enable");
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error("Browser evaluation failed");
    return result.result.value;
  };
  const navigate = async route => {
    await send("Page.navigate", { url: `${base}${route}` });
    await delay(1600);
  };
  const pointerClick = async selector => {
    const rect = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;el.scrollIntoView({block:'center',behavior:'instant'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    if (!rect) throw new Error("Expected form control missing");
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...rect, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...rect, button: "left", clickCount: 1 });
  };
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate("/login");
  for (let i = 0; i < 150 && !await evaluate("!!document.querySelector('input[type=email]')"); i++) await delay(200);
  if (!await evaluate("!!document.querySelector('input[type=email]')")) {
    const image = await send("Page.captureScreenshot", { format: "jpeg", quality: 65 });
    await writeFile(`${out}/login-debug.jpg`, Buffer.from(image.data, "base64"));
    throw new Error(`Login form did not render; page path: ${await evaluate("location.pathname")}; screenshot saved`);
  }
  if (await evaluate("!!document.querySelector('vite-error-overlay')")) throw new Error("Development error overlay is blocking login");
  await pointerClick("input[type=email]");
  await send("Input.insertText", { text: process.env.DEV_ADMIN_EMAIL });
  await pointerClick("input[type=password]");
  await send("Input.insertText", { text: process.env.DEV_ADMIN_PASSWORD });
  await pointerClick("button[type=submit]");
  for (let i = 0; i < 30 && await evaluate("location.pathname") === "/login"; i++) await delay(250);
  if (await evaluate("location.pathname") === "/login") throw new Error("Existing development test credentials did not authenticate; no account changes made");
  const results = [];
  for (const requestedRoute of routes) {
    let route = requestedRoute;
    if (requestedRoute.endsWith("/:first")) {
      const entity = requestedRoute.split("/")[1];
      const firstId = await evaluate(`(async()=>{const response=await fetch('/api/${entity}?limit=15',{credentials:'include'});if(!response.ok)return null;const payload=await response.json();const rows=Array.isArray(payload)?payload:payload.data??payload.items??payload.${entity}??[];return Array.isArray(rows)&&rows[0]?.id!=null?String(rows[0].id):null;})()`);
      if (!firstId) {
        results.push({ route: requestedRoute, skipped: true, reason: "No accessible existing record for detail smoke check" });
        console.log(JSON.stringify({ route: requestedRoute, skipped: true }));
        continue;
      }
      route = `/${entity}/${encodeURIComponent(firstId)}`;
    }
    uncaught = 0; exceptions = [];
    await evaluate(`(()=>{history.pushState({},'',${JSON.stringify(route)});dispatchEvent(new PopStateEvent('popstate'));})()`);
    for (let i = 0; i < 60; i++) {
      if (await evaluate("!!document.querySelector('[data-insights-entity], aside, [data-sidebar=\"sidebar\"]')")) break;
      await delay(150);
    }
    await delay(800);
    const status = await evaluate(`({
      path:location.pathname,
      sidebar:!!document.querySelector('aside, [data-sidebar="sidebar"]'),
      notFound:/404 Page Not Found|page doesn't exist/i.test(document.body.innerText),
      accessDenied:/Access Denied|don't have permission to access/i.test(document.body.innerText),
      overlays:!!document.querySelector('vite-error-overlay'),
      insights:document.querySelectorAll('[data-insights-entity]').length,
      horizontalOverflow:document.documentElement.scrollWidth > innerWidth + 2
    })`);
    const ok = !status.notFound && !status.accessDenied && !status.overlays && uncaught === 0 && status.path !== "/login" && status.sidebar;
    results.push({ route, ...status, uncaught, exceptions, ok });
    if (process.env.NEU_SMOKE_ROUTES || ["/client-email?tab=log", "/sheets", "/admin", "/reports"].includes(route)) {
      const image = await send("Page.captureScreenshot", { format: "jpeg", quality: 65, captureBeyondViewport: false });
      await writeFile(`${out}/${route.split("?")[0].slice(1).replaceAll("/", "-") || "dashboard"}.jpg`, Buffer.from(image.data, "base64"));
    }
    console.log(JSON.stringify({ route, ok, uncaught, sidebar: status.sidebar, insights: status.insights }));
  }
  let sheets;
  if (process.env.SHEETS_VERIFY === "1") {
    sheets = await evaluate(`(async () => {
      const response = await fetch('/api/invoices/funding/queue?page=1&pageSize=15', {credentials:'include'});
      const data = await response.json();
      const first = data.rows?.[0];
      const detailResponse = first ? await fetch('/api/invoices/'+first.id+'/detail', {credentials:'include'}) : null;
      const detailPayload = detailResponse?.ok ? await detailResponse.json() : null;
      const detail = detailPayload?.invoice ?? detailPayload;
      const headers = [...document.querySelectorAll('.ff-data-table thead th')].map(el=>el.textContent.trim());
      const row = document.querySelector('.ff-data-table tbody tr');
      const actions = row?.lastElementChild;
      const buttons = [...(actions?.querySelectorAll('button')??[])];
      return {
        total:data.total,
        firstRows:(data.rows??[]).slice(0,3).map(r=>({id:r.id,invoiceNumber:r.invoiceNumber,status:r.status,submittedByName:r.submittedByName,submittedAt:r.submittedAt})),
        firstDetail:detail ? {id:detail.id,invoiceNumber:detail.invoiceNumber,status:detail.status,submittedBy:detail.submittedBy,submittedAt:detail.submittedAt,createdAt:detail.createdAt,dataOrigin:detail.dataOrigin}:null,
        headers, firstRenderedCells:[...(row?.children??[])].map(el=>el.textContent.trim()),
        rowBackground:row?getComputedStyle(row).backgroundColor:null,
        hovered:row?.matches(':hover'),selectedCheckbox:row?.querySelector('[role=checkbox]')?.getAttribute('data-state'),
        actionLayout:actions?{width:actions.getBoundingClientRect().width,wrap:getComputedStyle(actions.firstElementChild).flexWrap,gap:getComputedStyle(actions.firstElementChild).gap}:null,
        buttons:buttons.map(b=>({text:b.textContent.trim()||b.getAttribute('aria-label'),height:b.getBoundingClientRect().height,top:b.getBoundingClientRect().top}))
      };
    })()`);
    const statusIndex = sheets.headers.indexOf("Status");
    const expectedStatus = sheets.firstRows[0]?.status.replace(/_/g, " ").replace(/^\w/, letter => letter.toUpperCase());
    sheets.ok = statusIndex >= 0 && sheets.firstRenderedCells[statusIndex] === expectedStatus &&
      sheets.actionLayout?.wrap === "nowrap" && sheets.actionLayout?.gap === "8px" &&
      sheets.buttons.length > 0 && sheets.buttons.every(b => b.height === 32 && Math.abs(b.top - sheets.buttons[0].top) < 1);
    if (!sheets.ok) process.exitCode = 1;
    await evaluate("document.querySelector('.ff-data-table tbody tr td:last-child')?.scrollIntoView({block:'center',inline:'end',behavior:'instant'})");
    const hoverPoint = await evaluate("(()=>{const r=document.querySelector('.ff-data-table tbody tr td:last-child').getBoundingClientRect();return{x:r.left+8,y:r.top+8}})()");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverPoint });
    sheets.hoverBackground = await evaluate("getComputedStyle(document.querySelector('.ff-data-table tbody tr')).backgroundColor");
    console.log(JSON.stringify({ sheetsVerification: sheets }));
    const image = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    await writeFile(`${out}/sheets-actions.jpg`, Buffer.from(image.data, "base64"));
  }
  let notices;
  if (process.env.NEU_NOTICE_VERIFY === "1") {
    await evaluate("history.pushState({},'', '/neu-preview');dispatchEvent(new PopStateEvent('popstate'))");
    await delay(1200);
    await evaluate("document.querySelector('[aria-label=\"Notice severity samples\"]')?.scrollIntoView({block:'center',behavior:'instant'})");
    await pointerClick('[data-testid="notice-sample-ack"] input[type="checkbox"]');
    await pointerClick('[aria-label="Sample acknowledgement reason"]');
    await send("Input.insertText", { text: "Reviewed in browser test" });
    notices = await evaluate(`({
      styles:[...document.querySelectorAll('[data-testid^="notice-sample-"]')].map(el=>{
        const s=getComputedStyle(el),title=getComputedStyle(el.querySelector('.neu-notice-title'));
        return {severity:el.dataset.neuNotice,background:s.backgroundColor,left:s.borderLeftWidth,top:s.borderTopWidth,padding:s.paddingTop,inset:s.boxShadow.includes('inset'),title:title.color};
      }),
      checked:document.querySelector('[data-testid="notice-sample-ack"] input').checked,
      reason:document.querySelector('[aria-label="Sample acknowledgement reason"]').value
    })`);
    const ok = notices.styles.length === 3 && notices.styles.every(s => s.background === "rgb(224, 224, 224)" && s.left === "4px" && s.top === "0px" && s.padding === "16px" && s.inset) &&
      notices.checked && notices.reason === "Reviewed in browser test";
    notices.ok = ok;
    if (!ok) process.exitCode = 1;
    console.log(JSON.stringify({ noticeVerification: notices }));
    await evaluate("document.querySelector('[aria-label=\"Notice severity samples\"]')?.scrollIntoView({block:'center',behavior:'instant'})");
    const image = await send("Page.captureScreenshot", { format: "jpeg", quality: 75 });
    await writeFile(`${out}/notice-severities.jpg`, Buffer.from(image.data, "base64"));
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
   const mobileRoute = process.env.NEU_NOTICE_VERIFY === "1" ? "/neu-preview" :
     process.env.NEU_SMOKE_ROUTES ? routes[0] : "/client-email?tab=log";
   await evaluate(`history.pushState({},'', ${JSON.stringify(mobileRoute)});dispatchEvent(new PopStateEvent('popstate'))`);
  await delay(1500);
  if (process.env.NEU_NOTICE_VERIFY === "1") {
    await evaluate("document.querySelector('[aria-label=\"Notice severity samples\"]')?.scrollIntoView({block:'start',behavior:'instant'})");
  }
  const mobile = await evaluate(`({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+2,modalCount:document.querySelectorAll('[role=dialog]').length})`);
  const image = await send("Page.captureScreenshot", { format: "jpeg", quality: 65, captureBeyondViewport: false });
  await writeFile(`${out}/email-mobile.jpg`, Buffer.from(image.data, "base64"));
  await writeFile(`${out}/browser-results.json`, JSON.stringify({ results, mobile, notices, sheets }, null, 2));
  if (results.some(result => !result.skipped && !result.ok) || mobile.overflow) process.exitCode = 1;
} catch (error) {
  // Fixed local messages only; never dump browser protocol payloads or stderr.
  console.error(error instanceof Error ? error.message : "Browser verification failed");
  process.exitCode = 1;
} finally {
  socket?.close();
  browser?.kill("SIGKILL");
  await delay(200);
  await rm(profile, { recursive: true, force: true });
}
