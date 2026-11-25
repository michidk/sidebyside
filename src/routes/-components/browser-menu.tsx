import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from "@/components/ui/popover";
import { BROWSERS, type Browser } from "@/modules/browsers/browsers";

interface Props {
  // The browsers with a pane, in pane order.
  shown: Browser[];
  onChange: (shown: Browser[]) => void;
}

// Which browsers get a pane, and their order: the shown ones first, in pane order, each with
// arrows to move it; then the others.
export function BrowserMenu({ shown, onChange }: Props) {
  const list = useRef<HTMLUListElement>(null);
  const hidden = BROWSERS.filter((b) => !shown.includes(b));

  const toggle = (b: Browser, on: boolean) => onChange(on ? [...shown, b] : shown.filter((s) => s !== b));
  function move(b: Browser, by: -1 | 1) {
    const at = shown.indexOf(b);
    const next = [...shown];
    [next[at], next[at + by]] = [next[at + by]!, next[at]!];
    onChange(next);
    // Keep focus on the pressed arrow as its row moves; at an end, that arrow is gone, so the other.
    const end = at + by === 0 || at + by === shown.length - 1;
    requestAnimationFrame(() =>
      list.current?.querySelector<HTMLButtonElement>(`[data-move="${b.id}:${end ? -by : by}"]`)?.focus(),
    );
  }

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>
        Browsers <span className="text-muted-foreground">({shown.length})</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverDescription>
          Each browser runs in a VM of its own, so every one you add needs more memory and CPU. The arrows set the order
          of the panes.
        </PopoverDescription>
        <ul ref={list} aria-label="Browsers, in the order of their panes" className="grid gap-0.5">
          {[...shown, ...hidden].map((b) => {
            const at = shown.indexOf(b);
            return (
              <li key={b.id} className="flex items-center gap-1">
                <Label className="flex flex-1 cursor-pointer items-center gap-2 py-1.5">
                  <Checkbox checked={at >= 0} onCheckedChange={(on) => toggle(b, on)} />
                  {b.label} <span className="font-normal text-muted-foreground">{b.engine}</span>
                </Label>
                {at >= 0 && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      data-move={`${b.id}:-1`}
                      aria-label={`Move ${b.label} up`}
                      className={at === 0 ? "invisible" : ""}
                      onClick={() => move(b, -1)}
                    >
                      <ChevronUpIcon />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      data-move={`${b.id}:1`}
                      aria-label={`Move ${b.label} down`}
                      className={at === shown.length - 1 ? "invisible" : ""}
                      onClick={() => move(b, 1)}
                    >
                      <ChevronDownIcon />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
