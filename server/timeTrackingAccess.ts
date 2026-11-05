// Self-service routes operate only on req.user.id. Payroll reporting remains
// behind the existing payroll permission and admin-only route guards.
export function isSelfTimeTrackingRequest(method: string, pathname: string): boolean {
  return (method === "GET" && [
    "/api/time-tracking/status",
    "/api/time-tracking/entries",
  ].includes(pathname))
    || (method === "POST" && [
      "/api/time-tracking/clock-in",
      "/api/time-tracking/clock-out",
    ].includes(pathname));
}
