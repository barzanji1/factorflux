import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCityState } from "./ocrBolMismatch";
test("city/state comparison normalizes punctuation, ZIPs, state names and case", () => {
  assert.equal(normalizeCityState("Natick, Massachusetts 01760, USA"), normalizeCityState("NATICK MA"));
  assert.equal(normalizeCityState("St. Louis, Missouri"), normalizeCityState("St Louis MO"));
  assert.equal(normalizeCityState("Charleston West Virginia"), normalizeCityState("CHARLESTON WV"));
  assert.equal(normalizeCityState("SCHENECTADY, NY- 12306 UNITED STATES"), normalizeCityState("Schenectady NY"));
  assert.equal(normalizeCityState("TENASKA GEORGIA 2100 GEORGE BROWN RD FRANKLIN GA-30217-5255 UNITED STATES"), null);
  for (const unknown of ["", "unknown", "Natick", "N/A"]) assert.equal(normalizeCityState(unknown), null);
});
