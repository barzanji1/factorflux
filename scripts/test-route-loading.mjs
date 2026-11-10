import assert from "node:assert/strict";
import { build } from "esbuild";
import Module from "node:module";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Render the real guard, shell, and material components without network calls.
// Replace only authentication/router inputs and shell widgets that fetch data.
const mocks = {
  "@/hooks/useAuth": "export const useAuth = () => globalThis.__routeLoadingAuth;",
  wouter: `import React from 'react';
    export const useLocation = () => ['/documents', () => {}];
    export const Redirect = () => React.createElement('span', {'data-test-redirect': true});`,
  "@/components/layout/sidebar": `import React from 'react';
    export default () => React.createElement('aside', {'data-test-sidebar': true});`,
  "@/components/layout/top-nav": `import React from 'react';
    export default ({title, neu}) => React.createElement('header', {'data-test-neu-header': neu}, title);`,
  "@/pages/access-denied": `import React from 'react';
    export default () => React.createElement('span', {'data-test-denied': true});`,
};
const bundle = await build({
  stdin: {
    contents: "export { ProtectedRoute } from './client/src/components/ProtectedRoute';",
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  packages: "external",
  jsx: "automatic",
  alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
  loader: { ".css": "empty" },
  plugins: [{
    name: "isolated-shell-inputs",
    setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, args => {
        if (Object.hasOwn(mocks, args.path)) return { path: args.path, namespace: "mock" };
      });
      plugin.onLoad({ filter: /.*/, namespace: "mock" }, args => ({
        contents: mocks[args.path],
        loader: "jsx",
        resolveDir: process.cwd(),
      }));
    },
  }],
});
const compiled = new Module(path.resolve("scripts/__route-loading-test.cjs"));
compiled.filename = path.resolve("scripts/__route-loading-test.cjs");
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const { ProtectedRoute } = compiled.exports;
const defaults = {
  isAuthenticated: true,
  isLoading: false,
  user: { id: "isolated-test-user", role: "agent" },
  permissions: ["documents"],
  permissionsLoaded: true,
  permissionsReadyForRoute: false,
  permissionsError: null,
  refreshPermissions: () => {},
};
const render = (overrides = {}) => {
  globalThis.__routeLoadingAuth = { ...defaults, ...overrides };
  return renderToStaticMarkup(
    React.createElement(ProtectedRoute, null, React.createElement("div", { "data-test-destination": true })),
  );
};
try {
  let html = render();
  assert.match(html, /data-test-sidebar/);
  assert.match(html, /data-test-neu-header="true"/);
  assert.match(html, /ff-neu-app-shell/);
  assert.match(html, /Checking page access/);
  assert.doesNotMatch(html, /Verifying authentication/);
  assert.doesNotMatch(html, /data-test-destination/);

  html = render({ permissionsReadyForRoute: true });
  assert.match(html, /data-test-destination/);
  assert.doesNotMatch(html, /Checking page access/);

  html = render({ permissionsReadyForRoute: true, permissions: [] });
  assert.match(html, /data-test-denied/);
  assert.doesNotMatch(html, /data-test-destination/);

  html = render({ permissionsReadyForRoute: true, permissionsError: "Offline" });
  assert.match(html, /Retry access check/);
  assert.doesNotMatch(html, /data-test-destination/);

  html = render({ isAuthenticated: false, user: null });
  assert.match(html, /data-test-redirect/);
  assert.doesNotMatch(html, /data-test-sidebar|data-test-destination/);

  html = render({ isLoading: true });
  assert.match(html, /Verifying authentication/);
  assert.doesNotMatch(html, /data-test-sidebar|data-test-destination/);

  html = render({ user: { id: "isolated-test-admin", role: "admin" } });
  assert.match(html, /data-test-destination/);
  console.log("Passed: navigation shell continuity, pending access isolation, allow, deny, failure, sign-out, initial authentication, admin.");
} finally {
  delete globalThis.__routeLoadingAuth;
}
