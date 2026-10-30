import { test } from "node:test";
import assert from "node:assert/strict";
import { getKpiCarouselPeriod, wrapKpiCarouselPhase } from "./KpiCarousel";

test("loop period includes the gap between identical card sets", () => {
  assert.equal(getKpiCarouselPeriod(1264, 16), 1280);
});

test("seam preserves subpixel overshoot instead of snapping to zero", () => {
  assert.equal(wrapKpiCarouselPhase(1280.25, 1280), 0.25);
  assert.equal(wrapKpiCarouselPhase(-0.25, 1280), 1279.75);
  assert.equal(wrapKpiCarouselPhase(2560, 1280), 0);
});

test("manual nudges wrap both ways without a blank edge", () => {
  assert.equal(wrapKpiCarouselPhase(7 + 6 * 240, 1280), 167);
  assert.equal(wrapKpiCarouselPhase(7 - 240, 1280), 1047);
  assert.equal(wrapKpiCarouselPhase(10, 0), 0);
});
