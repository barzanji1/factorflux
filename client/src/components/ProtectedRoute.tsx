import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { Redirect, useLocation } from "wouter";
import AccessDenied from "@/pages/access-denied";
import { pathToPermission } from "@/lib/routePermissions";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, permissions, permissionsLoaded, permissionsReadyForRoute, permissionsError, refreshPermissions, user } = useAuth();
  const [location] = useLocation();

  console.log("ProtectedRoute - isLoading:", isLoading, "isAuthenticated:", isAuthenticated);

  if (isLoading || (isAuthenticated && user?.role !== "admin" && (!permissionsReadyForRoute || (!permissionsLoaded && !permissionsError)))) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-300">Verifying authentication...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    console.log("Not authenticated, redirecting to login");
    return <Redirect to="/login" />;
  }
  if (user?.role !== "admin" && permissionsError) {
    return <div role="alert" className="flex min-h-screen items-center justify-center bg-[#d4d0c8] p-6">
      <div className="border-2 border-[#808080] bg-[#ece9df] p-5">
        <p>{permissionsError}</p>
        <button type="button" className="mt-3 border-2 border-[#808080] bg-[#d4d0c8] px-4 py-2" onClick={() => void refreshPermissions()}>Retry access check</button>
      </div>
    </div>;
  }

  const requiredPermission = pathToPermission(location);
  if (requiredPermission && user?.role !== "admin" && !permissions.includes(requiredPermission)) {
    return <AccessDenied />;
  }

  console.log("Authenticated, rendering protected content");
  return <>{children}</>;
}