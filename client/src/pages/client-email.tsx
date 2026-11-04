import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Mail, Send } from "lucide-react";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Button } from "@/components/ui/button";
import { NeuBadge, NeuButton, NeuCard, NeuPageShell, NeuSelect } from "@/styles/neu";
import { ClientEmailComposer, type EmailClient } from "@/components/client-email/client-email-composer";
import { ClientEmailLog } from "@/components/client-email/client-email-log";
import { EmailBroadcast } from "@/components/client-email/email-broadcast";
import { useAuth } from "@/hooks/useAuth";
import { PageInsights } from "@/components/PageInsights";
import "@/components/client-email/email-neu.css";

export default function ClientEmailPage() {
  const { hasPermission, permissionsLoaded, user } = useAuth();
  const canSend = hasPermission("client_email");
  const [composerOpen, setComposerOpen] = useState(false);
  const { data: clients = [], isLoading, error, refetch } = useQuery<EmailClient[]>({
    queryKey: ["/api/client-email/clients", user?.id],
    enabled: canSend,
    queryFn: async () => {
      const response = await fetch("/api/client-email/clients", { credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not load clients");
      if (!Array.isArray(result)) throw new Error("Client list response was invalid");
      return result;
    },
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selectedClient = clients.find((client) => client.id === selectedId);
  return <div className="flex min-h-[100dvh] bg-[#e0e0e0] text-[#344244]">
    <Sidebar />
    <div className="flex min-w-0 flex-1 flex-col">
      <TopNav title="Client email" subtitle="Send-only client communications" group="Workspace" />
      <div className="custom-scrollbar flex-1 overflow-auto">
        <NeuPageShell className="email-neu min-h-0 overflow-visible px-3 py-4 sm:px-5 sm:py-6">
        <div className="mx-auto max-w-[1180px] space-y-5">
          {canSend && <PageInsights entity="client-email" title="Client email activity" />}
          <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[#e0e0e0] px-5 py-5 shadow-[-6px_-6px_14px_#fff,6px_6px_14px_#b8b8b8]">
            <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#8fb3ae] bg-[#dcebe6] text-[#087f8e]"><Mail className="h-5 w-5" /></div><div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-[#758582]">Communications desk</p><h1 className="mt-0.5 text-xl font-bold tracking-tight text-[#203a46]">Email a client</h1><p className="mt-1 max-w-xl text-xs leading-relaxed text-[#637775]">Choose a client record as the primary recipient. Add optional CC addresses in the composer to copy others on this email.</p></div></div>
            {canSend && <NeuButton variant="accent" onClick={() => setComposerOpen(true)} className="min-h-10 rounded-xl px-4 text-xs"><Send className="h-3.5 w-3.5" />Compose email</NeuButton>}
          </header>
          <aside className="flex gap-2 rounded-xl bg-[#e0e0e0] p-3 text-[11px] leading-relaxed text-[#765f30] shadow-[inset_4px_4px_8px_#c6bca5,inset_-4px_-4px_8px_#fff9ec]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p><strong>Send-only:</strong> replies are monitored outside this app. There is no inbox reader. Review the recipient carefully before sending.</p></aside>
          {!permissionsLoaded && user?.role !== "admin" ? <NeuCard pressed className="h-20 animate-pulse" />
            : !canSend ? <NeuCard pressed className="p-4 text-xs text-[#526968]">You can view communication history from client profiles. Sending requires the Client Email permission.</NeuCard>
              : <>{user?.role === "admin" && canSend && <EmailBroadcast />}
                <NeuCard className="overflow-hidden p-0">
                <div className="flex items-center justify-between border-b border-[#c9cece] px-4 py-3"><div><h2 className="text-sm font-bold text-[#344244]">Recent communication</h2><p className="text-[10px] text-[#747f81]">Select a client to inspect its log</p></div><NeuBadge tone="accent">Client history</NeuBadge></div>
                <div className="p-3">
                  {isLoading ? <div className="grid gap-2 sm:grid-cols-2"><NeuCard pressed className="h-16 animate-pulse" /><NeuCard pressed className="h-16 animate-pulse" /></div>
                    : error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#e0e0e0] p-3 text-xs text-[#8d433a] shadow-[inset_4px_4px_8px_#d1b6b2,inset_-4px_-4px_8px_#fff]"><span>{(error as Error).message}</span><Button size="sm" onClick={() => void refetch()}>Retry</Button></div>
                      : clients.length === 0 ? <div className="rounded-xl bg-[#e0e0e0] px-4 py-8 text-center text-xs text-[#657977] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">{user?.role === "employee" ? <><p className="font-semibold text-[#405b5c]">No clients assigned to you</p><p className="mt-1">Ask an administrator to assign a client before sending email.</p></> : "No clients available for email."}</div>
                        : <div className="space-y-3"><label className="block text-[10px] font-bold uppercase tracking-wider text-[#71817e]" htmlFor="email-history-client">Client history</label><NeuSelect id="email-history-client" value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value ? Number(event.target.value) : null)} className="max-w-md text-xs"><option value="">Choose a client…</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.email || "No profile email"}</option>)}</NeuSelect>
                          {selectedClient && <ClientEmailLog clientId={selectedClient.id} />}
                        </div>}
                </div>
                </NeuCard></>}
        </div>
        </NeuPageShell>
      </div>
    </div>
    <ClientEmailComposer open={composerOpen} onOpenChange={setComposerOpen} />
  </div>;
}