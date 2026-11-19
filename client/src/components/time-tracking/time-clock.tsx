import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock3, Play, RotateCw, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import { useImmediateNavigation } from "@/hooks/useImmediateNavigation";
import { NeuButton as Button, NeuCard as Card, NeuInput as Input } from "@/styles/neu/components";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import "./time-clock.css";

interface TimeEntry {
  id: number;
  clockInTime: string;
  clockOutTime?: string | null;
  totalHours?: string | number | null;
  status: "clocked_in" | "clocked_out";
  notes?: string | null;
}

interface TimeTrackingStatus {
  isClocked: boolean;
  currentEntry?: TimeEntry | null;
  todayEntries: TimeEntry[];
  todayHours: number;
}

function formatClockTime(date: Date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDurationFromStart(startTime: string, now: Date) {
  const duration = Math.max(0, now.getTime() - new Date(startTime).getTime());
  const hours = Math.floor(duration / 3_600_000);
  const minutes = Math.floor((duration % 3_600_000) / 60_000);
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

function formatEntryDuration(entry: TimeEntry, now: Date) {
  if (!entry.clockOutTime) return formatDurationFromStart(entry.clockInTime, now);
  const value = entry.totalHours == null || entry.totalHours === "" ? NaN : Number(entry.totalHours);
  if (Number.isFinite(value)) return `${value.toFixed(2)} hrs`;
  const elapsed = Math.max(0, new Date(entry.clockOutTime).getTime() - new Date(entry.clockInTime).getTime());
  return `${(elapsed / 3_600_000).toFixed(2)} hrs`;
}

async function fetchTimeStatus(signal: AbortSignal): Promise<TimeTrackingStatus> {
  const response = await fetch("/api/time-tracking/status", { credentials: "include", signal });
  if (!response.ok) {
    const body = await response.text();
    let message = body || `Time clock request failed (${response.status})`;
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: string };
      message = parsed.message || parsed.error || message;
    } catch {
      // Keep a plain-text API error readable.
    }
    throw new Error(message);
  }
  return response.json() as Promise<TimeTrackingStatus>;
}

