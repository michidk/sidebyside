import { expect, test } from "bun:test";
import { browsersParam, shownBrowsers, validateSearch } from "./search.ts";

test("links are read leniently and strictly", () => {
  const s = validateSearch({ url: "https://x.test/", mem: "4096", wisp: ["wss://a/", ""], mobile: "1", console: "0", "flags-firefox": "a=1" });
  expect(s.url).toBe("https://x.test/");
  expect(s.mem).toBeUndefined(); // not a size the VMs boot with
  expect(s.wisp).toEqual(["wss://a/"]);
  expect(s.mobile).toBe(true);
  expect(s.console).toBeUndefined();
  expect(s["flags-firefox"]).toBe("a=1");
});

test("browser panes: link order, unknown ids dropped, defaults when absent", () => {
  expect(shownBrowsers("netsurf,nope,firefox").map((b) => b.id)).toEqual(["netsurf", "firefox"]);
  expect(shownBrowsers(undefined).map((b) => b.id)).toEqual(["firefox", "chromium", "epiphany"]);
  expect(shownBrowsers("").map((b) => b.id)).toEqual([]);
  expect(browsersParam(shownBrowsers(undefined))).toBeUndefined();
  expect(browsersParam(shownBrowsers("chromium,firefox"))).toBe("chromium,firefox");
});
