import { useEffect, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLocation, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ChevronDown, Check, Eye, EyeOff, FileUp, Loader2,
  RotateCcw, Save, ShieldCheck, X,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button, Input, Textarea } from "@/components/admin-neu/adapters";
import { NeuCard, NeuSelect } from "@/styles/neu/components";
import "@/components/admin-neu/admin-neu-page.css";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const ownerKeys = ["firstName", "middleName", "lastName", "prefix", "title", "dob", "ssn", "pin", "fein", "mobileNumber", "email", "idType", "idNumber", "idState", "home"];
const sections = [
  { id: "carrier", title: "Carrier Information", fields: ["status", "established", "structure", "state", "faxNumber", "since", "businessDescription", "legalName", "businessName", "extraLegalName", "dba", "preferredName", "initials", "language"] },
  { id: "bank", title: "Business Bank Information", fields: ["bankName", "bankAccountNumber", "abaRouting", "bankOfficer", "bankDateOpened", "bankPhone", "bankFax", "bankAddress", "bankCity", "bankState", "bankZip"] },
  { id: "address", title: "Addresses", fields: ["physicalAddress", "physicalCity", "physicalState", "physicalZip", "mailingAddress", "mailingCity", "mailingState", "mailingZip"] },
  { id: "ucc", title: "UCC", fields: ["ucc1IniFileNumber", "ucc1IniExpiration", "ucc1IniReviewBy", "ucc1IniReviewDate", "ucc1ConFileNumber", "ucc1ConExpiration", "ucc1ConReviewBy", "ucc1ConReviewDate", "uccUrl"] },
  { id: "coi", title: "Certificate of Insurance", fields: ["coiInsExp", "coiEffectiveDate", "coiCancellationDate", "coiReviewBy", "coiReviewDate"] },
  { id: "workers", title: "Workers Compensation", fields: ["wcExpiration", "wcEffective", "wcCancellation", "wcReviewBy", "wcReviewDate"] },
  { id: "corporation", title: "Corporation", fields: ["corpStatus", "corpReviewBy", "corpReviewDate", "corpUrl"] },
  { id: "referral", title: "Referral", fields: ["referralAdmin", "referral"] },
  { id: "misc", title: "Miscellaneous", fields: ["ownershipChangeInPastTwoYears", "ownsOrLeasesLocation", "leaseInfo", "howFoundUs"] },
  { id: "financial", title: "Financial Information", fields: ["filedBankruptcy", "taxesPastDue", "taxLienFiled", "hasFactoredBefore", "avs", "mfv", "cor", "aia", "invoiceTerms", "hasCommercialLoans"] },
  { id: "authority", title: "Trucking Authority", fields: ["entityType", "usdotStatus", "dotNumber", "mcs150", "authorityStatus", "mcNumber", "businessPhone", "dunNumber", "powerUnits", "drivers", "authorityType", "vehiclePercent", "driverPercent", "crashes", "authorityReviewBy", "authorityReviewDate", "operationClassification", "carrierOperation", "cargoCarried", "fmcsaUrl", "hasBrokerAuthority", "otherBusinessNames", "otherMcNumbers"] },
  { id: "factoring", title: "Factoring Settings", fields: ["factoringEnabled", "emailAlert", "smsAlert", "former", "faPercent", "ratePercent", "prePay", "priorityForFunds", "factoringCompany", "noa", "commission", "currentLimit", "maxLimit", "ar", "arOver90Days", "debt", "loanType", "collectionBalance", "vendor", "podSubmission", "ldm", "lwf", "fdm", "fwf", "selectUnit", "holdAllFunding"] },
  { id: "amendment", title: "Amendment", fields: ["amendmentFor", "amendmentToReserves"] },
  { id: "contract", title: "Contract", fields: ["oneYearContract", "monthsContract"] },
  { id: "invoicing", title: "Invoicing Type", fields: ["invoicingType", "driverSupport", "invoicingType2", "preDiem", "invoiceOnly", "chargeback", "customReferenceNumber", "vendorInvoiceOnly", "doubleApproval"] },
  { id: "linked", title: "Linked Records", fields: ["linkedDriver1", "linkedDriver2", "linkedBrokerId", "linkedSubBrokerId"] },
] as const;

