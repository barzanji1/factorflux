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
import tpfLogo from "@assets/TPF-glass-Sign_1753927893748.png";

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
          subtitle="Welcome back, manage your freight factoring workflow"
        />
        
        <main className="flex-1 overflow-auto p-6">
          {/* TPF Branding Header */}
          <div className="mb-8 bg-gradient-to-r from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-6">
                <img 
                  src={tpfLogo} 
                  alt="Trucking Pros Financial" 
                  className="h-16 w-auto object-contain"
                />
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                    Welcome to QuantumCore
                  </h2>
                  <p className="text-gray-600 dark:text-gray-300 mt-1">
                    Have a Wonderful Day! :-)
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Powered by Trucking Pros Financial
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Professional freight factoring solutions
                </p>
              </div>
            </div>
          </div>

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
