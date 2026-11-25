// The browsers on the page: which nixpkgs packages each VM gets (resolved
// to aarch64 store paths at build time by scripts/closures.ts), how the
// guest starts it, and how to spot its web console in its output.
// `store` maps each attribute to its /nix/store path.

export interface Launch {
  program: string;
  args: string[];
  env?: Record<string, string>;
  // Shell run before the program (as root, HOME set), e.g. to write config.
  setup?: string;
}

export interface LaunchOptions {
  // Pretend to be a phone: a mobile user agent (the VM page also makes the window phone-sized).
  mobile: boolean;
  // The user's tuning flags (see Browser.flags), already checked with flagError.
  flags: string[];
}

// How a browser takes tuning flags: Firefox prefs ("name=value", value in JSON), Chromium
// switches ("--name[=value]"), or environment variables ("NAME=value").
export type FlagKind = "pref" | "switch" | "env";

const FLAG_FORMS: Record<FlagKind, { pattern: RegExp; example: string }> = {
  pref: { pattern: /^[\w.-]+=(.+)$/, example: "name=value (true, 1 or \"text\")" },
  switch: { pattern: /^--[\w-]+(=.+)?$/, example: "--switch or --switch=value" },
  env: { pattern: /^[A-Za-z_]\w*=.*$/, example: "NAME=value" },
};
export const flagExample = (kind: FlagKind) => FLAG_FORMS[kind].example;

// The flags in a settings field: one per line; blank lines and # comments don't count.
export const flagLines = (text: string) => text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

// Why a flag line is malformed, or null. They reach the guest from shareable links, so a pref
// value must be a JSON boolean, number or string (it goes into user.js as is).
export function flagError(kind: FlagKind, line: string): string | null {
  const m = line.match(FLAG_FORMS[kind].pattern);
  if (!m) return `"${line}" is not ${FLAG_FORMS[kind].example}`;
  if (kind !== "pref") return null;
  try {
    if (["boolean", "number", "string"].includes(typeof JSON.parse(m[1]!))) return null;
  } catch {}
  return `"${line}": the value must be true, false, a number or a "quoted string"`;
}

// Checked pref lines as user.js lines.
const userPrefs = (lines: string[]) =>
  lines.map((l) => {
    const at = l.indexOf("=");
    return `user_pref(${JSON.stringify(l.slice(0, at))}, ${JSON.stringify(JSON.parse(l.slice(at + 1)))});`;
  });

export type ConsoleLevel = "log" | "info" | "warn" | "error" | "debug";
export interface ConsoleMessage {
  level: ConsoleLevel;
  text: string;
}

export interface Browser {
  id: string;
  label: string;
  engine: string;
  // Shown when the link names no browsers. The others are a pick away in the browser menu.
  byDefault: boolean;
  // attr or attr@version from the nixmultiverse index; the first is the browser.
  packages: string[];
  // About what a first start downloads (measured), for the progress bar.
  startupMiB: number;
  // Tuning the user can edit in Settings. The defaults switch off what testing a page doesn't
  // need (updates, telemetry, sync, safe browsing, extra processes), which starts the browser
  // sooner and saves memory in the VM.
  flags: { kind: FlagKind; defaults: string[] };
  launch(url: string, store: Record<string, string>, opts: LaunchOptions): Launch;
  // How the VM page controls the running browser (navigate, switch its user agent) through a
  // server it runs on the guest's 127.0.0.1:REMOTE_PORT: the DevTools protocol or WebDriver BiDi.
  // Absent: the browser restarts for a new URL or user agent.
  remote?: { protocol: "cdp" | "bidi"; mobileUA: string };
  // A web-console message, if this line of the browser's output is one. Absent: the browser
  // can't print its console (Epiphany).
  console?(line: string): ConsoleMessage | null;
}

// Public Wisp relays that accept any origin; unkernel races them. They see which hosts the
// browsers connect to, and anything not encrypted. The page's settings (?wisp=) override them.
export const DEFAULT_RELAYS = ["wss://wisp.mercurywork.shop/", "wss://anura.pro/"];

// Every VM also gets fonts (nothing in a closure ships one) and CA certificates.
export const COMMON_PACKAGES = ["dejavu_fonts", "cacert"];

// The phone each engine would really run on.
export const REMOTE_PORT = 9222;

const MOBILE_UA = {
  firefox: "Mozilla/5.0 (Android 15; Mobile; rv:160.0) Gecko/160.0 Firefox/160.0",
  chromium: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Mobile Safari/537.36",
  epiphany: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};

