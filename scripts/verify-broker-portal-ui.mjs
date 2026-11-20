// Compiled assets + normal broker sign-in. Only isolated fictional fixtures are
// written; no external emails. S3 test objects and DB fixtures are removed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import pg from "pg";
import bcrypt from "bcryptjs";
import PDFDocument from "pdfkit";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

const origin = process.env.SIGNIN_TEST_URL;
assert.ok(origin, "Use the production-asset verification harness.");
const out = "generated-artifacts/broker-portal-verification";
await mkdir(out, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL || process.env.NEON_DATABASE_URL });
const suffix = randomUUID().slice(0, 10), email = `portal-browser-${suffix}@example.test`, password = `Fictional-${randomUUID()}`;
let brokerId, otherId, carrierId, accountId, invoices = [];
const profile = await mkdtemp(`${tmpdir()}/broker-portal-`);
const browser = spawn("/repl/tools/bin/chromium", ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-pipe",
  `--user-data-dir=${profile}`, "--no-first-run", `--host-resolver-rules=MAP ${new URL(origin).hostname} 127.0.0.1`,
  "--no-proxy-server", `--unsafely-treat-insecure-origin-as-secure=${origin}`, "about:blank"],
{ stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const exited = new Promise(resolve => browser.once("exit", resolve));
let sequence = 0, session, buffer = "";
const pending = new Map(), errors = [], apiPaths = [], decoder = new StringDecoder("utf8");
browser.stdio[4].on("data", chunk => {
  buffer += decoder.write(chunk);
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw), waiter = pending.get(message.id);
    if (message.method === "Runtime.exceptionThrown") errors.push("Uncaught browser exception");
    if (message.method === "Network.requestWillBeSent") {
      const path = new URL(message.params.request.url).pathname;
      if (path.startsWith("/api/")) apiPaths.push(path);
    }
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
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw Error("Browser evaluation failed");
  return r.result.value;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(expression) {
  const start = Date.now();
  while (Date.now() - start < 25000) { if (await evaluate(expression)) return; await sleep(100); }
  throw Error(`Timed out waiting for ${expression}`);
}
async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  await sleep(150);
  const point = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
async function clickText(text) {
  assert.ok(await evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!e)return false;e.dataset.brokerTest='click';return true})()`), `Missing button: ${text}`);
  await click('[data-broker-test="click"]'); await evaluate("document.querySelector('[data-broker-test]')?.removeAttribute('data-broker-test');true");
}
async function shot(name) {
  await writeFile(`${out}/${name}.png`, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
}
const report = { compiledProduction: true, normalPasswordLogin: false, realS3Upload: false, crossBrokerDenied: false, staffApisDenied: false };
try {
  brokerId = (await pool.query("INSERT INTO brokers(name,contact_person,email,phone) VALUES($1,'Example Broker',$2,'5550105555') RETURNING id", [`Fictional Browser Broker ${suffix}`, email])).rows[0].id;
  otherId = (await pool.query("INSERT INTO brokers(name,contact_person,email,phone) VALUES($1,'Other Broker',$2,'5550105555') RETURNING id", [`Fictional Other Broker ${suffix}`, `other-${email}`])).rows[0].id;
  carrierId = (await pool.query("INSERT INTO clients(name) VALUES($1) RETURNING id", [`Fictional Browser Carrier ${suffix}`])).rows[0].id;
  accountId = (await pool.query(`INSERT INTO broker_portal_users(broker_id,company_name,contact_name,email,phone,password_hash,verified_at)
    VALUES($1,'Fictional Browser Broker','Example Broker',$2,'5550105555',$3,now()) RETURNING id`, [brokerId, email, await bcrypt.hash(password, 12)])).rows[0].id;
  for (const [label, owner] of [["A", brokerId], ["B", brokerId], ["OTHER", otherId]]) {
    invoices.push((await pool.query(`INSERT INTO invoices(invoice_number,client_id,broker_id,load_id,amount,status,funded_at,submitted_at,pickup_location,delivery_location)
      VALUES($1,$2,$3,NULL,1250.00,'funded',now(),now(),'Dallas, TX','Denver, CO') RETURNING id,invoice_number`, [`BROWSER-${suffix}-${label}`, carrierId, owner])).rows[0]);
  }
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: origin + "/broker/register" });
  await until("!!document.querySelector('input[name=companyName]')");
  await shot("registration-light");
  assert.equal(await evaluate("document.body.textContent.includes('FactorFlux')"), false);
  await send("Page.navigate", { url: origin + "/broker/login" });
  await until("!!document.querySelector('input[name=email]')");
  await shot("login-light");
  await click("input[name=email]"); await send("Input.insertText", { text: email });
  await click("input[name=password]"); await send("Input.insertText", { text: password });
  await click("button[type=submit]");
  await until("location.pathname==='/broker/dashboard'&&!!document.querySelector('tbody tr')");
  report.normalPasswordLogin = true;
  assert.equal(await evaluate("document.querySelectorAll('tbody tr').length"), 2);
  assert.equal(await evaluate("!!document.querySelector('aside')"), false);
  await shot("dashboard-light");
  const denial = await evaluate(`(async()=>{const a=await fetch('/api/broker/invoices/${invoices[2].id}');const b=await fetch('/api/invoices');const c=await fetch('/api/broker-portal-staff/invoices/${invoices[0].id}/notes');return[a.status,b.status,c.status]})()`);
  assert.deepEqual(denial, [404, 401, 401]);
  report.crossBrokerDenied = true; report.staffApisDenied = true;
  assert.ok(!apiPaths.some(p => p === "/api/auth/verify" || p === "/api/auth/permissions"), "Broker entry must not mount staff authentication");
  await click(`tr[aria-label="Open invoice ${invoices[0].invoice_number}"]`);
  await until(`location.pathname==='/broker/invoices/${invoices[0].id}'&&document.body.textContent.includes('Dallas, TX')`);
  await shot("invoice-pending-light");
  await click("#bp-message"); await send("Input.insertText", { text: "Fictional browser verification note." }); await clickText("Send message");
  await until("document.body.textContent.includes('Fictional browser verification note.')&&document.querySelector('#bp-message').value===''");
  report.notePosted = true;
  const pdf = new PDFDocument({ size: "LETTER" }), chunks = [];
  pdf.on("data", chunk => chunks.push(chunk));
  const complete = new Promise(resolve => pdf.once("end", resolve));
  pdf.text("Fictional Broker Portal Browser Test — no real invoice").end(); await complete;
  const pdfPath = resolve(`${out}/fictional-upload.pdf`); await writeFile(pdfPath, Buffer.concat(chunks));
  const document = await send("DOM.getDocument");
  const input = await send("DOM.querySelector", { nodeId: document.root.nodeId, selector: 'input[type="file"]' });
  await send("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [pdfPath] });
  await clickText("Upload document");
  await until("!!document.querySelector('a[aria-label=\"Download fictional-upload.pdf\"]')");
  report.realS3Upload = true;
  await shot("invoice-uploaded-light");
  const stored = (await pool.query("SELECT id,uploaded_by_broker_portal_user_id AS author FROM documents WHERE invoice_id=$1", [invoices[0].id])).rows;
  assert.equal(stored[0].author, accountId);
  const download = await evaluate(`(async()=>{const d=await fetch('/api/broker/invoices/${invoices[0].id}/documents').then(r=>r.json());const r=await fetch(d.documents[0].downloadUrl,{redirect:'manual'});return r.type==='opaqueredirect'||r.status===302})()`);
  assert.equal(download, true);
  const sessionCookie = (await send("Network.getCookies", { urls: [origin + "/api/broker/me"] })).cookies.find(c => c.name === "tpf_broker_session");
  assert.equal(sessionCookie.httpOnly, true); assert.equal(sessionCookie.path, "/api/broker");
  const redirect = await fetch(`http://127.0.0.1:5000/api/broker/invoices/${invoices[0].id}/documents/${stored[0].id}/download`,
    { headers: { cookie: `tpf_broker_session=${sessionCookie.value}` }, redirect: "manual" });
  assert.equal(redirect.status, 302);
  const downloaded = await fetch(redirect.headers.get("location"));
  assert.equal(downloaded.status, 200);
  assert.equal(Buffer.from(await downloaded.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
  report.downloadAuthorized = true;
  await clickText("Confirm invoice");
  await until("document.body.textContent.includes('A response has already been recorded')");
  report.confirmed = (await pool.query("SELECT broker_confirmation_status FROM invoices WHERE id=$1", [invoices[0].id])).rows[0].broker_confirmation_status === "confirmed";
  assert.equal(report.confirmed, true);
  await clickText("Invoices");
  await until("location.pathname==='/broker/dashboard'&&!!document.querySelector('tbody tr')");
  await clickText("Confirmed");
  await until(`document.querySelectorAll('tbody tr').length===1&&document.querySelector('tbody').textContent.includes(${JSON.stringify(invoices[0].invoice_number)})`);
  await clickText("Pending");
  await until(`document.querySelectorAll('tbody tr').length===1&&document.querySelector('tbody').textContent.includes(${JSON.stringify(invoices[1].invoice_number)})`);
  await click(`tr[aria-label="Open invoice ${invoices[1].invoice_number}"]`);
  await until(`location.pathname==='/broker/invoices/${invoices[1].id}'&&!![...document.querySelectorAll('button')].find(b=>b.textContent==='Dispute')`);
  await clickText("Dispute");
  await click("aside textarea"); await send("Input.insertText", { text: "Fictional browser test: paperwork needs review." });
  await clickText("Submit dispute");
  await until("document.body.textContent.includes('A response has already been recorded')");
  const disputed = (await pool.query("SELECT broker_confirmation_status FROM invoices WHERE id=$1", [invoices[1].id])).rows[0];
  assert.equal(disputed.broker_confirmation_status, "disputed"); report.disputed = true; report.filterTabs = true;
  await shot("invoice-disputed-light");
  await evaluate("document.documentElement.dataset.theme='dark';localStorage.setItem('theme','dark');true");
  await shot("invoice-dark");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await shot("invoice-mobile-dark");
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"), true);
  report.mobileNoOverflow = true;
  await clickText("Sign out");
  await until("location.pathname==='/broker/login'");
  report.logout = true;
  assert.equal(errors.length, 0);
  report.browserExceptions = errors.length;
  report.apiRequests = [...new Set(apiPaths)].map(p => p.replace(/\/\d+/g, "/:id"));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await send("Browser.close", {}, false).catch(() => browser.kill());
  await Promise.race([exited, sleep(5000)]); browser.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  const ids = invoices.map(i => i.id);
  try {
    const docs = ids.length ? (await pool.query("SELECT s3_key FROM documents WHERE invoice_id=ANY($1::int[])", [ids])).rows : [];
    const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-2" });
    for (const doc of docs) if (doc.s3_key) await s3.send(new DeleteObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: doc.s3_key }));
    if (ids.length) {
      await pool.query("DELETE FROM event_ledger WHERE entity_type='invoice' AND entity_id=ANY($1::int[])", [ids]);
      await pool.query("DELETE FROM invoices WHERE id=ANY($1::int[])", [ids]);
    }
    if (accountId) await pool.query("DELETE FROM broker_portal_users WHERE id=$1", [accountId]);
    if (carrierId) await pool.query("DELETE FROM clients WHERE id=$1", [carrierId]);
    if (brokerId || otherId) await pool.query("DELETE FROM brokers WHERE id=ANY($1::int[])", [[brokerId, otherId].filter(Boolean)]);
    console.log("Fictional browser fixtures and S3 objects removed.");
  } finally { await pool.end(); }
}
