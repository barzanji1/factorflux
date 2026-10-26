import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { db, pool } from "../db";
import { users, clients, brokers, invoices, tasks, followUps, documents, docExtractionJobs,
  eventLedger, emailLog, carrierAuthorityChecks, brokerAuthorityChecks, notifications, carrierPortalUsers, complianceIntegrationRuns, carrierAlerts } from "../../shared/schema";
import { invoiceWork, readAgentDashboard, unacknowledgedCodes, fmcsaAuthorityHealth } from "./agentDashboard";
import { registerAgentDashboardRoutes } from "../routes/agentDashboard";
import type { InvoicePreflightAlert } from "./invoicePreflight";
import { eq, sql } from "drizzle-orm";
import { dashboardReaders } from "./agentDashboard";
import { readDashboardQueue, readDashboardFollowUps } from "./agentDashboardQueries";
import { dashboardPreflights } from "./dashboardPreflight";
import { runInvoicePreflight } from "./invoicePreflight";

after(() => pool.end());
const at = new Date("2099-01-01T12:00:00Z");
const ago = (days: number) => new Date(at.getTime() - days * 86400000);
const base = { status: "funded", fundedAt: ago(31), createdAt: ago(100), brokerConfirmationStatus: "confirmed" };

test("FMCSA health has healthy, warning, failed and never-run states", () => {
  assert.deepEqual(fmcsaAuthorityHealth(), {
    state: "not_run", active: null, failed: 0, lastChecked: null, href: "/fmcsa-authority",
  });
  const run = { status: "completed", activeCount: 2800, failureCount: 0, startedAt: at, completedAt: at };
  assert.equal(fmcsaAuthorityHealth(run).state, "healthy");
  assert.equal(fmcsaAuthorityHealth({ ...run, failureCount: 111 }).state, "warning");
  assert.equal(fmcsaAuthorityHealth({ ...run, status: "failed" }).state, "failed");
  assert.equal(fmcsaAuthorityHealth({ ...run, activeCount: null }).active, null);
});

test("queue covers pending docs, role-specific review, OCR and unacknowledged preflight", () => {
  assert.deepEqual(invoiceWork({ ...base, status: "docs_pending" }, true, ["RATE_MISMATCH"], at, false).actions,
    ["Complete missing documents", "Retry failed document extraction", "Review preflight alert: RATE_MISMATCH"]);
  assert.equal(invoiceWork({ ...base, status: "under_review" }, false, [], at, false).actions[0], "Await manager review");
  assert.equal(invoiceWork({ ...base, status: "under_review" }, false, [], at, true).actions[0], "Review invoice");
});
test("aging uses funding, accurate 30/60/90 buckets, and no closed or collected receivables", () => {
  for (const [days, expected] of [[29, null], [30, "30+"], [59, "30+"], [60, "60+"], [89, "60+"], [90, "90+"]] as const) {
    const work = invoiceWork({ ...base, fundedAt: ago(days) }, false, [], at, false);
    assert.equal(work.ageDays, days); assert.equal(work.ageBasis, "funded");
    assert.equal(expected ? work.actions.some(a => a.startsWith(expected)) : work.actions.length === 0, true);
  }
  for (const status of ["paid", "settled"]) assert.equal(invoiceWork({ ...base, status }, true, ["ACK"], at, true).actions.length, 0);
  assert.equal(invoiceWork({ ...base, outstanding: 0, brokerConfirmationStatus: "pending" }, false, [], at, true).actions.length, 0);
  assert.equal(invoiceWork({ ...base, fundedAt: null }, false, [], at, true).actions.length, 0);
});
test("unconfirmed funded invoices surface without resetting the funded clock", () => {
  for (const state of ["pending", "sent"]) {
    const work = invoiceWork({ ...base, fundedAt: ago(2), brokerConfirmationStatus: state }, false, [], at, false);
    assert.deepEqual(work.actions, ["Follow up on broker receipt confirmation"]); assert.equal(work.ageDays, 2);
  }
  assert.equal(invoiceWork({ ...base, fundedAt: ago(2) }, false, [], at, false).actions.length, 0);
  assert(invoiceWork({ ...base, fundedAt: ago(2), brokerConfirmationStatus: "disputed" }, false, [], at, false).actions.includes("Escalate broker receipt dispute"));
  assert(invoiceWork({ ...base, fundedAt: ago(2), brokerConfirmationStatus: "disputed" }, false, [], at, true).actions.includes("Review broker receipt dispute"));
  assert(invoiceWork({ ...base, status: "held", fundedAt: ago(90) }, false, [], at, true).actions.some(a => a.startsWith("90+")));
});
test("acknowledgements clear only matching alerts, not a changed message or unread notification", () => {
  const alert: InvoicePreflightAlert = { code: "BOL_MISMATCH", severity: "ack", title: "Mismatch", message: "Original origin mismatch" };
  const snapshot = { alerts: [alert], acknowledgements: [{ code: alert.code }] };
  assert.deepEqual(unacknowledgedCodes(snapshot, [alert], new Set()), []);
  assert.deepEqual(unacknowledgedCodes({ alerts: [alert] }, [alert], new Set([alert.code])), []);
  assert.deepEqual(unacknowledgedCodes(snapshot, [{ ...alert, message: "New destination mismatch" }], new Set([alert.code])), [alert.code]);
  assert.deepEqual(unacknowledgedCodes(null, [alert], new Set([alert.code])), [alert.code]);
  assert.deepEqual(unacknowledgedCodes(null, [{ ...alert, severity: "info" }], new Set()), []);
});

