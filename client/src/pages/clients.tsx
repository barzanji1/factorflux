import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import ClientModal from "@/components/modals/client-modal";
import type { Client } from "@shared/schema";
import { cn } from "@/lib/utils";

export default function Clients() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const {
    data: clients = [],
    isLoading: clientsLoading,
    refetch: refetchClients,
  } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients", {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
      });

      const contentType = res.headers.get("content-type") || "";

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to fetch clients: ${res.status} ${text.slice(0, 200)}`);
      }

      if (!contentType.includes("application/json")) {
        const text = await res.text();
        throw new Error(`Expected JSON from /api/clients but got: ${text.slice(0, 200)}`);
      }

      const data = await res.json();
      console.log("GET /api/clients response:", data);
      return data;
    },
  });

  const { data: searchResults = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients/search", searchQuery],
    enabled: searchQuery.trim().length > 0,
    queryFn: async () => {
      const res = await fetch(
        `/api/clients/search?q=${encodeURIComponent(searchQuery)}`,
        {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
        }
      );

      const contentType = res.headers.get("content-type") || "";

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to search clients: ${res.status} ${text.slice(0, 200)}`);
      }

      if (!contentType.includes("application/json")) {
        const text = await res.text();
        throw new Error(
          `Expected JSON from /api/clients/search but got: ${text.slice(0, 200)}`
        );
      }

      const data = await res.json();
      console.log("GET /api/clients/search response:", data);
      return data;
    },
  });

  const displayClients = searchQuery.trim() ? searchResults : clients;

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
    setSelectedClient(null);
    setIsClientModalOpen(true);
  };

  const handleEditClient = (client: Client) => {
    setSelectedClient(client);
    setIsClientModalOpen(true);
  };

  const totalClients = clients.length;
  const activeClients = clients.filter((client) => client.status === "active").length;
  const inactiveClients = clients.filter((client) => client.status !== "active").length;
  const clientsWithEmail = clients.filter((client) => !!client.email).length;

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Clients"
          subtitle="Manage relationships, contacts, and client records"
        />

        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8">
            <section className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative w-full max-w-xl">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search clients by name, email, or contact person..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-12 rounded-2xl pl-11 pr-4"
                />
              </div>

              <Button
                onClick={handleCreateClient}
                className="h-12 rounded-2xl bg-blue-600 px-5 text-white shadow-[0_10px_24px_rgba(37,99,235,0.22)] hover:bg-blue-700"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Client
              </Button>
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
                <p className="text-sm text-slate-500 dark:text-slate-400">Active Clients</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {activeClients}
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                  <Users className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Inactive / Other</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {inactiveClients}
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400">
                  <Mail className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">With Email</p>
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
                      {searchQuery ? (
                        <>Showing results for “{searchQuery}”</>
                      ) : (
                        <>
                          Showing {displayClients.length} client
                          {displayClients.length === 1 ? "" : "s"}
                        </>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-6">
                  {clientsLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                    </div>
                  ) : displayClients.length > 0 ? (
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3">
                      {displayClients.map((client: Client) => (
                        <Card
                          key={client.id}
                          className="group rounded-[22px] border border-slate-200 bg-white transition-all duration-200 hover:-translate-y-1 hover:border-blue-100 hover:shadow-[0_16px_40px_rgba(37,99,235,0.10)] dark:border-slate-800 dark:bg-transparent dark:hover:border-blue-950/40"
                        >
                          <CardHeader className="pb-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <CardTitle className="truncate text-lg font-semibold text-slate-900 dark:text-white">
                                  {client.name || "Unnamed Client"}
                                </CardTitle>
                                {client.contactPerson && (
                                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                    Contact: {client.contactPerson}
                                  </p>
                                )}
                              </div>

                              <Badge
                                className={cn(
                                  "rounded-full px-2.5 py-1 font-semibold capitalize",
                                  client.status === "active"
                                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                                    : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                )}
                              >
                                {client.status}
                              </Badge>
                            </div>
                          </CardHeader>

                          <CardContent className="space-y-4">
                            <div className="space-y-3">
                              {client.email && (
                                <div className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300">
                                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                                    <Mail className="h-4 w-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                      Email
                                    </p>
                                    <p className="truncate">{client.email}</p>
                                  </div>
                                </div>
                              )}

                              {client.phone && (
                                <div className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300">
                                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                                    <Phone className="h-4 w-4" />
                                  </div>
                                  <div>
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                      Phone
                                    </p>
                                    <p>{client.phone}</p>
                                  </div>
                                </div>
                              )}

                              {client.address && (
                                <div className="flex items-start gap-3 text-sm text-slate-600 dark:text-slate-300">
                                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                                    <MapPin className="h-4 w-4" />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                                      Address
                                    </p>
                                    <p className="line-clamp-2">{client.address}</p>
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                Created{" "}
                                {client.createdAt
                                  ? new Date(client.createdAt).toLocaleDateString()
                                  : "—"}
                              </span>

                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEditClient(client)}
                                  className="h-9 rounded-xl px-3 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                                >
                                  <Edit className="mr-1.5 h-4 w-4" />
                                  Edit
                                </Button>
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
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
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
                        {searchQuery
                          ? "Try a different name, email, or contact person."
                          : "Add your first client to begin building your directory."}
                      </p>

                      {!searchQuery && (
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
                </CardContent>
              </Card>
            </section>
          </div>
        </main>
      </div>

      <ClientModal
        isOpen={isClientModalOpen}
        onClose={() => {
          setIsClientModalOpen(false);
          refetchClients();
        }}
        client={selectedClient}
      />
    </div>
  );
}