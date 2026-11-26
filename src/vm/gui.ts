// Wayland windows from the guest, composited in the page by wland.
// The relay (wlandr) runs in the guest and dials the page over vsock; app pixels stay in
// guest shared memory (kwshm), which the compositor reads in place. The buffer source and
// relay flags follow trynix's site/js/gui.js (MIT, Copyright (c) 2026 Farid Zakaria).
import type { KernelHandle } from "unkernel/web";

const WAYLAND_PORT = 1023;
const HOST_CID = 2;
const RUNTIME_DIR = "/run/user/0";
const DISPLAY = "wayland-0";
const RELAY = "/usr/local/bin/wlandr";
const RELAY_LOG = `${RUNTIME_DIR}/wlandr.log`;

export const sessionEnv = {
  XDG_RUNTIME_DIR: RUNTIME_DIR,
  WAYLAND_DISPLAY: DISPLAY,
  XDG_SESSION_TYPE: "wayland",
  GDK_BACKEND: "wayland",
  MOZ_ENABLE_WAYLAND: "1",
};

type Vm = KernelHandle;
const sh = (vm: Vm, script: string, input?: Uint8Array) => vm.exec("/bin/sh", ["-c", script], { input });

// Copy the relay into the guest, start it, and wait for its socket.
export async function startRelay(vm: Vm, relay: Uint8Array) {
  const put = await sh(vm, `mkdir -p /usr/local/bin && cat > ${RELAY} && chmod 755 ${RELAY}`, relay);
  if (put.exitCode !== 0) throw new Error(`could not install the relay: ${put.stderr}`);
  const started = await sh(vm, [
    `mkdir -p -m 700 ${RUNTIME_DIR}`,
    // --profile session: the compositor runs in the relay and the page only views it, so the
    // browser keeps its window when the link drops, as when a saved VM resumes (it dials again).
    `XDG_RUNTIME_DIR=${RUNTIME_DIR} setsid ${RELAY} --link vsock:${HOST_CID}:${WAYLAND_PORT} --buffers copy` +
      ` --display ${DISPLAY} --xwayland off --profile session < /dev/null > ${RELAY_LOG} 2>&1 &`,
    // Up to 10 s for the socket; the relay's log if it died instead.
    `for i in $(seq 100); do [ -S ${RUNTIME_DIR}/${DISPLAY} ] && exit 0; sleep 0.1; done; cat ${RELAY_LOG} >&2; exit 1`,
  ].join("\n"));
  if (started.exitCode !== 0) throw new Error(`the relay did not start: ${started.stderr.trim()}`);
}

// Reads app buffers out of guest shared memory, in place where the page shares the kernel's memory.
function kwshmSource(shm: NonNullable<Vm["shm"]>) {
  type File = Awaited<ReturnType<typeof shm.openId>>;
  const again = (err: unknown) => (err as { code?: string })?.code === "EAGAIN";
  const readv = (file: File, reads: { offset: number; dst: Uint8Array }[]) => {
    if (file.inPlace) {
      try {
        for (const r of reads) file.readSync(r.offset, r.dst.length, r.dst);
        return;
      } catch (err) {
        if (!again(err)) throw err;
      }
    }
    return Promise.all(reads.map(async (r) => r.dst.set(await file.read(r.offset, r.dst.length)))).then(() => {});
  };
  return {
    async open(handle: { kind: string; id: number; size: number }) {
      if (handle.kind !== "kwshm") throw new Error(`a ${handle.kind} buffer; the relay must run with --buffers kwshm`);
      const file = await shm.openId(handle.id);
      if (file.size !== handle.size) {
        file.close();
        throw new Error(`kwshm ${handle.id} is ${file.size} bytes, the relay says ${handle.size}`);
      }
      return file;
    },
    close: (file: File) => void file.close(),
    view(file: File, offset: number, length: number) {
      if (!file.inPlace) return null;
      try {
        return file.views(offset, length);
      } catch (err) {
        if (again(err)) return null;
        throw err;
      }
    },
    readv,
    read: (file: File, offset: number, dst: Uint8Array) => readv(file, [{ offset, dst }]),
  };
}

// Show the guest's windows in `container`, each maximized to fill it.
export function attachDesktop(vm: Vm, container: HTMLElement, onWindowShown: () => void, log: (m: string) => void) {
  if (!vm.vsock || !vm.shm) throw new Error("the kernel has no vsock or kwshm");
  const listener = vm.vsock.listen(WAYLAND_PORT);
  (async () => {
    const first = await listener.accept();
    if (!first) return;
    async function* connections() {
      yield first;
      for (let next = await listener.accept(); next; next = await listener.accept()) yield next;
    }
    const link = Object.assign(connections(), { close: () => listener.close() });
    const wland = await import(new URL("../vendor/wland/client.mjs", import.meta.url).href);
    const maximized = new WeakSet<object>();
    let shown = false;
    // Assigned below; onWindowsChange can fire before createWland resolves.
    let desktop: { windows(): { setMaximized(on: boolean): void }[] } | null = null;
    desktop = await wland.createWland({
      container,
      link: wland.createStreamLink(link),
      buffers: kwshmSource(vm.shm!),
      webgl: "never",
      onWindowsChange() {
        for (const w of desktop?.windows() ?? []) {
          if (!maximized.has(w)) {
            maximized.add(w);
            w.setMaximized(true);
          }
        }
        // Each time a window appears where there was none: at start, and after a browser restart.
        const any = Boolean(desktop?.windows().length);
        if (any && !shown) onWindowShown();
        shown = any;
      },
      onEvent(e: { type: string; detail?: string }) {
        if (e.type === "error") log(`wland: ${e.detail}`);
      },
    });
  })().catch((err) => log(`the compositor did not start: ${err.message ?? err}`));
}
