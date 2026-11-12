import { lazyComponent } from "./lazy-page";

/** Warm the actual guard and its CSS without mounting or bypassing it. */
const staffRoute = lazyComponent(() => import("@/components/ProtectedRoute").then(module => ({ default: module.ProtectedRoute })));
export const PreparedStaffRoute = staffRoute.Component;
export const loadStaffRoute = staffRoute.load;

/** Avoid mounting the authenticated loading shell for an anonymous home visit. */
export function initialStaffPath(pathname: string, authFlag: string | null, storedUser: string | null) {
  if (pathname === "/" && (authFlag !== "true" || !storedUser)) return "/login";
  return pathname;
}
