import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILT_IN_EMAIL_TEMPLATES, emailTemplateInputSchema, personalizeEmail } from "./email-templates";

test("all 11 federal holidays, two generic closure notices and prior templates are available", () => {
  assert.equal(BUILT_IN_EMAIL_TEMPLATES.filter(row => row.id.startsWith("holiday-") && row.id !== "holiday-hours").length, 11);
  for (const id of ["new-year", "mlk", "presidents", "memorial", "juneteenth", "independence", "labor",
    "columbus-indigenous", "veterans", "thanksgiving", "christmas"]) {
    const template = BUILT_IN_EMAIL_TEMPLATES.find(row => row.id === `holiday-${id}`)!;
    assert(template, id);
    assert.match(template.body, /closed on all federal holidays/);
    assert.match(template.body, /\[Company\]/);
    assert.doesNotMatch(template.body, /\b202[0-9]\b/, "do not guess this year's observed date");
  }
  for (const id of ["office-closed", "holiday-hours", "document", "deadline"]) {
    assert(BUILT_IN_EMAIL_TEMPLATES.some(row => row.id === id), id);
  }
  assert.equal(new Set(BUILT_IN_EMAIL_TEMPLATES.map(row => row.id)).size, 15);
  for (const template of BUILT_IN_EMAIL_TEMPLATES) {
    assert(emailTemplateInputSchema.safeParse({ name: template.name, subject: template.subject, body: template.body }).success);
  }
});

test("personalization is per-client plain text with safe fallback and literal dollar signs", () => {
  assert.equal(personalizeEmail("Hello [Company] / [company]", " A&B $& Logistics\r\nBcc: nobody "), "Hello A&B $& Logistics Bcc: nobody / A&B $& Logistics Bcc: nobody");
  for (const name of [undefined, null, "", " \t\n"]) {
    assert.equal(personalizeEmail("Hello [Company]", name), "Hello Valued Client");
  }
  assert.equal(personalizeEmail("Keep [Closure date] and [Company]", "Acme"), "Keep [Closure date] and Acme");
});

test("custom templates require bounded name, subject and body without envelope/actor overrides", () => {
  const valid = { name: " Our closure ", subject: " Notice ", body: " Hello [Company] " };
  assert.deepEqual(emailTemplateInputSchema.parse(valid), { name: "Our closure", subject: "Notice", body: "Hello [Company]" });
  for (const changes of [{ name: "" }, { subject: "\n" }, { body: "" }, { name: "a".repeat(101) },
    { subject: "a".repeat(201) }, { body: "a".repeat(20001) }, { subject: "Hello\r\nBcc: bad@example.com" },
    { createdBy: "admin" }, { to: "other@example.com" }, { id: "holiday-christmas" }]) {
    assert.throws(() => emailTemplateInputSchema.parse({ ...valid, ...changes }));
  }
});
