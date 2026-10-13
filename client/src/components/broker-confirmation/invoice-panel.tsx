import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { confirmationRequest } from "./api";
import { Win95Button as Button, Win95Card as Card } from "@/components/win95";
import { ConfirmationStatusBadge, type ConfirmationStatus } from "./confirmation-status";
import { AlertTriangle, CheckCircle2, Clock3, Mail, RefreshCw, UserRound } from "lucide-react";

interface EventRow { id: number; event: string; actor: string; notes: string | null; createdAt: string }
interface Confirmation {
  invoiceId: number; status: ConfirmationStatus; sentAt: string | null; confirmedAt: string | null;
  remindedCount: number; assignedAgentId: string | null; assignedAgentName: string | null;
  emailOnFile: boolean; deliveryNotice?: string | null; canReassign: boolean; canResend: boolean; canMarkConfirmed: boolean; events: EventRow[];
}
interface Agent { id: string; name: string }

export default function BrokerConfirmationPanel({ invoiceId, isManager }: { invoiceId: number; isManager: boolean }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [agentId, setAgentId] = useState<string | null>(null);
  const queryKey = ["/api/invoices", invoiceId, "broker-confirmation"];
  const query = useQuery<Confirmation>({
    queryKey,
    queryFn: () => confirmationRequest<Confirmation>("GET", `/api/invoices/${invoiceId}/broker-confirmation`),
    enabled: Number.isFinite(invoiceId),
  });
  const agents = useQuery<Agent[]>({
    queryKey: ["/api/invoices", invoiceId, "broker-confirmation", "agents"],
    queryFn: () => confirmationRequest<Agent[]>("GET", `/api/invoices/${invoiceId}/broker-confirmation/agents`),
    enabled: isManager && !!query.data?.canReassign,
  });
  const refresh = () => qc.invalidateQueries({ queryKey });
  const resend = useMutation({
    mutationFn: () => confirmationRequest("POST", `/api/invoices/${invoiceId}/broker-confirmation/resend`, {}),
    onSuccess: refresh,
  });
  const markConfirmed = useMutation({
    mutationFn: () => confirmationRequest("POST", `/api/invoices/${invoiceId}/broker-confirmation/mark-confirmed`, { notes: notes.trim() }),
    onSuccess: () => { setNotes(""); refresh(); },
  });
  const assign = useMutation({
    mutationFn: () => confirmationRequest("PATCH", `/api/invoices/${invoiceId}/broker-confirmation/assignment`, { agentId: agentId ?? query.data?.assignedAgentId ?? "" }),
    onSuccess: () => { setAgentId(null); refresh(); },
  });
  const error = [query.error, resend.error, markConfirmed.error, assign.error, agents.error].find(Boolean) as Error | undefined;

  if (query.isLoading) return <Card data-testid="broker-confirmation-loading" className="border-2 border-[#808080] bg-[#f4f4f4] p-5"><div className="h-5 w-48 animate-pulse bg-[#d4d0c8]" /><div className="mt-4 h-16 animate-pulse bg-[#e5e2da]" /></Card>;

  return (
    <Card data-testid="broker-confirmation-panel" className="overflow-hidden rounded-sm border-2 border-[#808080] border-r-[#404040] border-b-[#404040] bg-[#f4f4f4] shadow-[2px_2px_0_#808080]">
      <div className="flex flex-wrap items-center gap-3 border-b-2 border-[#808080] bg-[#d4d0c8] px-4 py-3">
        <Mail className="h-4 w-4 text-[#087f8c]" />
        <h2 className="font-bold text-[#222]">Broker invoice receipt</h2>
        {query.data && <ConfirmationStatusBadge status={query.data.status} />}
        <Button data-testid="confirmation-retry" size="sm" variant="outline" className="ml-auto h-7 px-2" onClick={() => query.refetch()}>
          <RefreshCw className="mr-1 h-3 w-3" />Refresh
        </Button>
      </div>
      {!query.data ? (
        <div className="p-4 text-sm text-[#8a3028]" role="alert">{query.error?.message || "Broker confirmation is unavailable."}
          <Button size="sm" variant="outline" className="ml-2" onClick={() => query.refetch()}>Retry</Button>
        </div>
      ) : (
        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="border-2 border-l-[#808080] border-t-[#808080] border-r-white border-b-white bg-white p-3">
                <p className="text-[#666]">Broker email</p><p className="mt-1 font-bold text-[#222]">{query.data.emailOnFile ? "On file" : "Missing"}</p>
              </div>
              <div className="border-2 border-l-[#808080] border-t-[#808080] border-r-white border-b-white bg-white p-3">
                <p className="text-[#666]">Reminders recorded</p><p className="mt-1 font-bold text-[#222]">{query.data.remindedCount}</p>
              </div>
              <div className="border-2 border-l-[#808080] border-t-[#808080] border-r-white border-b-white bg-white p-3">
                <p className="text-[#666]">Last sent</p><p className="mt-1 font-bold text-[#222]">{query.data.sentAt ? new Date(query.data.sentAt).toLocaleString() : "Not sent"}</p>
              </div>
              <div className="border-2 border-l-[#808080] border-t-[#808080] border-r-white border-b-white bg-white p-3">
                <p className="text-[#666]">Assigned agent</p><p className="mt-1 font-bold text-[#222]">{query.data.assignedAgentName || "Unassigned"}</p>
              </div>
            </div>
            {isManager && query.data.canReassign && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-48 flex-1 text-xs font-bold text-[#444]">Reassign follow-up
                  <select data-testid="confirmation-agent-select" value={agentId ?? query.data.assignedAgentId ?? ""} onChange={e => setAgentId(e.target.value)} className="mt-1 h-9 w-full rounded-sm border-2 border-l-[#808080] border-t-[#808080] border-r-white border-b-white bg-white px-2 text-sm">
                    <option value="">Unassigned</option>{(agents.data ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
                <Button data-testid="confirmation-assign" size="sm" disabled={assign.isPending || agents.isLoading || !agents.data} onClick={() => assign.mutate()}>{assign.isPending ? "Saving…" : "Assign"}</Button>
                {agents.error && <span className="text-xs text-red-700" role="alert">{(agents.error as Error).message}</span>}
              </div>
            )}
            <div className="border-t border-[#aaa] pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#555]"><UserRound className="h-3.5 w-3.5" />Record phone confirmation</p>
              {query.data.deliveryNotice && <p data-testid="confirmation-delivery-notice" role="status" className="mb-2 border border-[#b27b18] bg-[#fff3cd] px-2 py-1.5 text-xs text-[#684600]">{query.data.deliveryNotice}</p>}
              <textarea data-testid="confirmation-notes" value={notes} onChange={e => setNotes(e.target.value)} minLength={3} maxLength={2000} rows={3} placeholder="Who confirmed receipt, when, and any relevant details…" className="w-full resize-y rounded-sm border-2 border-l-[#808080] border-t-[#808080] border-r-white border-b-white bg-white p-2 text-sm outline-none focus:ring-2 focus:ring-[#098b9f]/30" />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-[#666]">{notes.trim().length}/2000 · minimum 3 characters</span>
                <div className="flex gap-2">
                  <Button data-testid="confirmation-resend" size="sm" disabled={!query.data.canResend || resend.isPending} title={!query.data.canResend ? query.data.deliveryNotice || "Sending is not available for this confirmation status." : undefined} onClick={() => resend.mutate()}><Mail className="mr-1 h-3.5 w-3.5" />{resend.isPending ? "Sending…" : query.data.sentAt ? "Resend" : "Send"}</Button>
                  {query.data.canMarkConfirmed && <Button data-testid="confirmation-mark-confirmed" primary size="sm" disabled={markConfirmed.isPending || notes.trim().length < 3 || notes.trim().length > 2000} onClick={() => markConfirmed.mutate()}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />{markConfirmed.isPending ? "Recording…" : "Mark confirmed"}</Button>}
                </div>
              </div>
            </div>
            {error && <p role="alert" data-testid="confirmation-action-error" className="flex items-start gap-2 border border-[#a64b40] bg-[#f9e1dd] p-2 text-xs text-[#8a3028]"><AlertTriangle className="h-4 w-4 shrink-0" />{error.message}</p>}
          </div>
          <div className="border-l-0 border-[#aaa] lg:border-l lg:pl-5">
            <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#555]"><Clock3 className="h-3.5 w-3.5" />Audit history</h3>
            {query.data.events.length ? <ol className="space-y-3">
              {query.data.events.map(event => <li key={event.id} data-testid="confirmation-audit-event" className="border-l-2 border-[#098b9f] pl-3">
                <p className="text-xs font-bold text-[#222]">{event.event.replace(/_/g, " ")}</p>
                <p className="text-[11px] text-[#666]">{event.actor} · {new Date(event.createdAt).toLocaleString()}</p>
                {event.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-[#444]">{event.notes}</p>}
              </li>)}
            </ol> : <p className="text-xs text-[#777]">No confirmation activity has been recorded.</p>}
            {query.data.confirmedAt && <p className="mt-3 border-t border-[#aaa] pt-2 text-xs text-[#245b31]">Confirmed {new Date(query.data.confirmedAt).toLocaleString()}</p>}
          </div>
        </div>
      )}
    </Card>
  );
}
