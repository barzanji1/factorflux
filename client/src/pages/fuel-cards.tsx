import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  Input,
} from "@/components/ui/input";
import {
  Button,
} from "@/components/ui/button";
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
import {
  Badge,
} from "@/components/ui/badge";
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
  Plus
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
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [showApplication, setShowApplication] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  const { data: applications, isLoading } = useQuery({
    queryKey: ["/api/fuel-card-applications"],
  });

  // Type the applications data properly
  const typedApplications = applications as Array<{
    id: number;
    cardType: string;
    status: string;
    createdAt: string;
  }> | undefined;

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

  const handleCardSelect = (cardType: string) => {
    setSelectedCard(cardType);
    form.setValue("cardType", cardType as "base" | "fleet" | "premium");
    setShowApplication(true);
  };

  const onSubmit = (data: FuelCardApplication) => {
    submitApplication.mutate(data);
  };

  return (
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
                  <div>
                    <p className="font-medium">{cardTypes.find(c => c.id === app.cardType)?.name}</p>
                    <p className="text-sm text-gray-500">Applied {new Date(app.createdAt).toLocaleDateString()}</p>
                  </div>
                  <Badge variant={
                    app.status === 'approved' ? 'default' : 
                    app.status === 'rejected' ? 'destructive' : 
                    'secondary'
                  }>
                    {app.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Card Selection */}
      <div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Choose Your TPF Fuel Card</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {cardTypes.map((card) => (
            <Card key={card.id} className={`relative ${card.color} hover:shadow-lg transition-shadow cursor-pointer`}>
              {card.popular && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <Badge className="bg-orange-500 hover:bg-orange-600 text-white">
                    Most Popular
                  </Badge>
                </div>
              )}
              <CardHeader className="text-center">
                <div className={`w-16 h-16 ${card.iconBg} rounded-full flex items-center justify-center mx-auto mb-3`}>
                  <CreditCard className={`w-8 h-8 ${card.iconColor}`} />
                </div>
                <CardTitle className="text-xl">{card.name}</CardTitle>
                <CardDescription className="text-sm">{card.description}</CardDescription>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  Complimentary
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Separator />
                <div className="space-y-2">
                  {card.perks.map((perk, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">{perk}</span>
                    </div>
                  ))}
                </div>
                <Button 
                  onClick={() => handleCardSelect(card.id)}
                  className="w-full mt-4"
                  variant={card.popular ? "default" : "outline"}
                >
                  Apply for {card.name}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Application Dialog */}
      <Dialog open={showApplication} onOpenChange={setShowApplication}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5" />
              Apply for {selectedCard && cardTypes.find(c => c.id === selectedCard)?.name}
            </DialogTitle>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This complimentary fuel card service is exclusively available to TPF carriers
            </p>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="companyName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Name</FormLabel>
                      <FormControl>
                        <Input placeholder="ABC Transport Co" {...field} />
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
                        <Input placeholder="John Smith" {...field} />
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
                        <Input type="email" placeholder="john@abctransport.com" {...field} />
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
                        <Input placeholder="(555) 123-4567" {...field} />
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
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select fleet size" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="1-5">1-5 vehicles</SelectItem>
                          <SelectItem value="6-15">6-15 vehicles</SelectItem>
                          <SelectItem value="16-50">16-50 vehicles</SelectItem>
                          <SelectItem value="51-100">51-100 vehicles</SelectItem>
                          <SelectItem value="100+">100+ vehicles</SelectItem>
                        </SelectContent>
                      </Select>
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
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select monthly spend" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="<$5000">Less than $5,000</SelectItem>
                          <SelectItem value="$5000-$15000">$5,000 - $15,000</SelectItem>
                          <SelectItem value="$15000-$50000">$15,000 - $50,000</SelectItem>
                          <SelectItem value="$50000+">$50,000+</SelectItem>
                        </SelectContent>
                      </Select>
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
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select business type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="owner-operator">Owner Operator</SelectItem>
                          <SelectItem value="small-fleet">Small Fleet (2-10 trucks)</SelectItem>
                          <SelectItem value="medium-fleet">Medium Fleet (11-50 trucks)</SelectItem>
                          <SelectItem value="large-fleet">Large Fleet (50+ trucks)</SelectItem>
                          <SelectItem value="broker">Freight Broker</SelectItem>
                          <SelectItem value="3pl">3PL Provider</SelectItem>
                        </SelectContent>
                      </Select>
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
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select years" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="<1">Less than 1 year</SelectItem>
                          <SelectItem value="1-3">1-3 years</SelectItem>
                          <SelectItem value="4-10">4-10 years</SelectItem>
                          <SelectItem value="10+">10+ years</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex justify-end space-x-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowApplication(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={submitApplication.isPending}>
                  {submitApplication.isPending ? "Submitting..." : "Submit Application"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}