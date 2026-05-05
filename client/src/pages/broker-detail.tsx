import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import RecordDetail, {
  DetailRow, DetailSection, EmptyTab,
} from "@/components/layout/record-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import {
  Building2, ReceiptText, Phone, Mail, MapPin, ShieldCheck,
  CreditCard, DollarSign, Clock, FileText, Edit2, Ban,
  CheckCircle2, AlertTriangle, User, Hash, TrendingUp,
  MessageSquare, Send,
} from "lucide-react";

// ─── Status badge ─────────────────────────────────────────────────────────────

function BrokerStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active:    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
    inactive:  "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
    suspended: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300",
  };
  return (
    <Badge className={cn("rounded-full border px-3 py-1 text-xs font-semibold shadow-sm", colors[status] ?? colors.inactive)}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

// ─── Invoice status badge ─────────────────────────────────────────────────────

function InvBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    approved:     "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
    funded:       "bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300",
    submitted:    "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300",
    under_review: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
    docs_pending: "bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300",
    rejected:     "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300",
    settled:      "bg-teal-100 text-teal-700 dark:bg-teal-950/30 dark:text-teal-300",
    draft:        "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", colors[status] ?? colors.draft)}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

const TERMS_LABEL: Record<string, string> = {
  quickpay: "Quick Pay", net15: "Net 15", net30: "Net 30",
  net45: "Net 45", net60: "Net 60",
};

