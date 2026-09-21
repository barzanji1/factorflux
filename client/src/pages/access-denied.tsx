import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AccessDenied({ onBack }: { onBack?: () => void }) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[hsl(var(--background))] px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400">
          <ShieldX className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Access Denied</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
          You don’t have permission to access this resource. Contact an administrator if you need access.
        </p>
        {onBack && (
          <Button type="button" className="mt-6" onClick={onBack}>
            Return to dashboard
          </Button>
        )}
      </div>
    </div>
  );
}