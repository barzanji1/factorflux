import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock3, MailWarning, RotateCcw } from "lucide-react";
import { NeuBadge, NeuButton, NeuCard, NeuInput, NeuSelect } from "@/styles/neu/components";

type Lifecycle = {
  invoiceId: number; carrierName: string; originalAmount: number | null;
  verifiedDebit: number; refundedAmount: number; refundableAmount: number;
  resolutionStatus: string; blockedReason: string | null;
  events: Array<{ id: number; eventType: string; createdAt: string; actorName: string; amount: string | null; reason: string; reference: string }>;
  refunds: Array<{ id: number; amount: string; refundDate: string; reference: string; notes: string; approvedBy: string; createdBy: string; approverName?: string; actorName?: string; emailStatus?: string; emailError?: string }>;
};
type Approver = { id: string; name: string };
type RefundForm = { amount: string; refundDate: string; reference: string; reason: string; approvedBy: string };
const freshForm = (): RefundForm => ({ amount: "", refundDate: new Date().toISOString().slice(0, 10), reference: "", reason: "", approvedBy: "" });
const money = (value: number | string | null | undefined) => value == null ? "—" : `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/Denver" }).format(date);
};

export default function ChargebackLifecycle({ invoiceId, onChanged }: { invoiceId: number; onChanged?: () => void }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RefundForm>(freshForm);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [emailError, setEmailError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const lifecycleQuery = useQuery<Lifecycle>({
    queryKey: ["/api/invoices", invoiceId, "chargeback", "lifecycle"],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/invoices/${invoiceId}/chargeback/lifecycle`, { credentials: "include", signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Unable to load chargeback lifecycle.");
      return body;
    },
  });
  const approversQuery = useQuery<Approver[]>({
    queryKey: ["/api/invoices", invoiceId, "chargeback", "approvers"],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/invoices/${invoiceId}/chargeback/approvers`, { credentials: "include", signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Unable to load approvers.");
      return body;
    },
    enabled: open,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/invoices/${invoiceId}/chargeback/refunds`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: Number(form.amount), idempotencyKey, method: "recorded" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Refund could not be recorded.");
      return body as { refund: unknown; emailStatus: string; emailError?: string };
    },
    onSuccess: async result => {
      setSubmitError("");
      setEmailError(result.emailStatus === "failed" ? result.emailError || "Refund recorded, but carrier email could not be sent."
        : result.emailStatus === "pending" ? "Notification is still pending. Do not record the refund again." : "");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["/api/invoices", invoiceId, "chargeback", "lifecycle"] }),
        client.invalidateQueries({ queryKey: ["/api/invoices", invoiceId] }),
        client.invalidateQueries({ queryKey: ["/api/reports/chargeback"] }),
      ]);
      onChanged?.();
      setOpen(false);
      setForm(freshForm());
      setIdempotencyKey("");
    },
    onError: error => setSubmitError(error instanceof Error ? error.message : "Refund could not be recorded."),
  });
  const lifecycle = lifecycleQuery.data;
  const canRefund = Boolean(lifecycle && lifecycle.verifiedDebit > 0 && lifecycle.refundableAmount > 0 && !lifecycle.blockedReason);
  const sortedEvents = useMemo(() => [...(lifecycle?.events ?? [])].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)), [lifecycle?.events]);
  const amountValid = Number.isFinite(Number(form.amount)) && Number(form.amount) > 0 && Number(form.amount) <= (lifecycle?.refundableAmount ?? 0)
    && /^\d+(\.\d{1,2})?$/.test(form.amount);
  const submit = () => {
    if (!idempotencyKey) setIdempotencyKey(crypto.randomUUID());
    void mutation.mutate();
  };

  if (lifecycleQuery.isLoading) return <NeuCard className="space-y-3 p-4" aria-label="Loading chargeback lifecycle"><div className="h-5 w-44 animate-pulse rounded bg-[#c9c9c9]" /><div className="h-16 animate-pulse rounded bg-[#d1d1d1]" /><div className="h-16 animate-pulse rounded bg-[#d1d1d1]" /></NeuCard>;
  if (lifecycleQuery.isError) return <NeuCard className="p-4 text-sm text-[#8b3028]" role="alert"><p>Chargeback lifecycle could not be loaded.</p><NeuButton className="mt-3 min-h-9 px-3" onClick={() => void lifecycleQuery.refetch()}>Retry</NeuButton></NeuCard>;
  if (!lifecycle) return null;

  return <NeuCard className="overflow-hidden p-0">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#c0c0c0] bg-[#d7d7d7] px-4 py-3">
      <div><h3 className="font-bold">Chargeback lifecycle</h3><p className="text-xs text-[#666]">{lifecycle.carrierName} · Invoice {invoiceId}</p></div>
      <NeuButton variant="accent" className="min-h-9 px-3" disabled={!canRefund} onClick={() => { setForm(freshForm()); setIdempotencyKey(crypto.randomUUID()); setSubmitError(""); setEmailError(""); setOpen(true); }}>
        <RotateCcw className="h-4 w-4" /> Record refund
      </NeuButton>
    </div>
    <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
      {[
        ["Original chargeback", money(lifecycle.originalAmount)],
        ["Verified debit", money(lifecycle.verifiedDebit)],
        ["Refunded to date", money(lifecycle.refundedAmount)],
        ["Refund available", money(lifecycle.refundableAmount)],
        ["Resolution", lifecycle.resolutionStatus.replace(/_/g, " ")],
      ].map(([label, value]) => <div key={label} className="rounded-lg bg-[#e0e0e0] p-3 shadow-[inset_2px_2px_5px_#c1c1c1,inset_-2px_-2px_5px_#fff]"><p className="text-[10px] font-bold uppercase tracking-wide text-[#777]">{label}</p><p className="mt-1 font-mono text-sm font-bold">{value}</p></div>)}
    </div>
    {(lifecycle.blockedReason || lifecycle.verifiedDebit <= 0) && <div className="mx-3 mb-3 flex items-start gap-2 rounded-lg border border-[#c5a766] bg-[#fff7dc] p-3 text-xs text-[#655121]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{lifecycle.blockedReason || "No verified reserve debit is available to refund. No reserve credit has been inferred."}</div>}
    {emailError && <div role="status" className="mx-3 mb-3 flex gap-2 border border-[#bf9e61] bg-[#fff7df] p-3 text-xs text-[#654d20]"><MailWarning className="h-4 w-4 shrink-0" /><span><strong>Refund recorded successfully.</strong> Carrier notification failed: {emailError}</span></div>}
    <div className="px-4 pb-4">
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#666]">Activity</h4>
      {sortedEvents.length ? <ol className="space-y-0">
        {sortedEvents.map((event, index) => <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
          <div className="flex w-5 shrink-0 flex-col items-center"><span className="z-10 mt-1 h-2.5 w-2.5 rounded-full border-2 border-[#27aab8] bg-[#e0e0e0]" />{index < sortedEvents.length - 1 && <span className="absolute bottom-0 top-4 w-px bg-[#b8c6c5]" />}</div>
          <div className="min-w-0 flex-1 rounded-lg bg-[#e0e0e0] px-3 py-2 shadow-[2px_2px_5px_#c1c1c1,-2px_-2px_5px_#fff]">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold capitalize">{event.eventType.replace(/_/g, " ")}</span><NeuBadge tone={event.eventType === "refunded" ? "success" : "neutral"}>{dateLabel(event.createdAt)}</NeuBadge></div>
            <p className="mt-1 text-xs text-[#666]">{event.actorName || "System"}{event.amount != null && <span> · {money(event.amount)}</span>}{event.reference && <span> · Ref {event.reference}</span>}</p>
            {event.reason && <p className="mt-1 text-xs">{event.reason}</p>}
          </div>
        </li>)}
      </ol> : <p className="rounded-lg bg-[#e0e0e0] p-4 text-xs text-[#777]">No lifecycle events have been recorded.</p>}
      {!!lifecycle.refunds.length && <div className="mt-4 border-t border-[#c0c0c0] pt-3"><h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#666]">Refund ledger</h4>
        <div className="space-y-2">{lifecycle.refunds.map(refund => <div key={refund.id} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-[#cecece] pb-2 text-xs last:border-0"><span>{dateLabel(refund.refundDate)} · {refund.reference || "No payment reference"}{refund.approvedBy && <span className="block text-[#666]">Approved by {refund.approverName || refund.approvedBy}</span>}{refund.actorName && <span className="block text-[#666]">Recorded by {refund.actorName}</span>}{refund.notes && <span className="block text-[#666]">{refund.notes}</span>}{refund.emailStatus && refund.emailStatus !== "sent" && <span role="status" className="block text-[#963b31]">Carrier notification {refund.emailStatus}: {refund.emailError || "Awaiting delivery confirmation"}</span>}</span><strong className="font-mono">{money(refund.amount)}</strong></div>)}</div>
      </div>}
    </div>
    {open && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#263638]/40 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !mutation.isPending) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="refund-title" className="w-full max-w-lg rounded-2xl bg-[#e0e0e0] p-5 shadow-[8px_8px_24px_#777,-6px_-6px_20px_#fff]">
        <h3 id="refund-title" className="text-lg font-bold">Record chargeback refund</h3>
        <p className="mb-4 mt-1 text-xs text-[#666]">Available to return: <strong className="font-mono">{money(lifecycle.refundableAmount)}</strong>. The verified debit is authoritative.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold">Refund date<NeuInput type="date" className="mt-1 min-h-9" value={form.refundDate} onChange={e => setForm({ ...form, refundDate: e.target.value })} /></label>
          <label className="text-xs font-semibold">Amount<NeuInput inputMode="decimal" className="mt-1 min-h-9" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></label>
          <label className="text-xs font-semibold">Payment reference<NeuInput className="mt-1 min-h-9" value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="Check # / ACH trace" /></label>
          <label className="text-xs font-semibold">Approved by{approversQuery.isError ? <span className="block font-normal text-[#963b31]">Approver list unavailable.</span> : <NeuSelect className="mt-1 min-h-9" value={form.approvedBy} onChange={e => setForm({ ...form, approvedBy: e.target.value })}><option value="">Choose approver</option>{(approversQuery.data ?? []).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</NeuSelect>}</label>
          <label className="text-xs font-semibold sm:col-span-2">Refund reason<textarea className="mt-1 min-h-20 w-full rounded-xl border-0 bg-[#e0e0e0] p-3 text-sm shadow-[inset_4px_4px_8px_#c1c1c1,inset_-4px_-4px_8px_#fff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#27aab8]" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></label>
        </div>
        {submitError && <p role="alert" className="mt-3 text-xs text-[#9c2f27]">{submitError}</p>}
        <div className="mt-5 flex justify-end gap-2"><NeuButton className="min-h-9 px-3" disabled={mutation.isPending} onClick={() => setOpen(false)}>Cancel</NeuButton><NeuButton variant="accent" className="min-h-9 px-3" disabled={!amountValid || !form.refundDate || !form.approvedBy || !form.reference.trim() || !form.reason.trim() || !approversQuery.isSuccess || mutation.isPending} onClick={submit}>{mutation.isPending ? <><Clock3 className="h-4 w-4" /> Recording…</> : <><Check className="h-4 w-4" /> Confirm refund</>}</NeuButton></div>
      </div>
    </div>}
  </NeuCard>;
}