const fmt = (v: string | number | null | undefined) =>
  v == null ? "—" : `$${parseFloat(String(v)).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function BrokerDetail() {
  const { id } = useParams<{ id: string }>();
  const brokerId = Number(id);
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [statusDialog, setStatusDialog] = useState(false);
  const [newStatus, setNewStatus] = useState<"active" | "inactive" | "suspended">("inactive");
  const [noteText, setNoteText] = useState("");

  const { data: broker, isLoading } = useQuery<any>({
    queryKey: ["/api/brokers", brokerId],
    queryFn: async () => {
      const r = await fetch(`/api/brokers/${brokerId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    enabled: !isNaN(brokerId),
  });

  const { data: allInvoices = [] } = useQuery<any[]>({
    queryKey: ["/api/invoices"],
    enabled: !isNaN(brokerId),
  });

  const brokerInvoices = allInvoices.filter(
    (inv: any) => inv.brokerId === brokerId || inv.debtorId === brokerId
  );

  const totalVolume = brokerInvoices.reduce((s: number, inv: any) => s + parseFloat(inv.amount ?? "0"), 0);
  const openCount   = brokerInvoices.filter((inv: any) => !["settled", "rejected"].includes(inv.status)).length;

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      apiRequest("PATCH", `/api/brokers/${brokerId}`, { status }),
    onSuccess: () => {
      toast({ title: "Status updated" });
      qc.invalidateQueries({ queryKey: ["/api/brokers", brokerId] });
      qc.invalidateQueries({ queryKey: ["/api/brokers"] });
      setStatusDialog(false);
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const notesMutation = useMutation({
    mutationFn: (notes: string) =>
      apiRequest("PATCH", `/api/brokers/${brokerId}`, { notes }),
    onSuccess: () => {
      toast({ title: "Notes saved" });
      qc.invalidateQueries({ queryKey: ["/api/brokers", brokerId] });
      setNoteText("");
    },
    onError: () => toast({ title: "Failed to save notes", variant: "destructive" }),
  });

  const isAdmin = user?.role === "admin" || user?.role === "manager";

  const creditUtilPct = broker?.creditLimit && totalVolume
    ? Math.min(100, Math.round((totalVolume / broker.creditLimit) * 100))
    : 0;

  return (
    <div className="flex h-screen bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.05),_transparent_30%),linear-gradient(to_bottom,_#f8fafc,_#f1f5f9)] dark:bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Broker Detail"
          subtitle="Debtor profile, credit terms, and linked invoices"
          group="Workspace"
        />
        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1400px] p-6 xl:p-8">
            <RecordDetail
              backHref="/brokers"
              backLabel="Back to Brokers"
              isLoading={isLoading}
              notFound={!isLoading && !broker}
              notFoundIcon={<Building2 className="h-8 w-8" />}
              notFoundLabel="Broker not found"
              icon={<Building2 className="h-7 w-7" />}
              iconBg="bg-violet-600 text-white shadow-[0_8px_20px_rgba(124,58,237,0.28)]"
              title={broker?.name ?? ""}
              titleSub={[
                broker?.city && broker?.state ? `${broker.city}, ${broker.state}` : null,
                broker?.mcNumber ? `MC# ${broker.mcNumber}` : null,
                broker?.dotNumber ? `DOT# ${broker.dotNumber}` : null,
              ].filter(Boolean).join(" · ")}
              statusBadge={broker ? <BrokerStatusBadge status={broker.status} /> : undefined}
              metrics={[
                { label: "Credit Limit", value: fmt(broker?.creditLimit), tint: "violet" },
                { label: "Total Volume", value: fmt(totalVolume), tint: "blue" },
                { label: "Open Invoices", value: String(openCount), tint: "amber" },
                { label: "All Invoices", value: String(brokerInvoices.length), tint: "slate" },
                { label: "Payment Terms", value: TERMS_LABEL[broker?.paymentTerms] ?? broker?.paymentTerms ?? "—", tint: "slate" },
              ]}
              alertBanner={creditUtilPct >= 90 ? (
                <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-3.5 dark:border-red-900/40 dark:bg-red-950/20">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                    Credit utilisation at {creditUtilPct}% — approaching or exceeding credit limit
                  </p>
                </div>
              ) : undefined}
              linkedRecords={[
                { label: "MC Number",   icon: <Hash className="h-4 w-4" />,      value: broker?.mcNumber || "—",     tint: "violet" },
                { label: "DOT Number",  icon: <ShieldCheck className="h-4 w-4" />, value: broker?.dotNumber || "—",    tint: "blue" },
                { label: "Contact",     icon: <User className="h-4 w-4" />,       value: broker?.contactPerson || "—", tint: "slate" },
                { label: "Email",       icon: <Mail className="h-4 w-4" />,       value: broker?.email || "—",         tint: "slate" },
                { label: "Phone",       icon: <Phone className="h-4 w-4" />,      value: broker?.phone || "—",         tint: "slate" },
              ]}
              actions={
                <div className="px-5 py-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Actions</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start gap-2 rounded-2xl border-slate-200 text-xs dark:border-slate-700"
                    onClick={() => window.location.href = `/brokers?edit=${brokerId}`}
                  >
                    <Edit2 className="h-3.5 w-3.5" />Edit Broker
                  </Button>
                  {isAdmin && broker && broker.status !== "active" && (
                    <Button size="sm" onClick={() => statusMutation.mutate("active")}
                      disabled={statusMutation.isPending}
                      className="w-full justify-start gap-2 rounded-2xl bg-emerald-600 text-xs text-white hover:bg-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />Activate Broker
                    </Button>
                  )}
                  {isAdmin && broker && broker.status === "active" && (
                    <Button size="sm" variant="outline"
                      onClick={() => { setNewStatus("suspended"); setStatusDialog(true); }}
                      className="w-full justify-start gap-2 rounded-2xl border-red-200 text-xs text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:text-red-400">
                      <Ban className="h-3.5 w-3.5" />Suspend Broker
                    </Button>
                  )}
                  <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
                    <p className="text-[11px] text-slate-400 mb-2">Credit limit utilisation</p>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div className={cn("h-full rounded-full transition-all", creditUtilPct >= 90 ? "bg-red-500" : creditUtilPct >= 70 ? "bg-amber-500" : "bg-emerald-500")}
                        style={{ width: `${creditUtilPct}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] font-semibold text-slate-500">{creditUtilPct}% of {fmt(broker?.creditLimit)}</p>
                  </div>
                </div>
              }
              rightExtra={
                <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-blue-600" />
                      <h3 className="text-xs font-semibold text-slate-700 dark:text-white">Payment Risk</h3>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-50 px-5 dark:divide-slate-800/60">
                    {[
                      { label: "Open Invoices", value: String(openCount), tint: openCount > 5 ? "red" : "slate" },
                      { label: "Total Exposure", value: fmt(totalVolume), tint: totalVolume > (broker?.creditLimit ?? 0) ? "red" : "emerald" },
                      { label: "Credit Limit", value: fmt(broker?.creditLimit), tint: "slate" },
                    ].map(r => (
                      <div key={r.label} className="flex items-center justify-between py-3">
                        <span className="text-xs text-slate-500">{r.label}</span>
                        <span className={cn("text-xs font-semibold",
                          r.tint === "red" ? "text-red-600 dark:text-red-400" :
                          r.tint === "emerald" ? "text-emerald-600 dark:text-emerald-400" :
                          "text-slate-700 dark:text-slate-300"
                        )}>{r.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              }
              tabs={[
                {
                  value: "overview",
                  label: "Overview",
                  icon: <Building2 className="h-3.5 w-3.5" />,
                  content: (
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      <DetailSection title="Contact Details">
                        <DetailRow label="Contact Person" value={broker?.contactPerson} />
                        <DetailRow label="Email" value={broker?.email} />
                        <DetailRow label="Phone" value={broker?.phone} />
                      </DetailSection>
                      <DetailSection title="Location">
                        <DetailRow label="Address" value={broker?.address} />
                        <DetailRow label="City" value={broker?.city} />
                        <DetailRow label="State" value={broker?.state} />
                        <DetailRow label="ZIP" value={broker?.zipCode} />
                      </DetailSection>
                      <DetailSection title="Credentials">
                        <DetailRow label="MC Number" value={broker?.mcNumber} />
                        <DetailRow label="DOT Number" value={broker?.dotNumber} />
                        <DetailRow label="Payment Terms" value={TERMS_LABEL[broker?.paymentTerms] ?? broker?.paymentTerms} />
                        <DetailRow label="Credit Limit" value={fmt(broker?.creditLimit)} />
                      </DetailSection>
                      <DetailSection title="Record">
                        <DetailRow label="Status" value={broker?.status} />
                        <DetailRow label="Created" value={fmtDate(broker?.createdAt)} />
                        <DetailRow label="Updated" value={fmtDate(broker?.updatedAt)} />
                      </DetailSection>
                    </div>
                  ),
                },
                {
                  value: "invoices",
                  label: "Invoices",
                  icon: <ReceiptText className="h-3.5 w-3.5" />,
                  count: brokerInvoices.length,
                  content: !brokerInvoices.length ? (
                    <EmptyTab icon={<ReceiptText className="h-7 w-7" />} label="No invoices linked to this broker" />
                  ) : (
                    <div className="space-y-2">
                      {brokerInvoices.map((inv: any) => (
                        <a key={inv.id} href={`/invoices/${inv.id}`}
                          className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 transition-colors hover:border-blue-200 hover:bg-blue-50/30 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:border-blue-900/40">
                          <div className="flex items-center gap-3">
                            <ReceiptText className="h-4 w-4 shrink-0 text-blue-500" />
                            <div>
                              <p className="text-sm font-semibold text-slate-800 dark:text-white">{inv.invoiceNumber}</p>
                              <p className="text-xs text-slate-400">{fmtDate(inv.invoiceDate ?? inv.createdAt)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{fmt(inv.amount)}</span>
                            <InvBadge status={inv.status} />
                          </div>
                        </a>
                      ))}
                    </div>
                  ),
                },
                {
                  value: "notes",
                  label: "Notes",
                  icon: <MessageSquare className="h-3.5 w-3.5" />,
                  content: (
                    <div className="space-y-4">
                      {broker?.notes && (
                        <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Current Notes</p>
                          <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{broker.notes}</p>
                        </div>
                      )}
                      {isAdmin && (
                        <div className="space-y-3">
                          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            {broker?.notes ? "Update Notes" : "Add Notes"}
                          </p>
                          <textarea
                            value={noteText}
                            onChange={e => setNoteText(e.target.value)}
                            placeholder="Add internal notes about this broker..."
                            rows={4}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          />
                          <Button size="sm"
                            disabled={notesMutation.isPending || !noteText.trim()}
                            onClick={() => notesMutation.mutate(noteText)}
                            className="gap-2 rounded-xl bg-violet-600 text-xs text-white hover:bg-violet-700">
                            <Send className="h-3.5 w-3.5" />
                            {notesMutation.isPending ? "Saving..." : "Save Notes"}
                          </Button>
                        </div>
                      )}
                      {!broker?.notes && !isAdmin && (
                        <EmptyTab icon={<MessageSquare className="h-7 w-7" />} label="No notes for this broker" />
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </main>
      </div>

      {/* Status change confirm dialog */}
      <Dialog open={statusDialog} onOpenChange={setStatusDialog}>
        <DialogContent className="max-w-sm rounded-3xl border-slate-200 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-red-500" />
              Suspend Broker
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Suspending this broker will flag all linked invoices. Are you sure?
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => setStatusDialog(false)}>Cancel</Button>
            <Button size="sm" className="rounded-xl bg-red-600 text-xs text-white hover:bg-red-700"
              disabled={statusMutation.isPending}
              onClick={() => statusMutation.mutate(newStatus)}>
              {statusMutation.isPending ? "Suspending..." : "Confirm Suspend"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
