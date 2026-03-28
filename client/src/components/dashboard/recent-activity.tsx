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
  ExternalLink,
  Download,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { Activity } from "@shared/schema";

type ActivityStyle = {
  icon: LucideIcon;
  iconClass: string;
  label: string;
};

type ActivityWithMetadata = Activity & {
  metadata?: {
    documentId?: number;
    filePath?: string;
    originalName?: string;
  };
};

function ActivitySkeleton() {
  return (
    <div className="flex items-start gap-4 rounded-[18px] border border-slate-200/80 p-4 dark:border-slate-800">
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
        icon: FileText,
        iconClass: "text-emerald-500",
        label: "Invoice",
      };
    case "document_uploaded":
      return {
        icon: Upload,
        iconClass: "text-blue-500",
        label: "Upload",
      };
    case "client_created":
      return {
        icon: UserPlus,
        iconClass: "text-amber-500",
        label: "Client",
      };
    default:
      return {
        icon: ActivityIcon,
        iconClass: "text-slate-500",
        label: "System",
      };
  }
}

function getDocumentViewUrl(activity: ActivityWithMetadata) {
  if (activity.metadata?.filePath) {
    return activity.metadata.filePath;
  }

  if (activity.metadata?.documentId) {
    return `/api/documents/${activity.metadata.documentId}/download`;
  }

  return null;
}

function getDocumentDownloadUrl(activity: ActivityWithMetadata) {
  if (activity.metadata?.documentId) {
    return `/api/documents/${activity.metadata.documentId}/download`;
  }

  if (activity.metadata?.filePath) {
    return activity.metadata.filePath;
  }

  return null;
}

export default function RecentActivity() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: activities = [], isLoading } = useQuery<ActivityWithMetadata[]>({
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
      <Card className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
        <CardHeader className="border-b border-slate-100 dark:border-slate-800">
          <CardTitle className="text-lg font-semibold text-slate-900 dark:text-white">
            Recent Activity
          </CardTitle>
        </CardHeader>

        <CardContent className="p-5">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <ActivitySkeleton key={index} />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
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
              className="h-10 rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
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

      <CardContent className="p-5">
        {activities.length > 0 ? (
          <div className="space-y-3">
            {activities.map((activity) => {
              const styles = getActivityStyles(activity.type);
              const Icon = styles.icon;
              const viewUrl = getDocumentViewUrl(activity);
              const downloadUrl = getDocumentDownloadUrl(activity);
              const downloadName = activity.metadata?.originalName || "document";

              return (
                <div
                  key={activity.id}
                  className="group flex items-start gap-4 rounded-[18px] border border-slate-200/80 bg-slate-50/50 p-4 transition dark:border-slate-800 dark:bg-slate-900/20"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white dark:bg-slate-800">
                    <Icon className={cn("h-4.5 w-4.5", styles.iconClass)} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {styles.label}
                      </span>
                    </div>

                    <p className="break-words text-sm font-medium leading-6 text-slate-900 dark:text-white">
                      {activity.description}
                    </p>

                    {activity.type === "document_uploaded" && (viewUrl || downloadUrl) && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {viewUrl && (
                          <a
                            href={viewUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            View
                          </a>
                        )}

                        {downloadUrl && (
                          <a
                            href={downloadUrl}
                            download={downloadName}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Download
                          </a>
                        )}
                      </div>
                    )}

                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
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
          <div className="rounded-[18px] border border-dashed border-slate-200 px-6 py-10 text-center dark:border-slate-800">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              <ActivityIcon className="h-5 w-5" />
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
          className="mt-5 h-11 w-full rounded-xl border-slate-200 bg-white font-medium hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
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