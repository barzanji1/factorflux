import { useEffect, useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import { NeuButton as Button, NeuCard as Card, NeuInput as Input } from "@/styles/neu/components";
import { Clock3, MessageSquareText, Play, Square } from "lucide-react";

interface TimeEntry {
  id: number;
  clockInTime: string;
  clockOutTime?: string;
  totalHours?: string;
  status: "clocked_in" | "clocked_out";
  notes?: string;
}

interface TimeTrackingStatus {
  isClocked: boolean;
  currentEntry?: TimeEntry;
  todayEntries: TimeEntry[];
  todayHours: number;
}

function formatClockTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDurationFromStart(startTime: string, now: Date) {
  const duration = Math.max(0, now.getTime() - new Date(startTime).getTime());
  const hours = Math.floor(duration / (1000 * 60 * 60));
  const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

export default function TimeClock() {
  const { toast } = useToast();
  const notesId = useId();
  const [notes, setNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const { data: timeStatus, isLoading, isError, error, refetch, isFetching } = useQuery<TimeTrackingStatus>({
    queryKey: ["/api/time-tracking/status"],
    refetchInterval: 30000,
  });

  const clockInMutation = useMutation({
    mutationFn: async (sessionNotes: string) => {
      const response = await apiRequest("POST", "/api/time-tracking/clock-in", { notes: sessionNotes });
      return response.json();
    },
    onSuccess: async () => {
      setNotes("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/status"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent-activities"] }),
      ]);
      toast({ title: "Clocked In", description: "You have successfully clocked in." });
    },
    onError: (mutationError: Error) => {
      if (isUnauthorizedError(mutationError)) {
        toast({ title: "Unauthorized", description: "You are logged out. Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: mutationError.message || "Failed to clock in", variant: "destructive" });
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async (sessionNotes: string) => {
      const response = await apiRequest("POST", "/api/time-tracking/clock-out", { notes: sessionNotes });
      return response.json();
    },
    onSuccess: async () => {
      setNotes("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/status"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent-activities"] }),
      ]);
      toast({ title: "Clocked Out", description: "You have successfully clocked out." });
    },
    onError: (mutationError: Error) => {
      if (isUnauthorizedError(mutationError)) {
        toast({ title: "Unauthorized", description: "You are logged out. Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: mutationError.message || "Failed to clock out", variant: "destructive" });
    },
  });

  const isClockedIn = Boolean(timeStatus?.isClocked && timeStatus.currentEntry);
  const isSubmitting = clockInMutation.isPending || clockOutMutation.isPending;
  const clockAction = () => {
    if (isClockedIn) clockOutMutation.mutate(notes.trim());
    else clockInMutation.mutate(notes.trim());
  };

  return (
    <Card
      data-testid="time-clock-strip"
      className="w-full rounded-2xl px-3 py-2.5 sm:px-4 sm:py-2"
      role={isError ? "alert" : undefined}
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
        <div className="flex min-w-0 items-center justify-between gap-3 sm:flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <Clock3 className="h-[18px] w-[18px] shrink-0 text-[#168f99]" aria-hidden="true" />
            <span className="min-w-0 truncate text-xs font-semibold text-[#48534f]" data-testid="time-clock-status">
              {isLoading ? "Loading time…" : isError ? "Time clock unavailable" : isClockedIn
                ? `Clocked In · ${formatDurationFromStart(timeStatus!.currentEntry!.clockInTime, currentTime)}`
                : "Clocked Out"}
            </span>
          </div>
          <span className="shrink-0 font-mono text-xs tabular-nums text-[#89938f] sm:ml-auto" data-testid="time-clock-live">
            {formatClockTime(currentTime)}
          </span>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-end sm:gap-4">
          <span className="text-xs text-[#89938f] sm:mr-auto" data-testid="time-clock-total">
            Today: {isLoading ? "—" : isError ? "Unavailable" : `${timeStatus?.todayHours?.toFixed(2) ?? "0.00"} hrs`}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={notesOpen ? "Hide session notes" : "Add session notes"}
              aria-expanded={notesOpen}
              aria-controls={notesId}
              data-testid="time-clock-notes-toggle"
              onClick={() => setNotesOpen(open => !open)}
              className="!h-8 !min-h-8 !w-8 !rounded-lg !text-[#78847f]"
            >
              <MessageSquareText className="h-4 w-4" />
            </Button>
            {isError ? (
              <Button
                type="button"
                variant="accent"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                data-testid="time-clock-action"
                className="!min-h-8 !rounded-lg !px-3"
              >
                {isFetching ? "Retrying…" : "Retry"}
              </Button>
            ) : (
              <Button
                type="button"
                variant="accent"
                size="sm"
                onClick={clockAction}
                disabled={isLoading || isSubmitting}
                data-testid="time-clock-action"
                className={`!min-h-8 !rounded-lg !px-3 ${isClockedIn ? "!text-[#b66a16] hover:!text-[#985510]" : ""}`}
              >
                {isSubmitting ? "Updating…" : isClockedIn ? (
                  <><Square className="h-3 w-3" />Clock Out</>
                ) : (
                  <><Play className="h-3 w-3" />Clock In</>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {notesOpen && (
        <div className="mt-2 border-t border-[#c9cfcb] pt-2">
          <label htmlFor={notesId} className="sr-only">Session notes</label>
          <Input
            id={notesId}
            data-testid="time-clock-notes-input"
            placeholder="Add a note for this session"
            value={notes}
            onChange={event => setNotes(event.target.value)}
            className="!min-h-9 !rounded-lg !px-3 !py-2 text-xs"
          />
        </div>
      )}

      {isLoading && (
        <div className="sr-only" aria-live="polite">Loading time clock status</div>
      )}
      {isError && (
        <p className="mt-1 pl-7 text-[10px] text-[#a45e45]">
          {error instanceof Error ? error.message : "Time clock status is temporarily unavailable."}
        </p>
      )}
    </Card>
  );
}
