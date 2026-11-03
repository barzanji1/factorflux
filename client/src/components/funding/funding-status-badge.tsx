import { FundingBadge } from "@/components/funding/funding-badge";
import type { NeuBadgeProps } from "@/styles/neu/components";

const LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending",
  submitted: "Submitted",
  docs_pending: "Documents Required",
  under_review: "Under Review",
  approved: "Approved",
  paid: "Funded",
  funded: "Funded",
  rejected: "Rejected",
  hold: "On Hold",
  processing: "Processing",
  overdue: "Overdue",
  partial: "Partial",
  active: "Active",
  inactive: "Inactive",
};

export function FundingStatusBadge({
  status,
  label,
  size = "md",
}: {
  status: string;
  label?: string;
  size?: "sm" | "md";
}) {
  const normalized = status.toLowerCase();
  const tone: NeuBadgeProps["tone"] =
    ["approved", "paid", "funded", "active"].includes(normalized)
      ? "success"
      : ["rejected", "hold", "overdue"].includes(normalized)
        ? "warning"
        : ["under_review", "processing"].includes(normalized)
          ? "accent"
          : "neutral";
  const resolvedLabel = label ?? LABELS[normalized] ?? `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
  return (
    <FundingBadge
      tone={tone}
      className={size === "sm" ? "!px-2 !py-0.5 text-[10px]" : undefined}
    >
      {resolvedLabel}
    </FundingBadge>
  );
}
