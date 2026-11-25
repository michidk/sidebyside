import { getRouteApi } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BROWSERS, type Browser } from "@/modules/browsers/browsers";
import type { MobileMessage, NavigateMessage } from "@/modules/vm-frame/messages";
import { useConsoleLog } from "../-hooks/use-console-log";
import { useUsage } from "../-hooks/use-usage";
import { frameSrc, type Run } from "../-lib/frame";
import { browsersParam, shownBrowsers, type PageSearch } from "../-lib/search";
import { checkFlags, checkRelays, settingsFromSearch, settingsSearch } from "../-lib/settings";
import { BrowserMenu } from "./browser-menu";
import { BrowserPane } from "./browser-pane";
import { ConsolePanel } from "./console-panel";
import { RelayHelpDialog } from "./relay-help-dialog";
import { SettingsPopover } from "./settings-popover";

const route = getRouteApi("/");

// One URL in every chosen browser, side by side, each in a VM of its own (an iframe).
export function ComparePage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const update = useCallback(
    (patch: Partial<PageSearch>) => navigate({ search: (old) => ({ ...old, ...patch }), replace: true }),
    [navigate],
  );

  const shown = useMemo(() => shownBrowsers(search.browsers), [search.browsers]);
  const mobile = search.mobile === true;
  const [url, setUrl] = useState(search.url ?? "https://example.com/");
  const [settings, setSettings] = useState(() => settingsFromSearch(search, BROWSERS));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [relayHelpOpen, setRelayHelpOpen] = useState(false);

  // What Open started, and each pane's frame URL, fixed when the pane starts.
  const [run, setRun] = useState<Run | null>(null);
  const [panes, setPanes] = useState<Record<string, string>>({});
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const mobileNow = useRef(mobile);
  mobileNow.current = mobile;

  const consoleLog = useConsoleLog(frames, search.console === true);
  const usage = useUsage(frames);

  // Panes follow the browser menu: a new one starts, a removed one stops, the others keep running.
  useEffect(() => {
    if (!run) return;
    setPanes((old) =>
      Object.fromEntries(shown.map((b) => [b.id, old[b.id] ?? frameSrc(b, run, { mobile: mobileNow.current, panes: shown.length })])),
    );
  }, [run, shown]);

  function open(e?: FormEvent) {
    e?.preventDefault();
    const relays = checkRelays(settings.relays);
    const flags = BROWSERS.map((b) => [b, checkFlags(b, settings.flags[b.id] ?? "")] as const);
    if (!relays.ok || flags.some(([b, f]) => !f.ok && shown.includes(b))) {
      setSettingsOpen(true);
      return;
    }
    if (!URL.canParse(url)) return;
    const target = new URL(url).href;
    const vms = {
      mem: settings.mem,
      relays: relays.value,
      // A hidden browser's malformed flags fall back to its defaults if it's added later.
      flags: Object.fromEntries(flags.map(([b, f]) => [b.id, f.ok ? f.value : b.flags.defaults])),
    };
    update({ url: target, ...settingsSearch(settings, relays.value, BROWSERS) });
    // A new URL for the same VMs: the running browsers open it. Otherwise (other settings, or Open
    // again on the same URL) every VM starts over.
    if (run && target !== run.url && JSON.stringify(vms) === JSON.stringify({ mem: run.mem, relays: run.relays, flags: run.flags })) {
      setRun({ ...run, url: target });
      for (const frame of frames.current.values())
        frame.contentWindow?.postMessage({ type: "navigate", url: target } satisfies NavigateMessage, location.origin);
      return;
    }
    setRun((old) => ({ id: (old?.id ?? 0) + 1, url: target, ...vms }));
    setPanes({});
  }

  // A link with a URL opens it right away.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !search.url) return;
    opened.current = true;
    open();
  });

  // Each VM switches mobile mode itself, without a reboot (see src/vm/main.ts).
  const tellMobile = (frame: HTMLIFrameElement, on: boolean) =>
    frame.contentWindow?.postMessage({ type: "mobile", on } satisfies MobileMessage, location.origin);
  function setMobile(on: boolean) {
    update({ mobile: on || undefined });
    for (const frame of frames.current.values()) tellMobile(frame, on);
  }

  const setShown = (next: Browser[]) => update({ browsers: browsersParam(next) });
  const paneBrowsers = run ? BROWSERS.filter((b) => panes[b.id]) : [];

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <form onSubmit={open} className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <Input
          type="url"
          required
          aria-label="URL to open"
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="min-w-64 flex-1"
        />
        <BrowserMenu shown={shown} onChange={setShown} />
        <Label className="cursor-pointer px-1">
          <Switch checked={mobile} onCheckedChange={setMobile} />
          Mobile
        </Label>
        <SettingsPopover
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          values={settings}
          onChange={setSettings}
          browsers={shown}
          stats={search.stats === true}
          onStatsChange={(on) => update({ stats: on || undefined })}
          onRelayHelp={() => {
            setSettingsOpen(false);
            setRelayHelpOpen(true);
          }}
        />
        <Button
          type="button"
          variant={search.console ? "secondary" : "outline"}
          aria-expanded={search.console === true}
          onClick={() => update({ console: !search.console || undefined })}
        >
          Console
          {consoleLog.unseen > 0 && <Badge variant="destructive">{consoleLog.unseen}</Badge>}
        </Button>
        <Button type="submit">Open</Button>
        <a href="https://github.com/michidk/sidebyside" target="_blank" rel="noopener" className={buttonVariants({ variant: "ghost" })}>
          GitHub
        </a>
      </form>

      <main className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(360px,1fr))]">
        {paneBrowsers.map((b) => (
          <BrowserPane
            key={`${run!.id}:${b.id}`}
            browser={b}
            src={panes[b.id]!}
            order={shown.indexOf(b)}
            stats={search.stats === true}
            usage={usage[b.id]}
            frameRef={(frame) => (frame ? frames.current.set(b.id, frame) : frames.current.delete(b.id))}
            // Mobile mode may have changed since the frame's URL was made.
            onLoad={() => {
              const frame = frames.current.get(b.id);
              if (frame) tellMobile(frame, mobileNow.current);
            }}
          />
        ))}
        {paneBrowsers.length === 0 && (
          <p className="col-span-full self-center justify-self-center p-8 text-center text-muted-foreground">
            {run ? "Pick a browser in the Browsers menu." : "Enter a URL and press Open to see it in each browser."}
          </p>
        )}
      </main>

      {search.console && <ConsolePanel rows={consoleLog.rows} onClear={consoleLog.clear} />}
      <RelayHelpDialog
        open={relayHelpOpen}
        onOpenChange={setRelayHelpOpen}
        onUse={(relay) => setSettings((s) => ({ ...s, relays: relay }))}
      />
    </div>
  );
}
