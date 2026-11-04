import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Textarea as BaseTextarea } from "@/components/ui/textarea";
import { Dialog, DialogClose, DialogContent as BaseDialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton-rows";
import CreateInvoiceModal from "@/components/modals/create-invoice-modal";
import { CompressionInfo } from "@/components/documents/compression-info";
import CarrierChatThread from "@/components/carriers/CarrierChatThread";
import EntityNotes from "@/components/shared/EntityNotes";
import {
  NeuBadge, NeuButton, NeuCard, NeuInput, NeuPageShell, NeuSelect, NeuStatCard,
  NeuTab, NeuTabList, NeuTabPanel, NeuTabs, NeuTable, NeuTableBody, NeuTableCell,
  NeuTableHead, NeuTableHeader, NeuTableRow,
} from "@/styles/neu/components";
import { PageInsights } from "@/components/PageInsights";
import {
  AlertTriangle, Check, Download, Eye, FileText, MessageCircle, Search, UserCheck, X,
} from "lucide-react";

interface Doc {
  id: number;
  documentType: string;
  originalName: string;
  mimeType?: string;
  size?: number;
  originalSize?: number;
  compressedSize?: number;
}
interface Submission {
  id: number;
  portalUserId: number;
  companyName?: string;
  invoiceNumber?: string;
  loadNumber?: string;
  brokerName?: string;
  carrierId?: number;
  brokerId?: number;
  branchId?: number;
  branchName?: string;
  loadType?: string;
  code?: string;
  lumper?: boolean;
  driverName?: string;
  bankAccountId?: number;
  bankAccount?: { bankName: string; nickname: string; lastFour: string };
  instructionsSubject?: string;
  instructionsDetails?: string;
  amount?: string;
  paymentType?: string;
  status: string;
  notes?: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  submittedAt?: string;
  documents?: Doc[];
}
interface CarrierChatSummary {
  carrierId: string | number;
  carrierName?: string | null;
  mcNumber?: string | null;
  unreadCount?: number;
  lastMessage?: string | { message?: string | null; createdAt?: string | null } | null;
  lastMessageAt?: string | null;
}
interface PortalUser {
  id: number;
  companyName: string;
  mcNumber?: string | null;
  dotNumber?: string | null;
  email: string;
  phone?: string | null;
  phoneNumber?: string | null;
  createdAt?: string | null;
  status: string;
  emailSent?: boolean;
}

const STATUS_OPTS = ["submitted", "under_review", "approved", "funded", "rejected"];
const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "warning"> = {
  submitted: "accent",
  under_review: "warning",
  approved: "success",
  funded: "success",
  rejected: "neutral",
};
const DOC_LABEL: Record<string, string> = {
  rate_confirmation: "Rate confirmation",
  bol: "Bill of lading",
  lumper_receipt: "Lumper receipt",
  other: "Other",
};
const prettyStatus = (status: string) => status.replaceAll("_", " ");
const dateOnly = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
};
const formatChatTime = (value?: string | null) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
};
const dayFloor = (value: string) => value ? new Date(`${value}T00:00:00`).getTime() : null;
const dayCeiling = (value: string) => value ? new Date(`${value}T23:59:59.999`).getTime() : null;

function Textarea({ className, ...props }: ComponentProps<typeof BaseTextarea>) {
  return <BaseTextarea {...props} className={cn(className, "[&&]:!rounded-xl [&&]:!border-0 [&&]:!bg-[#e0e0e0] [&&]:!text-[#333] [&&]:!shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#fff]")} />;
}

function DialogContent({ className, children, ...props }: ComponentProps<typeof BaseDialogContent>) {
  return (
    <BaseDialogContent {...props} showCloseButton={false} className={cn(className,
      "grid-cols-1 [&>*]:min-w-0 !border-0 !bg-[#e0e0e0] !shadow-[-7px_-7px_16px_#fff,7px_7px_16px_#b8b8b8] [&>div:first-child]:pr-10")}>
      {children}
      <DialogClose asChild>
        <NeuButton aria-label="Close dialog" className="absolute right-4 top-4 !h-8 !min-h-8 !w-8 !rounded-full !p-0 hover:text-[#27aab8]"><X className="h-4 w-4" /></NeuButton>
      </DialogClose>
    </BaseDialogContent>
  );
}

