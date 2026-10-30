export type DashboardSection = "queue" | "followups" | "activity" | "alerts";
export type DashboardViewer = { id: string; role: "employee" | "manager" | "admin" };
export type DashboardMeta = { generatedAt: string; viewer: DashboardViewer };
export type DashboardActionGrid = {
  docsPending: number;
  recentInvoices: { id: number; invoiceNumber: string; createdAt: string }[];
  readyToFundCount: number; readyToFundAmount: number;
  openFollowups: number; overdueFollowups: number; dueTodayFollowups: number;
  openChargebacks: number; chargebackAmount: number; oldestChargebackDays: number | null;
  aging60Count: number; aging60Amount: number; brokerCount: number;
};
export type DashboardFinancial = DashboardMeta & {
  kpis: {
    readyToFund: number; inReview: number; openFollowups: number;
    aging60Plus: number; fundedThisWeek: number; pendingActions: number;
  };
  months: { month: string; invoiced: number; collected: number }[];
  actionGrid: DashboardActionGrid;
};
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
  id: string; kind: "email_bounced" | "ocr_failed";
  title: string; detail: string; when: string | null; href: string;
};
export type DashboardQueue = DashboardMeta & { queueGroups: DashboardQueueGroup[]; queueCount: number; limit: number };
export type DashboardFollowUps = DashboardMeta & { followUps: DashboardFollowUp[]; totalCount: number; limit: number };
export type DashboardActivityFeed = DashboardMeta & { activity: DashboardActivity[] };
export type DashboardActivityKind = "invoice" | "status" | "collection" | "document" | "system";
export type DashboardActivityGroup = DashboardActivity & {
  actorId: string | null;
  kind: DashboardActivityKind;
  entityLabel: string;
  count: number;
  events: DashboardActivity[];
};
export type DashboardActivityPage = DashboardMeta & {
  activity: DashboardActivityGroup[];
  nextCursor: string | null;
  limit: number;
  summary: {
    todayCount: number;
    mostActive: { name: string; count: number } | null;
    lastActionAt: string | null;
  };
};
export type DashboardAlerts = DashboardMeta & {
  alerts: DashboardAlert[];
  alertCounts: { email_bounced: number; ocr_failed: number };
};
