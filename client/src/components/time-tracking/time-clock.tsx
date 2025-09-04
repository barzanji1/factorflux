import { useState, useEffect } from "react";
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
import { Separator } from "@/components/ui/separator";
import {
  Clock,
  Play,
  Square,
  Timer,
  Calendar,
  ClockIcon,
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

export default function TimeClock() {
  const { toast } = useToast();
  const [notes, setNotes] = useState("");
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch time tracking status
  const { data: timeStatus, isLoading } = useQuery<TimeTrackingStatus>({
    queryKey: ["/api/time-tracking/status"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Clock in mutation
  const clockInMutation = useMutation({
    mutationFn: async (notes: string) => {
      console.log('Attempting clock-in...');
      const response = await apiRequest("POST", "/api/time-tracking/clock-in", { notes });
      console.log('Clock-in response status:', response.status);
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

  // Clock out mutation
  const clockOutMutation = useMutation({
    mutationFn: async (notes: string) => {
      const response = await apiRequest("POST", "/api/time-tracking/clock-out", { notes });
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
    clockInMutation.mutate(notes);
  };

  const handleClockOut = () => {
    clockOutMutation.mutate(notes);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatDuration = (startTime: string) => {
    const start = new Date(startTime);
    const duration = currentTime.getTime() - start.getTime();
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((duration % (1000 * 60)) / 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Clock className="w-5 h-5" />
            <span>Time Clock</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded"></div>
            <div className="h-12 bg-gray-200 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Clock className="w-5 h-5" />
          <span>Time Clock</span>
        </CardTitle>
        <CardDescription>
          Track your work hours
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Time Display */}
        <div className="text-center">
          <div className="text-3xl font-mono font-bold text-blue-600 dark:text-blue-400">
            {formatTime(currentTime)}
          </div>
          <div className="text-sm text-gray-500">
            {currentTime.toLocaleDateString([], { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </div>
        </div>

        <Separator />

        {/* Status Display */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {timeStatus?.isClocked ? (
              <Badge variant="default" className="bg-green-600 hover:bg-green-700 text-white">
                <Timer className="w-3 h-3 mr-1" />
                Clocked In
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400">
                <ClockIcon className="w-3 h-3 mr-1" />
                Clocked Out
              </Badge>
            )}
          </div>
          
          {timeStatus?.isClocked && timeStatus.currentEntry && (
            <div className="text-right">
              <div className="text-sm text-gray-500">Started at</div>
              <div className="font-mono text-sm">
                {new Date(timeStatus.currentEntry.clockInTime).toLocaleTimeString([], { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })}
              </div>
            </div>
          )}
        </div>

        {/* Active Timer or Clocked Out Message */}
        {timeStatus?.isClocked && timeStatus.currentEntry ? (
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 text-center border border-green-200 dark:border-green-800">
            <div className="text-sm text-green-600 dark:text-green-400 mb-1">Time Worked Today</div>
            <div className="text-2xl font-mono font-bold text-green-700 dark:text-green-400">
              {formatDuration(timeStatus.currentEntry.clockInTime)}
            </div>
          </div>
        ) : (
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 text-center border border-red-200 dark:border-red-800">
            <div className="text-sm text-red-600 dark:text-red-400 mb-1">Status</div>
            <div className="text-lg font-semibold text-red-700 dark:text-red-400">
              Currently Clocked Out
            </div>
            <div className="text-xs text-red-500 dark:text-red-500 mt-1">
              Click "Clock In" to start tracking time
            </div>
          </div>
        )}

        {/* Today's Summary */}
        <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <div className="flex items-center space-x-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <span className="text-sm text-gray-600 dark:text-gray-300">Today's Total</span>
          </div>
          <div className="font-mono font-semibold">
            {timeStatus?.todayHours.toFixed(2) || '0.00'} hours
          </div>
        </div>

        {/* Notes Input */}
        <div className="space-y-2">
          <label htmlFor="notes" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Notes (optional)
          </label>
          <Input
            id="notes"
            placeholder="Add a note about your work..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex space-x-2">
          {timeStatus?.isClocked ? (
            <Button
              onClick={handleClockOut}
              disabled={clockOutMutation.isPending}
              variant="destructive"
              className="flex-1 flex items-center justify-center space-x-2"
            >
              <Square className="w-4 h-4" />
              <span>{clockOutMutation.isPending ? "Clocking Out..." : "Clock Out"}</span>
            </Button>
          ) : (
            <Button
              onClick={handleClockIn}
              disabled={clockInMutation.isPending}
              className="flex-1 flex items-center justify-center space-x-2"
            >
              <Play className="w-4 h-4" />
              <span>{clockInMutation.isPending ? "Clocking In..." : "Clock In"}</span>
            </Button>
          )}
        </div>

        {/* Recent Entries Preview */}
        {timeStatus?.todayEntries && timeStatus.todayEntries.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Today's Entries</h4>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {timeStatus.todayEntries.slice(0, 3).map((entry, index) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between text-xs bg-white dark:bg-gray-800 rounded p-2 border"
                >
                  <div>
                    {new Date(entry.clockInTime).toLocaleTimeString([], { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    })}
                    {entry.clockOutTime && (
                      <span className="text-gray-500">
                        {' - '}
                        {new Date(entry.clockOutTime).toLocaleTimeString([], { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        })}
                      </span>
                    )}
                  </div>
                  {entry.totalHours && (
                    <div className="font-mono text-gray-600 dark:text-gray-300">
                      {parseFloat(entry.totalHours).toFixed(2)}h
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}