import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { useInvoiceEntityQuery } from "@/hooks/use-invoice-entity-query";
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
const MAX_PDF_SIZE = 135 * 1024 * 1024;

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
  carrierInvoiceNumber: "", loadNumber: "", code: "", clientId: "", brokerId: "", branchId: "",
  buyout: "", lumper: "", amount: "", paymentType: "ACH", bankAccountId: "", loadType: "other",
  driverId: "", driverName: "", instructionsSubject: "", instructionsDetails: "",
  invoiceDate: "", pickupDate: "", deliveryDate: "", rate: "", origin: "", destination: "", bolNumber: "",
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
      onInvalid(`${label} must be 135MB or smaller.`);
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
  const status = record ? record.status ?? "Unknown" : "Not selected";
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
type OcrFields = Record<string, string>;
type OcrDocType = "rate_confirmation" | "invoice" | "bol" | "pod" | "other";
type OcrDocument = { documentId: number; filename: string; docType?: OcrDocType; status: string; error?: string | null; fields?: OcrFields; confidence?: number };
type OcrSource = { documentId: number; filename: string; docType: OcrDocType; confidence: number };
type OcrAlert = { code: string; severity: "block" | "ack" | "info"; title: string; message: string };
type OcrAggregate = {
  status: "queued" | "processing" | "completed" | "failed";
  error?: string | null;
  documents: OcrDocument[];
  fields: OcrFields;
  sources: Record<string, OcrSource>;
  brokerMatch?: OcrBrokerMatch;
  alerts: OcrAlert[];
  missingTypes: string[];
  tolerance: number;
};
type OcrBrokerMatch = {
  brokerId: number | null;
  confidence: "high" | "medium" | null;
  rawName: string | null;
  matchedName: string | null;
  candidates: Array<{ id: number; name: string }>;
};
type OcrStatus = "idle" | "uploading" | "queued" | "processing" | "completed" | "failed";

function ocrErrorMessage(payload: any, fallback: string) {
  return typeof payload?.error === "string" && payload.error.trim()
    ? payload.error
    : typeof payload?.message === "string" && payload.message.trim() ? payload.message : fallback;
}

