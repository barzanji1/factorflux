import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TopNav from "@/components/layout/top-nav";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { 
  CheckSquare, 
  AlertTriangle,
  Clock,
  Phone,
  Pause,
  Play,
  Plus,
  Edit,
  Trash2,
  Eye,
  Calendar,
  User,
  ArrowRight,
  Target,
  Briefcase
} from "lucide-react";

// Task form schema
const taskFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  type: z.enum(["chargeback", "followup", "call", "task", "processing"]),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  status: z.enum(["todo", "in_progress", "held", "completed"]),
  dueDate: z.string().optional(),
  clientId: z.number().optional(),
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
  assignedTo: string;
  createdAt: string;
  updatedAt: string;
  client?: {
    id: number;
    name: string;
  };
}

export default function Tasks() {
  const [activeTab, setActiveTab] = useState("chargebacks");
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch tasks and related data
  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
  });

  const { data: clients = [] } = useQuery<Array<{id: number, name: string}>>({
    queryKey: ["/api/clients"],
  });

  // Task form
  const form = useForm<TaskFormData>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      type: "task",
      priority: "medium",
      status: "todo",
    },
  });

  // Filter tasks by categories
  const todayChargebacks = tasks.filter(task => 
    task.type === "chargeback" && 
    task.createdAt && 
    new Date(task.createdAt).toDateString() === new Date().toDateString()
  );

  const todayFollowups = tasks.filter(task => 
    task.type === "followup" && 
    task.createdAt && 
    new Date(task.createdAt).toDateString() === new Date().toDateString()
  );

  const myFollowups = tasks.filter(task => task.type === "followup");
  const heldTasks = tasks.filter(task => task.status === "held");
  const currentlyWorking = tasks.filter(task => task.status === "in_progress");
  const processingCalls = tasks.filter(task => task.type === "call" && task.status !== "completed");
  const myTasks = tasks.filter(task => task.type === "task");

  // Create task mutation
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
      toast({ title: "Error", description: "Failed to create task", variant: "destructive" });
    },
  });

  // Update task mutation
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
      toast({ title: "Error", description: "Failed to update task", variant: "destructive" });
    },
  });

  // Delete task mutation
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
      toast({ title: "Error", description: "Failed to delete task", variant: "destructive" });
    },
  });

  const onSubmit = (data: TaskFormData) => {
    if (editingTask) {
      updateTaskMutation.mutate({ id: editingTask.id, updates: data });
    } else {
      createTaskMutation.mutate(data);
    }
  };

  const openCreateDialog = (taskType?: string) => {
    setEditingTask(null);
    form.reset({
      type: taskType as any || "task",
      priority: "medium",
      status: "todo",
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
    });
    setIsTaskDialogOpen(true);
  };

  const updateTaskStatus = (taskId: number, newStatus: string) => {
    updateTaskMutation.mutate({ id: taskId, updates: { status: newStatus as any } });
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent":
        return "bg-red-100 text-red-800";
      case "high":
        return "bg-orange-100 text-orange-800";
      case "medium":
        return "bg-yellow-100 text-yellow-800";
      case "low":
        return "bg-green-100 text-green-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800";
      case "in_progress":
        return "bg-blue-100 text-blue-800";
      case "held":
        return "bg-red-100 text-red-800";
      case "todo":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
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

  const TaskTable = ({ tasks, showAddButton, taskType }: { 
    tasks: Task[], 
    showAddButton?: boolean, 
    taskType?: string 
  }) => (
    <div className="space-y-4">
      {showAddButton && (
        <div className="flex justify-end">
          <Button onClick={() => openCreateDialog(taskType)} size="sm" data-testid={`button-add-${taskType}`}>
            <Plus className="h-4 w-4 mr-2" />
            Add {taskType?.charAt(0).toUpperCase() + taskType?.slice(1)}
          </Button>
        </div>
      )}
      
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center space-x-2">
                    {getTypeIcon(task.type)}
                    <span>{task.title}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {task.type.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge className={getPriorityColor(task.priority)}>
                    {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge className={getStatusColor(task.status)}>
                    {task.status === "in_progress" ? "In Progress" : 
                     task.status.charAt(0).toUpperCase() + task.status.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {task.client?.name || "-"}
                </TableCell>
                <TableCell>
                  {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "-"}
                </TableCell>
                <TableCell>
                  <div className="flex space-x-2">
                    {task.status === "todo" && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => updateTaskStatus(task.id, "in_progress")}
                        data-testid={`button-start-${task.id}`}
                      >
                        <Play className="h-4 w-4 text-green-600" />
                      </Button>
                    )}
                    {task.status === "in_progress" && (
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => updateTaskStatus(task.id, "held")}
                        data-testid={`button-hold-${task.id}`}
                      >
                        <Pause className="h-4 w-4 text-orange-600" />
                      </Button>
                    )}
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => openEditDialog(task)}
                      data-testid={`button-edit-${task.id}`}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => {
                        if (confirm("Are you sure you want to delete this task?")) {
                          deleteTaskMutation.mutate(task.id);
                        }
                      }}
                      data-testid={`button-delete-${task.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      
      {tasks.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <CheckSquare className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-500">No tasks found</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav title="Tasks" subtitle="Manage your workflow and track progress" />
      <main className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <CheckSquare className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Tasks</h1>
                <p className="text-gray-600 mt-2">Manage chargebacks, followups, calls, and assignments</p>
              </div>
            </div>
          </div>
          
          <Button onClick={() => openCreateDialog()} data-testid="button-create-task">
            <Plus className="h-4 w-4 mr-2" />
            New Task
          </Button>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Today's Chargebacks</p>
                  <p className="text-2xl font-bold text-red-600">{todayChargebacks.length}</p>
                </div>
                <AlertTriangle className="h-8 w-8 text-red-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Today's Followups</p>
                  <p className="text-2xl font-bold text-blue-600">{todayFollowups.length}</p>
                </div>
                <ArrowRight className="h-8 w-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Currently Working</p>
                  <p className="text-2xl font-bold text-green-600">{currentlyWorking.length}</p>
                </div>
                <Play className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Processing Calls</p>
                  <p className="text-2xl font-bold text-purple-600">{processingCalls.length}</p>
                </div>
                <Phone className="h-8 w-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Task Management Tabs */}
        <Card>
          <CardHeader>
            <CardTitle>Task Management</CardTitle>
            <CardDescription>Organize and track your workflow across different task types</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-7 mb-6">
                <TabsTrigger value="chargebacks" data-testid="tab-chargebacks">
                  <div className="flex items-center space-x-1">
                    <AlertTriangle className="h-3 w-3" />
                    <span className="text-xs">Chargebacks</span>
                  </div>
                </TabsTrigger>
                <TabsTrigger value="today-followups" data-testid="tab-today-followups">
                  <div className="flex items-center space-x-1">
                    <Calendar className="h-3 w-3" />
                    <span className="text-xs">Today's FU</span>
                  </div>
                </TabsTrigger>
                <TabsTrigger value="my-followups" data-testid="tab-my-followups">
                  <div className="flex items-center space-x-1">
                    <User className="h-3 w-3" />
                    <span className="text-xs">My FU</span>
                  </div>
                </TabsTrigger>
                <TabsTrigger value="held" data-testid="tab-held">
                  <div className="flex items-center space-x-1">
                    <Pause className="h-3 w-3" />
                    <span className="text-xs">Held</span>
                  </div>
                </TabsTrigger>
                <TabsTrigger value="working" data-testid="tab-working">
                  <div className="flex items-center space-x-1">
                    <Play className="h-3 w-3" />
                    <span className="text-xs">Working</span>
                  </div>
                </TabsTrigger>
                <TabsTrigger value="calls" data-testid="tab-calls">
                  <div className="flex items-center space-x-1">
                    <Phone className="h-3 w-3" />
                    <span className="text-xs">Calls</span>
                  </div>
                </TabsTrigger>
                <TabsTrigger value="my-tasks" data-testid="tab-my-tasks">
                  <div className="flex items-center space-x-1">
                    <Target className="h-3 w-3" />
                    <span className="text-xs">My Tasks</span>
                  </div>
                </TabsTrigger>
              </TabsList>

              {/* Today's Chargebacks */}
              <TabsContent value="chargebacks">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <AlertTriangle className="h-5 w-5 text-red-600" />
                      <h3 className="text-lg font-semibold text-red-700">Today's Chargebacks</h3>
                      <Badge variant="destructive">{todayChargebacks.length}</Badge>
                    </div>
                    <Button onClick={() => openCreateDialog("chargeback")} size="sm" data-testid="button-add-chargeback">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Chargeback
                    </Button>
                  </div>
                  <TaskTable tasks={todayChargebacks} />
                </div>
              </TabsContent>

              {/* Today's Followups */}
              <TabsContent value="today-followups">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Calendar className="h-5 w-5 text-blue-600" />
                      <h3 className="text-lg font-semibold text-blue-700">Today's Followups</h3>
                      <Badge variant="secondary">{todayFollowups.length}</Badge>
                    </div>
                    <Button onClick={() => openCreateDialog("followup")} size="sm" data-testid="button-add-followup">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Followup
                    </Button>
                  </div>
                  <TaskTable tasks={todayFollowups} />
                </div>
              </TabsContent>

              {/* My Followups */}
              <TabsContent value="my-followups">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <User className="h-5 w-5 text-green-600" />
                      <h3 className="text-lg font-semibold text-green-700">My Followups</h3>
                      <Badge variant="secondary">{myFollowups.length}</Badge>
                    </div>
                  </div>
                  <TaskTable tasks={myFollowups} />
                </div>
              </TabsContent>

              {/* Held */}
              <TabsContent value="held">
                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Pause className="h-5 w-5 text-orange-600" />
                    <h3 className="text-lg font-semibold text-orange-700">Held Tasks</h3>
                    <Badge variant="outline">{heldTasks.length}</Badge>
                  </div>
                  <TaskTable tasks={heldTasks} />
                </div>
              </TabsContent>

              {/* Currently Working on */}
              <TabsContent value="working">
                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Play className="h-5 w-5 text-green-600" />
                    <h3 className="text-lg font-semibold text-green-700">Currently Working On</h3>
                    <Badge variant="secondary">{currentlyWorking.length}</Badge>
                  </div>
                  <TaskTable tasks={currentlyWorking} />
                </div>
              </TabsContent>

              {/* Processing Calls */}
              <TabsContent value="calls">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Phone className="h-5 w-5 text-purple-600" />
                      <h3 className="text-lg font-semibold text-purple-700">Processing Calls</h3>
                      <Badge variant="secondary">{processingCalls.length}</Badge>
                    </div>
                    <Button onClick={() => openCreateDialog("call")} size="sm" data-testid="button-add-call">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Call
                    </Button>
                  </div>
                  <TaskTable tasks={processingCalls} />
                </div>
              </TabsContent>

              {/* My Tasks */}
              <TabsContent value="my-tasks">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Target className="h-5 w-5 text-indigo-600" />
                      <h3 className="text-lg font-semibold text-indigo-700">My Tasks</h3>
                      <Badge variant="secondary">{myTasks.length}</Badge>
                    </div>
                    <Button onClick={() => openCreateDialog("task")} size="sm" data-testid="button-add-task">
                      <Plus className="h-4 w-4 mr-2" />
                      Add Task
                    </Button>
                  </div>
                  <TaskTable tasks={myTasks} />
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>

      {/* Create/Edit Task Dialog */}
      <Dialog open={isTaskDialogOpen} onOpenChange={setIsTaskDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {editingTask ? "Edit Task" : "Create New Task"}
            </DialogTitle>
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
                      <Textarea
                        placeholder="Task description..."
                        rows={3}
                        {...field}
                      />
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
                    <Select onValueChange={(value) => field.onChange(Number(value))} value={field.value?.toString()}>
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

              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => setIsTaskDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createTaskMutation.isPending || updateTaskMutation.isPending}>
                  {editingTask ? "Update Task" : "Create Task"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}