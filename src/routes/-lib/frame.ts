// The VM frame (public/vm.html, built from src/vm/) for one browser pane.
import type { Browser } from "@/modules/browsers/browsers";

// Set by vite.config.ts: which build of the VM frame this page goes with.
declare const __FRAME_VERSION__: string;

// What Open started: a new id remounts every frame.
export interface Run {
  id: number;
  url: string;
  mem: string;
  relays: string[];
  flags: Record<string, string[]>;
}

// Each VM's CPUs: the host's threads split over the panes, capped like unkernel's own page
// (4; 2 in Firefox). A pane added later gets the share of the panes then showing.
export function frameCpus(panes: number) {
  const max = navigator.userAgent.includes("Firefox") ? 2 : 4;
  return Math.max(1, Math.min(max, Math.floor(navigator.hardwareConcurrency / Math.max(1, panes))));
}

export function frameSrc(b: Browser, run: Run, opts: { mobile: boolean; panes: number }) {
  const params = new URLSearchParams({
    browser: b.id,
    url: run.url,
    mem: run.mem,
    cpus: String(frameCpus(opts.panes)),
    flags: (run.flags[b.id] ?? b.flags.defaults).join("\n"),
  });
  if (opts.mobile) params.set("mobile", "1");
  for (const relay of run.relays) params.append("wisp", relay);
  params.set("v", __FRAME_VERSION__);
  return `/vm.html?${params}`;
}
