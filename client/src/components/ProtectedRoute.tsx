import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { Redirect } from "wouter";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth();

  console.log("ProtectedRoute - isLoading:", isLoading, "isAuthenticated:", isAuthenticated);

  if (isLoading) {
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

  console.log("Authenticated, rendering protected content");
  return <>{children}</>;
}