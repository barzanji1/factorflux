import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { insertInvoiceSchema, type Invoice, type Load, type Client } from "@shared/schema";
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
import { Upload, FileText, X, Building, Phone, Mail, MapPin, Search } from "lucide-react";

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice?: Invoice | null;
}

const invoiceFormSchema = insertInvoiceSchema.extend({
  invoiceNumber: z.string().min(1, "Invoice number is required"),
  loadType: z.string().min(1, "Load type is required"),
  loadId: z.string().optional(),
  clientId: z.string().min(1, "Client is required"),
  amount: z.string().min(1, "Amount is required"),
  bolNumber: z.string().optional(),
});

export default function InvoiceModal({ isOpen, onClose, invoice }: InvoiceModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedLoadId, setSelectedLoadId] = useState<string>("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const form = useForm<z.infer<typeof invoiceFormSchema>>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: {
      invoiceNumber: "",
      loadType: "",
      loadId: "",
      clientId: "",
      amount: "",
      status: "draft",
      notes: "",
      bolNumber: "",
    },
  });

  const { data: loads } = useQuery({
    queryKey: ["/api/loads"],
    enabled: isOpen,
  });

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    enabled: isOpen,
  });

  const { data: selectedLoad } = useQuery({
    queryKey: ["/api/loads", selectedLoadId],
    enabled: !!selectedLoadId,
  });

  // Filter clients based on search
  const filteredClients = clients?.filter(client => 
    client.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
    client.email?.toLowerCase().includes(clientSearch.toLowerCase()) ||
    client.phone?.includes(clientSearch)
  ) || [];

  // Auto-populate client and amount when load is selected
  useEffect(() => {
    if (selectedLoad && selectedLoad as Load) {
      const load = selectedLoad as Load;
      form.setValue("clientId", load.clientId.toString());
      if (load.rate) {
        form.setValue("amount", load.rate);
      }
      // Find and set the client details
      const client = clients?.find(c => c.id === load.clientId);
      if (client) {
        setSelectedClient(client);
        setClientSearch(client.name);
      }
    }
  }, [selectedLoad, form, clients]);

  useEffect(() => {
    if (invoice) {
      form.reset({
        invoiceNumber: invoice.invoiceNumber,
        loadType: "otr_load",
        loadId: invoice.loadId.toString(),
        clientId: invoice.clientId.toString(),
        amount: invoice.amount,
        status: invoice.status,
        notes: invoice.notes || "",
        bolNumber: "",
      });
      setSelectedLoadId(invoice.loadId.toString());
      const client = clients?.find(c => c.id === invoice.clientId);
      if (client) {
        setSelectedClient(client);
        setClientSearch(client.name);
      }
    } else {
      form.reset({
        invoiceNumber: "",
        loadType: "",
        loadId: "",
        clientId: "",
        amount: "",
        status: "draft",
        notes: "",
        bolNumber: "",
      });
      setSelectedLoadId("");
      setSelectedClient(null);
      setClientSearch("");
      setAttachedFile(null);
    }
  }, [invoice, form, clients]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
      if (validTypes.includes(file.type)) {
        setAttachedFile(file);
        toast({
          title: "Document Attached",
          description: `${file.name} ready to upload with invoice`,
        });
      } else {
        toast({
          title: "Invalid File Type",
          description: "Please upload a PDF, JPEG, or PNG file",
          variant: "destructive",
        });
      }
    }
  }, [toast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      setAttachedFile(file);
      toast({
        title: "Document Attached",
        description: `${file.name} ready to upload with invoice`,
      });
    }
  };

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
      // If there's an attached file, upload it
      if (attachedFile) {
        setIsUploading(true);
        try {
          const formData = new FormData();
          formData.append('file', attachedFile);
          formData.append('documentType', 'rate_confirmation');
          const invoiceData = await response.json();
          formData.append('invoiceId', invoiceData.id.toString());
          await apiRequest("POST", "/api/documents/upload", formData);
        } catch (error) {
          console.error("Error uploading document:", error);
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
      loadId: values.loadId ? parseInt(values.loadId) : null,
      clientId: parseInt(values.clientId),
      amount: values.amount,
    };

    if (invoice) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const handleLoadChange = (loadId: string) => {
    setSelectedLoadId(loadId);
    form.setValue("loadId", loadId);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {invoice ? "Edit Invoice" : "Create New Invoice"}
          </DialogTitle>
          <DialogDescription>
            {invoice ? "Update the invoice details below" : "Drag and drop an invoice document or fill in the details manually"}
          </DialogDescription>
        </DialogHeader>

        {/* Document Drop Zone */}
        {!invoice && (
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              isDragOver 
                ? "border-primary bg-primary/5" 
                : attachedFile 
                  ? "border-green-500 bg-green-50 dark:bg-green-950" 
                  : "border-gray-300 dark:border-gray-700"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            data-testid="invoice-dropzone"
          >
            {attachedFile ? (
              <div className="flex items-center justify-center gap-3">
                <FileText className="w-8 h-8 text-green-600" />
                <div className="text-left">
                  <p className="font-medium text-green-700 dark:text-green-400">{attachedFile.name}</p>
                  <p className="text-sm text-green-600 dark:text-green-500">
                    {(attachedFile.size / 1024).toFixed(1)} KB - Ready to upload
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setAttachedFile(null)}
                  data-testid="remove-file-button"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <>
                <Upload className="w-10 h-10 mx-auto mb-3 text-gray-400" />
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                  Drag and drop your invoice document here
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-500 mb-3">
                  Supports PDF, JPEG, PNG (Max 10MB)
                </p>
                <label className="cursor-pointer">
                  <span className="text-primary hover:underline text-sm">
                    or click to browse files
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpeg,.jpg,.png"
                    onChange={handleFileSelect}
                    data-testid="file-input"
                  />
                </label>
              </>
            )}
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

            <FormField
              control={form.control}
              name="loadId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Load (Optional)</FormLabel>
                  <Select onValueChange={handleLoadChange} value={field.value || ""}>
                    <FormControl>
                      <SelectTrigger data-testid="select-load">
                        <SelectValue placeholder="Link to existing load (optional)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent position="popper" sideOffset={4}>
                      {(loads as Load[])?.length === 0 ? (
                        <div className="p-3 text-sm text-gray-500 text-center">
                          No loads available
                        </div>
                      ) : (
                        (loads as Load[])?.map((load: Load) => (
                          <SelectItem key={load.id} value={load.id.toString()}>
                            {load.loadNumber} - {load.pickupLocation} → {load.deliveryLocation}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

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
      </DialogContent>
    </Dialog>
  );
}
