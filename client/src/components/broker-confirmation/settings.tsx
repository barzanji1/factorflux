import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button, Card, Input } from "@/components/admin-neu/adapters";
import { AlertCircle, Settings2 } from "lucide-react";
import { NeuNotice } from "@/components/shared/NeuNotice";

interface Settings { maxReminders: number; reminderDays: [number, number, number]; publicBaseUrl: string; chargebackWarningDays: number; dumpStatementIntervalDays: number }
export default function BrokerConfirmationSettings() {
  const qc = useQueryClient();
  const query = useQuery<Settings>({
    queryKey: ["/api/broker-confirmation-settings"],
    queryFn: async () => (await apiRequest("GET", "/api/broker-confirmation-settings")).json(),
  });
  const [maxReminders, setMaxReminders] = useState(2);
  const [days, setDays] = useState<[number, number, number]>([3, 7, 14]);
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [chargebackWarningDays, setChargebackWarningDays] = useState(80);
  const [dumpStatementIntervalDays, setDumpStatementIntervalDays] = useState(10);
  useEffect(() => {
    if (!query.data) return;
    setMaxReminders(query.data.maxReminders);
    setDays(query.data.reminderDays);
    setPublicBaseUrl(query.data.publicBaseUrl);
    setChargebackWarningDays(query.data.chargebackWarningDays ?? 80);
    setDumpStatementIntervalDays(query.data.dumpStatementIntervalDays ?? 10);
  }, [query.data]);
  const mutation = useMutation({
    mutationFn: (payload: Settings) => apiRequest("PATCH", "/api/broker-confirmation-settings", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/broker-confirmation-settings"] }),
  });
  const valid = Number.isInteger(chargebackWarningDays) && chargebackWarningDays >= 1 && chargebackWarningDays <= 89 &&
    Number.isInteger(dumpStatementIntervalDays) && dumpStatementIntervalDays >= 1 && dumpStatementIntervalDays <= 365 &&
    Number.isInteger(maxReminders) && maxReminders >= 0 && maxReminders <= 3 && days.every(n => Number.isInteger(n) && n > 0) && days[0] < days[1] && days[1] < days[2];
  if (query.isLoading) return <Card data-testid="confirmation-settings-loading" className="border-2 border-[#808080] bg-[#f4f4f4] p-5"><div className="h-5 w-56 animate-pulse bg-[#d4d0c8]" /><div className="mt-4 h-24 animate-pulse bg-[#e5e2da]" /></Card>;
  return <Card data-testid="confirmation-settings" className="rounded-sm border-2 border-[#808080] border-r-[#404040] border-b-[#404040] bg-[#f4f4f4]">
    <div className="flex items-center gap-2 border-b-2 border-[#808080] bg-[#d4d0c8] px-4 py-3"><Settings2 className="h-4 w-4 text-[#087f8c]" /><h3 className="font-bold">Broker receipt follow-up</h3></div>
    <div className="space-y-4 p-4">
      {query.error && <NeuNotice severity="block" role="alert" className="flex items-center gap-2 text-sm"><AlertCircle className="h-4 w-4" />{(query.error as Error).message}<Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry</Button></NeuNotice>}
      {query.data && <>
        <p className="text-xs text-[#555]">Automatic collections now use VP at +48/+96 hours, followed by RPS at days 20/35/40 after agent verification. Manage the global switch and dry-run mode in <a className="underline" href="/follow-up">Follow-up → VP / RPS</a>. The public URL below is still used by receipt links. Legacy reminder values are retained for history and do not run a second schedule.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-bold">Legacy maximum reminders (not scheduled)
            <Input data-testid="confirmation-max-reminders" disabled type="number" min={0} max={3} value={maxReminders} onChange={e => setMaxReminders(Number(e.target.value))} className="mt-1 h-9" />
          </label>
          <label className="text-xs font-bold">Public confirmation base URL
            <Input data-testid="confirmation-public-url" type="url" value={publicBaseUrl} onChange={e => setPublicBaseUrl(e.target.value)} className="mt-1 h-9" />
          </label>
        </div>
        <div>
          <p className="mb-1 text-xs font-bold">Legacy reminder days — retained for history only</p>
          <div className="grid grid-cols-3 gap-2">{days.map((day, i) => <label key={i} className="text-[11px] text-[#666]">Reminder {i + 1}
            <Input data-testid={`confirmation-reminder-day-${i + 1}`} disabled type="number" min={1} step={1} value={day} onChange={e => setDays(old => old.map((n, j) => j === i ? Number(e.target.value) : n) as [number, number, number])} className="mt-1 h-9" />
          </label>)}</div>
        </div>
        <div className="space-y-2 border-t-2 border-[#808080] pt-3">
          <h4 className="text-sm font-bold">Chargeback warning</h4>
          <label className="block text-xs font-bold">Days after funding
            <Input data-testid="chargeback-warning-days" type="number" min={1} max={89} step={1}
              value={chargebackWarningDays} onChange={e => setChargebackWarningDays(Number(e.target.value))}
              className="mt-1 h-9 max-w-32" />
          </label>
          <p className="text-xs text-[#555]">Default: 80 days. The daily aging job emails the broker once per unpaid invoice and creates an agent follow-up. Choose 1–89 days, before the 90-day chargeback. Live email sends run only in production.</p>
        </div>
        <div className="space-y-2 border-t-2 border-[#808080] pt-3">
          <h4 className="text-sm font-bold">Dump-load aging statements</h4>
          <label className="block text-xs font-bold">Dump-load aging statements — Interval (days)
            <Input data-testid="dump-statement-interval-days" type="number" min={1} max={365} step={1}
              value={dumpStatementIntervalDays} onChange={e => setDumpStatementIntervalDays(Number(e.target.value))}
              className="mt-1 h-9 max-w-32" />
          </label>
          <p className="text-xs text-[#555]">Default: 10 days. The daily aging job evaluates each unpaid dump invoice’s funding-date milestones. When statements are due, all open dump invoices for a broker are grouped into one PDF; if several invoices become due together, the broker receives one email. Preview does not send live broker emails.</p>
        </div>
        {mutation.error && <p role="alert" className="text-sm text-red-700">{(mutation.error as Error).message}</p>}
        {mutation.isSuccess && <NeuNotice severity="info" role="status" className="text-sm">Settings saved.</NeuNotice>}
        <div className="flex justify-end"><Button data-testid="confirmation-settings-save" primary disabled={!valid || mutation.isPending} onClick={() => mutation.mutate({ maxReminders, reminderDays: days, publicBaseUrl: publicBaseUrl.trim(), chargebackWarningDays, dumpStatementIntervalDays })}>{mutation.isPending ? "Saving…" : "Save factoring settings"}</Button></div>
      </>}
    </div>
  </Card>;
}
