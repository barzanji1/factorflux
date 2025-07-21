import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Button,
} from "@/components/ui/button";
import {
  Badge,
} from "@/components/ui/badge";
import { 
  FileText, 
  Download, 
  Eye,
  Calendar,
  User,
  File,
  Trash2
} from "lucide-react";
import type { Document } from "@shared/schema";

interface DocumentViewerProps {
  isOpen: boolean;
  onClose: () => void;
  entityType?: string;
  entityId?: number;
}

export default function DocumentViewer({ isOpen, onClose, entityType, entityId }: DocumentViewerProps) {
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: documents, isLoading } = useQuery({
    queryKey: ["/api/documents", { entityType, entityId }],
    enabled: isOpen && !!entityType && !!entityId,
  });

  const deleteDocument = useMutation({
    mutationFn: async (documentId: number) => {
      const response = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Failed to delete document: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
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

  const typedDocuments = (documents as Document[]) || [];

  const handleViewDocument = (document: Document) => {
    // Open document in new tab for viewing
    window.open(`/uploads/${document.filename}`, '_blank');
  };

  const handleDownloadDocument = (doc: Document) => {
    // Create download link
    const link = window.document.createElement('a');
    link.href = `/uploads/${doc.filename}`;
    link.download = doc.originalName;
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
  };

  const handleDeleteDocument = (doc: Document) => {
    if (window.confirm(`Are you sure you want to delete "${doc.originalName}"? This action cannot be undone.`)) {
      deleteDocument.mutate(doc.id);
    }
  };

  const getDocumentIcon = (type: string) => {
    switch (type) {
      case 'rate_confirmation':
        return <FileText className="w-5 h-5 text-blue-600" />;
      case 'bill_of_lading':
        return <File className="w-5 h-5 text-green-600" />;
      case 'driver_document':
        return <User className="w-5 h-5 text-purple-600" />;
      default:
        return <FileText className="w-5 h-5 text-gray-600" />;
    }
  };

  const getDocumentTypeLabel = (type: string) => {
    switch (type) {
      case 'rate_confirmation':
        return 'Rate Confirmation';
      case 'bill_of_lading':
        return 'Bill of Lading';
      case 'driver_document':
        return 'Driver Document';
      default:
        return 'Document';
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Related Documents
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-gray-500">Loading documents...</p>
            </div>
          ) : typedDocuments.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No documents found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {typedDocuments.map((document) => (
                <div
                  key={document.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {getDocumentIcon(document.documentType)}
                      <div>
                        <h3 className="font-medium text-sm truncate max-w-[200px]">
                          {document.originalName}
                        </h3>
                        <Badge variant="outline" className="text-xs mt-1">
                          {getDocumentTypeLabel(document.documentType)}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-2 text-xs text-gray-500 mb-3">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>Uploaded {new Date(document.createdAt!).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <File className="w-3 h-3" />
                      <span>{(document.size / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewDocument(document)}
                      className="flex-1"
                    >
                      <Eye className="w-3 h-3 mr-1" />
                      View
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDownloadDocument(document)}
                      className="flex-1"
                    >
                      <Download className="w-3 h-3 mr-1" />
                      Download
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteDocument(document)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      disabled={deleteDocument.isPending}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="flex justify-end pt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}