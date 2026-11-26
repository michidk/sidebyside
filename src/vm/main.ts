// One VM: boot unkernel, mount the browser's closure at /nix/store, start the Wayland relay,
// and launch the browser on the page's URL.
// vm.html?browser=<id>&url=<url>[&mem=MiB][&cpus=1-4][&wisp=wss://…][&flags=one per line][&mobile=1]
// The page may later post { type: "mobile", on } or { type: "navigate", url }: the running browser
// follows without a reboot (see apply() in main()).
import type * as Unkernel from "unkernel";
import { BROWSERS, DEFAULT_RELAYS, flagError, flagLines, type Browser } from "../modules/browsers/browsers.ts";
import { parseMobile, parseNavigate, type ConsoleMessage, type UsageMessage } from "../modules/vm-frame/messages.ts";
import { forgetSavedVm, loadSavedVm, saveVm, type SavedVmMeta } from "../modules/vm-frame/saved-vms.ts";
import { connectControl, type Control } from "./control.ts";
import { attachDesktop, sessionEnv, startRelay } from "./gui.ts";
import { logView } from "./log-view.ts";
import { Store, type Manifest } from "./store.ts";

type Vm = Unkernel.KernelHandle;

// unkernel's sizes; anything else falls back to 2048. Not 4096: the guest network never comes up
// with it (unkernel 0.2.0-261123), so the browsers report no internet.
const MEMORY_SIZES = [1024, 2048];

const params = new URLSearchParams(location.search);
const url = params.get("url") ?? "https://example.com/";
const relays = params.getAll("wisp").length ? params.getAll("wisp") : DEFAULT_RELAYS;
const memoryMiB = MEMORY_SIZES.find((m) => m === Number(params.get("mem"))) ?? 2048;
const mobile = params.get("mobile") === "1";
// unkernel falls back to one CPU where it can't start more (it logs why).
const cpus = Math.max(1, Math.min(4, Math.floor(Number(params.get("cpus"))) || 1));

// The boot screen: a progress bar over a console-like log, hidden once a window shows.
const bootEl = document.getElementById("boot")!;
const barEl = document.getElementById("progress")!;
const log = logView(document.getElementById("log")!, 1000);
const line = (text: string, kind: "step" | "ok" | "guest" | "err") => log.add("", [[kind, text]]);
const step = (text: string) => line(text, "step");
const guest = (text: string) => line(text, "guest");
const mib = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MiB`;

// The bar only moves forward: steps set a floor, downloads fill toward the browser's usual start size.
let shown = 0;
function progress(percent: number) {
  shown = Math.max(shown, Math.min(100, percent));
  (barEl.firstElementChild as HTMLElement).style.width = `${shown}%`;
  barEl.setAttribute("aria-valuenow", String(Math.round(shown)));
}
function fail(text: string) {
  bootEl.hidden = false;
  bootEl.classList.add("error");
  line(text, "err");
  console.error(text);
}

// A program's output a line at a time, without colour codes or blank lines.
function lines(onLine: (line: string) => void) {
  const text = new TextDecoder();
  let pending = "";
  return new WritableStream<Uint8Array>({
    write(bytes) {
      const ls = (pending + text.decode(bytes, { stream: true })).replace(/\x1b\[[0-9;?]*[A-Za-z]|\r/g, "").split("\n");
      pending = ls.pop()!;
      for (const l of ls) if (l.trim()) onLine(l);
    },
  });
}

// The browser's output goes to the boot log; its web-console lines also to the page's console.
function guestOutput(browser: Browser) {
  return lines((l) => {
    guest(l);
    const message = browser.console?.(l);
    if (message) parent.postMessage({ type: "console", browser: browser.id, ...message } satisfies ConsoleMessage, location.origin);
  });
}

// The page's resource panel: every 2 s a shell loop prints the guest's CPU and memory counters
// (shell builtins only, so a sample costs the guest no more than one sleep), and the kernel
// counts the bytes through the relay.
const USAGE_SCRIPT = `while :; do
  read -r l < /proc/stat; echo "$l"
  while read -r k v _; do case $k in MemTotal:|MemAvailable:) echo "$k $v";; esac; done < /proc/meminfo
  echo end; sleep 2
