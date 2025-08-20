import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

export function useAuth() {
  const { data: user, isLoading, error } = useQuery({
    queryKey: ["/api/auth/local/check"],
    queryFn: async () => {
      try {
        const response = await fetch('/api/auth/local/check', {
          credentials: 'include',
        });
        
        if (response.ok) {
          const data = await response.json();
          return data.authenticated ? data.user : null;
        }
        
        return null;
      } catch (error) {
        console.error('Auth check error:', error);
        return null;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    error,
  };
}
