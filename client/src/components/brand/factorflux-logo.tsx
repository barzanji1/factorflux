import { cn } from "@/lib/utils";
import { useId } from "react";

type FactorFluxLogoProps = {
  className?: string;
  markClassName?: string;
  markSrc?: string;
  showWordmark?: boolean;
  inverted?: boolean;
  shine?: boolean;
};

export function FactorFluxLogo({ className, markClassName, markSrc, showWordmark = true, inverted = false, shine = false }: FactorFluxLogoProps) {
  const instanceId = useId().replace(/:/g, "");
  const clipId = `factorflux-mark-clip-${instanceId}`;
  const shineGradientId = `factorflux-shine-gradient-${instanceId}`;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className={cn("relative inline-flex shrink-0", shine && !markSrc && "logo-shine-wrapper")}>
        {markSrc ? (
          <img src={markSrc} alt="" aria-hidden="true" className={cn("block h-9 w-9 shrink-0 object-contain", markClassName)} />
        ) : (
          <svg viewBox="0 0 578.85 527.45" aria-hidden="true" className={cn("h-9 w-9 shrink-0", markClassName)}>
          {shine && (
            <defs>
              <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
                <polygon
                  points="314.36 210.82 418.86 315.32 470.45 263.73 314.36 107.63 314.36 7.91 545.24 238.79 570.17 263.73 545.24 288.66 468.71 365.18 468.72 365.18 443.79 390.11 314.36 519.54 314.36 419.82 369.00 365.18 314.36 310.54 314.36 210.82"
                />
                <polygon
                  points="159.99 315.32 264.49 210.83 264.49 310.54 209.86 365.18 264.49 419.81 264.49 519.54 33.61 288.66 8.68 263.73 33.61 238.79 264.49 7.91 264.49 107.64 108.40 263.73 159.99 315.32"
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
        )}
      </span>
      {showWordmark && (
        <span className={cn("font-bold tracking-[-0.03em] text-[15px]", inverted ? "text-white" : "text-[#1a1a1a]")}>
          FactorFlux
        </span>
      )}
    </div>
  );
}