import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle, Button, AdminPageShell } from "@/components/admin-neu/adapters";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import EntityNotes from "@/components/shared/EntityNotes";
import { PageInsights } from "@/components/PageInsights";
import "@/components/admin-neu/admin-neu-page.css";

type Task = {
  id: number; title: string; description?: string; type: string; priority: string;
  status: string; dueDate?: string | null; assignedTo?: string | null; progress: number;
  progressUpdatedAt?: string | null; assignedAgent?: { firstName?: string; lastName?: string; profileImageUrl?: string } | null;
  progressUpdater?: { firstName?: string; lastName?: string; profileImageUrl?: string } | null;
  creator?: { firstName?: string; lastName?: string } | null; createdAt?: string | null;
};
const name = (person?: { firstName?: string; lastName?: string } | null) => person ? [person.firstName, person.lastName].filter(Boolean).join(" ") || "Unknown user" : "Unassigned";

export default function TaskDetail() {
  const [, params] = useRoute("/tasks/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [draftProgress, setDraftProgress] = useState(0);
  const { data: task, isLoading, isError } = useQuery<Task>({
    queryKey: ["/api/tasks", params?.id],
    queryFn: async () => {
      const response = await fetch(`/api/tasks/${params?.id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load task");
      return response.json();
    },
  });
  useEffect(() => {
    if (task) setDraftProgress(task.progress);
  }, [task?.id, task?.progress]);
  const saveProgress = async (value: number) => {
    setSaving(true);
    try {
      const response = await fetch(`/api/tasks/${params?.id}/progress`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ progress: value }) });
      if (!response.ok) throw new Error("Unable to save progress");
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      if (value === 100 && task?.status !== "completed" && window.confirm("Mark this task as complete?")) {
        const complete = await fetch(`/api/tasks/${params?.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ status: "completed" }) });
        if (!complete.ok) throw new Error("Unable to complete task");
      }
    } catch (error) {
      toast({ title: "Error", description: error instanceof Error ? error.message : "Could not save progress", variant: "destructive" });
    } finally { setSaving(false); queryClient.invalidateQueries({ queryKey: ["/api/tasks", params?.id] }); }
  };
  if (isLoading) return <div className="flex min-h-[100dvh] items-center justify-center bg-[#e0e0e0] p-10"><Card className="w-full max-w-4xl space-y-4 p-6"><div className="h-6 w-1/2 animate-pulse rounded bg-[#d2d2d2]" /><div className="h-32 animate-pulse rounded-xl bg-[#d2d2d2]" /></Card></div>;
  if (isError || !task) return <div className="flex min-h-[100dvh] items-center justify-center bg-[#e0e0e0] p-6"><Card className="max-w-md p-8 text-center text-[#a3483e]">Task not found or unavailable.</Card></div>;
  return <div className="ff-admin-page flex min-h-[100dvh] bg-[#e0e0e0]"><Sidebar /><div className="flex min-w-0 flex-1 flex-col overflow-hidden"><TopNav title="Task Details" subtitle="Track task progress" group="Workspace" /><AdminPageShell className="flex-1 overflow-auto !min-h-0 p-6"><div className="mx-auto max-w-4xl space-y-6"><PageInsights entity="tasks" entityId={task.id} title="Task activity" />
    <Button variant="outline" onClick={() => navigate("/tasks")}>Back to tasks</Button>
     <Card><CardHeader><CardTitle className="text-2xl">{task.title}</CardTitle><p className="text-muted-foreground">{task.description || "No description provided."}</p></CardHeader><CardContent className="space-y-6">
      <div><div className="mb-2 flex justify-between text-sm font-medium"><span>Progress</span><span>{draftProgress}%</span></div><Progress value={draftProgress} className="h-5" /><Slider className="mt-5" min={0} max={100} step={1} value={[draftProgress]} disabled={saving} onValueChange={([value]) => setDraftProgress(value)} onValueCommit={([value]) => saveProgress(value)} /><p className="mt-2 text-xs text-muted-foreground">{saving ? "Saving…" : "Changes save immediately"}</p></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Assigned to</p><div className="mt-1 flex items-center gap-2"><Avatar className="h-8 w-8"><AvatarImage src={task.assignedAgent?.profileImageUrl} /><AvatarFallback>{name(task.assignedAgent).slice(0, 2).toUpperCase()}</AvatarFallback></Avatar>{name(task.assignedAgent)}</div></div><div><p className="text-xs text-muted-foreground">Created by</p><p>{name(task.creator)}</p></div><div><p className="text-xs text-muted-foreground">Status</p><p className="capitalize">{task.status.replace("_", " ")}</p></div><div><p className="text-xs text-muted-foreground">Priority / Type</p><p className="capitalize">{task.priority} · {task.type}</p></div><div><p className="text-xs text-muted-foreground">Last progress update</p><p>{task.progressUpdatedAt ? new Date(task.progressUpdatedAt).toLocaleString() : "Not updated yet"}{task.progressUpdater ? ` by ${name(task.progressUpdater)}` : ""}</p></div><div><p className="text-xs text-muted-foreground">Due date</p><p>{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date"}</p></div></div>
     </CardContent></Card>
     <EntityNotes key={`task:${task.id}`} entityType="task" entityId={task.id} />
   </div></AdminPageShell></div></div>;
}