import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Mail, Send } from "lucide-react";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Button } from "@/components/ui/button";
import { ClientEmailComposer, type EmailClient } from "@/components/client-email/client-email-composer";
import { ClientEmailLog } from "@/components/client-email/client-email-log";
import { EmailBroadcast } from "@/components/client-email/email-broadcast";
import { useAuth } from "@/hooks/useAuth";

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
  return <div className="flex min-h-[100dvh] bg-[#d4d0c8] text-[#263b44]">
    <Sidebar />
    <div className="flex min-w-0 flex-1 flex-col">
      <TopNav title="Client email" subtitle="Send-only client communications" group="Workspace" />
      <main className="custom-scrollbar flex-1 overflow-auto">
        <div className="mx-auto max-w-[1180px] space-y-4 p-3 md:p-5">
          <header className="flex flex-wrap items-center justify-between gap-4 border border-[#899795] bg-[#eaf0ed] px-4 py-4 shadow-[1px_1px_0_#fff]">
            <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#8fb3ae] bg-[#dcebe6] text-[#087f8e]"><Mail className="h-5 w-5" /></div><div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-[#758582]">Communications desk</p><h1 className="mt-0.5 text-xl font-bold tracking-tight text-[#203a46]">Email a client</h1><p className="mt-1 max-w-xl text-xs leading-relaxed text-[#637775]">Choose a client record as the primary recipient. Add optional CC addresses in the composer to copy others on this email.</p></div></div>
            {canSend && <Button onClick={() => setComposerOpen(true)} className="h-9 rounded-sm bg-[#087f8e] px-4 text-xs font-bold text-white hover:bg-[#076c78]"><Send className="mr-2 h-3.5 w-3.5" />Compose email</Button>}
          </header>
          <aside className="flex gap-2 border border-[#d1b579] bg-[#fff8e9] p-3 text-[11px] leading-relaxed text-[#765f30]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p><strong>Send-only:</strong> replies are monitored outside this app. There is no inbox reader. Review the recipient carefully before sending.</p></aside>
          {!permissionsLoaded && user?.role !== "admin" ? <div className="h-20 animate-pulse border border-[#c5cecb] bg-[#e8eeeb]" />
            : !canSend ? <div className="border border-[#b9c7c2] bg-[#edf3f0] p-4 text-xs text-[#526968]">You can view communication history from client profiles. Sending requires the Client Email permission.</div>
              : <>{user?.role === "admin" && canSend && <EmailBroadcast />}
                <section className="border border-[#9aa7a5] bg-[#edf2ef] shadow-[1px_1px_0_#fff]">
                <div className="border-b border-[#c4cfcb] bg-[#dfe8e4] px-3 py-2"><h2 className="text-sm font-bold text-[#263f48]">Recent communication</h2><p className="text-[10px] text-[#697c7d]">Select a client to inspect its log</p></div>
                <div className="p-3">
                  {isLoading ? <div className="grid gap-2 sm:grid-cols-2"><div className="h-16 animate-pulse bg-[#dce5e1]" /><div className="h-16 animate-pulse bg-[#dce5e1]" /></div>
                    : error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border border-[#d3a49e] bg-[#fff1ee] p-3 text-xs text-[#8d433a]"><span>{(error as Error).message}</span><Button size="sm" variant="outline" onClick={() => void refetch()}>Retry</Button></div>
                      : clients.length === 0 ? <div className="border border-dashed border-[#bdc9c5] bg-[#f6f8f6] px-4 py-8 text-center text-xs text-[#657977]">{user?.role === "employee" ? <><p className="font-semibold text-[#405b5c]">No clients assigned to you</p><p className="mt-1">Ask an administrator to assign a client before sending email.</p></> : "No clients available for email."}</div>
                        : <div className="space-y-3"><label className="block text-[10px] font-bold uppercase tracking-wider text-[#71817e]" htmlFor="email-history-client">Client history</label><select id="email-history-client" value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value ? Number(event.target.value) : null)} className="h-9 w-full max-w-md rounded-sm border border-[#aebbb7] bg-white px-2 text-xs text-[#334c50] focus:outline-none focus:ring-1 focus:ring-[#087f8e]"><option value="">Choose a client…</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.email || "No profile email"}</option>)}</select>
                          {selectedClient && <ClientEmailLog clientId={selectedClient.id} />}
                        </div>}
                </div>
                </section></>}
        </div>
      </main>
    </div>
    <ClientEmailComposer open={composerOpen} onOpenChange={setComposerOpen} />
  </div>;
}