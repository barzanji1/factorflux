import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { Redirect, useLocation } from "wouter";
import AccessDenied from "@/pages/access-denied";
import { pathToPermission } from "@/lib/routePermissions";
import { AlertCircle, RotateCcw } from "lucide-react";
import { NeuButton, NeuCard, NeuPageShell } from "@/styles/neu";

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
    return <NeuPageShell className="flex min-h-[100dvh] items-center justify-center p-6">
      <NeuCard role="alert" className="max-w-lg p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#b46a37]" />
          <div><h1 className="text-base font-bold text-[#344d48]">Access check could not finish</h1><p className="mt-1 text-sm text-[#687b75]">{permissionsError}</p>
            <NeuButton variant="accent" className="mt-4 min-h-9 px-4" onClick={() => void refreshPermissions()}><RotateCcw className="h-4 w-4" />Retry access check</NeuButton>
          </div>
        </div>
      </NeuCard>
    </NeuPageShell>;
  }

  const requiredPermission = pathToPermission(location);
  if (requiredPermission && user?.role !== "admin" && !permissions.includes(requiredPermission)) {
    return <AccessDenied />;
  }

  console.log("Authenticated, rendering protected content");
  return <>{children}</>;
}