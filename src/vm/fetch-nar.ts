// Getting one store path's NAR: download (or reuse a cached copy), decompress off the main
// thread, and check it against the NarHash the build pinned.
import { checkHash } from "./nar.ts";

export interface PathInfo {
  url: string;
  compression: string;
  fileSize: number;
  narHash: string;
  narSize: number;
  references: string[];
}

// The three VMs share most of their closures (about 600 MiB of 1.4 GiB), and a revisit needs
// all of it again, so compressed NARs go in Cache Storage, which every VM frame of this origin
// shares. A Web Lock per URL makes the other VMs wait for a download in progress instead of
// starting their own.
// shortcut: entries for paths a newer build no longer uses stay until the browser evicts the
// origin's storage; delete caches by name when a rebuild makes that matter.
const CACHE = "nars-v1";

async function download(info: PathInfo): Promise<Uint8Array<ArrayBuffer>> {
  const get = async () => {
    const res = await fetch(info.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length !== info.fileSize) throw new Error(`download is ${bytes.length} bytes, expected ${info.fileSize}`);
    return bytes;
  };
  // Bun (the tests) has neither.
  if (!globalThis.caches || !globalThis.navigator?.locks) return get();
  return navigator.locks.request(`nar ${info.url}`, async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(info.url);
    if (hit) {
      const bytes = new Uint8Array(await hit.arrayBuffer());
      if (bytes.length === info.fileSize) return bytes;
    }
    const bytes = await get();
    // Response copies the bytes. Out of quota is fine: the page works uncached.
    await cache.put(info.url, new Response(bytes)).catch(() => {});
    return bytes;
  });
}

// zstd decoders, made on first use. Several, because one would serialize the parallel downloads.
const DECODERS = 2;
type Job = { resolve: (out: Uint8Array<ArrayBuffer>) => void; reject: (err: Error) => void };
const decoders: { worker: Worker; jobs: Map<number, Job> }[] = [];
let nextId = 0;

function decoder() {
  if (decoders.length < DECODERS) {
    const jobs = new Map<number, Job>();
    // With the bundle's version (?v=…), so a new build doesn't use a cached older decoder.
    const worker = new Worker(new URL(`./unzstd.worker.js${new URL(import.meta.url).search}`, import.meta.url), { type: "module" });
    const d = { worker, jobs };
    worker.onmessage = ({ data }) => {
      const job = jobs.get(data.id);
      jobs.delete(data.id);
      if (data.error) job?.reject(new Error(data.error));
      else job?.resolve(data.out);
    };
    // A crashed decoder (out of memory on a huge NAR) fails what it held; the next unpack makes a new one.
    worker.onerror = (e) => {
      for (const job of jobs.values()) job.reject(new Error(`the NAR decoder crashed: ${e.message}`));
      worker.terminate();
      decoders.splice(decoders.indexOf(d), 1);
    };
    decoders.push(d);
    return d;
  }
  return decoders.reduce((a, b) => (b.jobs.size < a.jobs.size ? b : a));
}

function unpack(info: PathInfo, compressed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  // scripts/closures.ts only lets zstd and uncompressed NARs through.
  if (info.compression === "none") return Promise.resolve(compressed);
  const { worker, jobs } = decoder();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    worker.postMessage({ id, compressed, size: info.narSize }, [compressed.buffer]);
  });
}

// The verified, uncompressed NAR. `what` names the path in errors.
export async function fetchNar(info: PathInfo, what: string): Promise<Uint8Array<ArrayBuffer>> {
  const nar = await unpack(info, await download(info).catch((err) => {
    throw new Error(`${what}: ${err.message ?? err}`);
  }));
  await checkHash(nar, info.narHash, what);
  return nar;
}
