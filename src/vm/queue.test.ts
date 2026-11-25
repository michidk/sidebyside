// The Store's download queue, with fetch replaced by tiny local NARs.
import { afterEach, expect, test } from "bun:test";
import { Store, type Manifest } from "./store.ts";

const NIX32 = "0123456789abcdfghijklmnpqrsvwxyz";
const nix32 = (h: Uint8Array) => {
  let out = "";
  for (let n = Math.ceil((h.length * 8) / 5) - 1; n >= 0; n--) {
    const b = n * 5, i = b >> 3, j = b & 7;
    out += NIX32[((h[i]! >> j) | ((h[i + 1] ?? 0) << (8 - j))) & 31];
  }
  return out;
};
const str = (t: string | Uint8Array) => {
  const b = typeof t === "string" ? new TextEncoder().encode(t) : t;
  const out = new Uint8Array(8 + Math.ceil(b.length / 8) * 8);
  new DataView(out.buffer).setBigUint64(0, BigInt(b.length), true);
  out.set(b, 8);
  return out;
};
const fileNar = (text: string) =>
  new Uint8Array(Buffer.concat(["nix-archive-1", "(", "type", "regular", "contents", new TextEncoder().encode(text), ")"].map(str)));

const realFetch = globalThis.fetch;
afterEach(() => void (globalThis.fetch = realFetch));

async function setup(count: number) {
  const nars = new Map<string, Uint8Array>();
  const manifest: Manifest = { store: {}, roots: [], paths: {} };
  for (let i = 0; i < count; i++) {
    const basename = `${String(i).padStart(32, "0")}-p${i}`;
    const nar = fileNar(`file ${i}`);
    const url = `https://cache.test/nar/${i}.nar`;
    nars.set(url, nar);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", nar));
    manifest.paths[basename] = { url, compression: "none", fileSize: nar.length, narHash: `sha256:${nix32(hash)}`, narSize: nar.length, references: [] };
  }
  const started: string[] = [];
  const release: (() => void)[] = [];
  let failNext = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    started.push(url);
    await new Promise<void>((r) => release.push(r));
    if (failNext) {
      failNext = false;
      return new Response("", { status: 503 });
    }
    return new Response(nars.get(url)!.slice());
  }) as typeof fetch;
  return { manifest, started, release, failOnce: () => (failNext = true), names: Object.keys(manifest.paths) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("runs at most 6 downloads and starts urgent ones first", async () => {
  const { manifest, started, release, names } = await setup(9);
  const store = new Store(manifest);
  for (const n of names.slice(0, 8)) store.prefetch(n);
  const urgent = store.open(`/${names[8]}`);
  await tick();
  expect(started.length).toBe(6);
  release.shift()!();
  await tick();
  expect(started[6]).toContain("/8.nar"); // jumped the two queued prefetches
  while (release.length) {
    release.shift()!();
    await tick();
  }
  const file = await urgent;
  expect(new TextDecoder().decode(await file.read(0, 6))).toBe("file 8");
  expect(store.stats.fetched).toBe(9);
});

test("a failed download is retried by the next read", async () => {
  const { manifest, release, names, failOnce } = await setup(1);
  const store = new Store(manifest);
  failOnce();
  const first = store.open(`/${names[0]}`);
  await tick();
  release.shift()!();
  await expect(first).rejects.toThrow(/HTTP 503/);
  const second = store.open(`/${names[0]}`);
  await tick();
  release.shift()!();
  expect((await second).read(0, 4)).toEqual(new TextEncoder().encode("file"));
});
