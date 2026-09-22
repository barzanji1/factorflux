/**
 * FMCSA Service — public interface.
 *
 * This is the only file that the rest of the application should import from.
 * It orchestrates the HTTP client and normalizer and returns a clean result
 * object that is safe to pass directly to the database layer.
 *
 * Database logic lives in authorityScheduler.ts — this module has none.
 *
 * Environment variables consumed (via client.ts):
 *   FMCSA_WEBKEY       — optional environment fallback for live lookups
 *   FMCSA_WEBKEY_KEY   — legacy environment fallback
 *   FMCSA_BASE_URL     — optional override (default: FMCSA SAFER production URL)
 *   FMCSA_TIMEOUT_MS   — per-request timeout (default: 10000)
 *   FMCSA_MAX_RETRIES  — max attempts per call (default: 3)
 */

import { fmcsaClient } from "./client";
import { normalize } from "./normalizer";
import type { FmcsaResult, FmcsaQueryOptions } from "./types";

// Re-export types so callers only need one import path
export type { FmcsaCarrier, FmcsaCheckStatus, FmcsaResult, FmcsaQueryOptions } from "./types";

// ─── Internal helpers ─────────────────────────────────────────────────────────

function noKeyResult(): FmcsaResult {
  return {
    status: "no_key",
    errorMessage: "FMCSA_WEBKEY is not configured. Set it via the admin panel or FMCSA_WEBKEY env var.",
    attempts: 0,
  };
}

function apiErrorResult(err: unknown, attempts: number): FmcsaResult {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[FMCSA Service] Unrecoverable error after ${attempts} attempt(s): ${msg}`);
  return { status: "api_error", errorMessage: msg, attempts };
}

// ─── Public service methods ───────────────────────────────────────────────────

/**
 * Look up a carrier by USDOT number.
 *
 * @param dotNumber   USDOT number (digits only or with prefix — both accepted)
 * @param opts        Optional timeout / retry overrides
 */
export async function queryByDot(
  dotNumber: string,
  opts?: FmcsaQueryOptions,
): Promise<FmcsaResult> {
  if (!(await fmcsaClient.hasKey())) return noKeyResult();

  let attempts = 0;
  try {
    const { raw, attempts: att } = await fmcsaClient.fetchByDot(dotNumber.trim(), opts);
    attempts = att;

    if (raw === null) {
      console.info(`[FMCSA Service] queryByDot(${dotNumber}) → not_found (attempts: ${att})`);
      return { status: "not_found", attempts };
    }

    const carrier = normalize(raw);
    if (!carrier) {
      console.warn(
        `[FMCSA Service] queryByDot(${dotNumber}) → not_found (malformed response, attempts: ${att})`,
      );
      return { status: "not_found", rawResponse: raw, attempts };
    }

    return { status: "success", carrier, rawResponse: raw, attempts };
  } catch (err) {
    return apiErrorResult(err, attempts);
  }
}

/**
 * Look up a carrier by MC (docket) number.
 *
 * @param mcNumber  MC number — prefix "MC-" or "MC" is stripped automatically
 * @param opts      Optional timeout / retry overrides
 */
export async function queryByMc(
  mcNumber: string,
  opts?: FmcsaQueryOptions,
): Promise<FmcsaResult> {
  if (!(await fmcsaClient.hasKey())) return noKeyResult();

  let attempts = 0;
  try {
    const { raw, attempts: att } = await fmcsaClient.fetchByMc(mcNumber, opts);
    attempts = att;

    if (raw === null) {
      console.info(`[FMCSA Service] queryByMc(${mcNumber}) → not_found (attempts: ${att})`);
      return { status: "not_found", attempts };
    }

    const carrier = normalize(raw);
    if (!carrier) {
      console.warn(
        `[FMCSA Service] queryByMc(${mcNumber}) → not_found (malformed response, attempts: ${att})`,
      );
      return { status: "not_found", rawResponse: raw, attempts };
    }

    return { status: "success", carrier, rawResponse: raw, attempts };
  } catch (err) {
    return apiErrorResult(err, attempts);
  }
}

/**
 * Look up a carrier by DOT first, then fall back to MC if the DOT lookup
 * returns not_found.  Both identifiers are optional — at least one must be
 * provided or the result will be not_found.
 *
 * This is the primary entry point used by the scheduler.
 *
 * @param dotNumber  USDOT number (nullable)
 * @param mcNumber   MC number (nullable)
 * @param opts       Optional timeout / retry overrides
 */
export async function queryEntity(
  dotNumber?: string | null,
  mcNumber?: string | null,
  opts?: FmcsaQueryOptions,
): Promise<FmcsaResult> {
  if (dotNumber?.trim()) {
    const result = await queryByDot(dotNumber.trim(), opts);
    // Only fall through to MC if DOT gave a definitive not_found
    if (result.status !== "not_found") return result;
  }

  if (mcNumber?.trim()) {
    return queryByMc(mcNumber.trim(), opts);
  }

  console.warn("[FMCSA Service] queryEntity called with no DOT or MC number");
  return {
    status: "not_found",
    errorMessage: "No DOT or MC number provided",
    attempts: 0,
  };
}
