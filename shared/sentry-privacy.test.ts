import assert from "node:assert/strict";
import test from "node:test";
import { scrubSentryBreadcrumb, scrubSentryEvent } from "./sentry-privacy";

test("drops arbitrary names, emails, credentials, and document data everywhere", () => {
  const sensitive = "Private Person private@example.test secret-fixture";
  const event = scrubSentryEvent({
    event_id: "verification-event",
    user: { email: sensitive, username: sensitive, name: sensitive },
    message: sensitive,
    logentry: { message: sensitive },
    request: { url: `https://example.test/${sensitive}`, headers: { cookie: sensitive }, data: sensitive },
    contexts: { staff: { name: sensitive }, react: { componentStack: sensitive } },
    extra: { name: sensitive },
    tags: { email: sensitive },
    transaction: sensitive,
    server_name: sensitive,
    breadcrumbs: [{ category: sensitive, message: sensitive, data: { name: sensitive }, level: "error", timestamp: 1 }],
    exception: { values: [{
      type: "TypeError", value: sensitive,
      mechanism: { type: "generic", handled: false, data: { name: sensitive } },
      stacktrace: { frames: [{
        filename: `/home/${sensitive}/index.ts?name=${sensitive}`,
        function: sensitive, lineno: 42, colno: 3,
        vars: { name: sensitive }, context_line: sensitive,
      }] },
    }] },
  });
  assert(!JSON.stringify(event).includes(sensitive));
  assert(!JSON.stringify(event).includes("private@example.test"));
  assert.equal(event.exception?.values?.[0].stacktrace?.frames?.[0].filename, "index.ts");
  assert.equal(event.exception?.values?.[0].stacktrace?.frames?.[0].lineno, 42);
  assert.equal(event.exception?.values?.[0].mechanism?.handled, false);
  assert.equal(event.event_id, "verification-event");
  assert.equal(event.user, undefined);
  assert.equal(event.request, undefined);
  assert.equal(event.contexts, undefined);
});

test("breadcrumbs retain only safe level and time; arbitrary exception names are removed", () => {
  assert.deepEqual(scrubSentryBreadcrumb({
    message: "A Staff Name", category: "Another Staff Name", data: { email: "name@example.test" },
    timestamp: 2, level: "info",
  }), { timestamp: 2, level: "info", category: "application" });
  assert.equal(scrubSentryEvent({ exception: { values: [{ type: "A Staff Name" }] } })
    .exception?.values?.[0].type, "Error");
});