test("HTTP identity is server-owned; authenticated reads only, no scope overrides or writes", async () => {
  const app = express();
  let calls = 0;
  registerAgentDashboardRoutes(app, (req: any, res, next) => {
    if (!req.get("x-fixture-role")) return void res.status(401).json({ message: "Authentication required" });
    req.user = { id: "fixture-actor", role: req.get("x-fixture-role") }; next();
  }, async viewer => {
    calls++; return { generatedAt: at.toISOString(), viewer, queueGroups: [], followUps: [], activity: [],
      alerts: [], alertCounts: { email_bounced: 0, ocr_failed: 0, unverified_carrier: 0 },
      systemHealth: { fmcsaAuthority: fmcsaAuthorityHealth() } };
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/agent-dashboard`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { "x-fixture-role": "carrier" } })).status, 403);
    for (const role of ["employee", "manager", "admin"]) {
      const response = await fetch(url, { headers: { "x-fixture-role": role } });
      assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.deepEqual((await response.json()).viewer, { id: "fixture-actor", role });
    }
    assert.equal((await fetch(`${url}?agentId=someone-else&role=admin`, { headers: { "x-fixture-role": "employee" } })).status, 400);
    assert.equal((await fetch(url, { method: "POST", headers: { "x-fixture-role": "manager" } })).status, 404);
    assert.equal(calls, 3);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("section HTTP reads are independent, authenticated, scoped and fail visibly with timing", async () => {
  const app = express();
  const seen: string[] = [];
  registerAgentDashboardRoutes(app, (req: any, res, next) => {
    if (!req.get("x-fixture-role")) return void res.status(401).json({ message: "Login required" });
    req.user = { id: "fixture-actor", role: req.get("x-fixture-role") }; next();
  }, undefined, {
    ...dashboardReaders,
    queue: async () => { throw Error("PRIVATE_DATABASE_ERROR"); },
    followups: async viewer => { seen.push(viewer.id); return { viewer, generatedAt: at.toISOString(), followUps: [], totalCount: 0, limit: 20 }; },
    activity: async viewer => ({ viewer, generatedAt: at.toISOString(), activity: [] }),
    alerts: async viewer => ({ viewer, generatedAt: at.toISOString(), alerts: [],
      alertCounts: { email_bounced: 0, ocr_failed: 0, unverified_carrier: 0 }, systemHealth: { fmcsaAuthority: fmcsaAuthorityHealth() } }),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/agent-dashboard`;
  try {
    for (const section of ["queue", "followups", "activity", "alerts"]) {
      assert.equal((await fetch(`${root}/${section}`)).status, 401);
      assert.equal((await fetch(`${root}/${section}`, { headers: { "x-fixture-role": "carrier" } })).status, 403);
      assert.equal((await fetch(`${root}/${section}?agentId=someone-else`, { headers: { "x-fixture-role": "employee" } })).status, 400);
    }
    const [failed, working] = await Promise.all([
      fetch(`${root}/queue`, { headers: { "x-fixture-role": "employee" } }),
      fetch(`${root}/followups`, { headers: { "x-fixture-role": "employee" } }),
    ]);
    assert.equal(failed.status, 500);
    assert.match(failed.headers.get("server-timing")!, /dashboard;dur=/);
    assert.doesNotMatch(await failed.text(), /PRIVATE_DATABASE_ERROR/);
    assert.equal(working.status, 200);
    assert.deepEqual(seen, ["fixture-actor"]);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("real database queues, follow-ups, audit feed and global alerts (isolated rollback fixtures)", async t => {
  const rollback = new Error("ROLLBACK_DASHBOARD_FIXTURES");
  const tag = randomUUID();
  try {
    await db.transaction(async tx => {
      const store = tx as unknown as typeof db;
      const agent = `dashboard-agent-${tag}`, other = `dashboard-other-${tag}`, manager = `dashboard-manager-${tag}`;
      await tx.insert(users).values([
        { id: agent, role: "employee", firstName: "Fixture", lastName: "One", status: "active" },
        { id: other, role: "employee", firstName: "Fixture", lastName: "Two", status: "active" },
        { id: manager, role: "manager", firstName: "Fixture", lastName: "Manager", status: "active" },
      ]);
      const clientId = -Math.floor(Math.random() * 1000000000) - 100;
      await tx.insert(clients).values({ id: clientId, name: `Fixture carrier ${tag}`, status: "active", assignedProcessor: agent, reviewed: at });
      await tx.insert(clients).values({ id: clientId - 1, name: `Fixture unverified ${tag}`, status: "new_client", assignedProcessor: agent });
      const [broker] = await tx.insert(brokers).values({ name: `Fixture broker ${tag}`, creditGrade: "A",
        contactPerson: "Fixture", email: "fixture@example.test", phone: "000-000-0000", dataOrigin: "pilot" }).returning();
      const addInvoice = async (label: string, assignedTo: string | null, status: "docs_pending" | "under_review" | "funded" | "paid", age = 35) => {
        const [row] = await tx.insert(invoices).values({ invoiceNumber: `DASH-${label}-${tag}`, clientId, brokerId: broker.id,
          loadId: null, amount: "100.00", assignedTo, submittedBy: other, status, createdAt: ago(100),
          fundedAt: status === "funded" ? ago(age) : null, brokerConfirmationStatus: status === "funded" ? "pending" : "confirmed" }).returning();
        return row;
      };
      const mine = await addInvoice("mine", agent, "docs_pending");
      const theirs = await addInvoice("theirs", other, "under_review");
      const legacy = await addInvoice("legacy", null, "funded", 65);
      const paid = await addInvoice("paid", agent, "paid");
      const addDoc = async (invoiceId: number, label: string) => {
        const [document] = await tx.insert(documents).values({ filename: `${tag}-${label}.pdf`, originalName: `Fixture ${label}.pdf`,
          mimeType: "application/pdf", size: 10, documentType: "invoice", invoiceId, clientId, uploadedBy: agent, status: "failed" }).returning();
        await tx.insert(docExtractionJobs).values({ documentId: document.id, jobType: "ocr", status: "failed", errorMessage: "Fixture OCR failure" });
        return document;
      };
      const failed = await addDoc(mine.id, "failed");
      const recovered = await addDoc(theirs.id, "recovered");
      await tx.insert(docExtractionJobs).values({ documentId: recovered.id, jobType: "ocr", status: "completed" });
      await tx.insert(tasks).values([
        { title: `Due first ${tag}`, type: "followup", assignedTo: agent, clientId, dueDate: ago(2), status: "todo" },
        { title: `Due second ${tag}`, type: "call", assignedTo: agent, clientId, dueDate: ago(1), status: "in_progress" },
        { title: `Closed ${tag}`, type: "followup", assignedTo: agent, clientId, dueDate: ago(3), status: "completed" },
        { title: `Other agent ${tag}`, type: "followup", assignedTo: other, clientId, dueDate: ago(4), status: "todo" },
      ]);
      await tx.insert(followUps).values({ id: clientId, clientId, title: `Legacy follow-up ${tag}`, dueDate: at, status: "pending" });
      const alert: InvoicePreflightAlert = { code: "FIXTURE_UNACKNOWLEDGED", severity: "ack", title: "Fixture preflight", message: "Fixture mismatch" };
      await tx.insert(eventLedger).values({ entityType: "invoice", entityId: mine.id, eventType: "invoice_preflight",
        actorType: "user", actorId: agent, payloadJson: { alerts: [alert], acknowledgements: [] }, createdAt: at });
      await tx.insert(notifications).values({ userId: agent, entityType: "invoice", entityId: mine.id, title: "Read but not acknowledged",
        message: "Fixture", read: true, metadata: JSON.stringify({ severity: "ack", code: "FIXTURE_NOTIFICATION", message: "Needs acknowledgement" }) });
      await tx.insert(carrierAuthorityChecks).values([
        { carrierId: clientId, checkStatus: "error", checkError: "Old fixture failure", checkedAt: ago(2) },
        { carrierId: clientId, checkStatus: "ok", authorityStatus: "ACTIVE", checkedAt: ago(1) },
      ]);
      const [badCheck] = await tx.insert(brokerAuthorityChecks).values({ entityType: "broker", entityId: broker.id,
        brokerId: broker.id, entityName: broker.name, checkStatus: "error", checkError: "Fixture lookup failed", checkedAt: at }).returning();
      const [run] = await tx.insert(complianceIntegrationRuns).values({
        status: "failed", triggeredBy: agent, runType: "manual", startedAt: at, completedAt: at,
        successCount: 12, activeCount: 10, failureCount: 20, noKeyCount: 8, reason: "Fixture circuit breaker",
      }).returning();
      const [bounce] = await tx.insert(emailLog).values({ fromAddress: "fixture@example.test", toAddresses: ["recipient@example.test"],
        subject: "Fixture bounced message", bodyPreview: "Fixture preview", status: "bounced", statusUpdatedAt: at }).returning();
      const [pendingSignup] = await tx.insert(carrierPortalUsers).values({ email: `${tag}@example.test`,
        companyName: `Fixture pending registration ${tag}`, status: "pending", carrierId: null,
        passwordHash: "fixture-not-authenticatable" }).returning();
      for (let i = 0; i < 25; i++) await tx.insert(eventLedger).values({ entityType: "invoice", entityId: mine.id,
        eventType: `fixture_event_${i}`, actorType: "user", actorId: i % 2 ? other : agent,
        payloadJson: { confidential: "NEVER_RETURN_FIXTURE_PAYLOAD" }, createdAt: new Date(at.getTime() + i * 1000) });
      const employee = await readAgentDashboard({ id: agent, role: "employee" }, store, at);
      const managerView = await readAgentDashboard({ id: manager, role: "manager" }, store, at);
      await t.test("employee gets own and carrier-assigned legacy invoices, never another explicit owner", () => {
        assert.deepEqual(employee.queueGroups.map(g => g.agentId), [agent]);
        const rows = employee.queueGroups[0].items;
        assert(rows.some(i => i.id === mine.id)); assert(rows.some(i => i.id === legacy.id));
        assert(!rows.some(i => i.id === theirs.id || i.id === paid.id));
        const legacyItem = rows.find(i => i.id === legacy.id)!;
        assert.equal(legacyItem.ageDays, 65); assert(legacyItem.actions.some(a => a.startsWith("60+")));
        assert(rows.find(i => i.id === mine.id)!.actions.includes("Retry failed document extraction"));
        assert.equal(rows.find(i => i.id === mine.id)!.href, `/invoices/${mine.id}`);
      });
      await t.test("manager sees all active agents, not just users created by that manager", () => {
        assert(managerView.queueGroups.find(g => g.agentId === agent)?.items.some(i => i.id === mine.id));
        assert(managerView.queueGroups.find(g => g.agentId === other)?.items.some(i => i.id === theirs.id));
      });
      await t.test("follow-ups are open, assigned and due-ordered across old and current sources", () => {
        assert.deepEqual(employee.followUps.map(f => f.title), [`Due first ${tag}`, `Due second ${tag}`, `Legacy follow-up ${tag}`]);
      });
      await t.test("audit feed is last 20 across staff without raw payloads", () => {
        assert.equal(employee.activity.length, 20);
        assert(employee.activity.some(e => e.who === "Fixture One")); assert(employee.activity.some(e => e.who === "Fixture Two"));
        assert.equal(employee.activity[0].action.startsWith("fixture event 24"), true);
        assert(!JSON.stringify(employee).includes("NEVER_RETURN_FIXTURE_PAYLOAD"));
      });
      await t.test("global alerts contain real current failures; successful retries clear stale failures", () => {
        assert(!employee.alerts.some(a => a.id === `broker_check:${badCheck.id}` || a.id.startsWith("fmcsa_run:")));
        assert.deepEqual(employee.systemHealth.fmcsaAuthority, {
          state: "failed", active: 10, failed: 20, lastChecked: at.toISOString(), href: "/fmcsa-authority",
        });
        assert(employee.alerts.some(a => a.id === `document:${failed.id}`));
        assert(!employee.alerts.some(a => a.id === `document:${recovered.id}`));
        assert(!employee.alerts.some(a => a.detail === "Old fixture failure"));
        assert(employee.alerts.some(a => a.id === `email:${bounce.id}`));
        assert(employee.alerts.some(a => a.id === `carrier:${clientId - 1}`));
        assert(employee.alerts.some(a => a.id === `carrier_portal:${pendingSignup.id}`));
        assert.equal(employee.alertCounts.ocr_failed, managerView.alertCounts.ocr_failed);
      });
      await t.test("unacknowledged preflight appears even when its notification was marked read", () => {
        const actions = employee.queueGroups[0].items.find(i => i.id === mine.id)!.actions;
        assert(actions.includes("Review preflight alert: FIXTURE_UNACKNOWLEDGED"));
        assert(actions.includes("Review preflight alert: FIXTURE_NOTIFICATION"));
      });
      await t.test("latest clean run shows healthy without resurfacing older failures", async () => {
        await tx.insert(complianceIntegrationRuns).values({
          status: "completed", triggeredBy: agent, runType: "manual",
          startedAt: new Date(at.getTime() + 1000), completedAt: new Date(at.getTime() + 2000),
          successCount: 32, activeCount: 30, failureCount: 0,
        });
        const dashboard = await readAgentDashboard({ id: agent, role: "employee" }, store, at);
        assert.deepEqual(dashboard.systemHealth.fmcsaAuthority, {
          state: "healthy", active: 30, failed: 0,
          lastChecked: new Date(at.getTime() + 2000).toISOString(), href: "/fmcsa-authority",
        });
      });
      await t.test("latest running run also does not resurrect an old failure", async () => {
        await tx.insert(complianceIntegrationRuns).values({
          status: "running", triggeredBy: agent, runType: "manual",
          startedAt: new Date(at.getTime() + 3000), successCount: 0, failureCount: 0,
        });
        const dashboard = await readAgentDashboard({ id: agent, role: "employee" }, store, at);
        assert.equal(dashboard.systemHealth.fmcsaAuthority.state, "healthy");
        assert.equal(dashboard.systemHealth.fmcsaAuthority.active, 30);
      });
      await t.test("latest completed run with check failures shows warning, not failed", async () => {
        await tx.insert(complianceIntegrationRuns).values({
          status: "completed", triggeredBy: agent, runType: "manual",
          startedAt: new Date(at.getTime() + 4000), completedAt: new Date(at.getTime() + 5000),
          successCount: 2802, activeCount: 2800, failureCount: 111,
        });
        const dashboard = await readAgentDashboard({ id: agent, role: "employee" }, store, at);
        assert.equal(dashboard.systemHealth.fmcsaAuthority.state, "warning");
        assert.equal(dashboard.systemHealth.fmcsaAuthority.active, 2800);
        assert.equal(dashboard.systemHealth.fmcsaAuthority.failed, 111);
      });
      await t.test("one failed section does not discard successful sections in the aggregate response", async () => {
        const broken = new Proxy(store, { get(target, property) {
          if (property !== "select") return Reflect.get(target, property);
          return (...args: Parameters<typeof db.select>) => {
            const builder = target.select(...args);
            return new Proxy(builder, { get(query, key) {
              if (key !== "from") return Reflect.get(query, key);
              return (table: Parameters<typeof builder.from>[0]) => {
                if (table === eventLedger) throw Error("Injected activity failure");
                return query.from(table);
              };
            } });
          };
        } });
        const result = await readAgentDashboard({ id: agent, role: "employee" }, broken, at);
        assert(result.sectionErrors.activity);
        assert(!result.sectionErrors.queue && !result.sectionErrors.alerts && !result.sectionErrors.followups);
        assert(result.queueGroups[0].items.length > 0);
        assert(result.followUps.length > 0);
        assert.equal(result.activity.length, 0);
      });
      await t.test("bulk lookups preserve live ack/block preflight checks rather than dropping them for speed", async () => {
        await tx.update(brokers).set({ creditGrade: "D" }).where(eq(brokers.id, broker.id));
        await tx.insert(carrierAlerts).values([
          { entityType: "carrier", entityId: clientId, severity: "ack", title: "Carrier fixture", message: "Verify carrier", active: true },
          { entityType: "broker", entityId: broker.id, severity: "block", title: "Broker fixture", message: "Stop broker", active: true },
        ]);
        await tx.insert(carrierAuthorityChecks).values({ carrierId: clientId, checkStatus: "ok", authorityStatus: "INACTIVE", checkedAt: at });
        const input = { carrierId: clientId, brokerId: broker.id, invoiceNumber: mine.invoiceNumber, amount: "100", excludeInvoiceId: mine.id };
        const ordinary = await runInvoicePreflight(input, store);
        const [bulk] = await dashboardPreflights([input], store);
        assert.deepEqual(bulk.alerts.filter(a => a.severity !== "info"), ordinary.alerts.filter(a => a.severity !== "info"));
        assert(bulk.alerts.some(a => a.code === "BROKER_GRADE_LOW"));
        assert(bulk.alerts.some(a => a.title === "Carrier authority is inactive"));
      });
      await t.test("20-row limits retain full SQL counts and constant query count as a queue grows", async () => {
        await tx.insert(invoices).values(Array.from({ length: 22 }, (_, index) => ({
          invoiceNumber: `DASH-LIMIT-${index}-${tag}`, loadId: null, clientId, brokerId: broker.id,
          amount: "100", assignedTo: agent, status: "docs_pending" as const, createdAt: at,
        })));
        await tx.insert(tasks).values(Array.from({ length: 22 }, (_, index) => ({
          title: `Limit task ${index} ${tag}`, type: "followup" as const, assignedTo: agent, clientId,
          dueDate: new Date(at.getTime() + index * 1000), status: "todo" as const,
        })));
        await tx.insert(notifications).values({ userId: agent, entityType: "invoice", entityId: legacy.id,
          title: "Old malformed metadata", message: "Ignored", metadata: "{broken json" });
        let queryCount = 0;
        const counted = new Proxy(store, { get(target, key) {
          if (key !== "select" && key !== "execute") return Reflect.get(target, key);
          return (...args: unknown[]) => { queryCount++; return (Reflect.get(target, key) as Function).apply(target, args); };
        } });
        const queue = await readDashboardQueue({ id: agent, role: "employee" }, counted, at);
        assert.equal(queue.queueGroups[0].items.length, 20);
        assert.equal(queue.queueGroups[0].totalCount, 24);
        assert.equal(queue.queueCount, 24);
        assert.equal(queryCount, 4); // staff + bounded rows/counts + two batch lookups, not queries per invoice
        const followups = await readDashboardFollowUps({ id: agent, role: "employee" }, store, at);
        assert.equal(followups.followUps.length, 20);
        assert.equal(followups.totalCount, 25);
      });
      await t.test("funded queue filtering matches acknowledgement semantics before pagination", async () => {
        const keys = ["acked", "changed", "info", "legacy-notice"] as const;
        const records = await tx.insert(invoices).values(keys.map(key => ({
          invoiceNumber: `DASH-ACK-${key}-${tag}`, loadId: null, clientId, brokerId: broker.id, amount: "100",
          assignedTo: agent, status: "funded" as const, brokerConfirmationStatus: "confirmed" as const,
          createdAt: at, fundedAt: new Date(at.getTime() - 86_400_000),
        }))).returning({ id: invoices.id, invoiceNumber: invoices.invoiceNumber });
        const id = (key: string) => records.find(row => row.invoiceNumber === `DASH-ACK-${key}-${tag}`)!.id;
        const alert = (message: string, severity: string = "ack") => ({ code: "FIXTURE_ONLY", severity, message, title: "Review" });
        await tx.insert(eventLedger).values([
          { entityType: "invoice", entityId: id("acked"), eventType: "invoice_preflight", actorType: "system", createdAt: at,
            payloadJson: { alerts: [alert("same")], acknowledgements: [{ code: "FIXTURE_ONLY" }] } },
          { entityType: "invoice", entityId: id("changed"), eventType: "invoice_preflight", actorType: "system", createdAt: at,
            payloadJson: { alerts: [alert("old"), alert("new")], acknowledgements: [{ code: "FIXTURE_ONLY" }] } },
          { entityType: "invoice", entityId: id("info"), eventType: "invoice_preflight", actorType: "system", createdAt: at,
            payloadJson: { alerts: [alert("old"), alert("new", "info")], acknowledgements: [] } },
        ]);
        await tx.insert(notifications).values(["acked", "legacy-notice"].map(key => ({
          userId: agent, entityType: "invoice", entityId: id(key), title: "Review", message: "Legacy alert", read: true,
          metadata: JSON.stringify({ severity: "ack", code: "FIXTURE_ONLY", acknowledged: false, message: "Legacy alert" }),
        })));
        const result = await readDashboardQueue({ id: agent, role: "employee" }, store, at);
        const visible = result.queueGroups[0].items.map(row => row.id);
        assert(visible.includes(id("changed")));
        assert(visible.includes(id("legacy-notice")));
        assert(!visible.includes(id("acked")) && !visible.includes(id("info")));
        assert.equal(result.queueCount, 26); // 24 previous + only the two genuinely actionable funded invoices
      });
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
});
