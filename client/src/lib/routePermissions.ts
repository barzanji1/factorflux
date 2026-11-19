export const ROUTE_PERMISSION_MAP: Record<string, string> = {
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
  "/followups": "followups",
  "/reports": "reports",
  "/admin": "admin",
  "/payroll": "",
  "/vault": "vault",
  "/document-rules": "rules",
  "/workflow-builder": "workflow_builder",
  "/ai-assistant": "earl",
  "/calendar": "calendar",
  "/expenses": "expenses",
  "/tickets": "tickets",
  // Staff-wide announcements live here. Conversation access is gated
  // separately in TeamChatWorkspace and remains protected by the API.
  "/chat": "",
  // The Email route hosts Log for every authenticated employee. Compose is
  // gated inside ClientEmailPage with the client_email permission.
  "/client-email": "",
};

export function pathToPermission(pathname: string): string | null {
  const path = pathname.split(/[?#]/, 1)[0];
  if (Object.prototype.hasOwnProperty.call(ROUTE_PERMISSION_MAP, path)) {
    return ROUTE_PERMISSION_MAP[path] || null;
  }
  for (const [route, permission] of Object.entries(ROUTE_PERMISSION_MAP)) {
    if (permission && route !== "/" && path.startsWith(`${route}/`)) return permission;
  }
  return null;
}