const levelOf = (word: string): ConsoleLevel => {
  const w = word.toLowerCase();
  if (w.startsWith("warn")) return "warn";
  if (w.startsWith("err")) return "error";
  if (w === "info" || w === "debug") return w;
  return "log";
};

// Firefox and its ESR: the same profile setup, a different package.
function gecko(id: string, label: string, attr: string, binary: string, byDefault: boolean, startupMiB: number): Browser {
  return {
    id,
    label,
    engine: "Gecko",
    byDefault,
    packages: [attr],
    startupMiB,
    flags: {
      kind: "pref",
      defaults: [
        // One content process, no site isolation, none started ahead of time.
        "fission.autostart=false",
        "dom.ipc.processCount=1",
        "dom.ipc.processPrelaunch.enabled=false",
        // Nothing the browser fetches for itself.
        "app.update.auto=false",
        "app.normandy.enabled=false",
        "extensions.update.enabled=false",
        "extensions.getAddons.cache.enabled=false",
        "media.gmp-manager.updateEnabled=false",
        "browser.search.update=false",
        "browser.region.update.enabled=false",
        "services.settings.server=\"data:,remote-settings-off/v1\"",
        "browser.safebrowsing.malware.enabled=false",
        "browser.safebrowsing.phishing.enabled=false",
        "browser.safebrowsing.downloads.enabled=false",
        "network.captive-portal-service.enabled=false",
        "network.connectivity-service.enabled=false",
        "browser.places.speculativeConnect.enabled=false",
        "browser.urlbar.speculativeConnect.enabled=false",
        "toolkit.telemetry.enabled=false",
        "datareporting.healthreport.uploadEnabled=false",
        "datareporting.policy.dataSubmissionEnabled=false",
        // Features a test run doesn't use.
        "browser.ml.enable=false",
        "browser.translations.enable=false",
        "extensions.pocket.enabled=false",
        "identity.fxaccounts.enabled=false",
        "browser.newtabpage.enabled=false",
        "browser.shell.checkDefaultBrowser=false",
        "browser.sessionstore.resume_from_crash=false",
        "accessibility.force_disabled=1",
        // The cache lives in VM memory either way; on "disk" it would be kept twice.
        "browser.cache.disk.enable=false",
      ],
    },
    remote: { protocol: "bidi", mobileUA: MOBILE_UA.firefox },
    launch: (url, s, { mobile, flags }) => ({
      program: `${s[attr]}/bin/${binary}`,
      args: ["--new-instance", "--profile", "/root/firefox", "--remote-debugging-port", String(REMOTE_PORT), url],
      // No GTK accessibility bridge (it waits on a D-Bus service the VM doesn't have), no crash reporter.
      env: { NO_AT_BRIDGE: "1", MOZ_CRASHREPORTER_DISABLE: "1" },
      // Every VM is a first run: skip the privacy-notice tab and the welcome page. Firefox also
      // goes offline (NS_ERROR_OFFLINE) when it doesn't see a network link it recognises; the VM's
      // virtual network is always up, so it must not manage offline mode itself. Pages' console
      // messages go to stdout, for the page's console. data: URLs may open, since the URL is the user's.
      setup: `mkdir -p /root/firefox && cat > /root/firefox/user.js <<'EOF'
user_pref("network.manage-offline-status", false);
user_pref("network.offline-mirrors-connectivity", false);
user_pref("datareporting.policy.firstRunURL", "");
user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.aboutwelcome.enabled", false);
user_pref("devtools.console.stdout.content", true);
user_pref("security.data_uri.block_toplevel_data_uri_navigations", false);
user_pref("remote.prefs.recommended", false);
${userPrefs(flags).join("\n")}
${mobile ? `user_pref("general.useragent.override", "${MOBILE_UA.firefox}");` : ""}
EOF`,
    }),
    // "console.warn: text", and uncaught errors as "JavaScript error: url, line N: message".
    console(line) {
      const m = line.match(/^console\.(\w+): (.*)$/) ?? line.match(/^JavaScript (error|warning): (.*)$/);
      return m ? { level: levelOf(m[1]!), text: m[2]! } : null;
    },
  };
}

