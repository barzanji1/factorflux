import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Building2, CheckCircle2, Search, ShieldAlert, Truck, Upload, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { apiRequest, HttpError, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { displayLoadType, isLoadType } from "@shared/load-types";
import { LoadTypeToggleGroup } from "@/components/load-type";

type Carrier = {
  id: number; name: string; status?: string | null; mcNumber?: string | null;
  email?: string | null; phone?: string | null; advanceRate?: string | null;
  factoringFeeRate?: string | null; notes?: string | null; cargoType?: string | null;
};
type Broker = {
  id: number; name: string; status?: string | null; mcNumber?: string | null;
  email?: string | null; phone?: string | null; creditLimit?: string | null;
  averageDaysToPay?: number | null; notes?: string | null; creditGrade?: string | null; creditScore?: number | null;
};
type Driver = { id: number; carrierId: number; firstName: string; lastName: string; status?: string | null };
type PaperworkKey = "rateConfirmation" | "billOfLading" | "lumperReceipt" | "other";
const PAPERWORK: Array<{ key: PaperworkKey; label: string; required?: boolean }> = [
  { key: "rateConfirmation", label: "Rate Confirmation", required: true },
  { key: "billOfLading", label: "Bill of Lading", required: true },
  { key: "lumperReceipt", label: "Lumper Receipt" },
  { key: "other", label: "Other" },
];
const MAX_PDF_SIZE = 5 * 1024 * 1024;

type PreflightAlert = {
  code: string;
  severity: "block" | "ack" | "info";
  title: string;
  message: string;
  link?: string | null;
  invoiceId?: number | string;
  invoiceNumber?: string;
};

const EMPTY = {
  invoiceNumber: "", loadNumber: "", code: "", clientId: "", brokerId: "", branchId: "",
  buyout: "", lumper: "", amount: "", paymentType: "ACH", bankAccountId: "", loadType: "other",
  driverId: "", driverName: "", instructionsSubject: "", instructionsDetails: "",
};

function formatFileSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function PaperworkDropzone({
  label, required, file, onFile, onRemove, onInvalid,
}: {
  label: string; required?: boolean; file: File | null;
  onFile: (file: File) => void; onRemove: () => void; onInvalid: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const validate = async (candidate: File) => {
    if (candidate.type !== "application/pdf" || !candidate.name.toLowerCase().endsWith(".pdf")) {
      onInvalid(`${label} must be a PDF file.`);
      return;
    }
    if (candidate.size > MAX_PDF_SIZE) {
      onInvalid(`${label} must be 5MB or smaller.`);
      return;
    }
    try {
      const bytes = new Uint8Array(await candidate.slice(0, 5).arrayBuffer());
      if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]) !== "%PDF-") {
        onInvalid(`${label} is not a valid PDF.`);
        return;
      }
      onFile(candidate);
    } catch {
      onInvalid(`${label} could not be read.`);
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Upload ${label}${required ? ", required" : ""}`}
      onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && !file) { event.preventDefault(); inputRef.current?.click(); } }}
      onClick={() => !file && inputRef.current?.click()}
      onDragOver={event => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); const dropped = event.dataTransfer.files[0]; if (dropped) void validate(dropped); }}
      className={cn("rounded-xl border border-dashed p-3 transition-colors", dragging ? "border-blue-500 bg-blue-50" : file ? "border-emerald-400 bg-emerald-50/70" : "border-slate-300 hover:border-blue-400")}
    >
      <input ref={inputRef} type="file" className="hidden" accept="application/pdf,.pdf" onChange={event => {
        const selected = event.target.files?.[0];
        if (selected) void validate(selected);
        event.currentTarget.value = "";
      }} />
      {file ? (
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{file.name}</p><p className="text-[11px] text-slate-500">{formatFileSize(file.size)}</p></div>
          <button type="button" aria-label={`Remove ${label}`} className="rounded p-1 text-slate-500 hover:bg-white" onClick={event => { event.stopPropagation(); onRemove(); }}><X className="h-4 w-4" /></button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5"><Upload className="h-5 w-5 text-slate-500" /><span className="text-xs font-medium">{label}{required && <span className="text-red-500"> *</span>}</span></div>
      )}
    </div>
  );
}

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
  const brokerRecord = !isCarrier && record ? record as Broker : undefined;
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
          {!isCarrier && (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
              <span className="text-xs text-slate-500">Credit grade</span>
               <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", brokerRecord?.creditGrade === "A" ? "bg-emerald-100 text-emerald-700" : brokerRecord?.creditGrade === "B" ? "bg-teal-100 text-teal-700" : brokerRecord?.creditGrade === "C" ? "bg-yellow-100 text-yellow-700" : brokerRecord?.creditGrade === "D" ? "bg-orange-100 text-orange-700" : brokerRecord?.creditGrade === "F" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500")}>{brokerRecord?.creditGrade ?? "Not rated"}{brokerRecord?.creditScore != null && ` · ${brokerRecord.creditScore}`}</span>
            </div>
          )}
           {!isCarrier && (brokerRecord?.creditGrade === "D" || brokerRecord?.creditGrade === "F") && (
             <p className={cn("rounded-xl border px-3 py-2 text-xs font-semibold", brokerRecord.creditGrade === "F" ? "border-red-300 bg-red-50 text-red-800" : "border-orange-200 bg-orange-50 text-orange-800")}>
               {brokerRecord.creditGrade === "F"
                 ? "This broker is flagged as high risk."
                 : "This broker has a poor credit rating. Proceed with caution."}
             </p>
          )}
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

type InitialInvoiceValues = Partial<typeof EMPTY> & { brokerName?: string };

export default function CreateInvoiceModal({
  open, onOpenChange, initialValues,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValues?: InitialInvoiceValues;
}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const [values, setValues] = useState(EMPTY);
  const [preflightAlerts, setPreflightAlerts] = useState<PreflightAlert[]>([]);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState("");
  const [acknowledgements, setAcknowledgements] = useState<Record<string, { acknowledged: boolean; reason: string }>>({});
  const [overrideNearDuplicate, setOverrideNearDuplicate] = useState(false);
  const preflightRequestId = useRef(0);
  const [selectedBroker, setSelectedBroker] = useState<Broker>();
  const [brokerSearch, setBrokerSearch] = useState("");
  const [brokerQuery, setBrokerQuery] = useState("");
  const [brokerOpen, setBrokerOpen] = useState(false);
  const [paperwork, setPaperwork] = useState<Record<PaperworkKey, File | null>>({
    rateConfirmation: null, billOfLading: null, lumperReceipt: null, other: null,
  });
  const { data: carriersData = [] } = useQuery<Carrier[]>({ queryKey: ["/api/clients", { all: true }], enabled: open });
  useEffect(() => {
    const timer = window.setTimeout(() => setBrokerQuery(brokerSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [brokerSearch]);
  const { data: brokersResponse } = useQuery<{ data?: Broker[] } | Broker[]>({
    queryKey: ["/api/brokers", brokerQuery, "active", 8],
    queryFn: async () => {
      const params = new URLSearchParams({ status: "active", limit: "8" });
      if (brokerQuery) params.set("q", brokerQuery);
      const response = await fetch(`/api/brokers?${params.toString()}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load brokers");
      return response.json();
    },
    enabled: open,
  });
  const { data: branchesData = [], isLoading: branchesLoading, isError: branchesError } = useQuery<any[]>({
    queryKey: ["/api/brokers", values.brokerId, "branches"],
    queryFn: async () => {
      const response = await fetch(`/api/brokers/${values.brokerId}/branches`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load branches");
      const payload = await response.json();
      return Array.isArray(payload) ? payload : payload.data ?? [];
    },
    enabled: open && !!values.brokerId,
  });
  const { data: bankAccountsData = [] } = useQuery<Array<{
    id: number; bankName?: string | null; accountType?: string | null; lastFour?: string | null;
  }>>({
    queryKey: ["/api/carriers", values.clientId, "bank-accounts"],
    queryFn: async () => {
      const response = await fetch(`/api/carriers/${values.clientId}/bank-accounts`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load bank accounts");
      return response.json();
    },
    enabled: open && !!values.clientId && values.paymentType === "ACH",
  });
  const { data: driversData = [] } = useQuery<Driver[]>({
    queryKey: ["/api/drivers", values.clientId],
    queryFn: async () => {
      const response = await fetch(`/api/drivers?carrierId=${values.clientId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load drivers");
      return response.json();
    },
    enabled: open && !!values.clientId,
  });
  const carriers = Array.isArray(carriersData) ? carriersData : [];
  const brokers = (Array.isArray(brokersResponse) ? brokersResponse : brokersResponse?.data ?? []).filter(item => item.status === "active");
  const branches = (Array.isArray(branchesData) ? branchesData : []).filter(branch => branch.status === "active");
  const bankAccounts = Array.isArray(bankAccountsData) ? bankAccountsData : [];
  const carrier = carriers.find(item => String(item.id) === values.clientId);
  const broker = selectedBroker ?? brokers.find(item => String(item.id) === values.brokerId);
  const drivers = driversData.filter(driver => driver.status === "active");

  const invalidatePreflightAcknowledgements = () => {
    preflightRequestId.current += 1;
    setPreflightLoading(false);
    setPreflightError("");
    setAcknowledgements({});
    setOverrideNearDuplicate(false);
  };

  const runPreflight = async (overrides: Partial<typeof values> = {}, openModal = true) => {
    const candidate = { ...values, ...overrides };
    if (!candidate.clientId && !candidate.brokerId) return;
    const requestId = ++preflightRequestId.current;
    setPreflightLoading(true);
    setPreflightError("");
    try {
      const response = await fetch("/api/invoices/preflight", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrierId: candidate.clientId ? Number(candidate.clientId) : undefined,
          brokerId: candidate.brokerId ? Number(candidate.brokerId) : undefined,
          invoiceNumber: candidate.invoiceNumber.trim() || undefined,
          loadNumber: candidate.loadNumber.trim() || undefined,
          amount: candidate.amount ? Number(candidate.amount) : undefined,
          serviceDate: new Date().toISOString().slice(0, 10),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `Preflight failed (${response.status}).`);
      if (requestId !== preflightRequestId.current) return;
      const alerts: PreflightAlert[] = Array.isArray(payload.alerts) ? payload.alerts : [];
      setPreflightAlerts(alerts);
      setAcknowledgements(current => {
        const next: typeof current = {};
        alerts.filter(alert => alert.severity === "ack").forEach(alert => {
          next[alert.code] = current[alert.code] ?? { acknowledged: false, reason: "" };
        });
        return next;
      });
      setOverrideNearDuplicate(false);
      if (openModal && alerts.some(alert => alert.severity !== "info")) setPreflightOpen(true);
    } catch (error) {
      if (requestId !== preflightRequestId.current) return;
      setPreflightError(error instanceof Error ? error.message : "Unable to check invoice alerts.");
      if (openModal) setPreflightOpen(true);
    } finally {
      if (requestId === preflightRequestId.current) setPreflightLoading(false);
    }
  };

  useEffect(() => {
    if (branches.length === 1 && values.branchId !== String(branches[0].id)) {
      setValues(v => ({ ...v, branchId: String(branches[0].id) }));
    } else if (values.branchId && !branches.some(branch => String(branch.id) === values.branchId)) {
      setValues(v => ({ ...v, branchId: "" }));
    }
  }, [branches, values.branchId]);

  useEffect(() => {
    if (open && initialValues) {
      setValues({ ...EMPTY, ...initialValues });
      if (initialValues.brokerId && initialValues.brokerName) {
        setSelectedBroker({ id: Number(initialValues.brokerId), name: initialValues.brokerName });
      }
    } else if (!open) {
      preflightRequestId.current += 1;
      setPreflightLoading(false);
      setValues(EMPTY);
      setPreflightAlerts([]);
      setPreflightOpen(false);
      setPreflightError("");
      setAcknowledgements({});
      setOverrideNearDuplicate(false);
      setSelectedBroker(undefined);
      setBrokerSearch("");
      setBrokerOpen(false);
      setPaperwork({ rateConfirmation: null, billOfLading: null, lumperReceipt: null, other: null });
    }
  }, [open, initialValues]);

  const mutation = useMutation({
    mutationFn: async () => {
      const metadata = {
        invoiceNumber: values.invoiceNumber.trim() || undefined,
        loadNumber: values.loadNumber.trim(),
        clientId: Number(values.clientId),
        brokerId: Number(values.brokerId),
        branchId: Number(values.branchId),
        driverId: values.driverId ? Number(values.driverId) : null,
        driverName: values.driverName.trim() || null,
        code: values.code.trim() || null,
        buyout: values.buyout === "" ? null : values.buyout === "yes",
        lumper: values.lumper === "" ? null : values.lumper === "yes",
        amount: values.amount,
        acknowledgements: Object.entries(acknowledgements)
          .filter(([, acknowledgement]) => acknowledgement.acknowledged)
          .map(([code, acknowledgement]) => ({ code, reason: acknowledgement.reason.trim() || undefined })),
        overrideNearDuplicate: isManager && overrideNearDuplicate,
        paymentType: values.paymentType,
        bankAccountId: values.bankAccountId ? Number(values.bankAccountId) : null,
        loadType: values.loadType,
        instructionsSubject: values.instructionsSubject.trim() || null,
        instructionsDetails: values.instructionsDetails.trim() || null,
        sourceChannel: "drag_drop",
      };
      const formData = new FormData();
      formData.append("metadata", JSON.stringify(metadata));
      PAPERWORK.forEach(({ key }) => { const file = paperwork[key]; if (file) formData.append(key, file); });
      const response = await apiRequest("POST", "/api/invoices/with-documents", formData);
      return response.json();
    },
    onSuccess: invoice => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Invoice created", description: "The invoice is now pending review." });
      onOpenChange(false);
      navigate("/invoices");
    },
    onError: (error: Error) => {
      let body: any;
      try { body = JSON.parse(error.message); } catch { body = null; }
      const status = error instanceof HttpError ? error.status : (error as Error & { status?: number }).status;
      const alerts = Array.isArray(body) ? body : body?.alerts ?? body?.data?.alerts;
      if (status === 409 && Array.isArray(alerts)) {
        setPreflightAlerts(alerts);
        setPreflightOpen(true);
        setPreflightError("The server found invoice alerts that must be reviewed. Update your acknowledgements and try again.");
        // A 409 means the submitted acknowledgements were not sufficient for
        // this invoice; require explicit review of this server-returned list.
        setAcknowledgements(Object.fromEntries(
          alerts.filter((alert: PreflightAlert) => alert.severity === "ack")
            .map((alert: PreflightAlert) => [alert.code, { acknowledged: false, reason: "" }]),
        ));
        setOverrideNearDuplicate(false);
        return;
      }
      toast({ title: "Unable to create invoice", description: error.message, variant: "destructive" });
    },
  });

  const nearDuplicateAlert = preflightAlerts.some(alert => alert.code === "DUPLICATE_NEAR" && alert.severity === "block");
  const hasUnresolvedBlock = preflightAlerts.some(alert => alert.severity === "block"
    && !(alert.code === "DUPLICATE_NEAR" && isManager && overrideNearDuplicate));
  const hasUnacknowledgedAlert = preflightAlerts.some(alert => alert.severity === "ack"
    && !acknowledgements[alert.code]?.acknowledged);
  const valid = values.invoiceNumber.trim().length <= 100
    && values.loadNumber.trim() && values.clientId && values.brokerId && values.branchId
    && values.lumper && Number(values.amount) > 0 && isLoadType(values.loadType)
    && paperwork.rateConfirmation && paperwork.billOfLading
    && !hasUnresolvedBlock && !hasUnacknowledgedAlert;
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
            {preflightError && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{preflightError}</p>}
            {preflightAlerts.filter(alert => alert.severity === "info").map(alert => (
              <div key={alert.code} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
                <strong>{alert.title}</strong><p className="mt-1">{alert.message}</p>
              </div>
            ))}
            <div className="space-y-2">
              <Label>Load Type <span className="text-red-500">*</span></Label>
              <LoadTypeToggleGroup
                value={values.loadType}
                onChange={loadType => setValues(v => ({ ...v, loadType }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="invoiceNumber">Invoice # <span className="text-xs font-normal text-slate-500">(optional)</span></Label>
                <Input id="invoiceNumber" maxLength={100} value={values.invoiceNumber} onChange={e => { invalidatePreflightAcknowledgements(); setValues(v => ({ ...v, invoiceNumber: e.target.value })); }} onBlur={() => void runPreflight()} placeholder="Carrier invoice number" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loadNumber">Load # <span className="text-red-500">*</span></Label>
                <Input id="loadNumber" required value={values.loadNumber} onChange={e => { invalidatePreflightAcknowledgements(); setValues(v => ({ ...v, loadNumber: e.target.value })); }} onBlur={() => void runPreflight()} placeholder="Enter load number" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoiceCode">Code</Label>
                <Input id="invoiceCode" value={values.code} onChange={e => setValues(v => ({ ...v, code: e.target.value }))} placeholder="CA TO UT" />
              </div>
              <div className="space-y-1.5">
                <Label>Lumper <span className="text-red-500">*</span></Label>
                <Select value={values.lumper} onValueChange={lumper => setValues(v => ({ ...v, lumper }))}>
                  <SelectTrigger><SelectValue placeholder="Select Yes or No" /></SelectTrigger>
                  <SelectContent><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="amount">Invoice Amount <span className="text-red-500">*</span></Label>
                 <Input id="amount" required min="0.01" step="0.01" type="number" value={values.amount} onChange={e => { invalidatePreflightAcknowledgements(); setValues(v => ({ ...v, amount: e.target.value })); }} onBlur={() => void runPreflight()} placeholder="0.00" />
              </div>
               <SearchSelect
                 label="Carrier"
                 required
                 items={carriers}
                 selected={carrier}
                  onSelect={item => {
                    const next = {
                      ...values,
                      clientId: String(item.id),
                      driverId: "",
                      loadType: displayLoadType(item.cargoType),
                    };
                     invalidatePreflightAcknowledgements();
                    setValues(next);
                    void runPreflight(next, true);
                  }}
                 placeholder="Search carriers..."
               />
               <div className="relative space-y-1.5">
                 <Label>Broker <span className="text-red-500">*</span></Label>
                 <div className="relative">
                   <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                   <Input className="h-11 pl-9" value={brokerOpen ? brokerSearch : broker?.name ?? ""} placeholder="Search brokers..." onFocus={() => { setBrokerOpen(true); setBrokerSearch(""); }} onChange={event => { setBrokerSearch(event.target.value); setBrokerOpen(true); }} />
                    {broker && !brokerOpen && <button type="button" aria-label="Clear Broker" onClick={() => { invalidatePreflightAcknowledgements(); setSelectedBroker(undefined); setValues(v => ({ ...v, brokerId: "", branchId: "" })); setBrokerOpen(true); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-4 w-4" /></button>}
                 </div>
                 {brokerOpen && <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-xl border bg-white p-1 shadow-xl dark:bg-slate-950">
                     {brokers.length ? brokers.map(item => <button key={item.id} type="button" onClick={() => { setSelectedBroker(item); const next = { ...values, brokerId: String(item.id), branchId: "" }; invalidatePreflightAcknowledgements(); setValues(next); setBrokerSearch(""); setBrokerOpen(false); void runPreflight(next, true); }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"><span className="font-medium">{item.name}</span><span className="text-xs capitalize text-slate-400">{item.status}</span></button>) : <p className="px-3 py-4 text-center text-xs text-slate-500">No matches found</p>}
                 </div>}
               </div>
               <div className="space-y-1.5">
                 <Label>Driver</Label>
                 <Select disabled={!values.clientId} value={values.driverId} onValueChange={driverId => setValues(v => ({ ...v, driverId, driverName: "" }))}>
                   <SelectTrigger><SelectValue placeholder={!values.clientId ? "Select a carrier first" : "Select a driver (optional)"} /></SelectTrigger>
                   <SelectContent>{drivers.map(driver => <SelectItem key={driver.id} value={String(driver.id)}>{driver.firstName} {driver.lastName}</SelectItem>)}</SelectContent>
                 </Select>
               </div>
              <div className="space-y-1.5">
                <Label htmlFor="branchId">Branch <span className="text-red-500">*</span></Label>
                <Select disabled={!values.brokerId || branchesLoading || branchesError || branches.length === 0} value={values.branchId} onValueChange={branchId => setValues(v => ({ ...v, branchId }))}>
                  <SelectTrigger id="branchId"><SelectValue placeholder={!values.brokerId ? "Select a broker first" : branchesLoading ? "Loading branches..." : branchesError ? "Unable to load branches" : branches.length === 0 ? "No branches on file — add in broker profile." : "Select a branch"} /></SelectTrigger>
                  <SelectContent>
                    {branches.map(branch => <SelectItem key={branch.id} value={String(branch.id)}>{branch.branchName}</SelectItem>)}
                  </SelectContent>
                </Select>
                {values.brokerId && !branchesLoading && branches.length === 0 && (
                  <p className={cn("text-xs", branchesError ? "text-red-700" : "text-amber-700")}>{branchesError ? "Unable to load branches." : "No branches on file — add in broker profile."}</p>
                )}
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
                <Select value={values.paymentType} onValueChange={paymentType => setValues(v => ({ ...v, paymentType, bankAccountId: paymentType === "ACH" ? v.bankAccountId : "" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ACH">ACH</SelectItem><SelectItem value="Wire">Wire</SelectItem></SelectContent>
                </Select>
                 <p className="text-xs font-medium text-red-600">Wire (same day funding) cutoff time is at 13:00:00 MT</p>
              </div>
              {values.paymentType === "ACH" && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Bank Account Credentials</Label>
                  <Select value={values.bankAccountId} onValueChange={bankAccountId => setValues(v => ({ ...v, bankAccountId }))}>
                    <SelectTrigger><SelectValue placeholder={values.clientId ? "Select carrier bank account" : "Select a carrier first"} /></SelectTrigger>
                    <SelectContent>
                      {bankAccounts.map(account => (
                        <SelectItem key={account.id} value={String(account.id)}>
                          {account.bankName || "Bank account"} · {account.accountType || "Account"} ending in {account.lastFour || "••••"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
               <div className="space-y-1.5">
                 <Label htmlFor="driverName">Driver Name</Label>
                 <Input id="driverName" value={values.driverName} onChange={event => setValues(v => ({ ...v, driverName: event.target.value, driverId: "" }))} placeholder="Carrier-entered driver name" />
               </div>
              <div className="space-y-4 sm:col-span-2">
                <div>
                  <h3 className="text-sm font-semibold">Instructions</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Input value={values.instructionsSubject} onChange={e => setValues(v => ({ ...v, instructionsSubject: e.target.value }))} placeholder="Instructions Subject" />
                    <Textarea value={values.instructionsDetails} onChange={e => setValues(v => ({ ...v, instructionsDetails: e.target.value }))} placeholder="please be clear and specific" rows={3} className="sm:col-span-2" />
                  </div>
                </div>
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold">Paperwork Uploads</h3>
                   <p className="mt-1 text-xs font-medium text-red-600">Please upload only PDF files under 5MB</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {PAPERWORK.map(({ key, label, required }) => <PaperworkDropzone key={key} label={label} required={required} file={paperwork[key]} onFile={file => setPaperwork(current => ({ ...current, [key]: file }))} onRemove={() => setPaperwork(current => ({ ...current, [key]: null }))} onInvalid={message => toast({ title: "Invalid paperwork", description: message, variant: "destructive" })} />)}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t pt-5">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="button" variant="outline" onClick={() => { invalidatePreflightAcknowledgements(); setPreflightAlerts([]); setValues(EMPTY); setSelectedBroker(undefined); setBrokerSearch(""); setBrokerOpen(false); setPaperwork({ rateConfirmation: null, billOfLading: null, lumperReceipt: null, other: null }); }}>Reset</Button>
              <Button type="submit" disabled={!valid || mutation.isPending || preflightLoading} className="bg-blue-600 px-6 text-white hover:bg-blue-700">
                {mutation.isPending ? "Creating..." : "Submit"}
              </Button>
            </div>
          </form>
          <StatusPanel kind="carrier" record={carrier} />
        </div>
      </DialogContent>
      <Dialog open={preflightOpen} onOpenChange={setPreflightOpen}>
        <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto rounded-none border-2 border-slate-600 bg-[#c0c0c0] p-1 shadow-[4px_4px_0_#404040]">
          <div className="flex items-center justify-between bg-[#000080] px-3 py-2 text-white">
            <DialogTitle className="text-sm font-bold">Invoice Preflight Alerts</DialogTitle>
            <button type="button" onClick={() => setPreflightOpen(false)} aria-label="Close preflight alerts" className="border-2 border-white bg-[#c0c0c0] px-2 font-bold leading-5 text-black">×</button>
          </div>
          <DialogDescription className="sr-only">Review carrier and broker alerts before submitting this invoice.</DialogDescription>
          <div className="space-y-3 bg-[#c0c0c0] p-4 text-sm">
            {preflightLoading && <p className="border border-gray-500 bg-white px-3 py-2">Checking carrier and broker records…</p>}
            {preflightError && <p role="alert" className="border border-red-700 bg-red-100 px-3 py-2 text-red-900">{preflightError}</p>}
            {preflightAlerts.filter(alert => alert.severity === "info").map(alert => (
              <div key={alert.code} className="border border-blue-700 bg-blue-100 px-3 py-2 text-blue-950">
                <strong>{alert.title}</strong><p className="mt-1">{alert.message}</p>
              </div>
            ))}
            {preflightAlerts.filter(alert => alert.severity !== "info").map(alert => (
              <section key={alert.code} className={cn("border-2 p-3", alert.severity === "block" ? "border-red-800 bg-red-100 text-red-950" : "border-[#777] bg-[#eee] text-black")}>
                <strong className="block">{alert.severity === "block" ? "BLOCK — " : "ACKNOWLEDGEMENT REQUIRED — "}{alert.title}</strong>
                <p className="mt-1">{alert.message}</p>
                {(alert.link || alert.invoiceId) && (
                  <a className="mt-2 inline-block font-bold text-blue-800 underline" href={alert.link || `/invoices/${alert.invoiceId}`} target={alert.link?.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                    {alert.invoiceNumber ? `View invoice ${alert.invoiceNumber}` : "View matching invoice"}
                  </a>
                )}
                {alert.severity === "ack" && (
                  <div className="mt-3 border-t border-gray-400 pt-2">
                    <label className="flex items-center gap-2 font-semibold">
                      <input type="checkbox" checked={!!acknowledgements[alert.code]?.acknowledged} onChange={event => setAcknowledgements(current => ({ ...current, [alert.code]: { acknowledged: event.target.checked, reason: current[alert.code]?.reason ?? "" } }))} />
                      I have reviewed and acknowledge this alert
                    </label>
                    <label className="mt-2 block text-xs">Reason (optional)
                      <textarea value={acknowledgements[alert.code]?.reason ?? ""} onChange={event => setAcknowledgements(current => ({ ...current, [alert.code]: { acknowledged: !!current[alert.code]?.acknowledged, reason: event.target.value } }))} className="mt-1 min-h-16 w-full border border-gray-500 bg-white p-2 text-sm" />
                    </label>
                  </div>
                )}
              </section>
            ))}
            {nearDuplicateAlert && isManager && (
              <label className="flex items-start gap-2 border-2 border-amber-700 bg-amber-100 p-3 text-amber-950">
                <input type="checkbox" checked={overrideNearDuplicate} onChange={event => setOverrideNearDuplicate(event.target.checked)} />
                <span><strong>Manager override:</strong> allow creation despite this near-duplicate alert.</span>
              </label>
            )}
            {preflightAlerts.length === 0 && !preflightLoading && !preflightError && <p className="border border-gray-500 bg-white px-3 py-2">No active preflight alerts.</p>}
            <div className="flex justify-end gap-2 border-t border-gray-500 pt-3">
              <Button type="button" onClick={() => setPreflightOpen(false)} className="rounded-none border-2 border-white bg-[#c0c0c0] text-black shadow-[1px_1px_0_#333] hover:bg-[#d0d0d0]">Close</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}