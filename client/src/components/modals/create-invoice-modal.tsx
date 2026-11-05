import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Building2, CheckCircle2, Plus, Search, ShieldAlert, Truck, Upload, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NeuBadge, NeuButton, NeuCard, NeuInput, NeuTextarea } from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { apiRequest, HttpError, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useInvoiceEntityQuery } from "@/hooks/use-invoice-entity-query";
import { displayLoadType, isLoadType } from "@shared/load-types";
import { LoadTypeToggleGroup } from "@/components/load-type";
import { HOLD_REASONS } from "@shared/invoice-creation-options";
import "./create-invoice-modal.css";

type ModalButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "accent";
};

function Button({ variant = "default", className, ...props }: ModalButtonProps) {
  return (
    <NeuButton
      variant={variant === "accent" ? "accent" : "default"}
      className={cn(variant === "ghost" && "text-[#666666]", className)}
      {...props}
    />
  );
}

const Input = NeuInput;

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
  lumper: "", amount: "", lumperTotal: "", paymentType: "ACH", bankAccountId: "", loadType: "other",
  instructionsDetails: "", heldFor: [] as string[],
  invoiceDate: "", pickupDate: "", deliveryDate: "", origin: "", destination: "", bolNumber: "",
  holdForManagerReview: false, holdReason: "",
};

