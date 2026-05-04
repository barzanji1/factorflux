/**
 * FMCSA SAFER API wrapper.
 *
 * Official endpoint: https://mobile.fmcsa.dot.gov/qc/services/carriers/{DOT}?webKey={KEY}
 * Docket (MC) lookup: https://mobile.fmcsa.dot.gov/qc/services/carriers/docket-number/{MC}?webKey={KEY}
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
  bipdRequired?: string;
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

function parseCarrier(data: unknown): FmcsaCarrier | undefined {
  if (!data || typeof data !== "object") return undefined;
  const d = data as Record<string, unknown>;

  const content = Array.isArray(d.content) ? d.content[0] : undefined;
  const carrier = content?.carrier ?? d.carrier ?? content;
  if (!carrier || typeof carrier !== "object") return undefined;

  const c = carrier as Record<string, unknown>;
  return {
    dotNumber: String(c.dotNumber ?? c.dot_number ?? ""),
    legalName: String(c.legalName ?? c.legal_name ?? ""),
    dbaName: String(c.dbaName ?? c.dba_name ?? ""),
    allowedToOperate: (c.allowedToOperate ?? c.allowed_to_operate) as "Y" | "N" | undefined,
    operatingStatus: String(c.operatingStatus ?? ""),
    commonAuthorityStatus: String(c.commonAuthorityStatus ?? ""),
    contractAuthorityStatus: String(c.contractAuthorityStatus ?? ""),
    brokerAuthorityStatus: String(c.brokerAuthorityStatus ?? ""),
    carrierOperation:
      typeof c.carrierOperation === "object" && c.carrierOperation !== null
        ? String((c.carrierOperation as Record<string, unknown>).carrierOperationCode ?? "")
        : String(c.carrierOperation ?? ""),
    bipdRequired: String(c.bipdInsuranceRequired ?? c.bipdRequired ?? ""),
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
export async function queryEntity(dotNumber?: string | null, mcNumber?: string | null): Promise<FmcsaResult> {
  if (dotNumber && dotNumber.trim()) {
    const r = await queryByDot(dotNumber.trim());
    if (r.status !== "not_found") return r;
  }
  if (mcNumber && mcNumber.trim()) {
    return queryByMc(mcNumber.trim());
  }
  return { status: "not_found", errorMessage: "No DOT or MC number available" };
}
