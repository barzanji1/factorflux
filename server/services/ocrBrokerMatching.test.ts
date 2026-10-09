import test from "node:test";
import assert from "node:assert/strict";
import { brokerAliases, matchBrokerName, normalizeBrokerName, trigramSimilarity, withinTwoEdits } from "./ocrBrokerMatching";

test("normalization matches OCR internal spaces, punctuation and corporate suffixes", () => {
  assert.equal(normalizeBrokerName("TRANSJ ET CARGO L.L.C."), "TRANSJETCARGO");
  for (const suffix of ["LLC", "INC", "CORP", "LTD"]) {
    assert.equal(normalizeBrokerName(`Trans-Jet Cargo, ${suffix}.`), "TRANSJETCARGO");
  }
  const match = matchBrokerName("TRANSJ ET CARGO LLC", [{ id: 1342, name: "TRANSJET CARGO LLC" }]);
  assert.equal(match.brokerId, 1342);
  assert.equal(match.confidence, "high");
  assert.equal(match.rawName, "TRANSJ ET CARGO LLC");
});
test("DBA and alias strings/arrays match without creating brokers", () => {
  const aliases = brokerAliases({ dba_name: "Transjet Cargo Inc.", aliases: ["Second Carrier"], alias_name: "Third; Fourth" });
  const match = matchBrokerName("Transjet Cargo LLC", [{ id: 2, name: "Legal Holdings", aliases }]);
  assert.equal(match.brokerId, 2);
  assert.equal(match.confidence, "high");
  assert(aliases.includes("Fourth"));
  assert(brokerAliases({ aliases: '["A Logistics","B Transport"]' }).includes("A Logistics"));
});
test("one fuzzy candidate gets medium confidence", () => {
  assert(withinTwoEdits("TRANSJETCARGO", "TRANSJATCARGO"));
  assert(!withinTwoEdits("TRANSJETCARGO", "UNRELATEDBROKER"));
  const match = matchBrokerName("TRANSJAT CARGO", [{ id: 3, name: "Transjet Cargo Inc." }]);
  assert.equal(match.brokerId, 3);
  assert.equal(match.confidence, "medium");
});
test("trigram threshold can qualify when edit distance exceeds two", () => {
  const name = "ABCDEFGHIJKLMNOPQRSTUVWXYZTRANSPORTATION";
  assert(!withinTwoEdits(name, name + "XYZ"));
  assert(trigramSimilarity(name, name + "XYZ") >= .85);
  assert.equal(matchBrokerName(name + "XYZ", [{ id: 4, name }]).confidence, "medium");
});
test("multiple matches, including exact plus fuzzy, leave broker unset", () => {
  const match = matchBrokerName("Transjet Cargo", [
    { id: 1, name: "Transjet Cargo LLC" }, { id: 2, name: "Transjat Cargo Ltd" },
  ]);
  assert.equal(match.brokerId, null);
  assert.equal(match.confidence, null);
  assert.equal(match.candidates.length, 2);
  assert.equal(match.rawName, "Transjet Cargo");
});
test("same broker matched by multiple aliases is not ambiguous", () => {
  assert.equal(matchBrokerName("ABC", [{ id: 1, name: "ABC Inc", aliases: ["ABC", "ABC LLC"] }]).brokerId, 1);
});
test("no candidates or empty normalized names remain unset", () => {
  assert.equal(matchBrokerName("Different Transport", [{ id: 1, name: "ABC LLC" }]).brokerId, null);
  assert.equal(matchBrokerName("LLC.", [{ id: 1, name: "Other LLC" }]).brokerId, null);
  assert.equal(matchBrokerName(null, []).brokerId, null);
});
