import { useEffect } from "react";
import { useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";

// Invoice intake must not inherit the app-wide infinite cache lifetime.
export function useInvoiceEntityQuery<T>(options: UseQueryOptions<T, Error> & { enabled: boolean }) {
  const client = useQueryClient();
  const key = JSON.stringify(options.queryKey);
  const query = useQuery({
    ...options,
    staleTime: 0,
    refetchOnMount: "always",
  });
  useEffect(() => {
    if (!options.enabled) return;
    void client.invalidateQueries(
      { queryKey: JSON.parse(key), exact: true },
      { cancelRefetch: false },
    );
  }, [client, key, options.enabled]);

  // A cached success (including after a failed refresh) is not current data.
  return { ...query, data: query.isFetching || query.isError ? undefined : query.data };
}
