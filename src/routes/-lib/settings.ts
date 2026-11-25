// The Settings fields, as typed, and what they mean once checked.
import { flagError, flagLines, type Browser } from "@/modules/browsers/browsers";
import { DEFAULT_MEMORY, type PageSearch } from "./search";

export interface SettingsValues {
  mem: string;
  // Relay URLs separated by spaces or commas; empty means the public relays.
  relays: string;
  // Each browser's flags, one per line.
  flags: Record<string, string>;
}

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export function checkRelays(text: string): Checked<string[]> {
  const relays = text.split(/[\s,]+/).filter(Boolean);
  const valid = relays.every((r) => URL.canParse(r) && ["ws:", "wss:"].includes(new URL(r).protocol));
  return valid ? { ok: true, value: relays } : { ok: false, error: "Each relay must be a ws:// or wss:// URL." };
}

export function checkFlags(b: Browser, text: string): Checked<string[]> {
  const lines = flagLines(text);
  const error = lines.map((l) => flagError(b.flags.kind, l)).find(Boolean);
  return error ? { ok: false, error } : { ok: true, value: lines };
}

export const defaultFlags = (b: Browser) => b.flags.defaults.join("\n");

export function settingsFromSearch(search: PageSearch, browsers: Browser[]): SettingsValues {
  return {
    mem: search.mem ?? DEFAULT_MEMORY,
    relays: (search.wisp ?? []).join(" "),
    flags: Object.fromEntries(browsers.map((b) => [b.id, search[`flags-${b.id}`] ?? defaultFlags(b)])),
  };
}

// The link's settings part: only what differs from the defaults.
export function settingsSearch(values: SettingsValues, relays: string[], browsers: Browser[]): Partial<PageSearch> {
  const search: Partial<PageSearch> = {
    mem: values.mem === DEFAULT_MEMORY ? undefined : values.mem,
    wisp: relays.length ? relays : undefined,
  };
  for (const b of browsers) {
    const text = values.flags[b.id] ?? "";
    search[`flags-${b.id}`] = flagLines(text).join("\n") === b.flags.defaults.join("\n") ? undefined : text;
  }
  return search;
}
