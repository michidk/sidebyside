// Controls a running browser from the page, without restarting it: navigate, and switch between
// its own and a mobile user agent. Chromium through the DevTools protocol, Firefox through
// WebDriver BiDi, both on the guest's 127.0.0.1:REMOTE_PORT, reached with vm.connect().
import type * as Unkernel from "unkernel";
import { REMOTE_PORT, type Browser } from "../modules/browsers/browsers.ts";
import { openWebSocket } from "./ws.ts";

export interface Control {
  navigate(url: string): Promise<void>;
  // Takes effect with the next load; reload: load the current page again now.
  setMobile(on: boolean, reload: boolean): Promise<void>;
}

type Vm = Unkernel.KernelHandle;
type Json = Record<string, unknown>;

// A step that may hang (a connection the guest never answers) fails after `ms` instead.
const within = <T>(ms: number, what: string, p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms))]);

// Commands and their answers over one WebSocket ({ id, method, params } → { id, result | error }),
// and close(), which ends the connection (and a BiDi session on it).
async function rpc(vm: Vm, path: string) {
  const pending = new Map<number, { resolve: (r: Json) => void; reject: (e: Error) => void }>();
  let next = 1;
  const sock = await vm.connect(REMOTE_PORT, { timeout: 10_000 });
  const ws = await within(30_000, "the WebSocket handshake", openWebSocket(sock, `127.0.0.1:${REMOTE_PORT}`, path, (text) => {
    const m = JSON.parse(text) as { id?: number; result?: Json; error?: unknown; message?: string };
    const call = m.id === undefined ? undefined : pending.get(m.id);
    if (!call) return; // an event
    pending.delete(m.id!);
    if (m.error) call.reject(new Error(m.message ?? JSON.stringify(m.error)));
    else call.resolve(m.result ?? {});
  }));
  ws.closed.finally(() => {
    for (const call of pending.values()) call.reject(new Error("the remote-control connection closed"));
    pending.clear();
  });
  const call = (method: string, params: Json = {}, ms = 60_000) =>
    within(
      ms,
      method,
      new Promise<Json>((resolve, reject) => {
        const id = next++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params })).catch(reject);
      }),
    );
  return { call, close: () => void sock.close().catch(() => {}) };
}

// Set up a controller on a fresh connection; a failed setup closes it, so nothing is left behind.
async function attempt(vm: Vm, path: string, setup: (call: Awaited<ReturnType<typeof rpc>>["call"]) => Promise<Control>) {
  const conn = await rpc(vm, path);
  try {
    return await setup(conn.call);
  } catch (err) {
    conn.close();
    throw err;
  }
}

// Chromium: a session on its first tab. Overrides last as long as the session, so it stays open.
async function cdp(vm: Vm, mobileUA: string): Promise<Control> {
  const targets = (await (await vm.fetch(`http://127.0.0.1:${REMOTE_PORT}/json/list`)).json()) as {
    type: string;
    webSocketDebuggerUrl: string;
  }[];
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("Chromium has no tab to control");
  return attempt(vm, new URL(page.webSocketDebuggerUrl).pathname, async (call) => {
    const own = String((await call("Browser.getVersion")).userAgent);
    return {
      navigate: async (url) => void (await call("Page.navigate", { url })),
      async setMobile(on, reload) {
        await call("Emulation.setUserAgentOverride", { userAgent: on ? mobileUA : own });
        if (reload) await call("Page.reload");
      },
    };
  });
}

// Firefox: a BiDi session on its first top-level browsing context; the user agent applies to all.
async function bidi(vm: Vm, mobileUA: string): Promise<Control> {
  return attempt(vm, "/session", async (call) => {
    // Firefox answers only once its first page has loaded, which can take minutes in the VM.
    await call("session.new", { capabilities: {} }, 600_000);
    const tree = (await call("browsingContext.getTree", { maxDepth: 0 })) as { contexts: { context: string }[] };
    const context = tree.contexts[0]?.context;
    if (!context) throw new Error("Firefox has no tab to control");
    return {
      navigate: async (url) => void (await call("browsingContext.navigate", { context, url, wait: "none" })),
      async setMobile(on, reload) {
        await call("emulation.setUserAgentOverride", { userAgent: on ? mobileUA : null });
        if (reload) await call("browsingContext.reload", { context, wait: "none" });
      },
    };
  });
}

// Connect to the browser's remote-control server, retrying while it starts (up to `timeout` ms).
// `log` hears why an attempt failed (not the refused connections while the server starts).
export async function connectControl(vm: Vm, browser: Browser, timeout: number, log: (text: string) => void): Promise<Control> {
  const remote = browser.remote;
  if (!remote) throw new Error(`${browser.label} has no remote control`);
  const until = Date.now() + timeout;
  for (;;) {
    try {
      return await (remote.protocol === "cdp" ? cdp : bidi)(vm, remote.mobileUA);
    } catch (err) {
      if (Date.now() > until) throw err;
      const why = String((err as Error)?.message ?? err);
      if (!why.includes("ECONNREFUSED")) log(`Remote control not ready: ${why}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
