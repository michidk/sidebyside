// What the page and its VM frames (vm.html) tell each other with postMessage. Frames are this
// origin's own pages, but checked anyway: the browser in a frame prints whatever a site makes it.
import { BROWSERS, type ConsoleLevel } from "../browsers/browsers.ts";

// Frame → page: a line of the browser's web console.
export interface ConsoleMessage {
  type: "console";
  browser: string;
  level: ConsoleLevel;
  text: string;
}

// Frame → page, every 2 s: the guest's CPU (0–1 of all its CPUs) and memory, and bytes per second
// through the relay.
export interface UsageMessage {
  type: "usage";
  browser: string;
  cpu: number;
  cpus: number;
  memUsed: number;
  memTotal: number;
  rx: number;
  tx: number;
}

// Page → frame: switch mobile mode.
export interface MobileMessage {
  type: "mobile";
  on: boolean;
}

const LEVELS: ConsoleLevel[] = ["log", "info", "warn", "error", "debug"];
const known = (id: unknown) => BROWSERS.some((b) => b.id === id);

export function parseConsole(data: unknown): ConsoleMessage | undefined {
  const d = data as Partial<ConsoleMessage> | null;
  if (d?.type !== "console" || !known(d.browser)) return;
  return { type: "console", browser: d.browser!, level: LEVELS.includes(d.level!) ? d.level! : "log", text: String(d.text) };
}

export function parseUsage(data: unknown): UsageMessage | undefined {
  const d = data as Partial<UsageMessage> | null;
  if (d?.type !== "usage" || !known(d.browser)) return;
  const numbers = [d.cpu, d.cpus, d.memUsed, d.memTotal, d.rx, d.tx];
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0) || !d.memTotal) return;
  return { ...(d as UsageMessage), cpu: Math.min(1, d.cpu!) };
}

export function parseMobile(data: unknown): MobileMessage | undefined {
  const d = data as Partial<MobileMessage> | null;
  return d?.type === "mobile" ? { type: "mobile", on: d.on === true } : undefined;
}
