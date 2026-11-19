// Real compiled assets and normal staff authentication. Never persists credentials or API bodies.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { StringDecoder } from "node:string_decoder";

const origin = process.env.SIGNIN_TEST_URL;
assert.ok(origin, "Run through scripts/verify-production-performance.ts");
const out = process.env.THEME_TEST_OUTPUT || "generated-artifacts/dark-mode";
const baseline = process.env.THEME_BASELINE === "1";
await mkdir(out, { recursive: true });
const profile = await mkdtemp(`${tmpdir()}/theme-check-`);
const browser = spawn("/repl/tools/bin/chromium", [
  "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-pipe",
  `--user-data-dir=${profile}`, "--no-first-run",
  `--host-resolver-rules=MAP ${new URL(origin).hostname} 127.0.0.1`,
  "--no-proxy-server", `--unsafely-treat-insecure-origin-as-secure=${origin}`, "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
let seq = 0, session, buffer = "", signedIn = false;
const pending = new Map(), errors = [];
const decoder = new StringDecoder("utf8");
browser.stdio[4].on("data", chunk => {
  buffer += decoder.write(chunk);
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw), waiter = pending.get(message.id);
    if (message.method === "Runtime.exceptionThrown") errors.push("Uncaught browser exception");
    if (waiter) {
      pending.delete(message.id); clearTimeout(waiter.timer);
      message.error ? waiter.reject(Error(message.error.message)) : waiter.resolve(message.result);
    }
  }
});
function send(method, params = {}, scoped = true) {
  return new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(scoped && session ? { sessionId: session } : {}) }) + "\0");
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error("Browser evaluation failed");
  return result.result.value;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression) {
  const start = Date.now();
  while (Date.now() - start < 35000) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw Error(`Timed out: ${expression}`);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  let point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await sleep(350);
  point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  assert.ok(await evaluate(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${point.x},${point.y}))`), `Pointer blocked: ${selector}`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
const sample = `(()=>{
  const style=selector=>{const e=document.querySelector(selector);if(!e)return null;const s=getComputedStyle(e),r=e.getBoundingClientRect();return{background:s.backgroundColor,color:s.color,shadow:s.boxShadow,radius:s.borderRadius,width:Math.round(r.width),height:Math.round(r.height)}};
  const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0};
  const bright=[...document.querySelectorAll('main *,aside *,[role=dialog] *')].filter(visible).filter(e=>{
    const c=getComputedStyle(e).backgroundColor.match(/^rgb\\((\\d+), (\\d+), (\\d+)\\)$/);
    return c&&Math.min(+c[1],+c[2],+c[3])>150&&Math.max(+c[1],+c[2],+c[3])-Math.min(+c[1],+c[2],+c[3])<20;
  }).slice(0,20).map(e=>({tag:e.tagName,classes:typeof e.className==='string'?e.className.slice(0,180):'svg',background:getComputedStyle(e).backgroundColor}));
  return{theme:document.documentElement.dataset.theme,stored:localStorage.getItem('theme'),body:style('body'),main:style('main'),sidebar:style('aside'),card:style('.ff-institutional-neu-card,.ff-neu-dashboard-card,[data-slot=card]'),input:style('main input'),table:style('main table'),charts:document.querySelectorAll('.recharts-surface').length,brightNeutralSurfaces:bright,overflow:document.documentElement.scrollWidth>innerWidth+1};
})()`;
const report = { compiledProduction: true, baseline, pages: [] };
try {
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: origin + "/login" });
  await until("!!document.querySelector('#ff-login-email')");
  await click("#ff-login-email"); await send("Input.insertText", { text: process.env.DEV_ADMIN_EMAIL });
  await click("#ff-login-password"); await send("Input.insertText", { text: process.env.DEV_ADMIN_PASSWORD });
  await click(".ff-login-submit");
  await until("location.pathname==='/'&&!!document.querySelector('aside')");
  signedIn = true;
  await sleep(2000);
  for (const [label, path] of [["Agent Dashboard","/"],["Invoices","/invoices"],["Carriers","/clients"],["Brokers","/brokers"],["Reports","/reports"],["Settings","/settings"]]) {
    if (path === "/settings") {
      await send("Page.navigate", { url: origin + path });
    } else if (path !== "/") await click(`aside button[aria-label=${JSON.stringify(label)}]`);
    await until(`location.pathname===${JSON.stringify(path)}&&!!document.querySelector('aside')&&!!document.querySelector('main')`);
    await sleep(2500);
    if (!baseline && await evaluate("document.documentElement.dataset.theme==='dark'")) await click('aside [role="switch"][aria-label="Dark mode"]');
    // Compare the same expanded-sidebar geometry; keyboard focus deliberately
    // keeps the sidebar expanded after operating its accessible footer switch.
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 200 });
    await sleep(350);
    const light = await evaluate(sample);
    await writeFile(`${out}/${label.replaceAll(" ","-")}-light.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    if (baseline) { report.pages.push({ label, path, light }); continue; }
    await click('aside [role="switch"][aria-label="Dark mode"]');
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 200 });
    await sleep(350);
    const dark = await evaluate(sample);
    report.pages.push({ label, path, light, dark });
    assert.equal(dark.theme, "dark"); assert.equal(dark.stored, "dark");
    assert.equal(dark.body.background, "rgb(13, 13, 13)", `${label} body`);
    assert.equal(dark.main.background, "rgb(13, 13, 13)", `${label} workspace`);
    assert.equal(dark.sidebar.background, "rgb(26, 26, 26)", `${label} sidebar`);
    assert.equal(dark.main.width, light.main.width, `${label} layout width`);
    assert.equal(dark.overflow, false, `${label} horizontal overflow`);
    if (dark.card) {
      assert.equal(dark.card.color, "rgb(232, 232, 232)", `${label} card text`);
      assert.equal(dark.card.radius, light.card.radius, `${label} card geometry`);
    }
    await writeFile(`${out}/${label.replaceAll(" ","-")}-dark.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    if (["Invoices", "Carriers", "Brokers"].includes(label)) {
      await evaluate(`document.querySelector('main table')?.scrollIntoView({block:'center',behavior:'instant'});true`);
      await sleep(150);
      await writeFile(`${out}/${label}-dark-table.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    }
    console.log(JSON.stringify({ label, light: light.body.background, dark: dark.body.background, brightSurfaces: dark.brightNeutralSurfaces.length }));
  }
  if (!baseline) {
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__themeAtDomReady=null;addEventListener('DOMContentLoaded',()=>window.__themeAtDomReady=document.documentElement.dataset.theme,{once:true});` });
    await send("Page.reload");
    await until("!!document.querySelector('aside')&&window.__themeAtDomReady!==null");
    assert.equal(await evaluate("window.__themeAtDomReady"), "dark");
    assert.equal(await evaluate("document.documentElement.dataset.theme"), "dark");
    report.darkReloadBeforeReact = true;
    await evaluate(`(()=>{const buttons=[...document.querySelectorAll('header button[aria-haspopup="menu"]')];buttons.at(-1)?.setAttribute('data-theme-profile','');return true})()`);
    if (await evaluate("!!document.querySelector('[data-theme-profile]')")) {
      await click("[data-theme-profile]");
      await until("!!document.querySelector('[role=menu]')");
      report.profileMenu = await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('[role=menu]'));return{background:s.backgroundColor,color:s.color}})()`);
      assert.equal(report.profileMenu.background, "rgb(26, 26, 26)");
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    }
    // Settings must reflect the shared preference rather than resetting it.
    await click('aside [role="switch"][aria-label="Dark mode"]');
    assert.equal(await evaluate("localStorage.getItem('theme')"), "light");
    await send("Page.reload");
    await until("!!document.querySelector('aside')");
    assert.equal(await evaluate("document.documentElement.dataset.theme"), "light");
    report.lightReload = true;
    // Native button keyboard operation, not a programmatic click.
    await evaluate(`document.querySelector('aside [role="switch"][aria-label="Dark mode"]').focus();true`);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    assert.equal(await evaluate("document.documentElement.dataset.theme"), "dark");
    report.keyboardToggle = true;
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await click('[aria-label="Open navigation"]');
    await until(`!!document.querySelector('[role="dialog"] aside [role="switch"][aria-label="Dark mode"]')`);
    await click('[role="dialog"] aside [role="switch"][aria-label="Dark mode"]');
    assert.equal(await evaluate("document.documentElement.dataset.theme"), "light");
    await click('[role="dialog"] aside [role="switch"][aria-label="Dark mode"]');
    assert.equal(await evaluate("document.documentElement.dataset.theme"), "dark");
    await writeFile(`${out}/mobile-dark-toggle.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    report.mobileToggle = true;
  }
  assert.equal(errors.length, 0);
  report.browserExceptions = errors.length;
} catch (error) {
  report.error = error.message; process.exitCode = 1; console.error(error.message);
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  if (signedIn) await evaluate("fetch('/api/auth/logout',{method:'POST',credentials:'include'}).then(()=>true)").catch(() => {});
  await send("Browser.close", {}, false).catch(() => browser.kill());
  await rm(profile, { recursive: true, force: true });
}
