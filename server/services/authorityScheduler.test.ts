import assert from "node:assert/strict";
import test from "node:test";

process.env.NEON_DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { deriveCarrierAuthorityStatus } = await import("./authorityScheduler");

test("carrier authority derives from carrier operating and common/contract fields", () => {
  assert.equal(deriveCarrierAuthorityStatus({
    operatingStatus: "AUTHORIZED FOR PROPERTY",
  }), "ACTIVE");
  assert.equal(deriveCarrierAuthorityStatus({
    commonAuthorityStatus: "NOT AUTHORIZED",
  }), "NOT_AUTHORIZED");
  assert.equal(deriveCarrierAuthorityStatus({
    contractAuthorityStatus: "INACTIVE",
  }), "INACTIVE");
});

test("carrier authority ignores broker-only authority and leaves missing signals unknown", () => {
  assert.equal(deriveCarrierAuthorityStatus({
    brokerAuthorityStatus: "AUTHORIZED",
  }), "UNKNOWN");
  assert.equal(deriveCarrierAuthorityStatus({}), "UNKNOWN");
});

test("conflicting common and contract authority is unknown without carrier-level evidence", () => {
  assert.equal(deriveCarrierAuthorityStatus({
    commonAuthorityStatus: "INACTIVE",
    contractAuthorityStatus: "AUTHORIZED",
  }), "UNKNOWN");
  assert.equal(deriveCarrierAuthorityStatus({
    commonAuthorityStatus: "NOT AUTHORIZED",
    contractAuthorityStatus: "ACTIVE",
  }), "UNKNOWN");
});

test("carrier-level status resolves mixed authority classes without substring errors", () => {
  assert.equal(deriveCarrierAuthorityStatus({
    operatingStatus: "ACTIVE",
    commonAuthorityStatus: "INACTIVE",
    contractAuthorityStatus: "AUTHORIZED",
  }), "ACTIVE");
  assert.equal(deriveCarrierAuthorityStatus({
    allowedToOperate: true,
    commonAuthorityStatus: "INACTIVE",
    contractAuthorityStatus: "AUTHORIZED",
  }), "ACTIVE");
  assert.equal(deriveCarrierAuthorityStatus({
    operatingStatus: "INACTIVE",
  }), "INACTIVE");
});