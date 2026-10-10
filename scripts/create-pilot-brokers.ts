/**
 * Requested pilot fixtures. Broker and carrier creation uses authenticated APIs.
 * Synthetic risk metadata is attached only to name-and-origin-verified fixtures.
 * No payouts, credit-calculation runs, emails or real-directory mutations.
 */
import assert from "node:assert/strict";
import { pool } from "../server/db";
import { LOAD_TYPES } from "../shared/load-types";

const specs = [
  { name: "TEST BROKER CLEAN LLC", mc: "52693", realName: "BRAVO LOGISTICS LLC", grade: "A", authority: "ACTIVE" },
  { name: "TEST BROKER RISKY LLC", mc: "900130", realName: "SH TRANSPORT LLC", grade: "D", authority: "ACTIVE" },
  { name: "TEST BROKER INACTIVE LLC", mc: "728030", realName: "FIRST CHOICE TRANSPORTATION INC", grade: null, authority: "INACTIVE" },
];
const carrierName = "TEST PILOT CHARGEBACK CARRIER LLC";
const email = "dosh@truckingprosfinancial.com";
const phone = "385-495-4962"; // Existing company contact number in email templates.
const chargebackRef = "PILOT-RISKY-CHARGEBACK-500";
const domain = process.env.REPLIT_DEV_DOMAIN;
if (!domain) throw new Error("Development domain is unavailable");
const base = `https://${domain}`;
let cookie = "";
async function api(path: string, body: unknown, expectedFailure?: number) {
  const response = await fetch(`${base}${path}`, {
    method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (expectedFailure) {
    assert.equal(response.status, expectedFailure, `${path} should reject this pilot request`);
    return result;
  }
  if (!response.ok) throw new Error(`${path} failed (HTTP ${response.status}): ${result.message ?? "Request failed"}`);
  if (path === "/api/auth/login") {
    cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    assert(cookie, "Login did not provide a session");
  }
  return result;
}
async function main() {
  assert(process.env.DEV_ADMIN_EMAIL && process.env.DEV_ADMIN_PASSWORD, "Configured admin login is unavailable");
  const login = await api("/api/auth/login", {
    username: process.env.DEV_ADMIN_EMAIL, password: process.env.DEV_ADMIN_PASSWORD,
  });
  assert.equal(login.user?.role, "admin", "Pilot setup requires an administrator");
  if (process.argv.includes("--check-login")) {
    console.log(JSON.stringify({ authenticated: true, role: "admin" }));
    return;
  }
  // Capture every original row, not only grade/MC, to verify no real data changed.
  const originals = [];
  for (const spec of specs) {
    const result = await pool.query("SELECT id,to_jsonb(b) AS snapshot FROM brokers b WHERE name=$1 AND mc_number=$2",
      [spec.realName, spec.mc]);
    assert.equal(result.rows.length, 1, `Expected one real directory broker: ${spec.realName}`);
    originals.push(result.rows[0]);
  }
  const created = [];
  for (const spec of specs) {
    const found = await pool.query("SELECT id,data_origin,mc_number FROM brokers WHERE name=$1", [spec.name]);
    assert(found.rows.length <= 1, `Duplicate pilot name: ${spec.name}`);
    let id: number;
    if (found.rows.length) {
      assert.equal(found.rows[0].data_origin, "pilot");
      assert.equal(found.rows[0].mc_number, spec.mc);
      id = found.rows[0].id;
    } else {
      const result = await api("/api/brokers", {
        name: spec.name, contactPerson: "Pilot Testing", email, phone,
        mcNumber: spec.mc, data_origin: "pilot", source: "pilot", status: "active",
        notes: `Synthetic pilot fixture. MC borrowed from ${spec.realName}; not affiliated. Do not merge with real directory broker.`,
      });
      id = result.id;
      assert.equal(result.dataOrigin, "pilot", "API must persist data_origin");
      console.log(JSON.stringify({ createdThroughApi: true, brokerId: id, name: spec.name }));
    }
    created.push({ ...spec, id });
  }
  const existingCarrier = await pool.query("SELECT id,source FROM clients WHERE name=$1", [carrierName]);
  assert(existingCarrier.rows.length <= 1, "Duplicate pilot carrier");
  let carrierId: number;
  if (existingCarrier.rows.length) {
    assert.equal(existingCarrier.rows[0].source, "pilot");
    carrierId = existingCarrier.rows[0].id;
  } else {
    const carrier = await api("/api/clients", {
      name: carrierName, contactPerson: "Pilot Testing", email, phone, source: "pilot", status: "active",
      onboardingProfile: { data_origin: "pilot", purpose: "Isolated synthetic chargeback fixture" },
    });
    carrierId = carrier.id;
    console.log(JSON.stringify({ createdThroughApi: true, isolatedCarrierId: carrierId }));
  }
  const tx = await pool.connect();
  let chargebackId: number;
  try {
    await tx.query("BEGIN");
    for (const broker of created) {
      const updated = await tx.query(
        "UPDATE brokers SET credit_grade=$1,updated_at=now() WHERE id=$2 AND name=$3 AND data_origin=$4 RETURNING id",
        [broker.grade, broker.id, broker.name, "pilot"]);
      assert.equal(updated.rowCount, 1);
      const authority = await tx.query(
        "SELECT id,authority_status,raw_response FROM broker_authority_checks WHERE entity_type=$1 AND entity_id=$2 ORDER BY checked_at DESC,id DESC LIMIT 1",
        ["broker", broker.id]);
      if (authority.rows[0]?.raw_response?.data_origin !== "pilot" || authority.rows[0]?.authority_status !== broker.authority) {
        await tx.query(
          `INSERT INTO broker_authority_checks
           (broker_id,entity_type,entity_id,entity_name,mc_number,authority_status,allowed_to_operate,check_status,checked_by,raw_response)
           VALUES ($1,'broker',$1,$2,$3,$4,$5,'ok',$6,$7::jsonb)`,
          [broker.id, broker.name, broker.mc, broker.authority, broker.authority === "ACTIVE", login.user.id,
            JSON.stringify({ data_origin: "pilot", synthetic: true, notLiveFmcsaVerification: true })]);
      }
    }
    const risky = created.find(b => b.grade === "D")!;
    const existing = await tx.query("SELECT id,broker_id,client_id,amount,chargeback_status FROM invoices WHERE carrier_invoice_number=$1",
      [chargebackRef]);
    assert(existing.rows.length <= 1, "Duplicate pilot chargeback");
    if (existing.rows.length) {
      const row = existing.rows[0];
      assert.equal(row.broker_id, risky.id);
      assert.equal(row.client_id, carrierId);
      assert.equal(Number(row.amount), 500);
      assert.equal(row.chargeback_status, "scheduled");
      chargebackId = row.id;
    } else {
      // A synthetic open/scheduled fixture, NOT a funding or payout. Explicit
      // NULL load_id protects against the legacy foreign-key sequence default.
      const result = await tx.query(
        `INSERT INTO invoices (invoice_number,carrier_invoice_number,load_id,client_id,broker_id,amount,currency,status,
          chargeback_status,chargeback_date,invoice_date,notes)
         VALUES ($1,$2,NULL,$3,$4,'500.00','USD','submitted','scheduled',now()+interval '90 days',now(),$5) RETURNING id`,
        ["PILOT-TEST-CHARGEBACK-500", chargebackRef, carrierId, risky.id,
          "data_origin=pilot; synthetic $500 open chargeback fixture; no actual funding or payout."]);
      chargebackId = result.rows[0].id;
      await tx.query(
        `INSERT INTO event_ledger (entity_type,entity_id,event_type,actor_id,payload_json)
         VALUES ('invoice',$1,'pilot_fixture_created',$2,$3::jsonb)`,
        [chargebackId, login.user.id, JSON.stringify({ data_origin: "pilot", synthetic: true,
          amount: 500, chargebackStatus: "scheduled", brokerId: risky.id, carrierId, noFundingOrPayout: true })]);
    }
    await tx.query("COMMIT");
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally { tx.release(); }
  for (const original of originals) {
    const result = await pool.query("SELECT to_jsonb(b) AS snapshot FROM brokers b WHERE id=$1", [original.id]);
    assert.deepEqual(result.rows[0].snapshot, original.snapshot, "Real directory broker changed");
  }
  for (const broker of created) {
    const result = await pool.query(
      `SELECT id,name,mc_number,credit_grade,data_origin,email,phone,
       (SELECT count(*)::int FROM invoices i WHERE i.broker_id=b.id AND i.chargeback_status IN ('scheduled','extended')) AS open_chargebacks,
       (SELECT count(*)::int FROM carrier_alerts a WHERE a.entity_type='broker' AND a.entity_id=b.id AND a.active=true) AS manual_alerts
       FROM brokers b WHERE b.id=$1`, [broker.id]);
    const row = result.rows[0];
    assert.equal(row.email, email);
    assert.equal(row.phone, phone);
    assert.equal(row.data_origin, "pilot");
    assert.equal(row.credit_grade, broker.grade);
    assert.equal(row.open_chargebacks, broker.grade === "D" ? 1 : 0);
    assert.equal(row.manual_alerts, 0);
    const preflight = await api("/api/invoices/preflight", {
      carrierId, brokerId: broker.id, invoiceNumber: `PILOT-PREFLIGHT-${broker.id}`, loadNumber: `PILOT-CHECK-${broker.id}`,
      amount: "251", invoiceDate: new Date().toISOString().slice(0, 10),
    });
    // AUTHORITY_INACTIVE is shared by carrier and broker checks; only the
    // broker-scoped authority notice belongs in the broker fixture assertion.
    const brokerAlerts = preflight.alerts.filter((a: { code: string; title: string }) =>
      ["BROKER_GRADE_LOW", "BROKER_CHARGEBACKS"].includes(a.code) ||
      (a.code === "AUTHORITY_INACTIVE" && a.title.startsWith("Broker ")) ||
      a.code.startsWith("BROKER_MANUAL_ALERT"));
    if (broker.grade === "A") assert.equal(brokerAlerts.length, 0);
    if (broker.grade === "D") for (const code of ["BROKER_GRADE_LOW", "BROKER_CHARGEBACKS"]) {
      assert(brokerAlerts.some((a: { code: string; severity: string }) => a.code === code && a.severity === "ack"));
    }
    if (broker.authority === "INACTIVE") {
      assert(brokerAlerts.some((a: { code: string; severity: string }) => a.code === "AUTHORITY_INACTIVE" && a.severity === "block"));
      const rejected = await api("/api/invoices", {
        clientId: carrierId, brokerId: broker.id, invoiceNumber: "PILOT-INACTIVE-EXPECTED-BLOCK",
        loadNumber: "PILOT-INACTIVE-BLOCK-CHECK", amount: "251", loadType: LOAD_TYPES[0],
      }, 409);
      assert(rejected.alerts.some((a: { code: string; severity: string }) => a.code === "AUTHORITY_INACTIVE" && a.severity === "block"));
    }
    console.log(JSON.stringify({ id: row.id, name: row.name, mc: row.mc_number, grade: row.credit_grade,
      data_origin: row.data_origin, openChargebacks: row.open_chargebacks, brokerAlerts }));
  }
  console.log(JSON.stringify({ complete: true, chargebackInvoiceId: chargebackId!, chargebackAmount: 500,
    isolatedCarrierId: carrierId, realDirectoryBrokersUnchanged: true, authorityTable: "broker_authority_checks" }));
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : "Pilot fixture setup failed");
  process.exitCode = 1;
}).finally(async () => {
  if (cookie) await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { cookie } }).catch(() => {});
  await pool.end();
});
