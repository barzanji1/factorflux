import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
// Authentication removed
import { useLocation } from "wouter";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Fuel,
  Search,
  Filter,
  Users,
  CreditCard,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  Eye,
  Edit,
  Phone,
  Mail,
  Building,
  Calendar,
  DollarSign,
  BarChart3,
  Download,
  Plus,
  MessageSquare,
  Star,
  Check,
  MapPin,
  Hotel,
  Truck
} from "lucide-react";

// Import the fuel advance tracking component
import FuelAdvanceTracking from './fuel-advance-tracking';

interface FuelCardApplication {
  id: number;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  cardType: string;
  status: string;
  fleetSize: string;
  monthlyFuelSpend: string;
  businessType: string;
  yearsInBusiness: string;
  createdAt: string;
  reviewedAt?: string;
  notes?: string;
  submittedBy: string;
}

const fuelCardApplicationSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  contactName: z.string().min(1, "Contact name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(10, "Phone number is required"),
  fleetSize: z.string().min(1, "Fleet size is required"),
  monthlyFuelSpend: z.string().min(1, "Monthly fuel spend is required"),
  cardType: z.enum(["base", "fleet", "premium"], {
    required_error: "Please select a card type",
  }),
  businessType: z.string().min(1, "Business type is required"),
  yearsInBusiness: z.string().min(1, "Years in business is required"),
});

type FuelCardApplicationForm = z.infer<typeof fuelCardApplicationSchema>;

const statusColors = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  approved: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  under_review: "bg-blue-100 text-blue-800 border-blue-200"
};

const cardTypeLabels = {
  base: "TPF Base Card",
  fleet: "TPF Fleet Card", 
  premium: "TPF Premium Card"
};

const cardTypes = [
  {
    id: "fleet",
    name: "TPF Fleet Fuel Card",
    monthlyFee: 0,
    description: "Fuel rebates, expense tracking and tools for saving",
    perks: [
      "Save up to 15¢ per gallon at network locations",
      "Plus up to 3¢ per gallon everywhere else",
      "No monthly fees or contracts"
    ],
    color: "bg-green-50 border-green-200",
    iconBg: "bg-green-100",
    iconColor: "text-green-600",
    popular: false
  }
];

