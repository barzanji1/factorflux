import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { resolveEmailConfig } from "./email-config.js";

test("default mail identity uses notifications with the monitored Reply-To", () => {
  assert.deepEqual(resolveEmailConfig(), {
    fromAddress: "notifications@truckingprosfinancial.com",
    from: "TruckingPros Financial <notifications@truckingprosfinancial.com>",
    replyTo: "dosh@truckingprosfinancial.com",
  });
});

test("environment sender settings are used instead of a separate hardcoded envelope", () => {
  const config = resolveEmailConfig({
    EMAIL_FROM: " notifications+test@truckingprosfinancial.com ",
    EMAIL_REPLY_TO: "dosh@truckingprosfinancial.com",
  });
  assert.equal(config.from, "TruckingPros Financial <notifications+test@truckingprosfinancial.com>");
  assert.equal(config.replyTo, "dosh@truckingprosfinancial.com");
});

test("invalid or blank sender settings and header injection fail explicitly", () => {
  for (const value of ["", "invalid", "sender@example.com\r\nBcc: other@example.com"]) {
    assert.throws(() => resolveEmailConfig({ EMAIL_FROM: value }));
    assert.throws(() => resolveEmailConfig({ EMAIL_REPLY_TO: value }));
  }
});

test("all mail uses the shared transport identity and production code has no literal From overrides", () => {
  const transactional = readFileSync("server/emailService.ts", "utf8");
  const transport = readFileSync("server/resendTransport.js", "utf8");
  const resend = readFileSync("server/services/clientEmail.ts", "utf8");
  assert.match(transactional, /await sendResendEmail\(msg\)/);
  assert.match(transport, /from:\s*SYSTEM_EMAIL_FROM/);
  assert.match(transport, /reply_to:\s*SYSTEM_EMAIL_REPLY_TO/);
  assert.match(resend, /CLIENT_EMAIL_FROM\s*=\s*SYSTEM_EMAIL_FROM/);
  assert.match(resend, /CLIENT_EMAIL_REPLY_TO\s*=\s*SYSTEM_EMAIL_REPLY_TO/);
  const files: string[] = [];
  function collect(directory: string) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) collect(file);
      else if (/\.(?:ts|tsx|js|jsx)$/.test(file) && !/\.test\./.test(file)) files.push(file);
    }
  }
  collect("server");
  collect("client/src");
  files.push("send-installers.js", "email-installers.ts");
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\bfrom\s*:\s*["'`][^"'`\r\n]*@/, `${file} has a literal sender override`);
    if (file !== "server/resendTransport.js") {
      assert.doesNotMatch(source, /@replit\/connectors-sdk|api\.resend\.com|["']\/emails["']/, `${file} bypasses the sole email transport`);
    }
    assert.doesNotMatch(source, /clients@(?:truckingprosfinancial|tpfactoring)\.com/i, `${file} has the old sender`);
  }
});
