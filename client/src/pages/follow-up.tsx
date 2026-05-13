import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Clock, Plus, Search, Calendar, AlertCircle, CheckCircle, User, FileText,
  Mail, Zap, CheckCheck, RefreshCw,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { cn } from "@/lib/utils";

const followUpSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]),
  dueDate: z.string().min(1, "Due date is required"),
  status: z.enum(["pending", "in-progress", "completed"]).default("pending"),
});

type FollowUp = {
  id: number;
  clientId: number;
  title: string;
  description?: string;
  priority: "low" | "medium" | "high";
  dueDate: string;
  status: "pending" | "in-progress" | "completed";
  createdAt: string;
  updatedAt: string;
  client?: { id: number; name: string; email: string };
};

type BrokerFollowUp = {
  id: number;
  invoiceId: number;
  clientId: number | null;
  triggerType: "auto" | "manual";
  triggerStatus: string;
  subject: string;
  body: string;
  status: "pending" | "sent" | "acknowledged" | "failed";
  sentAt: string | null;
  acknowledgedAt: string | null;
  sentBy: string | null;
  notes: string | null;
  createdAt: string;
  invoiceNumber: string | null;
  invoiceAmount: string | null;
  loadNumber: string | null;
  clientName: string | null;
};

// ─── Status helpers ───────────────────────────────────────────────────────────

function getPriorityColor(priority: string) {
  switch (priority) {
    case "high":   return "bg-red-100 text-red-800 border-red-200";
    case "medium": return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "low":    return "bg-green-100 text-green-800 border-green-200";
    default:       return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "completed":  return "bg-green-100 text-green-800 border-green-200";
    case "in-progress": return "bg-blue-100 text-blue-800 border-blue-200";
    case "pending":    return "bg-gray-100 text-gray-800 border-gray-200";
    default:           return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "completed":  return <CheckCircle className="h-4 w-4" />;
    case "in-progress": return <Clock className="h-4 w-4" />;
    case "pending":    return <AlertCircle className="h-4 w-4" />;
    default:           return <AlertCircle className="h-4 w-4" />;
  }
}

const BFU_STATUS_COLOR: Record<string, string> = {
  pending:      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/20 dark:text-amber-400",
  sent:         "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400",
  acknowledged: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-400",
  failed:       "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:text-red-400",
};

