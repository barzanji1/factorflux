// Compiled production UI, normal staff sign-in, read-only checks only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { StringDecoder } from "node:string_decoder";
const origin = process.env.SIGNIN_TEST_URL;
assert.ok(origin, "Run through scripts/verify-production-performance.ts");
const out = "generated-artifacts/payroll-verification";
await mkdir(out, { recursive: true });
const profile = await mkdtemp(`${tmpdir()}/payroll-ui-`);
const browser = spawn("/repl/tools/bin/chromium", [
  "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-pipe",
  `--user-data-dir=${profile}`, "--no-first-run",
  `--host-resolver-rules=MAP ${new URL(origin).hostname} 127.0.0.1`,
  "--no-proxy-server", `--unsafely-treat-insecure-origin-as-secure=${origin}`, "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const browserExited = new Promise(resolve => browser.once("exit", resolve));
let sequence = 0, session, buffer = "", signedIn = false;
const pending = new Map(), errors = [], decoder = new StringDecoder("utf8");
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
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 30000);
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
  while (Date.now() - start < 35000) { if (await evaluate(expression)) return; await sleep(100); }
  throw Error(`Timed out: ${expression}`);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  let point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point }); await sleep(350);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  assert.ok(await evaluate(`document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(${point.x},${point.y}))`), `Pointer blocked: ${selector}`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
async function clickText(text) {
  assert.ok(await evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!e)return false;e.setAttribute('data-payroll-test-click','true');return true})()`), `Missing button: ${text}`);
  await click('[data-payroll-test-click="true"]');
  await evaluate("document.querySelector('[data-payroll-test-click]')?.removeAttribute('data-payroll-test-click');true");
}
async function screenshot(name) {
  await writeFile(`${out}/${name}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
}
const report = { compiledProduction: true, normalAuthentication: true, browserExceptions: 0 };
try {
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: origin + "/login" });
  await until("!!document.querySelector('#ff-login-email')");
  await click("#ff-login-email"); await send("Input.insertText", { text: process.env.DEV_ADMIN_EMAIL });
  await click("#ff-login-password"); await send("Input.insertText", { text: process.env.DEV_ADMIN_PASSWORD });
  await click(".ff-login-submit");
  await until("location.pathname==='/'&&!!document.querySelector('aside')");
  signedIn = true;
  await sleep(2000);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 200 });
  await sleep(400);
  await click('aside button[aria-label="Pay Statements"]');
  await until("location.pathname==='/payroll'&&document.querySelector('main')?.textContent.includes('Contractor hourly rates')");
  await sleep(1000);
  report.api = await evaluate(`(async()=>{const base=await fetch('/api/contractor-payroll').then(r=>r.json());const admin=await fetch('/api/contractor-payroll/admin?contractorPage=1&periodPage=1').then(r=>r.json());const audit=await fetch('/api/contractor-payroll/audit?page=1').then(r=>r.json());return{isAdmin:base.isAdmin,statements:base.statements.length,rates:admin.contractors.length,rateTotal:admin.contractorTotal,periods:admin.periods.length,cadence:admin.cadence,timezone:admin.timezone,auditRows:audit.items.length}})()`);
  assert.equal(report.api.isAdmin, true); assert.ok(report.api.rates <= 15); assert.ok(report.api.periods <= 15);
  assert.equal(report.api.cadence, "biweekly");
  assert.ok(await evaluate("document.querySelector('main').textContent.includes('1099 contractor — no taxes withheld')"));
  await screenshot("admin-light");
  await clickText("Set rate");
  await until("!!document.querySelector('[role=dialog]')");
  assert.ok(await evaluate("document.querySelector('[role=dialog]').textContent.toLowerCase().includes('reason')"));
  await screenshot("rate-dialog-light");
  await clickText("Cancel");
  await click('aside [role="switch"][aria-label="Dark mode"]');
  await sleep(400);
  assert.equal(await evaluate("document.documentElement.dataset.theme"), "dark");
  await evaluate("document.querySelector('main').scrollTo(0,0);true");
  await screenshot("admin-dark");
  report.dark = await evaluate("({background:getComputedStyle(document.querySelector('main')).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth+1})");
  assert.equal(report.dark.background, "rgb(13, 13, 13)"); assert.equal(report.dark.overflow, false);
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(500);
  assert.equal(await evaluate("document.documentElement.scrollWidth>innerWidth+1"), false);
  await screenshot("mobile-dark");
  report.mobileNoOverflow = true;
  assert.equal(errors.length, 0);
  console.log(JSON.stringify({ payrollUi: "passed", compiledProduction: true, darkMode: true, mobileNoOverflow: true, browserExceptions: errors.length }));
} catch (error) {
  report.error = error.message; process.exitCode = 1; console.error(error.message);
  if (signedIn) await screenshot("verification-failure").catch(() => {});
} finally {
  await writeFile(`${out}/browser-report.json`, JSON.stringify(report, null, 2));
  if (signedIn) await evaluate("fetch('/api/auth/logout',{method:'POST',credentials:'include'}).then(()=>true)").catch(() => {});
  await send("Browser.close", {}, false).catch(() => browser.kill());
  await Promise.race([browserExited, sleep(5000)]);
  if (browser.exitCode === null) browser.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
