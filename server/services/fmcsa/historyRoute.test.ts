import assert from "node:assert/strict";
import test from "node:test";
import { createFmcsaHistoryHandler } from "./historyRoute";

function responseRecorder() {
  let statusCode = 200;
  let body: unknown;
  return {
    res: {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(value: unknown) {
        body = value;
        return this;
      },
    },
    result: () => ({ statusCode, body }),
  };
}

test("FMCSA history returns checks in the documented response shape", async () => {
  const recorder = responseRecorder();
  const handler = createFmcsaHistoryHandler(async () => [{ id: 7 }] as never);
  await handler(
    { params: { id: "42" }, query: { entityType: "broker" } } as never,
    recorder.res as never,
    (() => undefined) as never,
  );
  assert.deepEqual(recorder.result(), { statusCode: 200, body: { checks: [{ id: 7 }] } });
});

test("FMCSA history returns a JSON 400 for an invalid entity type", async () => {
  const recorder = responseRecorder();
  const handler = createFmcsaHistoryHandler(async () => []);
  await handler(
    { params: { id: "42" }, query: { entityType: "unknown" } } as never,
    recorder.res as never,
    (() => undefined) as never,
  );
  assert.deepEqual(recorder.result(), {
    statusCode: 400,
    body: { message: "entityType must be broker, debtor, or carrier" },
  });
});

test("FMCSA history accepts carrier snapshots", async () => {
  const recorder = responseRecorder();
  const handler = createFmcsaHistoryHandler(async (type, id) => {
    assert.equal(type, "carrier");
    assert.equal(id, 42);
    return [{ id: 9 }] as never;
  });
  await handler(
    { params: { id: "42" }, query: { entityType: "carrier" } } as never,
    recorder.res as never,
    (() => undefined) as never,
  );
  assert.deepEqual(recorder.result(), { statusCode: 200, body: { checks: [{ id: 9 }] } });
});

test("FMCSA history returns a JSON 500 when storage fails", async () => {
  const recorder = responseRecorder();
  const handler = createFmcsaHistoryHandler(async () => {
    throw new Error("database unavailable");
  });
  await handler(
    { params: { id: "42" }, query: { entityType: "debtor" } } as never,
    recorder.res as never,
    (() => undefined) as never,
  );
  assert.deepEqual(recorder.result(), {
    statusCode: 500,
    body: { message: "Failed to load FMCSA check history" },
  });
});