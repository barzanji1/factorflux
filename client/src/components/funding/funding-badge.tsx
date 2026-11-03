import type { ReactNode } from "react";
import { NeuBadge, type NeuBadgeProps } from "@/styles/neu/components";

export function FundingBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: NeuBadgeProps["tone"];
  className?: string;
}) {
  return <NeuBadge tone={tone} className={className}>{children}</NeuBadge>;
}
