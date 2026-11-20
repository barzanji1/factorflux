// Production frontend assets, normal staff and broker authentication, fictional
// test-account-only data. No email is sent. All fixture records are removed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { StringDecoder } from "node:string_decoder";
import pg from "pg";
import bcrypt from "bcryptjs";

const origin = process.env.SIGNIN_TEST_URL;
assert.ok(origin, "Use the production-asset verification harness.");
const out = "generated-artifacts/broker-activity-verification";
await mkdir(out, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL });
const suffix = randomUUID().slice(0, 10), password = `Activity-${randomUUID()}`;
const managerId = `activity-ui-manager-${suffix}`, employeeId = `activity-ui-employee-${suffix}`;
const staffEmail = `${managerId}@example.test`, brokerEmail = `activity-ui-broker-${suffix}@example.test`;
let brokerId, clientId, brokerUserId, invoices = [];
const profile = await mkdtemp(`${tmpdir()}/broker-activity-`);
const browser = spawn("/repl/tools/bin/chromium", ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-pipe",
  `--user-data-dir=${profile}`, "--no-first-run", `--host-resolver-rules=MAP ${new URL(origin).hostname} 127.0.0.1`,
  "--no-proxy-server", `--unsafely-treat-insecure-origin-as-secure=${origin}`, "about:blank"],
{ stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const exited = new Promise(resolve => browser.once("exit", resolve));
const pending = new Map(), errors = [], decoder = new StringDecoder("utf8");
let sequence = 0, session, buffer = "";
browser.stdio[4].on("data", chunk => {
  buffer += decoder.write(chunk);
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!raw) continue;
    const message = JSON.parse(raw), waiter = pending.get(message.id);
    if (message.method === "Runtime.exceptionThrown") errors.push("Uncaught browser exception");
    if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); message.error ? waiter.reject(Error(message.error.message)) : waiter.resolve(message.result); }
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
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw Error("Browser evaluation failed");
  return response.result.value;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression) {
  const start = Date.now();
  while (Date.now() - start < 30000) { if (await evaluate(expression)) return; await sleep(100); }
  await screenshot("failure").catch(() => {});
  throw Error(`Timed out waiting for ${expression}`);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`); await sleep(120);
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await sleep(250);
  const settled = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...settled, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...settled, button: "left", clickCount: 1 });
}
async function clickText(text) {
  assert.ok(await evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!e)return false;e.dataset.activityTest='click';return true})()`), `Missing button ${text}`);
  await click('[data-activity-test="click"]'); await evaluate("document.querySelector('[data-activity-test]')?.removeAttribute('data-activity-test');true");
}
async function screenshot(name) {
  await writeFile(`${out}/${name}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
}
async function login(email) {
  await send("Page.navigate", { url: origin + "/login" }); await until("!!document.querySelector('#ff-login-email')");
  await click("#ff-login-email"); await send("Input.insertText", { text: email });
  await click("#ff-login-password"); await send("Input.insertText", { text: password });
  await click(".ff-login-submit"); await until("location.pathname==='/'&&!!document.querySelector('aside')");
}
const report = { compiledProduction: true, normalAuthentication: true };
try {
  const hash = await bcrypt.hash(password, 12);
  for (const [id, role, email] of [[managerId, "manager", staffEmail], [employeeId, "employee", `${employeeId}@example.test`]]) {
    await pool.query(`INSERT INTO users(id,email,password,auth_type,role,first_name,last_name,verified,is_test_account)
      VALUES($1,$2,$3,'local',$4,'Fictional','Activity Tester',true,true)`, [id, email, hash, role]);
  }
  brokerId = (await pool.query("INSERT INTO brokers(name,contact_person,email,phone) VALUES($1,'Fictional Broker',$2,'5550101111') RETURNING id", [`Fictional UI Broker ${suffix}`, brokerEmail])).rows[0].id;
  clientId = (await pool.query("INSERT INTO clients(name) VALUES($1) RETURNING id", [`Fictional UI Carrier ${suffix}`])).rows[0].id;
  brokerUserId = (await pool.query(`INSERT INTO broker_portal_users(broker_id,company_name,contact_name,email,phone,password_hash,verified_at)
    VALUES($1,'Fictional UI Broker','Fictional Broker',$2,'5550101111',$3,now()) RETURNING id`, [brokerId, brokerEmail, hash])).rows[0].id;
  for (const [label, amount] of [["CONFIRM", "1250.00"], ["DISPUTE", "900.50"], ["PENDING", "550.00"]]) {
    invoices.push((await pool.query(`INSERT INTO invoices(invoice_number,client_id,broker_id,load_id,amount,status,funded_at,submitted_at,submitted_by,confirmation_sent_at)
      VALUES($1,$2,$3,NULL,$4,'funded',now(),now(),$5,now()-interval '2 hours') RETURNING id,invoice_number,broker_confirmation_token`,
    [`ACTIVITY-UI-${suffix}-${label}`, clientId, brokerId, amount, managerId])).rows[0]);
  }
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await login(staffEmail);
  await send("Page.navigate", { url: origin + "/broker-activity" });
  await until(`document.querySelector('main')?.textContent.includes(${JSON.stringify(invoices[0].invoice_number)})`);
  assert.ok(await evaluate("!!document.querySelector('aside button[aria-label=\"Broker Activity\"]')"));
  await screenshot("activity-pending-light");
  const actionStart = Date.now();
  const confirmStatus = await evaluate(`(async()=>{
    const login=await fetch('/api/broker/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(brokerEmail)},password:${JSON.stringify(password)}})});
    if(!login.ok)return login.status;const s=await login.json();
    const r=await fetch('/api/broker/invoices/${invoices[0].id}/confirm',{method:'POST',headers:{'Content-Type':'application/json','X-Broker-CSRF':s.csrfToken},body:'{}'});return r.status})()`);
  assert.equal(confirmStatus, 200);
  const atomic = (await pool.query(`SELECT a.approved_amount,a.historical_amount,
    (SELECT count(*)::int FROM broker_activity_deliveries d WHERE d.event_id=a.event_id AND d.user_id=$2) AS delivery_count,
    (SELECT count(*)::int FROM notifications n WHERE n.user_id=$2 AND n.entity_type='broker_response' AND n.entity_id=a.invoice_id) AS alert_count
    FROM broker_activity_actions a WHERE a.invoice_id=$1`, [invoices[0].id, managerId])).rows;
  assert.equal(atomic.length, 1, "Activity must exist when the existing response handler returns, without observer polling");
  assert.equal(atomic[0].approved_amount, "1250.00"); assert.equal(atomic[0].historical_amount, false);
  assert.equal(atomic[0].delivery_count, 1); assert.equal(atomic[0].alert_count, 1);
  report.atomicSnapshotOnResponseReturn = true;
  await pool.query("UPDATE invoices SET amount=1300 WHERE id=$1", [invoices[0].id]);
  assert.equal((await pool.query("SELECT approved_amount FROM broker_activity_actions WHERE invoice_id=$1", [invoices[0].id])).rows[0].approved_amount, "1250.00");
  report.snapshotSurvivesLaterInvoiceEdit = true;
  await until("!!document.querySelector('[aria-label$=\"unread notifications\"]')");
  report.notificationMilliseconds = Date.now() - actionStart;
  await until(`(()=>{const r=[...document.querySelectorAll('tbody tr')].find(e=>e.textContent.includes(${JSON.stringify(invoices[0].invoice_number)}));return r?.textContent.includes('Confirmed')&&r.textContent.includes('Portal')})()`);
  // Exercise the existing public email dispute page and its CSRF token,
  // without changing it or sending an email.
  const emailStatus = await evaluate(`(async()=>{const path='/api/broker-dispute/${invoices[1].broker_confirmation_token}';
    const html=await fetch(path).then(r=>r.text());const doc=new DOMParser().parseFromString(html,'text/html');
    const csrf=doc.querySelector('input[name=csrf]')?.value;if(!csrf)return 0;
    return(await fetch(path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,reason:'Fictional UI dispute verification'})})).status})()`);
  assert.equal(emailStatus, 200);
  await until(`(()=>{const r=[...document.querySelectorAll('tbody tr')].find(e=>e.textContent.includes(${JSON.stringify(invoices[1].invoice_number)}));return r?.textContent.includes('Disputed')&&r.textContent.includes('Email')})()`);
  report.portalAndEmailSync = true;
  await screenshot("activity-responses-light");
  await click('[aria-label="Notifications"]');
  await until(`!![...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(invoices[0].invoice_number)})&&b.textContent.includes('confirmed'))`);
  await evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(invoices[0].invoice_number)})&&b.textContent.includes('confirmed'));e.dataset.activityTest='notification';return true})()`);
  await click('[data-activity-test="notification"]');
  await until(`location.pathname==='/invoices/${invoices[0].id}'`);
  await sleep(500);
  const read = await pool.query("SELECT read FROM notifications WHERE user_id=$1 AND entity_type='broker_response' AND entity_id=$2", [managerId, invoices[0].id]);
  assert.equal(read.rows[0].read, true); report.notificationReadAndNavigation = true;
  await send("Page.navigate", { url: origin + "/broker-activity" });
  await until(`document.querySelector('main')?.textContent.includes(${JSON.stringify(invoices[0].invoice_number)})`);
  await clickText("Response report"); await until("!!document.querySelector('thead')&&document.querySelector('thead').textContent.includes('Confirmation rate')");
  await screenshot("report-light");
  const exported = await evaluate(`fetch('/api/internal/broker-activity/report/csv?brokerId=${brokerId}').then(async r=>({status:r.status,text:await r.text()}))`);
  assert.equal(exported.status, 200); assert.ok(exported.text.includes(`Fictional UI Broker ${suffix}`)); report.csv = true;
  await click('aside [role="switch"][aria-label="Dark mode"]'); await until("document.documentElement.dataset.theme==='dark'"); await screenshot("report-dark");
  await send("Page.navigate", { url: origin + "/settings" }); await until("!![...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.includes('Notifications'))");
  await evaluate("(()=>{const t=[...document.querySelectorAll('[role=tab]')].find(t=>t.textContent.includes('Notifications'));t.dataset.activityTest='notifications-tab';return true})()");
  await click('[data-activity-test="notifications-tab"]'); await until("!!document.querySelector('[role=switch][aria-label=\"In-app notifications\"]')");
  await click('[role=switch][aria-label="In-app notifications"]'); await click('[role=switch][aria-label="Email notifications"]'); await clickText("Save preferences");
  await until("document.body.textContent.includes('Preferences saved.')");
  const preferences = (await pool.query("SELECT in_app,email FROM broker_notification_preferences WHERE user_id=$1", [managerId])).rows[0];
  assert.deepEqual(preferences, { in_app: false, email: true }); report.preferencesSaved = true;
  await screenshot("notification-settings-dark");
  await send("Page.navigate", { url: origin + "/broker-activity" }); await until("document.querySelector('main')?.textContent.includes('Broker Activity')");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await screenshot("activity-mobile-dark");
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true); report.mobileNoPageOverflow = true;
  await evaluate("fetch('/api/auth/logout',{method:'POST'}).then(()=>{localStorage.removeItem('user');localStorage.removeItem('isAuthenticated');return true})");
  await send("Network.clearBrowserCookies");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await login(`${employeeId}@example.test`);
  await send("Page.navigate", { url: origin + "/broker-activity" });
  await until("document.body.textContent.includes('Access restricted')");
  assert.equal(await evaluate("!!document.querySelector('aside button[aria-label=\"Broker Activity\"]')"), false);
  assert.equal(await evaluate("fetch('/api/internal/broker-activity').then(r=>r.status)"), 403); report.employeeDenied = true;
  assert.equal(errors.length, 0); report.browserExceptions = errors.length;
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally {
  await evaluate("fetch('/api/auth/logout',{method:'POST'}).then(()=>true)").catch(() => {});
  await send("Browser.close", {}, false).catch(() => browser.kill());
  await Promise.race([exited, sleep(5000)]); browser.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  try {
    const ids = invoices.map(i => i.id);
    if (ids.length) {
      await pool.query("DELETE FROM notifications WHERE entity_type='broker_response' AND entity_id=ANY($1::int[])", [ids]);
      await pool.query("DELETE FROM event_ledger WHERE entity_type='invoice' AND entity_id=ANY($1::int[])", [ids]);
      await pool.query("DELETE FROM invoices WHERE id=ANY($1::int[])", [ids]);
    }
    if (brokerUserId) await pool.query("DELETE FROM broker_portal_users WHERE id=$1", [brokerUserId]);
    if (clientId) await pool.query("DELETE FROM clients WHERE id=$1", [clientId]);
    if (brokerId) await pool.query("DELETE FROM brokers WHERE id=$1", [brokerId]);
    await pool.query("DELETE FROM notifications WHERE user_id=ANY($1::varchar[])", [[managerId, employeeId]]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::varchar[])", [[managerId, employeeId]]);
    console.log("Removed all fictional Broker Activity users, records and alerts; no email was sent.");
  } finally { await pool.end(); }
}
