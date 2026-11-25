import { useEffect, useRef, type RefObject } from "react";

// Messages from our own VM frames only: same origin, and sent by the frame of the browser the
// message names.
export function useFrameMessages(
  frames: RefObject<Map<string, HTMLIFrameElement>>,
  onMessage: (browser: string, data: unknown) => void,
) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  useEffect(() => {
    const listener = ({ origin, source, data }: MessageEvent) => {
      if (origin !== location.origin) return;
      const browser = (data as { browser?: unknown } | null)?.browser;
      if (typeof browser !== "string" || frames.current.get(browser)?.contentWindow !== source) return;
      handler.current(browser, data);
    };
    addEventListener("message", listener);
    return () => removeEventListener("message", listener);
  }, [frames]);
}
