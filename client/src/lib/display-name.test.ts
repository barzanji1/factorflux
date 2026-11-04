import assert from "node:assert/strict";
import test from "node:test";
import { displayEntityName } from "./utils";

test("funding names use normal case while preserving acronyms and initials", () => {
  assert.equal(displayEntityName("JC LOGISTIC TRANSPORT LLC"), "JC Logistic Transport LLC");
  assert.equal(displayEntityName("TRANSJET CARGO LLC"), "Transjet Cargo LLC");
  assert.equal(displayEntityName("O'NEIL TRUCKING INC."), "O'Neil Trucking INC.");
});
test("display formatting preserves deliberate mixed casing and does not change source data", () => {
  assert.equal(displayEntityName("FedEx Freight"), "FedEx Freight");
  assert.equal(displayEntityName(null), "—");
});
