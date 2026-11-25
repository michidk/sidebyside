import type { Browser } from "@/modules/browsers/browsers";
import type { Usage } from "../-hooks/use-usage";
import { StatsStrip } from "./stats-strip";

interface Props {
  browser: Browser;
  src: string;
  // Its place among the panes: set through CSS, because moving a frame in the DOM reloads it.
  order: number;
  stats: boolean;
  usage: Usage | undefined;
  frameRef: (frame: HTMLIFrameElement | null) => void;
  onLoad: () => void;
}

export function BrowserPane({ browser, src, order, stats, usage, frameRef, onLoad }: Props) {
  return (
    <section style={{ order }} className="flex min-h-0 flex-col border-r last:border-r-0">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-0.5 border-b px-3 py-1.5">
        <h2 className="text-sm font-semibold">
          {browser.label} <span className="font-normal text-muted-foreground">{browser.engine}</span>
        </h2>
        {stats && <StatsStrip usage={usage} />}
      </header>
      <iframe
        ref={frameRef}
        src={src}
        title={`${browser.label} in a VM`}
        allow="cross-origin-isolated; clipboard-read; clipboard-write; fullscreen"
        onLoad={onLoad}
        className="w-full flex-1 border-0 bg-[#0f1115]"
      />
    </section>
  );
}
