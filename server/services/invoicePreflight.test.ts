import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { InvoicePreflightAlert } from "./invoicePreflight";

// This pure helper test does not connect to a database, but the service module
// initializes its pool at import time.
process.env.NEON_DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
const { getMissingAlertAcknowledgements, runInvoicePreflight } = await import("./invoicePreflight");

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

test("exact duplicates use carrier invoice number and remain scoped to the carrier", async () => {
  const whereConditions: unknown[] = [];
  let queryIndex = 0;
  const responses = [
    [{
      rules: {
        DUPLICATE_EXACT: true,
        DUPLICATE_NEAR: false,
        CARRIER_DORMANT: false,
        CARRIER_MANUAL_ALERT: false,
        BROKER_MANUAL_ALERT: false,
        BROKER_GRADE_LOW: false,
        BROKER_CHARGEBACKS: false,
        AUTHORITY_INACTIVE: false,
        DOCS_EXPIRED: false,
        CARRIER_OPEN_CHARGEBACK: false,
      },
    }],
    [{ id: 23, carrierInvoiceNumber: "CARRIER-100", loadNumber: "LOAD-8" }],
    [{ id: 7, name: "Carrier" }],
  ];
  const fakeDb = {
    select: () => {
      const response = responses[queryIndex++];
      const query: any = {};
      query.from = () => query;
      query.where = (condition: unknown) => {
        whereConditions.push(condition);
        return query;
      };
      query.limit = () => query;
      query.then = (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(response).then(resolve, reject);
      return query;
    },
  };

  const { alerts } = await runInvoicePreflight({
    carrierId: 7,
    invoiceNumber: "CARRIER-100",
    loadNumber: "LOAD-8",
  }, fakeDb as never);

  const exactWhere = whereConditions[0];
  assert.ok(exactWhere);
  const query = new PgDialect().sqlToQuery(exactWhere as Parameters<PgDialect["sqlToQuery"]>[0]);
  assert.match(query.sql, /"invoices"\."client_id"/);
  assert.match(query.sql, /"invoices"\."carrier_invoice_number"/);
  assert.match(query.sql, /"invoices"\."load_number"/);
  assert.doesNotMatch(query.sql, /"invoices"\."invoice_number"/);
  assert.deepEqual(query.params, [7, "CARRIER-100", "LOAD-8"]);

  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /carrier invoice number CARRIER-100/);
});