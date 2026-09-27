import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "group peer relative inline-flex h-10 w-16 shrink-0 cursor-pointer items-center rounded-full border-2 border-white/45 bg-slate-600/90 p-0.5 shadow-inner shadow-black/30 transition-all hover:border-white/75 hover:bg-slate-500/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-80 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:shadow-[0_0_12px_hsl(var(--primary)/0.55)] data-[state=unchecked]:bg-slate-600/90",
      className
    )}
    {...props}
    ref={ref}
  >
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-between px-1.5 text-[9px] font-bold leading-none tracking-wide text-white/85"
    >
      <span className="opacity-0 transition-opacity group-data-[state=checked]:opacity-100">ON</span>
      <span className="opacity-0 transition-opacity group-data-[state=unchecked]:opacity-100">OFF</span>
    </span>
    <SwitchPrimitives.Thumb
      className={cn(
        "relative z-10 pointer-events-none block h-7 w-7 rounded-full bg-white shadow-lg ring-1 ring-black/20 transition-transform data-[state=checked]:translate-x-7 data-[state=unchecked]:translate-x-0"
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
