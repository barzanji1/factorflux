import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { NeuBadge, NeuButton, NeuCard, NeuInput, NeuPageShell, NeuSelect, NeuStatCard, NeuTable, NeuTableBody, NeuTableCell, NeuTableHead, NeuTableHeader, NeuTableRow } from "@/styles/neu/components";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { ProcessorIdentity } from "@/components/assignments/processor-assignment";
import { Plus, Search, Trash2, Building2, Users, ArrowLeft, ArrowRight, CircleCheck, ExternalLink, Edit } from "lucide-react";
import type { Client } from "@shared/schema";

type ClientsResponse = { data: Client[]; total: number; page: number; totalPages: number };
type CarrierReportRow = { clientId: number; outstanding: number };

export default function Clients() {
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "manager";
  const [processorFilter, setProcessorFilter] = useState<"all" | "me">(isManager ? "all" : "me");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => setProcessorFilter(isManager ? "all" : "me"), [isManager]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedSearch(searchQuery.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const { data: clientsResponse, isLoading: clientsLoading, isError: clientsError, refetch: refetchClients } = useQuery<ClientsResponse>({
    queryKey: ["/api/clients", page, debouncedSearch, processorFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50", q: debouncedSearch });
      if (processorFilter === "me") params.set("processor", "me");
      const res = await fetch(`/api/clients?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load clients: ${res.status}`);
      return res.json();
    },
  });
  const clients = clientsResponse?.data ?? [];
  const totalClients = clientsResponse?.total ?? 0;
  const totalPages = clientsResponse?.totalPages ?? 1;
  const { data: carrierReport = [] } = useQuery<CarrierReportRow[]>({ queryKey: ["/api/reports/carrier"], retry: false });
  const outstandingByClientId = new Map(carrierReport.map((row) => [String(row.clientId), Number(row.outstanding) || 0]));
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/clients/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client deleted", description: "The client has been removed." });
      setDeletingId(null);
    },
    onError: () => { toast({ title: "Error", description: "Failed to delete client.", variant: "destructive" }); setDeletingId(null); },
  });
  const handleDeleteClient = (client: Client) => {
    if (!window.confirm(`Delete "${client.name}"? This cannot be undone.`)) return;
    setDeletingId(client.id);
    deleteMutation.mutate(client.id);
  };
  const handleCreateClient = () => { window.location.href = "/carriers/new"; };
  const handleEditClient = (client: Client) => { window.location.href = `/carriers/${client.id}/edit`; };
  const activeClients = clients.filter((client) => client.status === "active").length;
  const newClients = clients.filter((client) => client.status === "new_client").length;
  const inactiveClients = clients.filter((client) => client.status === "inactive").length;
  const currentPageRange = `${totalClients === 0 ? 0 : (page - 1) * 50 + 1}–${Math.min(page * 50, totalClients)}`;

  return (
    <div className="flex h-full min-h-0 bg-[#e0e0e0]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Accounts" subtitle="Carrier and client relationships, contacts, and records" group="Workspace" neu />
        <NeuPageShell className="custom-scrollbar !min-h-0 flex-1">
          <div className="mx-auto w-full max-w-[1680px] space-y-7 p-4 md:p-7 xl:p-9">
            <section className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative w-full max-w-xl">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#788b8d]" />
                <NeuInput aria-label="Search carriers" placeholder="Search by name, MC#, DOT#, email, or contact…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="pl-11" />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="carrier-processor-filter" className="sr-only">Carrier assignment filter</label>
                <NeuSelect id="carrier-processor-filter" value={processorFilter} onChange={(event) => { setProcessorFilter(event.target.value as "all" | "me"); setPage(1); }} className="w-auto min-w-40">
                  {isManager && <option value="all">All carriers</option>}
                  <option value="me">My carriers</option>
                </NeuSelect>
                <NeuButton variant="accent" onClick={handleCreateClient}><Plus className="h-4 w-4" />Add carrier</NeuButton>
              </div>
            </section>

            <section aria-label="Carrier totals">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-[#758587]">Portfolio snapshot</p><h2 className="mt-1 text-lg font-semibold text-[#354548]">Carrier relationships</h2></div>
                <p className="text-xs text-[#7b898a]">Status counts reflect this page · {currentPageRange} of {totalClients}</p>
              </div>
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <NeuStatCard label="Total carriers" value={totalClients} detail="Across this filtered directory" icon={<Building2 className="h-5 w-5" />} className="min-h-32 p-4" />
                <NeuStatCard label="Active · this page" value={activeClients} detail="Current page only" icon={<CircleCheck className="h-5 w-5" />} className="min-h-32 p-4" />
                <NeuStatCard label="New clients · this page" value={newClients} detail="Current page only" icon={<Users className="h-5 w-5" />} className="min-h-32 p-4" />
                <NeuStatCard label="Inactive · this page" value={inactiveClients} detail="Current page only" icon={<Users className="h-5 w-5" />} className="min-h-32 p-4" />
              </div>
            </section>

            <NeuCard className="overflow-hidden p-4 sm:p-6">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#758587]">Directory</p><h2 className="mt-1 text-xl font-semibold text-[#354548]">All carriers</h2><p className="mt-1 text-sm text-[#758587]">Contacts, status, funding exposure, and ownership</p></div>
                <NeuBadge tone="accent"><Building2 className="mr-1.5 h-3.5 w-3.5" />{clients.length} on this page</NeuBadge>
              </div>
              {clientsLoading ? <div className="space-y-3" aria-label="Loading carriers">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-xl bg-[#d2d2d2]" />)}</div>
                : clientsError ? <div className="flex flex-col items-center py-14 text-center"><Building2 className="mb-3 h-8 w-8 text-[#788b8d]" /><p className="font-semibold">Carrier records did not load</p><p className="mt-1 text-sm text-[#758587]">Check your connection and try again.</p><NeuButton className="mt-4" onClick={() => refetchClients()}>Retry</NeuButton></div>
                  : clients.length ? <NeuTable className="min-w-[900px]">
                    <NeuTableHeader><tr>{["Carrier", "MC#", "DOT#", "Status", "Active since", "Outstanding", "Assigned to", "Actions"].map((label) => <NeuTableHead key={label}>{label}</NeuTableHead>)}</tr></NeuTableHeader>
                    <NeuTableBody>{clients.map((client: Client) => <NeuTableRow key={client.id} className="border-t border-[#c9c9c9]">
                      <NeuTableCell><button type="button" onClick={() => navigate(`/clients/${client.id}`)} className="text-left font-semibold text-[#354548] hover:text-[#168d98]">{client.name || "Unnamed carrier"}</button></NeuTableCell>
                      <NeuTableCell className="font-mono text-xs">{client.mcNumber || "—"}</NeuTableCell>
                      <NeuTableCell className="font-mono text-xs">{client.dotNumber || "—"}</NeuTableCell>
                      <NeuTableCell><NeuBadge tone={client.status === "active" ? "success" : client.status === "new_client" ? "accent" : "neutral"}>{client.status.replace("_", " ")}</NeuBadge></NeuTableCell>
                      <NeuTableCell>{client.createdAt ? new Date(client.createdAt).toLocaleDateString() : "—"}</NeuTableCell>
                      <NeuTableCell className="font-semibold">{(outstandingByClientId.get(String(client.id)) ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" })}</NeuTableCell>
                      <NeuTableCell><ProcessorIdentity person={(client as any).assignedProcessorUser} compact /></NeuTableCell>
                      <NeuTableCell><div className="flex items-center gap-1">
                        <NeuButton aria-label={`View ${client.name}`} title="View carrier" onClick={() => navigate(`/clients/${client.id}`)} className="h-9 min-h-9 w-9 rounded-lg p-0"><ExternalLink className="h-4 w-4" /></NeuButton>
                        <NeuButton aria-label={`Edit ${client.name}`} title="Edit carrier" onClick={() => handleEditClient(client)} className="h-9 min-h-9 w-9 rounded-lg p-0"><Edit className="h-4 w-4" /></NeuButton>
                        {isManager && <NeuButton aria-label={`Delete ${client.name}`} title="Delete carrier" disabled={deletingId === client.id} onClick={() => handleDeleteClient(client)} className="h-9 min-h-9 w-9 rounded-lg p-0 text-[#a34e48]"><Trash2 className="h-4 w-4" /></NeuButton>}
                      </div></NeuTableCell>
                    </NeuTableRow>)}</NeuTableBody>
                  </NeuTable> : <div className="rounded-2xl border border-dashed border-[#bcbcbc] px-5 py-14 text-center"><Building2 className="mx-auto mb-3 h-8 w-8 text-[#839092]" /><p className="font-semibold">No carriers found</p><p className="mt-1 text-sm text-[#758587]">{debouncedSearch ? "Try a different name, email, or contact person." : "Add your first carrier to begin building the directory."}</p>{!debouncedSearch && <NeuButton variant="accent" className="mt-5" onClick={handleCreateClient}>Add first carrier<ArrowRight className="h-4 w-4" /></NeuButton>}</div>}
              {!clientsLoading && !clientsError && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#c5c5c5] pt-4">
                <p className="text-sm text-[#758587]">Showing {currentPageRange} of {totalClients} carriers</p>
                <div className="flex items-center gap-3"><NeuButton disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="min-h-10 px-4"><ArrowLeft className="h-4 w-4" />Previous</NeuButton><span className="text-sm font-medium text-[#5e6b6d]">Page {page} of {totalPages}</span><NeuButton disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="min-h-10 px-4">Next<ArrowRight className="h-4 w-4" /></NeuButton></div>
              </div>}
            </NeuCard>
          </div>
        </NeuPageShell>
      </div>
    </div>
  );
}
