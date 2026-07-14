import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Upload, X, FileText, CheckCircle } from "lucide-react";
import PortalLayout from "@/components/layout/portal-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface PortalUser { id: number; status: string; }

const schema = z.object({
  loadNumber: z.string().min(1, "Load # required"),
  invoiceNumber: z.string().optional(),
  brokerName: z.string().min(1, "Broker name required"),
  amount: z.coerce.number().min(1, "Amount required"),
  paymentType: z.enum(["ACH", "wire"]),
});
type SubmitForm = z.infer<typeof schema>;

type DocType = "rate_confirmation" | "bol" | "lumper_receipt" | "other";
const DOC_TYPES: { key: DocType; label: string; required: boolean }[] = [
  { key: "rate_confirmation", label: "Rate Confirmation", required: true },
  { key: "bol",               label: "Bill of Lading (BOL)", required: true },
  { key: "lumper_receipt",    label: "Lumper Receipt", required: false },
  { key: "other",             label: "Other Document", required: false },
];

interface DocFile { type: DocType; file: File; }

export default function PortalSubmit() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [docs, setDocs] = useState<DocFile[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRefs = useRef<Record<DocType, HTMLInputElement | null>>({} as any);

  const { data: me } = useQuery<PortalUser>({
    queryKey: ["/api/portal/me"],
    retry: false,
  });

  useEffect(() => {
    if (!me) setLocation("/portal/login");
  }, [me, setLocation]);

  const form = useForm<SubmitForm>({
    resolver: zodResolver(schema),
    defaultValues: { loadNumber: "", invoiceNumber: "", brokerName: "", amount: 0, paymentType: "ACH" },
  });

  const mutation = useMutation({
    mutationFn: async (data: SubmitForm) => {
      const fd = new FormData();
      fd.append("loadNumber", data.loadNumber);
      fd.append("invoiceNumber", data.invoiceNumber || "");
      fd.append("brokerName", data.brokerName);
      fd.append("amount", String(data.amount));
      fd.append("paymentType", data.paymentType);
      docs.forEach((d) => {
        fd.append("documents", d.file);
        fd.append("documentTypes", d.type);
      });
      const res = await fetch("/api/portal/submissions", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Submission failed");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/submissions"] });
      setSubmitted(true);
    },
  });

  function addFile(type: DocType, file: File) {
    setDocs((prev) => [...prev.filter((d) => d.type !== type || type === "other"), { type, file }]);
  }
  function removeFile(type: DocType, name: string) {
    setDocs((prev) => prev.filter((d) => !(d.type === type && d.file.name === name)));
  }

  if (submitted) {
    return (
      <PortalLayout>
        <div className="max-w-md mx-auto text-center py-16">
          <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="h-8 w-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Invoice Submitted!</h2>
          <p className="text-slate-500 text-sm mb-6">Our team will review your submission and reach out if anything is needed.</p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => { setSubmitted(false); form.reset(); setDocs([]); }}>Submit Another</Button>
            <Button variant="outline" onClick={() => setLocation("/portal/submissions")}>View Submissions</Button>
          </div>
        </div>
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Submit Invoice</h1>
          <p className="text-slate-500 text-sm mt-1">Fill in the load details and attach your documents.</p>
        </div>

        {mutation.error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {(mutation.error as Error).message}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-6">
            {/* Load Info */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h2 className="font-semibold text-slate-800 text-sm">Load Information</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="loadNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Load # *</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. 10042" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="invoiceNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice #</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. INV-001" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="brokerName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Broker Name *</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. Coyote Logistics" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice Amount *</FormLabel>
                    <FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="paymentType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="ACH">ACH (Direct Deposit)</SelectItem>
                        <SelectItem value="wire">Wire Transfer</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </div>

            {/* Documents */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <h2 className="font-semibold text-slate-800 text-sm">Documents</h2>
              <p className="text-xs text-slate-500">Rate Confirmation and BOL are required. You can also attach additional documents.</p>
              <div className="space-y-3">
                {DOC_TYPES.map((dt) => {
                  const existing = docs.filter((d) => d.type === dt.key);
                  return (
                    <div key={dt.key} className="border border-slate-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-slate-700">
                          {dt.label} {dt.required && <span className="text-red-500">*</span>}
                        </span>
                        <button
                          type="button"
                          onClick={() => fileInputRefs.current[dt.key]?.click()}
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <Upload className="h-3 w-3" /> Upload
                        </button>
                        <input
                          ref={(el) => { fileInputRefs.current[dt.key] = el; }}
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.tiff"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) addFile(dt.key, file);
                            e.target.value = "";
                          }}
                        />
                      </div>
                      {existing.length === 0 ? (
                        <p className="text-xs text-slate-400">No file selected</p>
                      ) : (
                        <div className="space-y-1">
                          {existing.map((d) => (
                            <div key={d.file.name} className="flex items-center gap-2 text-xs">
                              <FileText className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                              <span className="truncate text-slate-600 flex-1">{d.file.name}</span>
                              <span className="text-slate-400">{(d.file.size / 1024).toFixed(0)} KB</span>
                              <button type="button" onClick={() => removeFile(dt.key, d.file.name)}>
                                <X className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <Button
              type="submit"
              className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-base font-semibold"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Submitting…</> : "Submit Invoice"}
            </Button>
          </form>
        </Form>
      </div>
    </PortalLayout>
  );
}