export const BROWSERS: Browser[] = [
  gecko("firefox", "Firefox", "firefox", "firefox", true, 260),
  {
    id: "chromium",
    label: "Chromium",
    engine: "Blink",
    byDefault: true,
    packages: ["chromium"],
    startupMiB: 290,
    flags: {
      kind: "switch",
      defaults: [
        // Nothing the browser fetches for itself.
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--disable-domain-reliability",
        "--disable-client-side-phishing-detection",
        "--metrics-recording-only",
        "--no-pings",
        // Features a test run doesn't use.
        "--disable-extensions",
        "--disable-default-apps",
        "--disable-breakpad",
        "--no-default-browser-check",
        "--mute-audio",
        // Passwords in a plain file: no keyring lookup over D-Bus at startup.
        "--password-store=basic",
        // One renderer per site rather than per frame origin, and no translate or media-router services.
        "--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication,IsolateOrigins,site-per-process",
      ],
    },
    remote: { protocol: "cdp", mobileUA: MOBILE_UA.chromium },
    launch: (url, s, { mobile, flags }) => ({
      program: `${s.chromium}/bin/chromium`,
      // No sandbox or zygote: the guest has no user namespaces for them. No GPU: the VM has none.
      // --test-type hides the "unsupported command-line flag: --no-sandbox" bar. Logging to stderr
      // carries pages' console messages.
      args: [
        "--no-sandbox", "--no-zygote", "--disable-gpu", "--ozone-platform=wayland", "--no-first-run", "--test-type",
        "--enable-logging=stderr", "--log-level=0",
        `--remote-debugging-port=${REMOTE_PORT}`, "--user-data-dir=/root/chromium",
        ...flags,
        ...(mobile ? [`--user-agent=${MOBILE_UA.chromium}`] : []),
        url,
      ],
    }),
    // [pid:tid:time:INFO:CONSOLE(12)] "text", source: https://… (12)
    console(line) {
      const m = line.match(/:(\w+):CONSOLE[^\]]*\] "(.*)", source: (.*)$/);
      if (!m) return null;
      // Chromium logs every console message at INFO; only uncaught exceptions are recognisable.
      const level = m[1] === "ERROR" || m[2]!.startsWith("Uncaught ") ? "error" : m[1] === "WARNING" ? "warn" : "log";
      return { level, text: m[3] ? `${m[2]}  (${m[3]})` : m[2]! };
    },
  },
  {
    id: "epiphany",
    label: "Epiphany",
    engine: "WebKit",
    byDefault: true,
    packages: ["epiphany", "dbus"],
    startupMiB: 250,
    flags: {
      kind: "env",
      defaults: [
        // GTK draws with cairo rather than trying OpenGL first: the VM has no GPU.
        "GSK_RENDERER=cairo",
        // No accessibility bus (a D-Bus service the VM doesn't have).
        "GTK_A11Y=none",
      ],
    },
    launch: (url, s, { mobile, flags }) => ({
      // Epiphany exits without a session bus.
      program: `${s.dbus}/bin/dbus-run-session`,
      args: [`--config-file=${s.dbus}/share/dbus-1/session.conf`, `--dbus-daemon=${s.dbus}/bin/dbus-daemon`, "--", `${s.epiphany}/bin/epiphany`, url],
      env: {
        GSETTINGS_BACKEND: "keyfile",
        WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1",
        ...Object.fromEntries(flags.map((f) => [f.slice(0, f.indexOf("=")), f.slice(f.indexOf("=") + 1)])),
      },
      // No "set as default browser?" prompt, and no ad-block lists: they download through the relay
      // at startup, and the other browsers don't block ads either.
      setup: `mkdir -p "$HOME/.config/glib-2.0/settings" && cat > "$HOME/.config/glib-2.0/settings/keyfile" <<'EOF'
[org/gnome/epiphany]
ask-for-default=false
restore-session-policy='never'
content-filters=@as []
${mobile ? `[org/gnome/epiphany/web]\nuser-agent='${MOBILE_UA.epiphany}'` : ""}
EOF`,
    }),
    // No console: Epiphany can't print it (WebKitGTK's write-console-messages-to-stdout setting isn't
    // exposed, and this build has no WEBKIT_DEBUG channel for it).
  },
  gecko("firefox-esr", "Firefox ESR", "firefox-esr", "firefox-esr", false, 260),
  {
    id: "netsurf",
    label: "NetSurf",
    engine: "NetSurf",
    byDefault: false,
    packages: ["netsurf-browser"],
    startupMiB: 60,
    flags: { kind: "env", defaults: [] },
    launch: (url, s, { flags }) => ({
      program: `${s["netsurf-browser"]}/bin/netsurf-gtk3`,
      args: [url],
      env: { NO_AT_BRIDGE: "1", ...Object.fromEntries(flags.map((f) => [f.slice(0, f.indexOf("=")), f.slice(f.indexOf("=") + 1)])) },
    }),
  },
];
