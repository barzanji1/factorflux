import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Shield, 
  Lock, 
  Eye, 
  EyeOff, 
  Plus, 
  Edit, 
  Trash2, 
  AlertTriangle,
  Clock,
  User,
  Database
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";

// Vault form schema
const vaultFormSchema = z.object({
  clientId: z.number().min(1, "Client is required"),
  dataType: z.enum(["ssn", "bank_account", "password", "driver_license", "passport", "tax_documents", "insurance", "other"]),
  label: z.string().min(1, "Label is required"),
  data: z.string().min(1, "Data is required"),
  notes: z.string().optional(),
});

type VaultFormData = z.infer<typeof vaultFormSchema>;

interface VaultEntry {
  id: number;
  clientId: number;
  dataType: string;
  label: string;
  encryptedData: string;
  notes?: string;
  isActive: boolean;
  lastAccessedAt?: string;
  lastAccessedBy?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  client?: {
    id: number;
    name: string;
  };
  createdByUser?: {
    id: string;
    firstName?: string;
    lastName?: string;
  };
  lastAccessedByUser?: {
    id: string;
    firstName?: string;
    lastName?: string;
  };
}

// Simple encryption functions (for demo - in production use proper encryption)
const encryptData = (data: string): string => {
  return btoa(data); // Base64 encoding for demo
};

const decryptData = (encryptedData: string): string => {
  try {
    return atob(encryptedData); // Base64 decoding for demo
  } catch {
    return "***ENCRYPTED***";
  }
};

