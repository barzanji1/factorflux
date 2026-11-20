// Compiled production frontend + the running application's normal staff auth.
// Fictional test accounts only. No client email or push notification is sent.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import pg from "pg";
import bcrypt from "bcryptjs";

const origin = process.env.SIGNIN_TEST_URL; assert.ok(origin, "Use scripts/verify-production-performance.ts.");
const output = "generated-artifacts/client-funding-verification"; await mkdir(output, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL });
const suffix = randomUUID().slice(0, 9), userId = `client-ui-${suffix}`, email = `${userId}@example.test`, password = `Client-UI-${randomUUID()}`;
let carrierId, brokerId, portalId, submissionId, invoiceId;
const profile = await mkdtemp(`${tmpdir()}/client-funding-`);
const browser = spawn("/repl/tools/bin/chromium", ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-pipe",
  `--user-data-dir=${profile}`, "--no-first-run", `--host-resolver-rules=MAP ${new URL(origin).hostname} 127.0.0.1`,
  "--no-proxy-server", `--unsafely-treat-insecure-origin-as-secure=${origin}`, "about:blank"],
{ stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
let seq = 0, session, buffer = ""; const pending = new Map(), errors = [];
browser.stdio[4].on("data", chunk => {
  buffer += chunk.toString(); let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!raw) continue;
    const message = JSON.parse(raw), waiter = pending.get(message.id);
    if (message.method === "Runtime.exceptionThrown") errors.push("Uncaught browser exception");
    if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); message.error ? waiter.reject(Error(message.error.message)) : waiter.resolve(message.result); }
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
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw Error("Browser evaluation failed"); return response.result.value;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function screenshot(name) { await writeFile(`${output}/${name}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64")); }
async function until(expression) {
  const start = Date.now(); while (Date.now() - start < 30000) { if (await evaluate(expression)) return; await sleep(100); }
  await screenshot("failure"); throw Error(`Timed out: ${expression}`);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`); await sleep(150);
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  // The existing hover-expanded sidebar moves its footer controls.
  await sleep(250);
  const settled = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...settled, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...settled, button: "left", clickCount: 1 });
}
async function clickText(text) {
  await evaluate(`(()=>{document.querySelector('[data-client-ui-click]')?.removeAttribute('data-client-ui-click');const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button missing');b.dataset.clientUiClick='yes';return true})()`);
  await click("[data-client-ui-click]");
}
const report = { compiledProductionFrontend: true, normalStaffLogin: true };
try {
  const hash = await bcrypt.hash(password, 12);
  await pool.query(`INSERT INTO users(id,email,password,auth_type,role,first_name,last_name,verified,is_test_account)
    VALUES($1,$2,$3,'local','admin','Fictional','Client UI Tester',true,true)`, [userId, email, hash]);
  carrierId = (await pool.query("INSERT INTO clients(name,email) VALUES($1,$2) RETURNING id", [`Fictional UI Carrier ${suffix}`, `carrier-${suffix}@example.test`])).rows[0].id;
  brokerId = (await pool.query("INSERT INTO brokers(name,contact_person,email,phone) VALUES($1,'Fictional',$2,'5550101111') RETURNING id", [`Fictional UI Broker ${suffix}`, `broker-${suffix}@example.test`])).rows[0].id;
  portalId = (await pool.query(`INSERT INTO carrier_portal_users(email,password_hash,carrier_id,company_name,status,client_email_verified_at)
    VALUES($1,$2,$3,'Fictional UI Carrier','active',now()) RETURNING id`, [`carrier-${suffix}@example.test`, hash, carrierId])).rows[0].id;
  invoiceId = (await pool.query(`INSERT INTO invoices(invoice_number,carrier_invoice_number,load_number,load_id,client_id,broker_id,amount,status,submitted_by)
    VALUES($1,$2,$3,NULL,$4,$5,1000,'funded',$6) RETURNING id`, [`UI-INT-${suffix}`, `UI-CINV-${suffix}`, `UI-LOAD-${suffix}`, carrierId, brokerId, userId])).rows[0].id;
  submissionId = (await pool.query(`INSERT INTO carrier_submissions(portal_user_id,carrier_id,invoice_number,load_number,broker_id,broker_name,amount,funding_invoice_id)
    VALUES($1,$2,$3,$4,$5,$6,1000,$7) RETURNING id`, [portalId, carrierId, `UI-CINV-${suffix}`, `UI-LOAD-${suffix}`, brokerId, `Fictional UI Broker ${suffix}`, invoiceId])).rows[0].id;
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: origin + "/login" }); await until("!!document.querySelector('#ff-login-email')");
  await click("#ff-login-email"); await send("Input.insertText", { text: email });
  await click("#ff-login-password"); await send("Input.insertText", { text: password }); await click(".ff-login-submit");
  await until("location.pathname==='/'&&!!document.querySelector('aside')");
  await send("Page.navigate", { url: `${origin}/invoices/${invoiceId}` });
  await until("!!document.querySelector('ol[aria-label=\"Client funding progress\"]')");
  assert.equal(await evaluate("document.querySelector('ol[aria-label=\"Client funding progress\"]').children.length"), 3);
  await clickText("Mark Under Review"); await until("!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Mark Funded')");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Mark Funded').disabled"), true);
  report.unverifiedFundingDisabled = true; await screenshot("under-review-light");
  await click('textarea[placeholder="Write an update visible to the carrier…"]');
  await send("Input.insertText", { text: "Fictional client-visible UI note" }); await clickText("Send client-visible note");
  await until("document.querySelector('[aria-label=\"Client-visible note history\"]')?.textContent.includes('Fictional client-visible UI note')");
  await pool.query(`INSERT INTO payouts(invoice_id,client_id,invoice_amount,advance_rate,fee_rate,advance_amount,fee_amount,reserve_amount,net_payout,payment_status,advance_paid_at,advance_paid_by)
    VALUES($1,$2,1000,95,2,950,20,50,930,'advance_paid',now(),$3)`, [invoiceId, carrierId, userId]);
  await pool.query("UPDATE invoices SET funded_at=now() WHERE id=$1", [invoiceId]);
  await send("Page.reload", { ignoreCache: true }); await until("!![...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Mark Funded'&&!b.disabled)");
  await clickText("Mark Funded"); await until("document.body.textContent.includes('never initiates or reverses a payment')");
  assert.equal((await pool.query("SELECT funding_status,step_changed_by,step_3_funded_at FROM carrier_submissions WHERE id=$1", [submissionId])).rows[0].funding_status, "funded");
  report.verifiedFundingMarked = true; await screenshot("funded-light");
  const selects = await evaluate(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>s.textContent.includes('Received')&&s.textContent.includes('Under Review'));if(s)s.dataset.clientUiSelect='revert';return !!s})()`);
  assert.equal(selects, true);
  await evaluate("(()=>{const s=document.querySelector('[data-client-ui-select]');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'under_review');s.dispatchEvent(new Event('change',{bubbles:true}));return true})()");
  await click('input[placeholder="Required reason, at least 5 characters"]'); await send("Input.insertText", { text: "Correct progress; no financial reversal" }); await clickText("Revert Step");
  await until("document.body.textContent.includes('Correct progress; no financial reversal')");
  assert.equal((await pool.query("SELECT payment_status FROM payouts WHERE invoice_id=$1", [invoiceId])).rows[0].payment_status, "advance_paid");
  report.revertReasonAndPaymentPreserved = true;
  await click('aside [role="switch"][aria-label="Dark mode"]'); await until("document.documentElement.dataset.theme==='dark'"); await screenshot("reverted-dark");
  await send("Page.navigate", { url: origin + "/portal-submissions" }); await until(`!![...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(${JSON.stringify(`UI-CINV-${suffix}`)}))`);
  await evaluate(`(()=>{const r=[...document.querySelectorAll('tbody tr')].find(r=>r.textContent.includes(${JSON.stringify(`UI-CINV-${suffix}`)}));[...r.querySelectorAll('button')].find(b=>b.textContent.trim()==='View').dataset.clientUiView='yes';return true})()`);
  await click("[data-client-ui-view]");
  await until("!!document.querySelector('[role=dialog] ol[aria-label=\"Client funding progress\"]')");
  report.submissionDetailIntegrated = true; await screenshot("submission-detail-dark");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await screenshot("submission-detail-mobile");
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
  report.mobileNoPageOverflow = true; report.browserExceptions = errors.length; assert.equal(errors.length, 0);
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally {
  await evaluate("fetch('/api/auth/logout',{method:'POST'}).then(()=>true)").catch(() => {});
  await send("Browser.close", {}, false).catch(() => browser.kill()); browser.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  if (submissionId) { await pool.query("DELETE FROM entity_notes WHERE entity_type='submission' AND entity_id=$1", [submissionId]); await pool.query("DELETE FROM carrier_submissions WHERE id=$1", [submissionId]); }
  if (portalId) await pool.query("DELETE FROM carrier_portal_users WHERE id=$1", [portalId]);
  if (invoiceId) await pool.query("DELETE FROM event_ledger WHERE entity_type='invoice' AND entity_id=$1", [invoiceId]);
  if (invoiceId) await pool.query("DELETE FROM invoices WHERE id=$1", [invoiceId]);
  if (carrierId) await pool.query("DELETE FROM clients WHERE id=$1", [carrierId]);
  if (brokerId) await pool.query("DELETE FROM brokers WHERE id=$1", [brokerId]);
  await pool.query("DELETE FROM notifications WHERE user_id=$1", [userId]); await pool.query("DELETE FROM users WHERE id=$1", [userId]); await pool.end();
  console.log("Removed fictional UI records. No email, push or payment was sent.");
}