type HoldRecipient = { value: string; label: string; available: boolean; unavailableReason?: string };

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
      className={cn("rounded-xl border border-dashed p-3 transition-colors shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]", dragging ? "border-[#27aab8] bg-[#d8eeee] ring-2 ring-[#27aab8]" : file ? "border-emerald-400 bg-emerald-50/70" : "border-[#aaa] hover:border-[#27aab8]")}
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
        <div className="flex items-center gap-2.5"><Upload className="h-5 w-5 text-slate-500" /><span className="text-xs font-medium">{label}{required && <span data-required-mark> *</span>}</span></div>
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
      <Label>{label}{required && <span data-required-mark> *</span>}</Label>
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
        <div className="ff-create-invoice-search-popup absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-xl border p-1">
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
      <NeuCard className="rounded-2xl p-4">
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
        <p className="rounded-xl border border-dashed border-[#aaa] px-3 py-6 text-center text-xs text-slate-500">
          Select a {kind} to view status and messages.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="truncate pr-2 text-sm font-semibold">{record.name}</span>
            <NeuBadge tone={favorable ? "success" : "warning"} className="capitalize">
              {status.replace(/_/g, " ")}
            </NeuBadge>
          </div>
          {!isCarrier && (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
              <span className="text-xs text-slate-500">Credit grade</span>
               <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", brokerRecord?.creditGrade === "A" ? "bg-emerald-100 text-emerald-700" : brokerRecord?.creditGrade === "B" ? "bg-teal-100 text-teal-700" : brokerRecord?.creditGrade === "C" ? "bg-yellow-100 text-yellow-700" : brokerRecord?.creditGrade === "D" ? "bg-orange-100 text-orange-700" : brokerRecord?.creditGrade === "F" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500")}>{brokerRecord?.creditGrade ?? "Not rated"}{brokerRecord?.creditScore != null && ` · ${brokerRecord.creditScore}`}</span>
            </div>
          )}
           {!isCarrier && (brokerRecord?.creditGrade === "D" || brokerRecord?.creditGrade === "F") && (
             <NeuNotice severity={brokerRecord.creditGrade === "F" ? "block" : "ack"} className="text-xs">
               {brokerRecord.creditGrade === "F"
                 ? "This broker is flagged as high risk."
                 : "This broker has a poor credit rating. Proceed with caution."}
             </NeuNotice>
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
          <NeuNotice severity={favorable ? "info" : "ack"} className="flex items-start gap-2 text-xs">
            {favorable ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{record.notes || (favorable ? `${isCarrier ? "Carrier" : "Broker"} is active with no recorded holds.` : `Review ${kind} status before proceeding.`)}</span>
          </NeuNotice>
        </div>
      )}
      </NeuCard>
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
  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [branchForm, setBranchForm] = useState({
    branchName: "", address: "", city: "", state: "", zip: "", contactName: "", email: "", phone: "",
  });
  const [branchCreateError, setBranchCreateError] = useState("");
  const selectedBrokerIdRef = useRef(values.brokerId);
  const modalOpenRef = useRef(open);
  const protectedBranchRef = useRef<{ brokerId: string; branchId: string } | null>(null);
  selectedBrokerIdRef.current = values.brokerId;
  modalOpenRef.current = open;
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
  const {
    data: holdRecipientResponse,
    isFetching: holdRecipientsLoading,
    isError: holdRecipientsError,
  } = useInvoiceEntityQuery<{ options: HoldRecipient[] }>({
    queryKey: ["/api/invoices/hold-recipients"],
    queryFn: async () => {
      const response = await fetch("/api/invoices/hold-recipients", { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load hold recipients");
      return response.json();
    },
    enabled: open,
  });
  const carriers = Array.isArray(carriersData) ? carriersData : [];
  const brokers = (Array.isArray(brokersResponse) ? brokersResponse : brokersResponse?.data ?? []).filter(item => item.status === "active");
  const branches = (Array.isArray(branchesData) ? branchesData : []).filter(branch => branch.status === "active");
  const bankAccounts = Array.isArray(bankAccountsData) ? bankAccountsData : [];
  const carrier = carrierDetails;
  const broker = brokerDetails;
  const entityDataLoading = brokerLoading || carrierLoading || branchesLoading || bankAccountsLoading;
  const entityDataError = brokerError || carrierError || branchesError || bankAccountsError;
  const holdRecipients = Array.isArray(holdRecipientResponse?.options) ? holdRecipientResponse.options : [];
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
      pickupDate: "", deliveryDate: "", origin: "", destination: "", bolNumber: "",
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
            ...((fields.rate?.trim() || fields.amount?.trim()) ? { amount: fields.rate?.trim() ? fields.rate : fields.amount } : {}),
            ...(fields.invoice_date ? { invoiceDate: asDate(fields.invoice_date) } : {}),
            ...(fields.pickup_date ? { pickupDate: asDate(fields.pickup_date) } : {}),
            ...(fields.delivery_date ? { deliveryDate: asDate(fields.delivery_date) } : {}),
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
    const protectedBranch = protectedBranchRef.current;
    if (protectedBranch && protectedBranch.brokerId !== values.brokerId) protectedBranchRef.current = null;
    if (protectedBranch?.brokerId === values.brokerId && protectedBranch.branchId === values.branchId) {
      if (branches.some(branch => String(branch.id) === values.branchId)) protectedBranchRef.current = null;
      return;
    }
    if (values.branchId && !branches.some(branch => String(branch.id) === values.branchId)) {
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
      setBranchDialogOpen(false);
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
        branchId: values.branchId ? Number(values.branchId) : null,
        code: values.code.trim() || null,
        lumper: values.lumper === "" ? null : values.lumper === "yes",
        holdForManagerReview: values.holdForManagerReview,
        holdReason: values.holdForManagerReview ? values.holdReason : null,
        heldFor: values.holdForManagerReview
          ? values.heldFor.filter(code => holdRecipients.some(option => option.value === code && option.available))
          : [],
        amount: values.amount,
        lumperTotal: values.lumperTotal.trim() === "" ? null : Number(values.lumperTotal).toFixed(2),
        invoiceDate: values.invoiceDate ? new Date(`${values.invoiceDate}T00:00:00.000Z`).toISOString() : null,
        serviceDate: values.deliveryDate || values.pickupDate || null,
        pickupDate: values.pickupDate || null,
        deliveryDate: values.deliveryDate || null,
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
      queryClient.invalidateQueries({ queryKey: ["/api/held"] });
      toast({ title: "Invoice created", description: invoice.status === "held" ? "The invoice is on hold for the selected reviewers." : "The invoice is now pending review." });
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

  const branchMutation = useMutation({
    mutationFn: async ({ brokerId, fields }: {
      brokerId: string;
      fields: typeof branchForm;
    }) => {
      const response = await apiRequest("POST", "/api/invoices/broker-branches", {
        brokerId: Number(brokerId),
        branchName: fields.branchName.trim(),
        ...(fields.address.trim() ? { address: fields.address.trim() } : {}),
        ...(fields.city.trim() ? { city: fields.city.trim() } : {}),
        ...(fields.state.trim() ? { state: fields.state.trim() } : {}),
        ...(fields.zip.trim() ? { zip: fields.zip.trim() } : {}),
        ...(fields.phone.trim() ? { phone: fields.phone.trim() } : {}),
        ...(fields.email.trim() ? { email: fields.email.trim() } : {}),
        ...(fields.contactName.trim() ? { contactName: fields.contactName.trim() } : {}),
      });
      const payload = await response.json();
      const branch = payload?.branch ?? payload?.data ?? payload;
      if (!branch || typeof branch.id !== "number" || typeof branch.branchName !== "string") {
        throw new Error("Branch was saved, but the server returned an invalid branch record.");
      }
      return { branch, brokerId };
    },
    onSuccess: async ({ branch, brokerId }) => {
      const branchesKey = ["/api/brokers", brokerId, "branches"] as const;
      const cached = queryClient.getQueryData<any[]>(branchesKey);
      queryClient.setQueryData(branchesKey, [
        ...(Array.isArray(cached) ? cached.filter(item => item.id !== branch.id) : []),
        { ...branch, status: branch.status ?? "active" },
      ]);
      void queryClient.invalidateQueries({ queryKey: branchesKey, exact: true });
      const brokerKey = ["/api/brokers", brokerId] as const;
      void queryClient.invalidateQueries({ queryKey: brokerKey, exact: true });
      if (modalOpenRef.current && selectedBrokerIdRef.current === brokerId) {
        const branchId = String(branch.id);
        protectedBranchRef.current = { brokerId, branchId };
        setValues(current => current.brokerId === brokerId ? { ...current, branchId } : current);
        setBranchDialogOpen(false);
        setBranchCreateError("");
        setBranchForm({ branchName: "", address: "", city: "", state: "", zip: "", contactName: "", email: "", phone: "" });
      }
      await Promise.all([
        queryClient.refetchQueries({ queryKey: branchesKey, exact: true, type: "all" }),
        queryClient.refetchQueries({ queryKey: brokerKey, exact: true, type: "all" }),
      ]);
      if (modalOpenRef.current && selectedBrokerIdRef.current === brokerId) {
        const refreshed = queryClient.getQueryData<any[]>(branchesKey);
        if (!Array.isArray(refreshed) || !refreshed.some(item => item.id === branch.id)) {
          queryClient.setQueryData(branchesKey, [
            ...(Array.isArray(refreshed) ? refreshed : []),
            { ...branch, status: branch.status ?? "active" },
          ]);
        }
      }
      toast({ title: "Branch added", description: `${branch.branchName} was added to the broker.` });
    },
    onError: error => {
      let message = error instanceof Error ? error.message : "Unable to save this branch. Please try again.";
      try {
        const parsed = JSON.parse(message);
        message = parsed.message || parsed.error || message;
      } catch { /* Keep the original readable error. */ }
      setBranchCreateError(message);
    },
  });

  const nearDuplicateAlert = preflightAlerts.some(alert => alert.code === "DUPLICATE_NEAR" && alert.severity === "block");
  const hasUnresolvedBlock = preflightAlerts.some(alert => alert.severity === "block"
    && !(alert.code === "DUPLICATE_NEAR" && isManager && overrideNearDuplicate));
  const hasUnacknowledgedAlert = preflightAlerts.some(alert => alert.severity === "ack"
    && !acknowledgements[alert.code]?.acknowledged);
  const selectedAvailableRecipients = holdRecipients.filter(option =>
    option.available && values.heldFor.includes(option.value),
  );
  const lumperReceiptMissing = values.lumper === "yes" && !paperwork.lumperReceipt;
  const lumperTotalInvalid = values.lumperTotal.trim() !== ""
    && (!/^\d+(?:\.\d{1,2})?$/.test(values.lumperTotal) || Number(values.lumperTotal) > 99999999.99);
  const holdDetailsInvalid = values.holdForManagerReview && (
    holdRecipientsLoading || holdRecipientsError || !values.holdReason || selectedAvailableRecipients.length === 0
  );
  const valid = values.carrierInvoiceNumber.trim().length <= 100
    && values.loadNumber.trim() && values.clientId && values.brokerId
    && Number.isFinite(Number(values.amount)) && Number(values.amount) > 0
    && !lumperTotalInvalid
    && isLoadType(values.loadType)
    && paperwork.rateConfirmation && paperwork.billOfLading
    && !lumperReceiptMissing && !holdDetailsInvalid
    && !hasUnresolvedBlock && !hasUnacknowledgedAlert;
  // Explain the existing validation/async guards instead of leaving a disabled
  // submit button with no route back to a required preflight acknowledgement.
  const submissionBlockers = [
    values.carrierInvoiceNumber.trim().length > 100 && "Carrier invoice number must be 100 characters or fewer.",
    !values.loadNumber.trim() && "Enter a load number.",
    !values.clientId && "Select a carrier from the search results.",
    !values.brokerId && "Select a broker from the search results.",
    (!Number.isFinite(Number(values.amount)) || Number(values.amount) <= 0) && "Enter a rate greater than zero.",
    lumperTotalInvalid && "Enter a valid lumper total.",
    !isLoadType(values.loadType) && "Select a load type.",
    !paperwork.rateConfirmation && "Upload the Rate Confirmation PDF.",
    !paperwork.billOfLading && "Upload the Bill of Lading PDF.",
    lumperReceiptMissing && "Upload the Lumper Receipt PDF when Lumper is Yes.",
    holdDetailsInvalid && "Choose a hold reason and at least one available reviewer (wait for reviewers to load).",
    hasUnresolvedBlock && "Resolve the blocking preflight alerts.",
    hasUnacknowledgedAlert && "Review and acknowledge the required preflight alerts.",
    mutation.isPending && "Invoice creation is in progress.",
    branchMutation.isPending && "Wait for the branch to finish saving.",
    preflightLoading && "Wait for the preflight checks to finish.",
    entityDataLoading && "Wait for broker and carrier details to finish refreshing.",
    entityDataError && "Broker or carrier details could not refresh. Reselect the record or reopen the form.",
  ].filter((message): message is string => typeof message === "string");
  return (
    <Dialog open={open} onOpenChange={nextOpen => {
      if (branchMutation.isPending) return;
      onOpenChange(nextOpen);
    }}>
      <DialogContent showCloseButton={false} className="ff-create-invoice-dialog max-h-[92vh] max-w-6xl overflow-y-auto p-0">
        <DialogClose asChild>
          <NeuButton
            aria-label="Close"
            className="absolute right-4 top-4 h-8 min-h-8 w-8 rounded-full p-0 text-[#666666] shadow-[-3px_-3px_7px_#ffffff,3px_3px_7px_#c1c1c1] hover:text-[#27aab8]"
          >
            <X className="h-4 w-4" />
          </NeuButton>
        </DialogClose>
        <DialogHeader className="border-b border-[#c6c6c6] px-6 py-5 pr-16">
          <DialogTitle className="text-xl">Create Invoice</DialogTitle>
          <DialogDescription>Enter the load details. The invoice enters Pending Review unless placed on hold.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 p-6 lg:grid-cols-[240px_minmax(0,1fr)_240px]">
          <StatusPanel kind="broker" record={broker} />
          <form className="space-y-5" onSubmit={event => { event.preventDefault(); if (valid) mutation.mutate(); }}>
            {preflightError && <NeuNotice severity="block" className="text-sm">{preflightError}</NeuNotice>}
            {preflightAlerts.filter(alert => alert.severity === "info").map(alert => (
              <NeuNotice key={alert.code} title={alert.title} className="text-sm"><p>{alert.message}</p></NeuNotice>
            ))}
            <NeuCard pressed className="rounded-2xl p-4">
            <section className="space-y-3" aria-labelledby="ocr-upload-heading">
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
                  "w-full rounded-2xl border border-dashed border-[#aaa] bg-[#e0e0e0] px-4 py-5 text-left text-sm text-[#333] shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff] focus:outline-none focus:ring-2 focus:ring-blue-500",
                  ocrDragActive && "border-blue-500 bg-blue-50 ring-2 ring-blue-500",
                )}
              >
                <span className="block font-semibold">Drop PDF documents here</span>
                <span className="mt-1 block text-xs">or choose files · rate con, invoice, BOL/POD, and supporting docs</span>
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="accent" disabled={!ocrFiles.length || ["uploading", "queued", "processing"].includes(ocrStatus)} onClick={() => void uploadOcrBatch(ocrFiles)}>
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
                <NeuNotice key={alert.code} severity="block" data-testid="invoice-ocr-cross-check-alert" className="text-xs">
                  <strong>{alert.title}</strong><p className="mt-1">{alert.message}</p>
                </NeuNotice>
              ))}
              {ocrStatus === "completed" && ocrFields && (
                <>
                  {ocrMissingTypes.length > 0 && <p className="text-xs text-amber-800">Not included: {ocrMissingTypes.map(type => type.replace(/_/g, " ")).join(", ")}</p>}
                  {ocrAlerts.map(alert => (
                    <NeuNotice key={alert.code} severity={alert.severity} title={alert.title} data-testid="invoice-ocr-cross-check-alert" className="text-xs"><p>{alert.message}</p></NeuNotice>
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
            </NeuCard>
            <div className="space-y-2">
              <Label>Load Type <span data-required-mark>*</span></Label>
              <LoadTypeToggleGroup
                value={values.loadType}
                onChange={loadType => setValues(v => ({ ...v, loadType }))}
                neuStyle
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="carrierInvoiceNumber">Carrier Invoice Number <span className="text-xs font-normal text-slate-500">(optional)</span></Label>
                <Input id="carrierInvoiceNumber" maxLength={100} value={values.carrierInvoiceNumber} onChange={e => { invalidatePreflightAcknowledgements(); setValues(v => ({ ...v, carrierInvoiceNumber: e.target.value })); }} onBlur={() => void runPreflight({}, false)} placeholder="Enter carrier's invoice number" />
                {renderOcrSource("invoice_number")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="loadNumber">Load # <span data-required-mark>*</span></Label>
                <Input id="loadNumber" required value={values.loadNumber} onChange={e => { invalidatePreflightAcknowledgements(); setValues(v => ({ ...v, loadNumber: e.target.value })); }} onBlur={() => void runPreflight({}, false)} placeholder="Enter load number" />
                {renderOcrSource("load_number")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoiceDate">Invoice Date</Label>
                <Input id="invoiceDate" type="date" value={values.invoiceDate} onChange={e => { invalidatePreflightAcknowledgements(); setValues(v => ({ ...v, invoiceDate: e.target.value })); }} onBlur={() => void runPreflight({}, false)} />
                {renderOcrSource("invoice_date")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rateAmount">Rate <span data-required-mark>*</span></Label>
                <Input id="rateAmount" required min="0.01" step="0.01" type="number" value={values.amount} onChange={e => { invalidatePreflightAcknowledgements(); setValues(v => ({ ...v, amount: e.target.value })); }} onBlur={() => void runPreflight({}, false)} placeholder="Rate confirmation amount" />
                {renderOcrSource(ocrFields?.rate?.trim() ? "rate" : "amount")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pickupDate">Pickup Date</Label>
                <Input id="pickupDate" type="date" value={values.pickupDate} onChange={e => { invalidatePreflightAcknowledgements(); setValues(v => ({ ...v, pickupDate: e.target.value })); }} onBlur={() => void runPreflight({}, false)} />
                {renderOcrSource("pickup_date")}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deliveryDate">Delivery Date</Label>
                <Input id="deliveryDate" type="date" value={values.deliveryDate} onChange={e => { invalidatePreflightAcknowledgements(); setValues(v => ({ ...v, deliveryDate: e.target.value })); }} onBlur={() => void runPreflight({}, false)} />
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
                <Label>Lumper</Label>
                <Select value={values.lumper} onValueChange={lumper => setValues(v => ({ ...v, lumper: lumper === "unspecified" ? "" : lumper }))}>
                  <SelectTrigger className="ff-create-invoice-select-trigger"><SelectValue placeholder="Select Yes or No" /></SelectTrigger>
                  <SelectContent className="ff-create-invoice-select-content"><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem><SelectItem value="unspecified">Not specified</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lumperTotal">Lumper Total <span className="text-xs font-normal text-slate-500">(optional)</span></Label>
                <Input id="lumperTotal" min="0" step="0.01" type="number" value={values.lumperTotal} onChange={e => setValues(v => ({ ...v, lumperTotal: e.target.value }))} placeholder="0.00" />
                {lumperTotalInvalid && <p role="alert" className="text-xs text-red-700">Lumper Total must be a nonnegative amount.</p>}
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
                    ]) void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
                    const next = {
                      ...values,
                      clientId: String(item.id),
                      loadType: displayLoadType(item.cargoType),
                    };
                     invalidatePreflightAcknowledgements();
                    setValues(next);
                    void runPreflight(next, true);
                  }}
                 placeholder="Search carriers..."
               />
               <div className="relative space-y-1.5">
                  <Label>Broker <span data-required-mark>*</span></Label>
                 <div className="relative">
                   <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input className="h-11 pl-9" value={brokerOpen ? brokerSearch : broker?.name ?? ""} placeholder={brokerLoading ? "Loading broker..." : "Search brokers..."} onFocus={() => { setBrokerOpen(true); setBrokerSearch(""); }} onChange={event => { setBrokerSearch(event.target.value); setBrokerOpen(true); }} />
                     {values.brokerId && !brokerOpen && <button type="button" aria-label="Clear Broker" onClick={() => { invalidatePreflightAcknowledgements(); ocrSelectedBrokerId.current = null; setOcrBrokerMatch(null); setValues(v => ({ ...v, brokerId: "", branchId: "" })); setBrokerOpen(true); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-4 w-4" /></button>}
                 </div>
                  {brokerOpen && <div className="ff-create-invoice-search-popup absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-xl border p-1">
                      {brokers.length ? brokers.map(item => <button key={item.id} type="button" onClick={() => { void queryClient.invalidateQueries({ queryKey: ["/api/brokers", String(item.id)] }, { cancelRefetch: false }); ocrSelectedBrokerId.current = null; setOcrBrokerMatch(null); const next = { ...values, brokerId: String(item.id), branchId: "" }; invalidatePreflightAcknowledgements(); setValues(next); setBrokerSearch(""); setBrokerOpen(false); void runPreflight(next, true); }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800"><span className="font-medium">{item.name}</span><span className="text-xs capitalize text-slate-400">{item.status}</span></button>) : <p className="px-3 py-4 text-center text-xs text-slate-500">No matches found</p>}
                 </div>}
               </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="branchId">Branch</Label>
                  <Button
                    type="button"
                    variant="default"
                    disabled={!values.brokerId || branchMutation.isPending}
                    title={!values.brokerId ? "Select a broker first" : undefined}
                    onClick={() => {
                      setBranchForm({ branchName: "", address: "", city: "", state: "", zip: "", contactName: "", email: "", phone: "" });
                      setBranchCreateError("");
                      setBranchDialogOpen(true);
                    }}
                    className="min-h-8 rounded-lg px-2 text-xs"
                  >
                    <Plus className="h-3 w-3" /> Add Branch
                  </Button>
                </div>
                <Select value={values.branchId || "__none"} onValueChange={branchId => setValues(v => ({ ...v, branchId: branchId === "__none" ? "" : branchId }))}>
                  <SelectTrigger id="branchId" className="ff-create-invoice-select-trigger" disabled={!values.brokerId || branchesLoading || branchesError}>
                    <SelectValue placeholder={!values.brokerId ? "Select a broker first" : branchesLoading ? "Loading branches..." : branchesError ? "Unable to load branches" : "Select a branch"} />
                  </SelectTrigger>
                  <SelectContent className="ff-create-invoice-select-content">
                    <SelectItem value="__none">None — optional</SelectItem>
                    {branches.map(branch => <SelectItem key={branch.id} value={String(branch.id)}>{branch.branchName}</SelectItem>)}
                  </SelectContent>
                </Select>
                {values.brokerId && branchesError && (
                  <p role="alert" className="text-xs text-red-700">Unable to load branches. Retry by reopening the invoice form.</p>
                )}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Payment Type</Label>
                <Select value={values.paymentType} onValueChange={paymentType => setValues(v => ({ ...v, paymentType, bankAccountId: paymentType === "ACH" ? v.bankAccountId : "" }))}>
                  <SelectTrigger className="ff-create-invoice-select-trigger"><SelectValue /></SelectTrigger>
                  <SelectContent className="ff-create-invoice-select-content"><SelectItem value="ACH">ACH</SelectItem><SelectItem value="Wire">Wire</SelectItem></SelectContent>
                </Select>
                 <p className="text-xs font-medium text-red-600">Wire (same day funding) cutoff time is at 13:00:00 MT</p>
              </div>
              <NeuCard pressed className="space-y-3 p-4 sm:col-span-2">
                <div className="flex items-center gap-2">
                  <Checkbox id="holdForManagerReview" checked={values.holdForManagerReview}
                    onCheckedChange={checked => setValues(v => ({ ...v, holdForManagerReview: checked === true }))}
                    className="rounded-md border-[#999] data-[state=checked]:border-[#168894] data-[state=checked]:bg-[#168894] data-[state=checked]:text-white" />
                  <Label htmlFor="holdForManagerReview">Place on hold</Label>
                </div>
                {values.holdForManagerReview && (
                  <div className="space-y-4 border-t border-[#aaa] pt-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="holdReason">Reason for hold <span data-required-mark>*</span></Label>
                      <Select value={values.holdReason} onValueChange={holdReason => setValues(v => ({ ...v, holdReason }))}>
                        <SelectTrigger id="holdReason" className="ff-create-invoice-select-trigger">
                          <SelectValue placeholder="Select a reason" />
                        </SelectTrigger>
                        <SelectContent className="ff-create-invoice-select-content">
                          {HOLD_REASONS.map(reason => <SelectItem key={reason} value={reason}>{reason}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {!values.holdReason && <p className="text-xs text-red-700">Choose a reason before placing this invoice on hold.</p>}
                    </div>
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium">Held for <span data-required-mark>*</span></legend>
                      {holdRecipientsLoading && <p role="status" className="text-xs text-slate-700">Loading current hold recipients…</p>}
                      {holdRecipientsError && <p role="alert" className="text-xs font-medium text-red-700">Unable to load hold recipients. Close and reopen the invoice form to retry; held submission is unavailable until this list loads.</p>}
                      {!holdRecipientsLoading && !holdRecipientsError && holdRecipients.length === 0 && (
                        <p role="alert" className="text-xs text-red-700">No hold recipients are currently available.</p>
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        {holdRecipients.map(option => {
                          const checked = values.heldFor.includes(option.value);
                          return (
                            <label key={option.value} className={cn(
                              "flex items-start gap-2 rounded-xl bg-[#e0e0e0] px-3 py-2 text-sm shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#ffffff]",
                              !option.available && "cursor-not-allowed bg-[#d8d8d8] text-slate-500 opacity-75",
                            )}>
                              <Checkbox
                                checked={checked && option.available}
                                disabled={!option.available || holdRecipientsLoading || holdRecipientsError}
                                onCheckedChange={nextChecked => setValues(current => ({
                                  ...current,
                                  heldFor: nextChecked === true
                                    ? Array.from(new Set([...current.heldFor, option.value]))
                                    : current.heldFor.filter(value => value !== option.value),
                                }))}
                              />
                              <span className="min-w-0">
                                <span className="block font-medium">{option.label}</span>
                                {!option.available && option.unavailableReason && (
                                  <span className="block text-xs text-slate-500">{option.unavailableReason}</span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      {!holdRecipientsLoading && !holdRecipientsError && selectedAvailableRecipients.length === 0 && holdRecipients.length > 0 && (
                        <p className="text-xs text-red-700">Select at least one available recipient.</p>
                      )}
                    </fieldset>
                  </div>
                )}
              </NeuCard>
              {values.paymentType === "ACH" && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Bank Account Credentials</Label>
                  <Select disabled={!values.clientId || bankAccountsLoading || bankAccountsError} value={values.bankAccountId} onValueChange={bankAccountId => setValues(v => ({ ...v, bankAccountId }))}>
                    <SelectTrigger className="ff-create-invoice-select-trigger"><SelectValue placeholder={values.clientId ? "Select carrier bank account" : "Select a carrier first"} /></SelectTrigger>
                    <SelectContent className="ff-create-invoice-select-content">
                      {bankAccounts.map(account => (
                        <SelectItem key={account.id} value={String(account.id)}>
                          {account.bankName || "Bank account"} · {account.accountType || "Account"} ending in {account.lastFour || "••••"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-4 sm:col-span-2">
                <div>
                  <h3 className="text-sm font-semibold">Instructions</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Textarea value={values.instructionsDetails} onChange={e => setValues(v => ({ ...v, instructionsDetails: e.target.value }))} placeholder="please be clear and specific" rows={3} className="sm:col-span-2" />
                  </div>
                  {renderOcrSource("broker_name")}
                </div>
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold">Paperwork Uploads</h3>
                   <p className="mt-1 text-xs font-medium text-red-600">PDF files only. Large files are compressed automatically before storage (135MB upload limit).</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                     {PAPERWORK.map(({ key, label, required }) => (
                       <div key={key} className="space-y-1">
                         <PaperworkDropzone
                           label={label}
                           required={required || (key === "lumperReceipt" && values.lumper === "yes")}
                           file={paperwork[key]}
                           onFile={file => setPaperwork(current => ({ ...current, [key]: file }))}
                           onRemove={() => setPaperwork(current => ({ ...current, [key]: null }))}
                           onInvalid={message => toast({ title: "Invalid paperwork", description: message, variant: "destructive" })}
                         />
                         {key === "lumperReceipt" && lumperReceiptMissing && (
                           <p role="alert" className="text-xs font-medium text-red-700">Lumper Receipt is required when Lumper is Yes. Upload the receipt before submitting.</p>
                         )}
                       </div>
                     ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t pt-5">
              {submissionBlockers.length > 0 && (
                <NeuNotice className="w-full" severity={hasUnresolvedBlock ? "block" : hasUnacknowledgedAlert ? "ack" : "info"} title="Before submitting" data-testid="invoice-submit-blockers">
                  <ul className="list-disc space-y-1 pl-5">
                    {submissionBlockers.map(message => <li key={message}>{message}</li>)}
                  </ul>
                </NeuNotice>
              )}
              {(preflightAlerts.length > 0 || preflightError) && (
                <Button type="button" variant="outline" data-testid="review-invoice-alerts" onClick={() => setPreflightOpen(true)}>
                  Review preflight alerts
                </Button>
              )}
              <Button type="button" variant="ghost" disabled={branchMutation.isPending} onClick={() => {
                if (!branchMutation.isPending) onOpenChange(false);
              }}>Cancel</Button>
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
              <Button type="submit" variant="accent" disabled={!valid || mutation.isPending || branchMutation.isPending || preflightLoading || entityDataLoading || entityDataError} className="px-6">
                {mutation.isPending ? "Creating..." : "Submit"}
              </Button>
            </div>
          </form>
          <StatusPanel kind="carrier" record={carrier} />
        </div>
      </DialogContent>
      <Dialog open={branchDialogOpen} onOpenChange={nextOpen => {
        if (branchMutation.isPending) return;
        setBranchDialogOpen(nextOpen);
      }}>
        <DialogContent
          showCloseButton={false}
          className="ff-create-invoice-dialog max-h-[85vh] max-w-lg overflow-y-auto p-0"
        >
          <div className="flex items-center justify-between border-b border-[#c6c6c6] px-5 py-4">
            <DialogTitle className="text-sm font-bold">Add Broker Branch</DialogTitle>
            <button
              type="button"
              aria-label="Close add branch"
              disabled={branchMutation.isPending}
              onClick={() => setBranchDialogOpen(false)}
              className="rounded-lg bg-[#e0e0e0] px-2 font-bold leading-5 text-[#555] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#ffffff] disabled:opacity-50"
            >×</button>
          </div>
          <DialogDescription className="sr-only">Add a branch to the selected broker. Only the branch name is required.</DialogDescription>
          <form
            className="space-y-3 bg-[#e0e0e0] p-5"
            onSubmit={event => {
              event.preventDefault();
              const brokerId = values.brokerId;
              if (!brokerId || !branchForm.branchName.trim() || branchMutation.isPending) return;
              setBranchCreateError("");
              branchMutation.mutate({ brokerId, fields: branchForm });
            }}
          >
            <p className="rounded-xl bg-[#e0e0e0] px-3 py-2 text-xs text-[#555] shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#ffffff]">
              Adding branch for <strong>{broker?.name ?? "selected broker"}</strong>. Name is required; all other details are optional.
            </p>
            {branchCreateError && <NeuNotice severity="block" className="text-xs">{branchCreateError}</NeuNotice>}
            <div className="grid grid-cols-2 gap-2.5">
              {([
                ["branchName", "Branch name", true],
                ["address", "Address", false],
                ["city", "City", false],
                ["state", "State", false],
                ["zip", "ZIP", false],
                ["contactName", "Contact name", false],
                ["email", "Email", false],
                ["phone", "Phone", false],
              ] as const).map(([key, label, required]) => (
                <label key={key} className="space-y-1 text-xs font-semibold text-[#222]">
                  <span>{label}{required ? <span data-required-mark> *</span> : ""}</span>
                  <Input
                    autoComplete="off"
                    type={key === "email" ? "email" : "text"}
                    required={required}
                    value={branchForm[key]}
                    onChange={event => setBranchForm(current => ({ ...current, [key]: event.target.value }))}
                    className="min-h-9"
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-[#888] pt-3">
              <Button
                type="button"
                disabled={branchMutation.isPending}
                onClick={() => setBranchDialogOpen(false)}
                className="min-h-9 px-3"
              >Cancel</Button>
              <Button
                type="submit"
                disabled={!values.brokerId || !branchForm.branchName.trim() || branchMutation.isPending}
                variant="accent"
                className="min-h-9 px-3 disabled:opacity-60"
              >{branchMutation.isPending ? "Saving..." : "Save Branch"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={preflightOpen} onOpenChange={setPreflightOpen}>
        <DialogContent showCloseButton={false} className="ff-create-invoice-dialog max-h-[80vh] max-w-xl overflow-y-auto p-0">
          <div className="flex items-center justify-between border-b border-[#c6c6c6] px-5 py-4">
            <DialogTitle className="text-sm font-bold">Invoice Preflight Alerts</DialogTitle>
            <NeuButton type="button" onClick={() => setPreflightOpen(false)} aria-label="Close preflight alerts" className="h-8 min-h-8 w-8 rounded-full p-0 text-[#666] hover:text-[#27aab8]">×</NeuButton>
          </div>
          <DialogDescription className="sr-only">Review carrier and broker alerts before submitting this invoice.</DialogDescription>
          <div className="space-y-3 bg-[#e0e0e0] p-5 text-sm">
            {preflightLoading && <p className="rounded-xl px-3 py-2 shadow-[inset_3px_3px_6px_#b8b8b8,inset_-3px_-3px_6px_#ffffff]">Checking carrier and broker records…</p>}
            {preflightError && <NeuNotice severity="block">{preflightError}</NeuNotice>}
            {preflightError && <Button type="button" disabled={preflightLoading} onClick={() => void runPreflight()}>Retry preflight checks</Button>}
            {preflightAlerts.filter(alert => alert.severity === "info").map(alert => (
              <NeuNotice key={alert.code} title={alert.title}><p>{alert.message}</p></NeuNotice>
            ))}
            {preflightAlerts.filter(alert => alert.severity !== "info").map(alert => (
              <NeuNotice key={alert.code} severity={alert.severity}>
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
                      <NeuTextarea value={acknowledgements[alert.code]?.reason ?? ""} onChange={event => setAcknowledgements(current => ({ ...current, [alert.code]: { acknowledged: !!current[alert.code]?.acknowledged, reason: event.target.value } }))} className="mt-1 min-h-16 w-full text-sm" />
                    </label>
                  </div>
                )}
              </NeuNotice>
            ))}
            {nearDuplicateAlert && isManager && (
              <NeuNotice severity="ack"><label className="flex items-start gap-2">
                <input type="checkbox" checked={overrideNearDuplicate} onChange={event => setOverrideNearDuplicate(event.target.checked)} />
                <span><strong>Manager override:</strong> allow creation despite this near-duplicate alert.</span>
              </label></NeuNotice>
            )}
            {preflightAlerts.length === 0 && !preflightLoading && !preflightError && <NeuNotice>No active preflight alerts.</NeuNotice>}
            <div className="flex justify-end gap-2 border-t border-gray-500 pt-3">
              <Button type="button" onClick={() => setPreflightOpen(false)}>Close</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}