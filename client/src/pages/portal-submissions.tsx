import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Eye, Download, FileText, Search, X, AlertTriangle, MessageCircle, Check, UserCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton-rows";
import { LoadTypeBadge } from "@/components/load-type";
import CreateInvoiceModal from "@/components/modals/create-invoice-modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import CarrierChatThread from "@/components/carriers/CarrierChatThread";

interface Doc { id: number; documentType: string; originalName: string; mimeType?: string; size?: number; }
interface Submission {
  id: number; portalUserId: number; companyName?: string;
  invoiceNumber?: string; loadNumber?: string; brokerName?: string;
  carrierId?: number; brokerId?: number; branchId?: number; branchName?: string;
  loadType?: string; code?: string; lumper?: boolean; driverName?: string;
  bankAccountId?: number; bankAccount?: { bankName: string; nickname: string; lastFour: string };
  instructionsSubject?: string; instructionsDetails?: string;
  amount?: string; paymentType?: string; status: string; notes?: string;
  reviewedAt?: string | null; reviewedBy?: string | null;
  submittedAt?: string; documents?: Doc[];
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
const STATUS_BADGE: Record<string, JSX.Element> = {
  submitted:    <Badge className="bg-blue-100 text-blue-700 border-0">Submitted</Badge>,
  under_review: <Badge className="bg-amber-100 text-amber-700 border-0">Under Review</Badge>,
  approved:     <Badge className="bg-emerald-100 text-emerald-700 border-0">Approved</Badge>,
  funded:       <Badge className="bg-purple-100 text-purple-700 border-0">Funded</Badge>,
  rejected:     <Badge className="bg-red-100 text-red-700 border-0">Rejected</Badge>,
};
const DOC_LABEL: Record<string, string> = {
  rate_confirmation: "Rate Conf.", bol: "BOL", lumper_receipt: "Lumper", other: "Other",
};
const formatChatTime = (value?: string | null) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
};

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
  const [filterStatus, setFilterStatus] = useState("all");
  const [detail, setDetail] = useState<Submission | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false);
  const [showUnreviewedOnly, setShowUnreviewedOnly] = useState(false);
  const [activeTab, setActiveTab] = useState("submissions");
  const [rejectingRegistration, setRejectingRegistration] = useState<PortalUser | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [chatCarrier, setChatCarrier] = useState<{ id: number; name?: string; mcNumber?: string | null } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const { data: submissions = [], isLoading } = useQuery<Submission[]>({
    queryKey: ["/api/carrier-portal/submissions"],
    refetchInterval: 30000,
    enabled: canUsePortal,
  });
  const { data: carrierChats = [] } = useQuery<CarrierChatSummary[]>({
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
  const unreviewedCount = unreviewedCountData?.count ?? submissions.filter(item => !item.reviewedAt).length;
  const { data: portalUsers = [], isLoading: portalUsersLoading } = useQuery<PortalUser[]>({
    queryKey: ["/api/carrier-portal/users"],
    refetchInterval: 30000,
    enabled: canUsePortal,
  });
  const { data: pendingCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/carrier-portal/pending-count"],
    refetchInterval: 30000,
    enabled: canUsePortal,
  });
  const pendingRegistrations = portalUsers.filter((user) => user.status === "pending");
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
  const carrierUnreadById = useMemo(() => new Map(chatSummaries.map((chat) => [String(chat.carrierId), Number(chat.unreadCount || 0)])), [chatSummaries]);

  useEffect(() => {
    if (!canUsePortal && canUseChat) setActiveTab("messages");
  }, [canUsePortal, canUseChat]);

  useEffect(() => {
    const requested = new URLSearchParams(location.includes("?") ? location.slice(location.indexOf("?") + 1) : "").get("carrierId");
    if (!requested || !canUseChat) return;
    const id = Number(requested);
    if (!Number.isInteger(id) || id <= 0) return;
    const summary = chatSummaries.find((chat) => String(chat.carrierId) === requested);
    setChatCarrier({ id, name: summary?.carrierName || undefined, mcNumber: summary?.mcNumber });
  }, [location, canUseChat, chatSummaries]);

  const openChat = (carrierId: string | number, summary?: CarrierChatSummary) => {
    const id = Number(carrierId);
    if (!Number.isInteger(id) || !canUseChat) return;
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
    onSuccess: updated => {
      queryClient.setQueryData<Submission[]>(["/api/carrier-portal/submissions"], current =>
        current?.map(item => item.id === updated.id ? { ...item, reviewedAt: updated.reviewedAt, reviewedBy: updated.reviewedBy } : item),
      );
      queryClient.invalidateQueries({ queryKey: ["/api/portal-submissions/unreviewed-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-portal/submissions"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: number; status: string; notes: string }) => {
      const res = await fetch(`/api/carrier-portal/submissions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status, notes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Update failed");
      return json;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-portal/submissions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portal-submissions/unreviewed-count"] });
      setDetail((prev) => prev ? { ...prev, ...updated } : prev);
      toast({ title: "Submission updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = submissions.filter((s) => {
    const matchStatus = filterStatus === "all" || s.status === filterStatus;
    const matchReview = !showUnreviewedOnly || !s.reviewedAt;
    const q = search.toLowerCase();
    const matchSearch = !q || [s.companyName, s.invoiceNumber, s.loadNumber, s.brokerName]
      .some((v) => v?.toLowerCase().includes(q));
    return matchStatus && matchReview && matchSearch;
  }).sort((a, b) => new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime());

  function openDetail(s: Submission) {
    setDetail(s);
    setEditNotes(s.notes || "");
    setEditStatus(s.status);
    if (!s.reviewedAt) reviewMutation.mutate(s.id);
  }

  function reviewIndicator(submission: Submission) {
    if (submission.reviewedAt) return <Badge className="border-0 bg-slate-200 text-slate-700">REVIEWED</Badge>;
    const age = Date.now() - new Date(submission.submittedAt || 0).getTime();
    if (age <= 24 * 60 * 60 * 1000) return <Badge className="border-0 bg-blue-100 text-blue-700">NEW</Badge>;
    return <Badge className="border-0 bg-amber-100 text-amber-800">PENDING</Badge>;
  }

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Portal Submissions" subtitle="Invoice submissions from the carrier portal" group="Workspace" />
        <main className="custom-scrollbar flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            {unreviewedCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowUnreviewedOnly(true);
                  window.setTimeout(() => tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left text-amber-900 shadow-sm transition-colors hover:bg-amber-100"
              >
                <AlertTriangle className="h-5 w-5 shrink-0 text-orange-600" />
                <span className="font-semibold">⚠ {unreviewedCount} new carrier submission{unreviewedCount === 1 ? "" : "s"} require review</span>
              </button>
            )}

            {pendingCount > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab("registrations")}
                className="flex w-full items-center gap-3 rounded-xl border border-blue-300 bg-blue-50 px-4 py-3 text-left text-blue-900 shadow-sm transition-colors hover:bg-blue-100"
              >
                <UserCheck className="h-5 w-5 shrink-0 text-blue-600" />
                <span className="font-semibold">⚠ {pendingCount} carrier{pendingCount === 1 ? "" : "s"} pending approval</span>
              </button>
            )}

            {!canUseHub ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
                Portal Submissions or Chat permission is required to access this page.
              </div>
            ) : <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                {canUsePortal && <TabsTrigger value="submissions">Submissions</TabsTrigger>}
                {canUsePortal && <TabsTrigger value="registrations">
                    Pending Registrations
                    {pendingCount > 0 && <Badge className="ml-2 h-5 min-w-5 justify-center bg-red-600 px-1 text-[10px] text-white">{pendingCount}</Badge>}
                  </TabsTrigger>}
                {canUseChat && <TabsTrigger value="messages">Messages</TabsTrigger>}
              </TabsList>

              {canUsePortal && <TabsContent value="submissions">
                {/* Filters */}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      placeholder="Search by company, invoice, load, or broker…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                    />
                    {search && (
                      <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                        <X className="h-4 w-4 text-slate-400 hover:text-slate-600" />
                      </button>
                    )}
                  </div>
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-full sm:w-44">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      {STATUS_OPTS.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {showUnreviewedOnly && <Button variant="outline" onClick={() => setShowUnreviewedOnly(false)}>Showing unreviewed · Clear</Button>}
                </div>

                {/* Table */}
                <Card ref={tableRef} className="mt-6 rounded-[24px] border border-[hsl(var(--border))]">
                  <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Carrier Submissions
                    </CardTitle>
                    <CardDescription>{filtered.length} submission{filtered.length !== 1 ? "s" : ""}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    {isLoading ? (
                      <SkeletonRows rows={6} cols={6} />
                    ) : filtered.length === 0 ? (
                      <EmptyState icon={FileText} title="No submissions" description="Submissions from carriers will appear here." />
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Carrier</TableHead>
                              <TableHead>Load / Invoice</TableHead>
                              <TableHead>Broker</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Review</TableHead>
                              <TableHead>Submitted</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filtered.map((s) => (
                              <TableRow key={s.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => openDetail(s)}>
                                 <TableCell className="font-medium">{s.companyName || `Portal User #${s.portalUserId}`}</TableCell>
                                <TableCell>
                                  <p className="text-sm">{s.loadNumber || "—"}</p>
                                  {s.invoiceNumber && <p className="text-xs text-slate-400">{s.invoiceNumber}</p>}
                                </TableCell>
                                <TableCell className="text-sm">{s.brokerName || "—"}</TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {s.amount ? `$${parseFloat(s.amount).toLocaleString()}` : "—"}
                                </TableCell>
                                <TableCell>{STATUS_BADGE[s.status]}</TableCell>
                                <TableCell>{reviewIndicator(s)}</TableCell>
                                <TableCell className="text-xs text-slate-500">
                                  {s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : "—"}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                     aria-label={!s.carrierId ? "Message carrier unavailable: no linked carrier" : canUseChat ? "Message carrier" : "Message carrier unavailable: Chat permission required"}
                                     title={!s.carrierId ? "No linked carrier for this submission" : canUseChat ? "Message carrier" : "Chat permission required"}
                                     disabled={!s.carrierId || !canUseChat}
                                     onClick={(e) => {
                                       e.stopPropagation();
                                       if (s.carrierId) openChat(s.carrierId, chatSummaries.find((item) => String(item.carrierId) === String(s.carrierId)) || { carrierId: s.carrierId, carrierName: s.companyName });
                                     }}
                                  >
                                    <MessageCircle className="h-4 w-4" />
                                     {!!s.carrierId && carrierUnreadById.get(String(s.carrierId)) ? (
                                       <Badge className="h-5 min-w-5 justify-center rounded-full bg-[#b54444] px-1 text-[10px] text-white">
                                         {(carrierUnreadById.get(String(s.carrierId)) || 0) > 9 ? "9+" : carrierUnreadById.get(String(s.carrierId))}
                                       </Badge>
                                     ) : null}
                                     {!s.carrierId && <span className="sr-only">No linked carrier for this submission</span>}
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openDetail(s); }}>
                                    Review
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>}

              {canUsePortal && <TabsContent value="registrations">
                <Card className="rounded-[24px] border border-[hsl(var(--border))]">
                  <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <CardTitle className="flex items-center gap-2">
                      <UserCheck className="h-5 w-5" />
                      Pending Registrations
                    </CardTitle>
                    <CardDescription>{pendingRegistrations.length} registration{pendingRegistrations.length !== 1 ? "s" : ""} awaiting approval</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    {portalUsersLoading ? (
                      <SkeletonRows rows={4} cols={7} />
                    ) : pendingRegistrations.length === 0 ? (
                      <EmptyState icon={UserCheck} title="No pending registrations" description="New carrier portal registrations will appear here." />
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Company</TableHead>
                              <TableHead>MC</TableHead>
                              <TableHead>DOT</TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead>Phone</TableHead>
                              <TableHead>Registered</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pendingRegistrations.map((registration) => (
                              <TableRow key={registration.id}>
                                <TableCell className="font-medium">{registration.companyName || "—"}</TableCell>
                                <TableCell>{registration.mcNumber || "—"}</TableCell>
                                <TableCell>{registration.dotNumber || "—"}</TableCell>
                                <TableCell className="whitespace-nowrap">{registration.email || "—"}</TableCell>
                                <TableCell>{registration.phone || registration.phoneNumber || "—"}</TableCell>
                                <TableCell className="whitespace-nowrap text-xs text-slate-500">
                                  {registration.createdAt ? new Date(registration.createdAt).toLocaleDateString() : "—"}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    <Button
                                      size="sm"
                                      onClick={() => registrationMutation.mutate({ id: registration.id, action: "approve" })}
                                      disabled={registrationMutation.isPending}
                                    >
                                      {registrationMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => { setRejectingRegistration(registration); setRejectionReason(""); }}
                                      disabled={registrationMutation.isPending}
                                    >
                                      <X className="mr-1 h-4 w-4" />
                                      Reject
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>}

              {canUseChat && <TabsContent value="messages">
                <Card className="rounded-[24px] border border-[hsl(var(--border))]">
                  <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <CardTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5" />Carrier Messages</CardTitle>
                    <CardDescription>{chatSummaries.length} conversation{chatSummaries.length === 1 ? "" : "s"}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    {chatSummaries.length === 0 ? (
                      <EmptyState icon={MessageCircle} title="No carrier conversations" description="Messages from carriers will appear here." />
                    ) : (
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {chatSummaries.map((chat) => {
                          const last = typeof chat.lastMessage === "string" ? chat.lastMessage : chat.lastMessage?.message || "";
                          const lastAt = chat.lastMessageAt || (typeof chat.lastMessage === "object" ? chat.lastMessage?.createdAt : null);
                          return (
                            <button key={String(chat.carrierId)} type="button" onClick={() => openChat(chat.carrierId, chat)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dff5f6] text-sm font-semibold text-[#087d8d]">{(chat.carrierName || "C").slice(0, 1).toUpperCase()}</div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2"><p className="truncate font-medium">{chat.carrierName || "Carrier"}</p><span className="shrink-0 text-[11px] text-slate-400">{formatChatTime(lastAt)}</span></div>
                                <p className="text-xs text-slate-500">{chat.mcNumber ? `MC ${chat.mcNumber}` : "Carrier"}</p>
                                <p className="truncate text-xs text-slate-500">{last || "No messages yet"}</p>
                              </div>
                              {!!chat.unreadCount && <Badge className="h-5 min-w-5 justify-center rounded-full bg-[#b54444] px-1 text-[10px] text-white">{chat.unreadCount > 9 ? "9+" : chat.unreadCount}</Badge>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>}
            </Tabs>}
          </div>
        </main>
      </div>

      {/* Registration rejection dialog */}
      <Dialog open={!!rejectingRegistration} onOpenChange={(open) => {
        if (!open && !registrationMutation.isPending) {
          setRejectingRegistration(null);
          setRejectionReason("");
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reject carrier registration</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting {rejectingRegistration?.companyName || "this registration"}. The reason will be sent to the carrier.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="registration-rejection-reason" className="text-sm font-medium">
              Rejection reason <span className="text-red-600">*</span>
            </label>
            <Textarea
              id="registration-rejection-reason"
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Explain why this registration cannot be approved…"
              rows={4}
              className="resize-none"
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRejectingRegistration(null)} disabled={registrationMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (rejectingRegistration && rejectionReason.trim()) {
                  registrationMutation.mutate({
                    id: rejectingRegistration.id,
                    action: "reject",
                    reason: rejectionReason.trim(),
                  });
                }
              }}
              disabled={!rejectionReason.trim() || registrationMutation.isPending}
            >
              {registrationMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject registration
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Submission #{detail?.id} — {detail?.companyName || `Portal User #${detail?.portalUserId}`}
            </DialogTitle>
            <DialogDescription>Review documents and update submission status.</DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="space-y-5">
              {/* Load Info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Load #", detail.loadNumber],
                  ["Invoice #", detail.invoiceNumber],
                  ["Broker", detail.brokerName],
                  ["Branch", detail.branchName],
                  ["Code", detail.code],
                  ["Lumper", detail.lumper == null ? "—" : detail.lumper ? "Yes" : "No"],
                  ["Driver", detail.driverName],
                  ["Bank Account", detail.bankAccount ? `${detail.bankAccount.nickname} · ${detail.bankAccount.bankName} ••••${detail.bankAccount.lastFour}` : "—"],
                  ["Amount", detail.amount ? `$${parseFloat(detail.amount).toLocaleString()}` : "—"],
                  ["Payment", detail.paymentType],
                  ["Submitted", detail.submittedAt ? new Date(detail.submittedAt).toLocaleString() : "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-xs text-slate-400">{k}</p>
                    <p className="font-medium text-slate-800 dark:text-slate-200">{v || "—"}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
                <div>
                  <p className="text-xs text-slate-500">Load Type</p>
                  <LoadTypeBadge value={detail.loadType} />
                </div>
                <Button onClick={() => {
                  if (!detail.reviewedAt) reviewMutation.mutate(detail.id);
                  setCreateInvoiceOpen(true);
                }} disabled={!detail.carrierId || !detail.brokerId || !detail.branchId}>
                  Create Invoice from Submission
                </Button>
              </div>

              {(detail.instructionsSubject || detail.instructionsDetails) && (
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-500">Instructions</p>
                  {detail.instructionsSubject && <p className="mt-1 font-medium">{detail.instructionsSubject}</p>}
                  {detail.instructionsDetails && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{detail.instructionsDetails}</p>}
                </div>
              )}

              {/* Documents */}
              {detail.documents && detail.documents.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-2">Documents ({detail.documents.length})</p>
                  <div className="space-y-1.5">
                    {detail.documents.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2">
                        <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />
                        <span className="text-sm flex-1 truncate">{doc.originalName}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5">{DOC_LABEL[doc.documentType] || doc.documentType}</Badge>
                        <a href={`/api/portal/submissions/${detail.id}/documents/${doc.id}/view`} target="_blank" rel="noreferrer"
                          className="p-1 text-slate-400 hover:text-blue-600" title="View">
                          <Eye className="h-4 w-4" />
                        </a>
                        <a href={`/api/portal/submissions/${detail.id}/documents/${doc.id}/download`}
                          className="p-1 text-slate-400 hover:text-blue-600" title="Download">
                          <Download className="h-4 w-4" />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Status + Notes Update */}
              <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Update Submission</p>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Status</label>
                  <Select value={editStatus} onValueChange={setEditStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTS.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Notes (visible to carrier)</label>
                  <Textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={3}
                    placeholder="Add notes for the carrier…"
                    className="resize-none"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
                  <Button
                    onClick={() => updateMutation.mutate({ id: detail.id, status: editStatus, notes: editNotes })}
                    disabled={updateMutation.isPending}
                  >
                    {updateMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : "Save Changes"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Sheet open={!!chatCarrier} onOpenChange={(open) => !open && closeChat()}>
        <SheetContent side="right" className="flex w-full flex-col sm:max-w-xl">
          <SheetHeader className="shrink-0 pr-8">
            <SheetTitle>Carrier messages</SheetTitle>
            <SheetDescription>
              {chatCarrier?.name ? `Conversation with ${chatCarrier.name}.` : "Agent-to-carrier conversation."}
            </SheetDescription>
          </SheetHeader>
          {chatCarrier && (
            <CarrierChatThread
              carrierId={chatCarrier.id}
              carrierName={chatCarrier.name}
              mcNumber={chatCarrier.mcNumber}
            />
          )}
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
            driverName: detail.driverName || "",
            amount: detail.amount || "",
            paymentType: detail.paymentType === "wire" ? "Wire" : "ACH",
            bankAccountId: detail.bankAccountId ? String(detail.bankAccountId) : "",
            instructionsSubject: detail.instructionsSubject || "",
            instructionsDetails: detail.instructionsDetails || "",
          }}
        />
      )}
    </div>
  );
}
