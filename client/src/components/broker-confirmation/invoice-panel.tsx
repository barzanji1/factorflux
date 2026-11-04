import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { confirmationRequest } from "./api";
import { NeuButton, NeuCard, NeuSelect } from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";
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

  if (query.isLoading) return <NeuCard data-testid="broker-confirmation-loading" className="ff-invoice-broker-panel p-5"><div className="h-5 w-48 animate-pulse rounded-lg bg-[#d4d4d4]" /><div className="mt-4 h-16 rounded-lg bg-[#d4d4d4]" /></NeuCard>;

  return (
    <NeuCard data-testid="broker-confirmation-panel" className="ff-invoice-broker-panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#c9c9c9] px-4 py-3">
        <Mail className="h-4 w-4 text-[#087f8c]" />
        <h2 className="font-bold text-[#222]">Broker invoice receipt</h2>
        {query.data && <ConfirmationStatusBadge status={query.data.status} neuStyle />}
        <NeuButton data-testid="confirmation-retry" className="ml-auto min-h-8 px-3 py-1 text-xs" onClick={() => query.refetch()}>
          <RefreshCw className="mr-1 h-3 w-3" />Refresh
        </NeuButton>
      </div>
      {!query.data ? (
        <NeuNotice severity="block" className="text-sm">{query.error?.message || "Broker confirmation is unavailable."}
          <NeuButton className="ml-2 min-h-8 px-3 py-1 text-xs" onClick={() => query.refetch()}>Retry</NeuButton>
        </NeuNotice>
      ) : (
        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <NeuCard className="p-3">
                <p className="text-[#666]">Broker email</p><p className="mt-1 font-bold text-[#222]">{query.data.emailOnFile ? "On file" : "Missing"}</p>
              </NeuCard>
              <NeuCard className="p-3">
                <p className="text-[#666]">Reminders recorded</p><p className="mt-1 font-bold text-[#222]">{query.data.remindedCount}</p>
              </NeuCard>
              <NeuCard className="p-3">
                <p className="text-[#666]">Last sent</p><p className="mt-1 font-bold text-[#222]">{query.data.sentAt ? new Date(query.data.sentAt).toLocaleString() : "Not sent"}</p>
              </NeuCard>
              <NeuCard className="p-3">
                <p className="text-[#666]">Assigned agent</p><p className="mt-1 font-bold text-[#222]">{query.data.assignedAgentName || "Unassigned"}</p>
              </NeuCard>
            </div>
            {isManager && query.data.canReassign && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-48 flex-1 text-xs font-bold text-[#444]">Reassign follow-up
                <NeuSelect data-testid="confirmation-agent-select" value={agentId ?? query.data.assignedAgentId ?? ""} onChange={e => setAgentId(e.target.value)} className="mt-1 h-9 w-full px-2 text-sm">
                    <option value="">Unassigned</option>{(agents.data ?? []).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </NeuSelect>
                </label>
                <NeuButton data-testid="confirmation-assign" className="min-h-9 px-3 py-1.5 text-xs" disabled={assign.isPending || agents.isLoading || !agents.data} onClick={() => assign.mutate()}>{assign.isPending ? "Saving…" : "Assign"}</NeuButton>
                {agents.error && <NeuNotice severity="block" className="text-xs">{(agents.error as Error).message}</NeuNotice>}
              </div>
            )}
            <div className="border-t border-[#aaa] pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#555]"><UserRound className="h-3.5 w-3.5" />Record phone confirmation</p>
              {query.data.deliveryNotice && <NeuNotice severity="ack" data-testid="confirmation-delivery-notice" role="status" className="mb-2 text-xs">{query.data.deliveryNotice}</NeuNotice>}
                <textarea data-testid="confirmation-notes" value={notes} onChange={e => setNotes(e.target.value)} minLength={3} maxLength={2000} rows={3} placeholder="Who confirmed receipt, when, and any relevant details…" className="ff-neu-textarea w-full resize-y p-3 text-sm outline-none focus:ring-2 focus:ring-[#27aab8]/40" />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-[#666]">{notes.trim().length}/2000 · minimum 3 characters</span>
                <div className="flex gap-2">
                  <NeuButton data-testid="confirmation-resend" className="min-h-9 px-3 py-1.5 text-xs" disabled={!query.data.canResend || resend.isPending} title={!query.data.canResend ? query.data.deliveryNotice || "Sending is not available for this confirmation status." : undefined} onClick={() => resend.mutate()}><Mail className="mr-1 h-3.5 w-3.5" />{resend.isPending ? "Sending…" : query.data.sentAt ? "Resend" : "Send"}</NeuButton>
                  {query.data.canMarkConfirmed && <NeuButton data-testid="confirmation-mark-confirmed" variant="accent" className="min-h-9 px-3 py-1.5 text-xs" disabled={markConfirmed.isPending || notes.trim().length < 3 || notes.trim().length > 2000} onClick={() => markConfirmed.mutate()}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />{markConfirmed.isPending ? "Recording…" : "Mark confirmed"}</NeuButton>}
                </div>
              </div>
            </div>
            {error && <NeuNotice severity="block" role="alert" data-testid="confirmation-action-error" className="flex items-start gap-2 text-xs"><AlertTriangle className="h-4 w-4 shrink-0" />{error.message}</NeuNotice>}
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
    </NeuCard>
  );
}
