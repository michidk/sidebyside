import { expect, test } from "bun:test";
import { parseConsole, parseMobile, parseNavigate, parseUsage } from "./messages.ts";

const usage = { type: "usage", browser: "chromium", cpu: 0.4, cpus: 4, memUsed: 1, memTotal: 2, rx: 0, tx: 0 };

test("usage samples are checked", () => {
  expect(parseUsage(usage)).toEqual(usage as never);
  expect(parseUsage({ ...usage, cpu: 1.5 })?.cpu).toBe(1);
  expect(parseUsage({ ...usage, browser: "nope" })).toBeUndefined();
  expect(parseUsage({ ...usage, memTotal: 0 })).toBeUndefined();
  expect(parseUsage({ ...usage, rx: "1" })).toBeUndefined();
  expect(parseUsage({ ...usage, tx: Number.NaN })).toBeUndefined();
});

test("console lines get a known level", () => {
  expect(parseConsole({ type: "console", browser: "firefox", level: "warn", text: "x" })?.level).toBe("warn");
  expect(parseConsole({ type: "console", browser: "firefox", level: "<b>", text: 1 })).toEqual({
    type: "console", browser: "firefox", level: "log", text: "1",
  });
  expect(parseConsole({ type: "console", browser: "evil", text: "x" })).toBeUndefined();
});

test("mobile switches are booleans", () => {
  expect(parseMobile({ type: "mobile", on: true })).toEqual({ type: "mobile", on: true });
  expect(parseMobile({ type: "mobile", on: "yes" })?.on).toBe(false);
  expect(parseMobile({ type: "usage" })).toBeUndefined();
});

test("navigation takes only a URL", () => {
  expect(parseNavigate({ type: "navigate", url: "https://example.com/" })).toEqual({ type: "navigate", url: "https://example.com/" });
  expect(parseNavigate({ type: "navigate", url: "not a url" })).toBeUndefined();
  expect(parseNavigate({ type: "navigate", url: 1 })).toBeUndefined();
});
