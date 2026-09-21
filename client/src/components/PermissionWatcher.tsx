import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { pathToPermission } from "@/lib/routePermissions";

export function PermissionWatcher() {
  const { permissions, permissionsLoaded, isAuthenticated, user } = useAuth();
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
    if (!isAuthenticated || user?.role === "admin" || !permissionsLoaded) {
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
  }, [permissions, permissionsLoaded]); // intentionally only watching permissions

  return null;
}