export default function FollowUpPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [isAddingFollowUp, setIsAddingFollowUp] = useState(false);
  const [bfuSearch, setBfuSearch] = useState("");
  const [bfuStatusFilter, setBfuStatusFilter] = useState("all");
  const [expandedBfu, setExpandedBfu] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<z.infer<typeof followUpSchema>>({
    resolver: zodResolver(followUpSchema),
    defaultValues: { status: "pending", priority: "medium" },
  });

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: followUps = [], isLoading } = useQuery<FollowUp[]>({ queryKey: ["/api/follow-ups"] });
  const { data: clients = [] } = useQuery({ queryKey: ["/api/clients"] });
  const { data: brokerFollowUps = [], isLoading: bfuLoading } = useQuery<BrokerFollowUp[]>({
    queryKey: ["/api/broker-follow-ups"],
  });

  // ── Manual follow-up mutations ────────────────────────────────────────────────
  const addFollowUpMutation = useMutation({
    mutationFn: (data: z.infer<typeof followUpSchema>) => apiRequest("POST", "/api/follow-ups", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/follow-ups"] });
      form.reset();
      setIsAddingFollowUp(false);
      toast({ title: "Success", description: "Follow-up task created successfully" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create follow-up task", variant: "destructive" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/follow-ups/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/follow-ups"] });
      toast({ title: "Success", description: "Follow-up status updated" });
    },
  });

  // ── Broker follow-up mutations ────────────────────────────────────────────────
  const acknowledgeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/broker-follow-ups/${id}`, { status: "acknowledged" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker-follow-ups"] });
      toast({ title: "Acknowledged", description: "Broker follow-up marked as acknowledged" });
    },
  });

  const saveNotesMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) =>
      apiRequest("PATCH", `/api/broker-follow-ups/${id}`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/broker-follow-ups"] });
      toast({ title: "Saved", description: "Notes saved" });
    },
  });

  const onSubmit = (data: z.infer<typeof followUpSchema>) => addFollowUpMutation.mutate(data);

  // ── Filtered lists ────────────────────────────────────────────────────────────
  const filteredFollowUps = (followUps as FollowUp[]).filter((f) => {
    const matchesSearch =
      f.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.client?.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus   = statusFilter === "all"   || f.status === statusFilter;
    const matchesPriority = priorityFilter === "all" || f.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const filteredBfu = (brokerFollowUps as BrokerFollowUp[]).filter((b) => {
    const q = bfuSearch.toLowerCase();
    const matchesSearch = !q ||
      (b.invoiceNumber ?? "").toLowerCase().includes(q) ||
      (b.clientName ?? "").toLowerCase().includes(q) ||
      (b.loadNumber ?? "").toLowerCase().includes(q);
    const matchesStatus = bfuStatusFilter === "all" || b.status === bfuStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const pendingBfuCount = (brokerFollowUps as BrokerFollowUp[]).filter(b => b.status === "pending" || b.status === "sent").length;

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopNav title="Follow Ups" subtitle="Manage client follow-ups, pending tasks, and broker automations" />

        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">

            {/* Header */}
            <div className="flex justify-between items-center">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                  <Clock className="h-8 w-8 text-blue-600" />
                  Follow Up Tasks
                </h1>
                <p className="text-gray-600 dark:text-gray-400 mt-1">
                  Manage client follow-ups, pending tasks, and broker automations
                </p>
              </div>
              <Dialog open={isAddingFollowUp} onOpenChange={setIsAddingFollowUp}>
                <DialogTrigger asChild>
                  <Button className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Add Follow Up
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>Create Follow Up Task</DialogTitle>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                      <FormField control={form.control} name="clientId" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Client</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select a client" /></SelectTrigger></FormControl>
                            <SelectContent>
                              {(clients as any[]).map((c: any) => (
                                <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="title" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Title</FormLabel>
                          <FormControl><Input placeholder="Follow-up task title" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="description" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl><Textarea placeholder="Additional details about the follow-up task" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <div className="grid grid-cols-2 gap-4">
                        <FormField control={form.control} name="priority" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Priority</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                <SelectItem value="low">Low</SelectItem>
                                <SelectItem value="medium">Medium</SelectItem>
                                <SelectItem value="high">High</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name="dueDate" render={({ field }) => (
                          <FormItem>
                            <FormLabel>Due Date</FormLabel>
                            <FormControl><Input type="date" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>
                      <div className="flex justify-end gap-2 pt-4">
                        <Button type="button" variant="outline" onClick={() => setIsAddingFollowUp(false)}>Cancel</Button>
                        <Button type="submit" disabled={addFollowUpMutation.isPending}>Create Follow Up</Button>
                      </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="manual">
              <TabsList className="mb-4">
                <TabsTrigger value="manual" className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Manual Tasks
                  {filteredFollowUps.length > 0 && (
                    <span className="ml-1 rounded-full bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-bold">{filteredFollowUps.length}</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="broker" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Broker Automations
                  {pendingBfuCount > 0 && (
                    <span className="ml-1 rounded-full bg-orange-500 text-white px-1.5 py-0.5 text-[10px] font-bold">{pendingBfuCount}</span>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* ── Manual follow-ups tab ─────────────────────────────────────── */}
              <TabsContent value="manual" className="space-y-4">
                {/* Filters */}
                <Card>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap gap-4 items-center">
                      <div className="flex items-center gap-2 flex-1 min-w-64">
                        <Search className="h-4 w-4 text-gray-400" />
                        <Input
                          placeholder="Search follow-ups..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                      </div>
                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-48"><SelectValue placeholder="Filter by status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="in-progress">In Progress</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                        <SelectTrigger className="w-48"><SelectValue placeholder="Filter by priority" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Priority</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {/* Follow-up cards */}
                <div className="grid gap-4">
                  {isLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
                      <p className="text-gray-600 mt-2">Loading follow-ups...</p>
                    </div>
                  ) : filteredFollowUps.length === 0 ? (
                    <Card>
                      <CardContent className="p-8 text-center">
                        <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No follow-ups found</h3>
                        <p className="text-gray-600 dark:text-gray-400">
                          {searchTerm || statusFilter !== "all" || priorityFilter !== "all"
                            ? "Try adjusting your filters or search terms"
                            : "Create your first follow-up task to get started"}
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    filteredFollowUps.map((followUp) => (
                      <Card key={followUp.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-6">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{followUp.title}</h3>
                                <Badge className={getPriorityColor(followUp.priority)}>{followUp.priority}</Badge>
                                <Badge className={getStatusColor(followUp.status)}>
                                  <span className="flex items-center gap-1">
                                    {getStatusIcon(followUp.status)}
                                    {followUp.status.replace("-", " ")}
                                  </span>
                                </Badge>
                              </div>
                              {followUp.description && (
                                <p className="text-gray-600 dark:text-gray-400 mb-3">{followUp.description}</p>
                              )}
                              <div className="flex items-center gap-4 text-sm text-gray-500">
                                <div className="flex items-center gap-1">
                                  <User className="h-4 w-4" />
                                  {followUp.client?.name}
                                </div>
                                <div className="flex items-center gap-1">
                                  <Calendar className="h-4 w-4" />
                                  Due: {format(new Date(followUp.dueDate), "MMM dd, yyyy")}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 ml-4">
                              {followUp.status !== "completed" && (
                                <>
                                  {followUp.status === "pending" && (
                                    <Button size="sm" variant="outline"
                                      onClick={() => updateStatusMutation.mutate({ id: followUp.id, status: "in-progress" })}
                                    >Start</Button>
                                  )}
                                  <Button size="sm"
                                    onClick={() => updateStatusMutation.mutate({ id: followUp.id, status: "completed" })}
                                  >Complete</Button>
                                </>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </TabsContent>

              {/* ── Broker automations tab ────────────────────────────────────── */}
              <TabsContent value="broker" className="space-y-4">
                {/* Info banner */}
                <div className="flex items-start gap-3 rounded-xl border border-orange-200/70 bg-orange-50/60 px-4 py-3 dark:border-orange-900/40 dark:bg-orange-950/10">
                  <Zap className="h-4 w-4 mt-0.5 shrink-0 text-orange-500" />
                  <p className="text-[12.5px] text-orange-800 dark:text-orange-300">
                    <span className="font-semibold">Automated follow-ups</span> are triggered when an invoice is funded (enters collections-ready state).
                    An email is sent to the broker/debtor and the event is logged to the Audit Trail.
                  </p>
                </div>

                {/* Filters */}
                <Card>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap gap-4 items-center">
                      <div className="flex items-center gap-2 flex-1 min-w-64">
                        <Search className="h-4 w-4 text-gray-400" />
                        <Input
                          placeholder="Search by invoice, carrier, load…"
                          value={bfuSearch}
                          onChange={(e) => setBfuSearch(e.target.value)}
                        />
                      </div>
                      <Select value={bfuStatusFilter} onValueChange={setBfuStatusFilter}>
                        <SelectTrigger className="w-48"><SelectValue placeholder="Filter by status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="sent">Sent</SelectItem>
                          <SelectItem value="acknowledged">Acknowledged</SelectItem>
                          <SelectItem value="failed">Failed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {/* Broker follow-up table */}
                {bfuLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500 mx-auto" />
                    <p className="text-gray-600 dark:text-gray-400 mt-2">Loading broker automations...</p>
                  </div>
                ) : filteredBfu.length === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <Mail className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No broker follow-ups yet</h3>
                      <p className="text-gray-600 dark:text-gray-400">
                        {bfuSearch || bfuStatusFilter !== "all"
                          ? "Try adjusting your filters"
                          : "Broker follow-ups are created automatically when invoices are funded."}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                          <tr>
                            <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Invoice</th>
                            <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Carrier</th>
                            <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Load #</th>
                            <th className="text-right px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Amount</th>
                            <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Trigger</th>
                            <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Status</th>
                            <th className="text-left px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Created</th>
                            <th className="text-right px-4 py-3 font-semibold text-slate-600 dark:text-slate-400">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {filteredBfu.map((bfu) => (
                            <>
                              <tr
                                key={bfu.id}
                                className="hover:bg-slate-50/60 dark:hover:bg-slate-900/30 transition-colors cursor-pointer"
                                onClick={() => setExpandedBfu(expandedBfu === bfu.id ? null : bfu.id)}
                              >
                                <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                                  {bfu.invoiceNumber ?? `#${bfu.invoiceId}`}
                                </td>
                                <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                                  {bfu.clientName ?? <span className="text-slate-400">—</span>}
                                </td>
                                <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                                  {bfu.loadNumber ?? <span className="text-slate-400">—</span>}
                                </td>
                                <td className="px-4 py-3 text-right font-medium text-slate-700 dark:text-slate-300">
                                  {bfu.invoiceAmount
                                    ? `$${Number(bfu.invoiceAmount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                                    : "—"}
                                </td>
                                <td className="px-4 py-3">
                                  <span className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border",
                                    bfu.triggerType === "auto"
                                      ? "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400"
                                      : "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/20 dark:text-violet-400"
                                  )}>
                                    {bfu.triggerType === "auto" ? <Zap className="h-3 w-3" /> : <User className="h-3 w-3" />}
                                    {bfu.triggerType}
                                  </span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border capitalize",
                                    BFU_STATUS_COLOR[bfu.status] ?? "bg-gray-50 text-gray-600 border-gray-200"
                                  )}>
                                    {bfu.status === "acknowledged" && <CheckCheck className="h-3 w-3" />}
                                    {bfu.status === "sent" && <Mail className="h-3 w-3" />}
                                    {bfu.status}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-[12px]">
                                  {bfu.createdAt ? format(new Date(bfu.createdAt), "MMM d, yyyy") : "—"}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div className="flex items-center gap-1.5 justify-end" onClick={e => e.stopPropagation()}>
                                    {bfu.status !== "acknowledged" && (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2.5 text-[11px]"
                                        disabled={acknowledgeMutation.isPending}
                                        onClick={() => acknowledgeMutation.mutate(bfu.id)}
                                      >
                                        <CheckCheck className="h-3 w-3 mr-1" />
                                        Acknowledge
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-[11px]"
                                      onClick={() => setExpandedBfu(expandedBfu === bfu.id ? null : bfu.id)}
                                    >
                                      {expandedBfu === bfu.id ? "Collapse" : "Details"}
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                              {expandedBfu === bfu.id && (
                                <tr key={`${bfu.id}-detail`} className="bg-slate-50/80 dark:bg-slate-900/40">
                                  <td colSpan={8} className="px-6 py-4">
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                      <div>
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Email Subject</p>
                                        <p className="text-[13px] text-slate-700 dark:text-slate-300">{bfu.subject}</p>
                                        <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Email Body</p>
                                        <pre className="text-[11.5px] text-slate-600 dark:text-slate-400 whitespace-pre-wrap font-sans bg-white dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700 max-h-52 overflow-auto">
                                          {bfu.body}
                                        </pre>
                                      </div>
                                      <div>
                                        <NoteEditor bfu={bfu} onSave={(notes) => saveNotesMutation.mutate({ id: bfu.id, notes })} saving={saveNotesMutation.isPending} />
                                        <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                                          {bfu.sentAt && (
                                            <div>
                                              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Sent At</p>
                                              <p className="text-slate-600 dark:text-slate-300">{format(new Date(bfu.sentAt), "MMM d, yyyy HH:mm")}</p>
                                            </div>
                                          )}
                                          {bfu.acknowledgedAt && (
                                            <div>
                                              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Acknowledged</p>
                                              <p className="text-slate-600 dark:text-slate-300">{format(new Date(bfu.acknowledgedAt), "MMM d, yyyy HH:mm")}</p>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Inline note editor ───────────────────────────────────────────────────────
function NoteEditor({
  bfu, onSave, saving,
}: { bfu: BrokerFollowUp; onSave: (notes: string) => void; saving: boolean }) {
  const [notes, setNotes] = useState(bfu.notes ?? "");
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Agent Notes</p>
      <Textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={3}
        placeholder="Add notes about this follow-up…"
        className="text-[12px] resize-none"
      />
      <Button
        size="sm"
        variant="outline"
        className="mt-1.5 h-7 px-3 text-[11px]"
        disabled={saving || notes === (bfu.notes ?? "")}
        onClick={() => onSave(notes)}
      >
        {saving ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : null}
        Save Notes
      </Button>
    </div>
  );
}
