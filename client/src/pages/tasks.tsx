import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  CheckSquare,
  AlertTriangle,
  Phone,
  Pause,
  Play,
  Plus,
  Edit,
  Trash2,
  Calendar,
  User,
  ArrowRight,
  Target,
  Briefcase,
  Clock3,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { Slider } from "@/components/ui/slider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const taskFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
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

interface Task {
  id: number;
  title: string;
  description?: string;
  type: string;
  priority: string;
  status: string;
  dueDate?: string;
  clientId?: number;
  assignedTo?: string | null;
  createdBy?: string | null;
  progress: number;
  progressUpdatedAt?: string | null;
  progressUpdater?: { firstName?: string | null; lastName?: string | null; profileImageUrl?: string | null } | null;
  assignedAgent?: { id: string; firstName?: string | null; lastName?: string | null; profileImageUrl?: string | null } | null;
  creator?: { firstName?: string | null; lastName?: string | null; profileImageUrl?: string | null } | null;
  createdAt: string;
  updatedAt: string;
  client?: {
    id: number;
    name: string;
  };
}

export default function Tasks() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isManager = user?.role === "manager" || user?.role === "admin";
  const [scope, setScope] = useState<"all" | "assigned-to-me" | "created-by-me">(isManager ? "all" : "assigned-to-me");
  const [progressTask, setProgressTask] = useState<number | null>(null);
  const [progressDrafts, setProgressDrafts] = useState<Record<number, number>>({});
  const [agentSearch, setAgentSearch] = useState("");
  const [activeTab, setActiveTab] = useState("chargebacks");
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tasks = [], isLoading, isError } = useQuery<Task[]>({
    queryKey: ["/api/tasks", { scope }],
    queryFn: async () => {
      const res = await fetch(`/api/tasks?scope=${scope}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load tasks");
      return res.json();
    },
  });
  const { data: agents = [] } = useQuery<Array<{ id: string; firstName?: string; lastName?: string; email?: string; profileImageUrl?: string; role: string }>>({ queryKey: ["/api/users"] });

  const { data: clients = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["/api/clients", { all: true }],
  });

  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      type: "task",
      priority: "medium",
      status: "todo",
      progress: 0,
      assignedTo: user?.role === "employee" ? user.id : null,
    },
  });

  const todayChargebacks = tasks.filter(
    (task) =>
      task.type === "chargeback" &&
      task.createdAt &&
      new Date(task.createdAt).toDateString() === new Date().toDateString()
  );

  const todayFollowups = tasks.filter(
    (task) =>
      task.type === "followup" &&
      task.createdAt &&
      new Date(task.createdAt).toDateString() === new Date().toDateString()
  );

  const myFollowups = tasks.filter((task) => task.type === "followup");
  const heldTasks = tasks.filter((task) => task.status === "held");
  const currentlyWorking = tasks.filter((task) => task.status === "in_progress");
  const processingCalls = tasks.filter(
    (task) => task.type === "call" && task.status !== "completed"
  );
  const myTasks = tasks.filter((task) => task.type === "task");

  const createTaskMutation = useMutation({
    mutationFn: async (data: TaskFormData) => {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to create task");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setIsTaskDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Task created successfully" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create task",
        variant: "destructive",
      });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async (data: { id: number; updates: Partial<TaskFormData> }) => {
      const response = await fetch(`/api/tasks/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data.updates),
      });
      if (!response.ok) throw new Error("Failed to update task");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setEditingTask(null);
      setIsTaskDialogOpen(false);
      form.reset();
      toast({ title: "Success", description: "Task updated successfully" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update task",
        variant: "destructive",
      });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/tasks/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete task");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Success", description: "Task deleted successfully" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete task",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: TaskFormData) => {
    if (editingTask) {
      const updates: Partial<TaskFormData> = { ...data };
      if (!isManager) delete updates.assignedTo;
      updateTaskMutation.mutate({ id: editingTask.id, updates });
    } else {
      createTaskMutation.mutate(data);
    }
  };

  const openCreateDialog = (taskType?: string) => {
    setEditingTask(null);
    form.reset({
      type: (taskType as any) || "task",
      priority: "medium",
      status: "todo",
      progress: 0,
      assignedTo: user?.role === "employee" ? user.id : null,
    });
    setIsTaskDialogOpen(true);
  };

  const openEditDialog = (task: Task) => {
    setEditingTask(task);
    form.reset({
      title: task.title,
      description: task.description || "",
      type: task.type as any,
      priority: task.priority as any,
      status: task.status as any,
      dueDate: task.dueDate || "",
      clientId: task.clientId,
      assignedTo: task.assignedTo ?? null,
      progress: task.progress || 0,
    });
    setIsTaskDialogOpen(true);
  };

  const updateTaskStatus = (taskId: number, newStatus: string) => {
    updateTaskMutation.mutate({ id: taskId, updates: { status: newStatus as any } });
  };

  const updateProgress = async (taskId: number, progress: number) => {
    const response = await fetch(`/api/tasks/${taskId}/progress`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ progress }) });
    if (!response.ok) throw new Error("Failed to update progress");
    await queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };

  const agentName = (agent?: { firstName?: string | null; lastName?: string | null } | null) =>
    agent ? [agent.firstName, agent.lastName].filter(Boolean).join(" ") || "Unknown agent" : "Unassigned";
  const progressColor = (value: number) => value >= 100 ? "bg-emerald-500" : value >= 76 ? "bg-blue-500" : value >= 51 ? "bg-yellow-500" : value >= 26 ? "bg-orange-500" : "bg-red-500";

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300";
      case "high":
        return "bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300";
      case "medium":
        return "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300";
      case "low":
        return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
      default:
        return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
      case "in_progress":
        return "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300";
      case "held":
        return "bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300";
      case "todo":
        return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
      default:
        return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "chargeback":
        return <AlertTriangle className="h-4 w-4" />;
      case "followup":
        return <ArrowRight className="h-4 w-4" />;
      case "call":
        return <Phone className="h-4 w-4" />;
      case "processing":
        return <Briefcase className="h-4 w-4" />;
      default:
        return <CheckSquare className="h-4 w-4" />;
    }
  };

  const TaskTable = ({ tasks }: { tasks: Task[] }) => (
    <div className="space-y-4">
       {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
        </div>
       ) : isError ? <div className="py-16 text-center text-red-600">Unable to load tasks. Please try again.</div> : tasks.length > 0 ? (
        <div className="custom-scrollbar overflow-x-auto rounded-[20px] border border-slate-100 dark:border-slate-800">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80 dark:bg-slate-900/40">
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Client</TableHead>
                 <TableHead>Assigned To</TableHead>
                 <TableHead>Progress</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {getTypeIcon(task.type)}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900 dark:text-white">
                           <button className="text-left hover:text-blue-600" onClick={() => navigate(`/tasks/${task.id}`)}>{task.title}</button>
                        </div>
                        {task.description && (
                          <div className="max-w-[280px] truncate text-xs text-slate-500 dark:text-slate-400">
                            {task.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {task.type.replace("_", " ")}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <Badge className={cn("rounded-full px-2.5 py-1 font-semibold", getPriorityColor(task.priority))}>
                      {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <Badge className={cn("rounded-full px-2.5 py-1 font-semibold", getStatusColor(task.status))}>
                      {task.status === "in_progress"
                        ? "In Progress"
                        : task.status.charAt(0).toUpperCase() + task.status.slice(1)}
                    </Badge>
                  </TableCell>

                  <TableCell>{task.client?.name || "-"}</TableCell>
                   <TableCell>
                     <div className="flex items-center gap-2">
                       <Avatar className="h-7 w-7"><AvatarImage src={task.assignedAgent?.profileImageUrl || undefined} /><AvatarFallback>{agentName(task.assignedAgent).slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                       <span className="text-sm">{agentName(task.assignedAgent)}</span>
                     </div>
                   </TableCell>
                   <TableCell onClick={(event) => event.stopPropagation()}>
                     <Popover open={progressTask === task.id} onOpenChange={(open) => setProgressTask(open ? task.id : null)}>
                       <PopoverTrigger asChild><button className="w-32 text-left" aria-label={`Edit progress for ${task.title}`}>
                         <div className="flex items-center gap-2"><div className="h-2 w-full overflow-hidden rounded-full bg-slate-200"><div className={cn("h-full transition-all", progressColor(task.progress || 0))} style={{ width: `${task.progress || 0}%` }} /></div><span className="text-xs font-medium">{task.progress || 0}%</span></div>
                       </button></PopoverTrigger>
                       <PopoverContent className="w-64" onClick={(event) => event.stopPropagation()}>
                          <Slider
                            value={[progressDrafts[task.id] ?? task.progress ?? 0]}
                            min={0}
                            max={100}
                            step={1}
                            onValueChange={([value]) => setProgressDrafts((current) => ({ ...current, [task.id]: value }))}
                            onValueCommit={async ([value]) => {
                              try {
                                await updateProgress(task.id, value);
                                setProgressDrafts((current) => {
                                  const next = { ...current };
                                  delete next[task.id];
                                  return next;
                                });
                                setProgressTask(null);
                              } catch {
                                toast({ title: "Error", description: "Could not save progress", variant: "destructive" });
                              }
                            }}
                          />
                          <div className="mt-2 text-center text-sm">{progressDrafts[task.id] ?? task.progress ?? 0}%</div>
                       </PopoverContent>
                     </Popover>
                   </TableCell>

                  <TableCell>
                    {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "-"}
                  </TableCell>

                  <TableCell>
                    <div className="flex gap-2">
                      {task.status === "todo" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateTaskStatus(task.id, "in_progress")}
                          className="h-9 w-9 rounded-xl p-0"
                          data-testid={`button-start-${task.id}`}
                        >
                          <Play className="h-4 w-4 text-emerald-600" />
                        </Button>
                      )}

                      {task.status === "in_progress" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateTaskStatus(task.id, "held")}
                          className="h-9 w-9 rounded-xl p-0"
                          data-testid={`button-hold-${task.id}`}
                        >
                          <Pause className="h-4 w-4 text-amber-600" />
                        </Button>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditDialog(task)}
                        className="h-9 w-9 rounded-xl p-0"
                        data-testid={`button-edit-${task.id}`}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>

                      {isManager && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm("Are you sure you want to delete this task?")) {
                              deleteTaskMutation.mutate(task.id);
                            }
                          }}
                          className="h-9 w-9 rounded-xl p-0"
                          data-testid={`button-delete-${task.id}`}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="px-6 py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
            <CheckSquare className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            No tasks found
          </p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Add a task to start building this workflow queue.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Tasks" subtitle="Workflow follow-ups, calls, and team assignments" group="Workspace" />

        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8">
            {/* Header actions */}
            <section className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
                  Workflow center
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Task Management
                </h1>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Organize chargebacks, followups, calls, and active work queues
                </p>
              </div>

              <Button
                onClick={() => openCreateDialog()}
                className="h-12 rounded-2xl bg-blue-600 px-5 text-white hover:bg-blue-700"
                data-testid="button-create-task"
              >
                <Plus className="mr-2 h-4 w-4" />
                New Task
              </Button>
            </section>

            {/* Summary cards */}
            <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Today's Chargebacks</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {todayChargebacks.length}
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                  <ArrowRight className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Today's Followups</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {todayFollowups.length}
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                  <Play className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Currently Working</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {currentlyWorking.length}
                </p>
              </div>

              <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400">
                  <Phone className="h-5 w-5" />
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">Processing Calls</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  {processingCalls.length}
                </p>
              </div>
            </section>

            {/* Main card */}
            <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
              <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
                  Task Management
                </CardTitle>
                <CardDescription>
                  Organize and track your workflow across different task categories
                </CardDescription>
              </CardHeader>

              <CardContent className="p-6">
                <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Task scope">
                  {isManager && <Button variant={scope === "all" ? "default" : "outline"} onClick={() => setScope("all")}>All Tasks</Button>}
                  <Button variant={scope === "assigned-to-me" ? "default" : "outline"} onClick={() => setScope("assigned-to-me")}>My Tasks</Button>
                  {isManager && <Button variant={scope === "created-by-me" ? "default" : "outline"} onClick={() => setScope("created-by-me")}>Created by Me</Button>}
                </div>
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                  <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-[20px] bg-slate-100 p-2 md:grid-cols-4 xl:grid-cols-7 dark:bg-slate-800">
                    <TabsTrigger value="chargebacks" data-testid="tab-chargebacks" className="rounded-xl">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        <span className="text-xs">Chargebacks</span>
                      </div>
                    </TabsTrigger>

                    <TabsTrigger value="today-followups" data-testid="tab-today-followups" className="rounded-xl">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5" />
                        <span className="text-xs">Today's FU</span>
                      </div>
                    </TabsTrigger>

                    <TabsTrigger value="my-followups" data-testid="tab-my-followups" className="rounded-xl">
                      <div className="flex items-center gap-2">
                        <User className="h-3.5 w-3.5" />
                        <span className="text-xs">My FU</span>
                      </div>
                    </TabsTrigger>

                    <TabsTrigger value="held" data-testid="tab-held" className="rounded-xl">
                      <div className="flex items-center gap-2">
                        <Pause className="h-3.5 w-3.5" />
                        <span className="text-xs">Held</span>
                      </div>
                    </TabsTrigger>

                    <TabsTrigger value="working" data-testid="tab-working" className="rounded-xl">
                      <div className="flex items-center gap-2">
                        <Play className="h-3.5 w-3.5" />
                        <span className="text-xs">Working</span>
                      </div>
                    </TabsTrigger>

                    <TabsTrigger value="calls" data-testid="tab-calls" className="rounded-xl">
                      <div className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5" />
                        <span className="text-xs">Calls</span>
                      </div>
                    </TabsTrigger>

                    <TabsTrigger value="my-tasks" data-testid="tab-my-tasks" className="rounded-xl">
                      <div className="flex items-center gap-2">
                        <Target className="h-3.5 w-3.5" />
                        <span className="text-xs">My Tasks</span>
                      </div>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="chargebacks" className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-red-600" />
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                          Today's Chargebacks
                        </h3>
                        <Badge variant="destructive">{todayChargebacks.length}</Badge>
                      </div>

                      <Button onClick={() => openCreateDialog("chargeback")} size="sm" data-testid="button-add-chargeback">
                        <Plus className="mr-2 h-4 w-4" />
                        Add Chargeback
                      </Button>
                    </div>

                    <TaskTable tasks={todayChargebacks} />
                  </TabsContent>

                  <TabsContent value="today-followups" className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-blue-600" />
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                          Today's Followups
                        </h3>
                        <Badge variant="outline">{todayFollowups.length}</Badge>
                      </div>

                      <Button onClick={() => openCreateDialog("followup")} size="sm" data-testid="button-add-followup">
                        <Plus className="mr-2 h-4 w-4" />
                        Add Followup
                      </Button>
                    </div>

                    <TaskTable tasks={todayFollowups} />
                  </TabsContent>

                  <TabsContent value="my-followups" className="space-y-4">
                    <div className="flex items-center gap-2">
                      <User className="h-5 w-5 text-emerald-600" />
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                        My Followups
                      </h3>
                      <Badge variant="outline">{myFollowups.length}</Badge>
                    </div>

                    <TaskTable tasks={myFollowups} />
                  </TabsContent>

                  <TabsContent value="held" className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Pause className="h-5 w-5 text-amber-600" />
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                        Held Tasks
                      </h3>
                      <Badge variant="outline">{heldTasks.length}</Badge>
                    </div>

                    <TaskTable tasks={heldTasks} />
                  </TabsContent>

                  <TabsContent value="working" className="space-y-4">
                    <div className="flex items-center gap-2">
                      <Play className="h-5 w-5 text-emerald-600" />
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                        Currently Working On
                      </h3>
                      <Badge variant="outline">{currentlyWorking.length}</Badge>
                    </div>

                    <TaskTable tasks={currentlyWorking} />
                  </TabsContent>

                  <TabsContent value="calls" className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Phone className="h-5 w-5 text-violet-600" />
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                          Processing Calls
                        </h3>
                        <Badge variant="outline">{processingCalls.length}</Badge>
                      </div>

                      <Button onClick={() => openCreateDialog("call")} size="sm" data-testid="button-add-call">
                        <Plus className="mr-2 h-4 w-4" />
                        Add Call
                      </Button>
                    </div>

                    <TaskTable tasks={processingCalls} />
                  </TabsContent>

                  <TabsContent value="my-tasks" className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Target className="h-5 w-5 text-indigo-600" />
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                          My Tasks
                        </h3>
                        <Badge variant="outline">{myTasks.length}</Badge>
                      </div>

                      <Button onClick={() => openCreateDialog("task")} size="sm" data-testid="button-add-task">
                        <Plus className="mr-2 h-4 w-4" />
                        Add Task
                      </Button>
                    </div>

                    <TaskTable tasks={myTasks} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </main>

        <Dialog open={isTaskDialogOpen} onOpenChange={setIsTaskDialogOpen}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>{editingTask ? "Edit Task" : "Create New Task"}</DialogTitle>
              <DialogDescription>
                {editingTask ? "Update task information" : "Add a new task to your workflow"}
              </DialogDescription>
            </DialogHeader>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Task title..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Task description..." rows={3} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="chargeback">Chargeback</SelectItem>
                            <SelectItem value="followup">Followup</SelectItem>
                            <SelectItem value="call">Call</SelectItem>
                            <SelectItem value="processing">Processing</SelectItem>
                            <SelectItem value="task">Task</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select priority" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="urgent">Urgent</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="todo">To Do</SelectItem>
                            <SelectItem value="in_progress">In Progress</SelectItem>
                            <SelectItem value="held">Held</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="dueDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Due Date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="clientId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client (Optional)</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(Number(value))}
                        value={field.value?.toString()}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select client (optional)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {clients.map((client) => (
                            <SelectItem key={client.id} value={client.id.toString()}>
                              {client.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="assignedTo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assign To</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild disabled={!isManager}>
                          <FormControl>
                            <Button type="button" variant="outline" className="w-full justify-start font-normal">
                              {field.value
                                ? agentName(agents.find((agent) => agent.id === field.value))
                                : "Unassigned"}
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-2">
                          <Input
                            value={agentSearch}
                            onChange={(event) => setAgentSearch(event.target.value)}
                            placeholder="Search active agents..."
                            className="mb-2"
                          />
                          <div className="max-h-52 space-y-1 overflow-y-auto">
                            <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => field.onChange(null)}>
                              Unassigned
                            </Button>
                            {agents
                              .filter((agent) => `${agent.firstName || ""} ${agent.lastName || ""} ${agent.email || ""}`.toLowerCase().includes(agentSearch.toLowerCase()))
                              .map((agent) => (
                                <Button type="button" variant="ghost" className="w-full justify-start" key={agent.id} onClick={() => field.onChange(agent.id)}>
                                  {agentName(agent)}
                                </Button>
                              ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      {!isManager && <p className="text-xs text-muted-foreground">Employees can only assign tasks to themselves.</p>}
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="progress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Progress: {field.value || 0}%</FormLabel>
                      <FormControl><Slider min={0} max={100} step={1} value={[field.value || 0]} onValueChange={([value]) => field.onChange(value)} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsTaskDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createTaskMutation.isPending || updateTaskMutation.isPending}
                  >
                    {editingTask ? "Update Task" : "Create Task"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}