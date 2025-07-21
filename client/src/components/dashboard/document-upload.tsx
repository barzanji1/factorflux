import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { CloudUpload, ExpandIcon, FileIcon, Eye } from "lucide-react";

interface DocumentUploadProps {
  onUploadComplete?: () => void;
  documentType?: string;
}

export default function DocumentUpload({ onUploadComplete, documentType = "other" }: DocumentUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      // Add document type to the form data
      formData.append('documentType', documentType);
      const response = await apiRequest("POST", "/api/documents/upload", formData);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Document uploaded successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent-activities"] });
      if (onUploadComplete) {
        onUploadComplete();
      }
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: "Failed to upload document",
        variant: "destructive",
      });
    },
  });

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      handleFiles(files);
    }
  };

  const handleFiles = (files: File[]) => {
    if (!user?.id) {
      toast({
        title: "Error",
        description: "User not authenticated",
        variant: "destructive",
      });
      return;
    }

    files.forEach((file) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', user.id);
      formData.append('documentType', documentType);
      
      uploadMutation.mutate(formData);
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "processed":
        return "bg-green-100 text-green-800";
      case "processing":
        return "bg-yellow-100 text-yellow-800";
      case "failed":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getDocumentTypeLabel = (type: string) => {
    switch (type) {
      case 'rate_confirmation':
        return 'Rate Confirmation';
      case 'bill_of_lading':
        return 'Bill of Lading';
      case 'driver_id':
        return 'Driver ID';
      case 'carrier_setup':
        return 'Carrier Setup';
      default:
        return 'Other Document';
    }
  };

  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-semibold text-gray-900 dark:text-white">
              Upload {getDocumentTypeLabel(documentType)}
            </CardTitle>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {documentType === 'rate_confirmation' && 'Upload rate confirmation documents for this load'}
              {documentType === 'bill_of_lading' && 'Upload bill of lading documents for this load'}
              {documentType === 'driver_id' && 'Upload driver ID and carrier setup documents'}
              {documentType === 'other' && 'Upload supporting documents'}
            </p>
          </div>
          <div className="flex items-center space-x-3">
            <span className={`text-sm font-medium px-3 py-1 rounded-full ${
              uploadMutation.isPending 
                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" 
                : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
            }`}>
              {uploadMutation.isPending ? "Processing..." : "Ready"}
            </span>
            <Button variant="outline" size="sm">
              <FileIcon className="w-4 h-4 mr-2" />
              Choose Files
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Drag & Drop Zone */}
        <div
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-300 ${
            isDragOver
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/10 scale-105 shadow-lg"
              : "border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <input
            id="file-input"
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileSelect}
            className="hidden"
          />
          
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
            <CloudUpload className="text-white w-8 h-8" />
          </div>
          
          <h4 className="text-xl font-semibold text-gray-900 dark:text-white mb-3">
            + Add Files
          </h4>
          <p className="text-gray-600 dark:text-gray-400 mb-6 text-lg">
            Drop files here or click to browse
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Supported formats: PDF, JPG, PNG (Max 10MB each)<br/>
            <span className="text-blue-600 dark:text-blue-400 font-medium">JPEG images will be automatically converted to PDF</span>
          </p>
          
          <div className="flex justify-center">
            <span className="px-4 py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full font-medium">
              {getDocumentTypeLabel(documentType)}
            </span>
          </div>
        </div>

        {/* Upload Progress */}
        {uploadMutation.isPending && (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="text-sm text-gray-500 mt-2">Uploading documents...</p>
          </div>
        )}

        {/* Upload Instructions */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
          <h4 className="font-medium text-gray-900 dark:text-white mb-2">Upload Instructions</h4>
          <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <li>• Ensure document quality is clear and readable</li>
            <li>• File names should include load numbers when possible</li>
            <li>• JPEG images will be automatically converted to PDF format</li>
            <li>• Maximum file size: 10MB per document</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
