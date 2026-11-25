import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DEFAULT_RELAYS, flagExample, type Browser, type FlagKind } from "@/modules/browsers/browsers";
import { MEMORY_SIZES } from "../-lib/search";
import { checkFlags, checkRelays, defaultFlags, type SettingsValues } from "../-lib/settings";

const FLAG_KINDS: Record<FlagKind, string> = { pref: "about:config prefs", switch: "command-line switches", env: "environment variables" };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  values: SettingsValues;
  onChange: (values: SettingsValues) => void;
  // Flags are shown for these browsers only: the ones with a pane.
  browsers: Browser[];
  stats: boolean;
  onStatsChange: (on: boolean) => void;
  onRelayHelp: () => void;
}

// Applied when Open is pressed, except resource use, which shows or hides at once.
export function SettingsPopover({ open, onOpenChange, values, onChange, browsers, stats, onStatsChange, onRelayHelp }: Props) {
  const relays = checkRelays(values.relays);
  const setFlags = (id: string, text: string) => onChange({ ...values, flags: { ...values.flags, [id]: text } });

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<Button variant="outline" />}>Settings</PopoverTrigger>
      <PopoverContent align="end" className="max-h-[calc(100svh-5rem)] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto">
        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel>RAM per VM</FieldLabel>
            <ToggleGroup
              variant="outline"
              value={[values.mem]}
              onValueChange={(v) => v[0] && onChange({ ...values, mem: v[0] })}
            >
              {MEMORY_SIZES.map((m) => (
                <ToggleGroupItem key={m} value={m}>
                  {Number(m) / 1024} GiB
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field orientation="horizontal">
            <Switch id="stats" checked={stats} onCheckedChange={onStatsChange} />
            <FieldLabel htmlFor="stats" className="font-normal">
              Show each browser's CPU, memory and network use
            </FieldLabel>
          </Field>

          <Field data-invalid={!relays.ok || undefined}>
            <FieldLabel htmlFor="wisp">Wisp relay</FieldLabel>
            <Input
              id="wisp"
              spellCheck={false}
              autoComplete="off"
              placeholder={DEFAULT_RELAYS.join(" ")}
              value={values.relays}
              aria-invalid={!relays.ok || undefined}
              onChange={(e) => onChange({ ...values, relays: e.target.value })}
            />
            <FieldError>{!relays.ok && relays.error}</FieldError>
            <FieldDescription>
              Empty uses the public relays shown. Several URLs, separated by spaces, are raced. A relay sees which sites
              the browsers open.
            </FieldDescription>
            <Button variant="link" className="h-auto justify-start p-0" onClick={onRelayHelp}>
              Faster: run the relay on your computer…
            </Button>
          </Field>

          {browsers.length > 0 && (
            <>
              <Separator />
              {/* min-w-0: a fieldset is otherwise as wide as its longest flag line. */}
              <FieldSet className="min-w-0">
                <FieldLegend>Browser flags</FieldLegend>
                <FieldDescription>
                  The defaults turn off what testing a page doesn't need (updates, telemetry, sync, extra processes), so
                  the browsers start sooner and use less memory. One per line; lines starting with # are ignored.
                </FieldDescription>
                {browsers.map((b) => {
                  const text = values.flags[b.id] ?? defaultFlags(b);
                  const checked = checkFlags(b, text);
                  return (
                    <Field key={b.id} data-invalid={!checked.ok || undefined}>
                      <FieldLabel htmlFor={`flags-${b.id}`}>
                        {b.label}
                        <span className="font-normal text-muted-foreground">
                          {FLAG_KINDS[b.flags.kind]}: {flagExample(b.flags.kind)}
                        </span>
                      </FieldLabel>
                      <Textarea
                        id={`flags-${b.id}`}
                        rows={5}
                        spellCheck={false}
                        className="field-sizing-fixed resize-y font-mono text-xs"
                        value={text}
                        aria-invalid={!checked.ok || undefined}
                        onChange={(e) => setFlags(b.id, e.target.value)}
                      />
                      <FieldError>{!checked.ok && checked.error}</FieldError>
                    </Field>
                  );
                })}
                <Button
                  variant="outline"
                  className="justify-self-start"
                  onClick={() => onChange({ ...values, flags: Object.fromEntries(browsers.map((b) => [b.id, defaultFlags(b)])) })}
                >
                  Reset to defaults
                </Button>
              </FieldSet>
            </>
          )}
          <p className="text-xs text-muted-foreground">Changes apply when you press Open.</p>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
}
