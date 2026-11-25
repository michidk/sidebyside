import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ConsoleLevel } from "@/modules/browsers/browsers";
import { parseConsole } from "@/modules/vm-frame/messages";
import { useFrameMessages } from "./use-frame-messages";

const MAX_ROWS = 1000;

export interface ConsoleRow {
  id: number;
  seconds: number;
  browser: string;
  level: ConsoleLevel;
  text: string;
}

// Every browser's web-console lines, newest last. Lines come in bursts of hundreds, so they are
// added once per frame; `unseen` counts the ones that came while the console was closed.
export function useConsoleLog(frames: RefObject<Map<string, HTMLIFrameElement>>, open: boolean) {
  const [rows, setRows] = useState<ConsoleRow[]>([]);
  const [unseen, setUnseen] = useState(0);
  const pending = useRef<ConsoleRow[]>([]);
  const nextId = useRef(0);
  const flushing = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (open) setUnseen(0);
  }, [open]);
  useEffect(() => () => cancelAnimationFrame(flushing.current), []);

  useFrameMessages(frames, (browser, data) => {
    const message = parseConsole(data);
    if (!message) return;
    pending.current.push({ id: nextId.current++, seconds: performance.now() / 1000, browser, level: message.level, text: message.text });
    if (flushing.current) return;
    flushing.current = requestAnimationFrame(() => {
      flushing.current = 0;
      const added = pending.current;
      pending.current = [];
      setRows((old) => [...old, ...added].slice(-MAX_ROWS));
      if (!openRef.current) setUnseen((n) => n + added.length);
    });
  });

  const clear = useCallback(() => {
    pending.current = [];
    setRows([]);
  }, []);
  return { rows, unseen, clear };
}
