import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonRows({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-0">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-slate-100 dark:border-slate-800 px-4 py-3 last:border-0"
        >
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton
              key={j}
              className="h-4 rounded-lg"
              style={{ width: `${[140, 100, 80, 90, 60][j % 5]}px`, flexShrink: 0 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-[20px] border border-[hsl(var(--border))] bg-white dark:bg-[hsl(var(--card))] p-4 space-y-3">
      <Skeleton className="h-4 w-24 rounded-lg" />
      <Skeleton className="h-8 w-32 rounded-lg" />
      <Skeleton className="h-3 w-16 rounded-lg" />
    </div>
  );
}
