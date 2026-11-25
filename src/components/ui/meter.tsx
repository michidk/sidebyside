import { Meter as MeterPrimitive } from "@base-ui/react/meter"
import { cn } from "cn"

// Not in shadcn's registry: Base UI's Meter styled like shadcn's Progress, for a value in a
// known range (CPU or memory use) rather than progress toward completion.
function Meter({ className, ...props }: MeterPrimitive.Root.Props) {
  return (
    <MeterPrimitive.Root data-slot="meter" className={cn("flex items-center", className)} {...props}>
      <MeterPrimitive.Track
        data-slot="meter-track"
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <MeterPrimitive.Indicator data-slot="meter-indicator" className="h-full bg-primary transition-all" />
      </MeterPrimitive.Track>
    </MeterPrimitive.Root>
  )
}

export { Meter }
