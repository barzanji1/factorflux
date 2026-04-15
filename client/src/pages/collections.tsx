import { useState } from "react";
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
import { AlertTriangle, DollarSign, Users, Clock, Plus, Eye, Edit, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import TopNav from "@/components/layout/top-nav";

// Collection form schema
const collectionFormSchema = z.object({
  clientId: z.number().min(1, "Client is required"),
  amount: z.string().min(1, "Amount is required"),
  description: z.string().min(1, "Description is required"),
  status: z.enum(["pending", "in_progress", "paid", "written_off"]).default("pending"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  dueDate: z.string().min(1, "Due date is required"),
  notes: z.string().optional(),
  assignedTo: z.string().optional(),
});

type CollectionFormData = z.infer<typeof collectionFormSchema>;

interface Collection {
  id: number;
  clientId: number;
  amount: string;
  description: string;
  status: "pending" | "in_progress" | "paid" | "written_off";
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string;
  lastContactDate?: string;
  notes?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
  client?: {
    id: number;
    name: string;
    email?: string;
    status: string;
  };
  assignedUser?: {
    id: string;
    firstName?: string;
    lastName?: string;
  };
}

interface ClientPerformance {
  clientId: number;
  name: string;
  lastLoadDate: string | null;
  daysSinceLastLoad: number;
  status: "active" | "warning" | "inactive";
  totalOwed: string;
  pendingCollections: number;
}

export default function CollectionsPage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch collections
  const { data: collections = [], isLoading: collectionsLoading } = useQuery<Collection[]>({
    queryKey: ["/api/collections"],
  });

  // Fetch client performance data
  const { data: clientPerformance = [], isLoading: performanceLoading } = useQuery<ClientPerformance[]>({
    queryKey: ["/api/collections/client-performance"],
  });

  // Fetch clients for dropdown
  const { data: clients = [] } = useQuery<any[]>({
    queryKey: ["/api/clients"],
  });

  // Form setup
  const form = useForm<CollectionFormData>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues: {
      status: "pending",
      priority: "medium",
    },
  });

  // Create collection mutation
  const createCollectionMutation = useMutation({
    mutationFn: async (data: CollectionFormData) => {
      const response = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          ...data,
          clientId: Number(data.clientId),
          dueDate: new Date(data.dueDate).toISOString(),
        }),
      });
      if (!response.ok) throw new Error("Failed to create collection");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collections/client-performance"] });
      setIsDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Collection created successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create collection", variant: "destructive" });
    },
  });

  // Update collection mutation
  const updateCollectionMutation = useMutation({
    mutationFn: async (data: { id: number; updates: Partial<CollectionFormData> }) => {
      const response = await fetch(`/api/collections/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data.updates),
      });
      if (!response.ok) throw new Error("Failed to update collection");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/collections/client-performance"] });
      setEditingCollection(null);
      setIsDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Collection updated successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update collection", variant: "destructive" });
    },
  });

  const onSubmit = (data: CollectionFormData) => {
    if (editingCollection) {
      updateCollectionMutation.mutate({ id: editingCollection.id, updates: data });
    } else {
      createCollectionMutation.mutate(data);
    }
  };

  const openEditDialog = (collection: Collection) => {
    setEditingCollection(collection);
    form.reset({
      clientId: collection.clientId,
      amount: collection.amount,
      description: collection.description,
      status: collection.status,
      priority: collection.priority,
      dueDate: new Date(collection.dueDate).toISOString().split('T')[0],
      notes: collection.notes || "",
      assignedTo: collection.assignedTo || "",
    });
    setIsDialogOpen(true);
  };

  const openCreateDialog = () => {
    setEditingCollection(null);
    form.reset();
    setIsDialogOpen(true);
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pending: "outline",
      in_progress: "default",
      paid: "secondary",
      written_off: "destructive",
    };
    return <Badge variant={variants[status] || "outline"}>{status.replace('_', ' ')}</Badge>;
  };

  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      low: "outline",
      medium: "default",
      high: "secondary",
      urgent: "destructive",
    };
    return <Badge variant={variants[priority] || "outline"}>{priority}</Badge>;
  };

  const getPerformanceStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      active: "secondary",
      warning: "default",
      inactive: "destructive",
    };
    const colors: Record<string, string> = {
      active: "text-green-700 bg-green-100",
      warning: "text-yellow-700 bg-yellow-100",
      inactive: "text-red-700 bg-red-100",
    };
    return <Badge className={colors[status]}>{status}</Badge>;
  };

  const getInactiveClients = () => {
    return clientPerformance.filter(client => client.status === 'inactive');
  };

  const getTotalOwed = () => {
    return collections
      .filter(c => c.status === 'pending' || c.status === 'in_progress')
      .reduce((total, c) => total + parseFloat(c.amount), 0)
      .toFixed(2);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav title="Collections" subtitle="Manage funds owed to TPF and track client performance" />
      <main className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Collections</h1>
            <p className="text-gray-600 mt-2">Manage funds owed to TPF and track client performance</p>
          </div>
          <Button onClick={openCreateDialog} data-testid="button-create-collection">
            <Plus className="h-4 w-4 mr-2" />
            New Collection
          </Button>
        </div>

        {/* Performance Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Owed</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${getTotalOwed()}</div>
              <p className="text-xs text-muted-foreground">
                Pending collections
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Collections</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {collections.filter(c => c.status === 'pending' || c.status === 'in_progress').length}
              </div>
              <p className="text-xs text-muted-foreground">
                Open cases
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Inactive Clients</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {getInactiveClients().length}
              </div>
              <p className="text-xs text-muted-foreground">
                30+ days no loads
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Days Overdue</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {collections.length > 0 
                  ? Math.round(collections
                      .filter(c => c.status === 'pending' || c.status === 'in_progress')
                      .reduce((total, c) => {
                        const daysPast = Math.max(0, (Date.now() - new Date(c.dueDate).getTime()) / (1000 * 60 * 60 * 24));
                        return total + daysPast;
                      }, 0) / collections.filter(c => c.status === 'pending' || c.status === 'in_progress').length)
                  : 0
                }
              </div>
              <p className="text-xs text-muted-foreground">
                Days past due
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Client Performance Panel */}
          <Card>
            <CardHeader>
              <CardTitle>Client Performance</CardTitle>
              <CardDescription>Track client activity and identify at-risk accounts</CardDescription>
            </CardHeader>
            <CardContent>
              {performanceLoading ? (
                <div className="text-center py-4">Loading client performance...</div>
              ) : (
                <div className="space-y-4">
                  {clientPerformance.slice(0, 10).map((client) => (
                    <div key={client.clientId} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex-1">
                        <div className="font-medium">{client.name}</div>
                        <div className="text-sm text-gray-500">
                          {client.lastLoadDate 
                            ? `Last load: ${client.daysSinceLastLoad} days ago`
                            : 'No loads recorded'
                          }
                        </div>
                        {client.totalOwed !== '0' && (
                          <div className="text-sm font-medium text-red-600">
                            Owes: ${client.totalOwed}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        {getPerformanceStatusBadge(client.status)}
                        {client.pendingCollections > 0 && (
                          <Badge variant="outline">{client.pendingCollections} collection(s)</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active Collections Panel */}
          <Card>
            <CardHeader>
              <CardTitle>Active Collections</CardTitle>
              <CardDescription>Current collection efforts and status</CardDescription>
            </CardHeader>
            <CardContent>
              {collectionsLoading ? (
                <div className="text-center py-4">Loading collections...</div>
              ) : (
                <div className="space-y-4">
                  {collections
                    .filter(c => c.status === 'pending' || c.status === 'in_progress')
                    .slice(0, 5)
                    .map((collection) => (
                      <div key={collection.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex-1">
                          <div className="font-medium">{collection.client?.name || 'Unknown Client'}</div>
                          <div className="text-sm text-gray-500">{collection.description}</div>
                          <div className="text-sm font-medium text-red-600">${collection.amount}</div>
                          <div className="text-xs text-gray-400">
                            Due: {new Date(collection.dueDate).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          {getStatusBadge(collection.status)}
                          {getPriorityBadge(collection.priority)}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(collection)}
                            data-testid={`button-edit-collection-${collection.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* All Collections Table */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>All Collections</CardTitle>
            <CardDescription>Complete list of collection cases</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {collections.map((collection) => (
                  <TableRow key={collection.id}>
                    <TableCell className="font-medium">
                      {collection.client?.name || 'Unknown Client'}
                    </TableCell>
                    <TableCell className="font-medium text-red-600">
                      ${collection.amount}
                    </TableCell>
                    <TableCell>{collection.description}</TableCell>
                    <TableCell>{getStatusBadge(collection.status)}</TableCell>
                    <TableCell>{getPriorityBadge(collection.priority)}</TableCell>
                    <TableCell>
                      {new Date(collection.dueDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {collection.assignedUser 
                        ? `${collection.assignedUser.firstName} ${collection.assignedUser.lastName}`
                        : 'Unassigned'
                      }
                    </TableCell>
                    <TableCell>
                      <div className="flex space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditDialog(collection)}
                          data-testid={`button-edit-${collection.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Create/Edit Collection Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>
                {editingCollection ? "Edit Collection" : "Create New Collection"}
              </DialogTitle>
              <DialogDescription>
                {editingCollection 
                  ? "Update collection details and status"
                  : "Add a new collection case for funds owed to TPF"
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
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount Owed</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" step="0.01" placeholder="0.00" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Describe the collection case..." />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-3 gap-4">
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="in_progress">In Progress</SelectItem>
                            <SelectItem value="paid">Paid</SelectItem>
                            <SelectItem value="written_off">Written Off</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="urgent">Urgent</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="dueDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Due Date</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" />
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
                        <Textarea {...field} placeholder="Additional notes or contact history..." />
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
                    disabled={createCollectionMutation.isPending || updateCollectionMutation.isPending}
                    data-testid="button-save-collection"
                  >
                    {createCollectionMutation.isPending || updateCollectionMutation.isPending 
                      ? "Saving..." 
                      : editingCollection ? "Update Collection" : "Create Collection"
                    }
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}