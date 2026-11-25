import { useState, type RefObject } from "react";
import { parseUsage, type UsageMessage } from "@/modules/vm-frame/messages";
import { useFrameMessages } from "./use-frame-messages";

export const CPU_HISTORY = 30; // samples, every 2 s: a minute

export interface Usage extends UsageMessage {
  cpuHistory: number[];
}

// Each VM's latest resource sample, with its recent CPU use.
export function useUsage(frames: RefObject<Map<string, HTMLIFrameElement>>) {
  const [usage, setUsage] = useState<Record<string, Usage>>({});
  useFrameMessages(frames, (browser, data) => {
    const sample = parseUsage(data);
    if (!sample) return;
    setUsage((all) => ({
      ...all,
      [browser]: { ...sample, cpuHistory: [...(all[browser]?.cpuHistory ?? []), sample.cpu].slice(-CPU_HISTORY) },
    }));
  });
  return usage;
}
