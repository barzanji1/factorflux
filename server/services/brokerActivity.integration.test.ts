import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { pool } from "../db";
import {
  activityFilters, brokerActivityPage, brokerActivityStats, brokerResponseReport, brokerResponseCsv,
  brokerNotificationPrefs, updateBrokerNotificationPrefs, brokerActivityBrokers, csvCell,
} from "./brokerActivity";
import { deliverBrokerActivityEmails } from "./brokerActivityDelivery";
import { createBrokerConfirmationService } from "./brokerConfirmationService";
import { registerBrokerActivityRoutes } from "../routes/brokerActivity";

test("Broker Activity: money snapshots, filters, reports, isolated alerts, preference delivery and manager-only APIs", { timeout: 120000 }, async () => {
  const connection = await pool.connect(); await connection.query("BEGIN");
  let depth = 0;
  const query = async (config: any, values?: any[]) => {
    const text = typeof config === "string" ? config : config.text;
    if (text.toLowerCase() === "begin") return connection.query(`SAVEPOINT activity_test_${++depth}`);
    if (text.toLowerCase() === "commit") return connection.query(`RELEASE SAVEPOINT activity_test_${depth--}`);
    if (text.toLowerCase() === "rollback") {
      await connection.query(`ROLLBACK TO SAVEPOINT activity_test_${depth}`);
      return connection.query(`RELEASE SAVEPOINT activity_test_${depth--}`);
    }
    return connection.query(config, values);
  };
  const connectMock = mock.method(pool, "connect", async () => ({ query, release() {} }));
  const queryMock = mock.method(pool, "query", query);
  const suffix = randomUUID().slice(0, 10);
  const admin = `activity-admin-${suffix}`, manager = `activity-manager-${suffix}`, employee = `activity-employee-${suffix}`;
  const scope = { userId: admin, isTest: true }, now = new Date();
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  try {
    assert.equal((await query(`SELECT count(*)::int AS n FROM pg_trigger
      WHERE tgrelid='public.broker_confirmation_events'::regclass
      AND tgname='broker_activity_atomic_capture' AND tgenabled IN ('O','A')`)).rows[0].n, 1,
    "Apply 0059 before testing: capture must be a real database trigger, not an observer");
    for (const [id, role] of [[admin, "admin"], [manager, "manager"], [employee, "employee"]]) {
      await query("INSERT INTO users(id,email,role,first_name,is_test_account) VALUES($1,$2,$3,'Fictional Activity Tester',true)", [id, `${id}@example.test`, role]);
    }
    const carrier = (await query("INSERT INTO clients(name) VALUES($1) RETURNING id", [`Fictional Activity Carrier ${suffix}`])).rows[0].id;
    const broker = (await query("INSERT INTO brokers(name,contact_person,email,phone) VALUES($1,'Fictional Contact',$2,'5550101111') RETURNING id", [`Fictional Activity Broker ${suffix}`, `${suffix}@example.test`])).rows[0].id;
    const makeInvoice = async (label: string, amount = "1250.00", brokerId = broker, sent: Date | null = new Date(+now - 7200000)) =>
      (await query(`INSERT INTO invoices(invoice_number,client_id,broker_id,load_id,amount,status,funded_at,submitted_at,submitted_by,confirmation_sent_at)
       VALUES($1,$2,$3,NULL,$4,'funded',now(),now(),$5,$6) RETURNING id,broker_confirmation_token`,
      [`ACTIVITY-${suffix}-${label}`, carrier, brokerId, amount, admin, sent])).rows[0];
    assert.deepEqual(await brokerNotificationPrefs(admin), { inApp: true, email: false });
    await updateBrokerNotificationPrefs(manager, { inApp: false, email: true });
    await assert.rejects(updateBrokerNotificationPrefs(manager, { inApp: true, email: "false" }));
    const confirmed = await makeInvoice("CONFIRMED");
    const disputed = await makeInvoice("DISPUTED", "2100.50", broker, new Date(+now - 3600000));
    const pending = await makeInvoice("PENDING", "800.00");
    const notSent = await makeInvoice("NOT-SENT", "10.00", broker, null);
    const ids = [confirmed.id, disputed.id, pending.id, notSent.id];
    const service = createBrokerConfirmationService({ now: () => now });
    await service.resolve(confirmed.id, "confirmed", { kind: "broker", id: `Fictional <broker@example.test> [portal:111; broker:${broker}]` }, "");
    await service.brokerRespond(disputed.broker_confirmation_token, "disputed", "Fictional missing paperwork");
    // No observer/polling call: the existing Phase 1 transaction must already
    // have written the amount and notifications when its handler returns.
    await service.resolve(confirmed.id, "confirmed", { kind: "broker", id: `Fictional <broker@example.test> [portal:111; broker:${broker}]` }, "");
    await assert.rejects(service.brokerRespond(confirmed.broker_confirmation_token, "disputed", "Must reject"), /already been confirmed/);
    await assert.rejects(service.brokerRespond(disputed.broker_confirmation_token, "confirmed", ""), /already been disputed/);
    const actions = (await query("SELECT * FROM broker_activity_actions WHERE invoice_id=ANY($1::int[]) ORDER BY event_id", [ids])).rows;
    assert.equal(actions.length, 2);
    assert.equal(actions[0].approved_amount, "1250.00");
    assert.equal(actions[0].method, "portal");
    assert.equal(actions[0].historical_amount, false);
    assert.equal(actions[1].method, "email");
    const adminAlerts = (await query("SELECT * FROM notifications WHERE user_id=$1 AND entity_id=ANY($2::int[]) ORDER BY id", [admin, ids])).rows;
    assert.equal(adminAlerts.length, 2, "Every admin receives exactly one alert per broker event");
    assert.match(adminAlerts[0].message, /confirmed Invoice #ACTIVITY-.* for \$1,250\.00/);
    assert.equal(adminAlerts[0].action_url, `/invoices/${confirmed.id}`);
    assert.equal((await query("SELECT count(*)::int AS n FROM notifications WHERE user_id=ANY($1::varchar[]) AND entity_id=ANY($2::int[])", [[manager, employee], ids])).rows[0].n, 0);
    await query("UPDATE invoices SET amount=1300 WHERE id=$1", [confirmed.id]);
    const rows = await brokerActivityPage(scope, { brokerId: broker, timeZone: "America/Denver" });
    assert.equal(rows.total, 4);
    assert.equal(rows.pageSize, 15);
    const response = rows.items.find(row => row.invoiceId === confirmed.id);
    assert.equal(response.invoiceAmount, "1300.00");
    assert.equal(response.approvedAmount, "1250.00");
    assert.equal(response.discrepancy, true);
    assert.equal(response.responseSeconds, 7200);
    assert.equal((await brokerActivityPage({ ...scope, isTest: false }, { brokerId: broker })).total, 0);
    assert.equal((await brokerActivityPage(scope, { brokerId: broker, status: "pending" })).total, 2);
    assert.equal((await brokerActivityPage(scope, { brokerId: broker, method: "email" })).total, 1);
    assert.equal((await brokerActivityPage(scope, { brokerId: broker, method: "portal" })).total, 1);
    assert.equal((await brokerActivityPage(scope, { brokerId: broker, search: "CONFIRMED" })).total, 1);
    assert.equal((await brokerActivityPage(scope, { brokerId: broker, search: "%" })).total, 0, "Search wildcards are literal");
    const stats = await brokerActivityStats(scope, { brokerId: broker, timeZone: "America/Denver", status: "pending" });
    assert.equal(stats.pendingCount, 2);
    assert.equal(stats.confirmedTodayCount, 1);
    assert.equal(stats.confirmedTodayAmount, "1250.00");
    assert.equal(stats.disputedTodayCount, 1);
    assert.equal(stats.disputedTodayAmount, "2100.50");
    const report = await brokerResponseReport(scope, { brokerId: broker });
    assert.equal(report.items[0].totalSent, 3);
    assert.equal(report.items[0].confirmedCount, 1);
    assert.equal(report.items[0].disputedCount, 1);
    assert.equal(report.items[0].noResponseCount, 1);
    assert.equal(report.items[0].confirmationRate, 33.33);
    assert.ok(report.items[0].averageResponseSeconds >= 5400 && report.items[0].averageResponseSeconds < 5410);
    const delivered: any[] = [];
    const send = async (mail: any) => { delivered.push(mail); return true; };
    await deliverBrokerActivityEmails(send, true, manager);
    await deliverBrokerActivityEmails(send, true, manager);
    assert.equal(delivered.length, 2);
    assert.ok(delivered.every(mail => mail.idempotencyKey.startsWith("broker-activity/")));
    assert.ok(delivered.every(mail => !mail.html.includes("replit.dev") && mail.text.includes("https://factorflux.io/invoices/")));
    assert.equal((await query("SELECT count(*)::int AS n FROM broker_activity_deliveries WHERE user_id=$1 AND email_state='sent'", [manager])).rows[0].n, 2);

    // A transaction that aborts must leave no activity or notification behind.
    const aborted = await makeInvoice("ABORTED");
    await query("BEGIN");
    await service.resolve(aborted.id, "confirmed", { kind: "broker", id: "Broker <fixture@example.test>" }, "");
    assert.equal((await query("SELECT count(*)::int AS n FROM broker_activity_actions WHERE invoice_id=$1", [aborted.id])).rows[0].n, 1);
    assert.equal((await query("SELECT count(*)::int AS n FROM broker_activity_deliveries d JOIN broker_activity_actions a ON a.event_id=d.event_id WHERE a.invoice_id=$1", [aborted.id])).rows[0].n, 2);
    await query("ROLLBACK");
    assert.equal((await query("SELECT count(*)::int AS n FROM broker_activity_actions WHERE invoice_id=$1", [aborted.id])).rows[0].n, 0);
    assert.equal((await query("SELECT broker_confirmation_status AS status FROM invoices WHERE id=$1", [aborted.id])).rows[0].status, "pending");
    assert.equal((await query("SELECT count(*)::int AS n FROM broker_confirmation_events WHERE invoice_id=$1", [aborted.id])).rows[0].n, 0);
    assert.equal((await query("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND entity_id=$2", [admin, aborted.id])).rows[0].n, 0);
    // Staff-entered confirmations do not get falsely labeled Email or send broker alerts.
    const staff = await makeInvoice("STAFF");
    await service.resolve(staff.id, "confirmed", { kind: "agent", id: admin }, "");
    assert.equal((await brokerActivityPage(scope, { search: `ACTIVITY-${suffix}-STAFF` })).items[0].method, null);
    assert.equal((await query("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND entity_id=$2", [admin, staff.id])).rows[0].n, 0);
    // Verify local date boundaries, not the database server's UTC calendar.
    const old = await makeInvoice("TIMEZONE", "50.00", broker, new Date("2018-12-31T23:00:00Z"));
    await createBrokerConfirmationService({ now: () => new Date("2019-01-01T01:00:00Z") }).resolve(old.id, "confirmed", { kind: "broker", id: "Legacy <time@example.test>" }, "");
    assert.equal((await brokerActivityPage(scope, { brokerId: broker, dateFrom: "2018-12-31", dateTo: "2018-12-31", timeZone: "America/Denver" })).total, 1);
    assert.equal((await brokerActivityPage(scope, { brokerId: broker, dateFrom: "2018-12-31", dateTo: "2018-12-31", timeZone: "UTC" })).total, 0);
    await updateBrokerNotificationPrefs(manager, { inApp: false, email: false });
    await deliverBrokerActivityEmails(send, true, manager);
    assert.equal(delivered.length, 2, "An email opt-out cancels still-queued alerts");
    const moreBrokers = [];
    for (let i = 0; i < 16; i++) {
      const id = (await query("INSERT INTO brokers(name,contact_person,email,phone) VALUES($1,'Fictional Contact',$2,'5550101111') RETURNING id", [`${i === 0 ? "=Formula" : "Fictional"} CSV Broker ${suffix} ${i}`, `csv-${i}-${suffix}@example.test`])).rows[0].id;
      moreBrokers.push(id);
      await makeInvoice(`CSV-${i}`, "100.00", id);
    }
    const fullReport = await brokerResponseReport(scope, { search: suffix });
    assert.equal(fullReport.total, 17);
    assert.equal(fullReport.items.length, 15);
    let csv = ""; for await (const chunk of brokerResponseCsv(scope, { search: suffix })) csv += chunk;
    assert.equal(csv.trim().split("\r\n").length, 18, "CSV includes every matching broker, not only page 1");
    assert.match(csv, /"'=Formula/);
    assert.equal(csvCell("@SUM(1)"), "\"'@SUM(1)\"");
    assert.equal((await brokerActivityBrokers({ search: suffix, page: 1 })).total, 17);
    assert.throws(() => activityFilters.parse({ dateFrom: "2026-02-30" }));
    assert.throws(() => activityFilters.parse({ dateFrom: "2026-12-01", dateTo: "2026-01-01" }));
    assert.throws(() => activityFilters.parse({ timeZone: "Invalid/Zone" }));

    const app = express(); app.use(express.json());
    registerBrokerActivityRoutes(app, (req: any, res, next) => {
      const id = req.get("x-fixture-user"); if (!id) return void res.status(401).json({ message: "Sign in required." });
      req.user = { id }; next();
    });
    server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server!.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const get = (path: string, id = admin) => fetch(url + path, { headers: { "x-fixture-user": id } });
    for (const path of ["/api/internal/broker-activity", "/api/internal/broker-activity/stats", "/api/internal/broker-activity/report", "/api/internal/broker-activity/report/csv", "/api/internal/broker-activity/brokers", "/api/internal/notifications", "/api/internal/notifications/unread-count", "/api/internal/settings/broker-notifications"]) {
      assert.equal((await get(path)).status, 200, path);
      assert.equal((await get(path, manager)).status, 200, path);
      assert.equal((await get(path, employee)).status, 403, path);
      assert.equal((await fetch(url + path)).status, 401, path);
    }
    assert.equal((await get("/api/internal/broker-activity?dateFrom=oops")).status, 400);
    assert.equal((await fetch(`${url}/api/internal/notifications/${adminAlerts[0].id}/read`, { method: "POST", headers: { "x-fixture-user": manager } })).status, 404);
    assert.equal((await fetch(`${url}/api/internal/notifications/${adminAlerts[0].id}/read`, { method: "POST", headers: { "x-fixture-user": admin } })).status, 200);
    assert.equal((await query("SELECT read FROM notifications WHERE id=$1", [adminAlerts[0].id])).rows[0].read, true);
    const invalidOrigin = await fetch(url + "/api/internal/settings/broker-notifications", { method: "PUT", headers: { "x-fixture-user": admin, origin: "https://attacker.example.test", "Content-Type": "application/json" }, body: JSON.stringify({ inApp: false, email: true }) });
    assert.equal(invalidOrigin.status, 403);
    await query("UPDATE users SET role='employee' WHERE id=$1", [manager]);
    assert.equal((await get("/api/internal/broker-activity", manager)).status, 403, "Role revocation is enforced on the next request");
    console.log("Verified Broker Activity against real PostgreSQL; all fixtures, actions and alerts are rolled back. No email was sent.");
  } finally {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    connectMock.mock.restore(); queryMock.mock.restore();
    await connection.query("ROLLBACK"); connection.release(); await pool.end();
  }
});
