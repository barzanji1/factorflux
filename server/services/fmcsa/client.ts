/**
 * FMCSA HTTP API client.
 *
 * Responsibilities:
 *   - Read config from environment variables (no hardcoded secrets)
 *   - Make authenticated HTTP requests to the FMCSA SAFER REST API
 *   - Retry transient failures with exponential back-off
 *   - Enforce per-request timeouts
 *   - Log every failure with structured context
 *
 * This module does NOT normalise responses and has NO database access.
 * It returns the raw API payload so callers can store it for audit.
 */

import type { FmcsaQueryOptions } from "./types";
import { getConfiguredFmcsaWebKey } from "./settings";

// ─── Config ───────────────────────────────────────────────────────────────────

interface FmcsaClientConfig {
  /** Base URL — override with FMCSA_BASE_URL for testing */
  baseUrl: string;
  /** Default request timeout in ms */
  defaultTimeoutMs: number;
  /** Default max attempts (1 = no retry) */
  defaultMaxRetries: number;
}

function loadConfig(): FmcsaClientConfig {
  return {
    baseUrl:
      process.env.FMCSA_BASE_URL?.replace(/\/$/, "") ??
      "https://mobile.fmcsa.dot.gov/qc/services",
    defaultTimeoutMs: parseInt(process.env.FMCSA_TIMEOUT_MS ?? "15000", 10),
    defaultMaxRetries: parseInt(process.env.FMCSA_MAX_RETRIES ?? "3", 10),
  };
}

// ─── Error classification ─────────────────────────────────────────────────────

/** Returns true for errors worth retrying (network/5xx), false for definitive failures. */
function isTransient(err: unknown): boolean {
  if (err instanceof Error) {
    // Timeout or network-level failures
    if (err.name === "TimeoutError" || err.name === "AbortError") return true;
    if (err.message.includes("fetch failed") || err.message.includes("ECONNRESET")) return true;
  }
  if (err instanceof HttpError) return err.status >= 500;
  return false;
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string,
  ) {
    super(`HTTP ${status} ${statusText}`);
    this.name = "HttpError";
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────────

interface LogContext {
  method: string;
  identifier: string;
  attempt: number;
  maxRetries: number;
  error: string;
}

function logFailure(ctx: LogContext): void {
  console.error(
    `[FMCSA Client] ${ctx.method}(${ctx.identifier}) attempt ${ctx.attempt}/${ctx.maxRetries} failed — ${ctx.error}`,
  );
}

function logGiveUp(ctx: Omit<LogContext, "attempt">): void {
  console.error(
    `[FMCSA Client] ${ctx.method}(${ctx.identifier}) giving up after ${ctx.maxRetries} attempt(s) — ${ctx.error}`,
  );
}

// ─── HTTP fetch with timeout ──────────────────────────────────────────────────

async function fetchRaw(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (res.status === 404) return null; // Not found — valid empty result, do not retry
  if (!res.ok) throw new HttpError(res.status, res.statusText, url);
  return res.json();
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────

const BACKOFF_MS = [0, 1_000, 2_000, 4_000]; // delay before attempt N (0-indexed)

interface FetchResult {
  raw: unknown;
  attempts: number;
}

async function fetchWithRetry(
  urlFactory: () => string,
  method: string,
  identifier: string,
  opts: Required<FmcsaQueryOptions>,
): Promise<FetchResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
    // Exponential back-off (skip on first attempt)
    if (attempt > 1) {
      const delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const raw = await fetchRaw(urlFactory(), opts.timeoutMs);
      return { raw, attempts: attempt };
    } catch (err) {
      lastError = err;
      const errMsg = err instanceof Error ? err.message : String(err);

      logFailure({ method, identifier, attempt, maxRetries: opts.maxRetries, error: errMsg });

      // Do not retry on definitive failures (4xx that aren't 404, etc.)
      if (!isTransient(err)) break;
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
  logGiveUp({ method, identifier, maxRetries: opts.maxRetries, error: errMsg });
  throw lastError;
}

// ─── Client class ─────────────────────────────────────────────────────────────

export class FmcsaHttpClient {
  private readonly config = loadConfig();

  async hasKey(): Promise<boolean> {
    return !!(await getConfiguredFmcsaWebKey());
  }

  private resolveOptions(opts?: FmcsaQueryOptions): Required<FmcsaQueryOptions> {
    return {
      timeoutMs: opts?.timeoutMs ?? this.config.defaultTimeoutMs,
      maxRetries: opts?.maxRetries ?? this.config.defaultMaxRetries,
    };
  }

  /**
   * Fetch carrier data by USDOT number.
   * Returns { raw, attempts } on success; throws on exhausted retries.
   */
  async fetchByDot(dotNumber: string, opts?: FmcsaQueryOptions): Promise<FetchResult> {
    const resolved = this.resolveOptions(opts);
    const webKey = await getConfiguredFmcsaWebKey();
    if (!webKey) throw new Error("FMCSA Web Key is not configured");
    const { baseUrl } = this.config;

    return fetchWithRetry(
      () => `${baseUrl}/carriers/${encodeURIComponent(dotNumber)}?webKey=${webKey}`,
      "fetchByDot",
      dotNumber,
      resolved,
    );
  }

  /**
   * Fetch carrier data by MC (docket) number.
   * Strips leading "MC-" or "MC" prefix before sending.
   * Returns { raw, attempts } on success; throws on exhausted retries.
   */
  async fetchByMc(mcNumber: string, opts?: FmcsaQueryOptions): Promise<FetchResult> {
    const resolved = this.resolveOptions(opts);
    const webKey = await getConfiguredFmcsaWebKey();
    if (!webKey) throw new Error("FMCSA Web Key is not configured");
    const { baseUrl } = this.config;
    const mc = mcNumber.replace(/^MC-?/i, "").trim();

    return fetchWithRetry(
      () => `${baseUrl}/carriers/docket-number/${encodeURIComponent(mc)}?webKey=${webKey}`,
      "fetchByMc",
      mc,
      resolved,
    );
  }
}

/** Singleton client instance; the persisted web key is resolved for every request. */
export const fmcsaClient = new FmcsaHttpClient();