export default function PortalSubmissionsPage() {
  const [location, setLocation] = useLocation();
  const { user, permissions, isLoading: authLoading } = useAuth();
  const isAdmin = user?.role === "admin";
  const canUsePortal = !!user && (isAdmin || (!authLoading && permissions.includes("portal_submissions")));
  const canUseChat = !!user && (isAdmin || (!authLoading && (permissions.includes("chat") || permissions.includes("portal_submissions"))));
  const canUseHub = canUsePortal || canUseChat;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [registrationSearch, setRegistrationSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [registrationStatus, setRegistrationStatus] = useState("pending");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [registrationStartDate, setRegistrationStartDate] = useState("");
  const [registrationEndDate, setRegistrationEndDate] = useState("");
  const [detail, setDetail] = useState<Submission | null>(null);
  const [registrationDetail, setRegistrationDetail] = useState<PortalUser | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false);
  const [showUnreviewedOnly, setShowUnreviewedOnly] = useState(false);
  const [activeTab, setActiveTab] = useState("submissions");
  const [rejectingRegistration, setRejectingRegistration] = useState<PortalUser | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [chatCarrier, setChatCarrier] = useState<{ id: number; name?: string; mcNumber?: string | null } | null>(null);
  const [inlineCarrier, setInlineCarrier] = useState<{ id: number; name?: string; mcNumber?: string | null } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const {
    data: submissions = [],
    isLoading,
    isError: submissionsError,
    refetch: refetchSubmissions,
  } = useQuery<Submission[]>({
    queryKey: ["/api/carrier-portal/submissions"],
    refetchInterval: 30000,
    enabled: canUsePortal,
  });
  const {
    data: carrierChats = [],
    isError: chatListError,
    refetch: refetchChatList,
  } = useQuery<CarrierChatSummary[]>({
    queryKey: ["/api/carrier-chat"],
    queryFn: async () => {
      const response = await fetch("/api/carrier-chat", { credentials: "include" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || "Unable to load carrier chat counts");
      }
      const rows = await response.json();
      return (Array.isArray(rows) ? rows : []).map((row: any) => ({
        ...row,
        carrierId: row.carrierId ?? row.id,
        unreadCount: Number(row.unreadCount || 0),
      }));
    },
    refetchInterval: 5000,
    retry: false,
    enabled: canUseChat,
  });
  const { data: unreviewedCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/portal-submissions/unreviewed-count"],
    refetchInterval: 30000,
    enabled: canUsePortal,
  });
  const unreviewedCount = unreviewedCountData?.count ?? submissions.filter((item) => !item.reviewedAt).length;
  const {
    data: portalUsers = [],
    isLoading: portalUsersLoading,
    isError: registrationsError,
    refetch: refetchPortalUsers,
  } = useQuery<PortalUser[]>({
    queryKey: ["/api/carrier-portal/users"],
    refetchInterval: 30000,
    enabled: canUsePortal,
  });
  const { data: pendingCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/carrier-portal/pending-count"],
    refetchInterval: 30000,
    enabled: canUsePortal,
  });
  const pendingRegistrations = portalUsers.filter((portalUser) => portalUser.status === "pending");
  const pendingCount = pendingCountData?.count ?? pendingRegistrations.length;
  const chatSummaries = useMemo(() => {
    const grouped = new Map<string, CarrierChatSummary>();
    carrierChats.forEach((chat) => {
      const key = String(chat.carrierId);
      const existing = grouped.get(key);
      const unreadCount = Number(existing?.unreadCount || 0) + Number(chat.unreadCount || 0);
      const currentTime = chat.lastMessageAt || (typeof chat.lastMessage === "object" ? chat.lastMessage?.createdAt : null) || "";
      const existingTime = existing?.lastMessageAt || (typeof existing?.lastMessage === "object" ? existing.lastMessage?.createdAt : null) || "";
      const latest = currentTime && (!existingTime || new Date(currentTime).getTime() >= new Date(existingTime).getTime()) ? chat : existing || chat;
      grouped.set(key, {
        ...latest,
        carrierId: chat.carrierId,
        carrierName: latest.carrierName || chat.carrierName,
        unreadCount,
        lastMessageAt: currentTime && (!existingTime || new Date(currentTime).getTime() >= new Date(existingTime).getTime()) ? currentTime : existingTime,
      });
    });
    return Array.from(grouped.values()).sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime());
  }, [carrierChats]);
  const carrierUnreadById = useMemo(
    () => new Map(chatSummaries.map((chat) => [String(chat.carrierId), Number(chat.unreadCount || 0)])),
    [chatSummaries],
  );

  useEffect(() => {
    if (!canUsePortal && canUseChat) setActiveTab("messages");
  }, [canUsePortal, canUseChat]);

  useEffect(() => {
    const query = location.includes("?") ? location.slice(location.indexOf("?") + 1) : "";
    const requested = new URLSearchParams(query).get("carrierId");
    if (!requested || !canUseChat) return;
    const id = Number(requested);
    if (!Number.isInteger(id) || id <= 0) return;
    const summary = chatSummaries.find((chat) => String(chat.carrierId) === requested);
    setActiveTab("messages");
    setChatCarrier(null);
    setInlineCarrier({ id, name: summary?.carrierName || undefined, mcNumber: summary?.mcNumber });
  }, [location, canUseChat, chatSummaries]);

  const openChat = (carrierId: string | number, summary?: CarrierChatSummary) => {
    const id = Number(carrierId);
    if (!Number.isInteger(id) || !canUseChat) return;
    setInlineCarrier(null);
    setChatCarrier({ id, name: summary?.carrierName || undefined, mcNumber: summary?.mcNumber });
  };
  const closeChat = () => {
    setChatCarrier(null);
    const [pathname, queryString = ""] = location.split("?");
    const params = new URLSearchParams(queryString);
    params.delete("carrierId");
    const query = params.toString();
    setLocation(query ? `${pathname}?${query}` : pathname);
  };
  const selectInlineChat = (carrierId: string | number, summary?: CarrierChatSummary) => {
    const id = Number(carrierId);
    if (!Number.isInteger(id) || !canUseChat) return;
    setChatCarrier(null);
    setInlineCarrier({ id, name: summary?.carrierName || undefined, mcNumber: summary?.mcNumber });
    const [pathname, queryString = ""] = location.split("?");
    const params = new URLSearchParams(queryString);
    params.set("carrierId", String(id));
    setLocation(`${pathname}?${params.toString()}`);
  };
  const closeInlineChat = () => {
    setInlineCarrier(null);
    const [pathname, queryString = ""] = location.split("?");
    const params = new URLSearchParams(queryString);
    params.delete("carrierId");
    const query = params.toString();
    setLocation(query ? `${pathname}?${query}` : pathname);
  };

  const registrationMutation = useMutation({
    mutationFn: async ({ id, action, reason }: { id: number; action: "approve" | "reject"; reason?: string }) => {
      const response = await fetch(`/api/carrier-portal/users/${id}/${action}`, {
        method: "PATCH",
        headers: action === "reject" ? { "Content-Type": "application/json" } : undefined,
        credentials: "include",
        body: action === "reject" ? JSON.stringify({ reason }) : undefined,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || `Unable to ${action} registration`);
      return body as PortalUser;
    },
    onSuccess: (updated, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-portal/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-portal/pending-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-portal/submissions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal-submissions/unreviewed-count"] });
      setRejectingRegistration(null);
      setRejectionReason("");
      toast({
        title: variables.action === "approve"
          ? `Carrier ${updated.companyName} approved successfully`
          : `Carrier ${updated.companyName} rejected successfully`,
        description: updated.emailSent === false
          ? "Account status was updated, but the email provider did not confirm delivery."
          : undefined,
        variant: updated.emailSent === false ? "destructive" : undefined,
      });
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/carrier-portal/submissions/${id}/review`, {
        method: "POST",
        credentials: "include",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Unable to mark submission reviewed");
      return body as Submission;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<Submission[]>(["/api/carrier-portal/submissions"], (current) =>
        current?.map((item) => item.id === updated.id
          ? { ...item, reviewedAt: updated.reviewedAt, reviewedBy: updated.reviewedBy }
          : item),
      );
      queryClient.invalidateQueries({ queryKey: ["/api/portal-submissions/unreviewed-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-portal/submissions"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: number; status: string; notes: string }) => {
      const response = await fetch(`/api/carrier-portal/submissions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status, notes }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Update failed");
      return body;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-portal/submissions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal-submissions/unreviewed-count"] });
      setDetail((previous) => previous ? { ...previous, ...updated } : previous);
      toast({ title: "Submission updated" });
    },
    onError: (error: Error) => toast({ title: "Error", description: error.message, variant: "destructive" }),
  });

  const filtered = submissions.filter((submission) => {
    const statusMatches = filterStatus === "all" || submission.status === filterStatus;
    const reviewMatches = !showUnreviewedOnly || !submission.reviewedAt;
    const query = search.toLowerCase();
    const searchMatches = !query || [
      submission.companyName, submission.invoiceNumber, submission.loadNumber, submission.brokerName,
      String(submission.id), String(submission.carrierId || ""),
    ].some((value) => value?.toLowerCase().includes(query));
    const submitted = submission.submittedAt ? new Date(submission.submittedAt).getTime() : NaN;
    const afterStart = dayFloor(startDate) == null || (Number.isFinite(submitted) && submitted >= dayFloor(startDate)!);
    const beforeEnd = dayCeiling(endDate) == null || (Number.isFinite(submitted) && submitted <= dayCeiling(endDate)!);
    return statusMatches && reviewMatches && searchMatches && afterStart && beforeEnd;
  }).sort((a, b) => new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime());
  const filteredRegistrations = pendingRegistrations.filter((registration) => {
    const query = registrationSearch.toLowerCase();
    const searchMatches = !query || [
      registration.companyName, registration.mcNumber, registration.dotNumber, registration.email,
      registration.phone, registration.phoneNumber, String(registration.id),
    ].some((value) => value?.toLowerCase().includes(query));
    const statusMatches = registrationStatus === "all" || registration.status === registrationStatus;
    const created = registration.createdAt ? new Date(registration.createdAt).getTime() : NaN;
    const afterStart = dayFloor(registrationStartDate) == null || (Number.isFinite(created) && created >= dayFloor(registrationStartDate)!);
    const beforeEnd = dayCeiling(registrationEndDate) == null || (Number.isFinite(created) && created <= dayCeiling(registrationEndDate)!);
    return searchMatches && statusMatches && afterStart && beforeEnd;
  });

  function openDetail(submission: Submission) {
    setDetail(submission);
    setEditNotes(submission.notes || "");
    setEditStatus(submission.status);
    if (!submission.reviewedAt) reviewMutation.mutate(submission.id);
  }
  function reviewIndicator(submission: Submission) {
    if (submission.reviewedAt) return <NeuBadge>Reviewed</NeuBadge>;
    const submitted = new Date(submission.submittedAt || 0).getTime();
    if (Date.now() - submitted <= 24 * 60 * 60 * 1000) return <NeuBadge tone="accent">New</NeuBadge>;
    return <NeuBadge tone="warning">Pending review</NeuBadge>;
  }
  const statusBadge = (status: string) => (
    <NeuBadge tone={STATUS_TONE[status] || "neutral"} className={cn("capitalize", status === "rejected" && "text-[#943b3b]")}>{prettyStatus(status)}</NeuBadge>
  );
  const submissionStats = [
    { label: "Total Submissions", value: submissions.length, icon: <FileText className="h-5 w-5" /> },
    { label: "Pending Review", value: unreviewedCount, icon: <AlertTriangle className="h-5 w-5" /> },
    { label: "Approved", value: submissions.filter((submission) => submission.status === "approved").length, icon: <Check className="h-5 w-5" /> },
    { label: "Rejected", value: submissions.filter((submission) => submission.status === "rejected").length, icon: <X className="h-5 w-5" /> },
  ];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 bg-[#e0e0e0]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Portal Submissions" subtitle="Invoice submissions from the carrier portal" group="Workspace" neu />
        <NeuPageShell className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-auto px-4 py-5 sm:px-6 lg:px-8">
          <PageInsights entity="portal-submissions" title="Submission pipeline" />
          <div className="mx-auto w-full max-w-[1480px] space-y-6">
            {canUsePortal && (
              <section aria-label="Submission overview" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {submissionStats.map((stat) => (
                  <NeuStatCard
                    key={stat.label}
                    label={stat.label}
                    value={<span className="text-[#2196a3]">{stat.value}</span>}
                    icon={stat.icon}
                    className="min-h-32 p-4"
                  />
                ))}
              </section>
            )}

            {canUsePortal && unreviewedCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab("submissions");
                  setShowUnreviewedOnly(true);
                  window.setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
                }}
                className="w-full text-left"
              >
                <NeuCard className="flex items-center gap-3 px-4 py-3 text-[#8a6426]">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  <span className="text-sm font-semibold">{unreviewedCount} carrier submission{unreviewedCount === 1 ? "" : "s"} need review</span>
                </NeuCard>
              </button>
            )}
            {canUsePortal && pendingCount > 0 && (
              <button type="button" onClick={() => setActiveTab("registrations")} className="w-full text-left">
                <NeuCard className="flex items-center gap-3 px-4 py-3 text-[#267b82]">
                  <UserCheck className="h-5 w-5 shrink-0" />
                  <span className="text-sm font-semibold">{pendingCount} carrier{pendingCount === 1 ? "" : "s"} pending registration review</span>
                </NeuCard>
              </button>
            )}

            {!canUseHub ? (
              <NeuCard className="p-6 text-sm text-[#8b4e4e]">Portal Submissions or Chat permission is required to access this page.</NeuCard>
            ) : (
              <NeuTabs value={activeTab} onValueChange={setActiveTab}>
                <NeuTabList className="w-fit max-w-full">
                  {canUsePortal && <NeuTab value="submissions"><FileText className="h-4 w-4" />Submissions{unreviewedCount > 0 && <NeuBadge tone="accent" className="px-2 py-0.5">{unreviewedCount}</NeuBadge>}</NeuTab>}
                  {canUsePortal && (
                    <NeuTab value="registrations">
                      <UserCheck className="h-4 w-4" />Pending Registrations
                      {pendingCount > 0 && <NeuBadge tone="accent" className="px-2 py-0.5">{pendingCount}</NeuBadge>}
                    </NeuTab>
                  )}
                  {canUseChat && <NeuTab value="messages"><MessageCircle className="h-4 w-4" />Messages{chatSummaries.some(chat => Number(chat.unreadCount) > 0) && <NeuBadge tone="accent" className="px-2 py-0.5">{chatSummaries.reduce((sum, chat) => sum + Number(chat.unreadCount || 0), 0)}</NeuBadge>}</NeuTab>}
                </NeuTabList>

                {canUsePortal && (
                  <NeuTabPanel value="submissions" className="space-y-5 p-4 sm:p-6">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                      <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888]" />
                        <NeuInput
                          aria-label="Search submissions"
                          placeholder="Search carrier, invoice, load, broker, or ID"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          className="pl-9 pr-10"
                        />
                        {!!search && <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777]"><X className="h-4 w-4" /></button>}
                      </div>
                      <NeuSelect aria-label="Filter submission status" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)} className="lg:w-48">
                        <option value="all">All statuses</option>
                        {STATUS_OPTS.map((status) => <option key={status} value={status}>{prettyStatus(status)}</option>)}
                      </NeuSelect>
                      <div className="grid grid-cols-2 gap-2 lg:w-[19rem]">
                        <NeuInput aria-label="Submitted from date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="px-2 text-xs" />
                        <NeuInput aria-label="Submitted through date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="px-2 text-xs" />
                      </div>
                      {showUnreviewedOnly && <NeuButton onClick={() => setShowUnreviewedOnly(false)} className="min-h-10 px-3 py-2 text-xs">Clear review filter</NeuButton>}
                    </div>

                    <div ref={tableRef} className="space-y-3">
                      <div className="flex flex-wrap items-end justify-between gap-2">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.13em] text-[#888]">Intake queue</p>
                          <h2 className="mt-1 text-xl font-semibold">Carrier submissions</h2>
                        </div>
                        <p className="text-sm text-[#777]">{filtered.length} shown · {submissions.length} total</p>
                      </div>
                      {submissionsError ? (
                        <NeuCard className="p-6 text-center">
                          <p className="text-sm text-[#8b4e4e]">Submissions could not be loaded.</p>
                          <NeuButton onClick={() => void refetchSubmissions()} className="mt-3 min-h-9 px-3 py-1.5 text-xs">Try again</NeuButton>
                        </NeuCard>
                      ) : isLoading ? <SkeletonRows rows={5} cols={9} /> : filtered.length === 0 ? (
                        <NeuCard className="p-8 text-center">
                          <EmptyState icon={FileText} title="No submissions" description="No carrier submissions match these filters." />
                        </NeuCard>
                      ) : (
                        <NeuTable>
                          <NeuTableHeader>
                            <NeuTableRow className="hover:bg-transparent">
                              <NeuTableHead>ID</NeuTableHead><NeuTableHead>Carrier</NeuTableHead>
                              <NeuTableHead>Invoice #</NeuTableHead><NeuTableHead>Load #</NeuTableHead>
                              <NeuTableHead className="text-right">Amount</NeuTableHead><NeuTableHead>Submitted</NeuTableHead>
                              <NeuTableHead>Status</NeuTableHead><NeuTableHead>Docs</NeuTableHead><NeuTableHead>Actions</NeuTableHead>
                            </NeuTableRow>
                          </NeuTableHeader>
                          <NeuTableBody>
                            {filtered.map((submission) => (
                              <NeuTableRow key={submission.id} onClick={() => openDetail(submission)} className="cursor-pointer">
                                <NeuTableCell className="font-mono text-xs">#{submission.id}</NeuTableCell>
                                <NeuTableCell className="max-w-52 truncate font-semibold">{submission.companyName || `Portal User #${submission.portalUserId}`}</NeuTableCell>
                                <NeuTableCell>{submission.invoiceNumber || "—"}</NeuTableCell>
                                <NeuTableCell>{submission.loadNumber || "—"}</NeuTableCell>
                                <NeuTableCell className="text-right font-mono">{submission.amount ? `$${Number.parseFloat(submission.amount).toLocaleString()}` : "—"}</NeuTableCell>
                                <NeuTableCell>{dateOnly(submission.submittedAt)}</NeuTableCell>
                                <NeuTableCell>{statusBadge(submission.status)}</NeuTableCell>
                                <NeuTableCell><NeuBadge>{submission.documents?.length || 0}</NeuBadge></NeuTableCell>
                                <NeuTableCell>
                                  <div className="flex items-center gap-1.5" onClick={(event) => event.stopPropagation()}>
                                    <NeuButton onClick={() => openDetail(submission)} className="min-h-8 px-2.5 py-1 text-xs">View</NeuButton>
                                    <NeuButton onClick={() => { openDetail(submission); setEditStatus("approved"); }} className="min-h-8 px-2.5 py-1 text-xs">Approve</NeuButton>
                                    <NeuButton onClick={() => { openDetail(submission); setEditStatus("rejected"); }} className="min-h-8 px-2.5 py-1 text-xs text-[#943b3b]">Reject</NeuButton>
                                    <NeuButton
                                      title={!submission.carrierId ? "No linked carrier for this submission" : canUseChat ? "Message carrier" : "Chat permission required"}
                                      aria-label="Message carrier"
                                      disabled={!submission.carrierId || !canUseChat}
                                      onClick={() => submission.carrierId && openChat(
                                        submission.carrierId,
                                        chatSummaries.find((chat) => String(chat.carrierId) === String(submission.carrierId))
                                          || { carrierId: submission.carrierId, carrierName: submission.companyName },
                                      )}
                                      className="min-h-8 px-2.5 py-1 text-xs"
                                    >
                                      <MessageCircle className="h-3.5 w-3.5" />
                                      {!!submission.carrierId && carrierUnreadById.get(String(submission.carrierId)) ? carrierUnreadById.get(String(submission.carrierId)) : ""}
                                    </NeuButton>
                                  </div>
                                </NeuTableCell>
                              </NeuTableRow>
                            ))}
                          </NeuTableBody>
                        </NeuTable>
                      )}
                    </div>
                  </NeuTabPanel>
                )}

                {canUsePortal && (
                  <NeuTabPanel value="registrations" className="space-y-5 p-4 sm:p-6">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                      <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888]" />
                        <NeuInput aria-label="Search registrations" placeholder="Search company, MC, email, or phone" value={registrationSearch} onChange={(event) => setRegistrationSearch(event.target.value)} className="pl-9" />
                      </div>
                      <NeuSelect aria-label="Filter registration status" value={registrationStatus} onChange={(event) => setRegistrationStatus(event.target.value)} className="lg:w-48">
                        <option value="pending">Pending registrations</option>
                        <option value="all">All loaded statuses</option>
                      </NeuSelect>
                      <div className="grid grid-cols-2 gap-2 lg:w-[19rem]">
                        <NeuInput aria-label="Registered from date" type="date" value={registrationStartDate} onChange={(event) => setRegistrationStartDate(event.target.value)} className="px-2 text-xs" />
                        <NeuInput aria-label="Registered through date" type="date" value={registrationEndDate} onChange={(event) => setRegistrationEndDate(event.target.value)} className="px-2 text-xs" />
                      </div>
                    </div>
                    <div className="flex items-end justify-between gap-3">
                      <div><p className="text-xs font-bold uppercase tracking-[0.13em] text-[#888]">Carrier accounts</p><h2 className="mt-1 text-xl font-semibold">Pending registrations</h2></div>
                      <p className="text-sm text-[#777]">{filteredRegistrations.length} awaiting review</p>
                    </div>
                    {registrationsError ? (
                      <NeuCard className="p-6 text-center">
                        <p className="text-sm text-[#8b4e4e]">Registrations could not be loaded.</p>
                        <NeuButton onClick={() => void refetchPortalUsers()} className="mt-3 min-h-9 px-3 py-1.5 text-xs">Try again</NeuButton>
                      </NeuCard>
                    ) : portalUsersLoading ? <SkeletonRows rows={4} cols={7} /> : filteredRegistrations.length === 0 ? (
                      <NeuCard className="p-8 text-center"><EmptyState icon={UserCheck} title="No registrations" description="No pending carrier registrations match these filters." /></NeuCard>
                    ) : (
                      <NeuTable>
                        <NeuTableHeader>
                          <NeuTableRow className="hover:bg-transparent">
                            <NeuTableHead>Carrier</NeuTableHead><NeuTableHead>MC #</NeuTableHead>
                            <NeuTableHead>Contact email</NeuTableHead><NeuTableHead>Phone</NeuTableHead>
                            <NeuTableHead>Submitted</NeuTableHead><NeuTableHead>Status</NeuTableHead><NeuTableHead>Actions</NeuTableHead>
                          </NeuTableRow>
                        </NeuTableHeader>
                        <NeuTableBody>
                          {filteredRegistrations.map((registration) => (
                            <NeuTableRow key={registration.id}>
                              <NeuTableCell className="font-semibold">{registration.companyName || "—"}</NeuTableCell>
                              <NeuTableCell>{registration.mcNumber || "—"}</NeuTableCell>
                              <NeuTableCell>{registration.email || "—"}</NeuTableCell>
                              <NeuTableCell>{registration.phone || registration.phoneNumber || "—"}</NeuTableCell>
                              <NeuTableCell>{dateOnly(registration.createdAt)}</NeuTableCell>
                              <NeuTableCell><NeuBadge tone="warning" className="capitalize">{prettyStatus(registration.status)}</NeuBadge></NeuTableCell>
                              <NeuTableCell>
                                <div className="flex flex-wrap gap-1.5">
                                  <NeuButton onClick={() => setRegistrationDetail(registration)} className="min-h-8 px-2.5 py-1 text-xs">View details</NeuButton>
                                  <NeuButton onClick={() => registrationMutation.mutate({ id: registration.id, action: "approve" })} disabled={registrationMutation.isPending} className="min-h-8 px-2.5 py-1 text-xs">
                                    <Check className="h-3.5 w-3.5" />Approve
                                  </NeuButton>
                                  <NeuButton onClick={() => { setRejectingRegistration(registration); setRejectionReason(""); }} disabled={registrationMutation.isPending} className="min-h-8 px-2.5 py-1 text-xs">
                                    <X className="h-3.5 w-3.5" />Reject
                                  </NeuButton>
                                </div>
                              </NeuTableCell>
                            </NeuTableRow>
                          ))}
                        </NeuTableBody>
                      </NeuTable>
                    )}
                  </NeuTabPanel>
                )}

                {canUseChat && (
                  <NeuTabPanel value="messages" className="p-3 sm:p-5">
                    {chatListError ? (
                      <NeuCard className="p-8 text-center">
                        <p className="text-sm text-[#8b4e4e]">Carrier conversations could not be loaded.</p>
                        <NeuButton onClick={() => void refetchChatList()} className="mt-3 min-h-9 px-3 py-1.5 text-xs">Try again</NeuButton>
                      </NeuCard>
                    ) : chatSummaries.length === 0 ? (
                      <NeuCard className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
                        <MessageCircle className="mb-3 h-8 w-8 text-[#27aab8]" />
                        <p className="font-semibold">No messages</p>
                        <p className="mt-1 text-sm text-[#888]">Carrier conversations will appear here.</p>
                      </NeuCard>
                    ) : (
                      <div className="grid min-h-[560px] min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(250px,0.82fr)_minmax(0,1.7fr)]">
                        <NeuCard className="min-h-0 overflow-hidden p-3">
                          <div className="mb-3 flex items-center justify-between px-1">
                            <div><p className="text-xs font-bold uppercase tracking-[0.13em] text-[#888]">Inbox</p><h2 className="font-semibold">Carrier messages</h2></div>
                            <NeuBadge>{chatSummaries.length}</NeuBadge>
                          </div>
                          <div className="max-h-[68vh] space-y-2 overflow-y-auto p-1">
                            {chatSummaries.map((chat) => {
                              const last = typeof chat.lastMessage === "string" ? chat.lastMessage : chat.lastMessage?.message || "";
                              const lastAt = chat.lastMessageAt || (typeof chat.lastMessage === "object" ? chat.lastMessage?.createdAt : null);
                              const active = inlineCarrier?.id === Number(chat.carrierId);
                              const initials = (chat.carrierName || "Carrier").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
                              return (
                                <button
                                  key={String(chat.carrierId)}
                                  type="button"
                                  onClick={() => selectInlineChat(chat.carrierId, chat)}
                                  aria-pressed={active}
                                  className={`flex w-full min-w-0 items-center gap-3 rounded-xl p-3 text-left transition-[transform,box-shadow] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#27aab8] ${active ? "bg-[#e0e0e0] shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff]" : "bg-[#e0e0e0] shadow-[-4px_-4px_8px_#fff,4px_4px_8px_#c1c1c1]"}`}
                                >
                                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#d4e7e7] text-sm font-semibold text-[#267b82]">{initials}</span>
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold">{chat.carrierName || "Carrier"}</span><span className="shrink-0 text-[10px] text-[#888]">{formatChatTime(lastAt)}</span></span>
                                    <span className="block text-xs text-[#777]">{chat.mcNumber ? `MC ${chat.mcNumber}` : "Carrier conversation"}</span>
                                    <span className="mt-1 block truncate text-xs text-[#777]">{last || "No messages yet"}</span>
                                  </span>
                                  {!!chat.unreadCount && <NeuBadge tone="accent" className="px-2 py-0.5">{chat.unreadCount > 9 ? "9+" : chat.unreadCount}</NeuBadge>}
                                </button>
                              );
                            })}
                          </div>
                        </NeuCard>
                        <NeuCard className="flex min-h-[520px] min-w-0 flex-col overflow-hidden p-1">
                          {inlineCarrier ? (
                            <CarrierChatThread
                              key={`inline-${inlineCarrier.id}`}
                              carrierId={inlineCarrier.id}
                              carrierName={inlineCarrier.name}
                              mcNumber={inlineCarrier.mcNumber}
                              neu
                            />
                          ) : (
                            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                              <MessageCircle className="mb-3 h-8 w-8 text-[#27aab8]" />
                              <p className="font-semibold">Choose a conversation</p>
                              <p className="mt-1 text-sm text-[#888]">Select a carrier to view the thread and reply.</p>
                            </div>
                          )}
                        </NeuCard>
                      </div>
                    )}
                  </NeuTabPanel>
                )}
              </NeuTabs>
            )}
          </div>
        </NeuPageShell>
      </div>

      <Dialog open={!!rejectingRegistration} onOpenChange={(open) => {
        if (!open && !registrationMutation.isPending) {
          setRejectingRegistration(null);
          setRejectionReason("");
        }
      }}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto rounded-2xl border-0 bg-[#e0e0e0] text-[#333] shadow-[-7px_-7px_16px_#fff,7px_7px_16px_#b8b8b8] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reject carrier registration</DialogTitle>
            <DialogDescription className="text-[#777]">Provide a reason for rejecting {rejectingRegistration?.companyName || "this registration"}. The reason will be sent to the carrier.</DialogDescription>
          </DialogHeader>
          <label htmlFor="registration-rejection-reason" className="text-sm font-medium">Rejection reason <span className="text-[#a44]">*</span></label>
          <Textarea
            id="registration-rejection-reason"
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
            placeholder="Explain why this registration cannot be approved"
            rows={4}
            className="min-w-0 resize-none rounded-xl border-0 bg-[#e0e0e0] text-[#333] shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#fff]"
            required
          />
          <div className="flex flex-wrap justify-end gap-2">
            <NeuButton onClick={() => setRejectingRegistration(null)} disabled={registrationMutation.isPending} className="min-h-9 px-3 py-1.5 text-xs">Cancel</NeuButton>
            <NeuButton
              variant="accent"
              onClick={() => {
                if (rejectingRegistration && rejectionReason.trim()) registrationMutation.mutate({
                  id: rejectingRegistration.id, action: "reject", reason: rejectionReason.trim(),
                });
              }}
              disabled={!rejectionReason.trim() || registrationMutation.isPending}
              className="min-h-9 px-3 py-1.5 text-xs"
            >Reject registration</NeuButton>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!registrationDetail} onOpenChange={(open) => !open && setRegistrationDetail(null)}>
        <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto rounded-2xl border-0 bg-[#e0e0e0] text-[#333] shadow-[-7px_-7px_16px_#fff,7px_7px_16px_#b8b8b8] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{registrationDetail?.companyName || "Carrier registration"}</DialogTitle>
            <DialogDescription className="text-[#777]">Submitted carrier details available for this registration.</DialogDescription>
          </DialogHeader>
          {registrationDetail && (
            <NeuCard className="grid min-w-0 grid-cols-1 gap-4 p-4 sm:grid-cols-2">
              {[
                ["Company", registrationDetail.companyName],
                ["MC number", registrationDetail.mcNumber],
                ["DOT number", registrationDetail.dotNumber],
                ["Contact email", registrationDetail.email],
                ["Phone", registrationDetail.phone || registrationDetail.phoneNumber],
                ["Registered", registrationDetail.createdAt ? new Date(registrationDetail.createdAt).toLocaleString() : null],
                ["Status", prettyStatus(registrationDetail.status)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <p className="text-xs text-[#888]">{label}</p>
                  <p className="break-words text-sm font-medium">{value || "—"}</p>
                </div>
              ))}
            </NeuCard>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto overflow-x-hidden rounded-2xl border-0 bg-[#e0e0e0] text-[#333] shadow-[-7px_-7px_16px_#fff,7px_7px_16px_#b8b8b8] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Submission #{detail?.id} — {detail?.companyName || `Portal User #${detail?.portalUserId}`}</DialogTitle>
            <DialogDescription className="text-[#777]">Review the submitted details and attached documents.</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="min-w-0 space-y-4">
              <NeuCard className="grid min-w-0 grid-cols-1 gap-4 p-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ["Carrier", detail.companyName || `Portal User #${detail.portalUserId}`],
                  ["Load #", detail.loadNumber],
                  ["Invoice #", detail.invoiceNumber],
                  ["Broker", detail.brokerName],
                  ["Branch", detail.branchName],
                  ["Code", detail.code],
                  ["Lumper", detail.lumper == null ? "—" : detail.lumper ? "Yes" : "No"],
                  ["Driver", detail.driverName],
                  ["Bank account", detail.bankAccount ? `${detail.bankAccount.nickname} · ${detail.bankAccount.bankName} ••••${detail.bankAccount.lastFour}` : "—"],
                  ["Amount", detail.amount ? `$${Number.parseFloat(detail.amount).toLocaleString()}` : "—"],
                  ["Payment", detail.paymentType],
                  ["Submitted", detail.submittedAt ? new Date(detail.submittedAt).toLocaleString() : "—"],
                  ["Load type", detail.loadType],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <p className="text-xs text-[#888]">{label}</p>
                    <p className="break-words font-medium">{value || "—"}</p>
                  </div>
                ))}
              </NeuCard>

              {(detail.instructionsSubject || detail.instructionsDetails) && (
                <NeuCard className="p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#888]">Carrier instructions</p>
                  {detail.instructionsSubject && <p className="mt-2 font-semibold">{detail.instructionsSubject}</p>}
                  {detail.instructionsDetails && <p className="mt-1 whitespace-pre-wrap text-sm text-[#555]">{detail.instructionsDetails}</p>}
                </NeuCard>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#888]">Submitted documents</p><p className="mt-1 text-sm text-[#777]">{detail.documents?.length || 0} attached</p></div>
                <NeuButton
                  variant="accent"
                  onClick={() => {
                    if (!detail.reviewedAt) reviewMutation.mutate(detail.id);
                    setCreateInvoiceOpen(true);
                  }}
                  disabled={!detail.carrierId || !detail.brokerId || !detail.branchId}
                  className="min-h-9 px-3 py-1.5 text-xs"
                >Create invoice</NeuButton>
              </div>
              {detail.documents?.length ? (
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  {detail.documents.map((doc) => (
                    <NeuCard key={doc.id} className="flex min-w-0 items-center gap-3 p-3">
                      <FileText className="h-5 w-5 shrink-0 text-[#27aab8]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold" title={doc.originalName}>{doc.originalName}</p>
                        <p className="text-xs capitalize text-[#888]">{DOC_LABEL[doc.documentType] || doc.documentType}</p>
                        <CompressionInfo originalSize={doc.originalSize} compressedSize={doc.compressedSize} />
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <NeuButton onClick={() => window.open(`/api/portal/submissions/${detail.id}/documents/${doc.id}/view`, "_blank", "noopener,noreferrer")} className="min-h-8 px-2 py-1 text-xs" aria-label={`View ${doc.originalName}`} title="View">
                          <Eye className="h-3.5 w-3.5" />
                        </NeuButton>
                        <NeuButton onClick={() => { window.location.href = `/api/portal/submissions/${detail.id}/documents/${doc.id}/download`; }} className="min-h-8 px-2 py-1 text-xs" aria-label={`Download ${doc.originalName}`} title="Download">
                          <Download className="h-3.5 w-3.5" />
                        </NeuButton>
                      </div>
                    </NeuCard>
                  ))}
                </div>
              ) : (
                <NeuCard className="p-4 text-center text-sm text-[#888]">No documents were attached to this submission.</NeuCard>
              )}

              <NeuCard className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#888]">Review record</p><div className="mt-2">{reviewIndicator(detail)}</div></div>
                  {detail.reviewedBy && <p className="text-xs text-[#888]">Reviewed by {detail.reviewedBy}</p>}
                </div>
                <div>
                  <label htmlFor="submission-status" className="mb-1 block text-xs text-[#777]">Submission status</label>
                  <NeuSelect id="submission-status" value={editStatus} onChange={(event) => setEditStatus(event.target.value)}>
                    {STATUS_OPTS.map((status) => <option key={status} value={status}>{prettyStatus(status)}</option>)}
                  </NeuSelect>
                </div>
                <div>
                  <label htmlFor="submission-notes" className="mb-1 block text-xs text-[#777]">Notes visible to carrier</label>
                  <Textarea
                    id="submission-notes"
                    value={editNotes}
                    onChange={(event) => setEditNotes(event.target.value)}
                    rows={3}
                    placeholder="Add notes for the carrier"
                    className="min-w-0 resize-none rounded-xl border-0 bg-[#e0e0e0] text-[#333] shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#fff]"
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <NeuButton variant="accent" onClick={() => updateMutation.mutate({ id: detail.id, status: editStatus, notes: editNotes })} disabled={updateMutation.isPending} className="min-h-9 px-3 py-1.5 text-xs">
                    {updateMutation.isPending ? "Saving…" : editStatus === "approved" ? "Approve submission" : editStatus === "rejected" ? "Reject submission" : "Save changes"}
                  </NeuButton>
                </div>
              </NeuCard>
              <EntityNotes key={`submission:${detail.id}`} entityType="submission" entityId={detail.id} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={!!chatCarrier} onOpenChange={(open) => !open && closeChat()}>
        <SheetContent side="right" className="flex w-full flex-col !border-0 !bg-[#e0e0e0] text-[#333] !shadow-[-7px_-7px_16px_#fff,7px_7px_16px_#b8b8b8] sm:max-w-xl [&&>button]:!rounded-full [&&>button]:!border-0 [&&>button]:!bg-[#e0e0e0] [&&>button]:!shadow-[-4px_-4px_8px_#fff,4px_4px_8px_#b8b8b8] [&&>button]:hover:!text-[#27aab8]">
          <SheetHeader className="shrink-0 pr-8">
            <SheetTitle>Carrier messages</SheetTitle>
            <SheetDescription className="text-[#777]">{chatCarrier?.name ? `Conversation with ${chatCarrier.name}.` : "Agent-to-carrier conversation."}</SheetDescription>
          </SheetHeader>
          {chatCarrier && <CarrierChatThread carrierId={chatCarrier.id} carrierName={chatCarrier.name} mcNumber={chatCarrier.mcNumber} />}
        </SheetContent>
      </Sheet>

      {detail && (
        <CreateInvoiceModal
          open={createInvoiceOpen}
          onOpenChange={setCreateInvoiceOpen}
          initialValues={{
            loadNumber: detail.loadNumber || "",
            loadType: detail.loadType || "other",
            clientId: detail.carrierId ? String(detail.carrierId) : "",
            brokerId: detail.brokerId ? String(detail.brokerId) : "",
            brokerName: detail.brokerName,
            branchId: detail.branchId ? String(detail.branchId) : "",
            code: detail.code || "",
            lumper: detail.lumper == null ? "" : detail.lumper ? "yes" : "no",
            amount: detail.amount || "",
            paymentType: detail.paymentType === "wire" ? "Wire" : "ACH",
            bankAccountId: detail.bankAccountId ? String(detail.bankAccountId) : "",
            instructionsDetails: detail.instructionsDetails || "",
          }}
        />
      )}
    </div>
  );
}
