import { cn } from "@/lib/utils";
import { useId } from "react";

type FactorFluxLogoProps = {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
  inverted?: boolean;
  shine?: boolean;
};

export function FactorFluxLogo({ className, markClassName, showWordmark = true, inverted = false, shine = false }: FactorFluxLogoProps) {
  const instanceId = useId().replace(/:/g, "");
  const clipId = `factorflux-mark-clip-${instanceId}`;
  const shineGradientId = `factorflux-shine-gradient-${instanceId}`;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className={cn("relative inline-flex shrink-0", shine && "logo-shine-wrapper")}>
        <svg viewBox="0 0 578.85 527.45" aria-hidden="true" className={cn("h-9 w-9 shrink-0", markClassName)}>
          {shine && (
            <defs>
              <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
                <polygon
                  points="315.13 209.18 422.86 316.92 476.05 263.73 315.13 102.8 315.13 0 553.15 238.02 578.85 263.73 553.15 289.43 474.26 368.32 474.27 368.32 448.56 394.02 315.13 527.45 315.13 424.65 371.46 368.32 315.13 311.99 315.13 209.18"
                />
                <polygon
                  points="155.99 316.92 263.72 209.19 263.72 311.99 207.4 368.32 263.72 424.64 263.72 527.45 25.7 289.43 0 263.73 25.7 238.02 263.72 0 263.72 102.81 102.8 263.73 155.99 316.92"
                />
              </clipPath>
              <linearGradient id={shineGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="38%" stopColor="rgba(255,255,255,0)" />
                <stop offset="50%" stopColor="rgba(255,255,255,0.3)" />
                <stop offset="62%" stopColor="rgba(255,255,255,0)" />
              </linearGradient>
            </defs>
          )}
          <polygon
            points="315.13 209.18 422.86 316.92 476.05 263.73 315.13 102.8 315.13 0 553.15 238.02 578.85 263.73 553.15 289.43 474.26 368.32 474.27 368.32 448.56 394.02 315.13 527.45 315.13 424.65 371.46 368.32 315.13 311.99 315.13 209.18"
            fill={inverted ? "#27aab8" : "#098b9f"}
          />
          <polygon
            points="155.99 316.92 263.72 209.19 263.72 311.99 207.4 368.32 263.72 424.64 263.72 527.45 25.7 289.43 0 263.73 25.7 238.02 263.72 0 263.72 102.81 102.8 263.73 155.99 316.92"
            fill={inverted ? "#098b9f" : "#27aab8"}
          />
          {shine && (
            <g clipPath={`url(#${clipId})`}>
              <rect
                className="logo-shine-overlay"
                x="0"
                y="0"
                width="578.85"
                height="527.45"
                fill={`url(#${shineGradientId})`}
              />
            </g>
          )}
        </svg>
      </span>
      {showWordmark && (
        <span className={cn("font-bold tracking-[-0.03em] text-[15px]", inverted ? "text-white" : "text-[#1a1a1a]")}>
          FactorFlux
        </span>
      )}
    </div>
  );
}