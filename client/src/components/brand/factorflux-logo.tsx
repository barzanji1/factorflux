import { cn } from "@/lib/utils";

type FactorFluxLogoProps = {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
  inverted?: boolean;
};

export function FactorFluxLogo({ className, markClassName, showWordmark = true, inverted = false }: FactorFluxLogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg viewBox="0 0 40 40" aria-hidden="true" className={cn("h-9 w-9 shrink-0", markClassName)}>
        <path d="M20 3 35 11.5v17L20 37 5 28.5v-17L20 3Z" fill={inverted ? "#27aab8" : "#098b9f"} />
        <path d="m20 8 10.5 6v12L20 32 9.5 26V14L20 8Z" fill={inverted ? "#d4d0c8" : "#27aab8"} />
        <path d="m20 13 6 3.45v6.1L20 26l-6-3.45v-6.1L20 13Z" fill={inverted ? "#098b9f" : "#d4d0c8"} />
      </svg>
      {showWordmark && (
        <span className={cn("font-bold tracking-[-0.03em] text-[15px]", inverted ? "text-white" : "text-[#1a1a1a]")}>
          FactorFlux
        </span>
      )}
    </div>
  );
}