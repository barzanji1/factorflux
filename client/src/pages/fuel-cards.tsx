import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  CreditCard, 
  Fuel, 
  MapPin, 
  DollarSign, 
  Hotel, 
  Truck, 
  Star,
  Check,
  Plus,
  Eye,
  Clock,
  CheckCircle,
  XCircle
} from "lucide-react";

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

type FuelCardApplication = z.infer<typeof fuelCardApplicationSchema>;

const cardTypes = [
  {
    id: "base",
    name: "TPF Base Card",
    monthlyFee: 0,
    description: "Essential fuel savings for small carriers",
    perks: [
      "2¢/gallon discount at 5,000+ locations",
      "Basic purchase controls",
      "Monthly spending reports",
      "24/7 customer support",
      "Complimentary service - no fees"
    ],
    color: "bg-blue-50 border-blue-200",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600"
  },
  {
    id: "fleet",
    name: "TPF Fleet Card",
    monthlyFee: 0,
    description: "Advanced features for growing carriers",
    perks: [
      "4¢/gallon discount at 8,000+ locations",
      "Advanced purchase controls & limits",
      "Real-time transaction alerts",
      "Detailed reporting & analytics",
      "Driver ID verification",
      "Maintenance tracking integration",
      "10% discount on lodging at partner hotels",
      "Complimentary service - no fees"
    ],
    color: "bg-green-50 border-green-200",
    iconBg: "bg-green-100",
    iconColor: "text-green-600",
    popular: true
  },
  {
    id: "premium",
    name: "TPF Premium Card",
    monthlyFee: 0,
    description: "Premium benefits for established carriers",
    perks: [
      "6¢/gallon discount at 12,000+ locations",
      "Comprehensive fleet management tools",
      "Dedicated account manager",
      "Priority customer support",
      "Cash back rewards program (1% on fuel)",
      "15% discount on lodging",
      "Free roadside assistance",
      "Advanced fraud protection",
      "Custom reporting & API access",
      "Complimentary service - no fees"
    ],
    color: "bg-purple-50 border-purple-200",
    iconBg: "bg-purple-100",
    iconColor: "text-purple-600"
  }
];

