import { db } from "../db";
import type { DashboardViewer, DashboardSection } from "../../shared/agent-dashboard";
import { readDashboardQueue, readDashboardFollowUps, readDashboardActivity, readDashboardAlerts, DASHBOARD_LIMIT } from "./agentDashboardQueries";
import { readDashboardFinancial } from "./dashboardFinancial";
import { readDashboardActivityPage } from "./dashboardActivity";
export type { DashboardViewer } from "../../shared/agent-dashboard";
export { invoiceWork, unacknowledgedCodes, fmcsaAuthorityHealth } from "./agentDashboardWork";
export const dashboardReaders = {
  queue: readDashboardQueue, followups: readDashboardFollowUps, activity: readDashboardActivityPage, alerts: readDashboardAlerts,
  financial: readDashboardFinancial,
};
/** Compatibility endpoint: parallel sections with explicit, isolated failures.
 * The UI requests each section directly so it can render before siblings finish. */
export async function readAgentDashboard(viewer: DashboardViewer, store = db, now = new Date()) {
  const results = await Promise.allSettled([
    readDashboardQueue(viewer, store, now), readDashboardFollowUps(viewer, store, now),
    readDashboardActivity(viewer, store, now), readDashboardAlerts(viewer, store, now),
  ] as const);
  const meta = { viewer, generatedAt: now.toISOString() };
  const sectionErrors: Partial<Record<DashboardSection, string>> = {};
  (["queue", "followups", "activity", "alerts"] as const).forEach((section, index) => {
    if (results[index].status === "rejected") sectionErrors[section] = `Unable to load ${section}. Please retry.`;
  });
  return {
    ...meta,
    ...(results[0].status === "fulfilled" ? results[0].value : { queueGroups: [], queueCount: 0, limit: DASHBOARD_LIMIT }),
    ...(results[1].status === "fulfilled" ? results[1].value : { followUps: [], totalCount: 0, limit: DASHBOARD_LIMIT }),
    ...(results[2].status === "fulfilled" ? results[2].value : { activity: [] }),
    ...(results[3].status === "fulfilled" ? results[3].value : { alerts: [], alertCounts: { email_bounced: 0, ocr_failed: 0 } }),
    sectionErrors,
  };
}