done`;

async function reportUsage(vm: Vm, browser: Browser) {
  const proc = await vm.spawn("/bin/sh", ["-c", USAGE_SCRIPT]);
  const now = { busy: 0, total: 0, memTotal: 0, memAvailable: 0 };
  let last: { busy: number; total: number; rx: number; tx: number; at: number } | undefined;
  return proc.output.pipeTo(lines((l) => {
    const [key, ...values] = l.trim().split(/\s+/);
    if (key === "cpu") {
      // user nice system idle iowait irq softirq steal …, in clock ticks since boot
      const n = values.map(Number);
      now.total = n.reduce((a, b) => a + b, 0);
      now.busy = now.total - n[3]! - (n[4] ?? 0);
    } else if (key === "MemTotal:") now.memTotal = Number(values[0]) * 1024;
    else if (key === "MemAvailable:") now.memAvailable = Number(values[0]) * 1024;
    else if (key === "end") {
      const stats = vm.stats();
      const sample = { busy: now.busy, total: now.total, rx: stats.net?.rx ?? 0, tx: stats.net?.tx ?? 0, at: performance.now() };
      if (last && sample.total > last.total) {
        const seconds = (sample.at - last.at) / 1000;
        parent.postMessage({
          type: "usage",
          browser: browser.id,
          cpu: (sample.busy - last.busy) / (sample.total - last.total),
          cpus: stats.cpus,
          memUsed: now.memTotal - now.memAvailable,
          memTotal: now.memTotal,
          rx: (sample.rx - last.rx) / seconds,
          tx: (sample.tx - last.tx) / seconds,
        } satisfies UsageMessage, location.origin);
      }
      last = sample;
    }
  }));
}

async function run(vm: Vm, script: string, what: string, opts: Omit<Unkernel.ExecOptions, "encoding"> = {}) {
  const r = await vm.exec("/bin/sh", ["-c", script], opts);
  if (r.exitCode !== 0) throw new Error(`${what}: ${r.stderr.trim() || `exit ${r.exitCode}`}`);
}

// What the browsers expect of a system: dbus wants a machine id; GnuTLS (Epiphany) reads only the
// system CA path, not SSL_CERT_FILE; fontconfig needs a config naming the only fonts there are.
function systemFiles(vm: Vm, store: Manifest["store"]) {
  const fonts = `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig>