const documentGroups = [
  { title: "Factoring Documents", items: ["Factoring Application", "Security Agreement", "Security Agreement 2.0", "Letter Of Intent", "Aging Report", "Buyout Agreement", "Percentage Amendment", "Release Letter", "NOA", "Deposit & Withdrawals Agreement"] },
  { title: "UCC Documents", items: ["UCC-1-UT Initial Financing Statement", "UCC-3-UT Continuation", "UCC-3-UT Termination", "UCC-11 Search and Copy Request"] },
  { title: "Carrier Documents", items: ["Bonding", "EIN Letter", "W9", "Articles Of Organization", "Authority MC#", "Void Check", "Driver License", "Insurance Certificate", "WC COI", "Logo", "Envelope"] },
];
const documentTypes = documentGroups.flatMap((g) => g.items);
const formSchema = z.object({
  name: z.string().trim().min(1, "Legal carrier name is required"),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")),
  phone: z.string().trim().min(7, "Phone is required"),
  address: z.string().trim().min(1, "Physical address is required"),
  status: z.enum(["new_client", "active", "inactive"]).default("new_client"),
  language: z.string(),
  mcNumber: z.string(),
  advanceRate: z.string(),
  factoringFeeRate: z.string(),
}).passthrough();
type CarrierForm = z.infer<typeof formSchema> & Record<string, any>;
type QueuedFile = { file: File; category: string; key: string };

const pretty = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
const initialOwners = () => [0, 1, 2].map(() => Object.fromEntries(ownerKeys.map((k) => [k, ""])));
const defaults: CarrierForm = {
  ...Object.fromEntries(sections.flatMap((s) => s.fields).map((f) => [f, ""])),
  name: "", email: "", phone: "", address: "", status: "new_client", language: "English",
  mcNumber: "", advanceRate: "80.00", factoringFeeRate: "3.00", mailingSameAsPhysical: false,
  owners: initialOwners(), supportChecklist: {},
};

function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return <NeuCard className="overflow-hidden rounded-2xl">
    <details open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between border-b border-[#c9c9c9] px-4 py-3 text-[11px] font-bold uppercase tracking-[0.16em] text-[#555] [&::-webkit-details-marker]:hidden">
        {title}<ChevronDown className="h-4 w-4 text-[#168d99] transition-transform" />
      </summary><div className="p-4">{children}</div>
    </details>
  </NeuCard>;
}

