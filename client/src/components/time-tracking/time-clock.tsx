import { useState, useEffect, useId } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Clock3,
  Play,
  Square,
  Timer,
  CalendarDays,
  PauseCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

  const { data: timeStatus, isLoading } = useQuery<TimeTrackingStatus>({
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
      <Card className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
        <CardHeader className="border-b border-slate-100 dark:border-slate-800">
          <CardTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
            <Clock3 className="h-5 w-5" />
            Time Clock
          </CardTitle>
        </CardHeader>

        <CardContent className="p-5">
          <div className="animate-pulse space-y-4">
            <div className="h-24 rounded-[18px] bg-slate-200 dark:bg-slate-700" />
            <div className="h-16 rounded-[18px] bg-slate-200 dark:bg-slate-700" />
            <div className="h-10 rounded-xl bg-slate-200 dark:bg-slate-700" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const isClockedIn = Boolean(timeStatus?.isClocked && timeStatus?.currentEntry);
  const isSubmitting = clockInMutation.isPending || clockOutMutation.isPending;

  return (
    <Card className="rounded-[20px] border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
      <CardHeader className="border-b border-slate-100 dark:border-slate-800">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900 dark:text-white">
            <Clock3 className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            Time Clock
          </CardTitle>
          <CardDescription className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Track work sessions and daily hours
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-5">
        <div className="rounded-[18px] border border-slate-200/80 bg-slate-50/70 p-5 text-center dark:border-slate-800 dark:bg-slate-900/30">
          <div className="text-[2rem] font-semibold tracking-tight text-slate-900 dark:text-white">
            {formatClockTime(currentTime)}
          </div>
          <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {currentTime.toLocaleDateString([], {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-[18px] border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/30">
          <div className="flex items-center gap-2">
            {isClockedIn ? (
              <Badge className="border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300">
                <Timer className="mr-1 h-3 w-3" />
                Clocked In
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <PauseCircle className="mr-1 h-3 w-3" />
                Clocked Out
              </Badge>
            )}
          </div>

          {isClockedIn && timeStatus?.currentEntry && (
            <div className="text-right">
              <div className="text-xs text-slate-500 dark:text-slate-400">Started at</div>
              <div className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
                {formatShortTime(timeStatus.currentEntry.clockInTime)}
              </div>
            </div>
          )}
        </div>

        {isClockedIn && timeStatus?.currentEntry ? (
          <div className="rounded-[18px] border border-slate-200/80 bg-slate-50/70 p-5 text-center dark:border-slate-800 dark:bg-slate-900/30">
            <div className="mb-1 text-sm font-medium text-slate-500 dark:text-slate-400">
              Active session
            </div>
            <div className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
              {formatDurationFromStart(timeStatus.currentEntry.clockInTime, currentTime)}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Currently tracking live work time
            </div>
          </div>
        ) : (
          <div className="rounded-[18px] border border-slate-200/80 bg-slate-50/70 p-5 text-center dark:border-slate-800 dark:bg-slate-900/30">
            <div className="mb-1 text-sm font-medium text-slate-500 dark:text-slate-400">
              Status
            </div>
            <div className="text-lg font-semibold text-slate-900 dark:text-white">
              Currently Clocked Out
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Start a session to begin tracking time
            </div>
          </div>
        )}

        <div className="flex items-center justify-between rounded-[18px] border border-slate-200/80 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/30">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Today&apos;s Total
            </span>
          </div>
          <div className="font-mono text-sm font-semibold text-slate-900 dark:text-white">
            {timeStatus?.todayHours?.toFixed(2) ?? "0.00"} hours
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor={notesId}
            className="text-sm font-medium text-slate-700 dark:text-slate-300"
          >
            Notes
          </label>
          <Input
            id={notesId}
            placeholder="Add a note about your work session..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="h-11 rounded-xl border-[hsl(var(--border))] bg-white dark:bg-slate-900"
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
              className="h-11 w-full rounded-xl bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              <Play className="mr-2 h-4 w-4" />
              {clockInMutation.isPending ? "Clocking In..." : "Clock In"}
            </Button>
          )}
        </div>

        {timeStatus?.todayEntries && timeStatus.todayEntries.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              Today&apos;s Entries
            </h4>

            <div className="custom-scrollbar max-h-40 space-y-2 overflow-y-auto pr-1">
              {timeStatus.todayEntries.slice(0, 4).map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between rounded-[18px] border border-slate-200/80 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/30"
                >
                  <div className="min-w-0 text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-medium text-slate-900 dark:text-white">
                      {formatShortTime(entry.clockInTime)}
                    </span>

                    {entry.clockOutTime && (
                      <span className="text-slate-500 dark:text-slate-400">
                        {" "}
                        - {formatShortTime(entry.clockOutTime)}
                      </span>
                    )}
                  </div>

                  {entry.totalHours && (
                    <div
                      className={cn(
                        "rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                      )}
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
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Updating time entry...
          </p>
        )}
      </CardContent>
    </Card>
  );
}