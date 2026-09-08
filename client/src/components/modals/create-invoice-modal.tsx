import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Building2, CheckCircle2, Search, ShieldAlert, Truck, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Carrier = {
  id: number; name: string; status?: string | null; mcNumber?: string | null;
  email?: string | null; phone?: string | null; advanceRate?: string | null;
  factoringFeeRate?: string | null; notes?: string | null;
};
type Broker = {
  id: number; name: string; status?: string | null; mcNumber?: string | null;
  email?: string | null; phone?: string | null; creditLimit?: string | null;
  averageDaysToPay?: number | null; notes?: string | null;
};

const EMPTY = {
  loadNumber: "", clientId: "", debtorId: "", branchName: "",
  buyout: "", amount: "", paymentType: "ACH",
};

function SearchSelect<T extends { id: number; name: string }>({
  label, required, items, selected, onSelect, placeholder,
}: {
  label: string; required?: boolean; items: T[]; selected?: T;
  onSelect: (item: T) => void; placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = useMemo(
    () => items.filter(item => item.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8),
    [items, query],
  );
  return (
    <div className="relative space-y-1.5">
      <Label>{label}{required && <span className="text-red-500"> *</span>}</Label>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={open ? query : selected?.name ?? ""}
          placeholder={placeholder}
          onFocus={() => { setQuery(""); setOpen(true); }}
          onChange={event => { setQuery(event.target.value); setOpen(true); }}
          className="h-11 pl-9"
        />
        {selected && !open && (
          <button type="button" aria-label={`Clear ${label}`} onClick={() => setOpen(true)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-xl border bg-white p-1 shadow-xl dark:bg-slate-950">
          {filtered.length ? filtered.map(item => (
            <button key={item.id} type="button"
              onClick={() => { onSelect(item); setOpen(false); setQuery(""); }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800">
              <span className="font-medium">{item.name}</span>
              <span className="text-xs capitalize text-slate-400">{(item as any).status ?? ""}</span>
            </button>
          )) : <p className="px-3 py-4 text-center text-xs text-slate-500">No matches found</p>}
        </div>
      )}
    </div>
  );
}

function StatusPanel({ kind, record }: { kind: "carrier" | "broker"; record?: Carrier | Broker }) {
  const isCarrier = kind === "carrier";
  const status = record?.status ?? "Not selected";
  const favorable = status === "active" || status === "approved";
  return (
    <aside className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/50">
      <div className="mb-4 flex items-center gap-2">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", isCarrier ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700")}>
          {isCarrier ? <Truck className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
        </div>
        <div>
          <p className="text-sm font-semibold">{isCarrier ? "Carrier Status" : "Broker Status"}</p>
          <p className="text-xs text-slate-500">Selection review</p>
        </div>
      </div>
      {!record ? (
        <p className="rounded-xl border border-dashed px-3 py-6 text-center text-xs text-slate-500">
          Select a {kind} to view status and messages.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="truncate pr-2 text-sm font-semibold">{record.name}</span>
            <Badge className={cn("capitalize", favorable ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800")}>
              {status.replace(/_/g, " ")}
            </Badge>
          </div>
          <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
            <p>MC#: <strong>{record.mcNumber || "Not recorded"}</strong></p>
            {isCarrier ? (
              <>
                <p>Advance: <strong>{(record as Carrier).advanceRate || "—"}%</strong></p>
                <p>Fee: <strong>{(record as Carrier).factoringFeeRate || "—"}%</strong></p>
              </>
            ) : (
              <>
                <p>Credit limit: <strong>{(record as Broker).creditLimit ? `$${Number((record as Broker).creditLimit).toLocaleString()}` : "Not set"}</strong></p>
                <p>Average pay: <strong>{(record as Broker).averageDaysToPay ?? "—"} days</strong></p>
              </>
            )}
          </div>
          <div className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-xs", favorable ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800")}>
            {favorable ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{record.notes || (favorable ? `${isCarrier ? "Carrier" : "Broker"} is active with no recorded holds.` : `Review ${kind} status before proceeding.`)}</span>
          </div>
        </div>
      )}
    </aside>
  );
}

export default function CreateInvoiceModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [values, setValues] = useState(EMPTY);
  const { data: carriersData = [] } = useQuery<Carrier[]>({ queryKey: ["/api/clients"], enabled: open });
  const { data: brokersData = [] } = useQuery<Broker[]>({ queryKey: ["/api/debtors"], enabled: open });
  const carriers = Array.isArray(carriersData) ? carriersData : [];
  const brokers = Array.isArray(brokersData) ? brokersData : [];
  const carrier = carriers.find(item => String(item.id) === values.clientId);
  const broker = brokers.find(item => String(item.id) === values.debtorId);

  useEffect(() => { if (!open) setValues(EMPTY); }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/invoices", {
        loadNumber: values.loadNumber.trim(),
        clientId: Number(values.clientId),
        debtorId: Number(values.debtorId),
        branchName: values.branchName.trim() || null,
        buyout: values.buyout === "" ? null : values.buyout === "yes",
        amount: values.amount,
        paymentType: values.paymentType,
      });
      return response.json();
    },
    onSuccess: invoice => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice created", description: "The invoice is now pending review." });
      onOpenChange(false);
      navigate(`/invoices/${invoice.id}`);
    },
    onError: (error: Error) => toast({ title: "Unable to create invoice", description: error.message, variant: "destructive" }),
  });

  const valid = values.loadNumber.trim() && values.clientId && values.debtorId && Number(values.amount) > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto rounded-3xl p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="text-xl">Create Invoice</DialogTitle>
          <DialogDescription>Enter the load details. The invoice will immediately enter Pending Review.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 p-6 lg:grid-cols-[240px_minmax(0,1fr)_240px]">
          <StatusPanel kind="broker" record={broker} />
          <form className="space-y-5" onSubmit={event => { event.preventDefault(); if (valid) mutation.mutate(); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="loadNumber">Load # <span className="text-red-500">*</span></Label>
                <Input id="loadNumber" required value={values.loadNumber} onChange={e => setValues(v => ({ ...v, loadNumber: e.target.value }))} placeholder="Enter load number" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="amount">Invoice Amount <span className="text-red-500">*</span></Label>
                <Input id="amount" required min="0.01" step="0.01" type="number" value={values.amount} onChange={e => setValues(v => ({ ...v, amount: e.target.value }))} placeholder="0.00" />
              </div>
              <SearchSelect label="Carrier" required items={carriers} selected={carrier} onSelect={item => setValues(v => ({ ...v, clientId: String(item.id) }))} placeholder="Search carriers..." />
              <SearchSelect label="Broker" required items={brokers} selected={broker} onSelect={item => setValues(v => ({ ...v, debtorId: String(item.id) }))} placeholder="Search brokers..." />
              <div className="space-y-1.5">
                <Label htmlFor="branchName">Branch Name</Label>
                <Input id="branchName" value={values.branchName} onChange={e => setValues(v => ({ ...v, branchName: e.target.value }))} placeholder="Enter branch name" />
              </div>
              <div className="space-y-1.5">
                <Label>Buyout</Label>
                <Select value={values.buyout} onValueChange={buyout => setValues(v => ({ ...v, buyout }))}>
                  <SelectTrigger><SelectValue placeholder="Select Yes or No" /></SelectTrigger>
                  <SelectContent><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Payment Type</Label>
                <Select value={values.paymentType} onValueChange={paymentType => setValues(v => ({ ...v, paymentType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ACH">ACH</SelectItem><SelectItem value="Wire">Wire</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t pt-5">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="button" variant="outline" onClick={() => setValues(EMPTY)}>Reset</Button>
              <Button type="submit" disabled={!valid || mutation.isPending} className="bg-blue-600 px-6 text-white hover:bg-blue-700">
                {mutation.isPending ? "Creating..." : "Submit"}
              </Button>
            </div>
          </form>
          <StatusPanel kind="carrier" record={carrier} />
        </div>
      </DialogContent>
    </Dialog>
  );
}