function SecretInput({ registration, value, onChange, placeholder }: { registration?: any; value?: string; onChange?: (v: string) => void; placeholder?: string }) {
  const [visible, setVisible] = useState(false);
  return <div className="relative"><Input type={visible ? "text" : "password"} autoComplete="new-password" className="pr-9" placeholder={placeholder} {...registration} value={value} onChange={onChange ? (e) => onChange(e.target.value.replace(/\D/g, "")) : undefined} /><Button type="button" variant="ghost" size="icon" onClick={() => setVisible((v) => !v)} className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-[#777]" aria-label={visible ? "Hide value" : "Show value"}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button></div>;
}

export default function CarrierOnboarding() {
  const { id } = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const clientId = id && id !== "new" ? Number(id) : null;
  const editing = Boolean(clientId);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [uploadState, setUploadState] = useState<Record<string, string>>({});
  const [openDrop, setOpenDrop] = useState<string | null>(null);
  const [existingDocs, setExistingDocs] = useState<any[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: client, isLoading } = useQuery<any>({ queryKey: ["/api/clients", clientId], enabled: editing, queryFn: async () => (await fetch(`/api/clients/${clientId}`, { credentials: "include" })).json() });
  const form = useForm<CarrierForm>({ resolver: zodResolver(formSchema), defaultValues: defaults, mode: "onBlur" });
  const physical = form.watch(["physicalAddress", "physicalCity", "physicalState", "physicalZip"]);
  const sameMailing = form.watch("mailingSameAsPhysical");
  const watchedDocs = form.watch("supportChecklist") || {};

  useEffect(() => {
    if (client) {
      const onboarding = client.onboardingData || {};
      form.reset({ ...defaults, ...onboarding, ...client, owners: client.owners?.length ? [...client.owners, ...initialOwners()].slice(0, 3) : initialOwners(), supportChecklist: onboarding.supportChecklist || {} });
    }
  }, [client]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (sameMailing) {
      ["Address", "City", "State", "Zip"].forEach((suffix, i) => form.setValue(`mailing${suffix}`, physical[i] || ""));
    }
  }, [sameMailing, physical, form]);
  useEffect(() => {
    if (clientId) fetch(`/api/clients/${clientId}/documents`, { credentials: "include" }).then((r) => r.ok ? r.json() : []).then(setExistingDocs).catch(() => setExistingDocs([]));
  }, [clientId]);

  const addFiles = (category: string, files: FileList | File[]) => {
    const additions = Array.from(files).map((file) => ({ file, category, key: `${category}-${file.name}-${file.lastModified}` }));
    setQueue((old) => [...old.filter((x) => !additions.some((a) => a.key === x.key)), ...additions]);
    setOpenDrop(null);
  };
  const removeFile = (key: string) => setQueue((old) => old.filter((x) => x.key !== key));
  const inputLabel = (field: string) => field === "name" ? "Legal Carrier Name" : pretty(field);
  const renderInput = (field: string) => {
    const isDate = /date|expiration|effective|cancellation|reviewBy|established|since|dob/i.test(field);
    const isTextArea = ["businessDescription", "leaseInfo", "cargoCarried", "otherBusinessNames", "otherMcNumbers"].includes(field);
    const isSecret = field === "bankAccountNumber" || field === "abaRouting";
    return <div key={field} className={isTextArea ? "sm:col-span-2" : ""}><Label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#777]">{inputLabel(field)}</Label>
      {field === "status" ? <NeuSelect aria-label="Carrier status" {...form.register(field)}><option value="new_client">New Client</option><option value="active">Active</option><option value="inactive">Inactive</option></NeuSelect> : isTextArea ? <Textarea rows={2} {...form.register(field)} /> : isSecret ? <SecretInput registration={form.register(field)} /> : <Input type={isDate ? "date" : "text"} {...form.register(field)} />}</div>;
  };
  const submit = async (values: CarrierForm) => {
    const { owners, supportChecklist, mailingSameAsPhysical, bankAccountNumber, abaRouting, ...rest } = values;
    const onboardingData = { ...rest, mailingSameAsPhysical, supportChecklist };
    const payload = { name: values.name, email: values.email, phone: values.phone, address: values.address, status: values.status, language: values.language, mcNumber: values.mcNumber, advanceRate: values.advanceRate, factoringFeeRate: values.factoringFeeRate, owners, bankAccountNumber, abaRouting, onboardingData };
    try {
      const response = await apiRequest(editing ? "PUT" : "POST", editing ? `/api/clients/${clientId}` : "/api/clients", payload);
      const saved = await response.json();
      const savedId = saved.id || clientId;
      for (const item of queue) {
        setUploadState((s) => ({ ...s, [item.key]: "Uploading" }));
        const body = new FormData(); body.append("file", item.file); body.append("documentCategory", item.category);
        const upload = await fetch(`/api/clients/${savedId}/documents`, { method: "POST", body, credentials: "include" });
        if (!upload.ok) throw new Error(`Upload failed: ${item.file.name}`);
        setUploadState((s) => ({ ...s, [item.key]: "Uploaded" }));
      }
      qc.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: editing ? "Carrier record updated" : "Carrier onboarded", description: `${queue.length} document${queue.length === 1 ? "" : "s"} processed.` });
      navigate(`/carriers/${savedId}`);
    } catch (error: any) { toast({ title: "Unable to save carrier", description: error.message, variant: "destructive" }); }
  };

  if (editing && isLoading) return <AppShell title="Carrier onboarding" group="Operations"><div className="animate-pulse space-y-4"><div className="h-16 rounded-2xl bg-[#d2d2d2]" /><div className="h-80 rounded-2xl bg-[#d2d2d2]" /></div></AppShell>;
  return <AppShell title={editing ? "Edit carrier" : "New carrier onboarding"} subtitle="Structured intake · sensitive data protected" group="Operations">
    <div className="ff-admin-page mx-auto max-w-[1500px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#c9c9c9] pb-4">
        <div><Button variant="ghost" size="sm" className="-ml-2 mb-1 gap-2 text-[#666]" onClick={() => navigate("/carriers")}><ArrowLeft className="h-4 w-4" />Back to carriers</Button><h1 className="text-2xl font-bold tracking-tight text-[#333]">{editing ? "Edit carrier record" : "Carrier onboarding"}</h1><p className="text-xs text-[#777]">Enter exact operating data. Required fields are marked with an asterisk.</p></div>
        <div className="flex items-center gap-2 text-[11px] text-[#666]"><ShieldCheck className="h-4 w-4 text-[#168d99]" />Internal operations console</div>
      </div>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        <Section title="Core record">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {["name", "email", "phone", "address", "mcNumber", "advanceRate", "factoringFeeRate"].map((f) => <div key={f} className={f === "address" ? "lg:col-span-2" : ""}><Label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#777]">{inputLabel(f)} {["name", "phone", "address"].includes(f) && <span className="text-[#a3483e]">*</span>}</Label>{f === "address" ? <Textarea rows={1} {...form.register(f)} /> : <Input type={f === "email" ? "email" : "text"} {...form.register(f)} />}{form.formState.errors[f] && <p className="mt-1 text-[11px] text-[#a3483e]">{String(form.formState.errors[f]?.message)}</p>}</div>)}
            <div><Label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#777]">Status</Label><NeuSelect aria-label="Carrier status" {...form.register("status")}><option>New Client</option><option>Active</option><option>Inactive</option></NeuSelect></div>
            <div><Label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#777]">Language</Label><NeuSelect aria-label="Carrier language" {...form.register("language")}><option>English</option><option>Spanish</option><option>Other</option></NeuSelect></div>
          </div>
        </Section>
        <Section title="Owner information · up to 3 owners">
          <div className="space-y-3">{[0, 1, 2].map((owner) => <div key={owner} className="rounded-xl bg-[#e0e0e0] p-3 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-[#444]">Owner {owner + 1}</span><span className="text-[10px] uppercase tracking-wider text-[#777]">Identity & contact</span></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{ownerKeys.map((key) => <div key={key}><Label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[#777]">{pretty(key)}</Label>{key === "ssn" ? <SecretInput registration={form.register(`owners.${owner}.${key}`)} /> : <Input type={key === "dob" ? "date" : "text"} {...form.register(`owners.${owner}.${key}`)} />}</div>)}</div></div>)}</div>
        </Section>
        <Section title="Mailing and physical address">
          <div className="mb-3 flex items-center gap-2"><Checkbox checked={sameMailing} onCheckedChange={(v) => form.setValue("mailingSameAsPhysical", Boolean(v))} /><Label className="text-xs font-medium">Mailing address is the same as physical</Label></div>
          <div className="grid gap-3 md:grid-cols-2"><div><p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#777]">Physical</p><div className="grid gap-3 sm:grid-cols-2">{["physicalAddress", "physicalCity", "physicalState", "physicalZip"].map(renderInput)}</div></div><div><p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#777]">Mailing</p><div className="grid gap-3 sm:grid-cols-2">{["mailingAddress", "mailingCity", "mailingState", "mailingZip"].map(renderInput)}</div></div></div>
        </Section>
        {sections.filter((s) => s.id !== "address").map((section) => <Section key={section.id} title={section.title} defaultOpen={["carrier", "bank", "authority", "factoring"].includes(section.id)}><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{section.fields.map(renderInput)}</div></Section>)}
        <Section title="Support information checklist">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{documentTypes.map((doc) => <label key={doc} className="flex items-center gap-2 rounded-xl bg-[#e0e0e0] px-2.5 py-2 text-xs shadow-[-3px_-3px_7px_#fff,3px_3px_7px_#c1c1c1]"><Checkbox checked={Boolean(watchedDocs[doc])} onCheckedChange={(v) => form.setValue(`supportChecklist.${doc}`, Boolean(v))} />{doc}</label>)}</div>
        </Section>
        <Section title="Document intake">
          <p className="mb-3 text-xs text-[#777]">Drop or select files by type. Files remain queued until the carrier record is saved.</p>
          {documentGroups.map((group) => <div key={group.title} className="mb-4 last:mb-0"><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[#444]">{group.title}</h3><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{group.items.map((category) => { const queued = queue.filter((x) => x.category === category); const docs = existingDocs.filter((x) => (x.documentCategory || x.documentType) === category); return <div key={category} className="relative rounded-xl bg-[#e0e0e0] p-3 shadow-[-3px_-3px_7px_#fff,3px_3px_7px_#c1c1c1]" onDragOver={(e) => { e.preventDefault(); setOpenDrop(category); }} onDrop={(e) => { e.preventDefault(); addFiles(category, e.dataTransfer.files); }}><input ref={openDrop === category ? fileRef : undefined} type="file" className="hidden" multiple onChange={(e) => e.target.files && addFiles(category, e.target.files)} /><Button type="button" variant="ghost" className="h-auto w-full justify-start whitespace-normal p-0 text-left" onClick={() => { setOpenDrop(category); setTimeout(() => fileRef.current?.click(), 0); }}><span className="block w-full"><span className="mb-2 flex items-center justify-between"><FileUp className="h-4 w-4 text-[#168d99]" /><span className="text-[9px] font-bold uppercase tracking-wider text-[#777]">{docs.length ? `${docs.length} on file` : "Optional"}</span></span><span className="block text-xs font-semibold text-[#444]">{category}</span><span className="mt-1 block text-[10px] text-[#777]">Drop file or browse</span></span></Button>{queued.map((item) => <div key={item.key} className="mt-2 flex items-center gap-1 rounded-lg bg-[#e0e0e0] px-1.5 py-1 text-[10px] shadow-[inset_2px_2px_4px_#b8b8b8,inset_-2px_-2px_4px_#fff]"><span className="min-w-0 flex-1 truncate">{item.file.name}</span>{uploadState[item.key] === "Uploading" ? <Loader2 className="h-3 w-3 animate-spin" /> : uploadState[item.key] === "Uploaded" ? <Check className="h-3 w-3 text-[#168d99]" /> : <Button type="button" variant="ghost" size="icon" onClick={() => removeFile(item.key)} className="h-7 w-7 text-[#777]"><X className="h-3 w-3" /></Button>}</div>)}</div>; })}</div></div>)}
        </Section>
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-[#c9c9c9] bg-[#e0e0e0]/95 py-4 backdrop-blur"><p className="text-xs text-[#777]">{queue.length ? `${queue.length} file${queue.length === 1 ? "" : "s"} queued for upload` : "No files queued"} </p><div className="flex gap-2"><Button type="button" variant="ghost" onClick={() => navigate("/carriers")}><X className="mr-2 h-4 w-4" />Cancel</Button><Button type="button" variant="outline" onClick={() => { form.reset(defaults); setQueue([]); setUploadState({}); }}><RotateCcw className="mr-2 h-4 w-4" />Reset</Button><Button type="submit" disabled={form.formState.isSubmitting} className="bg-[#e0e0e0] text-[#168d99]"><Save className="mr-2 h-4 w-4" />{form.formState.isSubmitting ? "Saving record..." : editing ? "Save carrier" : "Create carrier"}</Button></div></div>
      </form>
    </div>
  </AppShell>;
}