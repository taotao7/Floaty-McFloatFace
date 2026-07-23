import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--fg)] shadow-[0_18px_50px_-24px_rgba(0,0,0,0.55)] transition-[var(--transition-smooth)] hover:border-[var(--accent)]",
        className,
      )}
      {...props}
    />
  );
}
