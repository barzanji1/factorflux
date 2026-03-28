import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { insertInvoiceSchema, type Invoice, type Client } from "@shared/schema";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, X, Building, Phone, Mail, MapPin, Search, CheckCircle2 } from "lucide-react";

type DocKey = "rate_confirmation" | "bill_of_lading" | "lumper" | "receipts";

const DOC_SLOTS: { key: DocKey; label: string; hint: string }[] = [
  { key: "rate_confirmation", label: "Rate Confirmation", hint: "Upload the signed rate confirmation" },
  { key: "bill_of_lading", label: "Bill of Lading", hint: "Upload the BOL document" },
  { key: "lumper", label: "Lumper Receipt", hint: "Upload any lumper receipt" },
  { key: "receipts", label: "Receipts", hint: "Upload additional receipts" },
];

function MiniUploadZone({
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
      className={`relative rounded-xl border-2 border-dashed p-4 transition-all cursor-pointer select-none ${
        dragOver
          ? "border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/20"
          : file
          ? "border-emerald-400 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/20"
          : "border-slate-300 bg-slate-50 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900/30 dark:hover:border-slate-600"
      }`}
      onClick={() => !file && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
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
        onChange={(e) => { const f = e.target.files?.[0]; if (f) accept(f); }}
      />

      {file ? (
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-emerald-700 dark:text-emerald-400">{file.name}</p>
            <p className="text-xs text-emerald-600 dark:text-emerald-500">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="shrink-0 rounded-md p-1 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Upload className="h-5 w-5 shrink-0 text-slate-400" />
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{hint} · PDF, JPG, PNG · Max 10 MB</p>
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
}

const invoiceFormSchema = insertInvoiceSchema.extend({
  invoiceNumber: z.string().min(1, "Invoice number is required"),
  loadType: z.string().min(1, "Load type is required"),
  pickupLocation: z.string().min(1, "Pickup location is required"),
  deliveryLocation: z.string().min(1, "Delivery location is required"),
  clientId: z.string().min(1, "Client is required"),
  amount: z.string().min(1, "Amount is required"),
  bolNumber: z.string().optional(),
});

export default function InvoiceModal({ isOpen, onClose, invoice }: InvoiceModalProps) {
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

  // Filter clients based on search
  const filteredClients = clients?.filter(client => 
    client.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
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
      const client = clients?.find(c => c.id === invoice.clientId);
      if (client) {
        setSelectedClient(client);
        setClientSearch(client.name);
      }
    } else {
      form.reset({
        invoiceNumber: "",
        loadType: "",
        pickupLocation: "",
        deliveryLocation: "",
        clientId: "",
        amount: "",
        status: "draft",
        notes: "",
        bolNumber: "",
      });
      setSelectedClient(null);
      setClientSearch("");
      setAttachedFiles({ rate_confirmation: null, bill_of_lading: null, lumper: null, receipts: null });
    }
  }, [invoice, form, clients]);

  const handleClientSelect = (client: Client) => {
    setSelectedClient(client);
    setClientSearch(client.name);
    form.setValue("clientId", client.id.toString());
    setShowClientDropdown(false);
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
          await Promise.all(
            DOC_SLOTS.map(async ({ key }) => {
              const file = attachedFiles[key];
              if (!file) return;
              const formData = new FormData();
              formData.append("file", file);
              formData.append("documentType", key);
              formData.append("invoiceId", invoiceData.id.toString());
              await apiRequest("POST", "/api/documents/upload", formData);
            })
          );
        } catch (error) {
          console.error("Error uploading documents:", error);
        } finally {
          setIsUploading(false);
        }
      }
      
      toast({
        title: "Success",
        description: "Invoice created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
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
        description: "Failed to create invoice",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("PUT", `/api/invoices/${invoice!.id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Invoice updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
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
    };

    if (invoice) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle>
            {invoice ? "Edit Invoice" : "Create New Invoice"}
          </DialogTitle>
          <DialogDescription>
            {invoice ? "Update the invoice details below" : "Drag and drop an invoice document or fill in the details manually"}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 px-6 pb-6">

        {/* Document Upload Slots */}
        {!invoice && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Attach Documents</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {DOC_SLOTS.map(({ key, label, hint }) => (
                <MiniUploadZone
                  key={key}
                  label={label}
                  hint={hint}
                  file={attachedFiles[key]}
                  onFile={(f) => setAttachedFiles((prev) => ({ ...prev, [key]: f }))}
                  onRemove={() => setAttachedFiles((prev) => ({ ...prev, [key]: null }))}
                />
              ))}
            </div>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="invoiceNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice Number</FormLabel>
                    <FormControl>
                      <Input placeholder="INV-001234" {...field} data-testid="input-invoice-number" />
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
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-status">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent position="popper" sideOffset={4}>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="submitted">Submitted</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="loadType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Load Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-load-type">
                        <SelectValue placeholder="Select load type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent position="popper" sideOffset={4}>
                      <SelectItem value="otr_load">OTR Load</SelectItem>
                      <SelectItem value="dump_truck_ticket">Dump Truck Ticket</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="pickupLocation"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>From (Pickup Location)</FormLabel>
                    <FormControl>
                      <Input placeholder="City, State" {...field} data-testid="input-pickup-location" />
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
                    <FormLabel>To (Delivery Location)</FormLabel>
                    <FormControl>
                      <Input placeholder="City, State" {...field} data-testid="input-delivery-location" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Smart Client Search */}
            <div className="space-y-2">
              <FormLabel>Client</FormLabel>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search client by name, email, or phone..."
                  value={clientSearch}
                  onChange={(e) => {
                    setClientSearch(e.target.value);
                    setShowClientDropdown(true);
                    if (!e.target.value) {
                      setSelectedClient(null);
                      form.setValue("clientId", "");
                    }
                  }}
                  onFocus={() => setShowClientDropdown(true)}
                  className="pl-10"
                  data-testid="input-client-search"
                />
                
                {/* Client dropdown */}
                {showClientDropdown && clientSearch && filteredClients.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-auto">
                    {filteredClients.map((client) => (
                      <div
                        key={client.id}
                        className="p-3 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-0"
                        onClick={() => handleClientSelect(client)}
                        data-testid={`client-option-${client.id}`}
                      >
                        <div className="font-medium">{client.name}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {client.email} • {client.phone}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {form.formState.errors.clientId && (
                <p className="text-sm text-red-500">{form.formState.errors.clientId.message}</p>
              )}
            </div>

            {/* Selected Client Details Card */}
            {selectedClient && (
              <Card className="bg-gray-50 dark:bg-gray-800/50">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Building className="w-5 h-5 text-primary mt-0.5" />
                    <div className="flex-1 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">{selectedClient.name}</p>
                        {selectedClient.contactPerson && (
                          <p className="text-gray-600 dark:text-gray-400">Contact: {selectedClient.contactPerson}</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        {selectedClient.email && (
                          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                            <Mail className="w-3.5 h-3.5" />
                            <span>{selectedClient.email}</span>
                          </div>
                        )}
                        {selectedClient.phone && (
                          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                            <Phone className="w-3.5 h-3.5" />
                            <span>{selectedClient.phone}</span>
                          </div>
                        )}
                        {selectedClient.address && (
                          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                            <MapPin className="w-3.5 h-3.5" />
                            <span>{selectedClient.address}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input placeholder="0.00" type="number" step="0.01" {...field} data-testid="input-amount" />
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
                    <FormLabel>BOL Number</FormLabel>
                    <FormControl>
                      <Input placeholder="Bill of Lading #" {...field} data-testid="input-bol-number" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Additional notes..." 
                      value={field.value || ""} 
                      onChange={field.onChange} 
                      onBlur={field.onBlur} 
                      name={field.name} 
                      ref={field.ref}
                      data-testid="textarea-notes"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end space-x-4">
              <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel">
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={createMutation.isPending || updateMutation.isPending || isUploading}
                data-testid="button-submit"
              >
                {createMutation.isPending || updateMutation.isPending || isUploading 
                  ? "Saving..." 
                  : invoice ? "Update" : "Create Invoice"}
              </Button>
            </div>
          </form>
        </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
