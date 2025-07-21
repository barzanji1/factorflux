import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Clock, FileText, UserPlus, Upload, CheckCircle, Eye, Trash2 } from "lucide-react";
import DocumentViewer from "@/components/document-viewer";
import type { Activity as ActivityType } from "@shared/schema";

export default function Activities() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();
  const [showDocuments, setShowDocuments] = useState(false);
  const [selectedEntityType, setSelectedEntityType] = useState<string>("");
  const [selectedEntityId, setSelectedEntityId] = useState<number | undefined>();
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

  const { data: activities = [], isLoading: activitiesLoading } = useQuery<ActivityType[]>({
    queryKey: ["/api/activities"],
    enabled: isAuthenticated,
  });

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "document_uploaded":
        return <Upload className="w-4 h-4 text-blue-600" />;
      case "client_created":
        return <UserPlus className="w-4 h-4 text-green-600" />;
      case "invoice_created":
        return <FileText className="w-4 h-4 text-purple-600" />;
      case "invoice_approved":
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      default:
        return <Activity className="w-4 h-4 text-gray-600" />;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case "document_uploaded":
        return "bg-blue-100 text-blue-800";
      case "client_created":
        return "bg-green-100 text-green-800";
      case "invoice_created":
        return "bg-purple-100 text-purple-800";
      case "invoice_approved":
        return "bg-green-100 text-green-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const formatActivityType = (type: string) => {
    return type.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  };

  const handleViewDocuments = (activity: ActivityType) => {
    if (activity.entityType && activity.entityId) {
      setSelectedEntityType(activity.entityType);
      setSelectedEntityId(activity.entityId);
      setShowDocuments(true);
    }
  };

  const isDocumentActivity = (type: string) => {
    return type === "document_uploaded" || type.includes("document");
  };

  const deleteDocument = useMutation({
    mutationFn: async (documentId: number) => {
      const response = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Document not found - it may have already been deleted");
        }
        throw new Error(`Failed to delete document: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: (_, documentId) => {
      // Immediately update the activities list to reflect the deletion
      queryClient.setQueryData(["/api/activities"], (oldData: ActivityType[] | undefined) => {
        if (!oldData) return oldData;
        return oldData.filter(activity => 
          !(activity.entityType === 'document' && activity.entityId === documentId)
        );
      });
      
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
      
      toast({
        title: "Success",
        description: "Document deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete document",
        variant: "destructive",
      });
    },
  });

  const handleDeleteDocument = async (activity: ActivityType) => {
    if (!activity.entityId || activity.entityType !== 'document') return;
    
    // Prevent multiple deletion attempts
    if (deleteDocument.isPending) return;
    
    const confirmMessage = `Are you sure you want to delete this document? This action cannot be undone.`;
    if (window.confirm(confirmMessage)) {
      deleteDocument.mutate(activity.entityId);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav 
          title="Activity Log" 
          subtitle="View all system activities and events"
        />
        
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-4xl mx-auto">
            {activitiesLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : activities.length === 0 ? (
              <Card>
                <CardContent className="text-center py-12">
                  <Activity className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No activities found</h3>
                  <p className="text-gray-500 dark:text-gray-400">
                    Activities will appear here as you use the system
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {activities.map((activity: ActivityType) => (
                  <Card key={activity.id} className="hover:shadow-sm transition-shadow">
                    <CardContent className="p-6">
                      <div className="flex items-start space-x-4">
                        <div className="flex-shrink-0">
                          <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                            {getActivityIcon(activity.type)}
                          </div>
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-gray-900 dark:text-white">
                                {activity.description}
                              </p>
                              <div className="flex items-center space-x-2 mt-1">
                                <Badge className={getActivityColor(activity.type)} variant="secondary">
                                  {formatActivityType(activity.type)}
                                </Badge>
                                {activity.entityType && activity.entityId && (
                                  <Badge variant="outline" className="text-xs">
                                    {activity.entityType} #{activity.entityId}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                              <div className="flex items-center">
                                <Clock className="w-4 h-4 mr-1" />
                                <span>
                                  {new Date(activity.createdAt!).toLocaleString()}
                                </span>
                              </div>
                              {isDocumentActivity(activity.type) && activity.entityType && activity.entityId && (
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleViewDocuments(activity)}
                                    className="h-8 px-2 text-xs"
                                  >
                                    <Eye className="w-3 h-3 mr-1" />
                                    View Documents
                                  </Button>
                                  {activity.entityType === 'document' && activity.type === 'document_uploaded' && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleDeleteDocument(activity)}
                                      className="h-8 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                                      disabled={deleteDocument.isPending}
                                    >
                                      <Trash2 className="w-3 h-3 mr-1" />
                                      {deleteDocument.isPending ? "Deleting..." : "Delete"}
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Document Viewer */}
      <DocumentViewer
        isOpen={showDocuments}
        onClose={() => setShowDocuments(false)}
        entityType={selectedEntityType}
        entityId={selectedEntityId}
      />
    </div>
  );
}