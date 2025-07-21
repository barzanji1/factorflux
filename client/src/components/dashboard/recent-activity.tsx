import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { RotateCcw, Trash2 } from "lucide-react";
import type { Activity } from "@shared/schema";

export default function RecentActivity() {
  const { toast } = useToast();
  const { data: activities = [], isLoading } = useQuery<Activity[]>({
    queryKey: ["/api/dashboard/recent-activities"],
  });

  const clearActivities = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", "/api/activities");
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Activities Cleared",
        description: "All recent activity has been reset successfully",
      });
      // Invalidate and refetch activities
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent-activities"] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to clear activities",
        variant: "destructive",
      });
    },
  });

  const getActivityColor = (type: string) => {
    switch (type) {
      case "invoice_created":
      case "invoice_approved":
        return "bg-success";
      case "document_uploaded":
        return "bg-primary";
      case "client_created":
        return "bg-warning";
      default:
        return "bg-gray-400";
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-start space-x-3">
                <div className="w-2 h-2 bg-gray-200 rounded-full mt-2 animate-pulse"></div>
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded animate-pulse mb-1"></div>
                  <div className="h-3 bg-gray-200 rounded animate-pulse w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Recent Activity</CardTitle>
          {activities.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => clearActivities.mutate()}
              disabled={clearActivities.isPending}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              {clearActivities.isPending ? (
                <RotateCcw className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              <span className="ml-1">Reset</span>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities?.map((activity: Activity) => (
            <div key={activity.id} className="flex items-start space-x-3">
              <div className={`w-2 h-2 ${getActivityColor(activity.type)} rounded-full mt-2`}></div>
              <div>
                <p className="text-sm text-secondary font-medium">{activity.description}</p>
                <p className="text-xs text-gray-500">
                  {new Date(activity.createdAt!).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
          
          {activities?.length === 0 && (
            <p className="text-center text-gray-500 text-sm">No recent activity</p>
          )}
        </div>
        
        <Button 
          variant="outline" 
          className="w-full mt-4" 
          size="sm"
          onClick={() => window.location.href = '/activities'}
        >
          View All Activity
        </Button>
      </CardContent>
    </Card>
  );
}
