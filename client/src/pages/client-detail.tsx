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
import type { ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ProfileSection as BaseProfileSection, ProfileField, EmptyState as BaseEmptyState, DocumentList } from "@/components/carriers/carrier-profile-section";
import { DriverSection } from "@/components/carriers/driver-section";
import CarrierChatThread from "@/components/carriers/CarrierChatThread";
import { LoadTypeBadge, LoadTypeToggleGroup } from "@/components/load-type";
import { ProcessorAssignment } from "@/components/assignments/processor-assignment";
import { ClientEmailComposer } from "@/components/client-email/client-email-composer";
import { ClientEmailLog } from "@/components/client-email/client-email-log";
import EntityNotes from "@/components/shared/EntityNotes";
import { CarrierFinancialOverview } from "@/components/carriers/carrier-financial-overview";
import { NeuBadge, NeuButton, NeuCard, NeuPageShell, NeuTab, NeuTabList, NeuTabPanel, NeuTabs, NeuTable, NeuTableBody, NeuTableCell, NeuTableHead, NeuTableHeader, NeuTableRow } from "@/styles/neu/components";
import { ArrowLeft, CheckCircle2, CircleAlert, Download, Edit2, Eye, EyeOff, FileText, Mail, MessageCircle, Phone, Plus, ShieldCheck, Truck, UserRound, XCircle, ChevronDown, Trash2, Pencil } from "lucide-react";

function ProfileSection(props: Parameters<typeof BaseProfileSection>[0]) {
  return <BaseProfileSection {...props} neuStyle />;
}

function EmptyState(props: Parameters<typeof BaseEmptyState>[0]) {
  return <BaseEmptyState {...props} neuStyle />;
}

function ProfileActionButton({ variant = "default", size = "default", className, ...props }: Omit<ButtonProps, "asChild">) {
  const cleanClassName = (className || "").split(/\s+/).filter((token) =>
    !/^(bg-|hover:bg-|rounded-|h-|w-|px-|py-|text-\[\d+px\])/.test(token),
  ).join(" ");
  return <NeuButton variant={variant === "default" ? "accent" : "default"} className={cn(
    size === "icon" ? "min-h-9 h-9 w-9 rounded-lg p-0" : size === "sm" ? "min-h-9 rounded-lg px-3 py-2 text-xs" : "min-h-10 rounded-xl px-4",
    cleanClassName,
  )} {...props} />;
}

