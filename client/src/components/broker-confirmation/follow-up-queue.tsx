import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { RecoveryButton as Button, RecoveryCard as Card, RecoveryBadge } from "@/components/recovery/recovery-controls";
import type { ConfirmationStatus } from "./confirmation-status";
import { AlertCircle, ArrowRight, RefreshCw } from "lucide-react";

interface QueueItem {
  id: number; invoiceId: number; invoiceNumber: string; brokerName: string; title: string; description: string;
  priority: "high" | "urgent"; status: "todo" | "in_progress" | "completed"; dueDate: string;
  assignedTo: string | null; agentName: string | null; kind: string; confirmationStatus: ConfirmationStatus;
}
export default function ConfirmationFollowUpQueue() {
  const qc = useQueryClient();
  const query = useQuery<QueueItem[]>({
    queryKey: ["/api/confirmation-follow-ups"],
    queryFn: async () => (await apiRequest("GET", "/api/confirmation-follow-ups")).json(),
  });
  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: QueueItem["status"] }) => apiRequest("PATCH", `/api/confirmation-follow-ups/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/confirmation-follow-ups"] }),
  });
  const items = query.data ?? [];
  return <Card data-testid="confirmation-followups" className="overflow-hidden rounded-sm border-2 border-[#808080] border-r-[#404040] border-b-[#404040] bg-[#f4f4f4]">
    <div className="flex flex-wrap items-center gap-3 border-b-2 border-[#808080] bg-[#d4d0c8] px-4 py-3">
      <AlertCircle className="h-4 w-4 text-[#087f8c]" /><h2 className="font-bold text-[#222]">Broker receipt follow-ups</h2>
      {query.data && <span className="ml-auto text-xs text-[#555]">{items.filter(i => i.status !== "completed").length} open</span>}
      <Button data-testid="confirmation-followups-retry" size="sm" variant="outline" className="h-7 px-2" onClick={() => query.refetch()}><RefreshCw className="mr-1 h-3 w-3" />Refresh</Button>
    </div>
    {query.isLoading ? <div className="space-y-2 p-4">{[1, 2, 3].map(n => <div key={n} className="h-14 animate-pulse bg-[#e5e2da]" />)}</div>
      : query.error ? <div className="p-4 text-sm text-red-700" role="alert">{(query.error as Error).message}<Button size="sm" className="ml-2" onClick={() => query.refetch()}>Retry</Button></div>
      : !items.length ? <div className="p-6 text-center text-sm text-[#666]">No broker receipt follow-ups are currently queued.</div>
      : <div className="divide-y divide-[#c5c1b8]">{items.map(item => <article key={item.id} data-testid="confirmation-followup-row" className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/invoices/${item.invoiceId}`} data-testid="confirmation-followup-invoice" className="font-bold text-[#087f8c] underline">{item.invoiceNumber} <ArrowRight className="inline h-3 w-3" /></Link>
            <span className="text-xs text-[#555]">{item.brokerName}</span>
          <RecoveryBadge tone={item.priority === "urgent" ? "warning" : "accent"} className="px-2 py-1 text-[10px] uppercase">{item.priority}</RecoveryBadge>
            <RecoveryBadge data-testid={`confirmation-status-${item.confirmationStatus}`} tone={item.confirmationStatus === "confirmed" ? "success" : item.confirmationStatus === "sent" ? "accent" : item.confirmationStatus === "disputed" ? "warning" : "neutral"} className="px-2 py-1 text-[10px] uppercase">{item.confirmationStatus}</RecoveryBadge>
          </div>
          <p className="mt-1 text-sm font-semibold text-[#222]">{item.title}</p>
          {item.description && <p className="text-xs text-[#666]">{item.description}</p>}
          <p className="mt-1 text-[11px] text-[#555]">Assigned: {item.agentName || "Unassigned"} · Due {new Date(item.dueDate).toLocaleDateString()}</p>
        </div>
        <label className="text-xs font-bold text-[#555]">Task status
          <select data-testid="confirmation-followup-status" value={item.status} disabled={mutation.isPending} onChange={e => mutation.mutate({ id: item.id, status: e.target.value as QueueItem["status"] })} className="recovery-neu-select mt-1 block h-9 rounded-xl px-2">
            <option value="todo">To do</option><option value="in_progress">In progress</option><option value="completed">Completed</option>
          </select>
        </label>
      </article>)}</div>}
    {mutation.error && <p role="alert" className="border-t border-red-300 bg-red-50 p-2 text-xs text-red-800">{(mutation.error as Error).message}</p>}
  </Card>;
}
