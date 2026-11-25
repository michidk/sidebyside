import { expect, test } from "bun:test";
import { BROWSERS } from "@/modules/browsers/browsers";
import { checkFlags, checkRelays, settingsFromSearch, settingsSearch } from "./settings.ts";

const firefox = BROWSERS.find((b) => b.id === "firefox")!;

test("relays must be WebSocket URLs", () => {
  expect(checkRelays(" wss://a.test/, ws://127.0.0.1:5001/ ")).toEqual({ ok: true, value: ["wss://a.test/", "ws://127.0.0.1:5001/"] });
  expect(checkRelays("")).toEqual({ ok: true, value: [] });
  expect(checkRelays("https://a.test/").ok).toBe(false);
});

test("flags are checked line by line", () => {
  expect(checkFlags(firefox, "a.b=true\n# off\n")).toEqual({ ok: true, value: ["a.b=true"] });
  expect(checkFlags(firefox, "a.b=x").ok).toBe(false);
});

test("only settings that differ from the defaults go in the link", () => {
  const values = settingsFromSearch({}, BROWSERS);
  expect(settingsSearch(values, [], BROWSERS)).toEqual(Object.fromEntries([["mem", undefined], ["wisp", undefined], ...BROWSERS.map((b) => [`flags-${b.id}`, undefined])]));
  const changed = { ...values, mem: "1024", flags: { ...values.flags, firefox: "a.b=true" } };
  const search = settingsSearch(changed, ["wss://a/"], BROWSERS);
  expect([search.mem, search.wisp, search["flags-firefox"]]).toEqual(["1024", ["wss://a/"], "a.b=true"]);
});
