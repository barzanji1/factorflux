import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import StatsCards from "@/components/dashboard/stats-cards";
import DocumentUpload from "@/components/dashboard/document-upload";
import QuickActions from "@/components/dashboard/quick-actions";
import RecentActivity from "@/components/dashboard/recent-activity";
import RecentInvoices from "@/components/dashboard/recent-invoices";
import TimeClock from "@/components/time-tracking/time-clock";

export default function Dashboard() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading } = useAuth();

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
          title="Dashboard" 
          subtitle="Welcome back, manage your invoice processing workflow"
        />
        
        <main className="flex-1 overflow-auto p-6">
          <StatsCards />
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
            <div className="lg:col-span-2">
              <DocumentUpload />
            </div>
            
            <div className="space-y-6">
              <TimeClock />
              <QuickActions />
              <RecentActivity />
            </div>
          </div>

          <div className="mt-8">
            <RecentInvoices />
          </div>
        </main>
      </div>
    </div>
  );
}
