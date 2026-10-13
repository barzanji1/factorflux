import { cn } from "@/lib/utils";

export function TpfLogo({ className, markClassName, showWordmark = true, markSrc = "/images/tpf-logo.png" }: {
  className?: string; markClassName?: string; showWordmark?: boolean; markSrc?: string;
}) {
  return <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
    <img src={markSrc} alt="Trucking Pros Financial" className={cn("h-10 w-10 shrink-0 object-contain", markClassName)} />
    {showWordmark && <span className="text-sm font-bold leading-tight">Trucking Pros Financial</span>}
  </span>;
}
