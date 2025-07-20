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

export default function DocumentUpload() {
  const [isDragOver, setIsDragOver] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
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
    files.forEach((file) => {
      const formData = new FormData();
      formData.append('document', file);
      formData.append('documentType', 'other'); // Default type
      formData.append('uploadedBy', user?.id || '');
      
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

  // Mock recent files for display purposes
  const recentFiles = [
    {
      id: 1,
      name: "RC_LOAD_12345.pdf",
      uploadTime: "2 minutes ago",
      status: "processed",
      type: "pdf"
    },
    {
      id: 2,
      name: "BOL_LOAD_12344.pdf",
      uploadTime: "15 minutes ago",
      status: "processing",
      type: "pdf"
    },
    {
      id: 3,
      name: "DRIVER_ID_JOHN_DOE.jpg",
      uploadTime: "1 hour ago",
      status: "processed",
      type: "jpg"
    }
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">Quick Document Upload</CardTitle>
          <Button variant="outline">
            <ExpandIcon className="w-4 h-4 mr-2" />
            Full Upload
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Drag & Drop Zone */}
        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            isDragOver
              ? "border-primary bg-blue-50"
              : "border-gray-300 hover:border-primary"
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
          
          <div className="w-16 h-16 bg-primary bg-opacity-10 rounded-full flex items-center justify-center mx-auto mb-4">
            <CloudUpload className="text-primary text-2xl" />
          </div>
          
          <h4 className="text-lg font-medium text-secondary mb-2">
            Drop files here or click to browse
          </h4>
          <p className="text-gray-500 mb-4">
            Supported formats: PDF, JPG, PNG (Max 10MB each)
          </p>
          
          <div className="flex flex-wrap justify-center gap-2 text-sm text-gray-600">
            <span className="px-3 py-1 bg-gray-100 rounded-full">Rate Confirmations</span>
            <span className="px-3 py-1 bg-gray-100 rounded-full">Bills of Lading</span>
            <span className="px-3 py-1 bg-gray-100 rounded-full">Driver Documents</span>
          </div>
        </div>

        {/* Upload Progress */}
        {uploadMutation.isPending && (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="text-sm text-gray-500 mt-2">Uploading documents...</p>
          </div>
        )}

        {/* Recently Uploaded Files */}
        <div>
          <h4 className="font-medium text-secondary mb-3">Recently Uploaded</h4>
          <div className="space-y-3">
            {recentFiles.map((file) => (
              <div key={file.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:shadow-sm transition-shadow">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-red-100 rounded flex items-center justify-center">
                    <FileIcon className="w-4 h-4 text-red-600" />
                  </div>
                  <div>
                    <p className="font-medium text-secondary">{file.name}</p>
                    <p className="text-sm text-gray-500">{file.uploadTime}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <Badge className={getStatusColor(file.status)}>
                    {file.status}
                  </Badge>
                  <Button variant="ghost" size="sm">
                    <Eye className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
