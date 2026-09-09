import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  Database,
  Loader2,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";

const vaultFormSchema = z.object({
  clientId: z.number().min(1, "Client is required"),
  dataType: z.enum(["ssn", "bank_account", "password", "driver_license", "passport", "tax_documents", "insurance", "other"]),
  label: z.string().min(1, "Label is required"),
  value: z.string().min(1, "Value is required"),
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
  client?: { id: number; name: string };
  createdByUser?: { id: string; firstName?: string; lastName?: string };
  lastAccessedByUser?: { id: string; firstName?: string; lastName?: string };
}

const DATA_TYPE_LABELS: Record<string, string> = {
  ssn: "SSN",
  bank_account: "Bank Account",
  password: "Password",
  driver_license: "Driver License",
  passport: "Passport",
  tax_documents: "Tax Documents",
  insurance: "Insurance",
  other: "Other",
};

const DATA_TYPE_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  ssn: "destructive",
  bank_account: "destructive",
  password: "destructive",
  driver_license: "default",
  passport: "default",
  tax_documents: "secondary",
  insurance: "secondary",
  other: "outline",
};

export default function VaultPage() {
  const [selectedClient, setSelectedClient] = useState<number | null>(() => {
    const value = new URLSearchParams(window.location.search).get("clientId");
    const parsed = value ? Number(value) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  });
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<VaultEntry | null>(null);
  const [revealedValues, setRevealedValues] = useState<Record<number, string | null>>({});
  const [revealingId, setRevealingId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: clients = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/clients", { all: true }],
  });

  const { data: vaultEntries = [], isLoading: vaultLoading } = useQuery<VaultEntry[]>({
    queryKey: [`/api/vault/${selectedClient}`],
    enabled: !!selectedClient,
  });

  const form = useForm<VaultFormData>({
    resolver: zodResolver(vaultFormSchema),
    defaultValues: {
      dataType: "other",
      label: "",
      value: "",
      notes: "",
    },
  });

  const createVaultMutation = useMutation({
    mutationFn: async (data: VaultFormData) => {
      const response = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          clientId: Number(data.clientId),
          dataType: data.dataType,
          label: data.label,
          value: data.value,
          notes: data.notes || undefined,
        }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || "Failed to create vault entry");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vault/${selectedClient}`] });
      setIsDialogOpen(false);
      form.reset({ dataType: "other", label: "", value: "", notes: "" });
      toast({ title: "Success", description: "Vault entry created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to create vault entry", variant: "destructive" });
    },
  });

  const updateVaultMutation = useMutation({
    mutationFn: async (data: { id: number; updates: Partial<VaultFormData> }) => {
      const body: any = {};
      if (data.updates.label) body.label = data.updates.label;
      if (data.updates.dataType) body.dataType = data.updates.dataType;
      if (data.updates.notes !== undefined) body.notes = data.updates.notes;
      if (data.updates.value) body.value = data.updates.value;

      const response = await fetch(`/api/vault/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || "Failed to update vault entry");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/vault/${selectedClient}`] });
      setRevealedValues({});
      setEditingEntry(null);
      setIsDialogOpen(false);
      form.reset({ dataType: "other", label: "", value: "", notes: "" });
      toast({ title: "Success", description: "Vault entry updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to update vault entry", variant: "destructive" });
    },
  });

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
      setRevealedValues({});
      toast({ title: "Success", description: "Vault entry deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete vault entry", variant: "destructive" });
    },
  });

  const handleReveal = async (entry: VaultEntry) => {
    if (revealedValues[entry.id] !== undefined) {
      setRevealedValues((prev) => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      });
      return;
    }

    setRevealingId(entry.id);
    try {
      const res = await fetch(`/api/vault/entry/${entry.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to retrieve value");
      const data = await res.json();
      setRevealedValues((prev) => ({ ...prev, [entry.id]: data.decryptedValue }));
    } catch {
      toast({ title: "Error", description: "Could not retrieve decrypted value", variant: "destructive" });
    } finally {
      setRevealingId(null);
    }
  };

  const openEditDialog = async (entry: VaultEntry) => {
    setEditingEntry(entry);
    setRevealingId(entry.id);
    let currentValue = "";
    try {
      const res = await fetch(`/api/vault/entry/${entry.id}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        currentValue = data.decryptedValue || "";
      }
    } catch {}
    setRevealingId(null);

    form.reset({
      clientId: entry.clientId,
      dataType: entry.dataType as any,
      label: entry.label,
      value: currentValue,
      notes: entry.notes || "",
    });
    setIsDialogOpen(true);
  };

  const openCreateDialog = () => {
    setEditingEntry(null);
    form.reset({
      clientId: selectedClient || undefined,
      dataType: "other",
      label: "",
      value: "",
      notes: "",
    });
    setIsDialogOpen(true);
  };

  const onSubmit = (data: VaultFormData) => {
    if (editingEntry) {
      updateVaultMutation.mutate({ id: editingEntry.id, updates: data });
    } else {
      createVaultMutation.mutate(data);
    }
  };

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Vault" subtitle="Secure storage for confidential carrier and client records" group="Admin" />
        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="container mx-auto px-4 py-8">
            <div className="flex justify-between items-center mb-8">
              <div className="flex items-center space-x-4">
                <Shield className="h-8 w-8 text-red-600" />
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Client Vault</h1>
                  <p className="text-gray-600 dark:text-gray-400 mt-1">AES-256-GCM encrypted — server-side only</p>
                </div>
              </div>
              {selectedClient && (
                <Button onClick={openCreateDialog} data-testid="button-create-vault-entry">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Entry
                </Button>
              )}
            </div>

            <Card className="mb-6 border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center text-red-800 dark:text-red-300 text-base">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Security Notice
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-red-700 dark:text-red-400 text-sm">
                  This vault contains highly sensitive client information. All access is logged and monitored.
                  Values are encrypted with AES-256-GCM before storage — plaintext is never written to the database.
                </p>
              </CardContent>
            </Card>

            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Select Client</CardTitle>
                <CardDescription>Choose a client to view their confidential information</CardDescription>
              </CardHeader>
              <CardContent>
                <Select
                  onValueChange={(value) => { setSelectedClient(Number(value)); setRevealedValues({}); }}
                  value={selectedClient?.toString()}
                >
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

            {selectedClient && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Lock className="h-5 w-5 mr-2" />
                    Confidential Information
                  </CardTitle>
                  <CardDescription>
                    {clients.find((c: any) => c.id === selectedClient)?.name}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {vaultLoading ? (
                    <div className="flex items-center justify-center py-10 gap-2 text-slate-500">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Loading vault entries...
                    </div>
                  ) : vaultEntries.length === 0 ? (
                    <div className="text-center py-10">
                      <Database className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-500 mb-4">No confidential information stored for this client</p>
                      <Button onClick={openCreateDialog} data-testid="button-add-first-entry">
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
                          <TableHead>Value</TableHead>
                          <TableHead>Last Accessed</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {vaultEntries.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell>
                              <Badge variant={DATA_TYPE_VARIANTS[entry.dataType] || "outline"}>
                                {DATA_TYPE_LABELS[entry.dataType] || entry.dataType}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium">{entry.label}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {revealedValues[entry.id] !== undefined ? (
                                  <span className="font-mono text-sm bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded">
                                    {revealedValues[entry.id]}
                                  </span>
                                ) : (
                                  <span className="text-gray-400 font-mono">••••••••</span>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={revealingId === entry.id}
                                  onClick={() => handleReveal(entry)}
                                  data-testid={`button-toggle-visibility-${entry.id}`}
                                >
                                  {revealingId === entry.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : revealedValues[entry.id] !== undefined ? (
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
                                  <div className="text-gray-500 text-xs">
                                    {entry.lastAccessedByUser?.firstName} {entry.lastAccessedByUser?.lastName}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-gray-400 text-sm">Never</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">
                                <div>{new Date(entry.createdAt).toLocaleDateString()}</div>
                                <div className="text-gray-500 text-xs">
                                  {entry.createdByUser?.firstName} {entry.createdByUser?.lastName}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={revealingId === entry.id}
                                  onClick={() => openEditDialog(entry)}
                                  data-testid={`button-edit-${entry.id}`}
                                >
                                  {revealingId === entry.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Edit className="h-4 w-4" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (confirm("Delete this vault entry? This cannot be undone.")) {
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

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Lock className="h-5 w-5" />
                    {editingEntry ? "Edit Vault Entry" : "New Vault Entry"}
                  </DialogTitle>
                  <DialogDescription>
                    {editingEntry
                      ? "Update the entry. The value will be re-encrypted with AES-256-GCM before saving."
                      : "Enter the sensitive data. It will be encrypted server-side before storage."}
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
                            <Select
                              onValueChange={(v) => field.onChange(Number(v))}
                              value={field.value?.toString()}
                            >
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
                            <Input {...field} placeholder="e.g., Primary Bank Account, SSN" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="value"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confidential Value</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="password"
                              placeholder="Enter sensitive value (encrypted before saving)"
                              autoComplete="off"
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
                          <FormLabel>Notes (Optional — not encrypted)</FormLabel>
                          <FormControl>
                            <Textarea {...field} value={field.value || ""} placeholder="Additional context" rows={2} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex justify-end gap-2 pt-2">
                      <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={createVaultMutation.isPending || updateVaultMutation.isPending}
                        data-testid="button-save-vault-entry"
                      >
                        {createVaultMutation.isPending || updateVaultMutation.isPending
                          ? "Saving..."
                          : editingEntry
                          ? "Update Entry"
                          : "Create Entry"}
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
