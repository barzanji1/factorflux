import { Card, CardContent } from "@/components/admin-neu/adapters";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center bg-[#e0e0e0]">
      <Card className="mx-4 w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-[#a3483e]" />
            <h1 className="text-2xl font-bold text-[#333]">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-[#777]">
            Did you forget to add the page to the router?
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
