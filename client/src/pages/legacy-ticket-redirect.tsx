import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { PageShell, Win95Button as Button, Win95Card as Card, Win95CardContent as CardContent } from "@/components/win95";

type LegacyRequest = { id: number | string };

async function getLegacyRequest(id: string): Promise<LegacyRequest> {
  const response = await fetch(`/api/it-support/legacy/${encodeURIComponent(id)}`, {
    credentials: "include",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || `Request failed (${response.status})`);
  }
  if (payload.id === undefined || payload.id === null) {
    throw new Error("The legacy ticket did not resolve to a support request.");
  }
  return payload as LegacyRequest;
}

export default function LegacyTicketRedirect() {
  const { id = "" } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const legacyQuery = useQuery({
    queryKey: ["/api/it-support/legacy", user?.id, id],
    queryFn: () => getLegacyRequest(id),
    enabled: !!id && !!user?.id,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (legacyQuery.data) {
      setLocation(`/it-support?requestId=${encodeURIComponent(String(legacyQuery.data.id))}`);
    }
  }, [legacyQuery.data, setLocation]);

  return (
    <PageShell title="IT Support" subtitle="Opening your support request" group="Workspace" contentClassName="p-3 sm:p-5 xl:p-7">
      <Card>
        <CardContent className="flex min-h-24 items-center gap-3">
          {legacyQuery.isError ? (
            <>
              <AlertCircle className="h-5 w-5 shrink-0 text-[#812f25]" />
              <div className="min-w-0 flex-1" role="alert">
                <p className="font-bold text-[#812f25]">Could not open this ticket</p>
                <p className="mt-1 text-sm text-[#505050]">{(legacyQuery.error as Error).message}</p>
              </div>
              <Button onClick={() => legacyQuery.refetch()}>Retry</Button>
            </>
          ) : (
            <>
              <div className="h-5 w-5 animate-pulse border-2 border-[#087f8c] bg-[#d4d0c8]" />
              <div className="flex-1" role="status" aria-live="polite">
                <p className="font-bold text-[#292929]">Finding your support request</p>
                <p className="mt-1 text-sm text-[#666]">Loading ticket {id}…</p>
                <div className="mt-3 h-2 max-w-sm animate-pulse bg-[#e8e6e1]" />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
