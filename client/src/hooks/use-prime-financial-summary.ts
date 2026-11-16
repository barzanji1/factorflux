import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PAGE_STALE_MS } from "@/lib/page-cache-policy";

/** Start URL-known financial reads alongside the parent record, not after it. */
export function usePrimeFinancialSummary(entity: "clients" | "brokers", id: number) {
  const client = useQueryClient();
  useEffect(() => {
    if (!Number.isSafeInteger(id) || id <= 0) return;
    void client.prefetchQuery({
      queryKey: [`/api/${entity}`, id, "financial-summary"],
      staleTime: PAGE_STALE_MS,
    });
  }, [client, entity, id]);
}
