import assert from "node:assert/strict";
import test from "node:test";
import { isSelfTimeTrackingRequest } from "./timeTrackingAccess";

test("authenticated self-service clock routes do not require payroll reporting access", () => {
  for (const [method, path] of [
    ["GET", "/api/time-tracking/status"],
    ["GET", "/api/time-tracking/entries"],
    ["POST", "/api/time-tracking/clock-in"],
    ["POST", "/api/time-tracking/clock-out"],
  ]) assert.equal(isSelfTimeTrackingRequest(method, path), true);
});

test("self-service exemption does not cover reporting, other users, wrong methods or path prefixes", () => {
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    for (const path of [
      "/api/time-tracking/summary", "/api/time-tracking/live",
      "/api/time-tracking/agent/123", "/api/time-tracking",
      "/api/time-tracking/status/123", "/api/time-tracking/status-extra",
      "/api/time-tracking/new-report",
    ]) assert.equal(isSelfTimeTrackingRequest(method, path), false);
  }
  assert.equal(isSelfTimeTrackingRequest("POST", "/api/time-tracking/status"), false);
  assert.equal(isSelfTimeTrackingRequest("GET", "/api/time-tracking/clock-in"), false);
  assert.equal(isSelfTimeTrackingRequest("DELETE", "/api/time-tracking/entries"), false);
});