const money = (value: unknown) => value === null || value === undefined || value === "" ? "Not recorded" : `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not recorded";
const dateTime = (value: unknown) => value ? new Date(String(value)).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "Not recorded";
const pretty = (value: unknown) => value === true ? "Yes" : value === false ? "No" : value == null || value === "" ? undefined : String(value);
const first = (obj: any, ...keys: string[]) => keys.map((key) => obj?.[key]).find((value) => value !== undefined && value !== null && value !== "");

function StatusBadge({ status }: { status?: string }) {
  return <NeuBadge tone={status === "active" ? "success" : status === "new_client" ? "accent" : "warning"}>{status?.replace("_", " ") || "unknown"}</NeuBadge>;
}

function MiniTable({ columns, rows, empty }: { columns: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (!rows.length) return <EmptyState label={empty} neuStyle />;
  return <NeuTable className="min-w-max text-[11px]"><NeuTableHeader><tr>{columns.map((column) => <NeuTableHead key={column} className="px-3 py-2 text-[9px]">{column}</NeuTableHead>)}</tr></NeuTableHeader><NeuTableBody>{rows.map((row, index) => <NeuTableRow key={index} className="border-t border-[#c8c8c8]">{row.map((cell, cellIndex) => <NeuTableCell key={cellIndex} className="whitespace-nowrap px-3 py-2 text-[#354548]">{cell}</NeuTableCell>)}</NeuTableRow>)}</NeuTableBody></NeuTable>;
}

function CarrierAlerts({ carrierId, canManage }: { carrierId: number; canManage: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [severity, setSeverity] = useState<"block" | "ack" | "info">("ack");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const queryKey = ["/api/preflight/alerts", "carrier", carrierId];
  const { data, isLoading, error } = useQuery<any>({
    queryKey,
    enabled: Number.isFinite(carrierId),
    queryFn: async () => {
      const response = await fetch(`/api/preflight/alerts?entityType=carrier&entityId=${carrierId}`, { credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not load carrier alerts");
      return result;
    },
  });
  const alertRows = Array.isArray(data) ? data : Array.isArray(data?.alerts) ? data.alerts : [];
  const alerts = alertRows.filter((alert: any) => String(alert.entityType ?? alert.entity_type ?? "carrier") === "carrier"
    && Number(alert.entityId ?? alert.entity_id ?? carrierId) === carrierId);
  const addAlert = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/preflight/alerts", {
        entityType: "carrier",
        entityId: carrierId,
        severity,
        title: title.trim(),
        message: message.trim(),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      setTitle("");
      setMessage("");
      setExpiresAt("");
      toast({ title: "Carrier alert added" });
    },
    onError: (cause: Error) => toast({ title: "Could not add alert", description: cause.message, variant: "destructive" }),
  });
  const deactivateAlert = useMutation({
    mutationFn: (alertId: number) => apiRequest("PATCH", `/api/preflight/alerts/${alertId}`, { active: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast({ title: "Carrier alert deactivated" });
    },
    onError: (cause: Error) => toast({ title: "Could not deactivate alert", description: cause.message, variant: "destructive" }),
  });
  const severityStyle = (value: string) => value === "block"
    ? "border-[#cf8f8f] bg-[#fff0ef] text-[#9f3030]"
    : value === "ack"
      ? "border-[#d7b46c] bg-[#fff8e8] text-[#946316]"
      : "border-[#a8c9d0] bg-[#eef8fa] text-[#276372]";

  return <ProfileSection title="Alerts" eyebrow="Invoice preflight risk">
    <div className="space-y-3">
      {isLoading ? <p className="text-[11px] text-[#718187]">Loading alerts…</p>
        : error ? <p role="alert" className="text-[11px] text-[#a33131]">{(error as Error).message}</p>
          : alerts.length ? <div className="space-y-2">
            {alerts.map((alert: any) => <div key={alert.id} className={cn("border p-2.5", severityStyle(alert.severity || "info"), !alert.active && "opacity-60")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[9px] font-bold uppercase tracking-wider">{alert.severity || "info"}</span>
                    {!alert.active && <span className="text-[9px] font-bold uppercase">Inactive</span>}
                    <span className="text-[9px] text-[#718187]">{(alert.expiresAt ?? alert.expires_at) ? `Expires ${date(alert.expiresAt ?? alert.expires_at)}` : "No expiry"}</span>
                  </div>
                  <p className="mt-1 text-[11px] font-bold">{alert.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[11px]">{alert.message}</p>
                </div>
                {canManage && alert.active && <ProfileActionButton variant="outline" size="sm" className="shrink-0" disabled={deactivateAlert.isPending} onClick={() => deactivateAlert.mutate(Number(alert.id))}>Deactivate</ProfileActionButton>}
              </div>
            </div>)}
          </div> : <EmptyState label="No carrier preflight alerts are recorded" />}
      {canManage ? <form className="space-y-2 border-t border-[#d4dcde] pt-3" onSubmit={(event) => { event.preventDefault(); addAlert.mutate(); }}>
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#718187]">Add manual alert</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div><Label className="text-[10px]">Severity</Label><Select value={severity} onValueChange={(value) => setSeverity(value as "block" | "ack" | "info")}><SelectTrigger className="h-8 rounded-sm text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="block">Block</SelectItem><SelectItem value="ack">Acknowledgement</SelectItem><SelectItem value="info">Informational</SelectItem></SelectContent></Select></div>
          <div><Label htmlFor={`alert-expiry-${carrierId}`} className="text-[10px]">Optional expiry</Label><Input id={`alert-expiry-${carrierId}`} type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="h-8 rounded-sm text-[11px]" /></div>
        </div>
        <div><Label htmlFor={`alert-title-${carrierId}`} className="text-[10px]">Title</Label><Input id={`alert-title-${carrierId}`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required className="h-8 rounded-sm text-[11px]" placeholder="e.g. AR hold" /></div>
        <div><Label htmlFor={`alert-message-${carrierId}`} className="text-[10px]">Message</Label><Textarea id={`alert-message-${carrierId}`} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} required rows={3} className="rounded-sm text-[11px]" placeholder="Explain the risk and any required action." /></div>
        <ProfileActionButton type="submit" size="sm" disabled={addAlert.isPending || !title.trim() || !message.trim()}><Plus className="mr-1 h-3.5 w-3.5" />Add alert</ProfileActionButton>
      </form> : <p className="border-t border-[#d4dcde] pt-3 text-[10px] text-[#718187]">Only managers and administrators can add or deactivate alerts.</p>}
    </div>
  </ProfileSection>;
}

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const clientId = Number(id);
  const { user, permissions, isLoading: authLoading, hasPermission } = useAuth();
  const isManager = user?.role === "admin" || user?.role === "manager";
  const canUseCarrierChat = !!user && (
    user.role === "admin"
    || (!authLoading && (permissions.includes("chat") || permissions.includes("portal_submissions")))
  );
  const { toast } = useToast();
  const qc = useQueryClient();
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<any>(null);
  const [showRouting, setShowRouting] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const revealTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const [agingDays, setAgingDays] = useState("1");
  const [bank, setBank] = useState({ bankName: "", accountType: "checking", paymentType: "ACH", routingNumber: "", accountNumber: "", nickname: "" });
  const [listDialog, setListDialog] = useState<"email" | "phone" | "rule" | "monitor" | "message" | "truck" | "task" | null>(null);
  const [listEditing, setListEditing] = useState<any>(null);
  const [listForm, setListForm] = useState<any>({});
  const [profileTab, setProfileTab] = useState("profile");
  const [clientEmailOpen, setClientEmailOpen] = useState(false);

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

  const updateClient = useMutation({ mutationFn: (payload: any) => apiRequest("PATCH", `/api/clients/${clientId}`, payload), onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/clients", clientId] }); qc.invalidateQueries({ queryKey: ["/api/clients"] }); toast({ title: "Carrier record updated" }); }, onError: () => toast({ title: "Update failed", variant: "destructive" }) });
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

  useEffect(() => {
    if (!canUseCarrierChat && profileTab === "messages") setProfileTab("profile");
  }, [canUseCarrierChat, profileTab]);

  if (isLoading) return <div className="flex min-h-[100dvh]"><Sidebar /><main className="flex-1 bg-[#d4d0c8] p-6"><div className="animate-pulse space-y-3"><div className="h-20 bg-[#eef2f1]" /><div className="h-8 bg-[#eef2f1]" /><div className="h-96 bg-[#eef2f1]" /></div></main></div>;
  if (!client) return <div className="flex min-h-[100dvh]"><Sidebar /><main className="flex flex-1 flex-col items-center justify-center bg-[#d4d0c8]"><CircleAlert className="mb-2 h-10 w-10 text-[#9c4343]" /><p className="font-bold text-[#263b44]">Carrier record not found</p><Button variant="outline" className="mt-4 rounded-sm" onClick={() => navigate("/clients")}><ArrowLeft className="mr-2 h-4 w-4" />Back to carriers</Button></main></div>;

  const physical = { address: first(onboarding, "physicalAddress") || client.address, city: first(onboarding, "physicalCity", "city"), state: first(onboarding, "physicalState", "state"), zip: first(onboarding, "physicalZip", "zipCode") };
  const mailing = { address: first(onboarding, "mailingAddress"), city: first(onboarding, "mailingCity"), state: first(onboarding, "mailingState"), zip: first(onboarding, "mailingZip") };
  const docs = (categories: string[]) => isManager
    ? <DocumentList docs={clientDocs} categories={categories} onUpload={uploadDocument} onDownload={downloadDocument} neuStyle />
    : <EmptyState label="Carrier documents are restricted to managers and administrators" />;

  return <div className="flex h-full min-h-0 bg-[#e0e0e0] text-[#354548]">
    <Sidebar />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TopNav title="Carrier profile" subtitle="Operations workspace · complete record" group="Operations" neu />
      <NeuPageShell className="custom-scrollbar !min-h-0 flex-1">
        <div className="mx-auto max-w-[1580px] space-y-5 p-4 md:p-6">
          <NeuCard className="flex flex-wrap items-center justify-between gap-4 p-4 md:p-5">
            <div className="flex min-w-0 items-center gap-3"><NeuButton onClick={() => navigate("/clients")} className="min-h-10 px-3 text-xs"><ArrowLeft className="h-4 w-4" />Back</NeuButton><div className="h-8 w-px bg-[#c5c5c5]" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold tracking-tight text-[#354548] md:text-2xl">{client.name}</h1><StatusBadge status={client.status} /></div><p className="mt-1 text-xs text-[#718187]">MC {client.mcNumber || "Not recorded"} · DOT {dotNumber || "Not recorded"} · created {date(client.createdAt)}</p><p className="mt-1 text-sm text-[#526164]">{client.email || "No email recorded"}{client.phone ? ` · ${client.phone}` : ""}</p></div></div>
            <div className="flex flex-wrap gap-1.5">
              <NeuButton onClick={() => navigate(`/carriers/${clientId}/edit`)} className="min-h-10 px-3 text-xs"><Edit2 className="h-4 w-4" />Edit carrier</NeuButton>
               <div className="flex items-center gap-2 border border-[#c5d0d1] bg-white px-2 py-1">
                 <span className="text-[10px] font-bold uppercase tracking-wide text-[#718187]">Assigned Processor</span>
                 <div className="min-w-[170px]"><ProcessorAssignment record={client} endpoint={`/api/clients/${clientId}/assign`} queryKey={["/api/clients", clientId]} compact /></div>
               </div>
              <NeuButton onClick={() => toast({ title: "UCC review is not available", description: "No review mutation is configured for this workspace." })} className="min-h-9 px-3 text-xs"><ShieldCheck className="h-3.5 w-3.5" />Review UCC</NeuButton>
              <NeuButton onClick={() => toast({ title: "Corporation review is not available", description: "No review mutation is configured for this workspace." })} className="min-h-9 px-3 text-xs">Review Corp</NeuButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><NeuButton className="min-h-9 px-3 text-xs"><Download className="h-3.5 w-3.5" />Downloads<ChevronDown className="h-3 w-3" /></NeuButton></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="rounded-sm">
                  <DropdownMenuItem onSelect={() => document.getElementById("aging-report")?.scrollIntoView({ behavior: "smooth" })}>Aging Statement</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {clientDocs.length ? clientDocs.map((doc: any) => <DropdownMenuItem key={doc.id} asChild><a href={`/api/documents/${doc.id}/download`} target="_blank" rel="noreferrer"><FileText className="mr-2 h-3.5 w-3.5" />{doc.originalName || doc.filename}</a></DropdownMenuItem>) : <DropdownMenuItem disabled>No carrier documents on file</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
              {hasPermission("client_email") && <NeuButton onClick={() => setClientEmailOpen(true)} className="min-h-9 px-3 text-xs"><Mail className="h-3.5 w-3.5" />Email Client</NeuButton>}
              <NeuButton disabled title="Carrier SMS sending is unavailable because no SMS API is configured" aria-label="Send carrier SMS unavailable" className="min-h-9 px-3 text-xs"><Phone className="h-3.5 w-3.5" />Send SMS</NeuButton>
              {canUseCarrierChat && <NeuButton onClick={() => setProfileTab("messages")} className="min-h-9 px-3 text-xs"><MessageCircle className="h-3.5 w-3.5" />Message Carrier</NeuButton>}
              <NeuButton disabled={!fmcsaUrl} title={fmcsaUrl ? "Open official FMCSA SAFER company snapshot" : "DOT number required for FMCSA lookup"} aria-label={fmcsaUrl ? "Open carrier on FMCSA" : "Carrier on FMCSA unavailable"} onClick={() => fmcsaUrl && window.open(fmcsaUrl, "_blank", "noopener,noreferrer")} className="min-h-9 px-3 text-xs">Carrier on FMCSA</NeuButton>
              {isManager && <NeuButton disabled={updateClient.isPending} onClick={() => updateClient.mutate({ status: client.status === "active" ? "inactive" : "active" })} className="min-h-9 px-3 text-xs">{client.status === "active" ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{client.status === "active" ? "Set inactive" : "Activate"}</NeuButton>}
            </div>
          </NeuCard>
          <CarrierFinancialOverview carrierId={clientId} />
          <NeuTabs value={profileTab} onValueChange={setProfileTab} className="carrier-neu-tabs">
            <NeuTabList>
              <NeuTab value="profile">Profile</NeuTab>
              <NeuTab value="notes">Notes</NeuTab>
              <NeuTab value="communications">Communications</NeuTab>
              {canUseCarrierChat && <NeuTab value="messages">Messages</NeuTab>}
            </NeuTabList>
            <NeuTabPanel value="profile" unmountInactive>
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
              <ProfileSection title="Notification email addresses" action={<ProfileActionButton onClick={() => openList("email")} variant="outline" size="sm"><Plus className="h-3 w-3" />Add</ProfileActionButton>}><MiniTable columns={["Email", "Actions"]} rows={((onboarding.notificationEmails || onboarding.emailAddresses || []) as any[]).map((email, i) => [email, <span className="flex gap-1"><ProfileActionButton variant="ghost" size="icon" onClick={() => openList("email", email, i)} aria-label="Edit email"><Pencil className="h-3 w-3" /></ProfileActionButton><ProfileActionButton variant="ghost" size="icon" onClick={() => deleteList("email", i)} aria-label="Delete email"><Trash2 className="h-3 w-3 text-[#a33131]" /></ProfileActionButton></span>])} empty="No notification email addresses are recorded" /></ProfileSection>
              <ProfileSection title="Notification phone numbers" action={<ProfileActionButton onClick={() => openList("phone")} variant="outline" size="sm"><Plus className="h-3 w-3" />Add</ProfileActionButton>}><MiniTable columns={["Phone", "Actions"]} rows={((onboarding.notificationPhones || onboarding.phoneNumbers || []) as any[]).map((phone, i) => [phone, <span className="flex gap-1"><ProfileActionButton variant="ghost" size="icon" onClick={() => openList("phone", phone, i)} aria-label="Edit phone"><Pencil className="h-3 w-3" /></ProfileActionButton><ProfileActionButton variant="ghost" size="icon" onClick={() => deleteList("phone", i)} aria-label="Delete phone"><Trash2 className="h-3 w-3 text-[#a33131]" /></ProfileActionButton></span>])} empty="No notification phone numbers are recorded" /></ProfileSection>
              <ProfileSection title="Trucks" action={<ProfileActionButton onClick={() => openList("truck")} variant="outline" size="sm"><Plus className="h-3 w-3" />Add</ProfileActionButton>}><MiniTable columns={["Unit", "Vehicle", "Plate", "Status", "Actions"]} rows={trucks.map((truck: any) => [truck.truckNumber, [truck.year, truck.make, truck.model].filter(Boolean).join(" "), `${truck.licensePlate || ""} ${truck.state || ""}`, truck.status, <span className="flex gap-1"><ProfileActionButton variant="ghost" size="icon" onClick={() => openList("truck", truck)} aria-label="Edit truck"><Pencil className="h-3 w-3" /></ProfileActionButton><ProfileActionButton variant="ghost" size="icon" onClick={() => window.confirm("Delete this truck?") && deleteTruck.mutate(truck.id)} aria-label="Delete truck"><Trash2 className="h-3 w-3 text-[#a33131]" /></ProfileActionButton></span>])} empty="No carrier-linked trucks are recorded" /></ProfileSection>
              <ProfileSection title="Rules" action={<ProfileActionButton onClick={() => openList("rule")} variant="outline" size="sm"><Plus className="h-3 w-3" />Add</ProfileActionButton>}><MiniTable columns={["Rule", "Actions"]} rows={(Array.isArray(onboarding.rules) ? onboarding.rules : Object.entries(onboarding.rules || {}).map(([key, value]) => `${key}: ${value}`)).map((rule: any, i: number) => [rule, <span className="flex gap-1"><ProfileActionButton variant="ghost" size="icon" onClick={() => openList("rule", rule, i)} aria-label="Edit rule"><Pencil className="h-3 w-3" /></ProfileActionButton><ProfileActionButton variant="ghost" size="icon" onClick={() => deleteList("rule", i)} aria-label="Delete rule"><Trash2 className="h-3 w-3 text-[#a33131]" /></ProfileActionButton></span>])} empty="No carrier-specific rules are recorded" /></ProfileSection>
              <ProfileSection title="Tasks" action={<ProfileActionButton onClick={() => openList("task")} variant="outline" size="sm"><Plus className="h-3 w-3" />Add</ProfileActionButton>}><MiniTable columns={["Task", "Status", "Due", "Actions"]} rows={carrierTasks.map((task: any) => [task.title, task.status, date(task.dueDate), <span className="flex gap-1"><ProfileActionButton variant="ghost" size="icon" onClick={() => openList("task", task)} aria-label="Edit task"><Pencil className="h-3 w-3" /></ProfileActionButton><ProfileActionButton variant="ghost" size="icon" onClick={() => window.confirm("Delete this task?") && deleteTask.mutate(task.id)} aria-label="Delete task"><Trash2 className="h-3 w-3 text-[#a33131]" /></ProfileActionButton></span>])} empty="No carrier tasks are recorded" /></ProfileSection>
              <ProfileSection title="Factoring documents">{docs(["Factoring Application", "Security Agreement", "NOA", "Deposit & Withdrawals Agreement"])}</ProfileSection>
              <ProfileSection title="Carrier documents">{docs(["W9", "Void Check", "Driver License", "Insurance Certificate", "Authority MC#", "EIN Letter", "Articles Of Organization"])}</ProfileSection>
              <ProfileSection title="Other sign-up documents">{docs(["Other", "Letter Of Intent", "Buyout Agreement"])}</ProfileSection>
              <ProfileSection title="UCC reports">{docs(["UCC-11 Search and Copy Request"])}</ProfileSection>
              <ProfileSection title="Sign-up documents">{docs(["Application", "Carrier Setup"])}</ProfileSection>
            </div>
            <div className="space-y-3">
              <ProfileSection title="AR" eyebrow="Funding position"><div className="grid gap-x-5 sm:grid-cols-2"><ProfileField label="Paid" value={money(paid)} tone="accent" /><ProfileField label="Open invoice value (derived)" value={money(onboarding.ar || openBalance)} tone="danger" /><ProfileField label="Max limit" value={money(onboarding.maxLimit)} /><ProfileField label="Current limit" value={money(onboarding.currentLimit)} /><ProfileField label="AR over eligible days" value={pretty(onboarding.arOver90Days)} /><ProfileField label="Availability" value={onboarding.availability ? money(onboarding.availability) : undefined} /></div></ProfileSection>
               <CarrierAlerts carrierId={clientId} canManage={isManager} />
              <ProfileSection title="Shorts & chargebacks"><div className="grid gap-x-5 sm:grid-cols-3"><ProfileField label="Carrier shorts" value={money(client.shorts)} tone="danger" /><ProfileField label="Advanced shorts" value={money(onboarding.advancedShorts)} tone="danger" /><ProfileField label="Pending chargebacks" value={money(onboarding.pendingChargebacks)} tone="danger" /></div></ProfileSection>
              <ProfileSection title="Cargo type" eyebrow="Default for new invoices">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="font-bold uppercase tracking-wider text-[#718187]">Current</span>
                    <LoadTypeBadge value={client.cargoType} neuStyle />
                  </div>
                  <LoadTypeToggleGroup
                    value={client.cargoType}
                    disabled={!isManager || updateClient.isPending}
                    onChange={(cargoType) => updateClient.mutate({ cargoType })}
                    neuStyle
                  />
                  {!isManager && <p className="text-[10px] text-[#718187]">Only managers and administrators can change the carrier default.</p>}
                  <div className="grid gap-x-5 sm:grid-cols-3">
                    <ProfileField label="Legacy dump flag" value={pretty(onboarding.dump || onboarding.dumpTruck)} />
                    <ProfileField label="Driver support" value={pretty(onboarding.driverSupport)} />
                    <ProfileField label="Legacy OTR" value={pretty(onboarding.otr || onboarding.operationClassification)} />
                  </div>
                </div>
              </ProfileSection>
              <ProfileSection title="Other info"><div className="grid gap-x-5 sm:grid-cols-2"><ProfileField label="Since" value={date(onboarding.since)} /><ProfileField label="Referral" value={onboarding.referral} /><ProfileField label="Last invoice" value={date([...clientInvoices].sort((a, b) => new Date(b.invoiceDate || b.createdAt).getTime() - new Date(a.invoiceDate || a.createdAt).getTime())[0]?.invoiceDate)} /><ProfileField label="Date created" value={date(client.createdAt)} /></div></ProfileSection>
              <ProfileSection title="To do list" action={<ProfileActionButton onClick={() => openList("task")} variant="outline" size="sm"><Plus className="h-3 w-3" />Add</ProfileActionButton>}><MiniTable columns={["Item", "Status"]} rows={(carrierTasks.length ? carrierTasks.filter((task: any) => task.status !== "completed") : (onboarding.toDo || onboarding.todo || [])).map((task: any) => [task.title || task.name, task.status])} empty="No open carrier to-do items are recorded" /></ProfileSection>
              <ProfileSection title="Dispatcher"><div className="flex items-center gap-3 border border-[#d0d9dc] bg-[#fbfcfb] p-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d9edf0] text-[#087d8d]"><UserRound className="h-5 w-5" /></div><div className="min-w-0 flex-1"><p className="text-[12px] font-bold">{carrierDispatcher ? [carrierDispatcher.firstName, carrierDispatcher.lastName].filter(Boolean).join(" ") : onboarding.dispatcherName || "No dispatcher linked"}</p><p className="text-[10px] text-[#718187]">{carrierDispatcher?.phone || onboarding.dispatcherPhone || "Phone not recorded"} · {carrierDispatcher?.email || onboarding.dispatcherEmail || "Email not recorded"}</p></div><span className="text-[10px] text-[#9aa7ab]">{carrierDispatcher?.status || (onboarding.dispatcherName ? onboarding.dispatcherStatus || "Linked" : "Unavailable")}</span></div></ProfileSection>
              <ProfileSection title="Bank accounts" eyebrow="Secure Vault" action={isManager ? <ProfileActionButton onClick={() => openBank()} variant="outline" size="sm"><Plus className="h-3 w-3" />Add</ProfileActionButton> : undefined}>
                {isManager ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[600px] text-left text-[10px]">
                      <thead className="bg-[#f0f4f3] uppercase tracking-wider text-[#63767d]"><tr>{["For", "Account name", "Financial institution", "Routing", "Account", "Type", "Actions"].map((heading) => <th key={heading} className="px-2 py-2 font-bold">{heading}</th>)}</tr></thead>
                      <tbody>{bankAccounts.map((account: any) => <tr key={account.id} className="border-t border-[#c8c8c8]"><td className="px-2 py-2">{account.paymentType || "Not recorded"}</td><td className="px-2 py-2 font-semibold">{account.nickname || "Operating account"}</td><td className="px-2 py-2">{account.bankName || "Not recorded"}</td><td className="px-2 py-2">•••••••••</td><td className="px-2 py-2">{revealed[account.id] || `•••• ${account.lastFour || "----"}`}</td><td className="px-2 py-2">{account.accountType || "Checking"}</td><td className="px-2 py-2"><div className="flex gap-1"><ProfileActionButton variant="ghost" size="icon" onClick={() => revealBank(account.id)} title="Reveal for 30 seconds" aria-label="Reveal bank account"><Eye className="h-3 w-3" /></ProfileActionButton><ProfileActionButton variant="ghost" size="sm" onClick={() => openBank(account)}>Edit</ProfileActionButton><ProfileActionButton variant="ghost" size="sm" onClick={() => window.confirm("Remove this bank account?") && deleteBank.mutate(account.id)}>Delete</ProfileActionButton></div></td></tr>)}</tbody>
                    </table>
                    {!bankAccounts.length && <EmptyState label="No bank accounts are stored in the secure Vault" />}
                  </div>
                ) : <EmptyState label="Bank accounts are restricted to managers and administrators" />}
              </ProfileSection>
              <ProfileSection title="Monitors" action={<ProfileActionButton onClick={() => openList("monitor")} variant="outline" size="sm"><Plus className="h-3 w-3" />Add</ProfileActionButton>}><MiniTable columns={["Name", "Phone", "Email", "Status", "Actions"]} rows={((onboarding.monitors || []) as any[]).map((monitor, i) => [monitor.name, monitor.phone, monitor.email, monitor.status, <span className="flex gap-1"><ProfileActionButton variant="ghost" size="icon" onClick={() => openList("monitor", monitor, i)} aria-label="Edit monitor"><Pencil className="h-3 w-3" /></ProfileActionButton><ProfileActionButton variant="ghost" size="icon" onClick={() => deleteList("monitor", i)} aria-label="Delete monitor"><Trash2 className="h-3 w-3 text-[#a33131]" /></ProfileActionButton></span>])} empty="No monitors are recorded" /></ProfileSection>
               <DriverSection carrierId={clientId} canEdit={isManager} legacyDriver={{ name: onboarding.driverName, phone: onboarding.driverPhone, email: onboarding.driverEmail }} />
              <ProfileSection title="Messages" action={<ProfileActionButton onClick={() => openList("message")} variant="outline" size="sm"><Plus className="h-3 w-3" />Add</ProfileActionButton>}>{(onboarding.messages || []).length ? <div className="space-y-2">{onboarding.messages.map((message: any, i: number) => <div key={i} className="border border-[#d0d9dc] p-2 text-[11px]"><div className="flex justify-between gap-3"><b>{message.author}</b><span className="shrink-0 text-[#718187]">{dateTime(message.timestamp)}</span></div><p className="mt-1 whitespace-pre-wrap text-[11px]">{message.message}</p><ProfileActionButton variant="ghost" size="sm" onClick={() => deleteList("message", i)}>Delete message</ProfileActionButton></div>)}</div> : <EmptyState label="No internal messages are recorded" />}</ProfileSection>
              <ProfileSection title="RAP sheet">{docs(["RAP Sheet"])}</ProfileSection>
              <ProfileSection title="Preferred brokers"><MiniTable columns={["Broker", "Reference"]} rows={((onboarding.preferredBrokers || []) as any[]).map((broker) => [broker.name || broker, broker.mcNumber || "Onboarding"]) } empty="No preferred brokers are recorded" /></ProfileSection>
              <ProfileSection title="UCC">{docs(["UCC-1-UT Initial Financing Statement", "UCC-3-UT Continuation"])}</ProfileSection>
              <ProfileSection title="Other documents">{docs(["Other Documents", "Envelope", "Logo"])}</ProfileSection>
              <ProfileSection title="Invoices" eyebrow="Funding activity" action={<ProfileActionButton onClick={() => setInvoiceOpen(true)} size="sm"><Plus className="h-3 w-3" />Create invoice</ProfileActionButton>}><MiniTable columns={["Invoice", "Date", "Amount", "Status"]} rows={clientInvoices.map((invoice) => [<a key={invoice.id} className="font-semibold text-[#168d98] hover:underline" href={`/invoices/${invoice.id}`}>{invoice.invoiceNumber}</a>, date(invoice.invoiceDate || invoice.createdAt), money(invoice.amount), <NeuBadge key={`status-${invoice.id}`} tone={["paid", "settled"].includes(invoice.status) ? "success" : ["rejected", "void"].includes(invoice.status) ? "warning" : "accent"}>{invoice.status}</NeuBadge>])} empty="No invoices are recorded for this carrier" /></ProfileSection>
              <ProfileSection title="Aging report" className="scroll-mt-4" ><div id="aging-report" className="space-y-3"><p className="text-[11px] text-[#718187]">Download open funded invoices in the carrier aging format.</p><AgingPdfDownload carrierId={clientId} minDays={agingDays} onMinDaysChange={setAgingDays} compact /></div></ProfileSection>
            </div>
            </div>
            </NeuTabPanel>
            <NeuTabPanel value="notes" unmountInactive className="space-y-4">
              {client.notes && <ProfileSection title="Legacy profile note" eyebrow="Read-only · preserved from the carrier record"><p className="whitespace-pre-wrap text-[12px] leading-5">{client.notes}</p></ProfileSection>}
              <EntityNotes key={`carrier:${clientId}`} entityType="carrier" entityId={clientId} />
            </NeuTabPanel>
            <NeuTabPanel value="communications" unmountInactive className="space-y-3">
               {hasPermission("client_email") && <div className="flex flex-wrap items-center justify-between gap-3 border border-[#b7c6c1] bg-[#eaf1ee] px-3 py-3">
                 <div><p className="text-xs font-bold text-[#304a52]">Send a message to {client.name}</p><p className="mt-0.5 text-[10px] text-[#687b78]">{client.email || "No email address recorded on this profile"}</p></div>
                 <NeuButton onClick={() => setClientEmailOpen(true)} className="min-h-9 px-3 text-xs"><Mail className="h-3.5 w-3.5" />Email Client</NeuButton>
               </div>}
               <ClientEmailLog clientId={clientId} />
            </NeuTabPanel>
            {canUseCarrierChat && <NeuTabPanel value="messages" unmountInactive className="min-h-[520px]">
               <CarrierChatThread carrierId={clientId} carrierName={client.name} mcNumber={client.mcNumber} />
            </NeuTabPanel>}
          </NeuTabs>
          </div>
      </NeuPageShell>
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
    <ClientEmailComposer open={clientEmailOpen} onOpenChange={setClientEmailOpen} initialClient={{ id: clientId, name: client.name, email: client.email || null }} />
  </div>;
}