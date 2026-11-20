import { useQuery } from "@tanstack/react-query";
import type {
  BrokerPortalDocument,
  BrokerPortalInvoiceDetail,
  BrokerPortalInvoicePage,
  BrokerPortalNotesPage,
  BrokerPortalSession,
} from "../../../../shared/broker-portal";

export const brokerKeys = {
  session: ["broker-portal", "session"] as const,
  invoices: (status: string, page: number) => ["broker-portal", "invoices", status, page] as const,
  detail: (id: string) => ["broker-portal", "invoice", id] as const,
  documents: (id: string) => ["broker-portal", "documents", id] as const,
  notes: (id: string, page: number) => ["broker-portal", "notes", id, page] as const,
};

export class BrokerPortalError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "BrokerPortalError";
    this.status = status;
    this.payload = payload;
  }
}

export async function brokerRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...options, headers, credentials: "include" });
  const contentType = response.headers.get("content-type") || "";
  let payload: unknown = null;
  if (response.status !== 204) {
    payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");
  }
  if (!response.ok) {
    const publicAuthRequest = /^\/api\/broker\/(register|verify|login|magic-link)(\/|$)/.test(path) || path === "/api/broker/me";
    if (response.status === 401 && !publicAuthRequest && typeof window !== "undefined") {
      window.dispatchEvent(new Event("broker-session-expired"));
    }
    const value = payload as { message?: string; error?: string } | null;
    const message = value?.message || value?.error || (typeof payload === "string" && payload) ||
      (response.status === 409 ? "This invoice was already answered. The latest status has been refreshed." : "We couldn't complete that request. Please try again.");
    throw new BrokerPortalError(message, response.status, payload);
  }
  return payload as T;
}

export function brokerJson(method: string, value?: unknown, csrfToken?: string): RequestInit {
  const headers: Record<string, string> = {};
  if (csrfToken) headers["X-Broker-CSRF"] = csrfToken;
  return { method, headers, body: value === undefined ? undefined : JSON.stringify(value) };
}

export function useBrokerSession(enabled = true) {
  return useQuery<BrokerPortalSession>({
    queryKey: brokerKeys.session,
    queryFn: () => brokerRequest<BrokerPortalSession>("/api/broker/me"),
    enabled,
    retry: false,
    staleTime: 0,
  });
}

const visiblePoll = () => typeof document === "undefined" || document.visibilityState === "visible" ? 20_000 : false;

export function useBrokerInvoices(status: string, page: number, enabled: boolean) {
  return useQuery<BrokerPortalInvoicePage>({
    queryKey: brokerKeys.invoices(status, page),
    queryFn: () => brokerRequest<BrokerPortalInvoicePage>(`/api/broker/invoices?status=${encodeURIComponent(status)}&page=${page}`),
    enabled,
    refetchInterval: visiblePoll,
    refetchOnWindowFocus: true,
  });
}

export function useBrokerInvoice(id: string, enabled: boolean) {
  return useQuery<BrokerPortalInvoiceDetail>({
    queryKey: brokerKeys.detail(id),
    queryFn: () => brokerRequest<BrokerPortalInvoiceDetail>(`/api/broker/invoices/${encodeURIComponent(id)}`),
    enabled: enabled && !!id,
    refetchInterval: visiblePoll,
    refetchOnWindowFocus: true,
  });
}

export function useBrokerDocuments(id: string, enabled: boolean) {
  return useQuery<{ documents: BrokerPortalDocument[] }>({
    queryKey: brokerKeys.documents(id),
    queryFn: () => brokerRequest<{ documents: BrokerPortalDocument[] }>(`/api/broker/invoices/${encodeURIComponent(id)}/documents`),
    enabled: enabled && !!id,
    refetchInterval: visiblePoll,
    refetchOnWindowFocus: true,
  });
}

export function useBrokerNotes(id: string, page: number, enabled: boolean) {
  return useQuery<BrokerPortalNotesPage>({
    queryKey: brokerKeys.notes(id, page),
    queryFn: () => brokerRequest<BrokerPortalNotesPage>(`/api/broker/invoices/${encodeURIComponent(id)}/notes?page=${page}`),
    enabled: enabled && !!id,
    refetchInterval: visiblePoll,
    refetchOnWindowFocus: true,
  });
}
