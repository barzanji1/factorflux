import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import InvoiceModal from "@/components/modals/invoice-modal";
import { AgingPdfDownload } from "@/components/reports/aging-pdf-download";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ProfileSection, ProfileField, EmptyState, DocumentList } from "@/components/carriers/carrier-profile-section";
import { DriverSection } from "@/components/carriers/driver-section";
import { ArrowLeft, CheckCircle2, CircleAlert, Download, Edit2, Eye, EyeOff, FileText, Mail, MessageSquare, Phone, Plus, ShieldCheck, Truck, UserRound, XCircle, ChevronDown, Trash2, Pencil } from "lucide-react";

const money = (value: unknown) => value === null || value === undefined || value === "" ? "Not recorded" : `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not recorded";
const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "Not recorded";
const pretty = (value: unknown) => value === true ? "Yes" : value === false ? "No" : value == null || value === "" ? undefined : String(value);
const first = (obj: any, ...keys: string[]) => keys.map((key) => obj?.[key]).find((value) => value !== undefined && value !== null && value !== "");

function StatusBadge({ status }: { status?: string }) {
  return <span className={cn("inline-flex items-center gap-1 border px-2 py-1 text-[10px] font-bold uppercase tracking-wide", status === "active" ? "border-[#85c7b1] bg-[#e9f7f1] text-[#167152]" : "border-[#d7b46c] bg-[#fff8e8] text-[#946316]")}><span className="h-1.5 w-1.5 rounded-full bg-current" />{status?.replace("_", " ") || "unknown"}</span>;
}

function MiniTable({ columns, rows, empty }: { columns: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (!rows.length) return <EmptyState label={empty} />;
  return <div className="overflow-x-auto border border-[#d0d9dc]"><table className="w-full text-left text-[11px]"><thead className="bg-[#f0f4f3] text-[9px] uppercase tracking-wider text-[#63767d]"><tr>{columns.map((column) => <th key={column} className="whitespace-nowrap px-2 py-2 font-bold">{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t border-[#e1e6e7] odd:bg-[#fbfcfb] hover:bg-[#edf8f8]">{row.map((cell, cellIndex) => <td key={cellIndex} className="whitespace-nowrap px-2 py-2 text-[#334b54]">{cell}</td>)}</tr>)}</tbody></table></div>;
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const clientId = Number(id);
  const { user } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "manager";
  const { toast } = useToast();
  const qc = useQueryClient();
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<any>(null);
  const [showRouting, setShowRouting] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const revealTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [note, setNote] = useState("");
  const [agingDays, setAgingDays] = useState("1");
  const [bank, setBank] = useState({ bankName: "", accountType: "checking", paymentType: "ACH", routingNumber: "", accountNumber: "", nickname: "" });
  const [listDialog, setListDialog] = useState<"email" | "phone" | "rule" | "monitor" | "message" | "truck" | "task" | null>(null);
  const [listEditing, setListEditing] = useState<any>(null);
  const [listForm, setListForm] = useState<any>({});

  const { data: client, isLoading } = useQuery<any>({ queryKey: ["/api/clients", clientId], enabled: Number.isFinite(clientId), queryFn: async () => { const response = await fetch(`/api/clients/${clientId}`, { credentials: "include" }); if (!response.ok) throw new Error("Carrier not found"); return response.json(); } });
  const { data: invoices = [] } = useQuery<any[]>({ queryKey: ["/api/invoices", { all: true }] });
  const { data: clientDocs = [] } = useQuery<any[]>({ queryKey: ["/api/clients", clientId, "documents"], enabled: Number.isFinite(clientId) && isManager, queryFn: async () => { const response = await fetch(`/api/clients/${clientId}/documents`, { credentials: "include" }); return response.ok ? response.json() : []; } });
  const { data: bankAccounts = [] } = useQuery<any[]>({ queryKey: ["/api/carriers", clientId, "bank-accounts"], enabled: Number.isFinite(clientId) && isManager, queryFn: async () => { const response = await fetch(`/api/carriers/${clientId}/bank-accounts`, { credentials: "include" }); return response.ok ? response.json() : []; } });
  const { data: trucks = [] } = useQuery<any[]>({ queryKey: ["/api/trucks", clientId], enabled: Number.isFinite(clientId), queryFn: async () => { const response = await fetch(`/api/trucks?carrierId=${clientId}&all=true`, { credentials: "include" }); return response.ok ? response.json() : []; } });
  const { data: dispatchers = [] } = useQuery<any[]>({ queryKey: ["/api/dispatchers", clientId], enabled: Number.isFinite(clientId), queryFn: async () => { const response = await fetch(`/api/dispatchers?carrierId=${clientId}&all=true`, { credentials: "include" }); return response.ok ? response.json() : []; } });
  const { data: allTasks = [] } = useQuery<any[]>({ queryKey: ["/api/tasks"], enabled: Number.isFinite(clientId), queryFn: async () => { const response = await fetch("/api/tasks", { credentials: "include" }); return response.ok ? response.json() : []; } });
  const clientInvoices = useMemo(() => invoices.filter((invoice) => invoice.clientId === clientId), [invoices, clientId]);
  const carrierTasks = useMemo(() => allTasks.filter((task) => task.clientId === clientId), [allTasks, clientId]);
  const carrierDispatcher = dispatchers[0];
  const onboarding = { ...(client?.onboardingData || {}), ...(client?.onboardingProfile || {}) };
  const owners = (client?.owners || []).filter((owner: any) => Object.values(owner || {}).some(Boolean));
  const openBalance = clientInvoices.filter((invoice) => !["settled", "rejected", "paid"].includes(invoice.status)).reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const paid = clientInvoices.filter((invoice) => ["settled", "paid"].includes(invoice.status)).reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const dotNumber = String(onboarding.dotNumber || client?.dotNumber || "").trim();
  const fmcsaUrl = dotNumber ? `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${encodeURIComponent(dotNumber)}` : "";

  const updateClient = useMutation({ mutationFn: (payload: any) => apiRequest("PUT", `/api/clients/${clientId}`, { ...client, ...payload }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/clients", clientId] }); qc.invalidateQueries({ queryKey: ["/api/clients"] }); toast({ title: "Carrier record updated" }); }, onError: () => toast({ title: "Update failed", variant: "destructive" }) });
  const saveProfile = useMutation({ mutationFn: (profile: any) => apiRequest("PATCH", `/api/clients/${clientId}`, { onboardingProfile: profile }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/clients", clientId] }); qc.invalidateQueries({ queryKey: ["/api/clients"] }); setListDialog(null); setListEditing(null); toast({ title: "Carrier profile updated" }); }, onError: (error: Error) => toast({ title: "Could not update carrier profile", description: error.message, variant: "destructive" }) });
  const profileList = (type: string) => {
    if (type === "email") return Array.isArray(onboarding.notificationEmails) ? onboarding.notificationEmails : Array.isArray(onboarding.emailAddresses) ? onboarding.emailAddresses : [];
    if (type === "phone") return Array.isArray(onboarding.notificationPhones) ? onboarding.notificationPhones : Array.isArray(onboarding.phoneNumbers) ? onboarding.phoneNumbers : [];
    if (type === "rule") return Array.isArray(onboarding.rules) ? onboarding.rules : Object.entries(onboarding.rules || {}).map(([key, value]) => `${key}: ${value}`);
    const value = onboarding[`${type}s`];
    return Array.isArray(value) ? value : [];
  };
  const saveList = (type: string, value: any) => {
    const profile = { ...onboarding };
    const key = type === "email" ? "notificationEmails" : type === "phone" ? "notificationPhones" : `${type}s`;
    const current = [...profileList(type)];
    if (listEditing) current[listEditing.index] = value; else current.push(value);
    saveProfile.mutate({ ...profile, [key]: current });
  };
  const deleteList = (type: string, index: number) => {
    if (!window.confirm("Delete this item?")) return;
    const profile = { ...onboarding };
    const key = type === "email" ? "notificationEmails" : type === "phone" ? "notificationPhones" : `${type}s`;
    saveProfile.mutate({ ...profile, [key]: profileList(type).filter((_: any, i: number) => i !== index) });
  };
  const currentAuthor = [(user as any)?.firstName, (user as any)?.lastName].filter(Boolean).join(" ") || (user as any)?.name || (user as any)?.email || "Staff";
  const openList = (type: any, value: any = null, index?: number) => { setListDialog(type); setListEditing(value !== null && value !== undefined ? { index, ...(typeof value === "object" ? value : { value }) } : null); setListForm(value ?? (type === "monitor" ? { name: "", phone: "", email: "", status: "active" } : type === "message" ? { message: "" } : type === "task" ? { title: "", description: "", dueDate: "", priority: "medium", status: "todo" } : {})); };
  const createTruck = useMutation({ mutationFn: (data: any) => apiRequest(listEditing ? "PATCH" : "POST", listEditing ? `/api/trucks/${listEditing.id}` : "/api/trucks", { ...data, carrierId: clientId }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/trucks", clientId] }); setListDialog(null); setListEditing(null); toast({ title: "Truck saved" }); }, onError: (error: Error) => toast({ title: "Could not save truck", description: error.message, variant: "destructive" }) });
  const deleteTruck = useMutation({ mutationFn: (truckId: number) => apiRequest("DELETE", `/api/trucks/${truckId}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/trucks", clientId] }); toast({ title: "Truck deleted" }); }, onError: (error: Error) => toast({ title: "Could not delete truck", description: error.message, variant: "destructive" }) });
  const saveTask = useMutation({ mutationFn: (data: any) => apiRequest(listEditing ? "PATCH" : "POST", listEditing ? `/api/tasks/${listEditing.id}` : "/api/tasks", { ...data, clientId }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/tasks"] }); setListDialog(null); setListEditing(null); toast({ title: "Task saved" }); }, onError: (error: Error) => toast({ title: "Could not save task", description: error.message, variant: "destructive" }) });
  const deleteTask = useMutation({ mutationFn: (taskId: number) => apiRequest("DELETE", `/api/tasks/${taskId}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/tasks"] }); toast({ title: "Task deleted" }); }, onError: (error: Error) => toast({ title: "Could not delete task", description: error.message, variant: "destructive" }) });
  const simpleValue = typeof listForm === "string" ? listForm.trim() : String(listForm?.value || "").trim();
  const canSaveList = listDialog === "email" ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(simpleValue)
    : listDialog === "phone" || listDialog === "rule" ? simpleValue.length > 0
    : listDialog === "monitor" ? String(listForm?.name || "").trim().length > 0
    : listDialog === "message" ? String(listForm?.message || "").trim().length > 0
    : listDialog === "truck" ? String(listForm?.truckNumber || "").trim().length > 0
    : listDialog === "task" ? String(listForm?.title || "").trim().length > 0
    : false;
  const saveBank = useMutation({ mutationFn: () => apiRequest(editingBank ? "PATCH" : "POST", editingBank ? `/api/vault/${editingBank.id}` : "/api/vault", { clientId, ...(!editingBank ? { dataType: "bank_account" } : {}), label: bank.nickname || bank.bankName, value: JSON.stringify(bank), notes: null }), onSuccess: () => { setBankOpen(false); setEditingBank(null); qc.invalidateQueries({ queryKey: ["/api/carriers", clientId, "bank-accounts"] }); toast({ title: "Bank account saved to Vault" }); }, onError: () => toast({ title: "Could not save bank account", variant: "destructive" }) });
  const deleteBank = useMutation({ mutationFn: (bankId: number) => apiRequest("DELETE", `/api/vault/${bankId}?clientId=${clientId}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/carriers", clientId, "bank-accounts"] }); toast({ title: "Bank account removed" }); } });
  const saveNote = () => { if (note.trim()) { updateClient.mutate({ notes: note.trim() }); setNote(""); } };
  const uploadDocument = async (category: string, file: File) => { const form = new FormData(); form.append("file", file); form.append("documentCategory", category); try { const response = await fetch(`/api/clients/${clientId}/documents`, { method: "POST", body: form, credentials: "include" }); if (!response.ok) throw new Error(); toast({ title: `${category} uploaded` }); qc.invalidateQueries({ queryKey: ["/api/clients", clientId, "documents"] }); } catch { toast({ title: "Document upload failed", variant: "destructive" }); } };
  const downloadDocument = (doc: any) => { const link = document.createElement("a"); link.href = `/api/documents/${doc.id}/download`; link.target = "_blank"; link.click(); };
  const revealBank = async (bankId: number) => {
    if (revealed[bankId]) {
      clearTimeout(revealTimers.current[bankId]);
      delete revealTimers.current[bankId];
      setRevealed((current) => { const next = { ...current }; delete next[bankId]; return next; });
      return;
    }
    try {
      const response = await fetch(`/api/vault/entry/${bankId}`, { credentials: "include" });
      if (!response.ok) throw new Error();
      const entry = await response.json();
      const value = JSON.parse(entry.decryptedValue);
      setRevealed((current) => ({ ...current, [bankId]: value.accountNumber }));
      revealTimers.current[bankId] = setTimeout(() => {
        setRevealed((current) => { const next = { ...current }; delete next[bankId]; return next; });
        delete revealTimers.current[bankId];
      }, 30_000);
    } catch {
      toast({ title: "Could not reveal account number", variant: "destructive" });
    }
  };
  const openBank = (account?: any) => { setEditingBank(account || null); setBank(account ? { bankName: account.bankName || "", accountType: account.accountType || "checking", paymentType: account.paymentType || "not_recorded", routingNumber: "", accountNumber: "", nickname: account.nickname || "" } : { bankName: "", accountType: "checking", paymentType: "ACH", routingNumber: "", accountNumber: "", nickname: "" }); setBankOpen(true); };

  useEffect(() => () => {
    Object.values(revealTimers.current).forEach(clearTimeout);
  }, []);

  if (isLoading) return <div className="flex min-h-[100dvh]"><Sidebar /><main className="flex-1 bg-[#d4d0c8] p-6"><div className="animate-pulse space-y-3"><div className="h-20 bg-[#eef2f1]" /><div className="h-8 bg-[#eef2f1]" /><div className="h-96 bg-[#eef2f1]" /></div></main></div>;
  if (!client) return <div className="flex min-h-[100dvh]"><Sidebar /><main className="flex flex-1 flex-col items-center justify-center bg-[#d4d0c8]"><CircleAlert className="mb-2 h-10 w-10 text-[#9c4343]" /><p className="font-bold text-[#263b44]">Carrier record not found</p><Button variant="outline" className="mt-4 rounded-sm" onClick={() => navigate("/clients")}><ArrowLeft className="mr-2 h-4 w-4" />Back to carriers</Button></main></div>;

  const physical = { address: first(onboarding, "physicalAddress") || client.address, city: first(onboarding, "physicalCity", "city"), state: first(onboarding, "physicalState", "state"), zip: first(onboarding, "physicalZip", "zipCode") };
  const mailing = { address: first(onboarding, "mailingAddress"), city: first(onboarding, "mailingCity"), state: first(onboarding, "mailingState"), zip: first(onboarding, "mailingZip") };
  const docs = (categories: string[]) => isManager
    ? <DocumentList docs={clientDocs} categories={categories} onUpload={uploadDocument} onDownload={downloadDocument} />
    : <EmptyState label="Carrier documents are restricted to managers and administrators" />;

  return <div className="flex min-h-[100dvh] bg-[#d4d0c8] text-[#263b44]">
    <Sidebar />
    <div className="flex min-w-0 flex-1 flex-col">
      <TopNav title="Carrier profile" subtitle="Operations workspace · complete record" group="Operations" />
      <main className="custom-scrollbar flex-1 overflow-auto">
        <div className="mx-auto max-w-[1580px] space-y-3 p-3 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border border-[#718087] bg-[#edf2f1] px-3 py-2 shadow-[1px_1px_0_#fff]">
            <div className="flex items-center gap-3"><Button variant="ghost" size="sm" onClick={() => navigate("/clients")} className="h-8 gap-1 rounded-sm px-2 text-[#52666d]"><ArrowLeft className="h-4 w-4" />Close / Back</Button><div className="h-7 w-px bg-[#b5c0c3]" /><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-bold tracking-tight text-[#203a46]">{client.name}</h1><StatusBadge status={client.status} /></div><p className="text-[10px] text-[#667a80]">MC {client.mcNumber || "Not recorded"} · DOT {dotNumber || "Not recorded"} · created {date(client.createdAt)}</p></div></div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => navigate(`/carriers/${clientId}/edit`)} className="h-8 gap-1 rounded-sm bg-[#098b9f] px-2.5 text-[11px] text-white hover:bg-[#08798b]"><Edit2 className="h-3.5 w-3.5" />Edit carrier</Button>
              <Button size="sm" variant="outline" onClick={() => toast({ title: "UCC review is not available", description: "No review mutation is configured for this workspace." })} className="h-8 gap-1 rounded-sm px-2.5 text-[11px]"><ShieldCheck className="h-3.5 w-3.5" />Review UCC</Button>
              <Button size="sm" variant="outline" onClick={() => toast({ title: "Corporation review is not available", description: "No review mutation is configured for this workspace." })} className="h-8 gap-1 rounded-sm px-2.5 text-[11px]">Review Corp</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="sm" variant="outline" className="h-8 gap-1 rounded-sm px-2.5 text-[11px]"><Download className="h-3.5 w-3.5" />Downloads<ChevronDown className="h-3 w-3" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-sm">
                  <DropdownMenuItem onSelect={() => document.getElementById("aging-report")?.scrollIntoView({ behavior: "smooth" })}>Aging Statement</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {clientDocs.length ? clientDocs.map((doc: any) => <DropdownMenuItem key={doc.id} asChild><a href={`/api/documents/${doc.id}/download`} target="_blank" rel="noreferrer"><FileText className="mr-2 h-3.5 w-3.5" />{doc.originalName || doc.filename}</a></DropdownMenuItem>) : <DropdownMenuItem disabled>No carrier documents on file</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="outline" disabled title="Carrier email sending is unavailable because no safe send API is configured" aria-label="Send carrier email unavailable" className="h-8 gap-1 rounded-sm px-2.5 text-[11px]"><Mail className="h-3.5 w-3.5" />Send email</Button>
              <Button size="sm" variant="outline" disabled title="Carrier SMS sending is unavailable because no SMS API is configured" aria-label="Send carrier SMS unavailable" className="h-8 gap-1 rounded-sm px-2.5 text-[11px]"><Phone className="h-3.5 w-3.5" />Send SMS</Button>
              <Button size="sm" variant="outline" disabled={!fmcsaUrl} title={fmcsaUrl ? "Open official FMCSA SAFER company snapshot" : "DOT number required for FMCSA lookup"} aria-label={fmcsaUrl ? "Open carrier on FMCSA" : "Carrier on FMCSA unavailable"} onClick={() => fmcsaUrl && window.open(fmcsaUrl, "_blank", "noopener,noreferrer")} className="h-8 gap-1 rounded-sm px-2.5 text-[11px]">Carrier on FMCSA</Button>
              {isManager && <Button size="sm" variant="outline" disabled={updateClient.isPending} onClick={() => updateClient.mutate({ status: client.status === "active" ? "inactive" : "active" })} className="h-8 gap-1 rounded-sm px-2.5 text-[11px]">{client.status === "active" ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{client.status === "active" ? "Set inactive" : "Activate"}</Button>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
            {[["Open AR", money(openBalance), "text-[#a33131]"], ["Paid", money(paid), "text-[#187455]"], ["Invoices", clientInvoices.length, "text-[#087d8d]"], ["Documents", clientDocs.length, "text-[#42616c]"], ["Advance", onboarding.prePay ? `${onboarding.prePay}%` : "Not recorded", "text-[#42616c]"], ["Current limit", money(onboarding.currentLimit), "text-[#42616c]"]].map(([label, value, color]) => <div key={String(label)} className="border border-[#9eabad] bg-[#eef3f1] px-3 py-2 shadow-[1px_1px_0_#fff]"><p className="text-[9px] font-bold uppercase tracking-wider text-[#718187]">{label}</p><p className={cn("mt-1 text-base font-bold", color)}>{value}</p></div>)}
          </div>
          <div className="grid items-start gap-3 xl:grid-cols-2">
            <div className="space-y-3">
              <ProfileSection title={owners.length === 1 ? "Owner" : "Owners"} eyebrow="Identity & contact">
                {owners.length ? (
                  <div className="space-y-3">
                    {owners.map((owner: any, index: number) => (
                      <div key={owner.id || `${owner.email || "owner"}-${index}`} className={cn("grid gap-x-5 sm:grid-cols-2", index > 0 && "border-t border-[#d4dcde] pt-3")}>
                        <ProfileField label={`Owner ${index + 1} name`} value={[owner.firstName, owner.middleName, owner.lastName].filter(Boolean).join(" ")} />
                        <ProfileField label="Date of birth" value={owner.dob ? date(owner.dob) : undefined} />
                        <ProfileField label="Mobile" value={owner.mobileNumber || owner.phone} />
                        <ProfileField label="Email" value={owner.email} />
                        <ProfileField label="Title" value={owner.title} />
                      </div>
                    ))}
                  </div>
                ) : <EmptyState label="No owners are recorded in onboarding" />}
              </ProfileSection>
              <ProfileSection title="Shipping address"><div className="grid gap-x-5 sm:grid-cols-2"><ProfileField label="Address" value={physical.address} /><ProfileField label="City" value={physical.city} /><ProfileField label="State" value={physical.state} /><ProfileField label="ZIP" value={physical.zip} /></div></ProfileSection>
              <ProfileSection title="Billing address"><div className="grid gap-x-5 sm:grid-cols-2"><ProfileField label="Address" value={mailing.address} /><ProfileField label="City" value={mailing.city} /><ProfileField label="State" value={mailing.state} /><ProfileField label="ZIP" value={mailing.zip} /></div></ProfileSection>
              <ProfileSection title="Outstanding" eyebrow="Risk & collections"><div className="grid gap-x-5 sm:grid-cols-3"><ProfileField label="Debt amount" value={money(onboarding.debt || client.shorts)} tone="danger" /><ProfileField label="Type" value={onboarding.loanType} /><ProfileField label="Details" value={onboarding.collectionBalance || onboarding.vendor} /></div></ProfileSection>
              <ProfileSection title="Administrative"><div className="grid gap-x-5 sm:grid-cols-2"><ProfileField label="UCC reviewed by / date" value={[onboarding.ucc1IniReviewBy, onboarding.ucc1IniReviewDate].filter(Boolean).join(" · ")} /><ProfileField label="COI reviewed by / date" value={[onboarding.coiReviewBy, onboarding.coiReviewDate].filter(Boolean).join(" · ")} /><ProfileField label="Corporation reviewed by / date" value={[onboarding.corpReviewBy, onboarding.corpReviewDate].filter(Boolean).join(" · ")} /><ProfileField label="Rating reviewed by / date" value={[onboarding.authorityReviewBy, onboarding.authorityReviewDate].filter(Boolean).join(" · ")} /></div></ProfileSection>
              <ProfileSection title="Miscellaneous"><div className="grid gap-x-5 sm:grid-cols-2"><ProfileField label="Language" value={client.language || onboarding.language} /><ProfileField label="Dispatch" value={onboarding.dispatch} /><ProfileField label="Text notifications" value={pretty(onboarding.smsAlert)} /><ProfileField label="Email notifications" value={pretty(onboarding.emailAlert)} /><ProfileField label="Admin" value={onboarding.referralAdmin} /><ProfileField label="Reserves" value={money(onboarding.reserves || client.reserves)} /></div></ProfileSection>
              <ProfileSection title="Notification email addresses" action={<Button onClick={() => openList("email")} variant="outline" size="sm" className="h-7 gap-1 rounded-sm text-[10px]"><Plus className="h-3 w-3" />Add</Button>}><MiniTable columns={["Email", "Actions"]} rows={((onboarding.notificationEmails || onboarding.emailAddresses || []) as any[]).map((email, i) => [email, <span className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => openList("email", email, i)}><Pencil className="h-3 w-3" /></Button><Button variant="ghost" size="sm" onClick={() => deleteList("email", i)}><Trash2 className="h-3 w-3 text-[#a33131]" /></Button></span>])} empty="No notification email addresses are recorded" /></ProfileSection>
              <ProfileSection title="Notification phone numbers" action={<Button onClick={() => openList("phone")} variant="outline" size="sm" className="h-7 gap-1 rounded-sm text-[10px]"><Plus className="h-3 w-3" />Add</Button>}><MiniTable columns={["Phone", "Actions"]} rows={((onboarding.notificationPhones || onboarding.phoneNumbers || []) as any[]).map((phone, i) => [phone, <span className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => openList("phone", phone, i)}><Pencil className="h-3 w-3" /></Button><Button variant="ghost" size="sm" onClick={() => deleteList("phone", i)}><Trash2 className="h-3 w-3 text-[#a33131]" /></Button></span>])} empty="No notification phone numbers are recorded" /></ProfileSection>
              <ProfileSection title="Trucks" action={<Button onClick={() => openList("truck")} variant="outline" size="sm" className="h-7 gap-1 rounded-sm text-[10px]"><Plus className="h-3 w-3" />Add</Button>}><MiniTable columns={["Unit", "Vehicle", "Plate", "Status", "Actions"]} rows={trucks.map((truck: any) => [truck.truckNumber, [truck.year, truck.make, truck.model].filter(Boolean).join(" "), `${truck.licensePlate || ""} ${truck.state || ""}`, truck.status, <span className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => openList("truck", truck)}><Pencil className="h-3 w-3" /></Button><Button variant="ghost" size="sm" onClick={() => window.confirm("Delete this truck?") && deleteTruck.mutate(truck.id)}><Trash2 className="h-3 w-3 text-[#a33131]" /></Button></span>])} empty="No carrier-linked trucks are recorded" /></ProfileSection>
              <ProfileSection title="Rules" action={<Button onClick={() => openList("rule")} variant="outline" size="sm" className="h-7 gap-1 rounded-sm text-[10px]"><Plus className="h-3 w-3" />Add</Button>}><MiniTable columns={["Rule", "Actions"]} rows={(Array.isArray(onboarding.rules) ? onboarding.rules : Object.entries(onboarding.rules || {}).map(([key, value]) => `${key}: ${value}`)).map((rule: any, i: number) => [rule, <span className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => openList("rule", rule, i)}><Pencil className="h-3 w-3" /></Button><Button variant="ghost" size="sm" onClick={() => deleteList("rule", i)}><Trash2 className="h-3 w-3 text-[#a33131]" /></Button></span>])} empty="No carrier-specific rules are recorded" /></ProfileSection>
              <ProfileSection title="Tasks" action={<Button onClick={() => openList("task")} variant="outline" size="sm" className="h-7 gap-1 rounded-sm text-[10px]"><Plus className="h-3 w-3" />Add</Button>}><MiniTable columns={["Task", "Status", "Due", "Actions"]} rows={carrierTasks.map((task: any) => [task.title, task.status, date(task.dueDate), <span className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => openList("task", task)}><Pencil className="h-3 w-3" /></Button><Button variant="ghost" size="sm" onClick={() => window.confirm("Delete this task?") && deleteTask.mutate(task.id)}><Trash2 className="h-3 w-3 text-[#a33131]" /></Button></span>])} empty="No carrier tasks are recorded" /></ProfileSection>
              <ProfileSection title="Factoring documents">{docs(["Factoring Application", "Security Agreement", "NOA", "Deposit & Withdrawals Agreement"])}</ProfileSection>
              <ProfileSection title="Carrier documents">{docs(["W9", "Void Check", "Driver License", "Insurance Certificate", "Authority MC#", "EIN Letter", "Articles Of Organization"])}</ProfileSection>
              <ProfileSection title="Other sign-up documents">{docs(["Other", "Letter Of Intent", "Buyout Agreement"])}</ProfileSection>
              <ProfileSection title="UCC reports">{docs(["UCC-11 Search and Copy Request"])}</ProfileSection>
              <ProfileSection title="Sign-up documents">{docs(["Application", "Carrier Setup"])}</ProfileSection>
            </div>
            <div className="space-y-3">
              <ProfileSection title="AR" eyebrow="Funding position"><div className="grid gap-x-5 sm:grid-cols-2"><ProfileField label="Paid" value={money(paid)} tone="accent" /><ProfileField label="Open invoice value (derived)" value={money(onboarding.ar || openBalance)} tone="danger" /><ProfileField label="Max limit" value={money(onboarding.maxLimit)} /><ProfileField label="Current limit" value={money(onboarding.currentLimit)} /><ProfileField label="AR over eligible days" value={pretty(onboarding.arOver90Days)} /><ProfileField label="Availability" value={onboarding.availability ? money(onboarding.availability) : undefined} /></div></ProfileSection>
              <ProfileSection title="Shorts & chargebacks"><div className="grid gap-x-5 sm:grid-cols-3"><ProfileField label="Carrier shorts" value={money(client.shorts)} tone="danger" /><ProfileField label="Advanced shorts" value={money(onboarding.advancedShorts)} tone="danger" /><ProfileField label="Pending chargebacks" value={money(onboarding.pendingChargebacks)} tone="danger" /></div></ProfileSection>
              <ProfileSection title="Cargo type"><div className="grid gap-x-5 sm:grid-cols-3"><ProfileField label="Dump" value={pretty(onboarding.dump || onboarding.dumpTruck)} /><ProfileField label="Driver support" value={pretty(onboarding.driverSupport)} /><ProfileField label="OTR" value={pretty(onboarding.otr || onboarding.operationClassification)} /></div></ProfileSection>
              <ProfileSection title="Other info"><div className="grid gap-x-5 sm:grid-cols-2"><ProfileField label="Since" value={date(onboarding.since)} /><ProfileField label="Referral" value={onboarding.referral} /><ProfileField label="Last invoice" value={date([...clientInvoices].sort((a, b) => new Date(b.invoiceDate || b.createdAt).getTime() - new Date(a.invoiceDate || a.createdAt).getTime())[0]?.invoiceDate)} /><ProfileField label="Date created" value={date(client.createdAt)} /></div></ProfileSection>
              <ProfileSection title="To do list" action={<Button onClick={() => openList("task")} variant="outline" size="sm" className="h-7 gap-1 rounded-sm text-[10px]"><Plus className="h-3 w-3" />Add</Button>}><MiniTable columns={["Item", "Status"]} rows={(carrierTasks.length ? carrierTasks.filter((task: any) => task.status !== "completed") : (onboarding.toDo || onboarding.todo || [])).map((task: any) => [task.title || task.name, task.status])} empty="No open carrier to-do items are recorded" /></ProfileSection>
              <ProfileSection title="Dispatcher"><div className="flex items-center gap-3 border border-[#d0d9dc] bg-[#fbfcfb] p-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d9edf0] text-[#087d8d]"><UserRound className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="text-[12px] font-bold">{carrierDispatcher ? [carrierDispatcher.firstName, carrierDispatcher.lastName].filter(Boolean).join(" ") : onboarding.dispatcherName || "No dispatcher linked"}</p><p className="text-[10px] text-[#718187]">{carrierDispatcher?.phone || onboarding.dispatcherPhone || "Phone not recorded"} · {carrierDispatcher?.email || onboarding.dispatcherEmail || "Email not recorded"}</p></div><span className="text-[10px] text-[#9aa7ab]">{carrierDispatcher?.status || (onboarding.dispatcherName ? onboarding.dispatcherStatus || "Linked" : "Unavailable")}</span></div></ProfileSection>
              <ProfileSection title="Bank accounts" eyebrow="Secure Vault" action={isManager ? <Button onClick={() => openBank()} variant="outline" size="sm" className="h-7 gap-1 rounded-sm text-[10px]"><Plus className="h-3 w-3" />Add</Button> : undefined}>
                {isManager ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[600px] text-left text-[10px]">
                      <thead className="bg-[#f0f4f3] uppercase tracking-wider text-[#63767d]"><tr>{["For", "Account name", "Financial institution", "Routing", "Account", "Type", "Actions"].map((heading) => <th key={heading} className="px-2 py-2 font-bold">{heading}</th>)}</tr></thead>
                      <tbody>{bankAccounts.map((account: any) => <tr key={account.id} className="border-t border-[#e1e6e7]"><td className="px-2 py-2">{account.paymentType || "Not recorded"}</td><td className="px-2 py-2 font-semibold">{account.nickname || "Operating account"}</td><td className="px-2 py-2">{account.bankName || "Not recorded"}</td><td className="px-2 py-2">•••••••••</td><td className="px-2 py-2">{revealed[account.id] || `•••• ${account.lastFour || "----"}`}</td><td className="px-2 py-2">{account.accountType || "Checking"}</td><td className="px-2 py-2"><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => revealBank(account.id)} className="h-6 px-1.5" title="Reveal for 30 seconds"><Eye className="h-3 w-3" /></Button><Button variant="ghost" size="sm" onClick={() => openBank(account)} className="h-6 px-1.5 text-[#087d8d]">Edit</Button><Button variant="ghost" size="sm" onClick={() => window.confirm("Remove this bank account?") && deleteBank.mutate(account.id)} className="h-6 px-1.5 text-[#a33131]">Delete</Button></div></td></tr>)}</tbody>
                    </table>
                    {!bankAccounts.length && <EmptyState label="No bank accounts are stored in the secure Vault" actionLabel="Add account" onAction={() => openBank()} />}
                  </div>
                ) : <EmptyState label="Bank accounts are restricted to managers and administrators" />}
              </ProfileSection>
              <ProfileSection title="Monitors" action={<Button onClick={() => openList("monitor")} variant="outline" size="sm" className="h-7 gap-1 rounded-sm text-[10px]"><Plus className="h-3 w-3" />Add</Button>}><MiniTable columns={["Name", "Phone", "Email", "Status", "Actions"]} rows={((onboarding.monitors || []) as any[]).map((monitor, i) => [monitor.name, monitor.phone, monitor.email, monitor.status, <span className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => openList("monitor", monitor, i)}><Pencil className="h-3 w-3" /></Button><Button variant="ghost" size="sm" onClick={() => deleteList("monitor", i)}><Trash2 className="h-3 w-3 text-[#a33131]" /></Button></span>])} empty="No monitors are recorded" /></ProfileSection>
               <DriverSection carrierId={clientId} canEdit={isManager} legacyDriver={{ name: onboarding.driverName, phone: onboarding.driverPhone, email: onboarding.driverEmail }} />
              <ProfileSection title="Messages" action={<Button onClick={() => openList("message")} variant="outline" size="sm" className="h-7 gap-1 rounded-sm text-[10px]"><Plus className="h-3 w-3" />Add</Button>}>{(onboarding.messages || []).length ? <div className="space-y-2">{onboarding.messages.map((message: any, i: number) => <div key={i} className="border border-[#d0d9dc] p-2 text-[11px]"><div className="flex justify-between gap-3"><b>{message.author}</b><span className="shrink-0 text-[#718187]">{dateTime(message.timestamp)}</span></div><p className="mt-1 whitespace-pre-wrap">{message.message}</p><Button variant="ghost" size="sm" onClick={() => deleteList("message", i)}><Trash2 className="h-3 w-3 text-[#a33131]" /></Button></div>)}</div> : <EmptyState label="No internal messages are recorded" />}</ProfileSection>
              <ProfileSection title="RAP sheet">{docs(["RAP Sheet"])}</ProfileSection>
              <ProfileSection title="Preferred brokers"><MiniTable columns={["Broker", "Reference"]} rows={((onboarding.preferredBrokers || []) as any[]).map((broker) => [broker.name || broker, broker.mcNumber || "Onboarding"]) } empty="No preferred brokers are recorded" /></ProfileSection>
              <ProfileSection title="UCC">{docs(["UCC-1-UT Initial Financing Statement", "UCC-3-UT Continuation"])}</ProfileSection>
              <ProfileSection title="Other documents">{docs(["Other Documents", "Envelope", "Logo"])}</ProfileSection>
              <ProfileSection title="Notes" eyebrow="Internal record"><div className="space-y-2">{client.notes && <div className="border border-[#d0d9dc] bg-[#fbfcfb] p-3 text-[12px] whitespace-pre-wrap">{client.notes}</div>}{isManager ? <><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Add an internal note..." className="w-full border border-[#aebdc1] bg-white p-2 text-[12px] outline-none focus:border-[#098b9f]" /><Button onClick={saveNote} disabled={!note.trim() || updateClient.isPending} size="sm" className="h-8 rounded-sm bg-[#098b9f] text-[11px] text-white"><MessageSquare className="mr-1 h-3.5 w-3.5" />Save note</Button></> : !client.notes && <EmptyState label="No internal notes are recorded" />}</div></ProfileSection>
              <ProfileSection title="Invoices" eyebrow="Funding activity" action={<Button onClick={() => setInvoiceOpen(true)} size="sm" className="h-7 gap-1 rounded-sm bg-[#098b9f] px-2 text-[10px] text-white hover:bg-[#08798b]"><Plus className="h-3 w-3" />Create invoice</Button>}><MiniTable columns={["Invoice", "Date", "Amount", "Status"]} rows={clientInvoices.map((invoice) => [<a key={invoice.id} className="text-[#087d8d] hover:underline" href={`/invoices/${invoice.id}`}>{invoice.invoiceNumber}</a>, date(invoice.invoiceDate || invoice.createdAt), money(invoice.amount), invoice.status])} empty="No invoices are recorded for this carrier" /></ProfileSection>
              <ProfileSection title="Aging report" className="scroll-mt-4" ><div id="aging-report" className="space-y-3"><p className="text-[11px] text-[#718187]">Download open funded invoices in the carrier aging format.</p><AgingPdfDownload carrierId={clientId} minDays={agingDays} onMinDaysChange={setAgingDays} compact /></div></ProfileSection>
            </div>
          </div>
        </div>
      </main>
    </div>
    <Dialog open={bankOpen} onOpenChange={setBankOpen}><DialogContent className="rounded-sm"><DialogHeader><DialogTitle>{editingBank ? "Edit bank account" : "Add bank account to Vault"}</DialogTitle><DialogDescription>Account and routing numbers are encrypted before storage.</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><div><Label>Bank name</Label><Input value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} /></div><div><Label>Nickname</Label><Input value={bank.nickname} onChange={(e) => setBank({ ...bank, nickname: e.target.value })} /></div><div><Label>Payment type</Label><Select value={bank.paymentType} onValueChange={(value) => setBank({ ...bank, paymentType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{bank.paymentType === "not_recorded" && <SelectItem value="not_recorded" disabled>Not recorded — choose one</SelectItem>}<SelectItem value="ACH">ACH</SelectItem><SelectItem value="Wire">Wire</SelectItem></SelectContent></Select></div><div><Label>Account type</Label><Select value={bank.accountType} onValueChange={(value) => setBank({ ...bank, accountType: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="checking">Checking</SelectItem><SelectItem value="savings">Savings</SelectItem></SelectContent></Select></div><div><Label>Routing number</Label><div className="relative"><Input className="pr-8" type={showRouting ? "text" : "password"} value={bank.routingNumber} onChange={(e) => setBank({ ...bank, routingNumber: e.target.value.replace(/\D/g, "").slice(0, 9) })} /><Button type="button" variant="ghost" size="icon" onClick={() => setShowRouting(!showRouting)} className="absolute right-0 top-0 h-9 w-8">{showRouting ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button></div></div><div><Label>Account number</Label><div className="relative"><Input className="pr-8" type={showAccount ? "text" : "password"} value={bank.accountNumber} onChange={(e) => setBank({ ...bank, accountNumber: e.target.value.replace(/\D/g, "") })} /><Button type="button" variant="ghost" size="icon" onClick={() => setShowAccount(!showAccount)} className="absolute right-0 top-0 h-9 w-8">{showAccount ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</Button></div></div></div><DialogFooter><Button variant="outline" onClick={() => setBankOpen(false)}>Cancel</Button><Button onClick={() => saveBank.mutate()} disabled={saveBank.isPending || !bank.bankName || bank.paymentType === "not_recorded" || bank.routingNumber.length !== 9 || !bank.accountNumber}>Save to Vault</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!listDialog} onOpenChange={(open) => !open && setListDialog(null)}>
      <DialogContent className="max-w-xl rounded-sm">
        <DialogHeader><DialogTitle>{listEditing ? "Edit" : "Add"} {listDialog === "email" ? "notification email" : listDialog === "phone" ? "notification phone" : listDialog === "rule" ? "rule" : listDialog === "monitor" ? "monitor" : listDialog === "message" ? "message" : listDialog === "truck" ? "truck" : "task"}</DialogTitle><DialogDescription>Changes are saved to this carrier record.</DialogDescription></DialogHeader>
        {(listDialog === "email" || listDialog === "phone") && <div><Label>{listDialog === "email" ? "Email address" : "Phone number"}</Label><Input type={listDialog === "email" ? "email" : "tel"} value={typeof listForm === "string" ? listForm : listForm.value || ""} onChange={(e) => setListForm(e.target.value)} /></div>}
        {listDialog === "rule" && <div><Label>Rule description</Label><Textarea value={typeof listForm === "string" ? listForm : listForm.value || ""} onChange={(e) => setListForm(e.target.value)} /></div>}
        {listDialog === "monitor" && <div className="grid gap-3 sm:grid-cols-2">{["name", "phone", "email"].map((key) => <div key={key}><Label>{key}</Label><Input value={listForm[key] || ""} onChange={(e) => setListForm({ ...listForm, [key]: e.target.value })} /></div>)}<div><Label>Status</Label><Select value={listForm.status || "active"} onValueChange={(v) => setListForm({ ...listForm, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select></div></div>}
        {listDialog === "message" && <div className="space-y-3"><div><Label>Internal message</Label><Textarea value={listForm.message || ""} onChange={(e) => setListForm({ ...listForm, message: e.target.value })} /></div><p className="text-xs text-muted-foreground">Posting as {currentAuthor}</p></div>}
        {listDialog === "truck" && <div className="grid gap-3 sm:grid-cols-2">{[["truckNumber", "Truck#"], ["vin", "VIN"], ["make", "Make"], ["model", "Model"], ["year", "Year"], ["licensePlate", "License Plate"], ["state", "State"]].map(([key, label]) => <div key={key}><Label>{label}</Label><Input value={listForm[key] || ""} onChange={(e) => setListForm({ ...listForm, [key]: key === "year" ? Number(e.target.value) || null : e.target.value })} /></div>)}</div>}
        {listDialog === "task" && <div className="space-y-3"><div><Label>Title</Label><Input value={listForm.title || ""} onChange={(e) => setListForm({ ...listForm, title: e.target.value })} /></div><div><Label>Description</Label><Textarea value={listForm.description || ""} onChange={(e) => setListForm({ ...listForm, description: e.target.value })} /></div><div className="grid gap-3 sm:grid-cols-3"><div><Label>Due date</Label><Input type="date" value={listForm.dueDate ? String(listForm.dueDate).slice(0, 10) : ""} onChange={(e) => setListForm({ ...listForm, dueDate: e.target.value })} /></div><div><Label>Priority</Label><Select value={listForm.priority || "medium"} onValueChange={(v) => setListForm({ ...listForm, priority: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["low", "medium", "high"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div><div><Label>Status</Label><Select value={listForm.status || "todo"} onValueChange={(v) => setListForm({ ...listForm, status: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todo">To do</SelectItem><SelectItem value="in_progress">In progress</SelectItem><SelectItem value="held">Held</SelectItem><SelectItem value="completed">Completed</SelectItem></SelectContent></Select></div></div></div>}
        <DialogFooter><Button variant="outline" onClick={() => setListDialog(null)}>Cancel</Button><Button disabled={!canSaveList || saveProfile.isPending || createTruck.isPending || saveTask.isPending} onClick={() => {
          if (listDialog === "truck") createTruck.mutate(listForm);
          else if (listDialog === "task") saveTask.mutate({ ...listForm, type: listForm.type || "task", status: listForm.status || "todo" });
          else { const value = listDialog === "email" || listDialog === "phone" || listDialog === "rule" ? (typeof listForm === "string" ? listForm : listForm.value || "") : listForm; saveList(listDialog!, value); }
        }}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <InvoiceModal isOpen={invoiceOpen} onClose={() => setInvoiceOpen(false)} initialClient={client} onCreated={() => qc.invalidateQueries({ queryKey: ["/api/invoices"] })} />
  </div>;
}