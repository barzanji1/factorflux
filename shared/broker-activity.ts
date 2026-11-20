export type BrokerActivityStatus = "pending" | "confirmed" | "disputed";
export type BrokerActivityMethod = "email" | "portal";
export interface BrokerActivityFilters {
  brokerId?: number;
  status?: "all" | BrokerActivityStatus;
  method?: "all" | BrokerActivityMethod;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  timeZone?: string;
  page?: number;
}
export interface BrokerActivityRow {
  invoiceId: number;
  invoiceNumber: string;
  brokerId: number;
  brokerName: string;
  clientName: string;
  invoiceAmount: string;
  approvedAmount: string | null;
  status: BrokerActivityStatus;
  sentAt: string | null;
  actedAt: string | null;
  responseSeconds: number | null;
  method: BrokerActivityMethod | null;
  discrepancy: boolean;
  historicalAmount: boolean;
}
export interface BrokerActivityPage {
  items: BrokerActivityRow[];
  total: number;
  page: number;
  pageSize: number;
}
export interface BrokerActivityStats {
  pendingCount: number;
  confirmedTodayCount: number;
  confirmedTodayAmount: string;
  disputedTodayCount: number;
  disputedTodayAmount: string;
  averageResponseSeconds: number | null;
  timeZone: string;
}
export interface BrokerResponseReportRow {
  brokerId: number;
  brokerName: string;
  totalSent: number;
  confirmedCount: number;
  disputedCount: number;
  noResponseCount: number;
  averageResponseSeconds: number | null;
  confirmationRate: number;
}
export interface BrokerResponseReport {
  items: BrokerResponseReportRow[];
  total: number;
  page: number;
  pageSize: number;
}
export interface BrokerNotificationPreferences {
  inApp: boolean;
  email: boolean;
}
export interface BrokerActivityBrokerOptions {
  brokers: { id: number; name: string }[];
  total: number;
  page: number;
  pageSize: number;
}
