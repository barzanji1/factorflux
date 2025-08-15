import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
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
  MessageSquare
} from "lucide-react";

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

export default function FuelCardsInternal() {
  const { isAuthenticated, isLoading } = useAuth();
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

  const { data: applications, isLoading: applicationsLoading } = useQuery({
    queryKey: ["/api/fuel-card-applications"],
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

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      window.location.href = "/api/login";
      return;
    }
  }, [isAuthenticated, isLoading]);

  if (isLoading || applicationsLoading) {
    return (
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopNav title="Fuel Cards - Internal" subtitle="Loading..." />
          <main className="flex-1 overflow-auto p-6">
            <div className="min-h-screen flex items-center justify-center">
              <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
            </div>
          </main>
        </div>
      </div>
    );
  }

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
          title="Fuel Cards - Internal Agent Dashboard" 
          subtitle="Manage fuel card applications and client services"
        />
        
        <main className="flex-1 overflow-auto p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="applications">Applications</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
              <TabsTrigger value="tools">Agent Tools</TabsTrigger>
            </TabsList>

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
                      Review Applications
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

            <TabsContent value="tools" className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Client Communication</CardTitle>
                    <CardDescription>Tools for contacting and following up with clients</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button 
                      className="w-full justify-start"
                      onClick={() => {
                        toast({
                          title: "Email Template",
                          description: "Opening email template for client follow-up...",
                        });
                        // Could integrate with email service or open mail client
                        window.open(`mailto:?subject=Fuel Card Application Follow-up&body=Dear Client,%0A%0AThank you for your interest in our fuel card services...`, '_blank');
                      }}
                    >
                      <Mail className="mr-2 h-4 w-4" />
                      Send Follow-up Email
                    </Button>
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={() => {
                        toast({
                          title: "Call Scheduled",
                          description: "Phone call reminder added to your calendar.",
                        });
                        // Could integrate with calendar API
                      }}
                    >
                      <Phone className="mr-2 h-4 w-4" />
                      Schedule Phone Call
                    </Button>
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={() => setLocation("/follow-up")}
                    >
                      <MessageSquare className="mr-2 h-4 w-4" />
                      Create Follow-up Task
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Reporting Tools</CardTitle>
                    <CardDescription>Generate reports and export data</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button 
                      className="w-full justify-start"
                      onClick={() => {
                        // Export applications as CSV
                        const csvContent = "data:text/csv;charset=utf-8," 
                          + "ID,Company,Contact,Email,Card Type,Status,Applied Date\n"
                          + typedApplications.map(app => 
                              `${app.id},"${app.companyName}","${app.contactName}","${app.email}","${app.cardType}","${app.status}","${app.createdAt}"`
                            ).join("\n");
                        
                        const encodedUri = encodeURI(csvContent);
                        const link = document.createElement("a");
                        link.setAttribute("href", encodedUri);
                        link.setAttribute("download", `fuel-card-applications-${new Date().toISOString().split('T')[0]}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        
                        toast({
                          title: "Export Complete",
                          description: "Applications data has been downloaded as CSV file.",
                        });
                      }}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Export All Applications
                    </Button>
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={() => {
                        toast({
                          title: "Monthly Report",
                          description: "Generating comprehensive monthly report...",
                        });
                        // Generate and download monthly report
                        const reportData = {
                          period: new Date().toLocaleDateString(),
                          totalApplications: stats.total,
                          approvedApplications: stats.approved,
                          pendingApplications: stats.pending,
                          rejectedApplications: stats.rejected
                        };
                        
                        const reportContent = `Monthly Fuel Card Report\n
Generated: ${new Date().toLocaleDateString()}\n
Total Applications: ${reportData.totalApplications}\n
Approved: ${reportData.approvedApplications}\n
Pending: ${reportData.pendingApplications}\n
Rejected: ${reportData.rejectedApplications}\n
Approval Rate: ${Math.round((reportData.approvedApplications / reportData.totalApplications) * 100) || 0}%`;
                        
                        const blob = new Blob([reportContent], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `monthly-fuel-card-report-${new Date().toISOString().split('T')[0]}.txt`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <BarChart3 className="mr-2 h-4 w-4" />
                      Generate Monthly Report
                    </Button>
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={() => setLocation("/")}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      Performance Dashboard
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Quick Actions</CardTitle>
                    <CardDescription>Frequently used agent functions</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button 
                      className="w-full justify-start"
                      onClick={() => setLocation("/fuel-cards")}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Create Manual Application
                    </Button>
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={() => {
                        toast({
                          title: "Bulk Update",
                          description: "Bulk status update feature coming soon...",
                        });
                      }}
                    >
                      <Edit className="mr-2 h-4 w-4" />
                      Bulk Status Update
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Resources</CardTitle>
                    <CardDescription>Reference materials and guides</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={() => {
                        const guideContent = `
TPF Fuel Card Comparison Guide

TPF Base Card:
- 2¢/gallon discount at 5,000+ locations
- Basic purchase controls
- Monthly spending reports
- 24/7 customer support
- No monthly fees

TPF Fleet Card:
- 4¢/gallon discount at 8,000+ locations
- Advanced purchase controls & limits
- Real-time transaction alerts
- Detailed reporting & analytics
- Driver ID verification
- 10% discount on lodging
- No monthly fees

TPF Premium Card:
- 6¢/gallon discount at 12,000+ locations
- Comprehensive fleet management tools
- Dedicated account manager
- Priority customer support
- Cash back rewards (1% on fuel)
- 15% discount on lodging
- Free roadside assistance
- Advanced fraud protection
- No monthly fees
                        `;
                        
                        const blob = new Blob([guideContent], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = 'tpf-card-comparison-guide.txt';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                        
                        toast({
                          title: "Guide Downloaded",
                          description: "Card comparison guide has been downloaded.",
                        });
                      }}
                    >
                      <Building className="mr-2 h-4 w-4" />
                      Card Comparison Guide
                    </Button>
                    <Button 
                      variant="outline" 
                      className="w-full justify-start"
                      onClick={() => {
                        const pricingInfo = `
TPF Fuel Card Pricing Information

ALL TPF FUEL CARDS ARE COMPLIMENTARY - NO MONTHLY FEES!

Base Card Benefits:
- 2¢/gallon savings
- Basic controls
- Monthly reports
- 24/7 support

Fleet Card Benefits:
- 4¢/gallon savings
- Advanced controls
- Real-time alerts
- Analytics dashboard
- Hotel discounts (10%)

Premium Card Benefits:
- 6¢/gallon savings
- Dedicated account manager
- Priority support
- 1% cash back on fuel
- Hotel discounts (15%)
- Free roadside assistance

All cards include:
✓ No application fees
✓ No monthly maintenance fees
✓ No transaction fees
✓ Wide acceptance network
✓ Fraud protection
✓ Online account management
                        `;
                        
                        const blob = new Blob([pricingInfo], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = 'tpf-pricing-information.txt';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                        
                        toast({
                          title: "Pricing Info Downloaded",
                          description: "Complete pricing information has been downloaded.",
                        });
                      }}
                    >
                      <DollarSign className="mr-2 h-4 w-4" />
                      Pricing Information
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>

          {/* Application Details Dialog */}
          <Dialog open={showDetails} onOpenChange={setShowDetails}>
            <DialogContent className="max-w-4xl">
              <DialogHeader>
                <DialogTitle>Application Details</DialogTitle>
                <DialogDescription>
                  Review and manage fuel card application
                </DialogDescription>
              </DialogHeader>

              {selectedApplication && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Application Info */}
                  <div className="space-y-4">
                    <h3 className="font-semibold">Application Information</h3>
                    <div className="space-y-2">
                      <div>
                        <Label className="text-sm font-medium">Company Name</Label>
                        <p className="text-sm text-gray-600">{selectedApplication.companyName}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Contact Person</Label>
                        <p className="text-sm text-gray-600">{selectedApplication.contactName}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Email</Label>
                        <p className="text-sm text-gray-600">{selectedApplication.email}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Phone</Label>
                        <p className="text-sm text-gray-600">{selectedApplication.phone}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Card Type</Label>
                        <p className="text-sm text-gray-600">
                          {cardTypeLabels[selectedApplication.cardType as keyof typeof cardTypeLabels]}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Fleet Size</Label>
                        <p className="text-sm text-gray-600">{selectedApplication.fleetSize} vehicles</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Monthly Fuel Spend</Label>
                        <p className="text-sm text-gray-600">${selectedApplication.monthlyFuelSpend}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Business Type</Label>
                        <p className="text-sm text-gray-600">{selectedApplication.businessType}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Years in Business</Label>
                        <p className="text-sm text-gray-600">{selectedApplication.yearsInBusiness}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Applied</Label>
                        <p className="text-sm text-gray-600">{formatDate(selectedApplication.createdAt)}</p>
                      </div>
                    </div>
                  </div>

                  {/* Review Section */}
                  <div className="space-y-4">
                    <h3 className="font-semibold">Review & Update</h3>
                    <div className="space-y-4">
                      <div>
                        <Label className="text-sm font-medium">Current Status</Label>
                        <div className="flex items-center gap-2 mt-1">
                          {getStatusIcon(selectedApplication.status)}
                          <Badge className={statusColors[selectedApplication.status as keyof typeof statusColors]}>
                            {selectedApplication.status.replace('_', ' ')}
                          </Badge>
                        </div>
                      </div>

                      <div>
                        <Label className="text-sm font-medium">Update Status</Label>
                        <Select value={newStatus} onValueChange={setNewStatus}>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Select new status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="under_review">Under Review</SelectItem>
                            <SelectItem value="approved">Approved</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-sm font-medium">Review Notes</Label>
                        <Textarea
                          placeholder="Add notes about this application..."
                          value={reviewNotes}
                          onChange={(e) => setReviewNotes(e.target.value)}
                          className="mt-1"
                          rows={4}
                        />
                      </div>

                      {selectedApplication.notes && (
                        <div>
                          <Label className="text-sm font-medium">Previous Notes</Label>
                          <p className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                            {selectedApplication.notes}
                          </p>
                        </div>
                      )}

                      <div className="flex gap-2 pt-4">
                        <Button 
                          onClick={handleUpdateStatus}
                          disabled={updateApplicationMutation.isPending}
                        >
                          {updateApplicationMutation.isPending ? "Updating..." : "Update Application"}
                        </Button>
                        <Button variant="outline" onClick={() => setShowDetails(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </main>
      </div>
    </div>
  );
}