import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Users, Shield, UserPlus, Pencil, Trash2, Ban, CheckCircle,
  Loader2, Mail, Settings2, FileCheck, ClipboardList, Plus,
  AlertCircle, Bell, TrendingUp, Clock, Activity, Download,
  ChevronRight, ChevronLeft, Globe, ExternalLink, KeyRound, RotateCcw,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription,
} from "@/components/ui/form";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton-rows";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────
interface UserRecord {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role: string;
  status?: string;
  createdAt?: string;
  jobTitle?: string;
  profileImageUrl?: string;
}

interface DocRequirement {
  id?: number;
  stage: string;
  documentName: string;
  required: boolean;
  description?: string;
}

interface AuditEntry {
  id: number;
  userId: string;
  userName?: string;
  userLastName?: string;
  type: string;
  description: string;
  entityType?: string;
  entityId?: number;
  createdAt?: string;
}

interface PayoutSettings {
  advanceRate: string;
  feeRate: string;
}

// ─── Schemas ─────────────────────────────────────────────────────────────────
const addAgentSchema = z.object({
  firstName: z.string().min(1, "First name required"),
  lastName: z.string().min(1, "Last name required"),
  email: z.string().email("Valid email required"),
  role: z.enum(["employee", "manager", "admin"]),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
const editUserSchema = z.object({
  firstName: z.string().min(1, "First name required"),
  lastName: z.string().min(1, "Last name required"),
  email: z.string().email("Valid email required"),
  role: z.enum(["employee", "manager", "admin"]),
});
const notifySchema = z.object({
  userId: z.string().min(1, "Select a recipient"),
  subject: z.string().min(1, "Subject required"),
  message: z.string().min(1, "Message required"),
});
const ratesSchema = z.object({
  advanceRate: z.coerce.number().min(1).max(99),
  feeRate: z.coerce.number().min(0).max(50),
}).refine((d) => d.advanceRate + d.feeRate <= 100, { message: "Advance + fee cannot exceed 100%", path: ["feeRate"] });

type AddAgentForm = z.infer<typeof addAgentSchema>;
type EditUserForm = z.infer<typeof editUserSchema>;
type NotifyForm = z.infer<typeof notifySchema>;
type RatesForm = z.infer<typeof ratesSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ROLE_BADGE: Record<string, JSX.Element> = {
  admin: <Badge className="bg-purple-600 text-white">Admin</Badge>,
  manager: <Badge className="bg-blue-600 text-white">Manager</Badge>,
  employee: <Badge variant="outline">Employee</Badge>,
};
const STATUS_BADGE: Record<string, JSX.Element> = {
  active: <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Active</Badge>,
  suspended: <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Suspended</Badge>,
  inactive: <Badge variant="outline" className="text-slate-500">Inactive</Badge>,
};

const STAGE_LABELS: Record<string, string> = {
  submission: "Submission",
  approval: "Approval",
  factoring: "Factoring",
  payout: "Payout",
};
const STAGE_COLORS: Record<string, string> = {
  submission: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300",
  approval: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
  factoring: "bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300",
  payout: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300",
};

const DEFAULT_DOC_REQUIREMENTS: DocRequirement[] = [
  { stage: "submission", documentName: "Rate Confirmation", required: true, description: "Signed rate confirmation from broker" },
  { stage: "submission", documentName: "Bill of Lading", required: true, description: "Proof of freight delivery" },
  { stage: "submission", documentName: "Proof of Delivery", required: true, description: "Signed POD from consignee" },
  { stage: "approval", documentName: "Driver ID", required: true, description: "Valid government-issued photo ID" },
  { stage: "approval", documentName: "Carrier Authority", required: true, description: "FMCSA carrier authority documentation" },
  { stage: "factoring", documentName: "W-9 Form", required: true, description: "Tax information form" },
  { stage: "factoring", documentName: "Carrier Setup Form", required: true, description: "TPF carrier onboarding form" },
  { stage: "payout", documentName: "Bank Account Details", required: true, description: "ACH bank information for direct deposit" },
];

const ACTIVITY_ICONS: Record<string, { icon: typeof Activity; color: string }> = {
  document_uploaded: { icon: FileCheck, color: "text-blue-500" },
  invoice_created: { icon: ClipboardList, color: "text-violet-500" },
  invoice_approved: { icon: CheckCircle, color: "text-emerald-500" },
  client_created: { icon: UserPlus, color: "text-indigo-500" },
  default: { icon: Activity, color: "text-slate-400" },
};

const TABS = [
  { id: "users",        label: "Users",                icon: Users        },
  { id: "timetracking", label: "Time Tracking",        icon: Clock        },
  { id: "portal",       label: "Carrier Portal",       icon: Globe        },
  { id: "factoring",    label: "Factoring Settings",   icon: Settings2    },
  { id: "documents",    label: "Doc Requirements",     icon: FileCheck    },
  { id: "audit",        label: "Audit Log",            icon: ClipboardList},
] as const;
type Tab = typeof TABS[number]["id"];

// ─── Permission Sections ──────────────────────────────────────────────────────
const PERMISSION_SECTIONS = [
  {
    label: "Workspace",
    items: [
      { key: "dashboard",          label: "Dashboard"          },
      { key: "carriers",           label: "Carriers"           },
      { key: "invoices",           label: "Invoices"           },
      { key: "documents",          label: "Documents"          },
      { key: "tasks",              label: "Tasks"              },
      { key: "bulk_invoices",      label: "Bulk Invoices"      },
      { key: "portal_submissions", label: "Portal Submissions" },
    ],
  },
  {
    label: "Funding",
    items: [
      { key: "factoring",      label: "Factoring"      },
      { key: "payments",       label: "Payments"       },
      { key: "lockbox",        label: "Lockbox"        },
      { key: "fuel_advance",   label: "Fuel Advance"   },
      { key: "bank_transfers", label: "Bank Transfers" },
    ],
  },
  {
    label: "Operations",
    items: [
      { key: "dispatchers",     label: "Dispatchers"     },
      { key: "trucks",          label: "Trucks"          },
      { key: "release_letters", label: "Release Letters" },
    ],
  },
  {
    label: "Risk",
    items: [
      { key: "brokers",    label: "Brokers"     },
      { key: "cb_reviews", label: "C/B Reviews" },
      { key: "mc_check",   label: "MC Check"    },
      { key: "held",       label: "Held"        },
      { key: "logs",       label: "Audit Logs"  },
    ],
  },
  {
    label: "Recovery",
    items: [
      { key: "followups", label: "Followups" },
      { key: "reports",   label: "Reports"   },
    ],
  },
  {
    label: "Admin",
    items: [
      { key: "payroll",          label: "Payroll"          },
      { key: "vault",            label: "Vault"            },
      { key: "help",             label: "Help"             },
      { key: "settings",         label: "Settings"         },
      { key: "rules",            label: "Doc Rules"        },
      { key: "workflow_builder", label: "Workflow Builder" },
      { key: "admin",            label: "Admin Panel"      },
    ],
  },
];

const ROLE_DEFAULTS: Record<string, string[]> = {
  admin: [
    "dashboard","carriers","invoices","documents","tasks","bulk_invoices","portal_submissions",
    "factoring","payments","lockbox","fuel_advance","bank_transfers",
    "dispatchers","trucks","release_letters",
    "brokers","cb_reviews","mc_check","held","logs",
    "followups","reports",
    "payroll","vault","help","settings","rules","workflow_builder","admin",
  ],
  manager: [
    "dashboard","carriers","invoices","documents","tasks","bulk_invoices","portal_submissions",
    "factoring","payments","lockbox","fuel_advance","bank_transfers",
    "dispatchers","trucks","release_letters",
    "brokers","cb_reviews","mc_check","held","logs",
    "followups","reports",
    "payroll","vault","help","settings","rules","workflow_builder",
  ],
  employee: ["dashboard","carriers","invoices","documents","tasks","fuel_advance","vault","help","settings"],
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Admin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: session } = useQuery<{ user: UserRecord }>({ queryKey: ["/api/auth/verify"] });
  const currentUser = session?.user;

  const [activeTab, setActiveTab] = useState<Tab>("users");
  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [docItems, setDocItems] = useState<DocRequirement[]>([]);
  const [docsDirty, setDocsDirty] = useState(false);
  const [ttDrillAgent, setTtDrillAgent] = useState<string | null>(null);
  const [permTarget, setPermTarget] = useState<UserRecord | null>(null);
  const [permToggles, setPermToggles] = useState<Record<string, boolean>>({});

  // Guard: only admin
  if (currentUser && currentUser.role !== "admin") {
    return (
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopNav title="Team Settings" group="Admin" />
          <main className="flex flex-1 items-center justify-center p-6">
            <Card className="max-w-md w-full text-center">
              <CardHeader>
                <Shield className="h-12 w-12 mx-auto text-red-500 mb-2" />
                <CardTitle className="text-red-600">Access Denied</CardTitle>
                <CardDescription>Admin role required to access this panel.</CardDescription>
              </CardHeader>
            </Card>
          </main>
        </div>
      </div>
    );
  }

  // ─── Queries ──────────────────────────────────────────────────────────────
  const { data: users = [], isLoading: usersLoading } = useQuery<UserRecord[]>({
    queryKey: ["/api/admin/users"],
    enabled: currentUser?.role === "admin",
  });

  const { data: settings } = useQuery<PayoutSettings>({
    queryKey: ["/api/payout-settings"],
  });

  const { data: docReqs = [], isLoading: docsLoading } = useQuery<DocRequirement[]>({
    queryKey: ["/api/admin/doc-requirements"],
  } as any);

  const { data: auditLog = [], isLoading: auditLoading } = useQuery<AuditEntry[]>({
    queryKey: ["/api/admin/audit-log"],
    enabled: activeTab === "audit",
  });

  // ── Time Tracking ────────────────────────────────────────────────────────
  interface TtSummaryRow {
    userId: string; firstName: string | null; lastName: string | null; role: string;
    clockedIn: boolean; clockInTime: string | null; weekHours: number;
    periodHours: number; todayHours: number; lastActivity: string | null;
  }
  interface TtDayEntry { id: number; clockIn: string; clockOut: string | null; hours: number | null; status: string; notes: string | null; }
  interface TtDay { date: string; entries: TtDayEntry[]; totalHours: number; overtime: boolean; }
  interface TtAgentDetail {
    userId: string; firstName: string | null; lastName: string | null; role: string;
    days: TtDay[]; weekTotal: number; weekOvertime: boolean;
  }
  const { data: ttSummary = [], isLoading: ttLoading } = useQuery<TtSummaryRow[]>({
    queryKey: ["/api/time-tracking/summary"],
    enabled: activeTab === "timetracking",
    refetchInterval: activeTab === "timetracking" ? 30000 : false,
  });
  const { data: ttLive = [] } = useQuery<{ userId: string; firstName: string | null; lastName: string | null; clockInTime: string; durationHours: number }[]>({
    queryKey: ["/api/time-tracking/live"],
    enabled: activeTab === "timetracking",
    refetchInterval: activeTab === "timetracking" ? 30000 : false,
  });
  const { data: ttAgentDetail, isLoading: ttAgentLoading } = useQuery<TtAgentDetail>({
    queryKey: ["/api/time-tracking/agent", ttDrillAgent],
    enabled: !!ttDrillAgent,
  });

  // ── Carrier Portal ───────────────────────────────────────────────────────
  interface PortalUserRow {
    id: number; email: string; companyName: string; mcNumber?: string; dotNumber?: string;
    status: "pending" | "active" | "suspended"; createdAt?: string; lastLoginAt?: string; carrierId?: number;
  }
  const { data: portalUsers = [], isLoading: portalLoading } = useQuery<PortalUserRow[]>({
    queryKey: ["/api/carrier-portal/users"],
    enabled: activeTab === "portal",
  });
  const { data: portalSubmissionCount } = useQuery<{ count: number }>({
    queryKey: ["/api/carrier-portal/submissions"],
    enabled: activeTab === "portal",
    select: (data: any[]) => ({ count: data.length }),
  });
  const approvePortalMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetch(`/api/carrier-portal/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Update failed");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-portal/users"] });
      toast({ title: "Portal user updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const PORTAL_STATUS_BADGE: Record<string, JSX.Element> = {
    pending:   <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Pending</Badge>,
    active:    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Active</Badge>,
    suspended: <Badge className="bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300">Suspended</Badge>,
  };

  function exportTtCsv(rows: TtSummaryRow[], filename = "time-tracking.csv") {
    const header = ["Agent", "Role", "Status", "Today (hrs)", "This Week (hrs)", "Pay Period (hrs)", "Last Activity"];
    const body = rows.map((r) => [
      `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim(),
      r.role,
      r.clockedIn ? "Clocked In" : "Clocked Out",
      r.todayHours.toFixed(2),
      r.weekHours.toFixed(2),
      r.periodHours.toFixed(2),
      r.lastActivity ? new Date(r.lastActivity).toLocaleString() : "—",
    ]);
    const csv = [header, ...body].map((row) => row.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = filename;
    a.click();
  }
  function exportAgentCsv(detail: TtAgentDetail) {
    const header = ["Date", "Clock In", "Clock Out", "Hours", "Overtime"];
    const rows: string[][] = [];
    detail.days.forEach((d) => {
      d.entries.forEach((e) => {
        rows.push([
          d.date,
          new Date(e.clockIn).toLocaleTimeString(),
          e.clockOut ? new Date(e.clockOut).toLocaleTimeString() : "—",
          e.hours != null ? e.hours.toFixed(2) : "—",
          d.overtime ? "Yes" : "",
        ]);
      });
    });
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `time-tracking-${detail.firstName}-${detail.lastName}.csv`;
    a.click();
  }

  // Init doc items from fetched data
  const effectiveDocItems = docsDirty ? docItems : (docReqs.length ? docReqs : DEFAULT_DOC_REQUIREMENTS);

  // ─── Mutations ────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async (data: AddAgentForm) => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create agent");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setAddOpen(false);
      toast({ title: "Agent created", description: "Welcome email sent with login credentials." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<UserRecord> }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update user");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setEditUser(null);
      toast({ title: "User updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to delete user");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setDeleteTarget(null);
      toast({ title: "User removed" });
    },
    onError: (e: Error) => {
      setDeleteTarget(null);
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  // ─── Permissions ──────────────────────────────────────────────────────────
  const { data: permData, isLoading: permLoading } = useQuery<{ permissions: string[] }>({
    queryKey: ["/api/admin/users", permTarget?.id, "permissions"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${permTarget!.id}/permissions`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch permissions");
      return res.json();
    },
    enabled: !!permTarget,
  });

  const permMutation = useMutation({
    mutationFn: async ({ id, permissions }: { id: string; permissions: string[] }) => {
      const res = await fetch(`/api/admin/users/${id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ permissions }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to save permissions");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", permTarget?.id, "permissions"] });
      toast({ title: "Permissions saved", description: `Updated access for ${permTarget?.firstName} ${permTarget?.lastName}` });
      setPermTarget(null);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openPermissions = (u: UserRecord) => {
    setPermTarget(u);
  };

  // Sync permToggles when permData loads
  const allKeys = PERMISSION_SECTIONS.flatMap(s => s.items.map(i => i.key));
  const resolvedToggles: Record<string, boolean> = permData
    ? Object.fromEntries(allKeys.map(k => [k, permData.permissions.includes(k)]))
    : Object.fromEntries(allKeys.map(k => [k, false]));

  const activeToggles = permLoading ? resolvedToggles : (Object.keys(permToggles).length > 0 ? permToggles : resolvedToggles);

  const applyRoleDefaults = (role: string) => {
    const defaults = ROLE_DEFAULTS[role] ?? ROLE_DEFAULTS.employee;
    setPermToggles(Object.fromEntries(allKeys.map(k => [k, defaults.includes(k)])));
  };

  const grantedCount = Object.values(activeToggles).filter(Boolean).length;

  const ratesMutation = useMutation({
    mutationFn: async (data: RatesForm) => {
      const res = await fetch("/api/payout-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to save");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payout-settings"] });
      toast({ title: "Rates saved", description: "New rates apply to future payouts." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const notifyMutation = useMutation({
    mutationFn: async (data: NotifyForm) => {
      const res = await fetch("/api/admin/notify-carrier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId: data.userId, subject: data.subject, message: data.message }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to send");
      return json;
    },
    onSuccess: () => {
      setNotifyOpen(false);
      notifyForm.reset();
      toast({ title: "Notification sent" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const saveDocsMutation = useMutation({
    mutationFn: async (items: DocRequirement[]) => {
      const res = await fetch("/api/admin/doc-requirements", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(items),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to save");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/doc-requirements"] });
      setDocsDirty(false);
      toast({ title: "Document requirements saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ─── Forms ────────────────────────────────────────────────────────────────
  const addForm = useForm<AddAgentForm>({
    resolver: zodResolver(addAgentSchema),
    defaultValues: { firstName: "", lastName: "", email: "", role: "employee", password: "" },
  });
  const editForm = useForm<EditUserForm>({
    resolver: zodResolver(editUserSchema),
    defaultValues: { firstName: "", lastName: "", email: "", role: "employee" },
  });
  const notifyForm = useForm<NotifyForm>({
    resolver: zodResolver(notifySchema),
    defaultValues: { userId: "", subject: "", message: "" },
  });
  const ratesForm = useForm<RatesForm>({
    resolver: zodResolver(ratesSchema),
    defaultValues: { advanceRate: 90, feeRate: 3 },
    values: settings ? { advanceRate: Number(settings.advanceRate), feeRate: Number(settings.feeRate) } : undefined,
  });

  const openEdit = (u: UserRecord) => {
    setEditUser(u);
    editForm.reset({ firstName: u.firstName || "", lastName: u.lastName || "", email: u.email || "", role: u.role as any });
  };
  const handleSuspend = (u: UserRecord) => {
    if (u.id === currentUser?.id) {
      toast({ title: "Not allowed", description: "You cannot suspend your own account.", variant: "destructive" });
      return;
    }
    updateMutation.mutate({ id: u.id, updates: { status: u.status === "suspended" ? "active" : "suspended" } });
  };
  const isSelf = (id: string) => id === currentUser?.id;

  // Doc requirement helpers
  const updateDoc = (idx: number, patch: Partial<DocRequirement>) => {
    setDocItems((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
    setDocsDirty(true);
  };
  const addDocRow = (stage: string) => {
    setDocItems((prev) => [...prev, { stage, documentName: "", required: true, description: "" }]);
    setDocsDirty(true);
  };
  const removeDocRow = (idx: number) => {
    setDocItems((prev) => prev.filter((_, i) => i !== idx));
    setDocsDirty(true);
  };

  const stageGroups = ["submission", "approval", "factoring", "payout"];
  const watchAdvance = ratesForm.watch("advanceRate") ?? 90;
  const watchFee = ratesForm.watch("feeRate") ?? 3;

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Team Settings" subtitle="User roles, permissions, and system configuration" group="Admin" />
        <main className="custom-scrollbar flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">

            {/* ── Stats row ── */}
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {[
                { label: "Total Users", value: users.length, icon: Users, color: "text-slate-700 dark:text-slate-300", bg: "bg-slate-50 dark:bg-slate-800/50" },
                { label: "Admins", value: users.filter((u) => u.role === "admin").length, icon: Shield, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/30" },
                { label: "Managers", value: users.filter((u) => u.role === "manager").length, icon: UserPlus, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30" },
                { label: "Suspended", value: users.filter((u) => u.status === "suspended").length, icon: Ban, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30" },
              ].map((stat) => (
                <Card key={stat.label} className="rounded-[20px] border border-[hsl(var(--border))]">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${stat.bg}`}>
                      <stat.icon className={`h-5 w-5 ${stat.color}`} />
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</p>
                      <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* ── Tab Navigation ── */}
            <div className="flex gap-1 rounded-2xl border border-[hsl(var(--border))] bg-slate-50 dark:bg-slate-900 p-1">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                    activeTab === tab.id
                      ? "bg-white dark:bg-slate-800 shadow-sm text-slate-900 dark:text-white"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                  )}
                >
                  <tab.icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* ══════════════════════════════════════════════════════════════ */}
            {/* TAB: USERS                                                     */}
            {/* ══════════════════════════════════════════════════════════════ */}
            {activeTab === "users" && (
              <Card className="rounded-[24px] border border-[hsl(var(--border))]">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5" />
                        System Users
                      </CardTitle>
                      <CardDescription>Manage roles, status, and access for all accounts</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setNotifyOpen(true)} className="gap-2">
                        <Bell className="h-4 w-4" />
                        Notify User
                      </Button>
                      <Button size="sm" onClick={() => { addForm.reset(); setAddOpen(true); }} className="gap-2">
                        <UserPlus className="h-4 w-4" />
                        Add Agent
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {usersLoading ? (
                    <SkeletonRows rows={6} cols={5} />
                  ) : users.length === 0 ? (
                    <EmptyState
                      icon={Users}
                      title="No users yet"
                      description="Add the first agent to get started."
                      action={{ label: "Add Agent", onClick: () => setAddOpen(true) }}
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Added</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {users.map((u) => (
                            <TableRow key={u.id} className={u.status === "suspended" ? "opacity-60" : ""}>
                              <TableCell>
                                <div className="flex items-center gap-3">
                                  <img
                                    src={u.profileImageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent((u.firstName || "?") + "+" + (u.lastName || ""))}&background=3B82F6&color=fff&size=32`}
                                    alt=""
                                    className="h-8 w-8 rounded-full object-cover flex-shrink-0"
                                  />
                                  <div>
                                    <div className="font-medium text-slate-900 dark:text-white text-sm">
                                      {u.firstName} {u.lastName}
                                      {isSelf(u.id) && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                                    </div>
                                    {u.jobTitle && <div className="text-xs text-slate-400">{u.jobTitle}</div>}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="text-slate-600 dark:text-slate-300 text-sm">{u.email || "—"}</TableCell>
                              <TableCell>{ROLE_BADGE[u.role] || <Badge variant="outline">{u.role}</Badge>}</TableCell>
                              <TableCell>{STATUS_BADGE[u.status || "active"] || STATUS_BADGE.active}</TableCell>
                              <TableCell className="text-sm text-slate-500">
                                {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center justify-end gap-1">
                                  <Button variant="ghost" size="sm" onClick={() => { setPermToggles({}); openPermissions(u); }} title="Manage Permissions">
                                    <KeyRound className="h-4 w-4 text-blue-500" />
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => openEdit(u)} title="Edit">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  {!isSelf(u.id) && (
                                    <Button variant="ghost" size="sm" onClick={() => handleSuspend(u)} disabled={updateMutation.isPending} title={u.status === "suspended" ? "Reactivate" : "Suspend"}>
                                      {u.status === "suspended" ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <Ban className="h-4 w-4 text-amber-600" />}
                                    </Button>
                                  )}
                                  {!isSelf(u.id) && (
                                    <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(u)} title="Remove">
                                      <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                  )}
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
            )}

            {/* ══════════════════════════════════════════════════════════════ */}
            {/* TAB: FACTORING SETTINGS                                        */}
            {/* ══════════════════════════════════════════════════════════════ */}
            {activeTab === "factoring" && (
              <div className="space-y-5">
                <Card className="rounded-[24px] border border-[hsl(var(--border))]">
                  <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      Factoring Rate Configuration
                    </CardTitle>
                    <CardDescription>
                      These rates apply to all new payout records. Existing payouts are not affected.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-6">
                    <Form {...ratesForm}>
                      <form onSubmit={ratesForm.handleSubmit((d) => ratesMutation.mutate(d))} className="space-y-5">
                        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                          <FormField control={ratesForm.control} name="advanceRate" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Advance Rate (%)</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Input {...field} type="number" step="0.1" min={1} max={99} className="pr-10" />
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
                                </div>
                              </FormControl>
                              <FormDescription>Percentage of invoice paid to carrier upfront</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )} />
                          <FormField control={ratesForm.control} name="feeRate" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Factoring Fee (%)</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Input {...field} type="number" step="0.1" min={0} max={50} className="pr-10" />
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">%</span>
                                </div>
                              </FormControl>
                              <FormDescription>Factoring fee deducted from advance amount</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )} />
                        </div>

                        {/* Live preview */}
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-5">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">Preview — $10,000 invoice</p>
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                            {[
                              { label: "Advance", value: `$${((10000 * watchAdvance) / 100).toFixed(2)}`, color: "text-blue-600 dark:text-blue-400" },
                              { label: "Fee", value: `$${((10000 * watchFee) / 100).toFixed(2)}`, color: "text-amber-600 dark:text-amber-400" },
                              { label: "Reserve", value: `$${((10000 * (100 - watchAdvance)) / 100).toFixed(2)}`, color: "text-violet-600 dark:text-violet-400" },
                              { label: "Net Payout", value: `$${((10000 * watchAdvance / 100) - (10000 * watchFee / 100)).toFixed(2)}`, color: "text-emerald-600 dark:text-emerald-400" },
                            ].map(({ label, value, color }) => (
                              <div key={label} className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-center">
                                <p className="text-xs text-slate-500 mb-1">{label}</p>
                                <p className={`font-bold text-lg ${color}`}>{value}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex justify-end">
                          <Button type="submit" disabled={ratesMutation.isPending} className="gap-2">
                            {ratesMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
                            Save Rates
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </CardContent>
                </Card>

                {/* Info card */}
                <Card className="rounded-[20px] border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20">
                  <CardContent className="p-4 flex gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-700 dark:text-amber-300">
                      <p className="font-semibold mb-1">Rate Change Notice</p>
                      <p>Changing rates only affects new payout records created after this change. All existing payouts retain their original rate snapshot for accurate record-keeping.</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════════ */}
            {/* TAB: DOCUMENT REQUIREMENTS                                     */}
            {/* ══════════════════════════════════════════════════════════════ */}
            {activeTab === "documents" && (
              <Card className="rounded-[24px] border border-[hsl(var(--border))]">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <FileCheck className="h-5 w-5" />
                        Document Requirements
                      </CardTitle>
                      <CardDescription>Configure which documents are required at each workflow stage</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      {docsDirty && (
                        <Button onClick={() => saveDocsMutation.mutate(effectiveDocItems)} disabled={saveDocsMutation.isPending} className="gap-2">
                          {saveDocsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />}
                          Save Changes
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 space-y-8">
                  {stageGroups.map((stage) => {
                    const stageDocs = effectiveDocItems.filter((d) => d.stage === stage);
                    return (
                      <div key={stage} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge className={cn("border-0", STAGE_COLORS[stage])}>
                              {STAGE_LABELS[stage]}
                            </Badge>
                            <span className="text-xs text-slate-400">{stageDocs.length} document{stageDocs.length !== 1 ? "s" : ""}</span>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => addDocRow(stage)} className="gap-1 h-7 text-xs">
                            <Plus className="h-3 w-3" /> Add
                          </Button>
                        </div>

                        {stageDocs.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 py-4 text-center text-sm text-slate-400">
                            No documents configured for this stage
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {stageDocs.map((doc, relIdx) => {
                              const absIdx = effectiveDocItems.findIndex((d, gi) => d.stage === stage && effectiveDocItems.filter((x) => x.stage === stage).indexOf(d) === relIdx && gi >= 0);
                              const globalIdx = effectiveDocItems.map((d, i) => ({ d, i })).filter(({ d }) => d.stage === stage)[relIdx]?.i ?? -1;
                              return (
                                <div key={relIdx} className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3">
                                  <Switch
                                    checked={doc.required}
                                    onCheckedChange={(v) => updateDoc(globalIdx, { required: v })}
                                    className="mt-0.5 flex-shrink-0"
                                  />
                                  <div className="flex-1 min-w-0 grid grid-cols-1 gap-2 md:grid-cols-2">
                                    <Input
                                      value={doc.documentName}
                                      onChange={(e) => updateDoc(globalIdx, { documentName: e.target.value })}
                                      placeholder="Document name"
                                      className="h-8 text-sm"
                                    />
                                    <Input
                                      value={doc.description || ""}
                                      onChange={(e) => updateDoc(globalIdx, { description: e.target.value })}
                                      placeholder="Description (optional)"
                                      className="h-8 text-sm"
                                    />
                                  </div>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <Badge variant={doc.required ? "default" : "outline"} className="text-xs hidden sm:inline-flex">
                                      {doc.required ? "Required" : "Optional"}
                                    </Badge>
                                    <Button variant="ghost" size="sm" onClick={() => removeDocRow(globalIdx)} className="h-7 w-7 p-0 text-red-400 hover:text-red-600">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <Separator />
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* ══════════════════════════════════════════════════════════════ */}
            {/* TAB: AUDIT LOG                                                 */}
            {/* ══════════════════════════════════════════════════════════════ */}
            {/* ══════════════════════════════════════════════════════════════ */}
            {/* TAB: CARRIER PORTAL                                           */}
            {/* ══════════════════════════════════════════════════════════════ */}
            {activeTab === "portal" && (
              <div className="space-y-4">
                {/* Quick stats + link to submissions */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    { label: "Registered Carriers", value: portalUsers.length, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/30" },
                    { label: "Pending Approval", value: portalUsers.filter(u => u.status === "pending").length, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30" },
                    { label: "Active Carriers", value: portalUsers.filter(u => u.status === "active").length, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
                  ].map((s) => (
                    <Card key={s.label} className="rounded-[20px] border border-[hsl(var(--border))]">
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${s.bg}`}>
                          <Globe className={`h-5 w-5 ${s.color}`} />
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">{s.label}</p>
                          <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Registered Carrier Accounts</h3>
                  <a href="/portal-submissions" className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" />
                    View all submissions
                  </a>
                </div>

                <Card className="rounded-[24px] border border-[hsl(var(--border))]">
                  <CardContent className="p-0">
                    {portalLoading ? (
                      <SkeletonRows rows={5} cols={5} />
                    ) : portalUsers.length === 0 ? (
                      <EmptyState icon={Globe} title="No registered carriers" description="Carriers will appear here once they register through the portal." />
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Company</TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead>MC / DOT</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Registered</TableHead>
                              <TableHead>Last Login</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {portalUsers.map((u) => (
                              <TableRow key={u.id}>
                                <TableCell className="font-medium">{u.companyName}</TableCell>
                                <TableCell className="text-sm text-slate-500">{u.email}</TableCell>
                                <TableCell className="text-xs text-slate-500">
                                  {u.mcNumber && <p>MC: {u.mcNumber}</p>}
                                  {u.dotNumber && <p>DOT: {u.dotNumber}</p>}
                                  {!u.mcNumber && !u.dotNumber && "—"}
                                </TableCell>
                                <TableCell>{PORTAL_STATUS_BADGE[u.status]}</TableCell>
                                <TableCell className="text-xs text-slate-400">
                                  {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                                </TableCell>
                                <TableCell className="text-xs text-slate-400">
                                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    {u.status === "pending" && (
                                      <Button
                                        size="sm"
                                        className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                        onClick={() => approvePortalMutation.mutate({ id: u.id, status: "active" })}
                                        disabled={approvePortalMutation.isPending}
                                      >
                                        Approve
                                      </Button>
                                    )}
                                    {u.status === "active" && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-xs text-amber-600 border-amber-200 hover:bg-amber-50"
                                        onClick={() => approvePortalMutation.mutate({ id: u.id, status: "suspended" })}
                                        disabled={approvePortalMutation.isPending}
                                      >
                                        Suspend
                                      </Button>
                                    )}
                                    {u.status === "suspended" && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                                        onClick={() => approvePortalMutation.mutate({ id: u.id, status: "active" })}
                                        disabled={approvePortalMutation.isPending}
                                      >
                                        Reinstate
                                      </Button>
                                    )}
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

                <div className="rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 px-4 py-3 flex items-center gap-3 text-sm text-blue-700 dark:text-blue-300">
                  <Globe className="h-4 w-4 flex-shrink-0" />
                  <span>The carrier portal is accessible at <span className="font-mono font-semibold">/portal</span> — share this link with carriers to let them self-register.</span>
                </div>
              </div>
            )}

            {/* ══════════════════════════════════════════════════════════════ */}
            {/* TAB: TIME TRACKING                                            */}
            {/* ══════════════════════════════════════════════════════════════ */}
            {activeTab === "timetracking" && !ttDrillAgent && (
              <div className="space-y-4">
                {/* Live Now Banner */}
                {ttLive.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-5 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500">
                      <span className="h-2.5 w-2.5 rounded-full bg-white animate-pulse" />
                    </div>
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                      {ttLive.length} agent{ttLive.length > 1 ? "s" : ""} currently clocked in:
                    </p>
                    {ttLive.map((a) => (
                      <Badge key={a.userId} className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300">
                        {a.firstName} {a.lastName} — {a.durationHours.toFixed(1)} h
                      </Badge>
                    ))}
                  </div>
                )}

                <Card className="rounded-[24px] border border-[hsl(var(--border))]">
                  <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Clock className="h-5 w-5" />
                          Agent Time Tracking
                        </CardTitle>
                        <CardDescription>Weekly and pay-period hours for all agents — auto-refreshes every 30 s</CardDescription>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => exportTtCsv(ttSummary)} className="gap-2">
                        <Download className="h-4 w-4" />
                        Export CSV
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {ttLoading ? (
                      <SkeletonRows rows={6} cols={6} />
                    ) : ttSummary.length === 0 ? (
                      <EmptyState icon={Clock} title="No time entries yet" description="Agents will appear here once they clock in." />
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Agent</TableHead>
                              <TableHead>Role</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Today</TableHead>
                              <TableHead className="text-right">This Week</TableHead>
                              <TableHead className="text-right">Pay Period</TableHead>
                              <TableHead>Last Activity</TableHead>
                              <TableHead />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {ttSummary.map((row) => (
                              <TableRow key={row.userId}>
                                <TableCell>
                                  <div className="flex items-center gap-2">
                                    <img
                                      src={`https://ui-avatars.com/api/?name=${encodeURIComponent((row.firstName ?? "?") + "+" + (row.lastName ?? ""))}&background=3B82F6&color=fff&size=28`}
                                      alt="" className="h-7 w-7 rounded-full"
                                    />
                                    <span className="font-medium">{row.firstName} {row.lastName}</span>
                                  </div>
                                </TableCell>
                                <TableCell>{ROLE_BADGE[row.role]}</TableCell>
                                <TableCell>
                                  {row.clockedIn ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                                      <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                                        Live — since {row.clockInTime ? new Date(row.clockInTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-slate-400">Clocked Out</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {row.todayHours > 0 ? (
                                    <span className={row.todayHours > 8 ? "text-amber-600 font-semibold" : ""}>{row.todayHours.toFixed(2)} h</span>
                                  ) : <span className="text-slate-400">—</span>}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {row.weekHours > 0 ? (
                                    <span className={row.weekHours > 40 ? "text-red-600 font-semibold" : ""}>{row.weekHours.toFixed(2)} h</span>
                                  ) : <span className="text-slate-400">—</span>}
                                </TableCell>
                                <TableCell className="text-right font-mono text-sm">
                                  {row.periodHours > 0 ? `${row.periodHours.toFixed(2)} h` : <span className="text-slate-400">—</span>}
                                </TableCell>
                                <TableCell className="text-xs text-slate-400">
                                  {row.lastActivity ? new Date(row.lastActivity).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button variant="ghost" size="sm" onClick={() => setTtDrillAgent(row.userId)} className="gap-1.5 text-xs">
                                    <ChevronRight className="h-4 w-4" />
                                    Detail
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
              </div>
            )}

            {/* ── Agent Drill-Down ──────────────────────────────────────────── */}
            {activeTab === "timetracking" && !!ttDrillAgent && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => setTtDrillAgent(null)} className="gap-2">
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </Button>
                  {ttAgentDetail && (
                    <>
                      <h2 className="text-lg font-semibold">
                        {ttAgentDetail.firstName} {ttAgentDetail.lastName}
                      </h2>
                      {ROLE_BADGE[ttAgentDetail.role]}
                      {ttAgentDetail.weekOvertime && (
                        <Badge className="bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300">OT this week</Badge>
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        <span className="text-sm text-slate-500">Week total: <span className="font-semibold text-slate-800 dark:text-white">{ttAgentDetail.weekTotal.toFixed(2)} h</span></span>
                        <Button variant="outline" size="sm" onClick={() => exportAgentCsv(ttAgentDetail)} className="gap-2">
                          <Download className="h-4 w-4" />
                          Export
                        </Button>
                      </div>
                    </>
                  )}
                </div>

                <Card className="rounded-[24px] border border-[hsl(var(--border))]">
                  <CardContent className="p-0">
                    {ttAgentLoading ? (
                      <SkeletonRows rows={7} cols={5} />
                    ) : !ttAgentDetail || ttAgentDetail.days.length === 0 ? (
                      <EmptyState icon={Clock} title="No entries found" description="This agent has no recorded time entries." />
                    ) : (
                      <div className="custom-scrollbar max-h-[600px] overflow-y-auto">
                        {ttAgentDetail.days.map((day) => (
                          <div key={day.date} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                            <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-900/60 px-5 py-2">
                              <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                                {new Date(day.date + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
                              </span>
                              <span className="ml-auto text-sm font-mono text-slate-600 dark:text-slate-400">
                                {day.totalHours.toFixed(2)} h
                              </span>
                              {day.overtime && (
                                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 text-[10px]">
                                  OT &gt; 8h
                                </Badge>
                              )}
                            </div>
                            {day.entries.map((e) => (
                              <div key={e.id} className="flex items-center gap-4 px-5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                <div className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-400 min-w-[120px]">
                                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                                  {new Date(e.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </div>
                                <span className="text-slate-400 text-xs">→</span>
                                <div className="text-sm text-slate-600 dark:text-slate-400 min-w-[100px]">
                                  {e.clockOut ? new Date(e.clockOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : (
                                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                      Active
                                    </span>
                                  )}
                                </div>
                                <div className="font-mono text-sm text-slate-700 dark:text-slate-300">
                                  {e.hours != null ? `${e.hours.toFixed(2)} h` : "—"}
                                </div>
                                {e.notes && (
                                  <div className="text-xs text-slate-400 truncate max-w-[200px]">{e.notes}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === "audit" && (
              <Card className="rounded-[24px] border border-[hsl(var(--border))]">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardList className="h-5 w-5" />
                    Audit Log
                  </CardTitle>
                  <CardDescription>Complete record of system events and user actions</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {auditLoading ? (
                    <SkeletonRows rows={8} cols={4} />
                  ) : auditLog.length === 0 ? (
                    <EmptyState icon={ClipboardList} title="No audit events yet" description="System events will appear here as users perform actions." />
                  ) : (
                    <div className="custom-scrollbar max-h-[600px] overflow-y-auto">
                      {auditLog.map((entry) => {
                        const iconData = ACTIVITY_ICONS[entry.type] ?? ACTIVITY_ICONS.default;
                        const IconComp = iconData.icon;
                        return (
                          <div key={entry.id} className="flex items-start gap-3 border-b border-slate-100 dark:border-slate-800 px-5 py-3 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                              <IconComp className={cn("h-4 w-4", iconData.color)} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-slate-800 dark:text-slate-200">{entry.description}</p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                <span>{entry.userName && entry.userLastName ? `${entry.userName} ${entry.userLastName}` : entry.userId}</span>
                                {entry.entityType && <Badge variant="outline" className="h-4 px-1.5 text-[10px]">{entry.entityType}</Badge>}
                              </div>
                            </div>
                            <div className="flex-shrink-0 flex items-center gap-1.5 text-xs text-slate-400">
                              <Clock className="h-3 w-3" />
                              {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

          </div>
        </main>
      </div>

      {/* ── Add Agent ─────────────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" /> Add New Agent</DialogTitle>
            <DialogDescription>Create a new agent account. A welcome email with login credentials will be sent automatically.</DialogDescription>
          </DialogHeader>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={addForm.control} name="firstName" render={({ field }) => (
                  <FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} placeholder="Jane" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={addForm.control} name="lastName" render={({ field }) => (
                  <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} placeholder="Doe" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={addForm.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email Address</FormLabel><FormControl><Input {...field} type="email" placeholder="jane.doe@example.com" /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={addForm.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="employee">Employee</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={addForm.control} name="password" render={({ field }) => (
                  <FormItem><FormLabel>Temporary Password</FormLabel><FormControl><Input {...field} type="password" placeholder="Min 6 characters" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">
                <Mail className="h-4 w-4 flex-shrink-0" />
                Login credentials will be emailed to the agent automatically.
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...</> : "Create Agent"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Edit User ─────────────────────────────────────────────────────── */}
      <Dialog open={!!editUser} onOpenChange={(o) => { if (!o) setEditUser(null); }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-5 w-5" /> Edit User</DialogTitle>
            <DialogDescription>Update name, email, or role for {editUser?.firstName} {editUser?.lastName}.</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((d) => { if (editUser) updateMutation.mutate({ id: editUser.id, updates: d }); })} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={editForm.control} name="firstName" render={({ field }) => (
                  <FormItem><FormLabel>First Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={editForm.control} name="lastName" render={({ field }) => (
                  <FormItem><FormLabel>Last Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={editForm.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input {...field} type="email" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={editForm.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={isSelf(editUser?.id || "")}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="employee">Employee</SelectItem>
                      <SelectItem value="manager">Manager</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  {isSelf(editUser?.id || "") && <p className="text-xs text-slate-500">You cannot change your own role.</p>}
                  <FormMessage />
                </FormItem>
              )} />
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save Changes"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ────────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="h-5 w-5" /> Remove User Account
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>Are you sure you want to permanently remove this account? This cannot be undone.</p>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-3">
                  <p className="font-semibold text-slate-900 dark:text-white text-sm">{deleteTarget?.firstName} {deleteTarget?.lastName}</p>
                  {deleteTarget?.email && <p className="text-sm text-slate-500">{deleteTarget.email}</p>}
                  {deleteTarget?.role && <p className="text-xs text-slate-400 capitalize mt-1">{deleteTarget.role}</p>}
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Removing...</> : "Remove Account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Notify User ───────────────────────────────────────────────────── */}
      <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Bell className="h-5 w-5" /> Send Notification</DialogTitle>
            <DialogDescription>Send an in-app notification to a user. Use this to request missing information or communicate important updates.</DialogDescription>
          </DialogHeader>
          <Form {...notifyForm}>
            <form onSubmit={notifyForm.handleSubmit((d) => notifyMutation.mutate(d))} className="space-y-4">
              <FormField control={notifyForm.control} name="userId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Recipient</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select user…" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {users.filter((u) => !isSelf(u.id)).map((u) => (
                        <SelectItem key={u.id} value={u.id}>{u.firstName} {u.lastName} ({u.role})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={notifyForm.control} name="subject" render={({ field }) => (
                <FormItem>
                  <FormLabel>Subject</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. Missing documentation required" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={notifyForm.control} name="message" render={({ field }) => (
                <FormItem>
                  <FormLabel>Message</FormLabel>
                  <FormControl><Textarea {...field} rows={4} placeholder="Please provide the missing Bill of Lading for invoice INV-004…" className="resize-none" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                This will appear as a warning notification in the user's notification center.
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="outline" onClick={() => setNotifyOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={notifyMutation.isPending}>
                  {notifyMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</> : "Send Notification"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Permissions Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!permTarget} onOpenChange={(o) => { if (!o) { setPermTarget(null); setPermToggles({}); } }}>
        <DialogContent className="sm:max-w-[680px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-blue-500" />
              Permissions — {permTarget?.firstName} {permTarget?.lastName}
            </DialogTitle>
            <DialogDescription>
              Toggle exactly what this agent can access. Admin always sees everything regardless of these settings.
            </DialogDescription>
          </DialogHeader>

          {permLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <div className="space-y-5 py-2">
              {/* Header bar */}
              <div className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/60 px-4 py-3">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  <span className="font-semibold text-slate-900 dark:text-white">{grantedCount}</span> of {allKeys.length} permissions granted
                </p>
                <div className="flex gap-2">
                  {(["employee", "manager", "admin"] as const).map((r) => (
                    <Button
                      key={r}
                      size="sm"
                      variant="outline"
                      className="text-xs h-7 gap-1 capitalize"
                      onClick={() => applyRoleDefaults(r)}
                    >
                      <RotateCcw className="h-3 w-3" />
                      {r} defaults
                    </Button>
                  ))}
                </div>
              </div>

              {/* Permission sections */}
              {PERMISSION_SECTIONS.map((section) => (
                <div key={section.label}>
                  <div className="mb-2 flex items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{section.label}</p>
                    <div className="flex-1 border-t border-slate-100 dark:border-slate-800" />
                    <button
                      type="button"
                      className="text-[10px] text-blue-500 hover:underline"
                      onClick={() => {
                        const allOn = section.items.every(i => activeToggles[i.key]);
                        setPermToggles(prev => ({
                          ...resolvedToggles,
                          ...prev,
                          ...Object.fromEntries(section.items.map(i => [i.key, !allOn])),
                        }));
                      }}
                    >
                      {section.items.every(i => activeToggles[i.key]) ? "Disable all" : "Enable all"}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                    {section.items.map((item) => (
                      <div key={item.key} className="flex items-center justify-between gap-3 rounded-lg border border-[hsl(var(--border))] bg-white dark:bg-slate-900 px-3 py-2.5">
                        <Label htmlFor={`perm-${item.key}`} className="text-sm font-medium cursor-pointer">
                          {item.label}
                        </Label>
                        <Switch
                          id={`perm-${item.key}`}
                          checked={!!activeToggles[item.key]}
                          onCheckedChange={(val) =>
                            setPermToggles(prev => ({
                              ...resolvedToggles,
                              ...prev,
                              [item.key]: val,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Footer actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <Button variant="outline" onClick={() => { setPermTarget(null); setPermToggles({}); }}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    const granted = allKeys.filter(k => activeToggles[k]);
                    permMutation.mutate({ id: permTarget!.id, permissions: granted });
                  }}
                  disabled={permMutation.isPending}
                >
                  {permMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : "Save Permissions"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