<dir>${store.dejavu_fonts}/share/fonts</dir><cachedir>/tmp/fontconfig</cachedir>
<alias><family>sans-serif</family><prefer><family>DejaVu Sans</family></prefer></alias>
<alias><family>serif</family><prefer><family>DejaVu Serif</family></prefer></alias>
<alias><family>monospace</family><prefer><family>DejaVu Sans Mono</family></prefer></alias>
</fontconfig>
`;
  return run(vm, [
    "tr -d - < /proc/sys/kernel/random/uuid > /etc/machine-id",
    "mkdir -p /etc/ssl/certs /etc/fonts /root",
    `ln -sf ${store.cacert}/etc/ssl/certs/ca-bundle.crt /etc/ssl/certs/ca-certificates.crt`,
    "cat > /etc/fonts/fonts.conf",
  ].join(" && "), "system files", { input: fonts });
}

async function main() {
  const found = BROWSERS.find((b) => b.id === params.get("browser"));
  if (!found) throw new Error(`unknown browser "${params.get("browser")}"`);
  const browser: Browser = found;
  if (!crossOriginIsolated) throw new Error("the page is not cross-origin isolated; reload it");

  // Everything that doesn't depend on the kernel starts at once.
  const unkernel: Promise<typeof Unkernel> = import(new URL("vendor/unkernel/web.mjs", location.href).href);
  const manifest: Promise<Manifest> = fetch(`closures/${browser.id}.json`).then((r) => r.json());
  const relay = fetch("vendor/wlandr").then(async (r) => new Uint8Array(await r.arrayBuffer()));

  const { checkSupport, createKernel, decodeSnapshot, encodeSnapshot } = await unkernel;
  const support = await checkSupport();
  if (!support.ok) throw new Error(`this browser can't run the VM: ${support.problems.join("; ")}`);

  progress(2);
  step(`${browser.label} (${browser.engine}) → ${url}`);
  const { store: paths, roots } = await manifest;
  const expected = browser.startupMiB * 2 ** 20;
  const store = new Store(await manifest, (e, stats) => {
    const name = e.basename.slice(33);
    if (e.type === "fetched") line(`✓ ${name}  ${mib(e.bytes)}`, "ok");
    else line(`✗ ${name}: ${e.error}`, "err");
    progress(20 + 75 * Math.min(1, stats.bytes / expected));
  });
  // The browser's own paths download while Linux boots.
  for (const root of roots) store.prefetch(root, true);

  // The browser's tuning flags (absent: its defaults); the page checked them, but links are shareable.
  const flags = params.has("flags") ? flagLines(params.get("flags")!) : browser.flags.defaults;
  const bad = flags.map((f) => flagError(browser.flags.kind, f)).find(Boolean);
  if (bad) throw new Error(`flags: ${bad}`);

  // A saved VM resumes only on the same machine: memory, CPUs, flags, and this frame's build.
  const key = `${browser.id}.${await digest({ memoryMiB, cpus, flags, frame: params.get("v") })}`;
  // requestTimeout 0: a lookup waits as long as its download does.
  const storeMount = { fs: store, readOnly: true, requestTimeout: 0 };
  const machine = {
    worker: true,
    memoryMiB,
    cpus,
    shm: true,
    net: { kind: "net" as const, backend: { kind: "wisp" as const, servers: relays } },
    log: guest,
  };

  let vm: Vm | undefined;
  let resumed: { meta: SavedVmMeta; ttys: Unkernel.TtySessionSnapshot[] } | undefined;
  const saved = await loadSavedVm(key);
  if (saved) {
    step("Resuming the saved VM");
    try {
      const snapshot = decodeSnapshot(saved.bytes);
      // A restore that stalls (it has, with several large ones loading at once) boots instead. Not
      // AbortSignal.timeout(): the VM keeps listening to the signal after it has started.
      const stalled = new AbortController();
      const timer = setTimeout(() => stalled.abort(new Error("the restore took over 2 minutes")), 120_000);
      vm = await createKernel({
        ...machine,
        restore: snapshot,
        transferRestore: true,
        mounts: { "/nix/store": storeMount },
        signal: stalled.signal,
      }).finally(() => clearTimeout(timer));
      resumed = { meta: saved.meta, ttys: snapshot.ttys ?? [] };
    } catch (err) {
      guest(`The saved VM did not resume (${(err as Error)?.message ?? err}); booting instead`);
      await forgetSavedVm(key);
    }
  }
  if (!vm) {
    step(`Booting Linux on ${cpus} CPU${cpus > 1 ? "s" : ""}`);
    vm = await createKernel(machine);
  }
  // In closures below: TypeScript forgets that vm was set.
  const booted: Vm = vm;
  booted.exited.then(({ kind, reason }) => fail(`The VM stopped: ${kind}${reason ? ` (${reason})` : ""}`));
  progress(10);

  if (!resumed) {
    step("Mounting /nix/store from cache.nixos.org");
    await run(booted, "mkdir -p /nix/store", "mkdir /nix/store");
    await booted.mount("/nix/store", store, storeMount);
  }

  const desktop = document.getElementById("desktop")!;
  desktop.classList.toggle("phone", mobile);
  let windowShown!: () => void;
  const firstWindow = new Promise<void>((resolve) => (windowShown = resolve));
  attachDesktop(booted, desktop, () => {
    windowShown();
    progress(100);
    step(`${browser.label} is up`);
    setTimeout(() => (bootEl.hidden = !bootEl.classList.contains("error")), 400);
  }, guest);
  // A resumed VM's relay is still running in it and dials the page again by itself.
  if (!resumed) {
    step("Starting the Wayland relay");
    await Promise.all([startRelay(booted, await relay), systemFiles(booted, paths)]);
  }
  progress(15);
  reportUsage(booted, browser).catch((err) => console.warn(`resource usage: ${err?.message ?? err}`));
  const launchFor = (at: string, phone: boolean) => browser.launch(at, paths, { mobile: phone, flags });

  // The running browser; it is cleared first when we stop it, so its exit isn't reported.
  let current: Unkernel.Pty | undefined;
  async function start(at: string, phone: boolean) {
    const launch = launchFor(at, phone);
    const env = {
      PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: "/root",
      LANG: "C.UTF-8",
      TERM: "xterm-256color",
      FONTCONFIG_FILE: "/etc/fonts/fonts.conf",
      SSL_CERT_FILE: `${paths.cacert}/etc/ssl/certs/ca-bundle.crt`,
      ...sessionEnv,
      ...launch.env,
    };
    if (launch.setup) await run(booted, launch.setup, "browser setup", { env });
    // Detachable: the session survives in a saved VM, and a resumed VM attaches to it again.
    adopt(await booted.spawn(launch.program, launch.args, { env, cols: 160, rows: 50, detachable: true }));
  }
  function adopt(proc: Unkernel.Pty) {
    current = proc;
    // The guest program stalls if nobody reads its output.
    proc.output.pipeTo(guestOutput(browser));
    proc.ended.then((end) => {
      if (current === proc) fail(`${browser.label} exited (${JSON.stringify(end)})`);
    });
  }
  // The browser and everything it started (its process group): asked to quit, so Firefox can
  // release its profile, then killed if still there after 10 s.
  async function stop() {
    const proc = current!;
    current = undefined;
    await booted.exec("/bin/sh", ["-c", `kill -s TERM -- -${proc.pid}
for i in 1 2 3 4 5 6 7 8 9 10; do kill -s 0 -- -${proc.pid} 2>/dev/null || exit 0; sleep 1; done
kill -s KILL -- -${proc.pid}`]);
    await proc.ended.catch(() => {});
  }

  // unkernel opens its relay connection on the first TCP connect and gives up after 10 s;
  // a browser starting up keeps the VM too busy for that, so connect once first.
  step("Connecting to the internet relay");
  // Only the connection matters: busybox wget can't check TLS certificates, so https fails after it.
  await booted.exec("/bin/sh", ["-c", 'wget -q -O /dev/null -T 20 "$1"', "sh", url]).catch(() => {});

  // What the browser shows: its URL, and whether it sends the mobile user agent. A browser with
  // remote control starts with its own user agent and switches through it, so it can switch back;
  // in mobile mode it opens the page only after switching.
  // A resumed browser shows what it showed when saved; remote control sessions, and the user
  // agents they set, ended with the save.
  let now = resumed
    ? { url: resumed.meta.url, mobile: browser.remote ? false : resumed.meta.mobile }
    : { url: browser.remote && mobile ? "about:blank" : url, mobile: browser.remote ? false : mobile };
  progress(20);
  if (resumed) {
    const tty = resumed.ttys[0];
    if (!tty) throw new Error("the saved VM has no browser session");
    adopt(await booted.attach(tty, { cols: 160, rows: 50 }));
  } else {
    step(`Starting ${browser.label}; packages download as it opens them`);
    await start(now.url, now.mobile);
  }
  let control: Promise<Control | null> = browser.remote
    ? connectControl(booted, browser, 300_000, guest).then(
        (c) => (guest(`Remote control ready (${browser.remote?.protocol === "cdp" ? "DevTools protocol" : "WebDriver BiDi"})`), c),
        (err) => (guest(`No remote control: ${err?.message ?? err}`), null),
      )
    : Promise.resolve(null);

  // Bring the browser to what the page wants: through its remote control, or else by restarting
  // it (the VM keeps running), and only if its launch command changes. The window resizes at once.
  async function apply() {
    const want = { url: wantUrl, mobile: wantMobile };
    desktop.classList.toggle("phone", want.mobile);
    if (want.url === now.url && want.mobile === now.mobile) return;
    const remote = await control;
    if (remote) {
      try {
        if (want.mobile !== now.mobile) await remote.setMobile(want.mobile, want.url === now.url);
        if (want.url !== now.url) await remote.navigate(want.url);
        now = want;
        return;
      } catch (err) {
        guest(`${browser.label}'s remote control failed (${(err as Error)?.message ?? err}); restarting it instead`);
        control = Promise.resolve(null);
      }
    }
    if (JSON.stringify(launchFor(want.url, want.mobile)) !== JSON.stringify(launchFor(now.url, now.mobile))) {
      bootEl.hidden = false;
      step(`Restarting ${browser.label}`);
      await stop();
      await start(want.url, want.mobile);
    }
    now = want;
  }
  // Save a freshly booted VM once its browser has settled, so the next visit resumes it. The
  // kernel waits at a consistent point while the snapshot is written, then runs on. A save fails
  // while the browser is reading /nix/store; it is tried again a little later.
  async function save() {
    await Promise.all([firstWindow, control]);
    await new Promise((r) => setTimeout(r, 10_000));
    for (let attempt = 1; ; attempt++) {
      try {
        await booted.snapshot({
          commitTimeoutMs: 300_000,
          commit: async (snapshot) => {
            const busy = (snapshot as { hostBusy?: string }).hostBusy;
            if (busy) throw new Error(busy);
            await saveVm(key, encodeSnapshot(snapshot) as Uint8Array<ArrayBuffer>, now);
          },
          hold: () => "continue",
        });
        guest("Saved this VM: the next visit resumes it");
        return;
      } catch (err) {
        await forgetSavedVm(key);
        if (attempt === 5) return guest(`Could not save this VM: ${(err as Error)?.message ?? err}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  // Changes queue behind each other; each applies the latest wishes.
  let applying = Promise.resolve();
  changed = () => (applying = applying.then(apply).catch((err) => fail(String(err?.message ?? err))));
  changed();
  if (!resumed) applying = applying.then(save).catch((err) => guest(`Could not save this VM: ${err?.message ?? err}`));
}

// A short hash of `value`, for file names.
async function digest(value: unknown) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(hash).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// What the page wants shown: listened for from the start, applied once the browser runs.
let wantUrl = url;
let wantMobile = mobile;
let changed: (() => void) | undefined;
addEventListener("message", ({ source, origin, data }) => {
  if (source !== parent || origin !== location.origin) return;
  const toMobile = parseMobile(data);
  const toUrl = parseNavigate(data);
  if (toMobile) wantMobile = toMobile.on;
  else if (toUrl) wantUrl = toUrl.url;
  else return;
  changed?.();
});

main().catch((err) => fail(String(err?.message ?? err)));