function waitForOcrPoll(signal: AbortSignal, delay = 1200) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Request cancelled", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Request cancelled", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

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
  const [brokerSearch, setBrokerSearch] = useState("");
  const [brokerQuery, setBrokerQuery] = useState("");
  const [brokerOpen, setBrokerOpen] = useState(false);
  const [paperwork, setPaperwork] = useState<Record<PaperworkKey, File | null>>({
    rateConfirmation: null, billOfLading: null, lumperReceipt: null, other: null,
  });
  const ocrPaperworkRef = useRef<Partial<Record<PaperworkKey, File>>>({});
  const [ocrFiles, setOcrFiles] = useState<File[]>([]);
  const [ocrDocuments, setOcrDocuments] = useState<OcrDocument[]>([]);
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>("idle");
  const [ocrError, setOcrError] = useState("");
  const [ocrFields, setOcrFields] = useState<OcrFields | null>(null);
  const [ocrSources, setOcrSources] = useState<Record<string, OcrSource>>({});
  const [ocrAlerts, setOcrAlerts] = useState<OcrAlert[]>([]);
  const [ocrMissingTypes, setOcrMissingTypes] = useState<string[]>([]);
  const [ocrBrokerMatch, setOcrBrokerMatch] = useState<OcrBrokerMatch | null>(null);
  const [ocrDragActive, setOcrDragActive] = useState(false);
  const ocrInputRef = useRef<HTMLInputElement>(null);
  const ocrRequestId = useRef(0);
  const ocrController = useRef<AbortController | null>(null);
  const ocrSelectedBrokerId = useRef<string | null>(null);
  const { data: carriersData = [] } = useInvoiceEntityQuery<Carrier[]>({ queryKey: ["/api/clients", { all: true }], enabled: open });
  useEffect(() => {
    const timer = window.setTimeout(() => setBrokerQuery(brokerSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [brokerSearch]);
  const { data: brokersResponse } = useInvoiceEntityQuery<{ data?: Broker[] } | Broker[]>({
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
  const { data: brokerDetails, isFetching: brokerLoading, isError: brokerError } = useInvoiceEntityQuery<Broker>({
    queryKey: ["/api/brokers", values.brokerId],
    enabled: open && !!values.brokerId,
  });
  const { data: carrierDetails, isFetching: carrierLoading, isError: carrierError } = useInvoiceEntityQuery<Carrier>({
    queryKey: ["/api/clients", values.clientId],
    enabled: open && !!values.clientId,
  });
  const { data: branchesData = [], isFetching: branchesLoading, isError: branchesError } = useInvoiceEntityQuery<any[]>({
    queryKey: ["/api/brokers", values.brokerId, "branches"],
    queryFn: async () => {
      const response = await fetch(`/api/brokers/${values.brokerId}/branches`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load branches");
      const payload = await response.json();
      return Array.isArray(payload) ? payload : payload.data ?? [];
    },
    enabled: open && !!values.brokerId,
  });
  const { data: bankAccountsData = [], isFetching: bankAccountsLoading, isError: bankAccountsError } = useInvoiceEntityQuery<Array<{
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
  const { data: driversData = [], isFetching: driversLoading, isError: driversError } = useInvoiceEntityQuery<Driver[]>({
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
  const carrier = carrierDetails;
  const broker = brokerDetails;
  const entityDataLoading = brokerLoading || carrierLoading || branchesLoading || bankAccountsLoading || driversLoading;
  const entityDataError = brokerError || carrierError || branchesError || bankAccountsError || driversError;
  const drivers = driversData.filter(driver => driver.status === "active");
  const renderOcrSource = (field: string) => {
    const source = ocrSources[field];
    if (!source) return null;
    return (
      <span data-testid={`invoice-ocr-source-${field}`} className="block text-[11px] font-normal text-slate-600">
        Source: {source.filename} · {source.docType.replace(/_/g, " ")} · {Math.round(source.confidence <= 1 ? source.confidence * 100 : source.confidence)}% confidence
      </span>
    );
  };

  const stageOcrFiles = async (files: File[]) => {
    if (!files.length) return;
    stopOcrRequest();
    const stagingId = ocrRequestId.current;
    clearOcrPrefill();
    setOcrFiles([]);
    setOcrStatus("idle");
    try {
      await validateOcrFiles(files);
      if (stagingId !== ocrRequestId.current) return;
      setOcrFiles(files);
      setOcrError("");
    } catch (error) {
      if (stagingId !== ocrRequestId.current) return;
      setOcrError(error instanceof Error ? error.message : "Unable to read selected PDFs.");
      setOcrStatus("failed");
    }
  };

  const invalidatePreflightAcknowledgements = () => {
    preflightRequestId.current += 1;
    setPreflightLoading(false);
    setPreflightError("");
    setAcknowledgements({});
    setOverrideNearDuplicate(false);
  };

  const stopOcrRequest = () => {
    ocrRequestId.current += 1;
    ocrController.current?.abort();
    ocrController.current = null;
  };

  const clearOcrPrefill = () => {
    setOcrDocuments([]);
    setOcrFields(null);
    setOcrSources({});
    setOcrAlerts([]);
    setOcrMissingTypes([]);
    setOcrBrokerMatch(null);
    setValues(current => ({
      ...current, carrierInvoiceNumber: "", loadNumber: "", amount: "", invoiceDate: "",
      pickupDate: "", deliveryDate: "", rate: "", origin: "", destination: "", bolNumber: "",
      brokerId: "", branchId: "",
    }));
    ocrSelectedBrokerId.current = null;
    invalidatePreflightAcknowledgements();
    setPreflightAlerts([]);
    setPreflightOpen(false);
    setPaperwork(current => {
      const next = { ...current };
      (Object.keys(ocrPaperworkRef.current) as PaperworkKey[]).forEach(key => {
        if (next[key] === ocrPaperworkRef.current[key]) next[key] = null;
      });
      ocrPaperworkRef.current = {};
      return next;
    });
  };

  const validateOcrFiles = async (files: File[]) => {
    if (files.length > 8) throw new Error("Choose no more than 8 PDF files.");
    for (const file of files) {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        throw new Error(`${file.name} is not a PDF file.`);
      }
      if (file.size > MAX_PDF_SIZE) throw new Error(`${file.name} is larger than 135MB.`);
      const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]) !== "%PDF-") {
        throw new Error(`${file.name} is not a valid PDF.`);
      }
    }
  };

  const uploadOcrBatch = async (files: File[]) => {
    if (!files.length) return;
    stopOcrRequest();
    const requestId = ocrRequestId.current;
    const controller = new AbortController();
    ocrController.current = controller;
    setOcrFiles(files);
    setOcrStatus("uploading");
    setOcrError("");
    setOcrDocuments([]);
    clearOcrPrefill();
    try {
      const body = new FormData();
      files.forEach(file => body.append("files", file));
      const intakeResponse = await fetch("/api/invoices/ocr-intake", {
        method: "POST",
        credentials: "include",
        body,
        signal: controller.signal,
      });
      const intake = await intakeResponse.json().catch(() => ({}));
      if (!intakeResponse.ok) throw new Error(ocrErrorMessage(intake, `Upload failed (${intakeResponse.status}).`));
      if (requestId !== ocrRequestId.current) return;
      if (!Array.isArray(intake.documents) || !intake.documents.length
        || intake.documents.some((document: any) => typeof document.documentId !== "number")) {
        throw new Error("The upload response did not include document IDs.");
      }
      const documentIds = intake.documents.map((document: any) => document.documentId as number);
      setOcrDocuments(intake.documents.map((document: any) => ({
        documentId: document.documentId, filename: document.filename, status: document.status || "queued",
      })));
      setOcrStatus(intake.status === "queued" ? "queued" : "processing");

      while (requestId === ocrRequestId.current) {
        await waitForOcrPoll(controller.signal);
        const params = new URLSearchParams({ documentIds: documentIds.join(",") });
        const pollResponse = await fetch(`/api/invoices/ocr-intake?${params.toString()}`, {
          method: "GET",
          credentials: "include",
          signal: controller.signal,
        });
        const result: OcrAggregate = await pollResponse.json().catch(() => ({} as OcrAggregate));
        if (!pollResponse.ok) throw new Error(ocrErrorMessage(result, `Status check failed (${pollResponse.status}).`));
        if (requestId !== ocrRequestId.current) return;
        if (Array.isArray(result.documents)) setOcrDocuments(result.documents);
        if (result.status === "failed") {
          setOcrStatus("failed");
          setOcrError(ocrErrorMessage(result, "Document extraction failed. Review the document rows and retry or reupload."));
          setOcrAlerts(Array.isArray(result.alerts) ? result.alerts : []);
          return;
        }
        if (result.status === "completed") {
          const fields: OcrFields = result.fields && typeof result.fields === "object" ? result.fields : {};
          const match: OcrBrokerMatch = result.brokerMatch && typeof result.brokerMatch === "object"
            ? {
                brokerId: typeof result.brokerMatch.brokerId === "number" ? result.brokerMatch.brokerId : null,
                confidence: result.brokerMatch.confidence === "high" || result.brokerMatch.confidence === "medium" ? result.brokerMatch.confidence : null,
                rawName: typeof result.brokerMatch.rawName === "string" ? result.brokerMatch.rawName : null,
                matchedName: typeof result.brokerMatch.matchedName === "string" ? result.brokerMatch.matchedName : null,
                candidates: Array.isArray(result.brokerMatch.candidates) ? result.brokerMatch.candidates : [],
              }
            : { brokerId: null, confidence: null, rawName: null, matchedName: null, candidates: [] };
          setOcrFields(fields);
          const sources: Record<string, OcrSource> = result.sources && typeof result.sources === "object" ? result.sources : {};
          setOcrSources(sources);
          setOcrBrokerMatch(match);
          setOcrAlerts(Array.isArray(result.alerts) ? result.alerts : []);
          setOcrMissingTypes(Array.isArray(result.missingTypes) ? result.missingTypes : []);
          const asDate = (value?: string) => {
            if (!value?.trim()) return "";
            const raw = value.trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
            const parsed = new Date(raw);
            return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
          };
          setValues(current => ({
            ...current,
            ...(fields.invoice_number?.trim() ? { carrierInvoiceNumber: fields.invoice_number } : {}),
            ...(fields.load_number?.trim() ? { loadNumber: fields.load_number } : {}),
            ...(fields.amount?.trim() ? { amount: fields.amount } : {}),
            ...(fields.invoice_date ? { invoiceDate: asDate(fields.invoice_date) } : {}),
            ...(fields.pickup_date ? { pickupDate: asDate(fields.pickup_date) } : {}),
            ...(fields.delivery_date ? { deliveryDate: asDate(fields.delivery_date) } : {}),
            ...(fields.rate?.trim() ? { rate: fields.rate } : {}),
            ...(fields.origin?.trim() ? { origin: fields.origin } : {}),
            ...(fields.destination?.trim() ? { destination: fields.destination } : {}),
            ...(fields.bol_number?.trim() ? { bolNumber: fields.bol_number } : {}),
            ...(match.brokerId != null ? { brokerId: String(match.brokerId), branchId: "" } : { brokerId: "", branchId: "" }),
          }));
          if (match.brokerId != null) {
            ocrSelectedBrokerId.current = String(match.brokerId);
          } else {
            ocrSelectedBrokerId.current = null;
          }
          const returnedDocs: OcrDocument[] = Array.isArray(result.documents) ? result.documents : [];
          const byType = (types: OcrDocType[]) => {
            const document = returnedDocs.find(item => item.docType && types.includes(item.docType) && item.status === "completed");
            return document ? files.find(file => file.name === document.filename) ?? null : null;
          };
          const matchedPaperwork = {
            rateConfirmation: byType(["rate_confirmation"]),
            billOfLading: byType(["bol", "pod"]),
            other: byType(["invoice"]),
          };
          ocrPaperworkRef.current = Object.fromEntries(
            Object.entries(matchedPaperwork).filter(([, file]) => file != null),
          ) as Partial<Record<PaperworkKey, File>>;
          setPaperwork(current => ({
            ...current,
            rateConfirmation: matchedPaperwork.rateConfirmation ?? current.rateConfirmation,
            billOfLading: matchedPaperwork.billOfLading ?? current.billOfLading,
            other: matchedPaperwork.other ?? current.other,
          }));
          invalidatePreflightAcknowledgements();
          const crossAlerts: OcrAlert[] = Array.isArray(result.alerts) ? result.alerts : [];
          setPreflightAlerts(crossAlerts.map(alert => ({ ...alert })));
          setAcknowledgements(Object.fromEntries(crossAlerts
            .filter(alert => alert.severity === "ack")
            .map(alert => [alert.code, { acknowledged: false, reason: "" }])));
          setPreflightOpen(crossAlerts.some(alert => alert.severity !== "info"));
          setOcrStatus("completed");
          return;
        }
        if (result.status === "queued" || result.status === "processing") {
          setOcrStatus(result.status);
        } else {
          throw new Error("The status service returned an unexpected response.");
        }
      }
    } catch (error) {
      if (requestId !== ocrRequestId.current || controller.signal.aborted) return;
      setOcrStatus("failed");
      setOcrError(error instanceof Error ? error.message : "Unable to extract document fields.");
    } finally {
      if (requestId === ocrRequestId.current) ocrController.current = null;
    }
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
          invoiceNumber: candidate.carrierInvoiceNumber.trim() || undefined,
          loadNumber: candidate.loadNumber.trim() || undefined,
          amount: candidate.amount ? Number(candidate.amount) : undefined,
           serviceDate: candidate.deliveryDate || candidate.pickupDate || undefined,
           ocrDocumentIds: ocrDocuments.map(document => document.documentId),
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
    if (!open || branchesLoading || branchesError) return;
    if (ocrSelectedBrokerId.current === values.brokerId && values.brokerId && !values.branchId) return;
    if (branches.length === 1 && values.branchId !== String(branches[0].id)) {
      setValues(v => ({ ...v, branchId: String(branches[0].id) }));
    } else if (values.branchId && !branches.some(branch => String(branch.id) === values.branchId)) {
      setValues(v => ({ ...v, branchId: "" }));
    }
  }, [open, branchesLoading, branchesError, branches, values.branchId, values.brokerId]);

  useEffect(() => {
    if (open && initialValues) {
      setValues({ ...EMPTY, ...initialValues });
    } else if (!open) {
      ocrRequestId.current += 1;
      ocrController.current?.abort();
      ocrController.current = null;
      preflightRequestId.current += 1;
      setPreflightLoading(false);
      setValues(EMPTY);
      setPreflightAlerts([]);
      setPreflightOpen(false);
      setPreflightError("");
      setAcknowledgements({});
      setOverrideNearDuplicate(false);
      ocrSelectedBrokerId.current = null;
      setBrokerSearch("");
      setBrokerOpen(false);
      setPaperwork({ rateConfirmation: null, billOfLading: null, lumperReceipt: null, other: null });
      ocrPaperworkRef.current = {};
      setOcrFiles([]);
      setOcrDocuments([]);
      setOcrStatus("idle");
      setOcrError("");
      setOcrFields(null);
      setOcrSources({});
      setOcrAlerts([]);
      setOcrMissingTypes([]);
      setOcrBrokerMatch(null);
    }
  }, [open, initialValues]);

  useEffect(() => {
    if (!open) return;
    return () => {
      ocrRequestId.current += 1;
      ocrController.current?.abort();
      ocrController.current = null;
    };
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const metadata = {
        carrierInvoiceNumber: values.carrierInvoiceNumber.trim() || undefined,
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
        invoiceDate: values.invoiceDate ? new Date(`${values.invoiceDate}T00:00:00.000Z`).toISOString() : null,
        serviceDate: values.deliveryDate || values.pickupDate || null,
        pickupDate: values.pickupDate || null,
        deliveryDate: values.deliveryDate || null,
        rate: values.rate || null,
        origin: values.origin || null,
        destination: values.destination || null,
        bolNumber: values.bolNumber || null,
        ocrDocumentIds: ocrDocuments.map(document => document.documentId),
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
  const valid = values.carrierInvoiceNumber.trim().length <= 100
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
            <section className="space-y-3 rounded-none border border-slate-400 bg-slate-100 p-3" aria-labelledby="ocr-upload-heading">
              <div>
                <h3 id="ocr-upload-heading" className="text-sm font-semibold">Staff intake · document set</h3>
                <p className="mt-0.5 text-xs text-slate-600">Drop the rate confirmation, carrier invoice, and BOL/POD together. Up to 8 PDFs, 135MB each. Large PDFs are compressed automatically.</p>
              </div>
              <input
                ref={ocrInputRef}
                id="invoice-ocr-pdf"
                data-testid="invoice-ocr-file-input"
                type="file"
                multiple
                accept="application/pdf,.pdf"
                className="hidden"
                aria-label="Choose PDFs for invoice intake"
                onChange={event => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = "";
                  void stageOcrFiles(files);
                }}
              />
              <button
                type="button"
                data-testid="invoice-ocr-dropzone"
                aria-label="Drop or choose invoice intake PDF documents"
                onClick={() => ocrInputRef.current?.click()}
                onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); ocrInputRef.current?.click(); } }}
                onDragOver={event => { event.preventDefault(); setOcrDragActive(true); }}
                onDragLeave={() => setOcrDragActive(false)}
                onDrop={event => {
                  event.preventDefault();
                  setOcrDragActive(false);
                  void stageOcrFiles(Array.from(event.dataTransfer.files));
                }}
                className={cn(
                  "w-full border-2 border-t-white border-l-white border-r-[#555] border-b-[#555] bg-[#c0c0c0] px-4 py-5 text-left text-sm text-black focus:outline-none focus:ring-2 focus:ring-[#000080]",
                  ocrDragActive && "border-2 border-dashed border-[#000080] bg-[#d8d8d8]",
                )}
              >
                <span className="block font-semibold">Drop PDF documents here</span>
                <span className="mt-1 block text-xs">or choose files · rate con, invoice, BOL/POD, and supporting docs</span>
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" disabled={!ocrFiles.length || ["uploading", "queued", "processing"].includes(ocrStatus)} onClick={() => void uploadOcrBatch(ocrFiles)}>
                  {ocrStatus === "failed" || ocrDocuments.some(document => document.status === "failed") ? "Retry / reupload set" : ocrStatus === "completed" ? "Process replacement set" : "Process document set"}
                </Button>
                {ocrFiles.length > 0 && <span className="text-xs text-slate-600">{ocrFiles.length} PDF{ocrFiles.length === 1 ? "" : "s"} staged</span>}
              </div>
              {ocrFiles.map(file => {
                const document = ocrDocuments.find(item => item.filename === file.name);
                return (
                  <div key={`${file.name}-${file.size}-${file.lastModified}`} data-testid={document ? `invoice-ocr-document-row-${document.documentId}` : "invoice-ocr-staged-row"} className="flex min-w-0 flex-wrap items-center gap-2 border border-[#777] bg-white px-2 py-1.5 text-xs">
                    <span className="min-w-0 flex-1 truncate font-semibold">{file.name}</span>
                    <span className="shrink-0 text-slate-600">{document?.docType?.replace(/_/g, " ") || (document ? document.status : formatFileSize(file.size))}</span>
                    {document?.status && <span className={cn("shrink-0", document.status === "failed" ? "text-red-700" : "text-slate-600")}>{document.status}</span>}
                    {document?.error && <span role="alert" className="basis-full text-red-700">{document.error}</span>}
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      className="shrink-0 border border-[#777] px-1 text-black hover:bg-slate-100"
                      onClick={() => {
                        stopOcrRequest();
                        clearOcrPrefill();
                        setOcrFiles(current => current.filter(candidate => candidate !== file));
                        setOcrStatus("idle");
                        setOcrError("");
                      }}
                    ><X className="h-3.5 w-3.5" /></button>
                  </div>
                );
              })}
              {ocrStatus !== "idle" && (
                <p data-testid="invoice-ocr-status" role={ocrStatus === "failed" ? "alert" : "status"} aria-live="polite" className={cn("text-xs", ocrStatus === "failed" ? "text-red-700" : ocrStatus === "completed" ? "text-emerald-800" : "text-slate-700")}>
                  {ocrStatus === "uploading" ? "Uploading document set…" : ocrStatus === "queued" ? "Documents received — extraction queued…" : ocrStatus === "processing" ? "Classifying and extracting documents…" : ocrStatus === "completed" ? "Extraction complete. Review every field and source before submitting." : ocrError || "Extraction failed. Retry or reupload the document set."}
                </p>
              )}
              {ocrStatus === "failed" && ocrAlerts.map(alert => (
                <div key={alert.code} data-testid="invoice-ocr-cross-check-alert" className="border border-red-700 bg-red-100 px-3 py-2 text-xs text-red-900">
                  <strong>{alert.title}</strong><p className="mt-1">{alert.message}</p>
                </div>
              ))}
              {ocrStatus === "completed" && ocrFields && (
                <>
                  {ocrMissingTypes.length > 0 && <p className="text-xs text-amber-800">Not included: {ocrMissingTypes.map(type => type.replace(/_/g, " ")).join(", ")}</p>}
                  {ocrAlerts.map(alert => (
                    <div key={alert.code} data-testid="invoice-ocr-cross-check-alert" className={cn("border px-3 py-2 text-xs", alert.severity === "block" ? "border-red-700 bg-red-100 text-red-900" : alert.severity === "ack" ? "border-amber-700 bg-amber-100 text-amber-950" : "border-blue-700 bg-blue-100 text-blue-950")}>
                      <strong>{alert.title}</strong><p className="mt-1">{alert.message}</p>
                    </div>
                  ))}
                  <div className="grid gap-x-4 gap-y-1 border-t border-slate-400 pt-2 text-xs sm:grid-cols-2">
                    {ocrDocuments.map(document => <p key={document.documentId}><strong>{document.filename}</strong> · {document.docType?.replace(/_/g, " ") || "Unclassified"} · {document.status}{document.error ? ` — ${document.error}` : ""}</p>)}
                    {ocrBrokerMatch && <p data-testid="invoice-ocr-raw-broker"><span className="font-medium">Extracted broker name:</span> {ocrBrokerMatch.rawName?.trim() || ocrFields.broker_name?.trim() || "Not found"}{renderOcrSource("broker_name")}</p>}
                    {ocrBrokerMatch?.brokerId != null && <p className={cn("font-medium", ocrBrokerMatch.confidence === "medium" ? "text-amber-800" : "text-emerald-800")}>{ocrBrokerMatch.confidence === "medium" ? <span data-testid="invoice-ocr-verify-marker">Verify · confirm against the extracted name.</span> : "Broker match selected."}</p>}
                    <p data-testid="invoice-ocr-signature"><span className="font-medium">POD signature:</span> {ocrFields.pod_signature === "true" ? "Present" : ocrFields.pod_signature === "false" ? "Not detected" : "Not found"}{renderOcrSource("pod_signature")}</p>
                  </div>
                </>
              )}
            </section>
            <div className="space-y-2">
              <Label>Load Type <span className="text-red-500">*</span></Label>
              <LoadTypeToggleGroup
                value={values.loadType}
                onChange={loadType => setValues(v => ({ ...v, loadType }))}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="carrierInvoiceNumber">Carrier Invoice Number <span className="text-xs font-normal text-slate-500">(optional)</span></Label>
                <Input id="carrierInvoiceNumber" maxLength={100} value={values.carrierInvoiceNumber} onChange={e => { invalidatePreflightAcknowledgements(); setValues(v => ({ ...v, carrierInvoiceNumber: e.target.value })); }} onBlur={() => void runPreflight()} placeholder="Enter carrier's invoice number" />
                {renderOcrSource("invoice_number")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loadNumber">Load # <span className="text-red-500">*</span></Label>
                <Input id="loadNumber" required value={values.loadNumber} onChange={e => { invalidatePreflightAcknowledgements(); setValues(v => ({ ...v, loadNumber: e.target.value })); }} onBlur={() => void runPreflight()} placeholder="Enter load number" />
                {renderOcrSource("load_number")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoiceDate">Invoice Date</Label>
                <Input id="invoiceDate" type="date" className="rounded-none" value={values.invoiceDate} onChange={e => { invalidatePreflightAcknowledgements(); setValues(v => ({ ...v, invoiceDate: e.target.value })); }} onBlur={() => void runPreflight()} />
                {renderOcrSource("invoice_date")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rateAmount">Rate</Label>
                <Input id="rateAmount" value={values.rate} onChange={e => setValues(v => ({ ...v, rate: e.target.value }))} placeholder="Rate confirmation amount" />
                {renderOcrSource("rate")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pickupDate">Pickup Date</Label>
                <Input id="pickupDate" type="date" className="rounded-none" value={values.pickupDate} onChange={e => { invalidatePreflightAcknowledgements(); setValues(v => ({ ...v, pickupDate: e.target.value })); }} onBlur={() => void runPreflight()} />
                {renderOcrSource("pickup_date")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deliveryDate">Delivery Date</Label>
                <Input id="deliveryDate" type="date" className="rounded-none" value={values.deliveryDate} onChange={e => { invalidatePreflightAcknowledgements(); setValues(v => ({ ...v, deliveryDate: e.target.value })); }} onBlur={() => void runPreflight()} />
                {renderOcrSource("delivery_date")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="origin">Origin</Label>
                <Input id="origin" value={values.origin} onChange={e => setValues(v => ({ ...v, origin: e.target.value }))} placeholder="Pickup city / state" />
                {renderOcrSource("origin")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="destination">Destination</Label>
                <Input id="destination" value={values.destination} onChange={e => setValues(v => ({ ...v, destination: e.target.value }))} placeholder="Delivery city / state" />
                {renderOcrSource("destination")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bolNumber">BOL #</Label>
                <Input id="bolNumber" value={values.bolNumber} onChange={e => setValues(v => ({ ...v, bolNumber: e.target.value }))} placeholder="Bill of lading number" />
                {renderOcrSource("bol_number")}
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
                 {renderOcrSource("amount")}
              </div>
               <SearchSelect
                 label="Carrier"
                 required
                 items={carriers}
                 selected={carrier}
                  onSelect={item => {
                    for (const queryKey of [
                      ["/api/clients", String(item.id)],
                      ["/api/carriers", String(item.id), "bank-accounts"],
                      ["/api/drivers", String(item.id)],
                    ]) void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
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
                    <Input className="h-11 pl-9" value={brokerOpen ? brokerSearch : broker?.name ?? ""} placeholder={brokerLoading ? "Loading broker..." : "Search brokers..."} onFocus={() => { setBrokerOpen(true); setBrokerSearch(""); }} onChange={event => { setBrokerSearch(event.target.value); setBrokerOpen(true); }} />
                     {values.brokerId && !brokerOpen && <button type="button" aria-label="Clear Broker" onClick={() => { invalidatePreflightAcknowledgements(); ocrSelectedBrokerId.current = null; setOcrBrokerMatch(null); setValues(v => ({ ...v, brokerId: "", branchId: "" })); setBrokerOpen(true); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-4 w-4" /></button>}
                 </div>
                 {brokerOpen && <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-xl border bg-white p-1 shadow-xl dark:bg-slate-950">
                      {brokers.length ? brokers.map(item => <button key={item.id} type="button" onClick={() => { void queryClient.invalidateQueries({ queryKey: ["/api/brokers", String(item.id)] }, { cancelRefetch: false }); ocrSelectedBrokerId.current = null; setOcrBrokerMatch(null); const next = { ...values, brokerId: String(item.id), branchId: "" }; invalidatePreflightAcknowledgements(); setValues(next); setBrokerSearch(""); setBrokerOpen(false); void runPreflight(next, true); }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"><span className="font-medium">{item.name}</span><span className="text-xs capitalize text-slate-400">{item.status}</span></button>) : <p className="px-3 py-4 text-center text-xs text-slate-500">No matches found</p>}
                 </div>}
               </div>
               <div className="space-y-1.5">
                 <Label>Driver</Label>
                 <Select disabled={!values.clientId || driversLoading || driversError} value={values.driverId} onValueChange={driverId => setValues(v => ({ ...v, driverId, driverName: "" }))}>
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
                  <Select disabled={!values.clientId || bankAccountsLoading || bankAccountsError} value={values.bankAccountId} onValueChange={bankAccountId => setValues(v => ({ ...v, bankAccountId }))}>
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
                  {renderOcrSource("broker_name")}
                </div>
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold">Paperwork Uploads</h3>
                   <p className="mt-1 text-xs font-medium text-red-600">PDF files only. Large files are compressed automatically before storage (135MB upload limit).</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {PAPERWORK.map(({ key, label, required }) => <PaperworkDropzone key={key} label={label} required={required} file={paperwork[key]} onFile={file => setPaperwork(current => ({ ...current, [key]: file }))} onRemove={() => setPaperwork(current => ({ ...current, [key]: null }))} onInvalid={message => toast({ title: "Invalid paperwork", description: message, variant: "destructive" })} />)}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t pt-5">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="button" variant="outline" onClick={() => {
                stopOcrRequest();
                ocrSelectedBrokerId.current = null;
                setOcrFiles([]);
                setOcrDocuments([]);
                setOcrStatus("idle");
                setOcrError("");
                setOcrFields(null);
                setOcrSources({});
                setOcrAlerts([]);
                setOcrMissingTypes([]);
                setOcrBrokerMatch(null);
                invalidatePreflightAcknowledgements();
                setPreflightAlerts([]);
                setValues(EMPTY);
                setBrokerSearch("");
                setBrokerOpen(false);
                setPaperwork({ rateConfirmation: null, billOfLading: null, lumperReceipt: null, other: null });
                ocrPaperworkRef.current = {};
              }}>Reset</Button>
              {entityDataLoading && <p role="status" className="text-sm">Refreshing broker and carrier data…</p>}
              {entityDataError && <p role="alert" className="text-sm text-red-700">Unable to refresh broker or carrier data. Reselect the record or reopen the form to retry.</p>}
              <Button type="submit" disabled={!valid || mutation.isPending || preflightLoading || entityDataLoading || entityDataError} className="bg-blue-600 px-6 text-white hover:bg-blue-700">
                {mutation.isPending ? "Creating..." : "Submit"}
              </Button>
            </div>
          </form>
          <StatusPanel kind="carrier" record={carrier} />
        </div>
      </DialogContent>
      <Dialog open={preflightOpen} onOpenChange={setPreflightOpen}>
        <DialogContent showCloseButton={false} className="max-h-[80vh] max-w-xl overflow-y-auto rounded-none border-2 border-slate-600 bg-[#c0c0c0] p-1 shadow-[4px_4px_0_#404040]">
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