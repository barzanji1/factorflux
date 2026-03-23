import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { LucideIcon } from "lucide-react";
import {
  RotateCcw,
  Trash2,
  ArrowRight,
  Activity as ActivityIcon,
  FileText,
  Upload,
  UserPlus,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { Activity } from "@shared/schema";

type ActivityStyle = {
  dot: string;
  iconWrap: string;
  icon: LucideIcon;
  label: string;
};

function ActivitySkeleton() {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-slate-100 p-4 dark:border-slate-800">
      <div className="h-10 w-10 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-700" />
      <div className="flex-1">
        <div className="mb-2 h-4 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
      </div>
    </div>
  );
}

function getActivityStyles(type: string): ActivityStyle {
  switch (type) {
    case "invoice_created":
    case "invoice_approved":
      return {
        dot: "bg-emerald-500",
        iconWrap: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400",
        icon: FileText,
        label: "Invoice",
      };
    case "document_uploaded":
      return {
        dot: "bg-blue-600",
        iconWrap: "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400",
        icon: Upload,
        label: "Upload",
      };
    case "client_created":
      return {
        dot: "bg-amber-500",
        iconWrap: "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400",
        icon: UserPlus,
        label: "Client",
      };
    default:
      return {
        dot: "bg-slate-400",
        iconWrap: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
        icon: ActivityIcon,
        label: "System",
      };
  }
}

export default function RecentActivity() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

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
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent-activities"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to clear activities",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Card className="rounded-[22px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
        <CardHeader className="border-b border-slate-100 dark:border-slate-800">
          <CardTitle className="text-lg font-semibold text-slate-900 dark:text-white">
            Recent Activity
          </CardTitle>
        </CardHeader>

        <CardContent className="p-6">
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <ActivitySkeleton key={index} />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-[22px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
      <CardHeader className="border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
              Recent Activity
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Live workflow updates across your operations
            </p>
          </div>

          {activities.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => clearActivities.mutate()}
              disabled={clearActivities.isPending}
              className="h-10 rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/40 dark:text-red-400 dark:hover:bg-red-950/20"
            >
              {clearActivities.isPending ? (
                <RotateCcw className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              <span className="ml-2">Reset</span>
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-6">
        {activities.length > 0 ? (
          <div className="space-y-3">
            {activities.map((activity) => {
              const styles = getActivityStyles(activity.type);
              const Icon = styles.icon;

              return (
                <div
                  key={activity.id}
                  className="group flex items-start gap-4 rounded-2xl border border-slate-100 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-100 hover:bg-slate-50/80 dark:border-slate-800 dark:hover:border-blue-950/40 dark:hover:bg-slate-900/40"
                >
                  <div className="relative">
                    <div
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-xl",
                        styles.iconWrap
                      )}
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <div
                      className={cn(
                        "absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-slate-900",
                        styles.dot
                      )}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {styles.label}
                      </span>
                    </div>

                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {activity.description}
                    </p>

                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {activity.createdAt
                        ? new Date(activity.createdAt).toLocaleString()
                        : "Just now"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-10 text-center dark:border-slate-800">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              <ActivityIcon className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              No recent activity
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              New uploads, invoices, and client actions will appear here.
            </p>
          </div>
        )}

        <Button
          variant="outline"
          className="mt-5 h-11 w-full rounded-xl border-slate-200 bg-white font-semibold hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
          size="sm"
          onClick={() => setLocation("/activities")}
        >
          View All Activity
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}