export default function FuelCardsInternal() {
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const [selectedApplication, setSelectedApplication] = useState<FuelCardApplication | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [cardTypeFilter, setCardTypeFilter] = useState("all");
  const [newStatus, setNewStatus] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [showApplicationForm, setShowApplicationForm] = useState(false);

  const form = useForm<FuelCardApplicationForm>({
    resolver: zodResolver(fuelCardApplicationSchema),
    defaultValues: {
      companyName: "",
      contactName: "",
      email: "",
      phone: "",
      fleetSize: "",
      monthlyFuelSpend: "",
      cardType: undefined,
      businessType: "",
      yearsInBusiness: "",
    },
  });

  const { data: applications = [], isLoading: applicationsLoading } = useQuery({
    queryKey: ["/api/fuel-card-applications"],
  });

  const submitApplication = useMutation({
    mutationFn: async (data: FuelCardApplicationForm) => {
      const response = await apiRequest("POST", "/api/fuel-card-applications", data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Application Submitted",
        description: "Fuel card application has been submitted successfully. We'll review it within 2-3 business days.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card-applications"] });
      form.reset();
      setShowApplicationForm(false);
      setSelectedCard(null);
      setActiveTab("applications");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit application",
        variant: "destructive",
      });
    },
  });

  const updateApplicationMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: number; status: string; notes: string }) => {
      const response = await apiRequest("PATCH", `/api/fuel-card-applications/${id}`, {
        status,
        notes
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Application Updated",
        description: "Fuel card application status has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card-applications"] });
      setShowDetails(false);
      setSelectedApplication(null);
      setNewStatus("");
      setReviewNotes("");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update application",
        variant: "destructive",
      });
    },
  });

  // Authentication removed

  const typedApplications = applications as FuelCardApplication[] || [];
  
  // Filter applications
  const filteredApplications = typedApplications.filter(app => {
    const matchesSearch = app.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         app.contactName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         app.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || app.status === statusFilter;
    const matchesCardType = cardTypeFilter === "all" || app.cardType === cardTypeFilter;
    
    return matchesSearch && matchesStatus && matchesCardType;
  });

  // Stats calculations
  const stats = {
    total: typedApplications.length,
    pending: typedApplications.filter(app => app.status === "pending").length,
    approved: typedApplications.filter(app => app.status === "approved").length,
    rejected: typedApplications.filter(app => app.status === "rejected").length,
    underReview: typedApplications.filter(app => app.status === "under_review").length
  };

  const handleViewDetails = (application: FuelCardApplication) => {
    setSelectedApplication(application);
    setNewStatus(application.status);
    setReviewNotes(application.notes || "");
    setShowDetails(true);
  };

  const handleCardSelect = (cardType: string) => {
    setSelectedCard(cardType);
    form.setValue("cardType", cardType as "base" | "fleet" | "premium");
    setShowApplicationForm(true);
  };

  const onSubmit = (data: FuelCardApplicationForm) => {
    submitApplication.mutate(data);
  };

  const handleUpdateStatus = () => {
    if (!selectedApplication || !newStatus) return;
    
    updateApplicationMutation.mutate({
      id: selectedApplication.id,
      status: newStatus,
      notes: reviewNotes
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'rejected':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'under_review':
        return <AlertCircle className="w-4 h-4 text-blue-600" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-600" />;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav 
          title="TPF Fuel Cards" 
          subtitle="Comprehensive fuel card services and application management"
        />
        
        <main className="flex-1 overflow-auto p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="fuel-cards">Fuel Cards</TabsTrigger>
              <TabsTrigger value="applications">Applications</TabsTrigger>
              <TabsTrigger value="tracking">Advance Tracking</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
            </TabsList>

            <TabsContent value="fuel-cards" className="space-y-6">
              {/* Card Selection */}
              {!showApplicationForm && (
                <>
                  <div className="text-center space-y-4">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">TPF Fleet Fuel Card</h2>
                    <div className="text-gray-600 dark:text-gray-400 max-w-3xl mx-auto space-y-4">
                      <p>
                        The TPF Fleet Card is the best way to manage business fueling, with automatic accounting and reports, easy spending controls, and access to special discounts to help free up cash flow. Apply today and you could save up to 15¢ per gallon in average annual fuel savings!
                      </p>
                      <div className="space-y-2">
                        <p className="font-semibold">• Save up to 15¢ per gallon at network locations</p>
                        <p className="font-semibold">• Plus up to 3¢ per gallon everywhere else</p>
                        <p className="font-semibold">• No monthly fees or contracts</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-center">
                    <div className="w-full max-w-md">
                      {cardTypes.map((card) => (
                        <Card key={card.id} className={`relative ${card.color} hover:shadow-lg transition-shadow cursor-pointer`}>
                          <CardHeader className="pb-4">
                            <div className="flex items-center justify-between">
                              <div className={`p-3 rounded-full ${card.iconBg}`}>
                                <CreditCard className={`w-6 h-6 ${card.iconColor}`} />
                              </div>
                              <div className="text-right">
                                <p className="text-2xl font-bold text-green-600">FREE</p>
                                <p className="text-sm text-gray-500">No Monthly Fee</p>
                              </div>
                            </div>
                            <CardTitle className="text-xl">{card.name}</CardTitle>
                            <CardDescription className="text-gray-600">
                              {card.description}
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            <div className="space-y-2">
                              {card.perks.map((perk, index) => (
                                <div key={index} className="flex items-start gap-2">
                                  <Check className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                                  <span className="text-sm text-gray-700 dark:text-gray-300">{perk}</span>
                                </div>
                              ))}
                            </div>
                            <Button 
                              className="w-full mt-4" 
                              onClick={() => handleCardSelect(card.id)}
                              variant="default"
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Process Application
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* Application Form */}
              {showApplicationForm && selectedCard && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CreditCard className="w-5 h-5" />
                      Apply for {cardTypeLabels[selectedCard as keyof typeof cardTypeLabels]}
                    </CardTitle>
                    <CardDescription>
                      Complete the application form below. All information is secure and confidential.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* Company Information */}
                          <div className="space-y-4">
                            <h3 className="font-semibold text-lg">Company Information</h3>
                            
                            <FormField
                              control={form.control}
                              name="companyName"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Company Name *</FormLabel>
                                  <FormControl>
                                    <Input placeholder="Enter company name" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="businessType"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Business Type *</FormLabel>
                                  <FormControl>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select business type" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="trucking">Trucking Company</SelectItem>
                                        <SelectItem value="logistics">Logistics Provider</SelectItem>
                                        <SelectItem value="owner-operator">Owner-Operator</SelectItem>
                                        <SelectItem value="freight-broker">Freight Broker</SelectItem>
                                        <SelectItem value="other">Other</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="yearsInBusiness"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Years in Business *</FormLabel>
                                  <FormControl>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select years in business" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="less-than-1">Less than 1 year</SelectItem>
                                        <SelectItem value="1-2">1-2 years</SelectItem>
                                        <SelectItem value="3-5">3-5 years</SelectItem>
                                        <SelectItem value="6-10">6-10 years</SelectItem>
                                        <SelectItem value="more-than-10">More than 10 years</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>

                          {/* Contact Information */}
                          <div className="space-y-4">
                            <h3 className="font-semibold text-lg">Contact Information</h3>
                            
                            <FormField
                              control={form.control}
                              name="contactName"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Contact Name *</FormLabel>
                                  <FormControl>
                                    <Input placeholder="Enter contact name" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={form.control}
                              name="email"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Email Address *</FormLabel>
                                  <FormControl>
                                    <Input type="email" placeholder="Enter email address" {...field} />
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
                                  <FormLabel>Phone Number *</FormLabel>
                                  <FormControl>
                                    <Input placeholder="Enter phone number" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* Fleet Information */}
                          <FormField
                            control={form.control}
                            name="fleetSize"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Fleet Size *</FormLabel>
                                <FormControl>
                                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select fleet size" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="1">1 vehicle</SelectItem>
                                      <SelectItem value="2-5">2-5 vehicles</SelectItem>
                                      <SelectItem value="6-10">6-10 vehicles</SelectItem>
                                      <SelectItem value="11-25">11-25 vehicles</SelectItem>
                                      <SelectItem value="26-50">26-50 vehicles</SelectItem>
                                      <SelectItem value="50+">50+ vehicles</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="monthlyFuelSpend"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Monthly Fuel Spend *</FormLabel>
                                <FormControl>
                                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select monthly fuel spend" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="less-than-5000">Less than $5,000</SelectItem>
                                      <SelectItem value="5000-10000">$5,000 - $10,000</SelectItem>
                                      <SelectItem value="10000-25000">$10,000 - $25,000</SelectItem>
                                      <SelectItem value="25000-50000">$25,000 - $50,000</SelectItem>
                                      <SelectItem value="50000+">$50,000+</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        <div className="flex gap-4 pt-6">
                          <Button
                            type="submit"
                            disabled={submitApplication.isPending}
                            className="flex-1"
                          >
                            {submitApplication.isPending ? "Submitting..." : "Submit Application"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setShowApplicationForm(false);
                              setSelectedCard(null);
                              form.reset();
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="overview" className="space-y-6">
              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Applications</p>
                        <p className="text-2xl font-bold">{stats.total}</p>
                      </div>
                      <Users className="h-8 w-8 text-blue-600" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Pending Review</p>
                        <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
                      </div>
                      <Clock className="h-8 w-8 text-yellow-600" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Approved</p>
                        <p className="text-2xl font-bold text-green-600">{stats.approved}</p>
                      </div>
                      <CheckCircle className="h-8 w-8 text-green-600" />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Under Review</p>
                        <p className="text-2xl font-bold text-blue-600">{stats.underReview}</p>
                      </div>
                      <AlertCircle className="h-8 w-8 text-blue-600" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Quick Actions */}
              <Card>
                <CardHeader>
                  <CardTitle>Quick Actions</CardTitle>
                  <CardDescription>Common agent tasks and shortcuts</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Button 
                      onClick={() => setActiveTab("applications")} 
                      className="h-20 flex-col gap-2"
                    >
                      <Eye className="h-6 w-6" />
                      Manage Applications
                    </Button>
                    <Button 
                      variant="outline" 
                      className="h-20 flex-col gap-2"
                      onClick={() => {
                        toast({
                          title: "Contact Client",
                          description: "Opening client communication tools...",
                        });
                        // Navigate to client contact form or open email
                        window.open(`mailto:?subject=Fuel Card Application Follow-up&body=Dear Client,%0A%0AThank you for your interest in our fuel card services. We wanted to follow up on your recent application...%0A%0ABest regards,%0ATrucking Pros Financial Team`, '_blank');
                      }}
                    >
                      <Phone className="h-6 w-6" />
                      Contact Client
                    </Button>
                    <Button 
                      variant="outline" 
                      className="h-20 flex-col gap-2"
                      onClick={() => {
                        // Export applications as CSV
                        const csvContent = "data:text/csv;charset=utf-8," 
                          + "ID,Company,Contact,Email,Card Type,Status,Applied Date,Fleet Size,Monthly Spend\n"
                          + typedApplications.map(app => 
                              `${app.id},"${app.companyName}","${app.contactName}","${app.email}","${app.cardType}","${app.status}","${app.createdAt}","${app.fleetSize}","${app.monthlyFuelSpend}"`
                            ).join("\n");
                        
                        const encodedUri = encodeURI(csvContent);
                        const link = document.createElement("a");
                        link.setAttribute("href", encodedUri);
                        link.setAttribute("download", `fuel-card-applications-report-${new Date().toISOString().split('T')[0]}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        
                        toast({
                          title: "Report Exported",
                          description: "Applications report has been downloaded as CSV file.",
                        });
                      }}
                    >
                      <Download className="h-6 w-6" />
                      Export Reports
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Recent Applications */}
              <Card>
                <CardHeader>
                  <CardTitle>Recent Applications</CardTitle>
                  <CardDescription>Latest fuel card applications requiring attention</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {typedApplications.slice(0, 5).map((app) => (
                      <div key={app.id} className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                            <Fuel className="h-5 w-5 text-blue-600" />
                          </div>
                          <div>
                            <p className="font-medium">{app.companyName}</p>
                            <p className="text-sm text-gray-500">{cardTypeLabels[app.cardType as keyof typeof cardTypeLabels]}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge className={statusColors[app.status as keyof typeof statusColors]}>
                            {app.status.replace('_', ' ')}
                          </Badge>
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => handleViewDetails(app)}
                          >
                            View
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="applications" className="space-y-6">
              {/* Search and Filter Controls */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Application Management
                  </CardTitle>
                  <CardDescription>Search, filter and manage all fuel card applications</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col md:flex-row gap-4 mb-6">
                    <div className="flex-1">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                        <Input
                          placeholder="Search applications..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-10"
                        />
                      </div>
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-48">
                        <Filter className="w-4 h-4 mr-2" />
                        <SelectValue placeholder="Filter by status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Status</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="under_review">Under Review</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={cardTypeFilter} onValueChange={setCardTypeFilter}>
                      <SelectTrigger className="w-48">
                        <CreditCard className="w-4 h-4 mr-2" />
                        <SelectValue placeholder="Filter by card type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Card Types</SelectItem>
                        <SelectItem value="base">TPF Base Card</SelectItem>
                        <SelectItem value="fleet">TPF Fleet Card</SelectItem>
                        <SelectItem value="premium">TPF Premium Card</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* Applications Table */}
              {/* Filters */}
              <Card>
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder="Search by company, contact, or email..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="Filter by status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="under_review">Under Review</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={cardTypeFilter} onValueChange={setCardTypeFilter}>
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="Filter by card type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Card Types</SelectItem>
                        <SelectItem value="base">TPF Base Card</SelectItem>
                        <SelectItem value="fleet">TPF Fleet Card</SelectItem>
                        <SelectItem value="premium">TPF Premium Card</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              {/* Applications Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Fuel Card Applications</CardTitle>
                  <CardDescription>
                    Showing {filteredApplications.length} of {typedApplications.length} applications
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Company</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Card Type</TableHead>
                        <TableHead>Fleet Size</TableHead>
                        <TableHead>Monthly Spend</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Applied</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredApplications.map((app) => (
                        <TableRow key={app.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{app.companyName}</p>
                              <p className="text-sm text-gray-500">{app.businessType}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">{app.contactName}</p>
                              <p className="text-sm text-gray-500">{app.email}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {cardTypeLabels[app.cardType as keyof typeof cardTypeLabels]}
                            </Badge>
                          </TableCell>
                          <TableCell>{app.fleetSize} vehicles</TableCell>
                          <TableCell>${app.monthlyFuelSpend}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {getStatusIcon(app.status)}
                              <Badge className={statusColors[app.status as keyof typeof statusColors]}>
                                {app.status.replace('_', ' ')}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>{formatDate(app.createdAt)}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleViewDetails(app)}
                              >
                                <Eye className="h-4 w-4 mr-1" />
                                View
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="tracking" className="space-y-6">
              <div className="bg-white rounded-lg overflow-hidden">
                <FuelAdvanceTracking />
              </div>
            </TabsContent>

            <TabsContent value="analytics" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Application Analytics</CardTitle>
                  <CardDescription>Insights and trends in fuel card applications</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Status Distribution */}
                    <div className="space-y-4">
                      <h3 className="font-semibold">Status Distribution</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span>Pending</span>
                          <span>{Math.round((stats.pending / stats.total) * 100) || 0}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-yellow-600 h-2 rounded-full" 
                            style={{ width: `${(stats.pending / stats.total) * 100 || 0}%` }}
                          ></div>
                        </div>
                        
                        <div className="flex justify-between">
                          <span>Approved</span>
                          <span>{Math.round((stats.approved / stats.total) * 100) || 0}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-green-600 h-2 rounded-full" 
                            style={{ width: `${(stats.approved / stats.total) * 100 || 0}%` }}
                          ></div>
                        </div>

                        <div className="flex justify-between">
                          <span>Under Review</span>
                          <span>{Math.round((stats.underReview / stats.total) * 100) || 0}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-600 h-2 rounded-full" 
                            style={{ width: `${(stats.underReview / stats.total) * 100 || 0}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>

                    {/* Card Type Preferences */}
                    <div className="space-y-4">
                      <h3 className="font-semibold">Popular Card Types</h3>
                      <div className="space-y-3">
                        {Object.entries(cardTypeLabels).map(([type, label]) => {
                          const count = typedApplications.filter(app => app.cardType === type).length;
                          const percentage = Math.round((count / stats.total) * 100) || 0;
                          return (
                            <div key={type} className="flex items-center justify-between">
                              <span>{label}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-500">{count}</span>
                                <Badge variant="outline">{percentage}%</Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Analytics Tab with enhanced functionality */}
            <TabsContent value="analytics" className="space-y-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center">
                      <div className="p-2 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                        <Users className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Applications</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">
                          {typedApplications?.length || 0}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center">
                      <div className="p-2 bg-yellow-100 dark:bg-yellow-900/20 rounded-lg">
                        <Clock className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Pending Review</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">
                          {typedApplications?.filter(app => app.status === 'pending' || app.status === 'under_review').length || 0}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center">
                      <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded-lg">
                        <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Approved</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">
                          {typedApplications?.filter(app => app.status === 'approved').length || 0}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center">
                      <div className="p-2 bg-red-100 dark:bg-red-900/20 rounded-lg">
                        <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                      </div>
                      <div className="ml-4">
                        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Rejected</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">
                          {typedApplications?.filter(app => app.status === 'rejected').length || 0}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Agent Tools and Communication */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <MessageSquare className="w-5 h-5" />
                      Client Communication
                    </CardTitle>
                    <CardDescription>Quick communication tools and templates</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={() => {
                        toast({
                          title: "Contact Client",
                          description: "Opening client communication tools...",
                        });
                        window.open(`mailto:?subject=Fuel Card Application Follow-up&body=Dear Client,%0A%0AThank you for your interest in our fuel card services. We wanted to follow up on your recent application...%0A%0ABest regards,%0ATrucking Pros Financial Team`, '_blank');
                      }}
                    >
                      <Mail className="mr-2 h-4 w-4" />
                      Send Follow-up Email
                    </Button>
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={() => {
                        const csvContent = "data:text/csv;charset=utf-8," 
                          + "ID,Company,Contact,Email,Card Type,Status,Applied Date,Fleet Size,Monthly Spend\n"
                          + (typedApplications?.map(app => 
                              `${app.id},"${app.companyName}","${app.contactName}","${app.email}","${app.cardType}","${app.status}","${app.createdAt}","${app.fleetSize}","${app.monthlyFuelSpend}"`
                            ).join("\n") || "");
                        
                        const encodedUri = encodeURI(csvContent);
                        const link = document.createElement("a");
                        link.setAttribute("href", encodedUri);
                        link.setAttribute("download", `fuel-card-applications-report-${new Date().toISOString().split('T')[0]}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        
                        toast({
                          title: "Report Exported",
                          description: "Applications report has been downloaded as CSV file.",
                        });
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Export Applications Report
                    </Button>
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={() => setActiveTab("fuel-cards")}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Create New Application
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Application Status Distribution</CardTitle>
                    <CardDescription>Visual breakdown of current application statuses</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {[
                        { status: 'pending', label: 'Pending', color: 'bg-yellow-500' },
                        { status: 'under_review', label: 'Under Review', color: 'bg-blue-500' },
                        { status: 'approved', label: 'Approved', color: 'bg-green-500' },
                        { status: 'rejected', label: 'Rejected', color: 'bg-red-500' }
                      ].map(({ status, label, color }) => {
                        const count = typedApplications?.filter(app => app.status === status).length || 0;
                        const total = typedApplications?.length || 1;
                        const percentage = Math.round((count / total) * 100);
                        
                        return (
                          <div key={status} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full ${color}`}></div>
                              <span className="text-sm font-medium">{label}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-600">{count}</span>
                              <span className="text-xs text-gray-400">({percentage}%)</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}
