import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, CircleHelp, XCircle } from "lucide-react";

export type SystemHealthStatus = {
  state: "healthy" | "warning" | "failed" | "not_run";
  active: number | null;
  failed: number;
  lastChecked: string | null;
  href: "/fmcsa-authority";
};

const statusAppearance = {
  healthy: {
    Icon: CheckCircle2,
    iconClass: "text-[#16803c]",
    label: "Healthy",
  },
  warning: {
    Icon: AlertTriangle,
    iconClass: "text-[#a87900]",
    label: "Attention needed",
  },
  failed: {
    Icon: XCircle,
    iconClass: "text-[#b3261e]",
    label: "Check failed",
  },
  not_run: {
    Icon: CircleHelp,
    iconClass: "text-[#666]",
    label: "Not checked",
  },
} satisfies Record<SystemHealthStatus["state"], {
  Icon: typeof CheckCircle2;
  iconClass: string;
  label: string;
}>;

function formatLastChecked(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SystemHealthCard({ health }: { health: SystemHealthStatus }) {
  const { Icon, iconClass, label } = statusAppearance[health.state];

  return (
    <Link
      href={health.href}
      aria-label={`FMCSA Authority: ${label}. Open FMCSA Authority`}
      data-testid="fmcsa-authority-health-card"
      className="group block border-2 border-[#808080] border-b-white border-r-white bg-[#f4f2ed] p-3 text-[#222] shadow-[inset_1px_1px_2px_rgba(255,255,255,0.9)] transition-colors hover:bg-[#fff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087c8d]"
    >
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-bold">FMCSA Authority</h3>
            <span className="border border-[#a0a0a0] bg-[#ece9e2] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#444]">
              {label}
            </span>
          </div>
          {health.state === "not_run" ? (
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-[#555]">FMCSA checks not yet run</p>
              <span className="font-mono text-[11px] font-bold text-[#087c8d] underline underline-offset-2 group-hover:text-[#075b68]">
                Run MC Check <span aria-hidden="true">→</span>
              </span>
            </div>
          ) : (
            <p className="mt-1.5 text-xs leading-relaxed text-[#555]">
              {health.active === null ? "— active" : `${health.active.toLocaleString()} active`}
              <span aria-hidden="true"> · </span>
              {health.failed.toLocaleString()} failed
              <span aria-hidden="true"> · </span>
              Last checked {formatLastChecked(health.lastChecked) ?? "—"}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