export default function TimeClock() {
  const [, navigate] = useImmediateNavigation();
  const { user } = useAuth();
  const userId = user?.id;
  const { toast } = useToast();
  const notesId = useId();
  const titleId = useId();
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const statusKey = ["/api/time-tracking/status", userId];
  const {
    data: timeStatus,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<TimeTrackingStatus>({
    queryKey: statusKey,
    queryFn: ({ signal }) => fetchTimeStatus(signal),
    enabled: Boolean(userId),
    retry: false,
    refetchInterval: 30_000,
  });

  const invalidateStatus = () => queryClient.invalidateQueries({ queryKey: statusKey });
  const handleMutationError = (mutationError: Error) => {
    if (isUnauthorizedError(mutationError)) {
      toast({ title: "Unauthorized", description: "You are logged out. Logging in again...", variant: "destructive" });
      window.setTimeout(() => { window.location.href = "/login"; }, 500);
      return;
    }
    toast({ title: "Error", description: mutationError.message || "Time clock update failed.", variant: "destructive" });
  };

  const clockInMutation = useMutation({
    mutationFn: async (sessionNotes: string) => {
      const response = await apiRequest("POST", "/api/time-tracking/clock-in", { notes: sessionNotes });
      return response.json();
    },
    onSuccess: async () => {
      setNotes("");
      await Promise.all([
        invalidateStatus(),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent-activities"] }),
      ]);
      toast({ title: "Clocked In", description: "Your shift has started." });
    },
    onError: handleMutationError,
  });

  const clockOutMutation = useMutation({
    mutationFn: async (sessionNotes: string) => {
      const response = await apiRequest("POST", "/api/time-tracking/clock-out", { notes: sessionNotes });
      return response.json();
    },
    onSuccess: async () => {
      setNotes("");
      await Promise.all([
        invalidateStatus(),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/recent-activities"] }),
      ]);
      toast({ title: "Clocked Out", description: "Your shift has ended." });
    },
    onError: handleMutationError,
  });

  const isClockedIn = Boolean(timeStatus?.isClocked && timeStatus.currentEntry);
  const isSubmitting = clockInMutation.isPending || clockOutMutation.isPending;
  const activeDuration = isClockedIn && timeStatus?.currentEntry
    ? formatDurationFromStart(timeStatus.currentEntry.clockInTime, currentTime)
    : "";
  const entries = useMemo(() => {
    const list = [...(timeStatus?.todayEntries ?? [])];
    return list
      .sort((a, b) => new Date(b.clockInTime).getTime() - new Date(a.clockInTime).getTime())
      .slice(0, 3);
  }, [timeStatus?.todayEntries]);

  const clockAction = () => {
    if (isClockedIn) clockOutMutation.mutate(notes.trim());
    else clockInMutation.mutate(notes.trim());
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          aria-label={isClockedIn ? `Time clock ${activeDuration}` : "Clock In"}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="time-clock-trigger"
          data-clocked-in={isClockedIn}
          className={`ff-time-clock-trigger relative h-10 min-h-10 gap-2 rounded-xl px-3 text-[#53605b] ${isClockedIn ? "is-active" : ""}`}
        >
          <Clock3 className="h-[17px] w-[17px] shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap text-xs font-semibold">
            {isClockedIn ? `live ${activeDuration}` : "Clock In"}
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        role="dialog"
        aria-labelledby={titleId}
        data-testid="time-clock-popover"
        align="end"
        side="bottom"
        sideOffset={10}
        collisionPadding={12}
        className="ff-time-clock-popover w-[min(370px,calc(100vw-24px))] max-h-[min(680px,calc(100dvh-24px))] overflow-y-auto border-0 bg-transparent p-0 shadow-none"
      >
        <Card className="ff-time-clock-card rounded-2xl p-4 sm:p-[18px]">
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="ff-time-clock-eyebrow">Your shift</p>
              <h2 id={titleId} className="mt-1 text-[17px] font-semibold tracking-[-.03em] text-[#394541]">
                Time clock
              </h2>
            </div>
            <span className={`ff-time-clock-indicator ${isClockedIn ? "is-on" : ""}`} aria-hidden="true" />
          </header>

          <section className="ff-time-clock-summary mt-4" data-testid="time-clock-status" aria-live="polite">
            {isLoading ? (
              <div className="space-y-2" aria-label="Loading time clock status">
                <div className="ff-time-clock-skeleton h-4 w-32" />
                <div className="ff-time-clock-skeleton h-3 w-24" />
              </div>
            ) : isError ? (
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#9a6252]">Time clock unavailable</p>
                  <p className="mt-1 text-xs text-[#8b9691]">{error instanceof Error ? error.message : "Try again in a moment."}</p>
                </div>
                <Button
                  type="button"
              variant="ghost"
                  aria-label="Retry time clock status"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="!h-9 !min-h-9 !w-9 !shrink-0 !rounded-xl !p-0"
                >
                  <RotateCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                </Button>
              </div>
            ) : (
              <>
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#48534f]">
                      {isClockedIn ? "Clocked In" : "Clocked Out"}
                      {isClockedIn && timeStatus?.currentEntry && (
                        <span className="font-normal text-[#87928d]"> since {formatClockTime(new Date(timeStatus.currentEntry.clockInTime))}</span>
                      )}
                    </p>
                    <p className="mt-1 font-mono text-[11px] tabular-nums text-[#8a9690]" data-testid="time-clock-live">
                      Local time · {formatClockTime(currentTime)}
                    </p>
                  </div>
                  {isClockedIn && (
                    <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-[#168f99]">
                      {activeDuration}
                    </span>
                  )}
                </div>
                <div className="ff-time-clock-total mt-3 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[#87928d]">Today</span>
                  <span className="font-mono text-[12px] font-semibold tabular-nums text-[#53605b]" data-testid="time-clock-total">
                    {timeStatus?.todayHours?.toFixed(2) ?? "0.00"} hrs
                  </span>
                </div>
              </>
            )}
          </section>
          <Button type="button" variant="ghost" className="mt-3 w-full" onClick={() => { setOpen(false); navigate("/payroll"); }}>
            View Pay Statements
          </Button>

          <div className="mt-3">
            <label htmlFor={notesId} className="sr-only">Optional session notes</label>
            <Input
              id={notesId}
              data-testid="time-clock-notes-input"
              placeholder="Add a note (optional)"
              value={notes}
              onChange={event => setNotes(event.target.value)}
              disabled={isSubmitting}
              className="!min-h-10 !rounded-xl !px-3 !py-2 text-xs"
            />
          </div>

          {isError ? (
            <Button
              type="button"
                  variant="ghost"
              onClick={() => refetch()}
              disabled={isFetching || isSubmitting}
              data-testid="time-clock-action"
              data-clock-action="retry"
              className="ff-time-clock-action mt-3 w-full !min-h-11 !rounded-xl !text-white"
            >
              {isFetching ? "Retrying…" : "Retry status"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={clockAction}
              disabled={!userId || isLoading || isError || isSubmitting}
              data-testid="time-clock-action"
              data-clock-action={isClockedIn ? "clock-out" : "clock-in"}
              className="ff-time-clock-action mt-3 w-full !min-h-11 !rounded-xl !text-white"
            >
              {isSubmitting ? "Updating…" : isClockedIn ? (
                <><Square className="h-3.5 w-3.5" />Clock Out</>
              ) : (
                <><Play className="h-3.5 w-3.5" />Clock In</>
              )}
            </Button>
          )}

          <section className="mt-5" aria-label="Today's time entries">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="ff-time-clock-eyebrow">Recent today</h3>
              <span className="text-[10px] text-[#9aa39f]">Latest 3</span>
            </div>
            {isLoading ? (
              <div className="space-y-2" aria-label="Loading recent entries">
                <div className="ff-time-clock-entry-skeleton" />
                <div className="ff-time-clock-entry-skeleton" />
              </div>
            ) : isError ? (
              <p className="py-3 text-xs text-[#8b9691]">Entries will appear when status is available.</p>
            ) : entries.length ? (
              <ul className="space-y-1.5">
                {entries.map(entry => (
                  <li key={entry.id} data-testid="time-clock-recent-entry" className="ff-time-clock-entry">
                    <span className="min-w-0">
                      <span className="font-mono text-[11px] tabular-nums text-[#58645f]">{formatClockTime(new Date(entry.clockInTime))}</span>
                      <span className="mx-1.5 text-[#b0b8b4]">→</span>
                      <span className="font-mono text-[11px] tabular-nums text-[#87928d]">
                        {entry.clockOutTime ? formatClockTime(new Date(entry.clockOutTime)) : "In progress"}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-[#87928d]">
                      {formatEntryDuration(entry, currentTime)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="ff-time-clock-empty">
                <Clock3 className="h-4 w-4" aria-hidden="true" />
                <p>No entries yet today</p>
              </div>
            )}
          </section>
        </Card>
      </PopoverContent>
    </Popover>
  );
}
