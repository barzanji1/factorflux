import type { ReactNode } from "react";
import { NeuStatCard } from "@/styles/neu/components";
import { cn } from "@/lib/utils";

export function FundingStatCard({
  label,
  value,
  detail,
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <NeuStatCard
      label={label}
      value={value}
      detail={detail}
      icon={icon}
      className={cn("funding-neu-surface funding-neu-stat", className)}
    />
  );
}
