import { useState, useEffect, useId } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import { NeuBadge as Badge, NeuButton as Button, NeuCard as Card, NeuInput as Input } from "@/styles/neu/components";
import {
  AlertTriangle,
  Clock3,
  Play,
  Square,
  Timer,
  CalendarDays,
  PauseCircle,
} from "lucide-react";

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
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatShortTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDurationFromStart(startTime: string, now: Date) {
  const start = new Date(startTime);
  const duration = now.getTime() - start.getTime();

  const hours = Math.floor(duration / (1000 * 60 * 60));
  const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((duration % (1000 * 60)) / 1000);

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export default function TimeClock() {
  const { toast } = useToast();
  const notesId = useId();
  const [notes, setNotes] = useState("");
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const { data: timeStatus, isLoading, isError, error, refetch, isFetching } = useQuery<TimeTrackingStatus>({
    queryKey: ["/api/time-tracking/status"],
    refetchInterval: 30000,
  });

  const clockInMutation = useMutation({
    mutationFn: async (sessionNotes: string) => {
      const response = await apiRequest("POST", "/api/time-tracking/clock-in", {
        notes: sessionNotes,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Clocked In",
        description: "You have successfully clocked in.",
      });
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent-activities"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
        return;
      }

      toast({
        title: "Error",
        description: error.message || "Failed to clock in",
        variant: "destructive",
      });
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async (sessionNotes: string) => {
      const response = await apiRequest("POST", "/api/time-tracking/clock-out", {
        notes: sessionNotes,
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Clocked Out",
        description: "You have successfully clocked out.",
      });
      setNotes("");
      queryClient.invalidateQueries({ queryKey: ["/api/time-tracking/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent-activities"] });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
        return;
      }

      toast({
        title: "Error",
        description: error.message || "Failed to clock out",
        variant: "destructive",
      });
    },
  });

  const handleClockIn = () => {
    clockInMutation.mutate(notes.trim());
  };

  const handleClockOut = () => {
    clockOutMutation.mutate(notes.trim());
  };

  if (isLoading) {
    return (
      <Card className="rounded-2xl p-5">
        <div className="border-b border-[#c9c9c9] pb-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[#333]">
            <Clock3 className="h-5 w-5" />
            Time Clock
          </h2>
        </div>

        <div className="pt-5">
          <div className="animate-pulse space-y-4">
            <div className="h-24 animate-pulse rounded-[18px] bg-[#d2d2d2]" />
            <div className="h-16 animate-pulse rounded-[18px] bg-[#d2d2d2]" />
            <div className="h-10 animate-pulse rounded-xl bg-[#d2d2d2]" />
          </div>
        </div>
      </Card>
    );
  }

  if (isError) {
    const message = error instanceof Error
      ? error.message
      : "Time clock status is temporarily unavailable.";
    return (
      <Card className="rounded-2xl p-5" role="alert">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#a45e45]" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-[#333]">Time clock unavailable</h2>
            <p className="mt-1 text-sm text-[#777]">{message}</p>
            <Button
              type="button"
              variant="accent"
              onClick={() => refetch()}
              disabled={isFetching}
              className="mt-4"
              data-testid="time-clock-retry"
            >
              {isFetching ? "Retrying..." : "Retry"}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  const isClockedIn = Boolean(timeStatus?.isClocked && timeStatus?.currentEntry);
  const isSubmitting = clockInMutation.isPending || clockOutMutation.isPending;

  return (
    <Card className="rounded-2xl">
      <div className="border-b border-[#c9c9c9] p-5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-[#333]">
            <Clock3 className="h-5 w-5 text-[#777]" />
            Time Clock
          </h2>
          <p className="mt-1 text-sm text-[#888]">
            Track work sessions and daily hours
          </p>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="rounded-2xl bg-[#e0e0e0] p-5 text-center shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#fff]">
          <div className="font-mono text-[2rem] font-semibold tracking-tight text-[#333]">
            {formatClockTime(currentTime)}
          </div>
          <div className="mt-1 text-sm text-[#888]">
            {currentTime.toLocaleDateString([], {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#e0e0e0] p-4 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">
          <div className="flex items-center gap-2">
            {isClockedIn ? (
              <Badge tone="success">
                <Timer className="mr-1 h-3 w-3" />
                Clocked In
              </Badge>
            ) : (
              <Badge tone="neutral">
                <PauseCircle className="mr-1 h-3 w-3" />
                Clocked Out
              </Badge>
            )}
          </div>

          {isClockedIn && timeStatus?.currentEntry && (
            <div className="text-right">
              <div className="text-xs text-[#888]">Started at</div>
              <div className="font-mono text-sm font-semibold text-[#333]">
                {formatShortTime(timeStatus.currentEntry.clockInTime)}
              </div>
            </div>
          )}
        </div>

        {isClockedIn && timeStatus?.currentEntry ? (
          <div className="rounded-2xl bg-[#e0e0e0] p-5 text-center shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#fff]">
            <div className="mb-1 text-sm font-medium text-[#888]">
              Active session
            </div>
            <div className="font-mono text-3xl font-semibold tracking-tight text-[#333]">
              {formatDurationFromStart(timeStatus.currentEntry.clockInTime, currentTime)}
            </div>
            <div className="mt-1 text-xs text-[#888]">
              Currently tracking live work time
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-[#e0e0e0] p-5 text-center shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#fff]">
            <div className="mb-1 text-sm font-medium text-[#888]">
              Status
            </div>
            <div className="text-lg font-semibold text-[#333]">
              Currently Clocked Out
            </div>
            <div className="mt-1 text-xs text-[#888]">
              Start a session to begin tracking time
            </div>
          </div>
        )}

        <div className="flex items-center justify-between rounded-2xl bg-[#e0e0e0] p-4 shadow-[-4px_-4px_9px_#fff,4px_4px_9px_#c1c1c1]">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-[#888]" />
            <span className="text-sm font-medium text-[#666]">
              Today&apos;s Total
            </span>
          </div>
          <div className="font-mono text-sm font-semibold text-[#333]">
            {timeStatus?.todayHours?.toFixed(2) ?? "0.00"} hours
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor={notesId}
            className="text-sm font-medium text-[#555]"
          >
            Notes
          </label>
          <Input
            id={notesId}
            placeholder="Add a note about your work session..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="h-11 rounded-xl"
          />
        </div>

        <div>
          {isClockedIn ? (
            <Button
              type="button"
              onClick={handleClockOut}
              disabled={clockOutMutation.isPending}
              variant="destructive"
              className="h-11 w-full rounded-xl"
            >
              <Square className="mr-2 h-4 w-4" />
              {clockOutMutation.isPending ? "Clocking Out..." : "Clock Out"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleClockIn}
              disabled={clockInMutation.isPending}
              variant="accent"
              className="h-11 w-full rounded-xl"
            >
              <Play className="mr-2 h-4 w-4" />
              {clockInMutation.isPending ? "Clocking In..." : "Clock In"}
            </Button>
          )}
        </div>

        {timeStatus?.todayEntries && timeStatus.todayEntries.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-[#333]">
              Today&apos;s Entries
            </h4>

            <div className="custom-scrollbar max-h-40 space-y-2 overflow-y-auto pr-1">
              {timeStatus.todayEntries.slice(0, 4).map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between rounded-xl bg-[#e0e0e0] p-3 shadow-[4px_4px_8px_#c1c1c1,-4px_-4px_8px_#fff]"
                >
                  <div className="min-w-0 text-xs text-[#666]">
                    <span className="font-medium text-[#333]">
                      {formatShortTime(entry.clockInTime)}
                    </span>

                    {entry.clockOutTime && (
                      <span className="text-[#888]">
                        {" "}
                        - {formatShortTime(entry.clockOutTime)}
                      </span>
                    )}
                  </div>

                  {entry.totalHours && (
                    <div
                      className="rounded-full bg-[#e0e0e0] px-2.5 py-1 text-xs font-medium text-[#555] shadow-[-3px_-3px_7px_#fff,3px_3px_7px_#c1c1c1]"
                    >
                      {parseFloat(entry.totalHours).toFixed(2)}h
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {isSubmitting && (
          <p className="text-center text-xs text-[#888]">
            Updating time entry...
          </p>
        )}
      </div>
    </Card>
  );
}