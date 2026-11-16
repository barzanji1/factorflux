import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import type { Announcement, AnnouncementInput, AnnouncementPage, AnnouncementView } from "@shared/announcements";
import { ANNOUNCEMENT_PAGE_SIZE } from "@shared/announcements";

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method, credentials: "include", cache: "no-store",
    ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Announcements could not be loaded or saved. Please retry.");
  }
  return response.json();
}

export function useAnnouncements(view: AnnouncementView, enabled = true) {
  const { user } = useAuth();
  return useInfiniteQuery({
    queryKey: ["/api/announcements", user?.id, user?.role, view],
    enabled: enabled && !!user?.id,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => request<AnnouncementPage>(`/api/announcements?view=${view}&offset=${pageParam}&limit=${ANNOUNCEMENT_PAGE_SIZE}`),
    getNextPageParam: page => page.nextOffset,
    staleTime: 0,
    refetchInterval: enabled ? 5000 : false,
    refetchOnWindowFocus: "always",
  });
}

export function useAnnouncement(id: number | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["/api/announcements", user?.id, user?.role, "detail", id],
    enabled: !!user?.id && id !== null,
    queryFn: () => request<Announcement>(`/api/announcements/${id}`),
    staleTime: 0, refetchInterval: 5000, retry: false,
  });
}

export type AnnouncementAction =
  | { action: "create"; input: AnnouncementInput }
  | { action: "edit"; id: number; version: number; input: AnnouncementInput }
  | { action: "delete" | "dismiss" | "approve" | "reject"; id: number; version: number; reason?: string };

export function useAnnouncementActions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (change: AnnouncementAction) => {
      if (change.action === "create") return request<Announcement>("/api/announcements", "POST", change.input);
      if (change.action === "edit") return request<Announcement>(`/api/announcements/${change.id}`, "PATCH", { ...change.input, version: change.version });
      const { action, id, version, reason } = change;
      return request<Announcement | { success: true }>(`/api/announcements/${id}${action === "delete" ? "" : `/${action}`}`,
        action === "delete" ? "DELETE" : "POST", { version, ...(reason === undefined ? {} : { reason }) });
    },
    onSuccess: async (_result, change) => {
      const refreshes = [queryClient.invalidateQueries({ queryKey: ["/api/announcements"] })];
      if (change.action === "reject") refreshes.push(
        queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] }),
      );
      await Promise.all(refreshes);
    },
    onError: () => { void queryClient.invalidateQueries({ queryKey: ["/api/announcements"] }); },
  });
}
