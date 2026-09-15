import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle, CheckCircle2, FileText, Loader2, Search, Upload, X } from "lucide-react";
import PortalLayout from "@/components/layout/portal-layout";
import { LoadTypeToggleGroup } from "@/components/load-type";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { displayLoadType } from "@shared/load-types";

interface PortalUser { id: number; status: string; carrierId?: number | null; cargoType?: string | null; }
interface Broker { id: number; name: string; }
interface Branch { id: number; branchName: string; }
interface BankAccount { id: number; bankName: string; accountType: string; nickname: string; lastFour: string; }

const schema = z.object({
  loadType: z.enum(["otr_load", "dump_truck_ticket", "hotshot", "other"]),
  loadNumber: z.string().trim().min(1, "Load # required"),
  invoiceNumber: z.string().optional(),
  brokerId: z.coerce.number().positive("Broker required"),
  branchId: z.coerce.number().positive("Branch required"),
  code: z.string().trim().min(1, "Route code required"),
  lumper: z.enum(["yes", "no"], { required_error: "Lumper selection required" }),
  driverName: z.string().trim().min(1, "Driver name required"),
  amount: z.coerce.number().positive("Amount required"),
  paymentType: z.enum(["ACH", "wire"]),
  bankAccountId: z.coerce.number().positive("Bank account required"),
  instructionsSubject: z.string().optional(),
  instructionsDetails: z.string().optional(),
});
type SubmitForm = z.infer<typeof schema>;

type DocType = "rate_confirmation" | "bol" | "lumper_receipt" | "other";
const DOC_TYPES: { key: DocType; label: string; required: boolean }[] = [
  { key: "rate_confirmation", label: "Rate Confirmation", required: true },
  { key: "bol", label: "Bill of Lading", required: true },
  { key: "lumper_receipt", label: "Lumper Receipt", required: false },
  { key: "other", label: "Other", required: false },
];
const MAX_PDF_SIZE = 5 * 1024 * 1024;
interface DocFile { type: DocType; file: File; }

