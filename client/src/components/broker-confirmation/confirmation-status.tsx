import { cn } from "@/lib/utils";

export type ConfirmationStatus = "pending" | "sent" | "confirmed" | "disputed";

const colors: Record<ConfirmationStatus, string> = {
  pending: "border-[#808080] bg-[#e8e5dc] text-[#444]",
  sent: "border-[#287f9a] bg-[#dff5f6] text-[#155e63]",
  confirmed: "border-[#28733e] bg-[#dff1df] text-[#245b31]",
  disputed: "border-[#a64b40] bg-[#f9e1dd] text-[#8a3028]",
};

export function ConfirmationStatusBadge({ status }: { status: ConfirmationStatus }) {
  return (
    <span data-testid={`confirmation-status-${status}`} className={cn("inline-flex items-center border px-2 py-0.5 text-[11px] font-bold capitalize", colors[status])}>
      {status}
    </span>
  );
}
