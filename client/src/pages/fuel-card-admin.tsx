import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Button,
} from "@/components/ui/button";
import {
  Badge,
} from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
  Textarea,
} from "@/components/ui/textarea";
import { 
  CreditCard, 
  Eye, 
  Check, 
  X, 
  Clock,
  FileText,
  Building2,
  Phone,
  Mail,
  Truck,
  DollarSign
} from "lucide-react";
import DocumentViewer from "@/components/document-viewer";
import type { FuelCardApplication } from "@shared/schema";

const cardTypeNames = {
  base: "TPF Base Card",
  fleet: "TPF Fleet Card", 
  premium: "TPF Premium Card"
};

const statusColors = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  approved: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200"
};

export default function FuelCardAdmin() {
  const [selectedApplication, setSelectedApplication] = useState<FuelCardApplication | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [newStatus, setNewStatus] = useState<string>("");
  const [reviewNotes, setReviewNotes] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  

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

  if (applicationsLoading) {
    return (
      <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <TopNav title="Fuel Card Applications" subtitle="Loading..." />
          <main className="flex-1 overflow-auto p-6">
            <div className="min-h-screen flex items-center justify-center">
              <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  const typedApplications = (applications as FuelCardApplication[]) || [];

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav 
          title="Fuel Card Applications" 
          subtitle="Manage and review TPF fuel card applications from carriers"
        />
        
        <main className="flex-1 overflow-auto p-6">
          <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Fuel Card Applications</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Manage and review TPF fuel card applications from carriers
        </p>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Applications</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{typedApplications.length}</p>
              </div>
              <CreditCard className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Pending Review</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {typedApplications.filter(app => app.status === 'pending').length}
                </p>
              </div>
              <Clock className="w-8 h-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Approved</p>
                <p className="text-2xl font-bold text-green-600">
                  {typedApplications.filter(app => app.status === 'approved').length}
                </p>
              </div>
              <Check className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Rejected</p>
                <p className="text-2xl font-bold text-red-600">
                  {typedApplications.filter(app => app.status === 'rejected').length}
                </p>
              </div>
              <X className="w-8 h-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Applications Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Applications</CardTitle>
          <CardDescription>
            Review and manage fuel card applications from carriers
          </CardDescription>
        </CardHeader>
        <CardContent>
          {typedApplications.length === 0 ? (
            <div className="text-center py-8">
              <CreditCard className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No fuel card applications yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Card Type</TableHead>
                    <TableHead>Fleet Size</TableHead>
                    <TableHead>Monthly Spend</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Applied Date</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {typedApplications.map((application) => (
                    <TableRow key={application.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-gray-500" />
                          <div>
                            <p className="font-medium">{application.companyName}</p>
                            <p className="text-sm text-gray-500">{application.businessType}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{application.contactName}</p>
                          <div className="flex items-center gap-1 text-sm text-gray-500">
                            <Mail className="w-3 h-3" />
                            {application.email}
                          </div>
                          <div className="flex items-center gap-1 text-sm text-gray-500">
                            <Phone className="w-3 h-3" />
                            {application.phone}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {cardTypeNames[application.cardType as keyof typeof cardTypeNames]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Truck className="w-4 h-4 text-gray-500" />
                          {application.fleetSize}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <DollarSign className="w-4 h-4 text-gray-500" />
                          {application.monthlyFuelSpend}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusColors[application.status as keyof typeof statusColors]}>
                          {application.status.charAt(0).toUpperCase() + application.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(application.createdAt!).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewDetails(application)}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            Review
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedApplication(application);
                              setShowDocuments(true);
                            }}
                          >
                            <FileText className="w-4 h-4 mr-1" />
                            Docs
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Application Details Dialog */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedApplication && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5" />
                  Application Details - {selectedApplication.companyName}
                </DialogTitle>
              </DialogHeader>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Company Information */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Company Information</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <label className="text-sm font-medium text-gray-600">Company Name</label>
                      <p className="text-sm">{selectedApplication.companyName}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Business Type</label>
                      <p className="text-sm">{selectedApplication.businessType}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Years in Business</label>
                      <p className="text-sm">{selectedApplication.yearsInBusiness}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Fleet Size</label>
                      <p className="text-sm">{selectedApplication.fleetSize}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Monthly Fuel Spend</label>
                      <p className="text-sm">{selectedApplication.monthlyFuelSpend}</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Contact Information */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Contact Information</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <label className="text-sm font-medium text-gray-600">Contact Name</label>
                      <p className="text-sm">{selectedApplication.contactName}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Email</label>
                      <p className="text-sm">{selectedApplication.email}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Phone</label>
                      <p className="text-sm">{selectedApplication.phone}</p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Card Type Requested</label>
                      <p className="text-sm">
                        {cardTypeNames[selectedApplication.cardType as keyof typeof cardTypeNames]}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-gray-600">Application Date</label>
                      <p className="text-sm">{new Date(selectedApplication.createdAt!).toLocaleDateString()}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Review Section */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Review Application</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-600">Status</label>
                    <Select value={newStatus} onValueChange={setNewStatus}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium text-gray-600">Review Notes</label>
                    <Textarea
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      placeholder="Add notes about this application review..."
                      className="mt-1"
                      rows={3}
                    />
                  </div>

                  {selectedApplication.notes && (
                    <div>
                      <label className="text-sm font-medium text-gray-600">Previous Notes</label>
                      <p className="text-sm bg-gray-50 dark:bg-gray-800 p-3 rounded-md mt-1">
                        {selectedApplication.notes}
                      </p>
                    </div>
                  )}

                  <div className="flex justify-end space-x-2 pt-4">
                    <Button variant="outline" onClick={() => setShowDetails(false)}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleUpdateStatus}
                      disabled={updateApplicationMutation.isPending}
                    >
                      {updateApplicationMutation.isPending ? "Updating..." : "Update Application"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </DialogContent>
      </Dialog>

            {/* Document Viewer */}
            <DocumentViewer
              isOpen={showDocuments}
              onClose={() => setShowDocuments(false)}
              entityType="fuel_card_application"
              entityId={selectedApplication?.id}
            />
          </div>
        </main>
      </div>
    </div>
  );
}