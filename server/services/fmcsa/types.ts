/**
 * Shared types for the FMCSA service layer.
 * These are pure data contracts — no I/O, no DB references.
 */

// ─── Query options ────────────────────────────────────────────────────────────

export interface FmcsaQueryOptions {
  /** Request timeout in milliseconds. Default: 15 000 */
  timeoutMs?: number;
  /** Maximum number of attempts (1 = no retry). Default: 3 */
  maxRetries?: number;
}

// ─── Normalized carrier data ──────────────────────────────────────────────────

export interface FmcsaCarrier {
  dotNumber?: string;
  legalName?: string;
  dbaName?: string;
  /** "Y" = allowed, "N" = not allowed */
  allowedToOperate?: "Y" | "N";
  operatingStatus?: string;
  commonAuthorityStatus?: string;
  contractAuthorityStatus?: string;
  brokerAuthorityStatus?: string;
  carrierOperation?: string;
  safetyRating?: string;
  // Insurance
  bipdRequired?: string;
  bipdInsuranceOnFile?: string;
  cargoInsuranceRequired?: string;
  cargoInsuranceOnFile?: string;
  // Broker bond / trust
  brokerBondStatus?: string;
  bondAmount?: string;
}

// ─── Service result ───────────────────────────────────────────────────────────

/**
 * Every service method returns this shape.
 *
 * - "success"   — carrier found and normalized successfully
 * - "not_found" — FMCSA returned 404 or an empty carrier record
 * - "api_error" — HTTP error, timeout, or parse failure
 * - "no_key"    — FMCSA_WEBKEY is not configured
 */
export type FmcsaCheckStatus = "success" | "not_found" | "api_error" | "no_key";

export interface FmcsaResult {
  status: FmcsaCheckStatus;
  carrier?: FmcsaCarrier;
  errorMessage?: string;
  /** Raw FMCSA API payload — preserved for audit storage */
  rawResponse?: unknown;
  /** Number of HTTP attempts made (useful for debugging flaky calls) */
  attempts: number;
}
