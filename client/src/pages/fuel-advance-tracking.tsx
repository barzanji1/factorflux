import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { FundingButton as Button, FundingCard as Card, FundingInput as Input, FundingSelectTrigger as SelectTrigger, FundingSelectContent as SelectContent } from "@/components/funding/funding-controls";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectItem, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Eye, FileText, Pencil, Plus, RotateCcw } from "lucide-react";
import "@/components/funding/funding-neu.css";
import { NeuPageShell, NeuTable } from "@/styles/neu/components";

type RecordValue = Record<string, any>;
type FormState = {
  type: string; loadNumber: string; carrierId: string; brokerId: string; rate: string;
  advanceAmount: string; faPercent: string; paymentMethod: string; deliveryDate: string;
  code: string; referenceNumber: string; rateCon: File | null;
};
const emptyForm = (): FormState => ({
  type: "Fuel Advance", loadNumber: "", carrierId: "", brokerId: "", rate: "",
  advanceAmount: "", faPercent: "2", paymentMethod: "ACH", deliveryDate: "",
  code: "", referenceNumber: "", rateCon: null,
});
const records = (value: any): RecordValue[] => Array.isArray(value) ? value : value?.items || value?.data || [];
const money = (value: any) => value === null || value === undefined || value === ""
  ? "—"
  : `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const percent = (value: any) => value === null || value === undefined || value === "" ? "—" : `${Number(value)}%`;
const displayDate = (value: any) => value ? new Date(value).toLocaleDateString("en-US") : "—";
const valueOf = (row: RecordValue, ...keys: string[]) =>
  keys.map((key) => row[key]).find((value) => value !== undefined && value !== null && value !== "") || "—";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

export default function FuelAdvanceTracking() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const [location, navigate] = useLocation();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RecordValue | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [search, setSearch] = useState("");
  const set = (key: keyof FormState, value: any) => setForm((current) => ({ ...current, [key]: value }));
  const { data: advances = [], isLoading } = useQuery<RecordValue[]>({ queryKey: ["/api/fuel-advances"] });
  const fetchAll = async (url: string) => {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error("Could not load options");
    return records(await response.json());
  };
  const { data: carriers = [] } = useQuery({ queryKey: ["/api/clients", { all: true }], queryFn: () => fetchAll("/api/clients?all=true") });
  const { data: brokers = [] } = useQuery({ queryKey: ["/api/brokers", { all: true }], queryFn: () => fetchAll("/api/brokers?all=true") });
  const { data: loads = [] } = useQuery({ queryKey: ["/api/loads", { all: true }], queryFn: () => fetchAll("/api/loads?all=true") });
  const carrier = carriers.find((item: RecordValue) => String(item.id) === form.carrierId);
  const maxAdvance = Number(form.rate || 0) * 0.5;
  const fees = Number(form.advanceAmount || 0) * Number(form.faPercent || 0) / 100;
  const filtered = useMemo(
    () => advances.filter((row) => JSON.stringify(row).toLowerCase().includes(search.toLowerCase())),
    [advances, search],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        const payload = { ...form, rateCon: undefined, processedBy: user?.id || "" };
        const response = await fetch(`/api/fuel-advances/${editing.id}`, {
          method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await response.text());
        const updated = await response.json();
        if (form.rateCon) {
          const upload = new FormData();
          upload.append("file", form.rateCon);
          const uploadResponse = await fetch(`/api/fuel-advances/${editing.id}/rate-con`, {
            method: "POST",
            credentials: "include",
            body: upload,
          });
          if (!uploadResponse.ok) throw new Error(await uploadResponse.text());
          return uploadResponse.json();
        }
        return updated;
      }
      const body = new FormData();
      Object.entries({ ...form, rateCon: undefined, processedBy: user?.id || "" })
        .forEach(([key, value]) => value !== undefined && value !== null && body.append(key, String(value)));
      if (form.rateCon) body.append("rateCon", form.rateCon);
      const response = await fetch("/api/fuel-advances", { method: "POST", credentials: "include", body });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/fuel-advances"] });
      setFormOpen(false); setEditing(null); setForm(emptyForm());
      toast({ title: editing ? "Fuel advance updated" : "Fuel advance submitted" });
    },
    onError: (error: Error) => toast({ title: "Could not save advance", description: error.message, variant: "destructive" }),
  });
  const toggle = useMutation({
    mutationFn: async ({ id, field, value }: { id: number; field: string; value: boolean }) => {
      const response = await fetch(`/api/fuel-advances/${id}`, {
        method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!response.ok) throw new Error("Toggle failed");
      return response.json();
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["/api/fuel-advances"] });
      toast({ title: variables.field === "deliveryVerified" ? "Delivery verification updated" : "Paid status updated" });
    },
    onError: () => toast({ title: "Could not update status", variant: "destructive" }),
  });
  const openCreate = () => { setEditing(null); setForm(emptyForm()); setFormOpen(true); };
  const openEdit = (row: RecordValue) => {
    setEditing(row);
    setForm({
      type: row.type || "Fuel Advance", loadNumber: String(row.loadNumber ?? row.loadId ?? ""),
      carrierId: String(row.carrierId ?? ""), brokerId: String(row.brokerId ?? ""),
      rate: String(row.rate ?? ""), advanceAmount: String(row.advanceAmount ?? ""),
      faPercent: String(row.faPercent ?? "2"), paymentMethod: row.paymentMethod || "ACH",
      deliveryDate: row.deliveryDate ? String(row.deliveryDate).slice(0, 10) : "",
      code: row.code || "", referenceNumber: row.referenceNumber || "", rateCon: null,
    });
    setFormOpen(true);
  };
  useEffect(() => {
    const editId = new URLSearchParams(location.split("?")[1] || "").get("edit");
    const row = editId && advances.find((item) => String(item.id) === editId);
    if (row && !formOpen) {
      openEdit(row);
      navigate("/fuel-advance", { replace: true });
    }
  }, [location, advances]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.loadNumber || !form.carrierId || !form.brokerId || !form.rate || !form.advanceAmount) {
      toast({ title: "Complete all required fields", variant: "destructive" }); return;
    }
    if (Number(form.advanceAmount) > maxAdvance) {
      toast({ title: "Advance cannot exceed the 50% maximum", variant: "destructive" }); return;
    }
    if (form.rateCon && form.rateCon.type !== "application/pdf") {
      toast({ title: "Rate confirmation must be a PDF", variant: "destructive" }); return;
    }
    save.mutate();
  };

  return <div className="funding-neu-page ff-fuel-advance-page flex min-h-screen bg-[#d4d0c8] text-[#263b44]">
    <Sidebar />
    <div className="flex min-w-0 flex-1 flex-col">
      <TopNav title="Fuel Advance Tracking" subtitle="Review and submit carrier advances" group="Funding" neu />
      <NeuPageShell className="flex-1 overflow-auto p-3 md:p-5"><div className="mx-auto max-w-[1600px] space-y-3">
        <div className="ff-card ff-fuel-advance-surface flex flex-wrap items-center justify-between gap-2 border border-[#718087] bg-white p-3">
          <div><h2 className="font-bold">Fuel Advances</h2><p className="text-xs text-[#63767d]">Advances, fees, deposits and payment status</p></div>
          <Button onClick={openCreate}><Plus className="mr-1 h-4 w-4" />New advance</Button>
        </div>
        <Card className="ff-fuel-advance-surface overflow-hidden border-[#9eabad]">
          <CardHeader className="pb-2"><div className="flex items-center justify-between"><CardTitle className="text-sm">Advance ledger</CardTitle><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search records..." className="h-8 max-w-xs" /></div></CardHeader>
          <CardContent className="p-0"><div className="overflow-x-auto"><NeuTable className="ff-data-table w-full min-w-[1500px] text-left text-[11px]">
            <thead className="bg-[#f0f4f3] text-[9px] uppercase text-[#63767d]"><tr>{["Carrier", "Broker", "Load", "Code", "Rate", "%", "Factored", "Fees", "Method", "DV", "Reference#", "Delivering date", "Date", "Agent", "Paid", "Account", "Actions"].map((heading) => <th key={heading} className="whitespace-nowrap px-2 py-2">{heading}</th>)}</tr></thead>
            <tbody>{isLoading ? <tr><td colSpan={17} className="p-8 text-center">Loading advances…</td></tr> : filtered.map((row) => <tr key={row.id} className="border-t border-[#e1e6e7]">
              <td className="px-2 py-2">{valueOf(row, "carrierName", "carrier")}</td><td className="px-2 py-2">{valueOf(row, "brokerName", "broker")}</td>
              <td className="px-2 py-2">{valueOf(row, "loadNumber", "loadId")}</td><td className="px-2 py-2">{valueOf(row, "code")}</td><td className="px-2 py-2">{money(row.rate)}</td>
              <td className="px-2 py-2">{percent(row.faPercent)}</td><td className="px-2 py-2">{money(row.advanceAmount)}</td><td className="px-2 py-2">{money(row.fees)}</td><td className="px-2 py-2"><span className={`ff-badge ${row.paymentMethod === "Wire" ? "ff-badge-pending" : "ff-badge-approved"}`}>{valueOf(row, "paymentMethod")}</span></td>
              <td className="px-2 py-2"><Checkbox aria-label={`Delivery verified for ${valueOf(row, "loadNumber", "loadId")}`} checked={!!row.deliveryVerified} onCheckedChange={(checked) => toggle.mutate({ id: row.id, field: "deliveryVerified", value: checked === true })} /></td>
              <td className="px-2 py-2">{valueOf(row, "referenceNumber")}</td><td className="px-2 py-2">{displayDate(row.deliveryDate)}</td><td className="px-2 py-2">{displayDate(row.createdAt || row.advanceDate)}</td><td className="px-2 py-2">{valueOf(row, "authorizedAgentName", "processedByName", "processedBy")}</td>
              <td className="px-2 py-2"><Checkbox aria-label={`Paid status for ${valueOf(row, "loadNumber", "loadId")}`} checked={!!row.paid} onCheckedChange={(checked) => toggle.mutate({ id: row.id, field: "paid", value: checked === true })} /></td><td className="px-2 py-2">{valueOf(row, "account", "accountNumber")}</td>
              <td className="px-2 py-2"><span className="flex gap-1"><Button variant="outline" size="sm" title="Edit" onClick={() => openEdit(row)}><Pencil className="h-3.5 w-3.5" /></Button><Link href={`/fuel-advance/${row.id}`}><Button variant="outline" size="sm" title="View details"><Eye className="h-3.5 w-3.5" /></Button></Link><a href={`/api/fuel-advances/${row.id}/deposit-slip`} target="_blank" rel="noreferrer"><Button variant="outline" size="sm" title="Open deposit slip"><FileText className="h-3.5 w-3.5" /></Button></a></span></td>
            </tr>)}</tbody>
          </NeuTable></div>{!isLoading && !filtered.length && <p className="p-8 text-center text-sm text-[#63767d]">No fuel advances found.</p>}</CardContent>
        </Card>
        {formOpen && <Card className="ff-fuel-advance-surface border-[#718087]"><CardHeader><CardTitle className="text-base">{editing ? "Edit fuel advance" : "New fuel advance"}</CardTitle></CardHeader><CardContent>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Type"><Select value={form.type} onValueChange={(value) => set("type", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Fuel Advance">Fuel Advance</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent></Select></Field>
            <Field label="Load # *"><Input required value={form.loadNumber} onChange={(event) => set("loadNumber", event.target.value)} list="loads" /><datalist id="loads">{loads.map((load: RecordValue) => <option key={load.id} value={load.loadNumber || load.id} />)}</datalist></Field>
            <Field label="Carrier *"><Select value={form.carrierId} onValueChange={(value) => { set("carrierId", value); const selected = carriers.find((item: RecordValue) => String(item.id) === value); const merged = { ...(selected?.onboardingData || {}), ...(selected?.onboardingProfile || {}) }; set("faPercent", String(merged.faPercent ?? merged.advanceFeePercent ?? merged.fuelAdvancePercent ?? "2")); }}><SelectTrigger><SelectValue placeholder="Select carrier" /></SelectTrigger><SelectContent>{carriers.map((item: RecordValue) => <SelectItem key={item.id} value={String(item.id)}>{item.name || item.companyName}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Broker *"><Select value={form.brokerId} onValueChange={(value) => set("brokerId", value)}><SelectTrigger><SelectValue placeholder="Select broker" /></SelectTrigger><SelectContent>{brokers.map((item: RecordValue) => <SelectItem key={item.id} value={String(item.id)}>{item.name || item.companyName}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Rate *"><Input required type="number" min="0" step="0.01" value={form.rate} onChange={(event) => set("rate", event.target.value)} /></Field><Field label="Max Advance"><Input readOnly value={`${money(maxAdvance)} (50%)`} /></Field>
            <Field label="Advance amount *"><Input required type="number" min="0.01" max={maxAdvance} step="0.01" value={form.advanceAmount} onChange={(event) => set("advanceAmount", event.target.value)} /><small className="text-xs text-[#63767d]">Maximum: {money(maxAdvance)}</small></Field>
            <Field label="FA %"><Input type="number" min="0" value={form.faPercent} onChange={(event) => set("faPercent", event.target.value)} /></Field><Field label="Fees"><Input readOnly value={money(fees)} /></Field><Field label="Owed"><Input readOnly value={money(Number(form.advanceAmount || 0) + fees)} /></Field>
            <Field label="Method"><Select value={form.paymentMethod} onValueChange={(value) => set("paymentMethod", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ACH">ACH</SelectItem><SelectItem value="Wire">Wire</SelectItem></SelectContent></Select></Field><Field label="Delivering date"><Input type="date" value={form.deliveryDate} onChange={(event) => set("deliveryDate", event.target.value)} /></Field><Field label="Code"><Input value={form.code} onChange={(event) => set("code", event.target.value)} /></Field><Field label="Reference#"><Input value={form.referenceNumber} onChange={(event) => set("referenceNumber", event.target.value)} /></Field>
            <Field label="Current agent"><Input readOnly value={[user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "Current agent"} /></Field><Field label="Rate con (PDF only)"><Input type="file" accept="application/pdf,.pdf" onChange={(event) => set("rateCon", event.target.files?.[0] || null)} /><small className="text-xs text-[#63767d]">PDF files only.</small></Field>
            <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><Button type="submit" disabled={save.isPending}>Submit</Button><Button type="button" variant="outline" onClick={() => setForm(emptyForm())}><RotateCcw className="mr-1 h-4 w-4" />Reset</Button><Button type="button" variant="outline" onClick={() => { setFormOpen(false); setEditing(null); }}>Cancel</Button></div>
          </form>
        </CardContent></Card>}
      </div></NeuPageShell>
    </div>
  </div>;
}