export default function FuelCards() {
  // All hooks at the top - no conditional hook calls
  const { isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [showApplication, setShowApplication] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<any>(null);
  const [showApplicationDetails, setShowApplicationDetails] = useState(false);

  const form = useForm<FuelCardApplication>({
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

  const { data: applications, isLoading: applicationsLoading } = useQuery({
    queryKey: ["/api/fuel-card-applications"],
  });

  const submitApplication = useMutation({
    mutationFn: async (data: FuelCardApplication) => {
      const response = await apiRequest("POST", "/api/fuel-card-applications", data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Application Submitted",
        description: "Your fuel card application has been submitted successfully. We'll review it within 2-3 business days.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card-applications"] });
      form.reset();
      setShowApplication(false);
      setSelectedCard(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to submit application",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/api/login";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const handleCardSelect = (cardType: string) => {
    setSelectedCard(cardType);
    form.setValue("cardType", cardType as "base" | "fleet" | "premium");
    setShowApplication(true);
  };

  const onSubmit = (data: FuelCardApplication) => {
    submitApplication.mutate(data);
  };

  const handleViewApplication = (application: any) => {
    setSelectedApplication(application);
    setShowApplicationDetails(true);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'rejected':
        return <XCircle className="w-4 h-4 text-red-600" />;
      default:
        return <Clock className="w-4 h-4 text-yellow-600" />;
    }
  };

  const typedApplications = applications as Array<{
    id: number;
    cardType: string;
    status: string;
    createdAt: string;
  }> | undefined;

  // Loading state
  if (isLoading || applicationsLoading) {
    return (
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopNav title="TPF Fuel Card Services" subtitle="Loading..." />
          <main className="flex-1 overflow-auto p-6">
            <div className="min-h-screen flex items-center justify-center">
              <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav 
          title="TPF Fuel Card Services" 
          subtitle="Complimentary fuel cards for our carriers with exclusive savings and fleet management benefits"
        />
        
        <main className="flex-1 overflow-auto p-6">
          <div className="space-y-6">
            {/* Header */}
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">TPF Fuel Card Services</h1>
              <p className="mt-2 text-gray-600 dark:text-gray-400">
                Complimentary fuel cards for our carriers with exclusive savings and fleet management benefits
              </p>
            </div>

            {/* Current Applications Status */}
            {typedApplications && typedApplications.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5" />
                    Your Applications
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {typedApplications.map((app) => (
                      <div key={app.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                        <div className="flex items-center gap-3">
                          {getStatusIcon(app.status)}
                          <div>
                            <p className="font-medium">{cardTypes.find(c => c.id === app.cardType)?.name}</p>
                            <p className="text-sm text-gray-500">Applied {new Date(app.createdAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={
                            app.status === 'approved' ? 'default' : 
                            app.status === 'rejected' ? 'destructive' : 
                            'secondary'
                          }>
                            {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
                          </Badge>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewApplication(app)}
                            className="h-8 px-2 text-xs"
                          >
                            <Eye className="w-3 h-3 mr-1" />
                            View
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Card Options */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {cardTypes.map((card) => (
                <Card key={card.id} className={`relative ${card.color} hover:shadow-lg transition-shadow cursor-pointer`}>
                  {card.popular && (
                    <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                      <Badge className="bg-orange-500 text-white px-3 py-1">
                        <Star className="w-3 h-3 mr-1" />
                        Most Popular
                      </Badge>
                    </div>
                  )}
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
                      variant={card.popular ? "default" : "outline"}
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Apply for {card.name}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </main>
      </div>

      {/* Application Form Dialog */}
      <Dialog open={showApplication} onOpenChange={setShowApplication}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Apply for {selectedCard && cardTypes.find(c => c.id === selectedCard)?.name}
            </DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="companyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter your company name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="contactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter contact person name" {...field} />
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
                    <FormLabel>Email</FormLabel>
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
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter phone number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fleetSize"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fleet Size</FormLabel>
                    <FormControl>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select fleet size" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1-5">1-5 vehicles</SelectItem>
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
                    <FormLabel>Monthly Fuel Spend</FormLabel>
                    <FormControl>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select monthly spend" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Under $5,000">Under $5,000</SelectItem>
                          <SelectItem value="$5,000-$15,000">$5,000-$15,000</SelectItem>
                          <SelectItem value="$15,000-$30,000">$15,000-$30,000</SelectItem>
                          <SelectItem value="$30,000-$50,000">$30,000-$50,000</SelectItem>
                          <SelectItem value="Over $50,000">Over $50,000</SelectItem>
                        </SelectContent>
                      </Select>
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
                    <FormLabel>Business Type</FormLabel>
                    <FormControl>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select business type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="owner-operator">Owner-Operator</SelectItem>
                          <SelectItem value="small-fleet">Small Fleet (2-10 trucks)</SelectItem>
                          <SelectItem value="medium-fleet">Medium Fleet (11-50 trucks)</SelectItem>
                          <SelectItem value="large-fleet">Large Fleet (50+ trucks)</SelectItem>
                          <SelectItem value="logistics-company">Logistics Company</SelectItem>
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
                    <FormLabel>Years in Business</FormLabel>
                    <FormControl>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select years in business" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Less than 1 year">Less than 1 year</SelectItem>
                          <SelectItem value="1-2 years">1-2 years</SelectItem>
                          <SelectItem value="3-5 years">3-5 years</SelectItem>
                          <SelectItem value="6-10 years">6-10 years</SelectItem>
                          <SelectItem value="More than 10 years">More than 10 years</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-2 pt-4">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setShowApplication(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={submitApplication.isPending}
                  className="flex-1"
                >
                  {submitApplication.isPending ? "Submitting..." : "Submit Application"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Application Details Dialog */}
      <Dialog open={showApplicationDetails} onOpenChange={setShowApplicationDetails}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Application Details</DialogTitle>
          </DialogHeader>
          {selectedApplication && (
            <>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white">Card Type</h4>
                  <p className="text-gray-600 dark:text-gray-400">
                    {cardTypes.find(c => c.id === selectedApplication.cardType)?.name}
                  </p>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white">Company</h4>
                  <p className="text-gray-600 dark:text-gray-400">{selectedApplication.companyName}</p>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white">Status</h4>
                  <div className="flex items-center gap-2">
                    {getStatusIcon(selectedApplication.status)}
                    <Badge variant={
                      selectedApplication.status === 'approved' ? 'default' : 
                      selectedApplication.status === 'rejected' ? 'destructive' : 
                      'secondary'
                    }>
                      {selectedApplication.status.charAt(0).toUpperCase() + selectedApplication.status.slice(1)}
                    </Badge>
                  </div>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white">Applied On</h4>
                  <p className="text-gray-600 dark:text-gray-400">
                    {new Date(selectedApplication.createdAt).toLocaleDateString()}
                  </p>
                </div>
                {selectedApplication.status === 'approved' && (
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <p className="text-green-800 dark:text-green-200 text-sm">
                      🎉 Congratulations! Your application has been approved. You'll receive your fuel cards within 5-7 business days.
                    </p>
                  </div>
                )}
                {selectedApplication.status === 'rejected' && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-red-800 dark:text-red-200 text-sm">
                      Unfortunately, your application was not approved at this time. Please contact support for more information.
                    </p>
                  </div>
                )}
                {selectedApplication.status === 'pending' && (
                  <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                    <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                      Your application is under review. We'll notify you within 2-3 business days.
                    </p>
                  </div>
                )}
              </div>
              <div className="flex justify-end pt-4">
                <Button
                  variant="outline"
                  onClick={() => setShowApplicationDetails(false)}
                >
                  Close
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}