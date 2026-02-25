import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-[#d5dee8] bg-white/90 p-4 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.55)]",
        className,
      )}
      {...props}
    />
  );
}
