import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PRODUCTION_APP_URL, PRODUCTION_PORTAL_URL, productionAppUrl, isProductionAppOrigin } from "./production-urls.js";

test("login and distribution URLs always use the verified production domain", () => {
  assert.equal(PRODUCTION_APP_URL, "https://factorflux.co");
  assert.equal(PRODUCTION_PORTAL_URL, "https://factorflux.io/portal");
  assert.equal(productionAppUrl("/login"), "https://factorflux.co/login");
  assert.equal(productionAppUrl("/api/desktop/download/guide"), "https://factorflux.co/api/desktop/download/guide");
  for (const spoof of ["https://preview.replit.dev/login", "//preview.replit.dev/login", "/\\preview.replit.dev/login"]) {
    assert.throws(() => productionAppUrl(spoof));
  }
});

test("only verified custom production origins are allowed in outbound confirmation links", () => {
  for (const value of ["https://factorflux.co", "https://factorflux.co/", "https://factorflux.io"]) {
    assert.equal(isProductionAppOrigin(value), true, value);
  }
  for (const value of [
    "https://demo.replit.dev", "https://demo.repl.co", "https://replit.com/@user/project",
    "https://demo.replit.app", "http://localhost:5000", "https://127.0.0.1",
    "http://factorflux.co", "https://factorflux.co.evil.com", "https://user:password@factorflux.co",
    "https://factorflux.co/login", "https://factorflux.co?redirect=x", "https://factorflux.co/#x", "",
  ]) assert.equal(isProductionAppOrigin(value), false, value);
});

test("both credential email formats use the production login URL, never the admin request host", () => {
  const source = readFileSync("server/routes.ts", "utf8");
  const route = source.slice(source.indexOf('app.post("/api/admin/users"'), source.indexOf('app.patch("/api/admin/users/:id"'));
  assert.match(route, /const loginUrl = productionAppUrl\("\/login"\)/);
  assert.match(route, /href="\$\{loginUrl\}"/);
  assert.match(route, /Please log in at \$\{loginUrl\}/);
  assert.doesNotMatch(route, /req\.protocol|req\.get\(["']host|REPLIT_|localhost/);
  assert.doesNotMatch(source, /REPLIT_DEV_DOMAIN|REPLIT_DOMAINS|req\.protocol|req\.get\(["']host/);
});

test("user-facing application, emails, launchers and distributed guides contain no development/platform links", () => {
  const files = [
    "client/index.html", "send-installers.js", "update-desktop-urls.sh", "create-mac-dmg.sh",
    "simple-browser-launcher.js", "QUICK-SHARE-LINKS.txt", "DESKTOP-TROUBLESHOOTING-GUIDE.md",
    "USER-INSTALLATION-GUIDE.md", "MAC-INSTALLER-INSTRUCTIONS.md", "DIRECT-DOWNLOAD-LINKS.md",
    "DOWNLOAD-INSTRUCTIONS.md", "SHARING-GUIDE.md", "WORKING-DOWNLOAD-SOLUTION.md",
    "DESKTOP-DISTRIBUTION-GUIDE.md",
  ];
  function collect(directory: string) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      // Historical compiled server bundles are not loaded by desktop launchers.
      if (["attached_assets", "uploads", "node_modules", "dist"].includes(item.name)) continue;
      const file = path.join(directory, item.name);
      if (item.isDirectory()) collect(file);
      else if (/\.(ts|tsx|js|html|sh|bat|md|txt)$/.test(file) && !/\.test\./.test(file)) files.push(file);
    }
  }
  collect("client/src");
  collect("electron-dist");
  // Server-only connectors, schema auth-type fields, and dev test tooling are
  // infrastructure, not user-facing branding. Protect outbound URL builders.
  files.push("server/routes.ts", "server/emailService.ts", "server/services/brokerConfirmationService.ts", "server/services/brokerCollections.ts");
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, "utf8"),
      /replit\.dev|repl\.co\b|https?:\/\/(?:[\w.-]+\.)?replit\.(?:com|app)\b|REPLIT_DEV_DOMAIN|REPLIT_DOMAINS|replit-dev-banner/i,
      `${file} exposes development or platform links`);
  }
});
