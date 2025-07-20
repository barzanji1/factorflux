import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Activity } from "@shared/schema";

export default function RecentActivity() {
  const { data: activities, isLoading } = useQuery({
    queryKey: ["/api/dashboard/recent-activities"],
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
        <CardTitle className="text-lg">Recent Activity</CardTitle>
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
        
        <Button variant="outline" className="w-full mt-4" size="sm">
          View All Activity
        </Button>
      </CardContent>
    </Card>
  );
}
