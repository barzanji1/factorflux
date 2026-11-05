// Development-only real API regression. Uses an isolated test employee and
// removes every fixture/session/time entry afterwards; never clocks real staff.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { activities, notifications, sessions, timeEntries, userPermissions, users } from "../shared/schema";

async function main() {
  assert.notEqual(process.env.NODE_ENV, "production", "Do not run fixture verification in production");
  assert.ok(process.env.REPLIT_DEV_DOMAIN, "Development domain is required");
  const base = `http://${process.env.REPLIT_DEV_DOMAIN}:5000`;
  const fixtureId = `clock-regression-${randomUUID()}`;
  const email = `${fixtureId}@example.test`;
  const password = randomUUID();
  let cookie = "";
  let created = false;
  const request = async (path: string, method = "GET", body?: unknown) => {
    // Preserve the development Host header while reaching its application
    // port directly, matching the authenticated browser verification harness.
    return new Promise<{ status: number; data: any }>((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = httpRequest(`${base}${path}`, {
        method,
        lookup: (_hostname, options, callback) => {
          if ((options as { all?: boolean }).all) (callback as any)(null, [{ address: "127.0.0.1", family: 4 }]);
          else callback(null, "127.0.0.1", 4);
        },
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      }, response => {
        const setCookie = response.headers["set-cookie"]?.[0];
        if (setCookie) cookie = setCookie.split(";")[0];
        let text = "";
        response.setEncoding("utf8");
        response.on("data", chunk => { text += chunk; });
        response.on("end", () => {
          try { resolve({ status: response.statusCode ?? 0, data: JSON.parse(text) }); }
          catch { reject(new Error("Expected JSON from time-clock API")); }
        });
        response.on("error", reject);
      });
      req.on("error", reject);
      req.setTimeout(10000, () => req.destroy(new Error("Time-clock API timed out")));
      if (payload) req.write(payload);
      req.end();
    });
  };
  try {
    await db.insert(users).values({
      id: fixtureId, email, password: await bcrypt.hash(password, 10),
      authType: "local", firstName: "Clock", lastName: "Regression",
      role: "employee", status: "active", isTestAccount: true,
    });
    created = true;
    // An explicit permission list with no payroll access verifies self-service.
    await db.insert(userPermissions).values({ userId: fixtureId, permission: "dashboard", granted: true });
    const login = await request("/api/auth/login", "POST", { username: email, password });
    assert.equal(login.status, 200, "Fixture login failed");
    assert.ok(cookie, "Fixture session was not established");
    assert.equal((await request("/api/time-tracking/summary")).status, 403, "Payroll reports must remain restricted");
    const initial = await request("/api/time-tracking/status");
    assert.equal(initial.status, 200);
    assert.equal(initial.data.isClocked, false);
    const generatedIds: number[] = [];
    for (let cycle = 0; cycle < 2; cycle++) {
      const clockIn = await request("/api/time-tracking/clock-in", "POST", { notes: "Isolated time-clock regression" });
      assert.equal(clockIn.status, 200, "Clock-in failed");
      assert.ok(Number.isInteger(clockIn.data.id) && clockIn.data.id > 0, "Database did not generate an integer ID");
      assert.equal(clockIn.data.status, "clocked_in");
      generatedIds.push(clockIn.data.id);
      const active = await request("/api/time-tracking/status");
      assert.equal(active.data.isClocked, true);
      assert.equal(active.data.currentEntry.id, clockIn.data.id);
      assert.equal((await request("/api/time-tracking/clock-in", "POST", {})).status, 400, "Duplicate clock-in must be rejected");
      const clockOut = await request("/api/time-tracking/clock-out", "POST", { notes: "Isolated regression completed" });
      assert.equal(clockOut.status, 200, "Clock-out failed");
      assert.equal(clockOut.data.id, clockIn.data.id, "Clock-out must update the same time entry");
      assert.equal(clockOut.data.status, "clocked_out");
      assert.ok(clockOut.data.clockOutTime);
      assert.ok(Number.isFinite(Number(clockOut.data.totalHours)));
      assert.equal((await request("/api/time-tracking/status")).data.isClocked, false);
    }
    assert.notEqual(generatedIds[0], generatedIds[1], "Generated IDs must be unique");
    assert.equal((await request("/api/time-tracking/clock-out", "POST", {})).status, 400, "Clock-out without a session must be rejected");
    const audit = await db.select({ type: activities.type }).from(activities).where(eq(activities.userId, fixtureId));
    assert.equal(audit.filter(row => row.type === "clock_in").length, 2);
    assert.equal(audit.filter(row => row.type === "clock_out").length, 2);
    console.log(JSON.stringify({ passed: true, cycles: 2, generatedIds, clockInHttp: 200, clockOutHttp: 200, selfServiceWithoutPayroll: true, payrollReportHttp: 403 }));
  } finally {
    if (created) {
      if (cookie) await request("/api/auth/logout", "POST", {}).catch(() => {});
      await db.transaction(async tx => {
        await tx.delete(sessions).where(sql`${sessions.sess}->'user'->>'id' = ${fixtureId}`);
        await tx.delete(notifications).where(eq(notifications.userId, fixtureId));
        await tx.delete(activities).where(eq(activities.userId, fixtureId));
        await tx.delete(timeEntries).where(eq(timeEntries.userId, fixtureId));
        await tx.delete(userPermissions).where(eq(userPermissions.userId, fixtureId));
        await tx.delete(users).where(eq(users.id, fixtureId));
      });
      const remaining = await db.select({ id: users.id }).from(users).where(eq(users.id, fixtureId));
      assert.equal(remaining.length, 0, "Fixture cleanup failed");
      await mkdir("generated-artifacts/time-clock-fixes", { recursive: true });
      await writeFile("generated-artifacts/time-clock-fixes/api-cleanup.json", JSON.stringify({ fixtureRemoved: true, realStaffModified: false }));
      console.log(JSON.stringify({ cleanup: "complete", realStaffModified: false }));
    }
  }
}

main().catch(error => {
  // Never print credentials, cookies, connection strings or provider payloads.
  console.error(error instanceof assert.AssertionError ? error.message : JSON.stringify({
    message: "Time-clock regression failed", kind: error instanceof Error ? error.name : "unknown",
    code: typeof error?.code === "string" ? error.code : undefined,
  }));
  process.exitCode = 1;
}).finally(() => pool.end());
