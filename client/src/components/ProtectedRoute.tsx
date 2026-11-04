import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { Redirect, useLocation } from "wouter";
import AccessDenied from "@/pages/access-denied";
import { pathToPermission } from "@/lib/routePermissions";
import { AlertCircle, RotateCcw } from "lucide-react";
import { NeuButton, NeuCard, NeuPageShell } from "@/styles/neu";
import { NeuNotice } from "@/components/shared/NeuNotice";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, permissions, permissionsLoaded, permissionsReadyForRoute, permissionsError, refreshPermissions, user } = useAuth();
  const [location] = useLocation();

  console.log("ProtectedRoute - isLoading:", isLoading, "isAuthenticated:", isAuthenticated);

  if (isLoading || (isAuthenticated && user?.role !== "admin" && (!permissionsReadyForRoute || (!permissionsLoaded && !permissionsError)))) {
    return (
      <NeuPageShell className="flex min-h-screen items-center justify-center p-6">
        <NeuCard className="p-6 text-center" role="status" aria-live="polite">
          <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-[#27aab8]" />
          <p className="text-[#888]">Verifying authentication...</p>
        </NeuCard>
      </NeuPageShell>
    );
  }

  if (!isAuthenticated) {
    console.log("Not authenticated, redirecting to login");
    return <Redirect to="/login" />;
  }
  if (user?.role !== "admin" && permissionsError) {
    return <NeuPageShell className="flex min-h-[100dvh] items-center justify-center p-6">
      <NeuNotice severity="block" role="alert" className="max-w-lg">
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#b46a37]" />
          <div><h1 className="text-base font-bold text-[#344d48]">Access check could not finish</h1><p className="mt-1 text-sm text-[#687b75]">{permissionsError}</p>
            <NeuButton variant="accent" className="mt-4 min-h-9 px-4" onClick={() => void refreshPermissions()}><RotateCcw className="h-4 w-4" />Retry access check</NeuButton>
          </div>
        </div>
      </NeuNotice>
    </NeuPageShell>;
  }

  const requiredPermission = pathToPermission(location);
  if (requiredPermission && user?.role !== "admin" && !permissions.includes(requiredPermission)) {
    return <AccessDenied />;
  }

  console.log("Authenticated, rendering protected content");
  return <>{children}</>;
}