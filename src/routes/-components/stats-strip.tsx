import { Meter } from "@/components/ui/meter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CPU_HISTORY, type Usage } from "../-hooks/use-usage";

const mib = (bytes: number) => `${Math.round(bytes / 2 ** 20)} MiB`;
function rate(bytesPerSecond: number) {
  if (bytesPerSecond < 1000) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1e6) return `${(bytesPerSecond / 1e3).toFixed(1)} kB/s`;
  return `${(bytesPerSecond / 1e6).toFixed(1)} MB/s`;
}

// CPU over the last minute, newest at the right.
function Sparkline({ values }: { values: number[] }) {
  const start = CPU_HISTORY - values.length;
  return (
    <svg viewBox={`0 0 ${CPU_HISTORY - 1} 1`} preserveAspectRatio="none" aria-hidden className="h-3.5 w-12 overflow-visible">
      <polyline
        points={values.map((v, i) => `${start + i},${1 - v}`).join(" ")}
        className="fill-none stroke-current"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Stat({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex items-center gap-1.5 whitespace-nowrap" />}>
        <span className="text-muted-foreground">{label}</span>
        {children}
      </TooltipTrigger>
      <TooltipContent>{detail}</TooltipContent>
    </Tooltip>
  );
}

// A VM's resource use, like a task manager: the guest's CPU and memory, and its relay traffic.
export function StatsStrip({ usage }: { usage: Usage | undefined }) {
  const cpu = usage ? Math.round(usage.cpu * 100) : undefined;
  return (
    <div aria-label="Resource use" className="ml-auto flex flex-wrap items-center gap-x-3.5 gap-y-0.5 text-xs tabular-nums">
      <Stat label="CPU" detail={usage ? `${cpu}% of ${usage.cpus} CPU${usage.cpus > 1 ? "s" : ""}` : "Waiting for the VM"}>
        <Meter value={usage?.cpu ?? 0} max={1} aria-label="CPU use" className="w-11" />
        <span className="min-w-[4ch]">{usage ? `${cpu}%` : "–"}</span>
        <Sparkline values={usage?.cpuHistory ?? []} />
      </Stat>
      <Stat label="RAM" detail={usage ? `${mib(usage.memUsed)} of ${mib(usage.memTotal)}` : "Waiting for the VM"}>
        <Meter value={usage ? usage.memUsed / usage.memTotal : 0} max={1} aria-label="Memory use" className="w-11" />
        <span className="min-w-[7ch]">{usage ? mib(usage.memUsed) : "–"}</span>
      </Stat>
      <Stat label="Net" detail="Traffic through the relay">
        <span>{usage ? `↓ ${rate(usage.rx)} ↑ ${rate(usage.tx)}` : "–"}</span>
      </Stat>
    </div>
  );
}
