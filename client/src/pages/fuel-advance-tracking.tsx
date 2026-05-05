import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { 
  Fuel, 
  Plus,
  Edit,
  Trash2,
  Eye,
  MapPin,
  Calendar,
  User,
  DollarSign,
  TrendingUp,
  Truck
} from "lucide-react";

// US States for dropdown
const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' }
];

// Fuel advance form schema
const fuelAdvanceFormSchema = z.object({
  carrierName: z.string().min(1, "Carrier name is required"),
  advanceAmount: z.number().min(0.01, "Advance amount must be greater than 0"),
  advanceDate: z.string().min(1, "Advance date is required"),
  pickupState: z.string().length(2, "Pickup state is required"),
  deliveryState: z.string().length(2, "Delivery state is required"),
  processedBy: z.string().min(1, "Processing agent is required"),
  loadId: z.number().optional(),
  notes: z.string().optional(),
  status: z.enum(["pending", "approved", "paid", "cancelled"]).default("pending"),
});

type FuelAdvanceFormData = z.infer<typeof fuelAdvanceFormSchema>;

interface FuelAdvance {
  id: number;
  carrierName: string;
  advanceAmount: string;
  advanceDate: string;
  pickupState: string;
  deliveryState: string;
  processedBy: string;
  processedByName?: string;
  loadId?: number;
  notes?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export default function FuelAdvanceTracking() {
  const [isFuelAdvanceDialogOpen, setIsFuelAdvanceDialogOpen] = useState(false);
  const [editingFuelAdvance, setEditingFuelAdvance] = useState<FuelAdvance | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch fuel advances
  const { data: fuelAdvances = [], isLoading } = useQuery<FuelAdvance[]>({
    queryKey: ["/api/fuel-advances"],
  });

  // Fetch users for the processed by dropdown
  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  // Fuel advance form
  const form = useForm<FuelAdvanceFormData>({
    resolver: zodResolver(fuelAdvanceFormSchema),
    defaultValues: {
      status: "pending",
      advanceAmount: 0,
      advanceDate: new Date().toISOString().split('T')[0], // Today's date
    },
  });

  // Filter fuel advances based on search term
  const filteredFuelAdvances = fuelAdvances.filter(advance =>
    advance.carrierName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    advance.processedByName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    advance.pickupState.toLowerCase().includes(searchTerm.toLowerCase()) ||
    advance.deliveryState.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Create fuel advance mutation
  const createFuelAdvanceMutation = useMutation({
    mutationFn: async (data: FuelAdvanceFormData) => {
      const response = await fetch("/api/fuel-advances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create fuel advance");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-advances"] });
      setIsFuelAdvanceDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Fuel advance created successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create fuel advance", variant: "destructive" });
    },
  });

  // Update fuel advance mutation
  const updateFuelAdvanceMutation = useMutation({
    mutationFn: async (data: { id: number; updates: Partial<FuelAdvanceFormData> }) => {
      const response = await fetch(`/api/fuel-advances/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data.updates),
      });
      if (!response.ok) throw new Error("Failed to update fuel advance");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-advances"] });
      setEditingFuelAdvance(null);
      setIsFuelAdvanceDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Fuel advance updated successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update fuel advance", variant: "destructive" });
    },
  });

  // Delete fuel advance mutation
  const deleteFuelAdvanceMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/fuel-advances/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete fuel advance");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-advances"] });
      toast({ title: "Success", description: "Fuel advance deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete fuel advance", variant: "destructive" });
    },
  });

  const onSubmit = (data: FuelAdvanceFormData) => {
    if (editingFuelAdvance) {
      updateFuelAdvanceMutation.mutate({ id: editingFuelAdvance.id, updates: data });
    } else {
      createFuelAdvanceMutation.mutate(data);
    }
  };

  const openCreateDialog = () => {
    setEditingFuelAdvance(null);
    form.reset({
      status: "pending",
      advanceAmount: 0,
      advanceDate: new Date().toISOString().split('T')[0],
    });
    setIsFuelAdvanceDialogOpen(true);
  };

  const openEditDialog = (fuelAdvance: FuelAdvance) => {
    setEditingFuelAdvance(fuelAdvance);
    form.reset({
      carrierName: fuelAdvance.carrierName,
      advanceAmount: parseFloat(fuelAdvance.advanceAmount),
      advanceDate: fuelAdvance.advanceDate.split('T')[0],
      pickupState: fuelAdvance.pickupState,
      deliveryState: fuelAdvance.deliveryState,
      processedBy: fuelAdvance.processedBy,
      loadId: fuelAdvance.loadId || undefined,
      notes: fuelAdvance.notes || "",
      status: fuelAdvance.status as any,
    });
    setIsFuelAdvanceDialogOpen(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "approved":
        return "bg-blue-100 text-blue-800";
      case "paid":
        return "bg-green-100 text-green-800";
      case "cancelled":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const formatCurrency = (amount: string) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD' 
    }).format(parseFloat(amount));
  };

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'MMM dd, yyyy');
  };

  // Statistics calculations
  const stats = {
    totalAdvances: fuelAdvances.length,
    totalAmount: fuelAdvances.reduce((sum, advance) => sum + parseFloat(advance.advanceAmount), 0),
    pendingCount: fuelAdvances.filter(a => a.status === 'pending').length,
    paidCount: fuelAdvances.filter(a => a.status === 'paid').length,
  };

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Fuel Advances"
          subtitle="Monitor fuel advances by carrier, date, and processing agent"
          group="Funding"
        />
        <main className="custom-scrollbar flex-1 overflow-auto">
      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Fuel className="h-8 w-8 text-blue-600" />
            </div>
          </div>
          
          <Button onClick={openCreateDialog} data-testid="button-create-fuel-advance">
            <Plus className="h-4 w-4 mr-2" />
            New Fuel Advance
          </Button>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Advances</p>
                  <p className="text-2xl font-bold text-blue-600">{stats.totalAdvances}</p>
                </div>
                <Fuel className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Amount</p>
                  <p className="text-2xl font-bold text-green-600">
                    {formatCurrency(stats.totalAmount.toString())}
                  </p>
                </div>
                <DollarSign className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Pending</p>
                  <p className="text-2xl font-bold text-yellow-600">{stats.pendingCount}</p>
                </div>
                <Calendar className="h-8 w-8 text-yellow-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Paid</p>
                  <p className="text-2xl font-bold text-green-600">{stats.paidCount}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filter */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Search Fuel Advances</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex space-x-4">
              <div className="flex-1">
                <Input
                  placeholder="Search by carrier name, agent, or states..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  data-testid="input-search-fuel-advances"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Fuel Advances Table */}
        <Card>
          <CardHeader>
            <CardTitle>Fuel Advance Records</CardTitle>
            <CardDescription>Track which carriers received advances and processing details</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Carrier</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Processed By</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFuelAdvances.map((advance) => (
                    <TableRow key={advance.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center space-x-2">
                          <Truck className="h-4 w-4 text-blue-600" />
                          <div>
                            <p className="font-medium">{advance.carrierName}</p>
                            {advance.loadId && (
                              <p className="text-sm text-gray-500">Load #{advance.loadId}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono">
                        {formatCurrency(advance.advanceAmount)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-1">
                          <Calendar className="h-3 w-3 text-gray-400" />
                          <span>{formatDate(advance.advanceDate)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-1">
                          <MapPin className="h-3 w-3 text-gray-400" />
                          <span className="font-mono">
                            {advance.pickupState} → {advance.deliveryState}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center space-x-1">
                          <User className="h-3 w-3 text-gray-400" />
                          <span>{advance.processedByName || advance.processedBy}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(advance.status)}>
                          {advance.status.charAt(0).toUpperCase() + advance.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex space-x-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => openEditDialog(advance)}
                            data-testid={`button-edit-${advance.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => {
                              if (confirm("Are you sure you want to delete this fuel advance?")) {
                                deleteFuelAdvanceMutation.mutate(advance.id);
                              }
                            }}
                            data-testid={`button-delete-${advance.id}`}
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
            
            {filteredFuelAdvances.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <Fuel className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">
                  {searchTerm ? "No fuel advances found matching your search" : "No fuel advances found"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Fuel Advance Dialog */}
      <Dialog open={isFuelAdvanceDialogOpen} onOpenChange={setIsFuelAdvanceDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingFuelAdvance ? "Edit Fuel Advance" : "New Fuel Advance"}
            </DialogTitle>
            <DialogDescription>
              {editingFuelAdvance ? "Update fuel advance information" : "Record a new fuel advance for a carrier"}
            </DialogDescription>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="carrierName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Carrier Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="ABC Transport LLC" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="advanceAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Advance Amount *</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="500.00"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="advanceDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Advance Date *</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="processedBy"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Processed By *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select agent" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {users.map((user) => (
                            <SelectItem key={user.id} value={user.id}>
                              {user.firstName} {user.lastName} ({user.email})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="pickupState"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Pickup State *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select state" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {US_STATES.map((state) => (
                            <SelectItem key={state.code} value={state.code}>
                              {state.code} - {state.name}
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
                  name="deliveryState"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Delivery State *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select state" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {US_STATES.map((state) => (
                            <SelectItem key={state.code} value={state.code}>
                              {state.code} - {state.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="loadId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Load ID (Optional)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="12345"
                          {...field}
                          onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
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
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="paid">Paid</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
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
                        placeholder="Additional notes about this fuel advance..."
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => setIsFuelAdvanceDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createFuelAdvanceMutation.isPending || updateFuelAdvanceMutation.isPending}>
                  {editingFuelAdvance ? "Update Advance" : "Create Advance"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
        </main>
      </div>
    </div>
  );
}