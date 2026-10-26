import type { Breadcrumb, Event } from "@sentry/react";

// SDK v11 replaced sendDefaultPii with granular collection controls; omitted
// controls now collect data by default, so explicitly opt out at the source.
export const sentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
};

// Allow-list telemetry rather than guessing which arbitrary strings are names.
// Raw messages, user records, custom context, request data, and locals can all
// contain client/staff PII, credentials, or document contents.
export function scrubSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return {
    timestamp: breadcrumb.timestamp,
    level: breadcrumb.level,
    category: "application",
  };
}

export function scrubSentryEvent<T extends Event>(event: T): T {
  const safeTypes = new Set([
    "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError",
    "URIError", "EvalError", "AggregateError", "UnhandledRejection",
  ]);
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    environment: event.environment,
    release: event.release,
    sdk: event.sdk,
    exception: event.exception ? {
      values: event.exception.values?.map(exception => ({
        type: safeTypes.has(exception.type || "") ? exception.type : "Error",
        value: "Application error (message withheld for privacy)",
        mechanism: exception.mechanism ? {
          type: exception.mechanism.type,
          handled: exception.mechanism.handled,
        } : undefined,
        stacktrace: exception.stacktrace ? {
          frames: exception.stacktrace.frames?.map(frame => ({
            // Keep code locations, not hostnames, URL parameters, absolute
            // home directories, source context, or captured local variables.
            filename: safeCodeFilename(frame.filename),
            lineno: frame.lineno,
            colno: frame.colno,
            in_app: frame.in_app,
          })),
        } : undefined,
      })),
    } : undefined,
    breadcrumbs: event.breadcrumbs?.map(scrubSentryBreadcrumb),
  } as T;
}

function safeCodeFilename(filename?: string): string | undefined {
  const basename = filename?.split(/[?#]/)[0].split(/[\\/]/).pop();
  return basename && /^[\w.-]+\.[cm]?[jt]sx?$/.test(basename) ? basename : undefined;
}
