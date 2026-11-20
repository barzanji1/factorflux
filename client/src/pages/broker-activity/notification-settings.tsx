import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/admin-neu/adapters";
import { Switch } from "@/components/ui/switch";
import { useBrokerNotificationPreferences, useSaveBrokerNotificationPreferences } from "./hooks";
import type { BrokerNotificationPreferences } from "@shared/broker-activity";

export function BrokerNotificationSettings() {
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "manager";
  const preferences = useBrokerNotificationPreferences(Boolean(canManage));
  const savePreferences = useSaveBrokerNotificationPreferences();
  const [draft, setDraft] = useState<BrokerNotificationPreferences | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (preferences.data) {
      setDraft({ inApp: preferences.data.inApp, email: preferences.data.email });
      setSaved(false);
    }
  }, [preferences.data]);

  if (!canManage) return null;

  const toggle = (key: keyof BrokerNotificationPreferences, value: boolean) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setSaved(false);
  };

  const save = () => {
    if (!draft) return;
    savePreferences.mutate(draft, {
      onSuccess: (result) => {
        setDraft({ inApp: result.inApp, email: result.email });
        setSaved(true);
      },
      onError: () => setSaved(false),
    });
  };

  return (
    <Card className="ff-broker-activity-surface">
      <CardHeader>
        <CardTitle>Broker Notifications</CardTitle>
        <CardDescription>Choose how broker invoice responses reach your internal account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {preferences.isLoading && (
          <div className="space-y-3" aria-label="Loading broker notification preferences">
            <div className="h-16 animate-pulse rounded-xl bg-black/5" />
            <div className="h-16 animate-pulse rounded-xl bg-black/5" />
          </div>
        )}
        {preferences.isError && (
          <div className="rounded-xl p-4 text-sm text-destructive" role="alert">
            <p>Could not load broker notification preferences. No values have been changed.</p>
            <Button type="button" variant="outline" className="mt-3" onClick={() => preferences.refetch()}>Retry</Button>
          </div>
        )}
        {draft && !preferences.isError && (
          <>
            <div className="admin-neu-surface flex items-center justify-between gap-4 rounded-xl p-4">
              <div>
                <p className="font-semibold">In-app notifications</p>
                <p className="mt-1 text-sm text-muted-foreground">Receive broker confirmations and disputes in FactorFlux.</p>
              </div>
              <Switch checked={draft.inApp} onCheckedChange={(value) => toggle("inApp", value)} aria-label="In-app notifications" />
            </div>
            <div className="admin-neu-surface flex items-center justify-between gap-4 rounded-xl p-4">
              <div>
                <p className="font-semibold">Email notifications</p>
                <p className="mt-1 text-sm text-muted-foreground">Email me when a broker responds to an invoice.</p>
              </div>
              <Switch checked={draft.email} onCheckedChange={(value) => toggle("email", value)} aria-label="Email notifications" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={save} disabled={savePreferences.isPending}>
                {savePreferences.isPending ? "Saving…" : "Save preferences"}
              </Button>
              {saved && <span className="text-sm text-emerald-700" role="status">Preferences saved.</span>}
              {savePreferences.isError && <span className="text-sm text-destructive" role="alert">Could not save preferences. Try again.</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
