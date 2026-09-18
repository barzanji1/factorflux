import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ProcessorUser = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  profileImageUrl?: string;
  role?: string;
};

export type ProcessorRecord = {
  assignedProcessor?: string | null;
  assignedProcessorUser?: ProcessorUser | null;
};

const displayName = (person?: ProcessorUser | null) =>
  person ? [person.firstName, person.lastName].filter(Boolean).join(" ") || person.name || person.email || "Unknown user" : "Unassigned";

export function ProcessorIdentity({ person, compact = false }: { person?: ProcessorUser | null; compact?: boolean }) {
  const label = displayName(person);
  return (
    <div className={`flex min-w-0 items-center ${compact ? "gap-1.5" : "gap-2"}`}>
      <Avatar className={compact ? "h-6 w-6" : "h-8 w-8"}>
        <AvatarImage src={person?.profileImageUrl || undefined} alt="" />
        <AvatarFallback className="text-[10px]">{label === "Unassigned" ? "—" : label.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="truncate">{label}</span>
    </div>
  );
}

export function ProcessorAssignment({
  record,
  endpoint,
  queryKey,
  compact = false,
}: {
  record?: ProcessorRecord | null;
  endpoint: string;
  queryKey: unknown[];
  compact?: boolean;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canAssign = user?.role === "admin" || user?.role === "manager";
  const { data: agents = [] } = useQuery<ProcessorUser[]>({
    queryKey: ["/api/users", "processors"],
    queryFn: async () => {
      const response = await fetch("/api/users", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to load processors");
      const users = await response.json();
      return users.filter((candidate: ProcessorUser) => candidate.role && ["employee", "manager", "admin"].includes(candidate.role));
    },
    enabled: canAssign,
  });
  const mutation = useMutation({
    mutationFn: (assignedProcessor: string | null) =>
      fetch(endpoint, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedProcessor }),
      }).then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Could not update assignment");
        return response.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: queryKey.slice(0, 1) });
      toast({ title: "Processor assignment updated" });
    },
    onError: (error: Error) => toast({ title: "Assignment failed", description: error.message, variant: "destructive" }),
  });

  if (!record) return null;
  if (!canAssign) return <ProcessorIdentity person={record.assignedProcessorUser} compact={compact} />;
  return (
    <Select
      value={record.assignedProcessor || "unassigned"}
      onValueChange={(value) => mutation.mutate(value === "unassigned" ? null : value)}
      disabled={mutation.isPending}
    >
      <SelectTrigger className={compact ? "h-8 min-w-[150px] rounded-lg text-xs" : "h-10 w-full rounded-xl text-sm"}>
        <SelectValue>
          <ProcessorIdentity person={record.assignedProcessorUser} compact={compact} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="unassigned">Unassigned</SelectItem>
        {agents.map((agent) => (
          <SelectItem key={agent.id} value={agent.id}>{displayName(agent)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}