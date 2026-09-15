import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

const ROUTE_PERMISSION_MAP: Record<string, string> = {
  "/": "dashboard",
  "/clients": "carriers",
  "/invoices": "invoices",
  "/documents": "documents",
  "/tasks": "tasks",
  "/bulk-invoices": "bulk_invoices",
  "/portal-submissions": "portal_submissions",
  "/factoring": "factoring",
  "/payouts": "payments",
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
  "/help": "help",
  "/document-rules": "rules",
  "/workflow-builder": "workflow_builder",
};

function pathToPermission(pathname: string): string | null {
  if (ROUTE_PERMISSION_MAP[pathname]) return ROUTE_PERMISSION_MAP[pathname];
  for (const [route, perm] of Object.entries(ROUTE_PERMISSION_MAP)) {
    if (route !== "/" && pathname.startsWith(route + "/")) return perm;
  }
  return null;
}

export function PermissionWatcher() {
  const { permissions, isAuthenticated, user } = useAuth();
  const [location, navigate] = useLocation();
  const { toast } = useToast();

  const prevPermissionsRef = useRef<string[]>([]);
  const locationRef = useRef(location);
  const initializedRef = useRef(false);

  // Keep location ref fresh so the permissions effect always sees current path
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    // Admins are never affected
    if (!isAuthenticated || user?.role === "admin") {
      prevPermissionsRef.current = permissions;
      initializedRef.current = false;
      return;
    }

    const prev = prevPermissionsRef.current;
    prevPermissionsRef.current = permissions;

    // First load — just record the baseline, no redirect
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

    // Find permissions that were granted before but are now revoked
    const revoked = prev.filter(p => !permissions.includes(p));
    if (revoked.length === 0) return;

    // If the current page requires a revoked permission, kick the agent out
    const currentPermission = pathToPermission(locationRef.current);
    const portalHubStillAvailable = currentPermission === "portal_submissions"
      && (user?.role === "admin" || permissions.includes("portal_submissions") || permissions.includes("chat"));
    if (currentPermission && revoked.includes(currentPermission) && !portalHubStillAvailable) {
      toast({
        title: "Access updated by administrator",
        description: "Your access to this page has been changed.",
        variant: "destructive",
        duration: 6000,
      });
      navigate("/");
    }
  }, [permissions]); // intentionally only watching permissions

  return null;
}