export default function PortalSubmit() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [docs, setDocs] = useState<DocFile[]>([]);
  const [documentError, setDocumentError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [brokerSearch, setBrokerSearch] = useState("");
  const [brokerQuery, setBrokerQuery] = useState("");
  const [brokerOpen, setBrokerOpen] = useState(false);
  const [selectedBroker, setSelectedBroker] = useState<Broker>();
  const fileInputRefs = useRef<Record<DocType, HTMLInputElement | null>>({} as any);

  const { data: me } = useQuery<PortalUser>({ queryKey: ["/api/portal/me"], retry: false });
  const { data: brokers = [] } = useQuery<Broker[]>({
    queryKey: ["/api/portal/brokers", brokerQuery],
    queryFn: async () => {
      const response = await fetch(`/api/portal/brokers?q=${encodeURIComponent(brokerQuery)}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load brokers");
      return response.json();
    },
    enabled: !!me,
  });
  const { data: accounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["/api/portal/bank-accounts"],
    enabled: !!me,
  });

  const form = useForm<SubmitForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      loadType: "other", loadNumber: "", invoiceNumber: "", brokerId: 0, branchId: 0,
      code: "", lumper: undefined, driverName: "", amount: 0, paymentType: "ACH",
      bankAccountId: 0, instructionsSubject: "", instructionsDetails: "",
    },
  });
  const brokerId = form.watch("brokerId");
  const paymentType = form.watch("paymentType");
  const { data: branches = [], isLoading: branchesLoading } = useQuery<Branch[]>({
    queryKey: ["/api/portal/brokers", brokerId, "branches"],
    queryFn: async () => {
      const response = await fetch(`/api/portal/brokers/${brokerId}/branches`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load branches");
      return response.json();
    },
    enabled: !!brokerId,
  });

  useEffect(() => {
    if (!me) setLocation("/portal/login");
    if (me?.cargoType) form.setValue("loadType", displayLoadType(me.cargoType));
  }, [me, setLocation, form]);
  useEffect(() => {
    const timer = window.setTimeout(() => setBrokerQuery(brokerSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [brokerSearch]);
  useEffect(() => {
    if (branches.length === 1) form.setValue("branchId", branches[0].id, { shouldValidate: true });
  }, [branches, form]);

  const mutation = useMutation({
    mutationFn: async (data: SubmitForm) => {
      const hasRateConfirmation = docs.some(doc => doc.type === "rate_confirmation");
      const hasBol = docs.some(doc => doc.type === "bol");
      if (!hasRateConfirmation || !hasBol) throw new Error("Rate Confirmation and Bill of Lading are required.");
      const fd = new FormData();
      Object.entries(data).forEach(([key, value]) => fd.append(key, value == null ? "" : String(value)));
      docs.forEach(doc => {
        fd.append("documents", doc.file);
        fd.append("documentTypes", doc.type);
      });
      const response = await fetch("/api/portal/submissions", { method: "POST", credentials: "include", body: fd });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Submission failed");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/submissions"] });
      setSubmitted(true);
    },
  });

  async function addFile(type: DocType, file: File) {
    setDocumentError("");
    if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
      setDocumentError(`${DOC_TYPES.find(item => item.key === type)?.label} must be a PDF file.`);
      return;
    }
    if (file.size > MAX_PDF_SIZE) {
      setDocumentError(`${file.name} is larger than 5MB.`);
      return;
    }
    const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(signature[0], signature[1], signature[2], signature[3], signature[4]) !== "%PDF-") {
      setDocumentError(`${file.name} is not a valid PDF.`);
      return;
    }
    setDocs(current => [...current.filter(doc => doc.type !== type), { type, file }]);
  }

  if (submitted) {
    return (
      <PortalLayout>
        <div className="mx-auto max-w-md py-16 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle className="h-8 w-8 text-emerald-600" />
          </div>
          <h2 className="mb-2 text-xl font-bold text-slate-900">Invoice Submitted!</h2>
          <p className="mb-6 text-sm text-slate-500">Our team will review your submission and reach out if anything is needed.</p>
          <div className="flex justify-center gap-3">
            <Button onClick={() => { setSubmitted(false); form.reset(); setDocs([]); setSelectedBroker(undefined); }}>Submit Another</Button>
            <Button variant="outline" onClick={() => setLocation("/portal/submissions")}>View Submissions</Button>
          </div>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Submit Invoice</h1>
          <p className="mt-1 text-sm text-slate-500">Fill in the load details and attach your documents.</p>
        </div>

        {(mutation.error || documentError) && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {documentError || (mutation.error as Error)?.message}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(data => mutation.mutate(data))} className="space-y-6">
            <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5">
              <FormField control={form.control} name="loadType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Load Type *</FormLabel>
                  <FormControl><LoadTypeToggleGroup value={field.value} onChange={field.onChange} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField control={form.control} name="loadNumber" render={({ field }) => (
                  <FormItem><FormLabel>Load # *</FormLabel><FormControl><Input {...field} placeholder="LOAD-10042" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="invoiceNumber" render={({ field }) => (
                  <FormItem><FormLabel>Invoice #</FormLabel><FormControl><Input {...field} placeholder="INV-001" /></FormControl><FormMessage /></FormItem>
                )} />

                <FormField control={form.control} name="brokerId" render={() => (
                  <FormItem className="relative">
                    <FormLabel>Broker *</FormLabel>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        className="pl-9"
                        value={brokerOpen ? brokerSearch : selectedBroker?.name || ""}
                        placeholder="Search active brokers"
                        onFocus={() => setBrokerOpen(true)}
                        onChange={event => { setBrokerSearch(event.target.value); setBrokerOpen(true); }}
                      />
                      {selectedBroker && !brokerOpen && <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setBrokerOpen(true)}><X className="h-4 w-4 text-slate-400" /></button>}
                    </div>
                    {brokerOpen && (
                      <div className="absolute z-30 mt-16 max-h-56 w-full overflow-auto rounded-xl border bg-white p-1 shadow-xl">
                        {brokers.length ? brokers.map(broker => (
                          <button key={broker.id} type="button" className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100" onClick={() => {
                            setSelectedBroker(broker);
                            setBrokerOpen(false);
                            setBrokerSearch("");
                            form.setValue("brokerId", broker.id, { shouldValidate: true });
                            form.setValue("branchId", 0);
                          }}>{broker.name}</button>
                        )) : <p className="px-3 py-4 text-center text-xs text-slate-500">No active brokers found</p>}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="branchId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Branch *</FormLabel>
                    <Select value={field.value ? String(field.value) : ""} onValueChange={value => field.onChange(Number(value))} disabled={!brokerId || branchesLoading}>
                      <FormControl><SelectTrigger><SelectValue placeholder={!brokerId ? "Select a broker first" : branchesLoading ? "Loading branches…" : branches.length ? "Select branch" : "No active branches"} /></SelectTrigger></FormControl>
                      <SelectContent>{branches.map(branch => <SelectItem key={branch.id} value={String(branch.id)}>{branch.branchName}</SelectItem>)}</SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="code" render={({ field }) => (
                  <FormItem><FormLabel>Code / Route *</FormLabel><FormControl><Input {...field} placeholder="CA TO UT" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="lumper" render={({ field }) => (
                  <FormItem><FormLabel>Lumper *</FormLabel><Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl><SelectContent><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent></Select><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="driverName" render={({ field }) => (
                  <FormItem><FormLabel>Driver *</FormLabel><FormControl><Input {...field} placeholder="Driver name" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem><FormLabel>Invoice Amount *</FormLabel><FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="paymentType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Type *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="ACH">ACH (Direct Deposit)</SelectItem><SelectItem value="wire">Wire Transfer</SelectItem></SelectContent></Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="bankAccountId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bank Account *</FormLabel>
                    {accounts.length ? (
                      <Select value={field.value ? String(field.value) : ""} onValueChange={value => field.onChange(Number(value))}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select bank account" /></SelectTrigger></FormControl>
                        <SelectContent>{accounts.map(account => <SelectItem key={account.id} value={String(account.id)}>{account.nickname} · {account.bankName} ••••{account.lastFour}</SelectItem>)}</SelectContent>
                      </Select>
                    ) : (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        Please <Link href="/portal/profile" className="font-semibold underline">add a bank account in your profile</Link>.
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {paymentType === "wire" && <p className="text-sm font-semibold text-red-600">Wire (same day funding) cutoff time is at 13:00:00 MT</p>}

              <div className="grid grid-cols-1 gap-4">
                <FormField control={form.control} name="instructionsSubject" render={({ field }) => (
                  <FormItem><FormLabel>Instructions Subject</FormLabel><FormControl><Input {...field} placeholder="Optional subject" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="instructionsDetails" render={({ field }) => (
                  <FormItem><FormLabel>Instructions Details</FormLabel><FormControl><Textarea {...field} rows={4} placeholder="Optional payment or processing instructions" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
              <div><h2 className="font-semibold text-slate-800">Documents</h2><p className="text-xs text-slate-500">PDF files only, maximum 5MB each.</p></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {DOC_TYPES.map(item => {
                  const doc = docs.find(current => current.type === item.key);
                  return (
                    <div key={item.key} className={`rounded-xl border border-dashed p-3 ${doc ? "border-emerald-400 bg-emerald-50" : "border-slate-300"}`}>
                      <input ref={element => { fileInputRefs.current[item.key] = element; }} type="file" accept="application/pdf,.pdf" className="hidden" onChange={event => {
                        const file = event.target.files?.[0];
                        if (file) void addFile(item.key, file);
                        event.target.value = "";
                      }} />
                      {doc ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                          <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{doc.file.name}</p><p className="text-[11px] text-slate-500">{(doc.file.size / 1024 / 1024).toFixed(2)} MB</p></div>
                          <button type="button" onClick={() => setDocs(current => current.filter(file => file.type !== item.key))}><X className="h-4 w-4 text-slate-500" /></button>
                        </div>
                      ) : (
                        <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => fileInputRefs.current[item.key]?.click()}>
                          <Upload className="h-5 w-5 text-slate-500" /><span className="text-xs font-medium">{item.label}{item.required && <span className="text-red-500"> *</span>}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <Button type="submit" className="h-12 w-full bg-blue-600 text-base font-semibold hover:bg-blue-700" disabled={mutation.isPending || !accounts.length}>
              {mutation.isPending ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Submitting…</> : "Submit Invoice"}
            </Button>
          </form>
        </Form>
      </div>
    </PortalLayout>
  );
}