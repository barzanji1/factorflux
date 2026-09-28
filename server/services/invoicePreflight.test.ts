import assert from "node:assert/strict";
import test from "node:test";
import type { InvoicePreflightAlert } from "./invoicePreflight";

// This pure helper test does not connect to a database, but the service module
// initializes its pool at import time.
process.env.NEON_DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { getMissingAlertAcknowledgements } = await import("./invoicePreflight");

test("only unacknowledged ack alerts require acknowledgement", () => {
  const alerts: InvoicePreflightAlert[] = [
    { code: "NEEDS_ACK", severity: "ack", title: "Ack", message: "Needs acknowledgement" },
    { code: "BLOCK", severity: "block", title: "Block", message: "Blocked" },
    { code: "INFO", severity: "info", title: "Info", message: "Informational" },
  ];

  assert.deepEqual(getMissingAlertAcknowledgements(alerts, []), [alerts[0]]);
  assert.deepEqual(getMissingAlertAcknowledgements(alerts, ["NEEDS_ACK"]), []);
});

test("acknowledgement codes match alert codes regardless of repeated alert rows", () => {
  const alerts: InvoicePreflightAlert[] = [
    { code: "CARRIER_MANUAL_ALERT", severity: "ack", title: "One", message: "First" },
    { code: "CARRIER_MANUAL_ALERT", severity: "ack", title: "Two", message: "Second" },
  ];

  assert.deepEqual(
    getMissingAlertAcknowledgements(alerts, ["CARRIER_MANUAL_ALERT"]),
    [],
  );
});