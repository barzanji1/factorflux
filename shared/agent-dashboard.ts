export type DashboardSection = "queue" | "followups" | "activity" | "alerts";
export type DashboardViewer = { id: string; role: "employee" | "manager" | "admin" };
export type DashboardMeta = { generatedAt: string; viewer: DashboardViewer };
export type DashboardQueueItem = {
  id: number; invoiceNumber: string; carrierName: string; brokerName: string; status: string;
  ageDays: number | null; ageBasis: string; actions: string[]; href: string;
};
export type DashboardQueueGroup = {
  agentId: string | null; agentName: string; items: DashboardQueueItem[]; totalCount: number;
};
export type DashboardFollowUp = {
  id: string; source: string; title: string; carrierName: string | null; status: string;
  priority: string; dueDate: string | null; href: string;
};
export type DashboardActivity = { id: number; who: string; action: string; when: string | null; href: string | null };
export type DashboardAlert = {
  id: string; kind: "email_bounced" | "ocr_failed" | "unverified_carrier";
  title: string; detail: string; when: string | null; href: string;
};
export type DashboardHealth = {
  state: "not_run" | "healthy" | "warning" | "failed"; active: number | null;
  failed: number; lastChecked: string | null; href: "/fmcsa-authority";
};
export type DashboardQueue = DashboardMeta & { queueGroups: DashboardQueueGroup[]; queueCount: number; limit: number };
export type DashboardFollowUps = DashboardMeta & { followUps: DashboardFollowUp[]; totalCount: number; limit: number };
export type DashboardActivityFeed = DashboardMeta & { activity: DashboardActivity[] };
export type DashboardAlerts = DashboardMeta & {
  alerts: DashboardAlert[];
  alertCounts: { email_bounced: number; ocr_failed: number; unverified_carrier: number };
  systemHealth: { fmcsaAuthority: DashboardHealth };
};
