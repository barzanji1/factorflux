import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PageInsights } from "@/components/PageInsights";
// Authentication removed
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, Button, Badge, AdminPageShell } from "@/components/admin-neu/adapters";
import { NeuTable, NeuTableBody, NeuTableCell, NeuTableHead, NeuTableHeader, NeuTableRow } from "@/styles/neu/components";
import { Activity, Clock, FileText, UserPlus, Upload, CheckCircle, Eye, Trash2 } from "lucide-react";
import DocumentViewer from "@/components/document-viewer";
import type { Activity as ActivityType } from "@shared/schema";
import "@/components/admin-neu/admin-neu-page.css";

export default function Activities() {
  const { toast } = useToast();
  
  const [showDocuments, setShowDocuments] = useState(false);
  const [selectedEntityType, setSelectedEntityType] = useState<string>("");
  const [selectedEntityId, setSelectedEntityId] = useState<number | undefined>();
  const queryClient = useQueryClient();

  // Authentication system removed

  const { data: activities = [], isLoading: activitiesLoading } = useQuery<ActivityType[]>({
    queryKey: ["/api/activities"],
  });

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "document_uploaded":
        return <Upload className="w-4 h-4 text-[#168d99]" />;
      case "client_created":
        return <UserPlus className="h-4 w-4 text-[#168d99]" />;
      case "invoice_created":
        return <FileText className="w-4 h-4 text-[#168d99]" />;
      case "invoice_approved":
        return <CheckCircle className="h-4 w-4 text-[#168d99]" />;
      default:
        return <Activity className="h-4 w-4 text-[#666]" />;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case "document_uploaded":
        return "text-[#168d99]";
      case "client_created":
        return "text-[#168d99]";
      case "invoice_created":
        return "text-[#666]";
      case "invoice_approved":
        return "text-[#168d99]";
      default:
        return "text-[#666]";
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



  return (
      <div className="ff-admin-page flex min-h-[100dvh] bg-[#e0e0e0]">
      <Sidebar />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav 
          title="Activity Log" 
          subtitle="View all system activities and events"
        />
        
        <AdminPageShell className="flex-1 overflow-auto p-6">
          <PageInsights entity="activities" title="Activity stream" />
          <div className="max-w-4xl mx-auto">
            {activitiesLoading ? (
              <Card className="space-y-3 p-6" aria-label="Loading activities">
                {[0, 1, 2, 3].map((n) => <div key={n} className="h-12 animate-pulse rounded-xl bg-[#d2d2d2]" />)}
              </Card>
            ) : activities.length === 0 ? (
              <Card>
                <CardContent className="text-center py-12">
                  <Activity className="mx-auto mb-4 h-16 w-16 text-[#999]" />
                  <h3 className="mb-2 text-lg font-medium text-[#333]">No activities found</h3>
                  <p className="text-[#777]">
                    Activities will appear here as you use the system
                  </p>
                </CardContent>
              </Card>
            ) : (
              <NeuTable className="w-full">
                <NeuTableHeader><NeuTableRow><NeuTableHead>Activity</NeuTableHead><NeuTableHead>Entity</NeuTableHead><NeuTableHead>When</NeuTableHead><NeuTableHead>Actions</NeuTableHead></NeuTableRow></NeuTableHeader>
                <NeuTableBody>{activities.map((activity: ActivityType) => <NeuTableRow key={activity.id}>
                  <NeuTableCell><div className="flex min-w-64 items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e0e0e0] shadow-[-3px_-3px_7px_#fff,3px_3px_7px_#c1c1c1]">{getActivityIcon(activity.type)}</div><div className="min-w-0"><p className="text-sm font-medium text-[#333]">{activity.description}</p><Badge tone="neutral" className={`mt-1 ${getActivityColor(activity.type)}`}>{formatActivityType(activity.type)}</Badge></div></div></NeuTableCell>
                  <NeuTableCell>{activity.entityType && activity.entityId ? <Badge tone="accent">{activity.entityType} #{activity.entityId}</Badge> : "—"}</NeuTableCell>
                  <NeuTableCell className="text-xs text-[#777]"><span className="flex items-center gap-1"><Clock className="h-4 w-4" />{new Date(activity.createdAt!).toLocaleString()}</span></NeuTableCell>
                  <NeuTableCell><div className="flex gap-2">{isDocumentActivity(activity.type) && activity.entityType && activity.entityId && <><Button variant="outline" size="sm" onClick={() => handleViewDocuments(activity)} className="h-8 px-2 text-xs"><Eye className="mr-1 h-3 w-3" />View Documents</Button>{activity.entityType === "document" && activity.type === "document_uploaded" && <Button variant="destructive" size="sm" onClick={() => handleDeleteDocument(activity)} className="h-8 px-2 text-xs" disabled={deleteDocument.isPending}><Trash2 className="mr-1 h-3 w-3" />{deleteDocument.isPending ? "Deleting..." : "Delete"}</Button>}</>}</div></NeuTableCell>
                </NeuTableRow>)}</NeuTableBody>
              </NeuTable>
            )}
          </div>
        </AdminPageShell>
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