import { type ComponentPropsWithoutRef, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Briefcase, CalendarDays, Check,
  CheckSquare, ChevronDown, ChevronRight, Clock3, Edit3, FileText,
  ListTodo, Loader2, Pause, Play, Plus, Search, SlidersHorizontal, Target,
  Trash2, UserRound, X,
} from "lucide-react";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Popover, PopoverContent as BasePopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { PageInsights } from "@/components/PageInsights";
import { Textarea } from "@/components/ui/textarea";
import { ServerArrayPagination, useServerArrayPage } from "@/hooks/use-server-array-page";
import { NeuBadge, NeuButton, NeuCard, NeuInput, NeuPageShell, NeuSelect, NeuTab, NeuTabList, NeuTabs } from "@/styles/neu/components";
import { TasksOverview } from "@/components/tasks/tasks-overview";
import { isTaskOverdue, taskCalendarDate, taskDueDate } from "@shared/task-analytics";

// Portaled pickers must sit above the task dialog, not behind its controls.
function PopoverContent({ className, ...props }: ComponentPropsWithoutRef<typeof BasePopoverContent>) {
  return <BasePopoverContent {...props} className={cn("!pointer-events-auto !z-[70]", className)} />;
}

const taskFormSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().optional(),
  type: z.enum(["chargeback", "followup", "call", "task", "processing"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  status: z.enum(["todo", "in_progress", "held", "completed"]),
  dueDate: z.string().optional(),
  clientId: z.number().optional(),
  assignedTo: z.string().nullable().optional(),
  progress: z.number().int().min(0).max(100).default(0),
});
type TaskFormData = z.infer<typeof taskFormSchema>;

interface Person {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  profileImageUrl?: string | null;
}
interface Task {
  id: number;
  title: string;
  description?: string;
  type: string;
  priority: string;
  status: string;
  dueDate?: string | null;
  clientId?: number | null;
  assignedTo?: string | null;
  createdBy?: string | null;
  progress: number;
  progressUpdatedAt?: string | null;
  progressUpdater?: Person | null;
  assignedAgent?: Person | null;
  creator?: Person | null;
  createdAt: string;
  updatedAt: string;
  client?: { id: number; name: string };
  confirmationInvoiceId?: number | null;
  invoiceNumber?: string | null;
  brokerId?: number | null;
  brokerName?: string | null;
  carrier?: { id?: number; name?: string | null } | null;
  carrierId?: number | null;
  carrierName?: string | null;
}
interface Agent extends Person { id: string; role: string }
type Scope = "all" | "assigned-to-me" | "created-by-me";
type Category = "all" | "chargebacks" | "followups" | "held" | "working" | "calls" | "manual";

const CATEGORY_OPTIONS: Array<{ value: Category; label: string }> = [
  { value: "all", label: "All tasks" },
  { value: "chargebacks", label: "Chargebacks" },
  { value: "followups", label: "Follow-ups" },
  { value: "held", label: "Held" },
  { value: "working", label: "Working" },
  { value: "calls", label: "Calls" },
  { value: "manual", label: "Manual tasks" },
];

