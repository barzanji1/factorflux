import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Win95Button as Button, Win95Card as Card, Win95Input as Input } from "@/components/win95";
import { AlertCircle, Settings2 } from "lucide-react";

interface Settings { maxReminders: number; reminderDays: [number, number, number]; publicBaseUrl: string }
export default function BrokerConfirmationSettings() {
  const qc = useQueryClient();
  const query = useQuery<Settings>({
    queryKey: ["/api/broker-confirmation-settings"],
    queryFn: async () => (await apiRequest("GET", "/api/broker-confirmation-settings")).json(),
  });
  const [maxReminders, setMaxReminders] = useState(2);
  const [days, setDays] = useState<[number, number, number]>([3, 7, 14]);
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  useEffect(() => {
    if (!query.data) return;
    setMaxReminders(query.data.maxReminders);
    setDays(query.data.reminderDays);
    setPublicBaseUrl(query.data.publicBaseUrl);
  }, [query.data]);
  const mutation = useMutation({
    mutationFn: (payload: Settings) => apiRequest("PATCH", "/api/broker-confirmation-settings", payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/broker-confirmation-settings"] }),
  });
  const valid = Number.isInteger(maxReminders) && maxReminders >= 0 && maxReminders <= 3 && days.every(n => Number.isInteger(n) && n > 0) && days[0] < days[1] && days[1] < days[2];
  if (query.isLoading) return <Card data-testid="confirmation-settings-loading" className="border-2 border-[#808080] bg-[#f4f4f4] p-5"><div className="h-5 w-56 animate-pulse bg-[#d4d0c8]" /><div className="mt-4 h-24 animate-pulse bg-[#e5e2da]" /></Card>;
  return <Card data-testid="confirmation-settings" className="rounded-sm border-2 border-[#808080] border-r-[#404040] border-b-[#404040] bg-[#f4f4f4]">
    <div className="flex items-center gap-2 border-b-2 border-[#808080] bg-[#d4d0c8] px-4 py-3"><Settings2 className="h-4 w-4 text-[#087f8c]" /><h3 className="font-bold">Broker receipt follow-up</h3></div>
    <div className="space-y-4 p-4">
      {query.error && <div role="alert" className="flex items-center gap-2 bg-[#f9e1dd] p-2 text-sm text-[#8a3028]"><AlertCircle className="h-4 w-4" />{(query.error as Error).message}<Button size="sm" variant="outline" onClick={() => query.refetch()}>Retry</Button></div>}
      {query.data && <>
        <p className="text-xs text-[#555]">Reminder cadence is for broker receipt follow-up only. It does not change invoice funding or payment workflows.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs font-bold">Maximum reminders (0–3)
            <Input data-testid="confirmation-max-reminders" type="number" min={0} max={3} value={maxReminders} onChange={e => setMaxReminders(Number(e.target.value))} className="mt-1 h-9" />
          </label>
          <label className="text-xs font-bold">Public confirmation base URL
            <Input data-testid="confirmation-public-url" type="url" value={publicBaseUrl} onChange={e => setPublicBaseUrl(e.target.value)} className="mt-1 h-9" />
          </label>
        </div>
        <div>
          <p className="mb-1 text-xs font-bold">Reminder days — positive, strictly ascending</p>
          <div className="grid grid-cols-3 gap-2">{days.map((day, i) => <label key={i} className="text-[11px] text-[#666]">Reminder {i + 1}
            <Input data-testid={`confirmation-reminder-day-${i + 1}`} type="number" min={1} step={1} value={day} onChange={e => setDays(old => old.map((n, j) => j === i ? Number(e.target.value) : n) as [number, number, number])} className="mt-1 h-9" />
          </label>)}</div>
        </div>
        {mutation.error && <p role="alert" className="text-sm text-red-700">{(mutation.error as Error).message}</p>}
        <div className="flex justify-end"><Button data-testid="confirmation-settings-save" primary disabled={!valid || mutation.isPending} onClick={() => mutation.mutate({ maxReminders, reminderDays: days, publicBaseUrl: publicBaseUrl.trim() })}>{mutation.isPending ? "Saving…" : "Save receipt settings"}</Button></div>
      </>}
    </div>
  </Card>;
}
