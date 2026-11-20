import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  BrokerActivityBrokerOptions,
  BrokerActivityFilters,
  BrokerActivityPage,
  BrokerActivityStats,
  BrokerNotificationPreferences,
  BrokerResponseReport,
} from "@shared/broker-activity";

function paramsFor(filters: BrokerActivityFilters, includePage: boolean) {
  const params = new URLSearchParams();
  if (filters.brokerId !== undefined) params.set("brokerId", String(filters.brokerId));
  if (filters.status && filters.status !== "all") params.set("status", filters.status);
  if (filters.method && filters.method !== "all") params.set("method", filters.method);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.timeZone) params.set("timeZone", filters.timeZone);
  if (includePage && filters.page) params.set("page", String(filters.page));
  return params.toString();
}

export function useBrokerActivity(filters: BrokerActivityFilters, enabled = true) {
  const query = paramsFor(filters, true);
  const url = `/api/internal/broker-activity${query ? `?${query}` : ""}`;
  return useQuery<BrokerActivityPage>({
    queryKey: [url],
    enabled,
    placeholderData: (previous) => previous,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
}

export function useBrokerActivityStats(filters: BrokerActivityFilters, enabled = true) {
  const query = paramsFor({ ...filters, status: "all" }, false);
  const url = `/api/internal/broker-activity/stats${query ? `?${query}` : ""}`;
  return useQuery<BrokerActivityStats>({
    queryKey: [url],
    enabled,
    placeholderData: (previous) => previous,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
}

export function useBrokerResponseReport(filters: BrokerActivityFilters, enabled = true) {
  const query = paramsFor(filters, true);
  const url = `/api/internal/broker-activity/report${query ? `?${query}` : ""}`;
  return useQuery<BrokerResponseReport>({
    queryKey: [url],
    enabled,
    placeholderData: (previous) => previous,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
}

export function useBrokerOptions(search: string, page: number, enabled: boolean) {
  const params = new URLSearchParams({ page: String(page) });
  if (search.trim()) params.set("search", search.trim());
  const url = `/api/internal/broker-activity/brokers?${params.toString()}`;
  return useQuery<BrokerActivityBrokerOptions>({
    queryKey: [url],
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useBrokerActivityCsv() {
  return useMutation({
    mutationFn: async (filters: BrokerActivityFilters) => {
      const query = paramsFor(filters, false);
      const response = await apiRequest(
        "GET",
        `/api/internal/broker-activity/report/csv${query ? `?${query}` : ""}`,
      );
      return response.blob();
    },
  });
}

export function useBrokerNotificationPreferences(enabled: boolean) {
  return useQuery<BrokerNotificationPreferences>({
    queryKey: ["/api/internal/settings/broker-notifications"],
    enabled,
  });
}

export function useSaveBrokerNotificationPreferences() {
  return useMutation({
    mutationFn: async (preferences: BrokerNotificationPreferences) => {
      const response = await apiRequest(
        "PUT",
        "/api/internal/settings/broker-notifications",
        { inApp: preferences.inApp, email: preferences.email },
      );
      const text = await response.text();
      return text
        ? JSON.parse(text) as BrokerNotificationPreferences
        : preferences;
    },
  });
}
