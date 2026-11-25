import { useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { BROWSERS } from "@/modules/browsers/browsers";
import { cn } from "@/lib/utils";
import type { ConsoleRow } from "../-hooks/use-console-log";

const TAG_COLORS: Record<string, string> = {
  firefox: "text-orange-600 dark:text-orange-400",
  "firefox-esr": "text-orange-700 dark:text-orange-300",
  chromium: "text-blue-600 dark:text-blue-400",
  epiphany: "text-green-600 dark:text-green-400",
  netsurf: "text-purple-600 dark:text-purple-400",
};

interface Props {
  rows: ConsoleRow[];
  onClear: () => void;
}

// Every browser's web-console messages in one list, newest last. It stays scrolled to the
// bottom unless the reader scrolled up.
export function ConsolePanel({ rows, onClear }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    if (atBottom.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [rows]);

  return (
    <section aria-label="Console" className="flex h-[32vh] flex-none flex-col border-t bg-background">
      <header className="flex items-center gap-3 border-b py-1 pr-2 pl-4 text-sm">
        <strong>Console</strong>
        <span className="flex-1 truncate text-muted-foreground">
          Web-console messages from the browsers (Epiphany and NetSurf can't report theirs)
        </span>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      </header>
      <div
        ref={list}
        role="log"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="flex-1 overflow-y-auto font-mono text-xs leading-relaxed"
      >
        {rows.map((row) => (
          <div
            key={row.id}
            className={cn(
              "grid grid-cols-[4.5em_7.5em_1fr] gap-2 border-b border-border/50 px-4 py-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]",
              row.level === "warn" && "bg-yellow-500/15",
              row.level === "error" && "bg-destructive/15 text-destructive",
            )}
          >
            <span className="text-right text-muted-foreground">{row.seconds.toFixed(1)}s</span>
            <span className={cn("font-semibold", TAG_COLORS[row.browser])}>
              {BROWSERS.find((b) => b.id === row.browser)?.label}
            </span>
            <span>{row.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
