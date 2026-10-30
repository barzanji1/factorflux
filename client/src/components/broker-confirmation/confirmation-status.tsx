import { cn } from "@/lib/utils";
import { NeuBadge } from "@/styles/neu";

export type ConfirmationStatus = "pending" | "sent" | "confirmed" | "disputed";

const legacyColors: Record<ConfirmationStatus, string> = {
  pending: "border-[#808080] bg-[#e8e5dc] text-[#444]",
  sent: "border-[#287f9a] bg-[#dff5f6] text-[#155e63]",
  confirmed: "border-[#28733e] bg-[#dff1df] text-[#245b31]",
  disputed: "border-[#a64b40] bg-[#f9e1dd] text-[#8a3028]",
};

export function ConfirmationStatusBadge({ status, neuStyle = false }: { status: ConfirmationStatus; neuStyle?: boolean }) {
  if (!neuStyle) {
    return <span data-testid={`confirmation-status-${status}`} className={cn("inline-flex items-center border px-2 py-0.5 text-[11px] font-bold capitalize", legacyColors[status])}>{status}</span>;
  }
  const tone = status === "confirmed" ? "success" : status === "sent" ? "accent" : status === "disputed" ? "warning" : "neutral";
  return (
    <NeuBadge data-testid={`confirmation-status-${status}`} tone={tone} className={cn("px-2 py-0.5 text-[11px] capitalize", status === "disputed" && "text-red-700")}>
      {status}
    </NeuBadge>
  );
}
