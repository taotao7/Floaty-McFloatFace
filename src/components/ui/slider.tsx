import * as SliderPrimitive from "@radix-ui/react-slider";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../../lib/utils";

export function Slider({ className, ...props }: ComponentPropsWithoutRef<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root className={cn("relative flex w-full touch-none select-none items-center", className)} {...props}>
      <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-[#e2e8f0]">
        <SliderPrimitive.Range className="absolute h-full bg-[#ff6f3c]" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border border-[#fb923c] bg-white shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fb923c]" />
    </SliderPrimitive.Root>
  );
}
