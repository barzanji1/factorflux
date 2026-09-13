import { cn } from "@/lib/utils";

// ─── Status map ───────────────────────────────────────────────────────────────
//
//  draft       — Created, not submitted
//  pending     — Awaiting review or action
//  submitted   — Received and in the queue
//  approved    — Cleared for funding
//  paid/funded — Advance disbursed to carrier
//  rejected    — Declined
//  hold        — Flagged / under review / suspended
//  processing  — Actively being worked
//  overdue     — Past due date
//  partial     — Partially resolved
//  active      — Account / carrier active
//  inactive    — Account / carrier inactive

export type FFStatus =
  | "draft"
  | "pending"
  | "submitted"
  | "docs_pending"
  | "under_review"
  | "approved"
  | "paid"
  | "funded"
  | "rejected"
  | "hold"
  | "processing"
  | "overdue"
  | "partial"
  | "active"
  | "inactive";

export type FFBadgeSize = "sm" | "md";

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  FFStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "Draft",
    className:
      "ff-badge-draft",
  },
  pending: {
    label: "Pending",
    className:
      "ff-badge-pending",
  },
  submitted: {
    label: "Submitted",
    className:
      "ff-badge-submitted",
  },
  docs_pending: {
    label: "Documents Required",
    className: "ff-badge-pending",
  },
  under_review: {
    label: "Under Review",
    className: "ff-badge-processing",
  },
  approved: {
    label: "Approved",
    className:
      "ff-badge-approved",
  },
  paid: {
    label: "Funded",
    className:
      "ff-badge-funded",
  },
  funded: {
    label: "Funded",
    className:
      "ff-badge-funded",
  },
  rejected: {
    label: "Rejected",
    className:
      "ff-badge-rejected",
  },
  hold: {
    label: "On Hold",
    className:
      "ff-badge-hold",
  },
  processing: {
    label: "Processing",
    className:
      "ff-badge-processing",
  },
  overdue: {
    label: "Overdue",
    className:
      "ff-badge-overdue",
  },
  partial: {
    label: "Partial",
    className:
      "ff-badge-partial",
  },
  active: {
    label: "Active",
    className:
      "ff-badge-funded",
  },
  inactive: {
    label: "Inactive",
    className:
      "ff-badge-draft",
  },
};

const FALLBACK = {
  label: (s: string) => s.charAt(0).toUpperCase() + s.slice(1),
  className: "ff-badge-draft",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface FFBadgeProps {
  status: string;
  label?: string;
  size?: FFBadgeSize;
  dot?: boolean;
  className?: string;
}

export function FFBadge({
  status,
  label,
  size = "md",
  dot = false,
  className,
}: FFBadgeProps) {
  const key = status?.toLowerCase() as FFStatus;
  const config = STATUS_CONFIG[key] ?? null;

  const resolvedLabel =
    label ?? (config ? config.label : FALLBACK.label(status ?? ""));
  const colorClass = config ? config.className : FALLBACK.className;

  return (
    <span
      className={cn(
        "ff-badge",
        colorClass,
        size === "sm" && "text-[10px] px-1.5 py-[2px]",
        className
      )}
    >
      {dot && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />
      )}
      {resolvedLabel}
    </span>
  );
}
