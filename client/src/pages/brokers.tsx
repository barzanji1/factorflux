import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { 
  Building, 
  Plus, 
  Edit, 
  Trash2, 
  Eye, 
  Phone, 
  Mail, 
  MapPin,
  TrendingUp,
  Users,
  DollarSign,
  Calendar
} from "lucide-react";

// Broker form schema
const brokerFormSchema = z.object({
  name: z.string().min(1, "Broker name is required"),
  contactPerson: z.string().min(1, "Contact person is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(10, "Valid phone number is required"),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  mcNumber: z.string().optional(),
  dotNumber: z.string().optional(),
  creditLimit: z.number().min(0).optional(),
  paymentTerms: z.enum(["net15", "net30", "net45", "net60", "quickpay"]).default("net30"),
  status: z.enum(["active", "inactive", "suspended"]).default("active"),
  notes: z.string().optional(),
});

type BrokerFormData = z.infer<typeof brokerFormSchema>;

interface Broker {
  id: number;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  mcNumber?: string;
  dotNumber?: string;
  creditLimit?: number;
  paymentTerms: string;
  status: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export default function Brokers() {
  const [isBrokerDialogOpen, setIsBrokerDialogOpen] = useState(false);
  const [editingBroker, setEditingBroker] = useState<Broker | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch brokers
  const { data: brokers = [], isLoading } = useQuery<Broker[]>({
    queryKey: ["/api/brokers"],
  });

  // Broker form
  const form = useForm<BrokerFormData>({
    resolver: zodResolver(brokerFormSchema),
    defaultValues: {
      paymentTerms: "net30",
      status: "active",
      creditLimit: 0,
    },
  });

  // Filter brokers based on search term
  const filteredBrokers = brokers.filter(broker =>
    broker.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    broker.contactPerson.toLowerCase().includes(searchTerm.toLowerCase()) ||
    broker.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Create broker mutation
  const createBrokerMutation = useMutation({
    mutationFn: async (data: BrokerFormData) => {
      const response = await fetch("/api/brokers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create broker");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brokers"] });
      setIsBrokerDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Broker created successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create broker", variant: "destructive" });
    },
  });

  // Update broker mutation
  const updateBrokerMutation = useMutation({
    mutationFn: async (data: { id: number; updates: Partial<BrokerFormData> }) => {
      const response = await fetch(`/api/brokers/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data.updates),
      });
      if (!response.ok) throw new Error("Failed to update broker");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brokers"] });
      setEditingBroker(null);
      setIsBrokerDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Broker updated successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update broker", variant: "destructive" });
    },
  });

  // Delete broker mutation
  const deleteBrokerMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/brokers/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete broker");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brokers"] });
      toast({ title: "Success", description: "Broker deleted successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete broker", variant: "destructive" });
    },
  });

  const onSubmit = (data: BrokerFormData) => {
    if (editingBroker) {
      updateBrokerMutation.mutate({ id: editingBroker.id, updates: data });
    } else {
      createBrokerMutation.mutate(data);
    }
  };

  const openCreateDialog = () => {
    setEditingBroker(null);
    form.reset({
      paymentTerms: "net30",
      status: "active",
      creditLimit: 0,
    });
    setIsBrokerDialogOpen(true);
  };

  const openEditDialog = (broker: Broker) => {
    setEditingBroker(broker);
    form.reset({
      name: broker.name,
      contactPerson: broker.contactPerson,
      email: broker.email,
      phone: broker.phone,
      address: broker.address || "",
      city: broker.city || "",
      state: broker.state || "",
      zipCode: broker.zipCode || "",
      mcNumber: broker.mcNumber || "",
      dotNumber: broker.dotNumber || "",
      creditLimit: broker.creditLimit || 0,
      paymentTerms: broker.paymentTerms as any,
      status: broker.status as any,
      notes: broker.notes || "",
    });
    setIsBrokerDialogOpen(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800";
      case "inactive":
        return "bg-gray-100 text-gray-800";
      case "suspended":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getPaymentTermsLabel = (terms: string) => {
    switch (terms) {
      case "net15":
        return "Net 15";
      case "net30":
        return "Net 30";
      case "net45":
        return "Net 45";
      case "net60":
        return "Net 60";
      case "quickpay":
        return "Quick Pay";
      default:
        return terms;
    }
  };

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Broker Desk" subtitle="Freight broker relationships, contacts, and risk ratings" group="Risk" />
        <main className="custom-scrollbar flex-1 overflow-auto">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Building className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Brokers</h1>
                <p className="text-gray-600 dark:text-gray-400 mt-2">Manage freight broker partnerships and relationships</p>
              </div>
            </div>
          </div>
          
          <Button onClick={openCreateDialog} data-testid="button-create-broker">
            <Plus className="h-4 w-4 mr-2" />
            Add Broker
          </Button>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Brokers</p>
                  <p className="text-2xl font-bold text-blue-600">{brokers.length}</p>
                </div>
                <Building className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Active Brokers</p>
                  <p className="text-2xl font-bold text-green-600">
                    {brokers.filter(b => b.status === 'active').length}
                  </p>
                </div>
                <TrendingUp className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Credit Limit</p>
                  <p className="text-2xl font-bold text-purple-600">
                    ${brokers.reduce((sum, b) => sum + (b.creditLimit || 0), 0).toLocaleString()}
                  </p>
                </div>
                <DollarSign className="h-8 w-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Quick Pay</p>
                  <p className="text-2xl font-bold text-orange-600">
                    {brokers.filter(b => b.paymentTerms === 'quickpay').length}
                  </p>
                </div>
                <Calendar className="h-8 w-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filter */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Search Brokers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex space-x-4">
              <div className="flex-1">
                <Input
                  placeholder="Search by name, contact person, or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  data-testid="input-search-brokers"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Brokers Table */}
        <Card>
          <CardHeader>
            <CardTitle>Broker Directory</CardTitle>
            <CardDescription>Manage your freight broker partnerships</CardDescription>
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
                    <TableHead>Broker Name</TableHead>
                    <TableHead>Contact Person</TableHead>
                    <TableHead>Contact Info</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Payment Terms</TableHead>
                    <TableHead>Credit Limit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBrokers.map((broker) => (
                    <TableRow key={broker.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center space-x-2">
                          <Building className="h-4 w-4 text-blue-600" />
                          <div>
                            <p className="font-medium">{broker.name}</p>
                            {broker.mcNumber && (
                              <p className="text-sm text-gray-500">MC: {broker.mcNumber}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{broker.contactPerson}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center space-x-1">
                            <Phone className="h-3 w-3 text-gray-400" />
                            <span className="text-sm">{broker.phone}</span>
                          </div>
                          <div className="flex items-center space-x-1">
                            <Mail className="h-3 w-3 text-gray-400" />
                            <span className="text-sm">{broker.email}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {broker.city && broker.state ? (
                          <div className="flex items-center space-x-1">
                            <MapPin className="h-3 w-3 text-gray-400" />
                            <span className="text-sm">{broker.city}, {broker.state}</span>
                          </div>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {getPaymentTermsLabel(broker.paymentTerms)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {broker.creditLimit ? `$${broker.creditLimit.toLocaleString()}` : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(broker.status)}>
                          {broker.status.charAt(0).toUpperCase() + broker.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex space-x-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => openEditDialog(broker)}
                            data-testid={`button-edit-${broker.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => {
                              if (confirm("Are you sure you want to delete this broker?")) {
                                deleteBrokerMutation.mutate(broker.id);
                              }
                            }}
                            data-testid={`button-delete-${broker.id}`}
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
            
            {filteredBrokers.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <Building className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">
                  {searchTerm ? "No brokers found matching your search" : "No brokers found"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </main>

      {/* Create/Edit Broker Dialog */}
      <Dialog open={isBrokerDialogOpen} onOpenChange={setIsBrokerDialogOpen}>
        <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingBroker ? "Edit Broker" : "Add New Broker"}
            </DialogTitle>
            <DialogDescription>
              {editingBroker ? "Update broker information" : "Add a new freight broker to your network"}
            </DialogDescription>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Broker Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="ABC Freight Solutions" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="contactPerson"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Person *</FormLabel>
                      <FormControl>
                        <Input placeholder="John Smith" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email *</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="john@abcfreight.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone *</FormLabel>
                      <FormControl>
                        <Input placeholder="(555) 123-4567" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Main Street" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input placeholder="Atlanta" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <Input placeholder="GA" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="zipCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ZIP Code</FormLabel>
                      <FormControl>
                        <Input placeholder="30309" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="mcNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>MC Number</FormLabel>
                      <FormControl>
                        <Input placeholder="MC123456" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dotNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>DOT Number</FormLabel>
                      <FormControl>
                        <Input placeholder="123456" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="creditLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Credit Limit</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="50000"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="paymentTerms"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Terms</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select terms" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="quickpay">Quick Pay</SelectItem>
                          <SelectItem value="net15">Net 15</SelectItem>
                          <SelectItem value="net30">Net 30</SelectItem>
                          <SelectItem value="net45">Net 45</SelectItem>
                          <SelectItem value="net60">Net 60</SelectItem>
                        </SelectContent>
                      </Select>
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
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="suspended">Suspended</SelectItem>
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
                        placeholder="Additional notes about this broker..."
                        rows={3}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => setIsBrokerDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createBrokerMutation.isPending || updateBrokerMutation.isPending}>
                  {editingBroker ? "Update Broker" : "Create Broker"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}