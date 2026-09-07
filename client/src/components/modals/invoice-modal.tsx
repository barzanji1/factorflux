import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { insertInvoiceSchema, type Invoice, type Client, type Document } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Upload,
  X,
  Building,
  Phone,
  Mail,
  MapPin,
  Search,
  CheckCircle2,
  Sparkles,
  FileText,
  Truck,
  CircleDollarSign,
  ClipboardList,
  Eye,
  Download,
  Loader2,
  Paperclip,
} from "lucide-react";

type DocKey = "rate_confirmation" | "bill_of_lading" | "lumper" | "receipts";

const DOC_SLOTS: { key: DocKey; label: string; hint: string }[] = [
  { key: "rate_confirmation", label: "Rate Confirmation", hint: "Signed rate confirmation" },
  { key: "bill_of_lading", label: "Bill of Lading", hint: "BOL document" },
  { key: "lumper", label: "Lumper Receipt", hint: "Any lumper receipt" },
  { key: "receipts", label: "Receipts", hint: "Additional receipts" },
];

const DOC_TYPE_MAP: Record<DocKey, string> = {
  rate_confirmation: "rate_confirmation",
  bill_of_lading: "bill_of_lading",
  lumper: "lumper_receipt",
  receipts: "receipt",
};

function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200/80 bg-white/80 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:border-slate-800 dark:bg-slate-900/40">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900">
          {icon}
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function PremiumPillGroup<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt.value;

        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm font-medium transition-all",
              active
                ? "border-blue-600 bg-blue-600 text-white shadow-[0_8px_20px_rgba(37,99,235,0.22)]"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function PremiumUploadTile({
  label,
  hint,
  file,
  onFile,
  onRemove,
}: {
  label: string;
  hint: string;
  file: File | null;
  onFile: (f: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const accept = (f: File) => {
    const valid = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
    if (valid.includes(f.type) && f.size <= 10 * 1024 * 1024) onFile(f);
  };

  return (
    <div
      className={cn(
        "group relative rounded-[22px] border border-dashed p-4 transition-all cursor-pointer select-none",
        dragOver
          ? "border-blue-400 bg-blue-50 shadow-[0_10px_24px_rgba(37,99,235,0.12)] dark:border-blue-500 dark:bg-blue-950/20"
          : file
          ? "border-emerald-300 bg-emerald-50 shadow-[0_10px_24px_rgba(16,185,129,0.10)] dark:border-emerald-700 dark:bg-emerald-950/20"
          : "border-slate-200 bg-slate-50/80 hover:border-slate-300 hover:bg-white hover:shadow-sm dark:border-slate-700 dark:bg-slate-900/40 dark:hover:border-slate-600 dark:hover:bg-slate-900"
      )}
      onClick={() => !file && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) accept(f);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) accept(f);
        }}
      />

      {file ? (
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              {file.name}
            </p>
            <p className="mt-0.5 text-xs text-emerald-600/90 dark:text-emerald-500">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="rounded-xl p-2 text-emerald-600 transition hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm dark:bg-slate-800 dark:text-slate-300">
            <Upload className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{label}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {hint} · PDF, JPG, PNG · Max 10 MB
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice?: Invoice | null;
  initialClient?: Client | null;
  onCreated?: () => void;
}

const invoiceFormSchema = insertInvoiceSchema.extend({
  invoiceNumber: z.string().min(1, "Invoice number is required"),
  loadType: z.string().optional(),
  pickupLocation: z.string().optional(),
  deliveryLocation: z.string().optional(),
  clientId: z.string().min(1, "Client is required"),
  amount: z.string().min(1, "Amount is required"),
  bolNumber: z.string().optional(),
});

export default function InvoiceModal({ isOpen, onClose, invoice, initialClient, onCreated }: InvoiceModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<Record<DocKey, File | null>>({
    rate_confirmation: null,
    bill_of_lading: null,
    lumper: null,
    receipts: null,
  });
  const [isUploading, setIsUploading] = useState(false);

  const { data: invoiceDocuments, isLoading: docsLoading } = useQuery<Document[]>({
    queryKey: ["/api/documents", "invoice", invoice?.id],
    queryFn: async () => {
      const res = await fetch(`/api/documents?invoice=${invoice!.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load documents");
      return res.json();
    },
    enabled: !!invoice?.id && isOpen,
  });

  const form = useForm<z.infer<typeof invoiceFormSchema>>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: {
      invoiceNumber: "",
      loadType: "",
      pickupLocation: "",
      deliveryLocation: "",
      clientId: "",
      amount: "",
      status: "draft",
      notes: "",
      bolNumber: "",
    },
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: isOpen,
  });

  const filteredClients =
    clients?.filter(
      (client) =>
        client.name?.toLowerCase().includes(clientSearch.toLowerCase()) ||
        client.email?.toLowerCase().includes(clientSearch.toLowerCase()) ||
        client.phone?.includes(clientSearch)
    ) || [];

  useEffect(() => {
    if (invoice) {
      form.reset({
        invoiceNumber: invoice.invoiceNumber,
        loadType: "otr_load",
        pickupLocation: "",
        deliveryLocation: "",
        clientId: invoice.clientId.toString(),
        amount: invoice.amount,
        status: invoice.status,
        notes: invoice.notes || "",
        bolNumber: "",
      });

      const client = clients?.find((c) => c.id === invoice.clientId);
      if (client) {
        setSelectedClient(client);
        setClientSearch("");
      }
    } else {
      form.reset({
        invoiceNumber: "",
        loadType: "",
        pickupLocation: "",
        deliveryLocation: "",
        clientId: initialClient ? initialClient.id.toString() : "",
        amount: "",
        status: "draft",
        notes: "",
        bolNumber: "",
      });
      setSelectedClient(initialClient ?? null);
      setClientSearch("");
      setAttachedFiles({
        rate_confirmation: null,
        bill_of_lading: null,
        lumper: null,
        receipts: null,
      });
    }
  }, [invoice, initialClient, form, clients]);

  const handleClientSelect = (client: Client) => {
    setSelectedClient(client);
    setClientSearch("");
    form.setValue("clientId", client.id.toString(), { shouldValidate: true });
    setShowClientDropdown(false);
  };

  const clearClientSelection = () => {
    setSelectedClient(null);
    setClientSearch("");
    setShowClientDropdown(false);
    form.setValue("clientId", "", { shouldValidate: true });
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/invoices", data);
    },
    onSuccess: async (response) => {
      const hasFiles = Object.values(attachedFiles).some(Boolean);

      if (hasFiles) {
        setIsUploading(true);
        try {
          const invoiceData = await response.json();

          const results = await Promise.allSettled(
            DOC_SLOTS.map(async ({ key }) => {
              const file = attachedFiles[key];
              if (!file) return;

              const formData = new FormData();
              formData.append("file", file);
              formData.append("documentType", DOC_TYPE_MAP[key]);
              formData.append("invoiceId", invoiceData.id.toString());

              await apiRequest("POST", "/api/documents/upload", formData);
            })
          );

          const failures = results.filter((r) => r.status === "rejected");
          if (failures.length > 0) {
            const reason = (failures[0] as PromiseRejectedResult).reason;
            toast({
              title: "Document upload failed",
              description: reason?.message || "One or more files could not be uploaded. Check file type and size.",
              variant: "destructive",
            });
          }
        } catch (error: any) {
          console.error("Error uploading documents:", error);
          toast({
            title: "Document upload failed",
            description: error?.message || "Could not upload documents. Please try again.",
            variant: "destructive",
          });
        } finally {
          setIsUploading(false);
        }
      }

      toast({
        title: "Success",
        description: "Invoice created successfully",
      });

      await queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      onCreated?.();
      onClose();
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
        return;
      }

      toast({
        title: "Error",
        description: "Failed to create invoice",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("PUT", `/api/invoices/${invoice!.id}`, data);
    },
    onSuccess: async () => {
      const hasFiles = Object.values(attachedFiles).some(Boolean);

      if (hasFiles) {
        setIsUploading(true);
        try {
          const results = await Promise.allSettled(
            DOC_SLOTS.map(async ({ key }) => {
              const file = attachedFiles[key];
              if (!file) return;

              const formData = new FormData();
              formData.append("file", file);
              formData.append("documentType", DOC_TYPE_MAP[key]);
              formData.append("invoiceId", invoice!.id.toString());

              await apiRequest("POST", "/api/documents/upload", formData);
            })
          );

          const failures = results.filter((r) => r.status === "rejected");
          if (failures.length > 0) {
            const reason = (failures[0] as PromiseRejectedResult).reason;
            toast({
              title: "Document upload failed",
              description: reason?.message || "One or more files could not be uploaded. Check file type and size.",
              variant: "destructive",
            });
          }
        } catch (error: any) {
          console.error("Error uploading documents:", error);
          toast({
            title: "Document upload failed",
            description: error?.message || "Could not upload documents. Please try again.",
            variant: "destructive",
          });
        } finally {
          setIsUploading(false);
        }
      }

      toast({
        title: "Success",
        description: "Invoice updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents", "invoice", invoice!.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      onClose();
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
        return;
      }

      toast({
        title: "Error",
        description: "Failed to update invoice",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (values: z.infer<typeof invoiceFormSchema>) => {
    const data = {
      ...values,
      clientId: parseInt(values.clientId),
      amount: values.amount,
      // Convert empty strings to undefined so enum/optional fields pass backend Zod validation
      loadType: (values.loadType as string) || undefined,
      bolNumber: values.bolNumber || undefined,
      pickupLocation: values.pickupLocation || undefined,
      deliveryLocation: values.deliveryLocation || undefined,
      notes: values.notes || undefined,
    };

    if (invoice) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const onValidationError = (errors: Record<string, unknown>) => {
    const fieldLabels: Record<string, string> = {
      invoiceNumber: "Invoice Number",
      clientId: "Client",
      amount: "Amount",
      loadType: "Load Type",
      pickupLocation: "Pickup Location",
      deliveryLocation: "Delivery Location",
    };
    const missing = Object.keys(errors)
      .map((k) => fieldLabels[k] ?? k)
      .join(", ");
    toast({
      title: "Missing required fields",
      description: `Please fill in: ${missing}`,
      variant: "destructive",
    });
  };

  const isSaving = createMutation.isPending || updateMutation.isPending || isUploading;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[92vh] w-[95vw] max-w-6xl flex-col border-slate-200/80 bg-[linear-gradient(to_bottom,_rgba(255,255,255,0.97),_rgba(248,250,252,0.98))] p-0 shadow-[0_30px_80px_rgba(15,23,42,0.18)] dark:border-slate-800 dark:bg-[hsl(var(--background))]">
        <DialogHeader className="shrink-0 border-b border-slate-200/70 px-8 pb-6 pt-8 dark:border-slate-800">
          <div className="mb-4 flex items-center gap-3">
            <div>
              <div className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300">
                Invoice workflow
              </div>
            </div>
          </div>

          <DialogTitle className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {invoice ? "Edit Invoice" : "Create New Invoice"}
          </DialogTitle>

          <DialogDescription className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
            {invoice
              ? "Update invoice details, shipment information, and billing references."
              : "Upload documents or enter shipment details manually with a cleaner premium workflow."}
          </DialogDescription>
        </DialogHeader>

        <div className="custom-scrollbar flex-1 overflow-y-auto px-8 py-7">
          <Form {...form}>
            <form id="invoice-form" onSubmit={form.handleSubmit(onSubmit, onValidationError)} className="space-y-6">
              <SectionCard
                icon={<Upload className="h-5 w-5" />}
                title="Attached Documents"
                description={invoice ? "Documents linked to this invoice. Upload additional files below." : "Upload the core paperwork needed to process this invoice."}
              >
                {invoice && (
                  <div className="mb-5">
                    {docsLoading ? (
                      <div className="flex items-center gap-2 py-3 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading documents...
                      </div>
                    ) : invoiceDocuments && invoiceDocuments.length > 0 ? (
                      <div className="space-y-2">
                        {invoiceDocuments.map((doc) => (
                          <div
                            key={doc.id}
                            className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                                <FileText className="h-4 w-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                                  {doc.originalName}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 capitalize">
                                  {doc.documentType?.replace(/_/g, " ")} &middot; {(doc.size / 1024).toFixed(0)} KB
                                </p>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1.5 rounded-xl border-slate-200 px-3 text-xs dark:border-slate-700"
                                onClick={() => window.open(`/api/documents/${doc.id}/view`, "_blank")}
                              >
                                <Eye className="h-3.5 w-3.5" />
                                View
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1.5 rounded-xl border-slate-200 px-3 text-xs dark:border-slate-700"
                                onClick={() => {
                                  const a = document.createElement("a");
                                  a.href = `/api/documents/${doc.id}/download`;
                                  a.download = doc.originalName;
                                  a.click();
                                }}
                              >
                                <Download className="h-3.5 w-3.5" />
                                Download
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-5 dark:border-slate-700 dark:bg-slate-800/20">
                        <Paperclip className="h-5 w-5 text-slate-400" />
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          No documents attached to this invoice yet.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {DOC_SLOTS.map(({ key, label, hint }) => (
                    <PremiumUploadTile
                      key={key}
                      label={label}
                      hint={hint}
                      file={attachedFiles[key]}
                      onFile={(f) => setAttachedFiles((prev) => ({ ...prev, [key]: f }))}
                      onRemove={() => setAttachedFiles((prev) => ({ ...prev, [key]: null }))}
                    />
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                icon={<FileText className="h-5 w-5" />}
                title="Invoice Details"
                description="Set the invoice number, review state, and load type."
              >
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="invoiceNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          Invoice Number
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="INV-001234"
                            {...field}
                            data-testid="input-invoice-number"
                            className="h-12 rounded-2xl border-slate-200 bg-white text-[15px] shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-950"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          Status
                        </FormLabel>
                        <FormControl>
                          <div className="pt-1">
                            <PremiumPillGroup
                              value={field.value as "draft" | "submitted" | "approved" | "rejected" | "paid"}
                              onChange={field.onChange}
                              options={[
                                { value: "draft", label: "Draft" },
                                { value: "submitted", label: "Submitted" },
                                { value: "approved", label: "Approved" },
                                { value: "rejected", label: "Rejected" },
                                { value: "paid", label: "Paid" },
                              ]}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="mt-5">
                  <FormField
                    control={form.control}
                    name="loadType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          Load Type
                        </FormLabel>
                        <FormControl>
                          <div className="pt-1">
                            <PremiumPillGroup
                              value={field.value as "otr_load" | "dump_truck_ticket"}
                              onChange={field.onChange}
                              options={[
                                { value: "otr_load", label: "OTR Load" },
                                { value: "dump_truck_ticket", label: "Dump Truck Ticket" },
                              ]}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </SectionCard>

              <SectionCard
                icon={<Truck className="h-5 w-5" />}
                title="Shipment Details"
                description="Capture the pickup and delivery locations for this load."
              >
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="pickupLocation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          From (Pickup Location)
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="City, State"
                            {...field}
                            data-testid="input-pickup-location"
                            className="h-12 rounded-2xl border-slate-200 bg-white text-[15px] shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-950"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="deliveryLocation"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          To (Delivery Location)
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="City, State"
                            {...field}
                            data-testid="input-delivery-location"
                            className="h-12 rounded-2xl border-slate-200 bg-white text-[15px] shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-950"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </SectionCard>

              <SectionCard
                icon={<Building className="h-5 w-5" />}
                title="Client & Billing"
                description="Search and assign the client tied to this invoice."
              >
                <div className="space-y-3">
                  <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Client
                  </FormLabel>

                  <div className="relative">
                    {selectedClient ? (
                      <div
                        className="flex h-12 items-center rounded-2xl border-2 border-[#27aab8] bg-white px-3 shadow-sm dark:border-[#098b9f] dark:bg-slate-950"
                        data-testid="selected-client-field"
                        aria-label={`Selected client: ${selectedClient.name}`}
                      >
                        <div className="flex min-w-0 max-w-full items-center gap-2 rounded-xl bg-[#e5f7f8] px-3 py-1.5 text-[#075f6c] dark:bg-[#073b43] dark:text-[#74d4dc]">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#098b9f] dark:text-[#27aab8]" />
                          <span className="truncate text-sm font-bold">{selectedClient.name}</span>
                          <button
                            type="button"
                            onClick={clearClientSelection}
                            className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[#098b9f] transition hover:bg-[#c8ecef] hover:text-[#064e59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#098b9f] dark:text-[#65cbd4] dark:hover:bg-[#0a5660]"
                            aria-label={`Remove ${selectedClient.name}`}
                            title="Change client"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          placeholder="Search client by name, email, or phone..."
                          value={clientSearch}
                          onChange={(e) => {
                            setClientSearch(e.target.value);
                            setShowClientDropdown(true);
                          }}
                          onFocus={() => setShowClientDropdown(true)}
                          className="h-12 rounded-2xl border-slate-200 bg-white pl-11 text-[15px] shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-950"
                          data-testid="input-client-search"
                        />
                      </>
                    )}

                    {!selectedClient && showClientDropdown && clientSearch && filteredClients.length > 0 && (
                      <div className="absolute z-[9999] mt-2 w-full overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-[0_20px_40px_rgba(15,23,42,0.12)] dark:border-slate-700 dark:bg-slate-900">
                        <div className="max-h-72 overflow-auto py-2">
                          {filteredClients.map((client) => (
                            <button
                              key={client.id}
                              type="button"
                              className="flex w-full flex-col items-start px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800"
                              onClick={() => handleClientSelect(client)}
                              data-testid={`client-option-${client.id}`}
                            >
                              <span className="font-medium text-slate-900 dark:text-white">
                                {client.name}
                              </span>
                              <span className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                {client.email || "No email"} • {client.phone || "No phone"}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {selectedClient && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-slate-500 dark:text-slate-400">
                      {selectedClient.email && (
                        <span className="flex min-w-0 items-center gap-1.5">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{selectedClient.email}</span>
                        </span>
                      )}
                      {selectedClient.phone && (
                        <span className="flex items-center gap-1.5">
                          <Phone className="h-3.5 w-3.5 shrink-0" />
                          {selectedClient.phone}
                        </span>
                      )}
                      {selectedClient.address && (
                        <span className="flex min-w-0 items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{selectedClient.address}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {form.formState.errors.clientId && (
                    <p className="text-sm text-red-500">
                      {form.formState.errors.clientId.message}
                    </p>
                  )}
                </div>

                <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          Amount
                        </FormLabel>
                        <FormControl>
                          <div className="relative">
                            <CircleDollarSign className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                              placeholder="0.00"
                              type="number"
                              step="0.01"
                              {...field}
                              data-testid="input-amount"
                              className="h-12 rounded-2xl border-slate-200 bg-white pl-11 text-[15px] shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-950"
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="bolNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-slate-700 dark:text-slate-300">
                          BOL Number
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Bill of Lading #"
                            {...field}
                            data-testid="input-bol-number"
                            className="h-12 rounded-2xl border-slate-200 bg-white text-[15px] shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-950"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </SectionCard>

              <SectionCard
                icon={<ClipboardList className="h-5 w-5" />}
                title="Notes"
                description="Add any operational notes or billing context."
              >
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea
                          placeholder="Additional notes..."
                          value={field.value || ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                          data-testid="textarea-notes"
                          className="min-h-[130px] rounded-[22px] border-slate-200 bg-white text-[15px] shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-950"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </SectionCard>

            </form>
          </Form>
        </div>

        <div className="shrink-0 border-t border-slate-200/80 bg-white/90 px-8 py-4 backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--background))]/90">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              data-testid="button-cancel"
              className="h-11 rounded-2xl border-slate-200 px-5 dark:border-slate-700"
            >
              Cancel
            </Button>

            <Button
              type="submit"
              form="invoice-form"
              disabled={isSaving}
              data-testid="button-submit"
              className="h-11 rounded-2xl bg-blue-600 px-5 text-white shadow-[0_12px_24px_rgba(37,99,235,0.22)] hover:bg-blue-700"
            >
              {isSaving ? "Saving..." : invoice ? "Update Invoice" : "Create Invoice"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}