import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("floating cards handle cancelled transitions, delayed visibility and unmount cleanup", () => {
  const source = readFileSync("client/src/components/dashboard/FloatingActionGrid.tsx", "utf8");
  assert.match(source, /addEventListener\("transitioncancel"/);
  assert.match(source, /setTimeout\(\(\) => finishFlip\(id\), 700\)/);
  assert.match(source, /getComputedStyle\(control\)\.visibility === "visible"/);
  assert.match(source, /control\.closest\("\[inert\]"\)/);
  assert.match(source, /timers\.current\.forEach\(clearTimeout\)/);
  assert.match(source, /cancelAnimationFrame\(focusFrame\.current\)/);
  assert.match(source, /onNavigate\(destination\)/);
});
