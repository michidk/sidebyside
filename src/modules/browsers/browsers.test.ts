import { expect, test } from "bun:test";
import { BROWSERS, flagError, flagLines } from "./browsers.ts";

const byId = (id: string) => BROWSERS.find((b) => b.id === id)!;

test("Firefox console lines", () => {
  const ff = byId("firefox") as Required<ReturnType<typeof byId>>;
  expect(ff.console('console.warn: "careful" 3')).toEqual({ level: "warn", text: '"careful" 3' });
  expect(ff.console("JavaScript error: https://x.test/a.js, line 2: TypeError: y is null")).toEqual({
    level: "error",
    text: "https://x.test/a.js, line 2: TypeError: y is null",
  });
  expect(ff.console("[GFX1-]: vaapitest failed")).toBeNull();
});

test("Chromium console lines", () => {
  const cr = byId("chromium") as Required<ReturnType<typeof byId>>;
  expect(cr.console('[96:96:1124/162855.293105:INFO:CONSOLE(12)] "hello, world", source: https://x.test/ (12)')).toEqual({
    level: "log",
    text: "hello, world  (https://x.test/ (12))",
  });
  expect(cr.console('[1:1:0101/000000.0:ERROR:CONSOLE:3] "boom", source: https://x.test/ (3)')?.level).toBe("error");
  expect(cr.console('[97:97:1124/174628.075605:INFO:CONSOLE:1] "Uncaught Error: boom", source: https://x.test/ (1)')?.level).toBe("error");
  expect(cr.console("[96:117:1124/162845.456805:ERROR:dbus/bus.cc:405] Failed to connect to the bus")).toBeNull();
});

// Ladybird, Servo and NetSurf have no user-agent option: in mobile mode they get only the phone-sized window.
test("mobile mode sets a mobile user agent where the browser has an option for it", () => {
  const store = { firefox: "/f", "firefox-esr": "/fe", chromium: "/c", epiphany: "/e", dbus: "/d" };
  for (const b of ["firefox", "firefox-esr", "chromium", "epiphany"].map(byId)) {
    const l = b.launch("https://x.test/", store, { mobile: true, flags: [] });
    expect(`${l.args.join(" ")} ${l.setup ?? ""}`).toMatch(/Mobile/);
    const d = b.launch("https://x.test/", store, { mobile: false, flags: [] });
    expect(`${d.args.join(" ")} ${d.setup ?? ""}`).not.toMatch(/Mobile/);
  }
});

test("every browser's default flags are well-formed", () => {
  for (const b of BROWSERS) for (const f of b.flags.defaults) expect(flagError(b.flags.kind, f)).toBeNull();
});

test("malformed flags are refused", () => {
  expect(flagError("pref", "a.b=true")).toBeNull();
  expect(flagError("pref", 'a.b="x"')).toBeNull();
  expect(flagError("pref", "a.b=x")).toMatch(/value must be/);
  expect(flagError("pref", 'a.b={"x":1}')).toMatch(/value must be/);
  expect(flagError("pref", '");\nEOF\nrm -rf /;("=1')).not.toBeNull();
  expect(flagError("switch", "--a-b=1")).toBeNull();
  expect(flagError("switch", "-a")).not.toBeNull();
  expect(flagError("env", "A_B=1")).toBeNull();
  expect(flagError("env", "1A=x")).not.toBeNull();
  expect(flagLines(" --a \n\n# off\n--b")).toEqual(["--a", "--b"]);
});

test("flags reach each browser", () => {
  const store = { firefox: "/f", chromium: "/c", epiphany: "/e", dbus: "/d" };
  const ff = byId("firefox").launch("u", store, { mobile: false, flags: ['a.b="q\\"x"'] });
  expect(ff.setup).toContain('user_pref("a.b", "q\\"x");');
  expect(byId("chromium").launch("u", store, { mobile: false, flags: ["--x=1"] }).args).toContain("--x=1");
  expect(byId("epiphany").launch("u", store, { mobile: false, flags: ["A=b=c"] }).env?.A).toBe("b=c");
});
