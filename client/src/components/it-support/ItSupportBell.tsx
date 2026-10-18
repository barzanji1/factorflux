import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type UnreadCount = { count: number; mode: "triage" | "updates" };

async function getUnreadCount(): Promise<UnreadCount> {
  const response = await fetch("/api/it-support/unread-count", { credentials: "include" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Unable to load IT support alerts");
  return payload;
}

export default function ItSupportBell() {
  const { user } = useAuth();
  const { data } = useQuery<UnreadCount>({
    queryKey: ["/api/it-support", "unread-count", user?.id],
    queryFn: getUnreadCount,
    enabled: !!user?.id,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 12000,
    retry: false,
  });
  const count = data?.count ?? 0;
  if (!count) return null;
  return (
    <span
      className="ml-auto inline-flex items-center gap-1 rounded-sm border border-[#9d554d] bg-[#f4dfdb] px-1.5 py-0.5 text-[10px] font-bold text-[#812f25]"
      title={`${count} ${data?.mode === "triage" ? "requests awaiting triage" : "unread request updates"}`}
      aria-label={`${count} unread IT support ${data?.mode === "triage" ? "requests" : "updates"}`}
    >
      <Bell className="h-3 w-3" />
      {count > 99 ? "99+" : count}
    </span>
  );
}
