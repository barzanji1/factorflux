/**
 * FMCSA response normalizer.
 *
 * Converts the raw, inconsistently-shaped FMCSA API payload into the
 * canonical FmcsaCarrier shape used throughout the application.
 *
 * This module has zero I/O — it is a pure transformation function.
 */

import type { FmcsaCarrier } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Coerce any value to a non-empty string, or return undefined. */
function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

/** Extract a nested object field safely. */
function obj(v: unknown): Record<string, unknown> | undefined {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return undefined;
}

// ─── Bond / trust parsing ─────────────────────────────────────────────────────

/**
 * FMCSA returns broker bond data in several different shapes depending on the
 * endpoint version.  Try each known location in priority order.
 */
function parseBrokerBond(c: Record<string, unknown>): {
  brokerBondStatus?: string;
  bondAmount?: string;
} {
  // Nested object variants
  const bondObj =
    obj(c.brokerBipd) ??
    obj(c.brokerBond) ??
    obj(c.bipd) ??
    obj(c.bondInfo);

  if (bondObj) {
    return {
      brokerBondStatus: str(bondObj.bipdRequired ?? bondObj.bondStatus ?? bondObj.status),
      bondAmount: str(bondObj.bipdInsuranceOnFile ?? bondObj.bondAmount ?? bondObj.amount),
    };
  }

  // Flat fields directly on carrier
  return {
    brokerBondStatus: str(c.brokerBondStatus ?? c.bondStatus),
    bondAmount: str(c.bondAmount),
  };
}

// ─── Carrier operation parsing ────────────────────────────────────────────────

function parseCarrierOperation(raw: unknown): string | undefined {
  if (!raw) return undefined;
  // May be an object with a code field
  const o = obj(raw);
  if (o) return str(o.carrierOperationCode ?? o.code ?? o.description);
  return str(raw);
}

// ─── Root extractor ───────────────────────────────────────────────────────────

/**
 * Locate the carrier object within the raw API payload.
 * FMCSA wraps results differently across endpoint versions:
 *   { content: [{ carrier: {...} }] }
 *   { carrier: {...} }
 *   { data: { carrier: {...} } }
 */
function extractCarrierObject(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;

  // content[0].carrier
  if (Array.isArray(d.content) && d.content.length > 0) {
    const first = obj(d.content[0]);
    if (first) {
      const nested = obj(first.carrier);
      if (nested) return nested;
      // content[0] is the carrier itself
      if (first.dotNumber || first.legalName) return first;
    }
  }

  // data.carrier
  const dataBlock = obj(d.data);
  if (dataBlock) {
    const nested = obj(dataBlock.carrier);
    if (nested) return nested;
  }

  // top-level carrier key
  const topCarrier = obj(d.carrier);
  if (topCarrier) return topCarrier;

  // root object is the carrier itself
  if (d.dotNumber || d.legalName || d.allowedToOperate) return d;

  return undefined;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalize a raw FMCSA API payload into a FmcsaCarrier.
 * Returns null if the payload is empty, malformed, or clearly a non-carrier response.
 */
export function normalize(raw: unknown): FmcsaCarrier | null {
  const c = extractCarrierObject(raw);
  if (!c) return null;

  // Require at least one identity field — guard against empty wrapper objects
  const hasIdentity =
    str(c.dotNumber ?? c.dot_number) ||
    str(c.legalName ?? c.legal_name) ||
    str(c.allowedToOperate ?? c.allowed_to_operate);
  if (!hasIdentity) return null;

  const { brokerBondStatus, bondAmount } = parseBrokerBond(c);

  return {
    dotNumber: str(c.dotNumber ?? c.dot_number),
    legalName: str(c.legalName ?? c.legal_name),
    dbaName: str(c.dbaName ?? c.dba_name),
    allowedToOperate: (c.allowedToOperate ?? c.allowed_to_operate) as "Y" | "N" | undefined,
    operatingStatus: str(c.operatingStatus),
    commonAuthorityStatus: str(c.commonAuthorityStatus),
    contractAuthorityStatus: str(c.contractAuthorityStatus),
    brokerAuthorityStatus: str(c.brokerAuthorityStatus),
    carrierOperation: parseCarrierOperation(c.carrierOperation),
    // Insurance
    bipdRequired: str(c.bipdInsuranceRequired ?? c.bipdRequired),
    bipdInsuranceOnFile: str(c.bipdInsuranceOnFile),
    cargoInsuranceRequired: str(c.cargoInsuranceRequired),
    cargoInsuranceOnFile: str(c.cargoInsuranceOnFile),
    // Bond
    brokerBondStatus,
    bondAmount,
  };
}
