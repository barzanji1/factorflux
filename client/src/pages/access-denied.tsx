import { ShieldX } from "lucide-react";
import { Button, Card } from "@/components/admin-neu/adapters";

export default function AccessDenied({ onBack }: { onBack?: () => void }) {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-[#e0e0e0] px-4">
      <Card className="w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#e0e0e0] text-[#a3483e] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">
          <ShieldX className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-semibold text-[#333]">Access Denied</h1>
        <p className="mt-2 text-sm leading-6 text-[#777]">
          You don’t have permission to access this resource. Contact an administrator if you need access.
        </p>
        {onBack && (
          <Button type="button" className="mt-6" onClick={onBack}>
            Return to dashboard
          </Button>
        )}
      </Card>
    </div>
  );
}