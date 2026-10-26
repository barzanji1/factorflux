import * as Sentry from "@sentry/node";
import type { RequestHandler } from "express";
import { sentryDataCollection, scrubSentryBreadcrumb, scrubSentryEvent } from "../shared/sentry-privacy";

// Imported first by index.ts so initialization precedes Express/app modules.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.NODE_ENV || "development",
  dataCollection: sentryDataCollection,
  includeServerName: false,
  tracePropagationTargets: [],
  beforeSendLog: () => null,
  beforeSendMetric: () => null,
  tracesSampleRate: 0,
  ignoreSpans: [/.*/],
  maxBreadcrumbs: 30,
  integrations: defaults => [
    ...defaults.filter(integration => ![
      "RequestData", "Console", "ContextLines", "LocalVariablesAsync",
      "OnUncaughtException", "OnUnhandledRejection", "ProcessSession",
    ].includes(integration.name)),
    Sentry.onUncaughtExceptionIntegration({ exitEvenIfOtherHandlersAreRegistered: true }),
    Sentry.onUnhandledRejectionIntegration({ mode: "strict" }),
  ],
  beforeBreadcrumb: scrubSentryBreadcrumb,
  beforeSend: scrubSentryEvent,
});

// Modern SDKs removed Handlers.requestHandler. Isolate the scope as the first
// middleware; the SDK's Express integration provides request instrumentation.
export const sentryRequestHandler: RequestHandler = (_req, _res, next) => {
  Sentry.withIsolationScope(() => next());
};

export { Sentry };
