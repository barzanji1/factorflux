/**
 * FMCSA SAFER API wrapper.
 *
 * Official endpoints:
 *   By DOT:  https://mobile.fmcsa.dot.gov/qc/services/carriers/{DOT}?webKey={KEY}
 *   By MC:   https://mobile.fmcsa.dot.gov/qc/services/carriers/docket-number/{MC}?webKey={KEY}
 *
 * Requires FMCSA_WEBKEY environment variable.
 * When the key is absent the service returns a synthetic "no_key" result so the
 * rest of the system still works and the UI can prompt admins to configure it.
 */

export interface FmcsaCarrier {
  dotNumber?: string;
  legalName?: string;
  dbaName?: string;
  allowedToOperate?: "Y" | "N";
  operatingStatus?: string;
  commonAuthorityStatus?: string;
  contractAuthorityStatus?: string;
  brokerAuthorityStatus?: string;
  carrierOperation?: string;
  // Insurance fields
  bipdRequired?: string;
  bipdInsuranceOnFile?: string;
  cargoInsuranceRequired?: string;
  cargoInsuranceOnFile?: string;
  // Broker bond / trust
  brokerBondStatus?: string;
  bondAmount?: string;
}

export type FmcsaCheckStatus = "success" | "not_found" | "api_error" | "no_key";

export interface FmcsaResult {
  status: FmcsaCheckStatus;
  carrier?: FmcsaCarrier;
  errorMessage?: string;
  rawResponse?: unknown;
}

const BASE = "https://mobile.fmcsa.dot.gov/qc/services";

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function parseBrokerBond(c: Record<string, unknown>): { status: string; amount: string } {
  // FMCSA returns broker bond info in various shapes; handle the most common ones
  const bond =
    (c.brokerBipd as Record<string, unknown> | undefined) ??
    (c.brokerBond as Record<string, unknown> | undefined) ??
    (c.bipd as Record<string, unknown> | undefined);

  if (bond && typeof bond === "object") {
    const statusCode = str(bond.bipdRequired ?? bond.bondStatus ?? bond.status);
    const amount = str(bond.bipdInsuranceOnFile ?? bond.bondAmount ?? bond.amount ?? "");
    return { status: statusCode, amount };
  }

  // Flat fields on the carrier object
  return {
    status: str(c.brokerBondStatus ?? c.bondStatus ?? ""),
    amount: str(c.bondAmount ?? ""),
  };
}

function parseCarrier(data: unknown): FmcsaCarrier | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;

  const content = Array.isArray(d.content) ? d.content[0] : undefined;
  const carrier = content?.carrier ?? d.carrier ?? content;
  if (!carrier || typeof carrier !== "object") return undefined;

  const c = carrier as Record<string, unknown>;
  const { status: brokerBondStatus, amount: bondAmount } = parseBrokerBond(c);

  return {
    dotNumber: str(c.dotNumber ?? c.dot_number),
    legalName: str(c.legalName ?? c.legal_name),
    dbaName: str(c.dbaName ?? c.dba_name),
    allowedToOperate: (c.allowedToOperate ?? c.allowed_to_operate) as "Y" | "N" | undefined,
    operatingStatus: str(c.operatingStatus),
    commonAuthorityStatus: str(c.commonAuthorityStatus),
    contractAuthorityStatus: str(c.contractAuthorityStatus),
    brokerAuthorityStatus: str(c.brokerAuthorityStatus),
    carrierOperation:
      typeof c.carrierOperation === "object" && c.carrierOperation !== null
        ? str((c.carrierOperation as Record<string, unknown>).carrierOperationCode)
        : str(c.carrierOperation),
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

export async function queryByDot(dotNumber: string): Promise<FmcsaResult> {
  const webKey = process.env.FMCSA_WEBKEY;
  if (!webKey) {
    return { status: "no_key", errorMessage: "FMCSA_WEBKEY not configured" };
  }
  try {
    const url = `${BASE}/carriers/${encodeURIComponent(dotNumber)}?webKey=${webKey}`;
    const raw = await fetchJson(url);
    if (raw === null) return { status: "not_found" };
    const carrier = parseCarrier(raw);
    if (!carrier) return { status: "not_found", rawResponse: raw };
    return { status: "success", carrier, rawResponse: raw };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "api_error", errorMessage: msg };
  }
}

export async function queryByMc(mcNumber: string): Promise<FmcsaResult> {
  const webKey = process.env.FMCSA_WEBKEY;
  if (!webKey) {
    return { status: "no_key", errorMessage: "FMCSA_WEBKEY not configured" };
  }
  const mc = mcNumber.replace(/^MC-?/i, "");
  try {
    const url = `${BASE}/carriers/docket-number/${encodeURIComponent(mc)}?webKey=${webKey}`;
    const raw = await fetchJson(url);
    if (raw === null) return { status: "not_found" };
    const carrier = parseCarrier(raw);
    if (!carrier) return { status: "not_found", rawResponse: raw };
    return { status: "success", carrier, rawResponse: raw };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "api_error", errorMessage: msg };
  }
}

/** Try DOT first, fall back to MC. */
export async function queryEntity(
  dotNumber?: string | null,
  mcNumber?: string | null,
): Promise<FmcsaResult> {
  if (dotNumber && dotNumber.trim()) {
    const r = await queryByDot(dotNumber.trim());
    if (r.status !== "not_found") return r;
  }
  if (mcNumber && mcNumber.trim()) {
    return queryByMc(mcNumber.trim());
  }
  return { status: "not_found", errorMessage: "No DOT or MC number available" };
}
