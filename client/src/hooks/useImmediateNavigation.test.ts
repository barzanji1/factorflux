import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("shell navigation commits Wouter's update without timers or changing history semantics", () => {
  const hook = readFileSync("client/src/hooks/useImmediateNavigation.ts", "utf8");
  assert.match(hook, /flushSync\(\(\) => navigate\(\.\.\.args\)\)/);
  assert.doesNotMatch(hook, /setTimeout|startTransition|window\.location/);
  for (const file of ["sidebar", "top-nav"]) {
    const source = readFileSync(`client/src/components/layout/${file}.tsx`, "utf8");
    assert.match(source, /useImmediateNavigation as useLocation/);
  }
});

test("clock actions have explicit semantic states and high-contrast scoped colors", () => {
  const source = readFileSync("client/src/components/time-tracking/time-clock.tsx", "utf8");
  const css = readFileSync("client/src/components/time-tracking/time-clock.css", "utf8");
  assert.match(source, /data-clock-action=\{isClockedIn \? "clock-out" : "clock-in"\}/);
  assert.match(source, /disabled=\{!userId \|\| isLoading \|\| isError \|\| isSubmitting\}/);
  assert.match(css, /data-clock-action="clock-in"[\s\S]*?background-color: #087f87 !important/i);
  assert.match(css, /data-clock-action="clock-out"[\s\S]*?background-color: #102a38 !important/i);
  assert.match(css, /\.ff-time-clock-action:disabled[\s\S]*?color: #fff !important/);
});
