import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import { sentryDataCollection, scrubSentryBreadcrumb, scrubSentryEvent } from "@shared/sentry-privacy";
import "./index.css";
import "@/styles/neu/dashboard.css";
import App from "./App";

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

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<div role="alert">Something went wrong — please refresh.</div>}>
    <App />
  </Sentry.ErrorBoundary>
);
