// /nix/store for the guest, served lazily from cache.nixos.org (which allows cross-origin
// reads). A path's NAR listing answers stat, readdir and readlink; reading a file's bytes
// fetches the path's whole NAR (fetch-nar.ts). Touching a path prefetches its small
// references, which is what a program usually opens next.
import type { Fs, FsAttr, FsDirEntry, FsFile } from "unkernel/web";
import { fetchNar, type PathInfo } from "./fetch-nar.ts";
import { parseListing, parseNar, type Node, type Tree } from "./nar.ts";

export type { PathInfo };
export interface Manifest {
  store: Record<string, string>;
  roots: string[];
  paths: Record<string, PathInfo>;
}
export interface StoreStats {
  fetched: number;
  bytes: number;
}
export type StoreEvent =
  | { type: "fetched"; basename: string; bytes: number }
  | { type: "failed"; basename: string; error: string };

const PARALLEL = 6;
const PREFETCH_MAX_BYTES = 8 * 2 ** 20;
const LISTING_TIMEOUT_MS = 15_000;

// An errno answer for the guest (unkernel maps `code` like Node's fs errors).
const fsError = (code: string, message: string) => Object.assign(new Error(message), { code });

export class Store implements Fs {
  private trees = new Map<string, Tree>();
  private nars = new Map<string, Promise<Tree>>();
  private listings = new Map<string, Promise<Tree | null>>();
  // Downloads waiting for one of the PARALLEL slots; urgent ones (the guest is blocked on them) go first.
  private queue: { basename: string; urgent: boolean; start: () => void }[] = [];
  private running = 0;
  private touched = new Set<string>();
  readonly stats: StoreStats = { fetched: 0, bytes: 0 };

  constructor(private manifest: Manifest, private onEvent: (event: StoreEvent, stats: StoreStats) => void = () => {}) {}

  // Start fetching a path now: what the guest will run first.
  prefetch(basename: string, urgent = false) {
    this.nar(basename, urgent).catch(() => {}); // the guest sees the error when it reads
  }

  private info(basename: string) {
    const info = this.manifest.paths[basename];
    if (!info) throw fsError("ENOENT", `${basename} is not in the closure`);
    return info;
  }

  private nar(basename: string, urgent: boolean): Promise<Tree> {
    let job = this.nars.get(basename);
    if (job) {
      const queued = urgent && this.queue.find((q) => q.basename === basename);
      if (queued) queued.urgent = true;
    } else {
      job = this.load(basename, this.info(basename), urgent);
      this.nars.set(basename, job);
    }
    return job;
  }

  private async load(basename: string, info: PathInfo, urgent: boolean): Promise<Tree> {
    if (this.running < PARALLEL) this.running++;
    else await new Promise<void>((start) => this.queue.push({ basename, urgent, start }));
    try {
      const tree = parseNar(await fetchNar(info, basename));
      this.trees.set(basename, tree);
      this.stats.fetched++;
      this.stats.bytes += info.fileSize;
      this.onEvent({ type: "fetched", basename, bytes: info.fileSize }, this.stats);
      return tree;
    } catch (err) {
      this.nars.delete(basename); // a later read retries
      this.onEvent({ type: "failed", basename, error: String((err as Error)?.message ?? err) }, this.stats);
      throw err;
    } finally {
      // Hand the slot to the next download, or free it.
      const [next] = this.queue.splice(Math.max(0, this.queue.findIndex((q) => q.urgent)), 1);
      if (next) next.start();
      else this.running--;
    }
  }

  private listing(basename: string): Promise<Tree | null> {
    let listing = this.listings.get(basename);
    if (!listing) {
      const url = new URL(`/${basename.slice(0, 32)}.ls`, this.info(basename).url);
      // The cache serves listings zstd-encoded; the browser decodes them.
      listing = fetch(url, { signal: AbortSignal.timeout(LISTING_TIMEOUT_MS) })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => (json ? parseListing(json) : null))
        .catch(() => null); // without a listing the whole NAR answers instead
      this.listings.set(basename, listing);
    }
    return listing;
  }

  // The node at a store-relative path, from the NAR if it is in, else from the listing.
  private async node(path: string, needData: boolean): Promise<Node> {
    const [basename = "", ...rest] = path.split("/").filter(Boolean);
    const rel = rest.join("/");
    if (!this.touched.has(basename)) {
      this.touched.add(basename);
      for (const ref of this.info(basename).references) {
        if ((this.manifest.paths[ref]?.fileSize ?? Infinity) <= PREFETCH_MAX_BYTES) this.prefetch(ref);
      }
    }
    let tree = this.trees.get(basename);
    if (!tree && !needData) tree = (await this.listing(basename)) ?? undefined;
    tree ??= await this.nar(basename, true);
    const node = tree.get(rel);
    if (!node) throw fsError("ENOENT", `${path}: no such file`);
    if (needData && node.type === "file" && !node.data) return (await this.nar(basename, true)).get(rel)!;
    return node;
  }

  async getattr(path: string): Promise<FsAttr> {
    if (path === "/") return { type: "dir", mode: 0o555 };
    const n = await this.node(path, false);
    // Same answers before and after the NAR arrives, or the guest would see files change.
    if (n.type === "file") return { type: "file", mode: n.executable ? 0o555 : 0o444, size: n.size, mtimeMs: 1000 };
    if (n.type === "dir") return { type: "dir", mode: 0o555, mtimeMs: 1000 };
    return { type: "symlink", mode: 0o777, size: n.target.length, mtimeMs: 1000 };
  }

  async readdir(path: string): Promise<FsDirEntry[]> {
    // shortcut: store paths are listed as directories without fetching 300 listings; a single-file
    // store path still stats correctly, only `ls -l /nix/store` would show it wrong.
    if (path === "/") return Object.keys(this.manifest.paths).map((name) => ({ name, type: "dir" }));
    const n = await this.node(path, false);
    if (n.type !== "dir") throw fsError("ENOTDIR", `${path}: not a directory`);
    return Promise.all(n.entries.map(async (name) => ({ name, type: (await this.node(`${path}/${name}`, false)).type })));
  }

  async readlink(path: string): Promise<string> {
    const n = await this.node(path, false);
    if (n.type !== "symlink") throw fsError("EINVAL", `${path}: not a symlink`);
    return n.target;
  }

  async open(path: string): Promise<FsFile> {
    const n = await this.node(path, true);
    if (n.type !== "file") throw fsError(n.type === "dir" ? "EISDIR" : "ELOOP", `${path}: not a regular file`);
    const data = n.data!;
    return { read: (offset, length) => data.subarray(offset, offset + length) };
  }
}
