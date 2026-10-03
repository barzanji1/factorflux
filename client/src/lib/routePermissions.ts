export const ROUTE_PERMISSION_MAP: Record<string, string> = {
  "/": "dashboard",
  "/clients": "carriers",
  "/carriers": "carriers",
  "/invoices": "invoices",
  "/documents": "documents",
  "/tasks": "tasks",
  "/bulk-invoices": "bulk_invoices",
  "/portal-submissions": "portal_submissions",
  "/factoring": "factoring",
  "/sheets": "factoring",
  "/payouts": "payments",
  "/cash-application": "payments",
  "/lockbox": "lockbox",
  "/fuel-advance": "fuel_advance",
  "/bank-transfers": "bank_transfers",
  "/dispatchers": "dispatchers",
  "/trucks": "trucks",
  "/release-letters": "release_letters",
  "/brokers": "brokers",
  "/credit-checks": "cb_reviews",
  "/fmcsa-authority": "mc_check",
  "/held": "held",
  "/audit-log": "logs",
  "/collections": "followups",
  "/follow-up": "followups",
  "/reports": "reports",
  "/admin": "admin",
  "/payroll": "payroll",
  "/vault": "vault",
  "/document-rules": "rules",
  "/workflow-builder": "workflow_builder",
  "/ai-assistant": "earl",
  "/calendar": "calendar",
  "/expenses": "expenses",
  "/tickets": "tickets",
  "/chat": "chat",
};

export function pathToPermission(pathname: string): string | null {
  if (ROUTE_PERMISSION_MAP[pathname]) return ROUTE_PERMISSION_MAP[pathname];
  for (const [route, permission] of Object.entries(ROUTE_PERMISSION_MAP)) {
    if (route !== "/" && pathname.startsWith(`${route}/`)) return permission;
  }
  return null;
}