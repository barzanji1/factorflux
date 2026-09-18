import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { ProcessorIdentity } from "@/components/assignments/processor-assignment";
import {
  Plus,
  Search,
  Edit,
  Trash2,
  Mail,
  Phone,
  Building2,
  Users,
  ArrowRight,
  MapPin,
  CircleCheck,
  ExternalLink,
} from "lucide-react";
import type { Client } from "@shared/schema";
import { cn } from "@/lib/utils";

type ClientsResponse = {
  data: Client[];
  total: number;
  page: number;
  totalPages: number;
};

type CarrierReportRow = {
  clientId: number;
  outstanding: number;
};

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
  useEffect(() => {
    setProcessorFilter(isManager ? "all" : "me");
  }, [isManager]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const {
    data: clientsResponse,
    isLoading: clientsLoading,
    isError: clientsError,
    refetch: refetchClients,
  } = useQuery<ClientsResponse>({
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
  const displayClients = clients;
  const { data: carrierReport = [] } = useQuery<CarrierReportRow[]>({
    queryKey: ["/api/reports/carrier"],
    retry: false,
  });
  const outstandingByClientId = new Map(
    carrierReport.map((row) => [String(row.clientId), Number(row.outstanding) || 0]),
  );

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/clients/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      toast({ title: "Client deleted", description: "The client has been removed." });
      setDeletingId(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete client.", variant: "destructive" });
      setDeletingId(null);
    },
  });

  const handleDeleteClient = (client: Client) => {
    if (!window.confirm(`Delete "${client.name}"? This cannot be undone.`)) return;
    setDeletingId(client.id);
    deleteMutation.mutate(client.id);
  };

  const handleCreateClient = () => {
    window.location.href = "/carriers/new";
  };

  const handleEditClient = (client: Client) => {
    window.location.href = `/carriers/${client.id}/edit`;
  };

  const activeClients = clients.filter((client) => client.status === "active").length;
  const inactiveClients = clients.filter((client) => client.status !== "active").length;
  const clientsWithEmail = clients.filter((client) => !!client.email).length;

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Accounts"
          subtitle="Carrier and client relationships, contacts, and records"
          group="Workspace"
        />

        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8">
            <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative w-full max-w-xl">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                 <Input
                   placeholder="Search carriers by name, MC#, DOT#, email, or contact..."
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                   className="h-12 rounded-2xl pl-11 pr-4"
                 />
              </div>

               <div className="flex items-center gap-2">
                 <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                   {isManager && <button type="button" onClick={() => { setProcessorFilter("all"); setPage(1); }} className={cn("rounded-lg px-3 py-2 text-xs font-semibold", processorFilter === "all" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-500")}>All Carriers</button>}
                   <button type="button" onClick={() => { setProcessorFilter("me"); setPage(1); }} className={cn("rounded-lg px-3 py-2 text-xs font-semibold", processorFilter === "me" ? "bg-blue-600 text-white" : "text-slate-500")}>My Carriers</button>
                 </div>
                 <Button
                   onClick={handleCreateClient}
                   className="h-12 rounded-2xl bg-blue-600 px-5 text-white shadow-[0_10px_24px_rgba(37,99,235,0.22)] hover:bg-blue-700"
                 >
                   <Plus className="mr-2 h-4 w-4" />
                   Add Client
                 </Button>
               </div>
            </section>

            <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                  <Building2 className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Total Clients</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {totalClients}
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                  <CircleCheck className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Current page active clients</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {activeClients}
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                  <Users className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Current page inactive / other</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {inactiveClients}
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400">
                  <Mail className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Current page with email</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {clientsWithEmail}
                </p>
              </div>
            </section>

            <section>
              <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="mb-3 flex items-center gap-2">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                          <Building2 className="h-4.5 w-4.5" />
                        </div>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          Client Directory
                        </span>
                      </div>

                      <CardTitle className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                        All Clients
                      </CardTitle>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Browse contact details, status, and account records
                      </p>
                    </div>

                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      Showing{" "}
                      {totalClients === 0 ? 0 : (page - 1) * 50 + 1}-
                      {Math.min(page * 50, totalClients)} of {totalClients} carriers
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-6">
                  {clientsLoading ? (
                    <div className="space-y-3" aria-label="Loading clients">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <div
                          key={index}
                          className="h-14 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-900"
                        />
                      ))}
                    </div>
                  ) : clientsError ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-[20px] border border-red-200 bg-red-50 text-red-500 dark:border-red-900/40 dark:bg-red-950/20">
                        <Building2 className="h-6 w-6" />
                      </div>
                      <p className="font-semibold text-slate-900 dark:text-white">Failed to load clients</p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Check your connection and try again.</p>
                      <button
                        onClick={() => refetchClients()}
                        className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      >
                        Retry
                      </button>
                    </div>
                  ) : displayClients.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="ff-data-table w-full min-w-[900px]">
                        <thead>
                          <tr>
                            <th>Carrier Name</th>
                            <th>MC#</th>
                            <th>DOT#</th>
                            <th>Status</th>
                            <th>Active Since</th>
                            <th className="text-right">Outstanding</th>
                            <th>Assigned To</th>
                            <th className="pr-5">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayClients.map((client: Client) => (
                            <tr key={client.id}>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => navigate(`/clients/${client.id}`)}
                                  className="font-semibold text-slate-900 hover:text-blue-700 dark:text-white dark:hover:text-blue-300"
                                >
                                  {client.name || "Unnamed Client"}
                                </button>
                              </td>
                              <td className="font-mono text-xs text-slate-600 dark:text-slate-300">{client.mcNumber || "—"}</td>
                              <td className="font-mono text-xs text-slate-600 dark:text-slate-300">{client.dotNumber || "—"}</td>
                              <td>
                                <Badge
                                  className={cn(
                                    "rounded-full px-2.5 py-1 font-semibold capitalize",
                                    client.status === "active"
                                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                                      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                  )}
                                >
                                  {client.status.replace("_", " ")}
                                </Badge>
                              </td>
                              <td className="text-slate-600 dark:text-slate-300">
                                {client.createdAt ? new Date(client.createdAt).toLocaleDateString() : "—"}
                              </td>
                              <td className="text-right font-semibold text-slate-700 dark:text-slate-300">
                                {(outstandingByClientId.get(String(client.id)) ?? 0).toLocaleString("en-US", {
                                  style: "currency",
                                  currency: "USD",
                                })}
                              </td>
                              <td>
                                <ProcessorIdentity person={(client as any).assignedProcessorUser} compact />
                              </td>
                              <td className="pr-5">
                                <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => navigate(`/clients/${client.id}`)}
                                  className="h-9 rounded-xl px-3 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/20"
                                >
                                  <ExternalLink className="mr-1.5 h-4 w-4" />
                                  View
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEditClient(client)}
                                  className="h-9 rounded-xl px-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                                >
                                  <Edit className="mr-1.5 h-4 w-4" />
                                  Edit
                                </Button>
                                 {isManager && (
                                   <Button
                                     variant="ghost"
                                     size="sm"
                                     onClick={() => handleDeleteClient(client)}
                                     disabled={deletingId === client.id}
                                     className="h-9 rounded-xl px-3 text-red-500 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                                   >
                                     <Trash2 className="mr-1.5 h-4 w-4" />
                                     {deletingId === client.id ? "Deleting…" : "Delete"}
                                   </Button>
                                 )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-6 py-16 text-center">
                      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                        <Building2 className="h-6 w-6" />
                      </div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        No clients found
                      </p>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {debouncedSearch
                          ? "Try a different name, email, or contact person."
                          : "Add your first client to begin building your directory."}
                      </p>

                      {!debouncedSearch && (
                        <Button
                          className="mt-5 h-11 rounded-xl bg-blue-600 px-4 text-white hover:bg-blue-700"
                          onClick={handleCreateClient}
                        >
                          Add Your First Client
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                  {!clientsLoading && !clientsError && (
                    <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-5 dark:border-slate-800">
                      <Button
                        variant="outline"
                        className="rounded-xl"
                        disabled={page <= 1}
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                      >
                        Previous
                      </Button>
                      <span className="text-sm text-slate-500 dark:text-slate-400">
                        Page {page} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        className="rounded-xl"
                        disabled={page >= totalPages}
                        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </div>
        </main>
      </div>

    </div>
  );
}