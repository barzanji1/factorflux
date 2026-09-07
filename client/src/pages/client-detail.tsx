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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import InvoiceModal from "@/components/modals/invoice-modal";

import {
  Building2, ReceiptText, Phone, Mail, MapPin,
  FileText, Edit2, CheckCircle2, XCircle, User,
  Hash, Activity, MessageSquare, Send, DollarSign,
  Banknote, ShieldCheck, Plus, Eye, EyeOff,
} from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ClientStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active:   "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300",
    inactive: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
    pending:  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300",
  };
  return (
    <Badge className={cn("rounded-full border px-3 py-1 text-xs font-semibold shadow-sm", colors[status] ?? colors.inactive)}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

function InvStatusBadge({ status }: { status: string }) {
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

const fmt = (v: string | number | null | undefined) =>
  v == null ? "—" : `$${parseFloat(String(v)).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const clientId = Number(id);
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [noteText, setNoteText] = useState("");
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [editingBankAccount, setEditingBankAccount] = useState<any | null>(null);
  const [showRoutingNumber, setShowRoutingNumber] = useState(false);
  const [showAccountNumber, setShowAccountNumber] = useState(false);
  const [revealedAccountNumbers, setRevealedAccountNumbers] = useState<Record<number, string>>({});
  const [bankForm, setBankForm] = useState({
    bankName: "", accountType: "checking", routingNumber: "", accountNumber: "", nickname: "",
  });

  const { data: client, isLoading } = useQuery<any>({
    queryKey: ["/api/clients", clientId],
    queryFn: async () => {
      const r = await fetch(`/api/clients/${clientId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    enabled: !isNaN(clientId),
  });

  const { data: allInvoices = [] } = useQuery<any[]>({
    queryKey: ["/api/invoices"],
    enabled: !isNaN(clientId),
  });
  const clientInvoices = allInvoices.filter((inv: any) => inv.clientId === clientId);

  const { data: allDocs = [] } = useQuery<any[]>({
    queryKey: ["/api/documents"],
    enabled: !isNaN(clientId),
  });
  const clientDocs = allDocs.filter((doc: any) => doc.clientId === clientId);

  const { data: bankAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/carriers", clientId, "bank-accounts"],
    queryFn: async () => {
      const r = await fetch(`/api/carriers/${clientId}/bank-accounts`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load bank accounts");
      return r.json();
    },
    enabled: !isNaN(clientId),
  });

  const saveBankAccountMutation = useMutation({
    mutationFn: async () => apiRequest(editingBankAccount ? "PATCH" : "POST", editingBankAccount ? `/api/vault/${editingBankAccount.id}` : "/api/vault", {
      ...(editingBankAccount ? {} : { clientId, dataType: "bank_account" }),
      label: bankForm.nickname || bankForm.bankName,
      value: JSON.stringify(bankForm),
      notes: null,
    }),
    onSuccess: () => {
      toast({ title: editingBankAccount ? "Bank account updated" : "Bank account added to Vault" });
      setBankDialogOpen(false);
      setEditingBankAccount(null);
      setBankForm({ bankName: "", accountType: "checking", routingNumber: "", accountNumber: "", nickname: "" });
      qc.invalidateQueries({ queryKey: ["/api/carriers", clientId, "bank-accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/vault", clientId] });
    },
    onError: () => toast({ title: "Failed to add bank account", variant: "destructive" }),
  });

  const deleteBankAccountMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/vault/${id}`),
    onSuccess: () => {
      toast({ title: "Bank account removed" });
      qc.invalidateQueries({ queryKey: ["/api/carriers", clientId, "bank-accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/vault", clientId] });
    },
    onError: () => toast({ title: "Failed to remove bank account", variant: "destructive" }),
  });

  const openAddBankAccount = () => {
    setEditingBankAccount(null);
    setBankForm({ bankName: "", accountType: "checking", routingNumber: "", accountNumber: "", nickname: "" });
    setShowRoutingNumber(false);
    setShowAccountNumber(false);
    setBankDialogOpen(true);
  };

  const openEditBankAccount = (account: any) => {
    setEditingBankAccount(account);
    setBankForm({ bankName: account.bankName, accountType: account.accountType || "checking", routingNumber: "", accountNumber: "", nickname: account.nickname || "" });
    setShowRoutingNumber(false);
    setShowAccountNumber(false);
    setBankDialogOpen(true);
  };

  const toggleSavedAccountNumber = async (accountId: number) => {
    if (revealedAccountNumbers[accountId]) {
      setRevealedAccountNumbers(values => {
        const next = { ...values };
        delete next[accountId];
        return next;
      });
      return;
    }
    try {
      const response = await fetch(`/api/vault/entry/${accountId}`, { credentials: "include" });
      if (!response.ok) throw new Error();
      const entry = await response.json();
      const data = JSON.parse(entry.decryptedValue);
      const accountNumber = String(data.accountNumber || "");
      setRevealedAccountNumbers(values => ({ ...values, [accountId]: accountNumber }));
      window.setTimeout(() => setRevealedAccountNumbers(values => {
        const next = { ...values };
        delete next[accountId];
        return next;
      }), 30000);
    } catch {
      toast({ title: "Could not reveal account number", variant: "destructive" });
    }
  };

  const totalFunded = clientInvoices
    .filter((inv: any) => ["funded", "settled"].includes(inv.status))
    .reduce((s: number, inv: any) => s + parseFloat(inv.amount ?? "0"), 0);

  const outstanding = clientInvoices
    .filter((inv: any) => !["settled", "rejected"].includes(inv.status))
    .reduce((s: number, inv: any) => s + parseFloat(inv.amount ?? "0"), 0);

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      apiRequest("PUT", `/api/clients/${clientId}`, { ...client, status }),
    onSuccess: () => {
      toast({ title: "Status updated" });
      qc.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      qc.invalidateQueries({ queryKey: ["/api/clients"] });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const notesMutation = useMutation({
    mutationFn: (notes: string) =>
      apiRequest("PUT", `/api/clients/${clientId}`, { ...client, notes }),
    onSuccess: () => {
      toast({ title: "Notes saved" });
      qc.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      setNoteText("");
    },
    onError: () => toast({ title: "Failed to save notes", variant: "destructive" }),
  });

  const isAdmin = user?.role === "admin" || user?.role === "manager";

  return (
    <div className="flex h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.05),_transparent_30%),linear-gradient(to_bottom,_#f8fafc,_#f1f5f9)] dark:bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Client / Carrier Detail"
          subtitle="Account profile, invoice history, and documents"
          group="Workspace"
        />
        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1400px] p-6 xl:p-8">
            <RecordDetail
              backHref="/clients"
              backLabel="Back to Accounts"
              isLoading={isLoading}
              notFound={!isLoading && !client}
              notFoundIcon={<Building2 className="h-8 w-8" />}
              notFoundLabel="Client not found"
              icon={<Building2 className="h-7 w-7" />}
              iconBg="bg-emerald-600 text-white shadow-[0_8px_20px_rgba(16,185,129,0.28)]"
              title={client?.name ?? ""}
              titleSub={[
                client?.contactPerson ? `Contact: ${client.contactPerson}` : null,
                client?.mcNumber ? `MC# ${client.mcNumber}` : null,
              ].filter(Boolean).join(" · ")}
              statusBadge={client ? <ClientStatusBadge status={client.status} /> : undefined}
              metrics={[
                { label: "Outstanding",   value: fmt(outstanding),              tint: "amber"   },
                { label: "Total Funded",  value: fmt(totalFunded),              tint: "emerald" },
                { label: "Invoices",      value: String(clientInvoices.length), tint: "blue"    },
                { label: "Documents",     value: String(clientDocs.length),     tint: "slate"   },
                { label: "Active Since",  value: fmtDate(client?.createdAt),    tint: "slate"   },
              ]}
              linkedRecords={[
                { label: "MC Number", icon: <Hash className="h-4 w-4" />,    value: client?.mcNumber || "—",    tint: "emerald" },
                { label: "Contact",   icon: <User className="h-4 w-4" />,    value: client?.contactPerson || "—", tint: "slate" },
                { label: "Email",     icon: <Mail className="h-4 w-4" />,    value: client?.email || "—",       tint: "slate" },
                { label: "Phone",     icon: <Phone className="h-4 w-4" />,   value: client?.phone || "—",       tint: "slate" },
              ]}
              actions={
                <div className="px-5 py-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Actions</p>
                  <Button variant="outline" size="sm"
                    className="w-full justify-start gap-2 rounded-2xl border-slate-200 text-xs dark:border-slate-700"
                    onClick={() => window.location.href = `/carriers/${clientId}/edit`}>
                    <Edit2 className="h-3.5 w-3.5" />Edit Client
                  </Button>
                  <Button
                    size="sm"
                    className="w-full justify-start gap-2 rounded-2xl bg-[#098b9f] text-xs text-white hover:bg-[#08798b]"
                    onClick={() => setIsInvoiceModalOpen(true)}
                  >
                    <Plus className="h-3.5 w-3.5" />Create Invoice
                  </Button>
                  <Button variant="outline" size="sm"
                    className="w-full justify-start gap-2 rounded-2xl border-slate-200 text-xs dark:border-slate-700"
                    onClick={openAddBankAccount}>
                    <Banknote className="h-3.5 w-3.5" />Add Bank Account
                  </Button>
                  {bankAccounts.length > 0 && <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Bank Accounts</p>
                    {bankAccounts.map((account: any) => <div key={account.id} className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
                      <p className="truncate text-xs font-semibold">{account.nickname || account.bankName}</p>
                      <div className="flex items-center justify-between gap-1">
                        <p className="min-w-0 truncate text-[10px] text-slate-500">{account.bankName} · {account.accountType || "account"} · {revealedAccountNumbers[account.id] || `•••• ${account.lastFour}`}</p>
                        <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => toggleSavedAccountNumber(account.id)} aria-label={revealedAccountNumbers[account.id] ? "Hide account number" : "Show account number"}>
                          {revealedAccountNumbers[account.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                      <div className="mt-2 flex gap-1">
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => openEditBankAccount(account)}>Edit</Button>
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] text-red-600" onClick={() => {
                          if (window.confirm(`Remove ${account.nickname || account.bankName}? This bank account will no longer be available for funding.`)) deleteBankAccountMutation.mutate(account.id);
                        }}>Delete</Button>
                      </div>
                    </div>)}
                  </div>}
                  {isAdmin && client?.status !== "active" && (
                    <Button size="sm"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate("active")}
                      className="w-full justify-start gap-2 rounded-2xl bg-emerald-600 text-xs text-white hover:bg-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />Activate Client
                    </Button>
                  )}
                  {isAdmin && client?.status === "active" && (
                    <Button size="sm" variant="outline"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate("inactive")}
                      className="w-full justify-start gap-2 rounded-2xl border-amber-200 text-xs text-amber-700 hover:bg-amber-50 dark:border-amber-900/40 dark:text-amber-400">
                      <XCircle className="h-3.5 w-3.5" />Set Inactive
                    </Button>
                  )}
                  <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
                    <p className="text-[11px] text-slate-400 mb-1.5">Invoice summary</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-blue-50 p-2.5 text-center dark:bg-blue-950/20">
                        <p className="text-lg font-bold text-blue-700 dark:text-blue-300">{clientInvoices.length}</p>
                        <p className="text-[10px] text-blue-600/70 dark:text-blue-400/70">Total</p>
                      </div>
                      <div className="rounded-xl bg-amber-50 p-2.5 text-center dark:bg-amber-950/20">
                        <p className="text-lg font-bold text-amber-700 dark:text-amber-300">
                          {clientInvoices.filter((i: any) => !["settled","rejected"].includes(i.status)).length}
                        </p>
                        <p className="text-[10px] text-amber-600/70 dark:text-amber-400/70">Open</p>
                      </div>
                    </div>
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
                      <DetailSection title="Contact Information">
                        <DetailRow label="Contact Person" value={client?.contactPerson} />
                        <DetailRow label="Email" value={client?.email} />
                        <DetailRow label="Phone" value={client?.phone} />
                      </DetailSection>
                      <DetailSection title="Address">
                        <DetailRow label="Address" value={client?.address} />
                        <DetailRow label="City" value={client?.city} />
                        <DetailRow label="State" value={client?.state} />
                        <DetailRow label="ZIP" value={client?.zipCode} />
                      </DetailSection>
                      <DetailSection title="Credentials & Rates">
                        <DetailRow label="MC Number" value={client?.mcNumber} />
                        <DetailRow label="DOT Number" value={client?.dotNumber} />
                        <DetailRow label="Factoring Rate" value={client?.factoringRate ? `${client.factoringRate}%` : null} />
                      </DetailSection>
                      <DetailSection title="Record">
                        <DetailRow label="Status" value={client?.status} />
                        <DetailRow label="Created" value={fmtDate(client?.createdAt)} />
                        <DetailRow label="Updated" value={fmtDate(client?.updatedAt)} />
                      </DetailSection>
                    </div>
                  ),
                },
                {
                  value: "invoices",
                  label: "Invoices",
                  icon: <ReceiptText className="h-3.5 w-3.5" />,
                  count: clientInvoices.length,
                  content: (
                    <div className="space-y-4">
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          className="gap-2 rounded-xl bg-[#098b9f] text-white hover:bg-[#08798b]"
                          onClick={() => setIsInvoiceModalOpen(true)}
                        >
                          <Plus className="h-4 w-4" />
                          Create Invoice
                        </Button>
                      </div>
                      {!clientInvoices.length ? (
                        <EmptyTab icon={<ReceiptText className="h-7 w-7" />} label="No invoices for this client yet" />
                      ) : (
                        <div className="space-y-2">
                          {clientInvoices.map((inv: any) => (
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
                            <InvStatusBadge status={inv.status} />
                          </div>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  value: "documents",
                  label: "Documents",
                  icon: <FileText className="h-3.5 w-3.5" />,
                  count: clientDocs.length,
                  content: !clientDocs.length ? (
                    <EmptyTab icon={<FileText className="h-7 w-7" />} label="No documents uploaded for this client" />
                  ) : (
                    <div className="space-y-2">
                      {clientDocs.map((doc: any) => (
                        <div key={doc.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
                          <div className="flex items-center gap-3">
                            <FileText className="h-4 w-4 shrink-0 text-amber-500" />
                            <div>
                              <p className="text-sm font-medium text-slate-800 dark:text-white">{doc.originalName ?? doc.filename}</p>
                              <p className="text-xs text-slate-400">{doc.documentType?.replace(/_/g, " ")} · {doc.size ? `${(doc.size / 1024).toFixed(1)} KB` : ""}</p>
                            </div>
                          </div>
                          <Badge className={cn("rounded-full border px-2.5 py-0.5 text-[11px]",
                            doc.status === "processed"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-amber-200 bg-amber-50 text-amber-700"
                          )}>
                            {doc.status}
                          </Badge>
                        </div>
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
                      {client?.notes && (
                        <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Current Notes</p>
                          <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{client.notes}</p>
                        </div>
                      )}
                      {isAdmin && (
                        <div className="space-y-3">
                          <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            {client?.notes ? "Update Notes" : "Add Notes"}
                          </p>
                          <textarea
                            value={noteText}
                            onChange={e => setNoteText(e.target.value)}
                            placeholder="Add internal notes about this client..."
                            rows={4}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          />
                          <Button size="sm"
                            disabled={notesMutation.isPending || !noteText.trim()}
                            onClick={() => notesMutation.mutate(noteText)}
                            className="gap-2 rounded-xl bg-emerald-600 text-xs text-white hover:bg-emerald-700">
                            <Send className="h-3.5 w-3.5" />
                            {notesMutation.isPending ? "Saving..." : "Save Notes"}
                          </Button>
                        </div>
                      )}
                      {!client?.notes && !isAdmin && (
                        <EmptyTab icon={<MessageSquare className="h-7 w-7" />} label="No notes for this client" />
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </main>
      </div>
      <Dialog open={bankDialogOpen} onOpenChange={setBankDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBankAccount ? "Edit Bank Account" : "Add Bank Account to Vault"}</DialogTitle>
            <DialogDescription>{editingBankAccount ? "Re-enter routing and account numbers to securely replace this account." : "Account and routing numbers are encrypted before storage."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Bank Name</Label><Input value={bankForm.bankName} onChange={e => setBankForm(v => ({ ...v, bankName: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Account Nickname</Label><Input placeholder="Primary operating" value={bankForm.nickname} onChange={e => setBankForm(v => ({ ...v, nickname: e.target.value }))} /></div>
            <div className="space-y-1.5"><Label>Account Type</Label>
              <Select value={bankForm.accountType} onValueChange={accountType => setBankForm(v => ({ ...v, accountType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="checking">Checking</SelectItem><SelectItem value="savings">Savings</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Routing Number</Label><div className="relative"><Input className="pr-10" type={showRoutingNumber ? "text" : "password"} inputMode="numeric" autoComplete="off" value={bankForm.routingNumber} onChange={e => setBankForm(v => ({ ...v, routingNumber: e.target.value.replace(/\D/g, "").slice(0, 9) }))} /><Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2" onClick={() => setShowRoutingNumber(v => !v)} aria-label={showRoutingNumber ? "Hide routing number" : "Show routing number"}>{showRoutingNumber ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button></div></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>Account Number</Label><div className="relative"><Input className="pr-10" type={showAccountNumber ? "text" : "password"} inputMode="numeric" autoComplete="new-password" value={bankForm.accountNumber} onChange={e => setBankForm(v => ({ ...v, accountNumber: e.target.value.replace(/\D/g, "") }))} /><Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2" onClick={() => setShowAccountNumber(v => !v)} aria-label={showAccountNumber ? "Hide account number" : "Show account number"}>{showAccountNumber ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button></div></div>
          </div>
          {bankAccounts.length > 0 && <p className="text-xs text-slate-500">{bankAccounts.length} account{bankAccounts.length === 1 ? "" : "s"} currently on file.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBankDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => saveBankAccountMutation.mutate()} disabled={saveBankAccountMutation.isPending || !bankForm.bankName.trim() || bankForm.routingNumber.length !== 9 || !bankForm.accountNumber.trim()}>
              {editingBankAccount ? "Save Changes" : "Save to Vault"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <InvoiceModal
        isOpen={isInvoiceModalOpen}
        onClose={() => setIsInvoiceModalOpen(false)}
        initialClient={client ?? null}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["/api/invoices"] });
          qc.invalidateQueries({ queryKey: ["/api/clients", clientId] });
        }}
      />
    </div>
  );
}
