import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { NeuCard } from "@/styles/neu";
import { cn } from "@/lib/utils";
import "./neu-notice.css";

export type NoticeSeverity = "info" | "ack" | "block";

export interface NeuNoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  severity?: NoticeSeverity;
  title?: ReactNode;
}

/** Presentation only: callers retain all risk, acknowledgement and retry logic. */
export const NeuNotice = forwardRef<HTMLDivElement, NeuNoticeProps>(
  ({ severity = "info", title, className, children, role, ...props }, ref) => (
    <NeuCard
      {...props}
      ref={ref}
      pressed
      role={role ?? (severity === "block" ? "alert" : "status")}
      data-neu-notice={severity}
      className={cn("neu-notice", className)}
    >
      {title && <div className="neu-notice-title">{title}</div>}
      {children}
    </NeuCard>
  ),
);
NeuNotice.displayName = "NeuNotice";