function personName(person?: Person | null) {
  return person ? [person.firstName, person.lastName].filter(Boolean).join(" ") || "Unknown agent" : "Unassigned";
}
function personInitials(person?: Person | null) {
  if (!person) return "—";
  const initials = [person.firstName?.trim()?.[0], person.lastName?.trim()?.[0]].filter(Boolean).join("");
  return initials.toUpperCase() || "U";
}
function taskDateLabel(value?: string | null, dueDate = false) {
  const normalized = dueDate ? taskDueDate(value) : taskCalendarDate(value);
  if (!normalized) return "No due date";
  const date = new Date(`${normalized}T12:00:00`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function statusLabel(status: string) {
  return status === "in_progress" ? "In progress" : status === "todo" ? "Open" : status.charAt(0).toUpperCase() + status.slice(1);
}
function statusTone(status: string): "neutral" | "accent" | "success" | "warning" {
  if (status === "completed") return "success";
  if (status === "in_progress") return "accent";
  if (status === "held") return "warning";
  return "neutral";
}

function TaskCard({
  task, completed = false, isManager, onEdit, onDelete, onStatus, onProgress, onOpenDetail,
}: {
  task: Task;
  completed?: boolean;
  isManager: boolean;
  onEdit: (task: Task, focusAssignee?: boolean) => void;
  onDelete: (task: Task) => void;
  onStatus: (task: Task, status: string) => void;
  onProgress: (taskId: number, progress: number) => Promise<void>;
  onOpenDetail: (task: Task) => void;
}) {
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressDraft, setProgressDraft] = useState(task.progress || 0);
  const overdue = !completed && isTaskOverdue(task, new Date());
  const carrierName = task.carrier?.name || task.carrierName;
  const carrierId = task.carrier?.id ?? task.carrierId;
  const priorityColor = ["high", "urgent"].includes(task.priority) ? "#b3534a" : task.priority === "medium" ? "#b27a2b" : "#8b9697";
  const progressColor = progressDraft >= 100 ? "#347d69" : progressDraft >= 60 ? "#27aab8" : "#a87932";

  return (
    <NeuCard pressed={completed} data-testid={`task-card-${task.id}`} className={cn(
      "relative overflow-hidden p-4 sm:p-5",
      completed && "opacity-75",
    )}>
      <span aria-hidden="true" className="absolute inset-y-4 left-0 w-1 rounded-r-full" style={{ backgroundColor: priorityColor }} />
      <div className="flex flex-col gap-4 pl-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={cn("text-left text-base font-bold leading-6 text-[#354548] hover:text-[#168d98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]", completed && "line-through")}
              onClick={() => onOpenDetail(task)}
              aria-label={`Open task ${task.title}`}
              data-testid={`task-title-${task.id}`}
            >{task.title}</button>
            <NeuBadge className="capitalize">{task.type.replace(/_/g, " ")}</NeuBadge>
            <NeuBadge tone={task.priority === "urgent" || task.priority === "high" ? "warning" : "neutral"} className={cn(["urgent", "high"].includes(task.priority) && "!text-[#a64f46]")}>
              {task.priority}
            </NeuBadge>
          </div>
          {task.description && <p className="mt-1.5 max-w-4xl text-sm leading-5 text-[#728082]">{task.description}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {task.confirmationInvoiceId && (
              <Link href={`/invoices/${task.confirmationInvoiceId}`} className="no-underline">
                <NeuBadge tone="accent" className="cursor-pointer hover:text-[#147f89]"><FileText className="mr-1 h-3 w-3" />Invoice {task.invoiceNumber || `#${task.confirmationInvoiceId}`}</NeuBadge>
              </Link>
            )}
            {task.client && <Link href={`/clients/${task.client.id}`} className="no-underline"><NeuBadge className="cursor-pointer hover:text-[#168d98]"><Briefcase className="mr-1 h-3 w-3" />{task.client.name}</NeuBadge></Link>}
            {carrierName && (carrierId
              ? <Link href={`/carriers/${carrierId}`} className="no-underline"><NeuBadge className="cursor-pointer hover:text-[#168d98]">Carrier · {carrierName}</NeuBadge></Link>
              : <NeuBadge>Carrier · {carrierName}</NeuBadge>)}
            {task.brokerName && (task.brokerId
              ? <Link href={`/brokers/${task.brokerId}`} className="no-underline"><NeuBadge className="cursor-pointer hover:text-[#168d98]">Broker · {task.brokerName}</NeuBadge></Link>
              : <NeuBadge>Broker · {task.brokerName}</NeuBadge>)}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex items-center gap-2" title={personName(task.assignedAgent)}>
              <Avatar className="h-8 w-8 shadow-[2px_2px_5px_#b8b8b8,-2px_-2px_5px_#ffffff]">
                <AvatarImage src={task.assignedAgent?.profileImageUrl || undefined} alt="" />
                <AvatarFallback className="bg-[#d1e4e2] text-[10px] font-bold text-[#347d69]">{personInitials(task.assignedAgent)}</AvatarFallback>
              </Avatar>
              <div className="leading-tight">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#879294]">Assigned to</p>
                <p className="mt-0.5 text-xs font-semibold text-[#526164]">{personName(task.assignedAgent)}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-[#687779]">
              <CalendarDays className="h-3.5 w-3.5" />
              <span>Due {taskDateLabel(task.dueDate, true)}</span>
              {overdue && <NeuBadge tone="warning" className="!text-[#a64f46]">Overdue</NeuBadge>}
            </div>
            <Popover open={progressOpen} onOpenChange={(open) => { setProgressOpen(open); if (open) setProgressDraft(task.progress || 0); }}>
              <PopoverTrigger asChild>
                <button type="button" className="flex min-w-[150px] items-center gap-2 text-left" aria-label={`Edit progress for ${task.title}`}>
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[#c7c7c7]"><span className="block h-full rounded-full" style={{ width: `${task.progress || 0}%`, background: progressColor }} /></span>
                  <span className="font-mono text-[11px] text-[#708082]">{task.progress || 0}%</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 border-0 bg-[#e0e0e0] p-4 text-[#354548] shadow-[7px_7px_16px_#b8b8b8,-7px_-7px_16px_#ffffff]" onClick={event => event.stopPropagation()}>
                <p className="mb-3 text-xs font-semibold">Progress · {progressDraft}%</p>
                <Slider value={[progressDraft]} min={0} max={100} step={1} onValueChange={([value]) => setProgressDraft(value)} onValueCommit={async ([value]) => {
                  try { await onProgress(task.id, value); setProgressOpen(false); }
                  catch { /* parent reports the save error */ }
                }} />
                <p className="mt-2 text-[10px] text-[#879294]">Changes save when you release the slider.</p>
              </PopoverContent>
            </Popover>
            <span className="flex items-center gap-1 text-[11px] text-[#8a9697]"><Clock3 className="h-3 w-3" />Added {taskDateLabel(task.createdAt)}</span>
            {task.progressUpdater && <span className="text-[11px] text-[#879294]">Progress updated by {personName(task.progressUpdater)}{task.progressUpdatedAt ? ` · ${taskDateLabel(task.progressUpdatedAt)}` : ""}</span>}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:max-w-[280px] lg:justify-end">
          <NeuBadge tone={statusTone(task.status)} className={cn(task.status === "held" && "!text-[#a64f46]")}>{statusLabel(task.status)}</NeuBadge>
          {task.status === "todo" && <NeuButton onClick={() => onStatus(task, "in_progress")} aria-label={`Start ${task.title}`} data-testid={`button-start-${task.id}`} className="min-h-9 rounded-lg px-3 text-xs"><Play className="h-3.5 w-3.5" />Start</NeuButton>}
          {task.status === "held" && <NeuButton onClick={() => onStatus(task, "in_progress")} aria-label={`Resume ${task.title}`} data-testid={`button-resume-${task.id}`} className="min-h-9 rounded-lg px-3 text-xs"><Play className="h-3.5 w-3.5" />Resume</NeuButton>}
          {task.status === "in_progress" && <NeuButton onClick={() => onStatus(task, "held")} aria-label={`Pause ${task.title}`} data-testid={`button-hold-${task.id}`} className="min-h-9 rounded-lg px-3 text-xs"><Pause className="h-3.5 w-3.5" />Pause</NeuButton>}
          {!completed && <NeuButton variant="accent" onClick={() => onStatus(task, "completed")} aria-label={`Complete ${task.title}`} data-testid={`button-complete-${task.id}`} className="min-h-9 rounded-lg px-3 text-xs"><Check className="h-3.5 w-3.5" />Complete</NeuButton>}
          {isManager && !completed && <NeuButton onClick={() => onEdit(task, true)} aria-label={`Reassign ${task.title}`} data-testid={`button-reassign-${task.id}`} className="min-h-9 rounded-lg px-3 text-xs"><UserRound className="h-3.5 w-3.5" />Reassign</NeuButton>}
          <NeuButton onClick={() => onEdit(task)} aria-label={`Edit ${task.title}`} data-testid={`button-edit-${task.id}`} className="min-h-9 rounded-lg px-3 text-xs"><Edit3 className="h-3.5 w-3.5" />Edit</NeuButton>
          {isManager && <NeuButton onClick={() => onDelete(task)} aria-label={`Delete ${task.title}`} data-testid={`button-delete-${task.id}`} className="min-h-9 rounded-lg px-3 text-xs text-[#a64f46]"><Trash2 className="h-3.5 w-3.5" /><span className="sr-only sm:not-sr-only">Delete</span></NeuButton>}
        </div>
      </div>
    </NeuCard>
  );
}

export default function Tasks() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const [scope, setScope] = useState<Scope>(isManager ? "all" : "assigned-to-me");
  const [category, setCategory] = useState<Category>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [sort, setSort] = useState("due");
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [agentSearch, setAgentSearch] = useState("");
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const handledTaskQuery = useRef<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const filterParams = useMemo<Record<string, string>>(() => {
    const params: Record<string, string> = { scope, sort };
    if (search.trim()) params.q = search.trim();
    if (statusFilter !== "all") params.status = statusFilter;
    if (statusFilter === "overdue") {
      const now = new Date();
      params.today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    }
    if (priorityFilter !== "all") params.priority = priorityFilter;
    if (assigneeFilter !== "all") params.assignee = assigneeFilter === "__unassigned" ? "unassigned" : assigneeFilter;
    if (category !== "all") {
      params.category = category;
      const typeByCategory: Partial<Record<Category, string>> = {
        chargebacks: "chargeback",
        followups: "followup",
        calls: "call",
        manual: "task,processing",
      };
      if (typeByCategory[category]) params.type = typeByCategory[category]!;
      if (category === "held" && statusFilter === "all") params.status = "held";
      if (category === "working" && statusFilter === "all") params.status = "in_progress";
    }
    if (createdFrom) {
      const date = new Date(`${createdFrom}T00:00:00`);
      if (!Number.isNaN(date.getTime())) params.from = date.toISOString();
    }
    if (createdTo) {
      const date = new Date(`${createdTo}T23:59:59.999`);
      if (!Number.isNaN(date.getTime())) params.to = date.toISOString();
    }
    return params;
  }, [scope, sort, search, statusFilter, priorityFilter, assigneeFilter, category, createdFrom, createdTo]);
  const {
    items: tasks,
    total: tasksTotal,
    page: currentPage,
    pageCount: totalPages,
    isLoading,
    isFetching,
    isError,
    error: tasksError,
    refetch,
    setPage,
  } = useServerArrayPage<Task>("/api/tasks", { params: filterParams, resetKey: JSON.stringify(filterParams) });
  const {
    data: overviewTasks = [],
    isLoading: overviewLoading,
    isError: overviewError,
    refetch: refetchOverview,
  } = useQuery<Task[]>({
    queryKey: ["/api/tasks", { all: true, scope }],
    queryFn: async () => {
      const params = new URLSearchParams({ all: "true", scope });
      const response = await fetch(`/api/tasks?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load task statistics");
      return response.json();
    },
  });
  const { data: agents = [] } = useQuery<Agent[]>({ queryKey: ["/api/users"] });
  const { data: clients = [] } = useQuery<Array<{ id: number; name: string }>>({ queryKey: ["/api/clients", { all: true }] });

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: { title: "", description: "", type: "task", priority: "medium", status: "todo", dueDate: "", progress: 0, assignedTo: user?.role === "employee" ? user.id : null },
  });

  const createTaskMutation = useMutation({
    mutationFn: async (data: TaskFormData) => {
      const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(data) });
      if (!response.ok) throw new Error("Failed to create task");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setIsTaskDialogOpen(false);
      form.reset();
      toast({ title: "Task created", description: "The work item is now in the queue." });
    },
    onError: () => toast({ title: "Could not create task", description: "Try again in a moment.", variant: "destructive" }),
  });
  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: number; updates: Partial<TaskFormData> }) => {
      const response = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(updates) });
      if (!response.ok) throw new Error("Failed to update task");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setEditingTask(null);
      setIsTaskDialogOpen(false);
      form.reset();
      toast({ title: "Task updated", description: "Your changes have been saved." });
    },
    onError: () => toast({ title: "Could not update task", description: "Try again in a moment.", variant: "destructive" }),
  });
  const deleteTaskMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/tasks/${id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Failed to delete task");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task deleted", description: "The work item was removed." });
    },
    onError: () => toast({ title: "Could not delete task", description: "Try again in a moment.", variant: "destructive" }),
  });

  function openCreateDialog(taskType?: string) {
    setEditingTask(null);
    form.reset({ title: "", description: "", type: (taskType as TaskFormData["type"]) || "task", priority: "medium", status: "todo", dueDate: "", progress: 0, assignedTo: user?.role === "employee" ? user.id : null });
    setAgentSearch("");
    setAssigneePickerOpen(false);
    setIsTaskDialogOpen(true);
  }
  function openEditDialog(task: Task) {
    setEditingTask(task);
    form.reset({
      title: task.title, description: task.description || "", type: task.type as TaskFormData["type"],
      priority: task.priority as TaskFormData["priority"], status: task.status as TaskFormData["status"],
      dueDate: taskDueDate(task.dueDate) || "", clientId: task.clientId ?? undefined, assignedTo: task.assignedTo ?? null, progress: task.progress || 0,
    });
    setAgentSearch("");
    // Mount the modal's focus/pointer layer before opening its nested picker.
    setAssigneePickerOpen(false);
    setIsTaskDialogOpen(true);
  }
  function onSubmit(data: TaskFormData) {
    if (editingTask) {
      const updates: Partial<TaskFormData> = { ...data };
      if (!isManager) delete updates.assignedTo;
      updateTaskMutation.mutate({ id: editingTask.id, updates });
    } else createTaskMutation.mutate(data);
  }
  function updateTaskStatus(task: Task, status: string) {
    updateTaskMutation.mutate({ id: task.id, updates: { status: status as TaskFormData["status"] } });
  }
  async function updateProgress(taskId: number, progress: number) {
    const response = await fetch(`/api/tasks/${taskId}/progress`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ progress }) });
    if (!response.ok) {
      toast({ title: "Progress not saved", description: "Try again in a moment.", variant: "destructive" });
      throw new Error("Failed to update progress");
    }
    await queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  }
  function requestDelete(task: Task) {
    if (window.confirm(`Delete “${task.title}”? This cannot be undone.`)) deleteTaskMutation.mutate(task.id);
  }

  const taskIdFromQuery = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("taskId");
  const { data: taskFromDeepLink } = useQuery<Task>({
    queryKey: ["/api/tasks", "focus", taskIdFromQuery],
    enabled: !!taskIdFromQuery && /^\d+$/.test(taskIdFromQuery) && !tasks.some(task => task.id === Number(taskIdFromQuery)),
    queryFn: async () => {
      const response = await fetch(`/api/tasks/${taskIdFromQuery}`, { credentials: "include" });
      if (!response.ok) throw new Error("Could not load the requested task.");
      return response.json();
    },
  });
  useEffect(() => {
    if (!taskIdFromQuery || isLoading || handledTaskQuery.current === taskIdFromQuery || !/^\d+$/.test(taskIdFromQuery)) return;
    if (isManager && scope !== "all") { setScope("all"); return; }
    const task = tasks.find(item => item.id === Number(taskIdFromQuery)) ?? taskFromDeepLink;
    if (!task) return;
    handledTaskQuery.current = taskIdFromQuery;
    openEditDialog(task);
  }, [taskIdFromQuery, isLoading, tasks, taskFromDeepLink, isManager, scope]);

  const activeTasks = tasks.filter(task => task.status !== "completed");
  const completedTasks = tasks.filter(task => task.status === "completed");
  const showCompletedAsPrimary = statusFilter === "completed";
  const primaryTasks = activeTasks;
  const visibleTasks = primaryTasks;
  const visibleCompleted = completedTasks;
  const hasFilters = !!search || category !== "all" || statusFilter !== "all" || assigneeFilter !== "all" || priorityFilter !== "all" || !!createdFrom || !!createdTo;
  function resetFilters() {
    setSearch(""); setCategory("all"); setStatusFilter("all"); setAssigneeFilter("all"); setPriorityFilter("all"); setCreatedFrom(""); setCreatedTo(""); setSort("due");
  }
  useEffect(() => { setCompletedExpanded(false); }, [search, category, statusFilter, assigneeFilter, priorityFilter, createdFrom, createdTo, sort, scope]);
  useEffect(() => { if (showCompletedAsPrimary) setCompletedExpanded(true); }, [showCompletedAsPrimary]);

  const agentName = (id?: string | null) => personName(agents.find(agent => agent.id === id));
  const filteredAgents = agents.filter(agent => `${agent.firstName ?? ""} ${agent.lastName ?? ""} ${agent.email ?? ""}`.toLocaleLowerCase().includes(agentSearch.toLocaleLowerCase()));

  return (
    <div className="flex h-full min-h-0 bg-[#e0e0e0]">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Tasks" subtitle="Assigned operational work · freight factoring" group="Workspace" neu />
        <NeuPageShell className="custom-scrollbar !min-h-0 flex-1 overflow-y-auto">
          <PageInsights entity="tasks" title="Task workload" />
          <div className="mx-auto w-full max-w-[1680px] space-y-5 p-4 md:p-7 xl:p-9">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#788789]">Operations / Work queue</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#354548] sm:text-3xl">Tasks</h1>
                <p className="mt-1 max-w-2xl text-sm text-[#718082]">The next operational action, assigned to a person—not another project board.</p>
              </div>
              <NeuButton variant="accent" onClick={() => openCreateDialog()} data-testid="button-create-task" className="min-h-11 rounded-xl px-4">
                <Plus className="h-4 w-4" />Create Task
              </NeuButton>
            </div>

            <TasksOverview tasks={overviewTasks} isLoading={overviewLoading} isError={overviewError} onRetry={() => void refetchOverview()} />
            {isError ? (
              <NeuCard role="alert" className="p-5 text-center">
                <p className="font-semibold text-[#8f4f47]">Tasks could not be loaded</p>
                <p className="mt-1 text-sm text-[#819092]">{tasksError instanceof Error ? tasksError.message : "Try again in a moment."}</p>
                <NeuButton onClick={() => void refetch()} className="mt-4 min-h-10 px-4 text-xs">Retry loading</NeuButton>
              </NeuCard>
            ) : (
              <>
                <NeuCard className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#7c898a]">Queue controls</p>
                      <h2 className="mt-1 text-lg font-semibold text-[#354548]">Find the next action</h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Task scope">
                      {isManager && <NeuButton onClick={() => setScope("all")} aria-pressed={scope === "all"} className={cn("min-h-9 rounded-lg px-3 text-xs", scope === "all" && "bg-[#d5e7e5] text-[#168d98]")}>All work</NeuButton>}
                      <NeuButton onClick={() => setScope("assigned-to-me")} aria-pressed={scope === "assigned-to-me"} className={cn("min-h-9 rounded-lg px-3 text-xs", scope === "assigned-to-me" && "bg-[#d5e7e5] text-[#168d98]")}>Assigned to me</NeuButton>
                      {isManager && <NeuButton onClick={() => setScope("created-by-me")} aria-pressed={scope === "created-by-me"} className={cn("min-h-9 rounded-lg px-3 text-xs", scope === "created-by-me" && "bg-[#d5e7e5] text-[#168d98]")}>Created by me</NeuButton>}
                    </div>
                  </div>
                  <NeuTabs value={category} onValueChange={value => setCategory(value as Category)} className="mt-4">
                    <NeuTabList aria-label="Task categories" className="gap-1.5 overflow-x-auto">
                      {CATEGORY_OPTIONS.map(option => <NeuTab key={option.value} value={option.value} data-testid={`tab-${option.value}`} className="min-h-9 whitespace-nowrap px-3 text-xs">{option.label}</NeuTab>)}
                    </NeuTabList>
                  </NeuTabs>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                    <label className="relative sm:col-span-2 xl:col-span-2">
                      <span className="sr-only">Search tasks by title, invoice, client, carrier, or broker</span>
                      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#829092]" />
                      <NeuInput placeholder="Task, invoice #, carrier, broker…" value={search} onChange={event => setSearch(event.target.value)} className="pl-11" data-testid="input-search-tasks" />
                    </label>
                    <label><span className="sr-only">Status</span><NeuSelect value={statusFilter} onChange={event => setStatusFilter(event.target.value)} options={[
                      { value: "all", label: "All statuses" }, { value: "open", label: "Open (unfinished)" }, { value: "in_progress", label: "In progress" }, { value: "held", label: "Held" }, { value: "completed", label: "Completed" }, { value: "overdue", label: "Overdue" },
                    ]} /></label>
                    <label><span className="sr-only">Assigned agent</span><NeuSelect value={assigneeFilter} onChange={event => setAssigneeFilter(event.target.value)} options={[{ value: "all", label: "All assignees" }, { value: "__unassigned", label: "Unassigned" }, ...agents.map(agent => ({ value: agent.id, label: personName(agent) }))]} /></label>
                    <label><span className="sr-only">Priority</span><NeuSelect value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)} options={[
                      { value: "all", label: "All priorities" }, { value: "urgent", label: "Urgent" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" },
                    ]} /></label>
                    <label><span className="sr-only">Sort tasks</span><NeuSelect value={sort} onChange={event => setSort(event.target.value)} options={[
                      { value: "due", label: "Sort: Due date" }, { value: "priority", label: "Sort: Priority" }, { value: "status", label: "Sort: Status" },
                    ]} /></label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#879294]"><CalendarDays className="h-3.5 w-3.5" />Created</span>
                    <label className="flex items-center gap-2 text-xs text-[#728082]"><span>From</span><NeuInput aria-label="Created from date" type="date" value={createdFrom} onChange={event => setCreatedFrom(event.target.value)} className="min-h-9 w-auto px-3 py-1.5 text-xs" /></label>
                    <label className="flex items-center gap-2 text-xs text-[#728082]"><span>To</span><NeuInput aria-label="Created through date" type="date" value={createdTo} onChange={event => setCreatedTo(event.target.value)} className="min-h-9 w-auto px-3 py-1.5 text-xs" /></label>
                    {hasFilters && <NeuButton onClick={resetFilters} className="min-h-9 rounded-lg px-3 text-xs"><X className="h-3.5 w-3.5" />Clear filters</NeuButton>}
                    <span className="ml-auto text-xs text-[#819092]">{tasksTotal.toLocaleString()} matching {tasksTotal === 1 ? "task" : "tasks"}</span>
                  </div>
                </NeuCard>

                <section aria-label="Task list" className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                    <div>
                    <h2 className="text-base font-semibold text-[#354548]">{showCompletedAsPrimary ? "Completed work" : "Open work"}</h2>
                      <p className="mt-0.5 text-xs text-[#839092]">{showCompletedAsPrimary ? "Completed tasks matching your filters" : "Unfinished work, including held and in-progress items"}</p>
                    </div>
                    <NeuBadge>{showCompletedAsPrimary ? completedTasks.length : primaryTasks.length} {showCompletedAsPrimary ? "completed" : "open"} on this page</NeuBadge>
                  </div>

                  {isLoading ? (
                    <div className="space-y-3" aria-label="Loading tasks">
                      {[0, 1, 2].map(item => <NeuCard key={item} className="animate-pulse p-5"><div className="h-4 w-2/5 rounded-full bg-[#c7c7c7]" /><div className="mt-3 h-3 w-4/5 rounded-full bg-[#d0d0d0]" /><div className="mt-5 h-3 w-1/3 rounded-full bg-[#d0d0d0]" /></NeuCard>)}
                    </div>
                  ) : visibleTasks.length ? (
                    <div className="space-y-3">
                      {visibleTasks.map(task => <TaskCard key={task.id} task={task} completed={showCompletedAsPrimary} isManager={isManager} onEdit={openEditDialog} onDelete={requestDelete} onStatus={updateTaskStatus} onProgress={updateProgress} onOpenDetail={task => navigate(`/tasks/${task.id}`)} />)}
                    </div>
                  ) : showCompletedAsPrimary && completedTasks.length > 0 ? null : (
                    <NeuCard className="px-5 py-12 text-center">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e0e0e0] text-[#7b898b] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#ffffff]">
                        {hasFilters ? <SlidersHorizontal className="h-6 w-6" /> : <ListTodo className="h-6 w-6" />}
                      </div>
                      <h3 className="mt-4 text-base font-semibold text-[#354548]">{hasFilters ? "No tasks match these filters" : "No open tasks"}</h3>
                      <p className="mt-1 text-sm text-[#819092]">{hasFilters ? "Adjust the search or clear filters to see more work." : "Create one or check back later."}</p>
                      {hasFilters ? <NeuButton onClick={resetFilters} className="mt-4 min-h-10 px-4 text-xs">Clear filters</NeuButton> : <NeuButton variant="accent" onClick={() => openCreateDialog()} className="mt-4 min-h-10 px-4 text-xs"><Plus className="h-4 w-4" />Create task</NeuButton>}
                    </NeuCard>
                  )}

                  {completedTasks.length > 0 && (
                    <NeuCard pressed className="p-4 sm:p-5">
                      <button type="button" onClick={() => setCompletedExpanded(value => !value)} aria-expanded={completedExpanded} className="flex w-full items-center justify-between gap-3 text-left">
                        <span className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#d2d9d8] text-[#718082]"><CheckSquare className="h-4 w-4" /></span><span><span className="block text-sm font-semibold text-[#526164]">{showCompletedAsPrimary ? "Completed work" : "Show completed"}</span><span className="mt-0.5 block text-xs text-[#879294]">{completedTasks.length} finished {completedTasks.length === 1 ? "task" : "tasks"}</span></span></span>
                        {completedExpanded ? <ChevronDown className="h-4 w-4 text-[#839092]" /> : <ChevronRight className="h-4 w-4 text-[#839092]" />}
                      </button>
                      {completedExpanded && <div className="mt-4 space-y-3">{visibleCompleted.map(task => <TaskCard key={task.id} task={task} completed isManager={isManager} onEdit={openEditDialog} onDelete={requestDelete} onStatus={updateTaskStatus} onProgress={updateProgress} onOpenDetail={task => navigate(`/tasks/${task.id}`)} />)}</div>}
                    </NeuCard>
                  )}
                  <ServerArrayPagination
                    page={currentPage}
                    pageCount={totalPages}
                    total={tasksTotal}
                    onPageChange={setPage}
                    disabled={isFetching}
                  />
                </section>
              </>
            )}
          </div>
        </NeuPageShell>

        <Dialog open={isTaskDialogOpen} onOpenChange={open => {
          setIsTaskDialogOpen(open);
          if (!open) { setAssigneePickerOpen(false); setAgentSearch(""); }
        }}>
          <DialogContent showCloseButton={false} className="!max-h-[92dvh] !rounded-2xl !border-0 !bg-[#e0e0e0] !text-[#354548] !shadow-[9px_9px_20px_#b8b8b8,-9px_-9px_20px_#ffffff] sm:!max-w-[640px]" data-testid="task-edit-dialog">
            <DialogClose asChild>
              <NeuButton aria-label="Close task dialog" className="absolute right-4 top-4 !h-8 !min-h-8 !w-8 !rounded-full !p-0 !text-[#718082]">
                <X className="h-4 w-4" />
              </NeuButton>
            </DialogClose>
            <DialogHeader>
              <DialogTitle className="text-xl text-[#354548]">{editingTask ? "Edit task" : "Create a task"}</DialogTitle>
              <DialogDescription className="text-[#728082]">{editingTask ? "Update the assignment and operational details." : "Capture the next action and assign clear ownership."}</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField control={form.control} name="title" render={({ field }) => <FormItem><FormLabel className="text-[#526164]">Title</FormLabel><FormControl><NeuInput placeholder="e.g. Verify carrier invoice backup" {...field} className="placeholder:text-[#929b9c]" /></FormControl><FormMessage /></FormItem>} />
                <FormField control={form.control} name="description" render={({ field }) => <FormItem><FormLabel className="text-[#526164]">Description</FormLabel><FormControl><Textarea placeholder="Add the context needed to complete the work…" rows={3} {...field} className="!resize-y !rounded-xl !border-0 !bg-[#e0e0e0] !text-[#354548] !shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff] placeholder:!text-[#929b9c]" /></FormControl><FormMessage /></FormItem>} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField control={form.control} name="type" render={({ field }) => <FormItem><FormLabel className="text-[#526164]">Work type</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger className="!min-h-11 !rounded-xl !border-0 !bg-[#e0e0e0] !text-[#354548] !shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff]"><SelectValue placeholder="Select type" /></SelectTrigger></FormControl><SelectContent><SelectItem value="chargeback">Chargeback</SelectItem><SelectItem value="followup">Follow-up</SelectItem><SelectItem value="call">Call</SelectItem><SelectItem value="processing">Processing</SelectItem><SelectItem value="task">Manual task</SelectItem></SelectContent></Select><FormMessage /></FormItem>} />
                  <FormField control={form.control} name="priority" render={({ field }) => <FormItem><FormLabel className="text-[#526164]">Priority</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger className="!min-h-11 !rounded-xl !border-0 !bg-[#e0e0e0] !text-[#354548] !shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff]"><SelectValue placeholder="Select priority" /></SelectTrigger></FormControl><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="urgent">Urgent</SelectItem></SelectContent></Select><FormMessage /></FormItem>} />
                  <FormField control={form.control} name="status" render={({ field }) => <FormItem><FormLabel className="text-[#526164]">Status</FormLabel><Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger className="!min-h-11 !rounded-xl !border-0 !bg-[#e0e0e0] !text-[#354548] !shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff]"><SelectValue placeholder="Select status" /></SelectTrigger></FormControl><SelectContent><SelectItem value="todo">Open</SelectItem><SelectItem value="in_progress">In progress</SelectItem><SelectItem value="held">Held</SelectItem><SelectItem value="completed">Completed</SelectItem></SelectContent></Select><FormMessage /></FormItem>} />
                  <FormField control={form.control} name="dueDate" render={({ field }) => <FormItem><FormLabel className="text-[#526164]">Due date</FormLabel><FormControl><NeuInput type="date" {...field} /></FormControl><FormMessage /></FormItem>} />
                </div>
                <FormField control={form.control} name="clientId" render={({ field }) => <FormItem><FormLabel className="text-[#526164]">Client (optional)</FormLabel><Select onValueChange={value => field.onChange(value === "none" ? undefined : Number(value))} value={field.value?.toString() ?? "none"}><FormControl><SelectTrigger className="!min-h-11 !rounded-xl !border-0 !bg-[#e0e0e0] !text-[#354548] !shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff]"><SelectValue placeholder="Choose a client" /></SelectTrigger></FormControl><SelectContent><SelectItem value="none">No client</SelectItem>{clients.map(client => <SelectItem key={client.id} value={client.id.toString()}>{client.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>} />
                <FormField control={form.control} name="assignedTo" render={({ field }) => <FormItem><FormLabel className="text-[#526164]">Assigned to</FormLabel><Popover open={assigneePickerOpen} onOpenChange={open => { setAssigneePickerOpen(open); if (!open) setAgentSearch(""); }}><PopoverTrigger asChild><FormControl><NeuButton type="button" disabled={!isManager} className="!min-h-11 w-full justify-start !rounded-xl !border-0 !bg-[#e0e0e0] !text-[#526164] !shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#ffffff]">{field.value ? agentName(field.value) : "Unassigned"}</NeuButton></FormControl></PopoverTrigger><PopoverContent className="w-[--radix-popover-trigger-width] !border-0 !bg-[#e0e0e0] p-2 !text-[#354548] !shadow-[7px_7px_16px_#b8b8b8,-7px_-7px_16px_#ffffff]"><NeuInput value={agentSearch} onChange={event => setAgentSearch(event.target.value)} placeholder="Search people…" className="mb-2 !rounded-lg" /><div className="max-h-56 space-y-1 overflow-y-auto"><button type="button" onClick={() => { field.onChange(null); setAssigneePickerOpen(false); setAgentSearch(""); }} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[#d4e6e5]">Unassigned</button>{filteredAgents.map(agent => <button type="button" key={agent.id} onClick={() => { field.onChange(agent.id); setAssigneePickerOpen(false); setAgentSearch(""); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[#d4e6e5]"><Avatar className="h-7 w-7"><AvatarImage src={agent.profileImageUrl || undefined} /><AvatarFallback className="bg-[#d1e4e2] text-[10px] text-[#347d69]">{personInitials(agent)}</AvatarFallback></Avatar><span>{personName(agent)}</span></button>)}</div></PopoverContent></Popover>{!isManager && <p className="text-xs text-[#879294]">Assignments are managed by your team lead.</p>}<FormMessage /></FormItem>} />
                <FormField control={form.control} name="progress" render={({ field }) => <FormItem><FormLabel className="text-[#526164]">Progress · {field.value || 0}%</FormLabel><FormControl><Slider min={0} max={100} step={1} value={[field.value || 0]} onValueChange={([value]) => field.onChange(value)} /></FormControl><FormMessage /></FormItem>} />
                <div className="flex justify-end gap-2 border-t border-[#c7c7c7] pt-4">
                  <NeuButton type="button" onClick={() => setIsTaskDialogOpen(false)} className="min-h-10 rounded-lg px-4 text-xs">Cancel</NeuButton>
                  <NeuButton variant="accent" type="submit" disabled={createTaskMutation.isPending || updateTaskMutation.isPending} className="min-h-10 rounded-lg px-4 text-xs">
                    {(createTaskMutation.isPending || updateTaskMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
                    {editingTask ? "Save changes" : "Create task"}
                  </NeuButton>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
