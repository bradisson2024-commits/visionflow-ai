import { cn } from "@/lib/cn";

export function ProgressBar({ value, indeterminate = false, className }: { value: number; indeterminate?: boolean; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(value)}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <div
        className={cn("forge-gradient h-full rounded-full transition-[width] duration-300", indeterminate && "animate-pulse")}
        style={{ width: `${indeterminate ? 100 : Math.max(2, Math.min(100, value))}%` }}
      />
    </div>
  );
}
