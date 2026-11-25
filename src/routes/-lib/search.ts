// The page's state in its link: ?url=…&browsers=chromium,firefox (the panes, in order; absent
// means the browsers marked byDefault) plus the settings: &mem=MiB (absent: 2048), &wisp=wss://…
// (repeatable; absent means the public relays), &flags-<browser>=… (one per line; absent means
// the defaults), &mobile=1, &console=1 and &stats=1.
import { BROWSERS, type Browser } from "@/modules/browsers/browsers";

export const MEMORY_SIZES = ["1024", "2048"] as const;
export const DEFAULT_MEMORY = "2048";

export interface PageSearch {
  url?: string;
  browsers?: string;
  mem?: string;
  wisp?: string[];
  mobile?: boolean;
  console?: boolean;
  stats?: boolean;
  [flags: `flags-${string}`]: string | undefined;
}

// Links are shareable, so take only what's well-formed; the VM frame checks the flags again.
export function validateSearch(raw: Record<string, unknown>): PageSearch {
  const text = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) && typeof v.at(-1) === "string" ? (v.at(-1) as string) : undefined);
  const on = (v: unknown) => v === true || text(v) === "1" || undefined;
  const wisp = [raw.wisp ?? []].flat().filter((r): r is string => typeof r === "string" && r !== "");
  const mem = text(raw.mem);
  const search: PageSearch = {
    url: text(raw.url),
    browsers: text(raw.browsers),
    mem: MEMORY_SIZES.find((m) => m === mem),
    wisp: wisp.length ? wisp : undefined,
    mobile: on(raw.mobile),
    console: on(raw.console),
    stats: on(raw.stats),
  };
  for (const b of BROWSERS) search[`flags-${b.id}`] = text(raw[`flags-${b.id}`]);
  return search;
}

const defaults = () => BROWSERS.filter((b) => b.byDefault);

// The browsers with a pane, in pane order.
export function shownBrowsers(param: string | undefined): Browser[] {
  if (param === undefined) return defaults();
  return param.split(",").flatMap((id) => BROWSERS.filter((b) => b.id === id));
}

// The browsers= value for these panes: absent when they are the defaults in their usual order.
export function browsersParam(shown: Browser[]): string | undefined {
  const ids = shown.map((b) => b.id).join(",");
  return ids === defaults().map((b) => b.id).join(",") ? undefined : ids;
}
