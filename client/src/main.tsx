import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { sentryDataCollection, scrubSentryBreadcrumb, scrubSentryEvent } from "@shared/sentry-privacy";
import "./index.css";
import "./styles/loading-continuity.css";
import { initialStaffPath } from "./lib/staff-entry";

// Only select the anonymous entry page here. Server authentication and route
// permission checks remain the authority for all protected content.
try {
  const entry = initialStaffPath(location.pathname, localStorage.getItem("isAuthenticated"), localStorage.getItem("user"));
  if (entry !== location.pathname) history.replaceState(history.state, "", entry);
} catch {
  // Storage can be unavailable in private/restricted browsers.
  if (location.pathname === "/") history.replaceState(history.state, "", "/login");
}

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  enabled: Boolean(import.meta.env.VITE_SENTRY_DSN),
  environment: import.meta.env.MODE,
  dataCollection: sentryDataCollection,
  tracePropagationTargets: [],
  beforeSendLog: () => null,
  beforeSendMetric: () => null,
  tracesSampleRate: 0,
  ignoreSpans: [/.*/],
  integrations: defaults => defaults.filter(integration => integration.name !== "BrowserSession"),
  maxBreadcrumbs: 30,
  beforeBreadcrumb: scrubSentryBreadcrumb,
  beforeSend: scrubSentryEvent,
});

// Broker entry never imports/mounts staff authentication, permissions, cache,
// navigation, or the staff-only fetch interceptor.
const entry = location.pathname === "/broker" || location.pathname.startsWith("/broker/")
  ? import("./pages/broker")
  : import("./App");
entry.then(({ default: Entry }) => {
  createRoot(document.getElementById("root")!).render(
    <Sentry.ErrorBoundary fallback={<div role="alert">Something went wrong — please refresh.</div>}>
      <Entry />
    </Sentry.ErrorBoundary>
  );
}).catch(() => {
  const root = document.getElementById("root");
  if (root) root.innerHTML = '<div role="alert">Unable to load the application. Please refresh.</div>';
});