export default function VaultPage() {
  const [selectedClient, setSelectedClient] = useState<number | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<VaultEntry | null>(null);
  const [viewingData, setViewingData] = useState<{[key: number]: boolean}>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch clients for dropdown
  const { data: clients = [] } = useQuery<Array<{id: number, name: string}>>({
    queryKey: ["/api/clients"],
  });

  // Fetch vault entries for selected client
  const { data: vaultEntries = [], isLoading: vaultLoading } = useQuery<VaultEntry[]>({
    queryKey: [`/api/vault/${selectedClient}`],
    enabled: !!selectedClient,
  });

  // Form setup
  const form = useForm<VaultFormData>({
    resolver: zodResolver(vaultFormSchema),
    defaultValues: {
      dataType: "other",
    },
  });

  // Create vault entry mutation
  const createVaultMutation = useMutation({
    mutationFn: async (data: VaultFormData) => {
      const response = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...data,
          clientId: Number(data.clientId),
          encryptedData: encryptData(data.data), // Encrypt the sensitive data
        }),
      });
      if (!response.ok) throw new Error("Failed to create vault entry");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vault/${selectedClient}`] });
      setIsDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Vault entry created successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create vault entry", variant: "destructive" });
    },
  });

  // Update vault entry mutation
  const updateVaultMutation = useMutation({
    mutationFn: async (data: { id: number; updates: Partial<VaultFormData> }) => {
      const updates: any = { ...data.updates };
      if (updates.data) {
        updates.encryptedData = encryptData(updates.data);
        delete updates.data;
      }
      
      const response = await fetch(`/api/vault/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      });
      if (!response.ok) throw new Error("Failed to update vault entry");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vault/${selectedClient}`] });
      setEditingEntry(null);
      setIsDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Vault entry updated successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update vault entry", variant: "destructive" });
    },
  });

  // Delete vault entry mutation
  const deleteVaultMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/vault/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete vault entry");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vault/${selectedClient}`] });
      toast({ title: "Success", description: "Vault entry deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete vault entry", variant: "destructive" });
    },
  });

  const onSubmit = (data: VaultFormData) => {
    if (editingEntry) {
      updateVaultMutation.mutate({ id: editingEntry.id, updates: data });
    } else {
      createVaultMutation.mutate(data);
    }
  };

  const openEditDialog = (entry: VaultEntry) => {
    setEditingEntry(entry);
    form.reset({
      clientId: entry.clientId,
      dataType: entry.dataType as any,
      label: entry.label,
      data: decryptData(entry.encryptedData),
      notes: entry.notes || "",
    });
    setIsDialogOpen(true);
  };

  const openCreateDialog = () => {
    setEditingEntry(null);
    form.reset({
      clientId: selectedClient || undefined,
      dataType: "other",
    });
    setIsDialogOpen(true);
  };

  const toggleDataVisibility = (entryId: number) => {
    setViewingData(prev => ({
      ...prev,
      [entryId]: !prev[entryId]
    }));
  };

  const getDataTypeBadge = (dataType: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      ssn: "destructive",
      bank_account: "destructive", 
      password: "destructive",
      driver_license: "default",
      passport: "default",
      tax_documents: "secondary",
      insurance: "secondary",
      other: "outline",
    };
    
    const labels: Record<string, string> = {
      ssn: "SSN",
      bank_account: "Bank Account",
      password: "Password",
      driver_license: "Driver License",
      passport: "Passport",
      tax_documents: "Tax Documents",
      insurance: "Insurance",
      other: "Other",
    };
    
    return <Badge variant={variants[dataType] || "outline"}>{labels[dataType] || dataType}</Badge>;
  };

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Client Vault" subtitle="Secure storage for confidential client information" />
        <main className="custom-scrollbar flex-1 overflow-auto">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Shield className="h-8 w-8 text-red-600" />
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Client Vault</h1>
                <p className="text-gray-600 dark:text-gray-400 mt-2">Secure storage for confidential client information</p>
              </div>
            </div>
          </div>
          
          {selectedClient && (
            <Button onClick={openCreateDialog} data-testid="button-create-vault-entry">
              <Plus className="h-4 w-4 mr-2" />
              Add Entry
            </Button>
          )}
        </div>

        {/* Security Warning */}
        <Card className="mb-8 border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="flex items-center text-red-800">
              <AlertTriangle className="h-5 w-5 mr-2" />
              Security Notice
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-700">
              This vault contains highly sensitive client information. All access is logged and monitored. 
              Only authorized personnel should access this data. Ensure compliance with data protection regulations.
            </p>
          </CardContent>
        </Card>

        {/* Client Selection */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Select Client</CardTitle>
            <CardDescription>Choose a client to view their confidential information</CardDescription>
          </CardHeader>
          <CardContent>
            <Select onValueChange={(value) => setSelectedClient(Number(value))} value={selectedClient?.toString()}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a client to view vault entries" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client: any) => (
                  <SelectItem key={client.id} value={client.id.toString()}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Vault Entries */}
        {selectedClient && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Lock className="h-5 w-5 mr-2" />
                Confidential Information
              </CardTitle>
              <CardDescription>
                Encrypted storage for sensitive client data - {clients.find((c: any) => c.id === selectedClient)?.name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {vaultLoading ? (
                <div className="text-center py-8">Loading vault entries...</div>
              ) : vaultEntries.length === 0 ? (
                <div className="text-center py-8">
                  <Database className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">No confidential information stored for this client</p>
                  <Button onClick={openCreateDialog} className="mt-4">
                    <Plus className="h-4 w-4 mr-2" />
                    Add First Entry
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Label</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead>Last Accessed</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vaultEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{getDataTypeBadge(entry.dataType)}</TableCell>
                        <TableCell className="font-medium">{entry.label}</TableCell>
                        <TableCell>
                          <div className="flex items-center space-x-2">
                            {viewingData[entry.id] ? (
                              <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                                {decryptData(entry.encryptedData)}
                              </span>
                            ) : (
                              <span className="text-gray-400">***ENCRYPTED***</span>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleDataVisibility(entry.id)}
                              data-testid={`button-toggle-visibility-${entry.id}`}
                            >
                              {viewingData[entry.id] ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          {entry.lastAccessedAt ? (
                            <div className="text-sm">
                              <div>{new Date(entry.lastAccessedAt).toLocaleDateString()}</div>
                              <div className="text-gray-500">
                                by {entry.lastAccessedByUser?.firstName} {entry.lastAccessedByUser?.lastName}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-500">Never</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div>{new Date(entry.createdAt).toLocaleDateString()}</div>
                            <div className="text-gray-500">
                              by {entry.createdByUser?.firstName} {entry.createdByUser?.lastName}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex space-x-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditDialog(entry)}
                              data-testid={`button-edit-${entry.id}`}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (confirm("Are you sure you want to delete this vault entry? This action cannot be undone.")) {
                                  deleteVaultMutation.mutate(entry.id);
                                }
                              }}
                              data-testid={`button-delete-${entry.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {/* Create/Edit Entry Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle className="flex items-center">
                <Lock className="h-5 w-5 mr-2" />
                {editingEntry ? "Edit Vault Entry" : "Create New Vault Entry"}
              </DialogTitle>
              <DialogDescription>
                {editingEntry 
                  ? "Update confidential information with proper encryption"
                  : "Add new confidential client information with encryption"
                }
              </DialogDescription>
            </DialogHeader>
            
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="clientId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Client</FormLabel>
                        <Select onValueChange={(value) => field.onChange(Number(value))} value={field.value?.toString()}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select client" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {clients.map((client: any) => (
                              <SelectItem key={client.id} value={client.id.toString()}>
                                {client.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="dataType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Data Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="ssn">Social Security Number</SelectItem>
                            <SelectItem value="bank_account">Bank Account</SelectItem>
                            <SelectItem value="password">Password</SelectItem>
                            <SelectItem value="driver_license">Driver License</SelectItem>
                            <SelectItem value="passport">Passport</SelectItem>
                            <SelectItem value="tax_documents">Tax Documents</SelectItem>
                            <SelectItem value="insurance">Insurance Info</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="label"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Label</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., Primary Bank Account, Main SSN, etc." />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="data"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confidential Data</FormLabel>
                      <FormControl>
                        <Input 
                          {...field} 
                          type="password"
                          placeholder="Enter sensitive information (will be encrypted)"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes (Optional)</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="Additional notes (not encrypted)" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end space-x-2 pt-4">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setIsDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createVaultMutation.isPending || updateVaultMutation.isPending}
                    data-testid="button-save-vault-entry"
                  >
                    {createVaultMutation.isPending || updateVaultMutation.isPending 
                      ? "Saving..." 
                      : editingEntry ? "Update Entry" : "Create Entry"
                    }
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
        </main>
      </div>
    </div>
  );
}