import assert from "node:assert/strict";
import test from "node:test";
import { collectionEventFields, collectionEventTitle } from "./collection-event-details";

test("collection details display readable values without losing false, zero or unknown fields", () => {
  const payload = { brokerId: 2914, loadNumber: "00123", wouldSendEmail: true, wouldNotifyAlan: false,
    attempts: 0, notes: null, additionalContext: "a".repeat(500) };
  assert.deepEqual(collectionEventFields(payload), [
    { label: "Broker ID", value: "2914" }, { label: "Load number", value: "00123" },
    { label: "Would send email", value: "Yes" }, { label: "Would notify collection handler", value: "No" },
    { label: "Attempts", value: "0" }, { label: "Notes", value: "—" },
    { label: "Additional Context", value: "a".repeat(500) },
  ]);
  assert.equal(payload.wouldNotifyAlan, false);
});

test("legacy JSON strings, plain notes, nested objects and arrays remain readable", () => {
  assert.deepEqual(collectionEventFields('{"action":"pause","actorId":"staff-1"}'), [
    { label: "Action", value: "Collections paused" }, { label: "Staff user ID", value: "staff-1" },
  ]);
  assert.deepEqual(collectionEventFields("Legacy note"), [{ label: "Details", value: "Legacy note" }]);
  assert.deepEqual(collectionEventFields({ context: { flags: [true, false], extra: {} } }), [
    { label: "Context · Flags · Item 1", value: "Yes" },
    { label: "Context · Flags · Item 2", value: "No" },
    { label: "Context · Extra", value: "None" },
  ]);
});

test("event titles explain control actions and collection follow-ups instead of internal IDs", () => {
  assert.equal(collectionEventTitle({ step: "control_random-id", details: { action: "vp_confirmed" } }), "Receipt confirmed by staff");
  assert.equal(collectionEventTitle({ step: "control_random-id", details: '{"action":"start_live"}' }), "Live collections started");
  assert.equal(collectionEventTitle({ step: "control_random-id", details: null }), "Collection workflow updated");
  assert.equal(collectionEventTitle({ step: "rps_1", details: {} }), "Payment status follow-up 1");
  assert.equal(collectionEventTitle({ step: "vp_escalation", details: {} }), "Receipt confirmation escalated");
});
