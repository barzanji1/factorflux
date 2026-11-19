import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock3, LockKeyhole, Plus, Settings2, UnlockKeyhole } from "lucide-react";
import { Badge, Button, Card, CardContent, DialogContent, Input, SelectContent, SelectTrigger } from "@/components/admin-neu/adapters";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectItem, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ContractorHours, PayPeriod, PayrollAdmin as PayrollAdminData, PayrollCadence, PayrollReview, PayStatement } from "../../../../shared/contractor-payroll";
import { dateLabel, errorMessage, ErrorNotice, money, Notice, periodLabel, timestampLabel } from "./payroll-utils";

const ADMIN_KEY = ["/api/contractor-payroll/admin"];
const reviewKey = (id: number) => [`/api/contractor-payroll/periods/${id}`];
const ADMIN_PAGE_SIZE = 15;
type PeriodContractor = ContractorHours & { issuedStatement?: PayStatement | null; rateCents?: number | null };
type PaginatedPayrollAdmin = PayrollAdminData & {
  contractorPage: number; contractorTotal: number; periodPage: number; periodTotal: number;
};
type PayrollReviewWithStatements = Omit<PayrollReview, "contractors"> & { contractors: PeriodContractor[] };

async function fetchAdminPage(contractorPage: number, periodPage: number): Promise<PaginatedPayrollAdmin> {
  const response = await fetch(`/api/contractor-payroll/admin?contractorPage=${contractorPage}&periodPage=${periodPage}`, { credentials: "include" });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Could not load payroll administration (${response.status}).`);
  }
  return response.json();
}

async function post(path: string, body: unknown) {
  const response = await apiRequest("POST", path, body);
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}
async function patch(path: string, body: unknown) {
  const response = await apiRequest("PATCH", path, body);
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}
async function invalidateAdmin(id?: number) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ADMIN_KEY }),
    queryClient.invalidateQueries({ predicate: query => {
      const first = query.queryKey[0];
      return typeof first === "string" && first.startsWith("/api/contractor-payroll?page=");
    } }),
    queryClient.invalidateQueries({ predicate: query => {
      const first = query.queryKey[0];
      return typeof first === "string" && first.startsWith("/api/contractor-payroll/audit?page=");
    } }),
    ...(id ? [queryClient.invalidateQueries({ queryKey: reviewKey(id) })] : []),
  ]);
}

function MutationError({ error }: { error: unknown }) {
  return error ? <ErrorNotice message={errorMessage(error)} /> : null;
}

function AuditDetails({ details }: { details: Record<string, unknown> | string }) {
  if (typeof details === "string") return <p className="break-words">{details}</p>;
  return <dl className="mt-1 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-2 gap-y-1">
    {Object.entries(details).filter(([, value]) => value !== undefined).map(([key, value]) => {
      const label = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/Cents$/, "").toLowerCase();
      const display = value == null ? "Not set" : /Cents$/.test(key) && typeof value === "number"
        ? money(value) : Array.isArray(value) ? `${value.length} records`
          : typeof value === "object" ? "Recorded snapshot" : String(value);
      return <div key={key} className="contents"><dt className="capitalize">{label}</dt><dd className="min-w-0 break-all text-foreground">{display}</dd></div>;
    })}
  </dl>;
}

export function ReissueDialog({ statement, onClose }: { statement: PayStatement | null; onClose: () => void }) {
  const [payDate, setPayDate] = useState(statement?.payDate ?? "");
  const [reason, setReason] = useState("");
  useEffect(() => {
    setPayDate(statement?.payDate ?? "");
    setReason("");
  }, [statement?.id, statement?.payDate]);
  const selectedReview = useQuery<PayrollReviewWithStatements>({
    queryKey: statement ? reviewKey(statement.periodId) : ["/api/contractor-payroll/periods/none"],
    enabled: !!statement,
  });
  const reviewedContractor = selectedReview.data?.contractors.find(c => c.id === statement?.contractorId);
  const canReplace = selectedReview.data?.period.status === "locked" && reviewedContractor?.approved === true;
  const reissue = useMutation({
    mutationFn: () => post(`/api/contractor-payroll/periods/${statement?.periodId}/issue`, {
      contractorId: statement?.contractorId, payDate, replacesStatementId: statement?.id, reason: reason.trim(),
    }),
    onSuccess: async () => { await invalidateAdmin(statement?.periodId); onClose(); setReason(""); },
  });
  return <Dialog open={!!statement} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
      <DialogHeader><DialogTitle>Replace pay statement</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">This atomically voids statement {statement?.statementNumber} and issues its replacement for its original pay period.</p>
      {statement && <div className="rounded-xl bg-muted/40 px-3 py-2 text-sm">
        <div className="font-medium">{dateLabel(statement.startDate)} – {dateLabel(statement.endDate)}</div>
        <div className="text-xs text-muted-foreground">Original period · {selectedReview.data?.period.timezone ?? "Time zone loading"}</div>
      </div>}
      {selectedReview.isError && <MutationError error={selectedReview.error} />}
      {!selectedReview.isLoading && selectedReview.data && !canReplace && <ErrorNotice message="This statement can only be replaced after its original period is locked and this contractor is approved." />}
      {reissue.isError && <MutationError error={reissue.error} />}
      <label className="grid gap-1.5 text-sm font-medium">Pay date<Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} /></label>
      <label className="grid gap-1.5 text-sm font-medium">Reason for replacement<Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Explain the correction" /></label>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" disabled={!statement || !payDate || !reason.trim() || !canReplace || selectedReview.isLoading || reissue.isPending} onClick={() => reissue.mutate()}>Issue replacement</Button></div>
    </DialogContent>
  </Dialog>;
}

function IssueStatementDialog({ periodId, contractor, onClose }: {
  periodId: number | null; contractor: PayrollAdminData["contractors"][number] | null; onClose: () => void;
}) {
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const issue = useMutation({
    mutationFn: () => post(`/api/contractor-payroll/periods/${periodId}/issue`, { contractorId: contractor?.id, payDate }),
    onSuccess: async () => { await invalidateAdmin(periodId ?? undefined); onClose(); },
  });
  return <Dialog open={!!contractor} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Issue pay statement</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Locked, approved hours will be used for {contractor?.name}. The PDF records the hourly rate used.</p>
      {issue.isError && <MutationError error={issue.error} />}
      <label className="grid gap-1.5 text-sm font-medium">Pay date<Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} /></label>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" disabled={!periodId || !contractor || !payDate || issue.isPending} onClick={() => issue.mutate()}>Issue statement</Button></div>
    </DialogContent>
  </Dialog>;
}

export function PayrollAdminPanel({ onReissue }: {
  onReissue: (statement: PayStatement) => void;
}) {
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [contractorPage, setContractorPage] = useState(1);
  const [periodPage, setPeriodPage] = useState(1);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [cadence, setCadence] = useState<PayrollCadence>("biweekly");
  const [timezone, setTimezone] = useState("UTC");
  const [settingsCadence, setSettingsCadence] = useState<PayrollCadence>("biweekly");
  const [settingsTimezone, setSettingsTimezone] = useState("UTC");
  const [editEntry, setEditEntry] = useState<{ entryId: number; inTime: string; outTime: string; reason: string } | null>(null);
  const [rateEdit, setRateEdit] = useState<{ contractorId: string; rate: string; reason: string } | null>(null);
  const [issueContractor, setIssueContractor] = useState<PayrollAdminData["contractors"][number] | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const admin = useQuery<PaginatedPayrollAdmin>({
    queryKey: [...ADMIN_KEY, { contractorPage, periodPage }],
    queryFn: () => fetchAdminPage(contractorPage, periodPage),
  });
  const periodId = selectedPeriodId ?? admin.data?.periods[0]?.id ?? null;
  const review = useQuery<PayrollReviewWithStatements>({
    queryKey: periodId ? reviewKey(periodId) : ["/api/contractor-payroll/periods/none"],
    enabled: !!periodId,
  });
  const audit = useQuery<{ items: { id: number; action: string; actorName: string; createdAt: string; details: Record<string, unknown> | string }[]; total: number; page: number }>({ queryKey: [`/api/contractor-payroll/audit?page=${auditPage}`] });

  useEffect(() => {
    if (!admin.data) return;
    setSettingsCadence(admin.data.cadence);
    setSettingsTimezone(admin.data.timezone);
    setCadence(admin.data.cadence);
    setTimezone(admin.data.timezone);
  }, [admin.data?.cadence, admin.data?.timezone]);

  useEffect(() => {
    if (selectedPeriodId === null && admin.data?.periods.length) {
      setSelectedPeriodId(admin.data.periods[0].id);
    }
  }, [admin.data?.periodPage, admin.data?.periods[0]?.id, selectedPeriodId]);

  const reportError = admin.isError ? errorMessage(admin.error) : review.isError ? errorMessage(review.error) : audit.isError ? errorMessage(audit.error) : null;
  const createPeriod = useMutation({
    mutationFn: () => post("/api/contractor-payroll/periods", { startDate: newStart, endDate: newEnd, cadence, timezone }),
    onSuccess: async (data: PayPeriod) => { setPeriodPage(1); await invalidateAdmin(data.id); setSelectedPeriodId(data.id); setNewStart(""); setNewEnd(""); },
  });
  const saveSettings = useMutation({
    mutationFn: () => patch("/api/contractor-payroll/settings", { cadence: settingsCadence, timezone: settingsTimezone }),
    onSuccess: () => invalidateAdmin(),
  });
  const saveRate = useMutation({
    mutationFn: () => apiRequest("PUT", `/api/contractor-payroll/rates/${rateEdit?.contractorId}`, { rateCents: Math.round(Number(rateEdit?.rate) * 100), reason: rateEdit?.reason.trim() }),
    onSuccess: async () => { await invalidateAdmin(); setRateEdit(null); },
  });
  const approve = useMutation({ mutationFn: (contractorId: string) => post(`/api/contractor-payroll/periods/${periodId}/approve`, { contractorId }), onSuccess: () => invalidateAdmin(periodId ?? undefined) });
  const lock = useMutation({ mutationFn: () => post(`/api/contractor-payroll/periods/${periodId}/lock`, {}), onSuccess: () => invalidateAdmin(periodId ?? undefined) });
  const unlock = useMutation({ mutationFn: (reason: string) => post(`/api/contractor-payroll/periods/${periodId}/unlock`, { reason }), onSuccess: () => invalidateAdmin(periodId ?? undefined) });
  const edit = useMutation({
    mutationFn: () => patch(`/api/contractor-payroll/time-entries/${editEntry?.entryId}`, {
      clockInTime: new Date(editEntry?.inTime ?? "").toISOString(),
      clockOutTime: new Date(editEntry?.outTime ?? "").toISOString(),
      reason: editEntry?.reason.trim(),
    }),
    onSuccess: async () => { await invalidateAdmin(periodId ?? undefined); setEditEntry(null); },
  });
  const allMutationError = createPeriod.error || saveSettings.error || saveRate.error || approve.error || lock.error || unlock.error || edit.error;
  const period = review.data?.period;
  const isLocked = period?.status === "locked";
  const localToday = period ? dateInTimezone(period.timezone) : "";
  const periodEnded = !!period && period.endDate < localToday;
  const rangeDays = newStart && newEnd ? (Date.parse(`${newEnd}T00:00:00Z`) - Date.parse(`${newStart}T00:00:00Z`)) / 86400000 + 1 : 0;
  const validRange = !!newStart && !!newEnd && rangeDays >= 1 && rangeDays <= 62;

  return <section className="space-y-5 border-t border-border/60 pt-7">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">Administrator workspace</p><h2 className="mt-1 text-xl font-semibold">Period review & controls</h2></div>
      <Badge tone="accent">ADMIN ONLY</Badge>
    </div>
    {reportError && <ErrorNotice message={reportError} onRetry={() => { admin.refetch(); review.refetch(); audit.refetch(); }} />}
    <MutationError error={allMutationError} />

    <Card><CardContent className="space-y-4 pt-5">
      <div className="flex items-center gap-2 font-semibold"><Settings2 className="h-4 w-4" />Default schedule</div>
      <Notice>Time zone is explicit. UTC is selected by default; choose the contractor workday time zone rather than relying on a browser assumption.</Notice>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Cadence
          <select className="admin-neu-input min-h-10 rounded-xl px-3 text-sm text-foreground" value={settingsCadence} onChange={e => setSettingsCadence(e.target.value as PayrollCadence)}>{["weekly","biweekly","monthly","custom"].map(x => <option key={x} value={x}>{x[0].toUpperCase()+x.slice(1)}</option>)}</select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">IANA time zone
          <Input value={settingsTimezone} onChange={e => setSettingsTimezone(e.target.value)} placeholder="UTC or America/Chicago" />
        </label>
        <Button type="button" className="self-end" disabled={saveSettings.isPending || !settingsTimezone.trim()} onClick={() => saveSettings.mutate()}>Save defaults</Button>
      </div>
      <div className="grid gap-3 border-t border-border/50 pt-4 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Period start<Input type="date" value={newStart} onChange={e => setNewStart(e.target.value)} /></label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Period end<Input type="date" value={newEnd} onChange={e => setNewEnd(e.target.value)} /></label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Cadence
          <select className="admin-neu-input min-h-10 rounded-xl px-3 text-sm text-foreground" value={cadence} onChange={e => setCadence(e.target.value as PayrollCadence)}>{["weekly","biweekly","monthly","custom"].map(x => <option key={x} value={x}>{x[0].toUpperCase()+x.slice(1)}</option>)}</select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">Time zone<Input value={timezone} onChange={e => setTimezone(e.target.value)} /></label>
        <Button type="button" className="self-end" disabled={!validRange || !timezone.trim() || createPeriod.isPending} onClick={() => createPeriod.mutate()}><Plus className="mr-1.5 h-4 w-4" />Create</Button>
        {!!newStart && !!newEnd && !validRange && <span className="text-xs text-rose-700 sm:col-span-5">Period range must be 1–62 days inclusive.</span>}
      </div>
    </CardContent></Card>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,.7fr)]">
      <Card><CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-semibold"><Clock3 className="h-4 w-4" />Work-hour review</div>
          <Select value={periodId ? String(periodId) : ""} onValueChange={v => setSelectedPeriodId(Number(v))}><SelectTrigger className="w-full sm:w-[300px]"><SelectValue>{period ? `${periodLabel(period)} · ${period.status}` : "Select pay period"}</SelectValue></SelectTrigger><SelectContent>
            {(admin.data?.periods ?? []).slice(0, ADMIN_PAGE_SIZE).map(p => <SelectItem key={p.id} value={String(p.id)}>{periodLabel(p)} · {p.status}</SelectItem>)}
          </SelectContent></Select>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Period page {admin.data?.periodPage ?? periodPage} of {Math.max(1, Math.ceil((admin.data?.periodTotal ?? 0) / ADMIN_PAGE_SIZE))}</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={periodPage <= 1 || admin.isFetching} onClick={() => setPeriodPage(p => Math.max(1, p - 1))}>Newer periods</Button>
            <Button type="button" variant="outline" size="sm" disabled={periodPage * ADMIN_PAGE_SIZE >= (admin.data?.periodTotal ?? 0) || admin.isFetching} onClick={() => setPeriodPage(p => p + 1)}>Older periods</Button>
          </div>
        </div>
        {!periodId ? <div className="rounded-xl bg-muted/40 p-8 text-center text-sm text-muted-foreground">Create a period to review time entries.</div> : review.isLoading ? <div className="space-y-3"><div className="h-12 animate-pulse rounded-xl bg-muted/60" /><div className="h-28 animate-pulse rounded-xl bg-muted/60" /></div> : period && review.data &&
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/35 p-3">
              <div><div className="font-semibold">{periodLabel(period)}</div><div className="text-xs text-muted-foreground">{period.timezone} · {period.cadence}{period.lockedAt ? ` · Locked ${timestampLabel(period.lockedAt)}` : " · Draft"}</div></div>
              <div className="flex gap-2">{isLocked ? <UnlockButton onUnlock={reason => unlock.mutate(reason)} pending={unlock.isPending} /> : <Button type="button" disabled={!periodEnded || !review.data.contractors.length || review.data.contractors.some(c => !c.approved) || lock.isPending} onClick={() => lock.mutate()}><LockKeyhole className="mr-1.5 h-4 w-4" />Lock approved hours</Button>}</div>
            </div>
            {!isLocked && !periodEnded && <div className="text-xs text-muted-foreground">A pay period must end before today in its selected time zone before it can be locked.</div>}
            {isLocked && <Notice tone="success">Locked hours are the only hours used to issue statements. To correct time, unlock with a reason; an edit revokes that contractor’s stale approval and the hours must be reviewed and approved again.</Notice>}
          {!isLocked && <Notice>Save corrections with a reason before approval. Any time edit invalidates that contractor’s prior approval; review and approve the corrected hours again.</Notice>}
            {review.data.contractors.map((person) => <ContractorReview key={person.id} person={person} locked={!!isLocked} onApprove={() => approve.mutate(person.id)} approving={approve.isPending}
              onIssue={{ id: person.id, name: person.name, rateCents: person.rateCents ?? null }}
              existingStatement={person.issuedStatement ?? null}
              openIssue={setIssueContractor} onReissue={onReissue} onEdit={entry => setEditEntry({
              entryId: entry.id, inTime: toLocalInput(entry.clockInTime), outTime: entry.clockOutTime ? toLocalInput(entry.clockOutTime) : "", reason: "",
            })} />)}
          </div>}
      </CardContent></Card>
      <div className="space-y-5">
        <Card><CardContent className="space-y-3 pt-5">
          <div className="font-semibold">Contractor hourly rates</div><p className="text-xs text-muted-foreground">Rates are administrator-only. Changes require a reason and are recorded in the audit trail.</p>
          {(admin.data?.contractors ?? []).slice(0, ADMIN_PAGE_SIZE).map(person => <div key={person.id} className="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
            <div className="min-w-0"><div className="truncate text-sm font-medium">{person.name}</div><div className="text-xs text-muted-foreground">{person.rateCents == null ? "Rate not set" : `${money(person.rateCents)} / hour`}</div></div>
            <Button type="button" variant="outline" size="sm" onClick={() => setRateEdit({ contractorId: person.id, rate: person.rateCents == null ? "" : (person.rateCents / 100).toFixed(2), reason: "" })}>Set rate</Button>
          </div>)}
          {!admin.data?.contractors.length && <p className="text-sm text-muted-foreground">No contractors available.</p>}
          {(admin.data?.contractorTotal ?? 0) > 0 && <div className="flex items-center justify-between border-t border-border/50 pt-3">
            <span className="text-xs text-muted-foreground">Contractors page {admin.data?.contractorPage ?? contractorPage} of {Math.max(1, Math.ceil((admin.data?.contractorTotal ?? 0) / ADMIN_PAGE_SIZE))}</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={contractorPage <= 1 || admin.isFetching} onClick={() => setContractorPage(p => Math.max(1, p - 1))}>Previous</Button>
              <Button type="button" variant="outline" size="sm" disabled={contractorPage * ADMIN_PAGE_SIZE >= (admin.data?.contractorTotal ?? 0) || admin.isFetching} onClick={() => setContractorPage(p => p + 1)}>Next</Button>
            </div>
          </div>}
        </CardContent></Card>
        <Card><CardContent className="space-y-3 pt-5">
          <div className="flex items-center justify-between"><div><div className="font-semibold">Audit history</div><p className="mt-1 text-xs text-muted-foreground">Rate changes include the recorded previous and new values.</p></div><span className="text-xs text-muted-foreground">{audit.data?.total ?? 0} events</span></div>
          {audit.isLoading ? <div className="h-20 animate-pulse rounded-xl bg-muted/50" /> : (audit.data?.items ?? []).map(item => <div key={item.id} className="border-t border-border/50 pt-2.5">
            <div className="flex items-start justify-between gap-2 text-sm"><span className="font-medium capitalize">{item.action.replaceAll("_", " ")}</span><span className="shrink-0 text-[11px] text-muted-foreground">{timestampLabel(item.createdAt)}</span></div>
            <div className="text-xs text-muted-foreground">{item.actorName}<AuditDetails details={item.details} /></div>
          </div>)}
          {!audit.isLoading && !audit.data?.items.length && <p className="text-sm text-muted-foreground">Rate changes, period locks, approvals and edits will be listed here.</p>}
          {!!audit.data?.total && <div className="flex items-center justify-between border-t border-border/50 pt-3">
            <span className="text-xs text-muted-foreground">Page {auditPage}</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={auditPage <= 1} onClick={() => setAuditPage(p => p - 1)}>Previous</Button>
              <Button type="button" variant="outline" size="sm" disabled={auditPage * 15 >= audit.data.total} onClick={() => setAuditPage(p => p + 1)}>Next</Button>
            </div>
          </div>}
        </CardContent></Card>
      </div>
    </div>

    <Dialog open={!!editEntry} onOpenChange={open => { if (!open) setEditEntry(null); }}>
      <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Correct time entry</DialogTitle></DialogHeader>
        <Notice>Do not estimate a missing clock-out. Enter the actual recorded time. A valid clock-out is required to save a correction.</Notice>
        <p className="text-xs text-muted-foreground">Clock times below use your device time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Daily totals use the pay period’s selected time zone.</p>
        {edit.isError && <MutationError error={edit.error} />}
        <label className="grid gap-1.5 text-sm font-medium">Clock in<Input type="datetime-local" value={editEntry?.inTime ?? ""} onChange={e => setEditEntry(p => p && ({ ...p, inTime: e.target.value }))} /></label>
        <label className="grid gap-1.5 text-sm font-medium">Clock out<Input type="datetime-local" value={editEntry?.outTime ?? ""} onChange={e => setEditEntry(p => p && ({ ...p, outTime: e.target.value }))} /></label>
        <label className="grid gap-1.5 text-sm font-medium">Reason<Input value={editEntry?.reason ?? ""} onChange={e => setEditEntry(p => p && ({ ...p, reason: e.target.value }))} placeholder="Why this entry is being corrected" /></label>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setEditEntry(null)}>Cancel</Button><Button type="button" disabled={!editEntry?.inTime || !editEntry?.outTime || !editEntry?.reason.trim() || edit.isPending} onClick={() => edit.mutate()}>Save correction</Button></div>
      </DialogContent>
    </Dialog>
    <Dialog open={!!rateEdit} onOpenChange={open => { if (!open) setRateEdit(null); }}>
      <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Set contractor rate</DialogTitle></DialogHeader>
        {saveRate.isError && <MutationError error={saveRate.error} />}
        <label className="grid gap-1.5 text-sm font-medium">Hourly rate (USD)<Input type="number" min="0.01" step="0.01" value={rateEdit?.rate ?? ""} onChange={e => setRateEdit(p => p && ({ ...p, rate: e.target.value }))} /></label>
        <label className="grid gap-1.5 text-sm font-medium">Reason<Input value={rateEdit?.reason ?? ""} onChange={e => setRateEdit(p => p && ({ ...p, reason: e.target.value }))} /></label>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setRateEdit(null)}>Cancel</Button><Button type="button" disabled={!rateEdit?.rate || !Number.isFinite(Number(rateEdit.rate)) || Number(rateEdit.rate) <= 0 || !rateEdit?.reason.trim() || saveRate.isPending} onClick={() => saveRate.mutate()}>Save rate</Button></div>
      </DialogContent>
    </Dialog>
    <IssueStatementDialog periodId={periodId} contractor={issueContractor} onClose={() => setIssueContractor(null)} />
  </section>;
}

function UnlockButton({ onUnlock, pending }: { onUnlock: (reason: string) => void; pending: boolean }) {
  const [reason, setReason] = useState("");
  return <div className="flex flex-wrap justify-end gap-2">
    <Input aria-label="Unlock reason" className="w-full sm:w-48" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason required to unlock" />
    <Button type="button" variant="outline" disabled={!reason.trim() || pending} onClick={() => onUnlock(reason.trim())}><UnlockKeyhole className="mr-1.5 h-4 w-4" />Unlock</Button>
  </div>;
}

function toLocalInput(value: string) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function dateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function ContractorReview({ person, locked, onApprove, approving, onEdit, onIssue, openIssue, existingStatement, onReissue }: {
  person: ContractorHours; locked: boolean; onApprove: () => void; approving: boolean; onEdit: (entry: ContractorHours["entries"][number]) => void;
  onIssue: PayrollAdminData["contractors"][number] | null; openIssue: (contractor: PayrollAdminData["contractors"][number]) => void;
  existingStatement: PayStatement | null; onReissue: (statement: PayStatement) => void;
}) {
  const flags = [...new Set([...person.flags, ...person.entries.flatMap(e => e.flags)])];
  return <article className="rounded-xl border border-border/60 p-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="font-semibold">{person.name}</div><div className="mt-1 text-sm tabular-nums">{person.decimalHours} hours <span className="text-muted-foreground">({person.hoursDisplay})</span></div></div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={person.approved ? "success" : "warning"}>{person.approved ? "Approved" : "Needs approval"}</Badge>
        {!locked && <Button type="button" size="sm" disabled={person.approved || approving || flags.length > 0 || person.entries.some(e => !e.clockOutTime)} onClick={onApprove}><Check className="mr-1 h-4 w-4" />Approve</Button>}
        {locked && person.approved && onIssue && (existingStatement
          ? <Button type="button" size="sm" onClick={() => onReissue(existingStatement)}>Replace statement</Button>
          : <Button type="button" size="sm" disabled={onIssue.rateCents == null} onClick={() => openIssue(onIssue)}>Issue statement</Button>)}
      </div>
    </div>
    {flags.length > 0 && <div className="mt-3 space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{flags.map((flag, i) => <div key={`${flag}-${i}`} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{flag}</div>)}</div>}
    <div className="mt-3 grid gap-3 lg:grid-cols-[.7fr_1.3fr]">
      <div><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Daily totals</div>
        {person.daily.length ? person.daily.map(day => <div key={day.date} className="flex justify-between border-t border-border/40 py-1 text-xs"><span>{dateLabel(day.date)}</span><span className="tabular-nums">{(day.minutes/60).toFixed(2)} h · {Math.floor(day.minutes/60)}:{String(day.minutes%60).padStart(2,"0")}</span></div>) : <div className="text-xs text-muted-foreground">No recorded work days.</div>}
      </div>
      <div><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Time entries</div>
        {person.entries.length ? <div className="space-y-1.5">{person.entries.map(entry => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/35 px-2 py-1.5 text-xs">
          <div><span>{timestampLabel(entry.clockInTime)}</span><span className="px-1 text-muted-foreground">→</span><span>{entry.clockOutTime ? timestampLabel(entry.clockOutTime) : <strong className="text-rose-700">Missing clock-out</strong>}</span>
            {!!entry.flags.length && <div className="mt-1 text-amber-800">{entry.flags.join(" · ")}</div>}
          </div>
          {!locked && <Button type="button" variant="outline" size="sm" onClick={() => onEdit(entry)}>Correct</Button>}
        </div>)}</div> : <div className="text-xs text-muted-foreground">No time entries.</div>}
      </div>
    </div>
    {person.approved && person.approvedAt && <div className="mt-2 text-[11px] text-muted-foreground">Approved by {person.approvedBy ?? "administrator"} · {timestampLabel(person.approvedAt)}</div>}
  </article>;
}
