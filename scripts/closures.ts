// Build step: resolve each browser's packages to aarch64 store paths, walk their runtime
// closures through cache.nixos.org's narinfos, check every narinfo's signature, and write
// public/closures/<id>.json. The page checks each NAR it downloads against the NarHash
// pinned here, so nothing it runs is unverified.
import { createPublicKey, verify } from "node:crypto";
import { BROWSERS, COMMON_PACKAGES } from "../src/modules/browsers/browsers.ts";
import type { PathInfo } from "../src/vm/fetch-nar.ts";

const CACHE = "https://cache.nixos.org";
const INDEX = "https://nixmultiverse.com/meta-aarch64-linux";
// Nix's published key for cache.nixos.org.
const CACHE_KEY = { name: "cache.nixos.org-1", key: "6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY=" };
const OUT = new URL("../public/closures/", import.meta.url).pathname;

const publicKey = createPublicKey({
  key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(CACHE_KEY.key, "base64")]),
  format: "der",
  type: "spki",
});

interface IndexEntry { d: string; n?: string; ok?: number }

async function indexShard(attr: string): Promise<{ attrs?: Record<string, Record<string, IndexEntry>> }> {
  const url = `${INDEX}/${shardOf(attr)}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json() as Promise<{ attrs?: Record<string, Record<string, IndexEntry>> }>;
}
const attrOf = (spec: string) => spec.split("@")[0]!;

// The multiverse index's shard name for an attribute (multiverse's own rule: no padding).
const shardOf = (attr: string) => [...attr.slice(0, 2).toLowerCase()].map((c) => (/[a-z0-9]/.test(c) ? c : "_")).join("") || "_";
const newestFirst = (a: string, b: string) => b.localeCompare(a, "en", { numeric: true });

async function resolve(spec: string): Promise<string> {
  const [attr = "", wanted] = spec.split("@");
  const versions = (await indexShard(attr)).attrs?.[attr];
  if (!versions) throw new Error(`${attr}: not in the aarch64 index`);
  const version = wanted ?? Object.keys(versions).filter((v) => versions[v]?.ok).sort(newestFirst)[0];
  const entry = version === undefined ? undefined : versions[version];
  if (!entry) throw new Error(`${spec}: no such version (have ${Object.keys(versions).sort(newestFirst).slice(0, 5).join(", ")}, ...)`);
  return `/nix/store/${entry.d}-${entry.n ?? `${attr}-${version}`}`;
}

// A narinfo's "Key: value" lines; field() throws for a missing required key.
function parseNarinfo(text: string, what: string) {
  const fields = new Map(text.trim().split("\n").map((line) => {
    const at = line.indexOf(": ");
    return [line.slice(0, at), line.slice(at + 2)] as const;
  }));
  return {
    optional: (key: string) => fields.get(key),
    field(key: string) {
      const value = fields.get(key);
      if (value === undefined) throw new Error(`${what}: narinfo has no ${key}`);
      return value;
    },
  };
}

const narinfos = new Map<string, Promise<PathInfo>>();

function pathInfo(basename: string): Promise<PathInfo> {
  const cached = narinfos.get(basename);
  if (cached) return cached;
  const info = (async (): Promise<PathInfo> => {
    const res = await fetch(`${CACHE}/${basename.slice(0, 32)}.narinfo`);
    if (!res.ok) throw new Error(`${basename}: narinfo HTTP ${res.status} (not in cache.nixos.org?)`);
    const { field, optional } = parseNarinfo(await res.text(), basename);
    const references = optional("References")?.split(" ").filter(Boolean) ?? [];
    const storePath = field("StorePath");
    const narHash = field("NarHash");
    const narSize = field("NarSize");
    const fingerprint = `1;${storePath};${narHash};${narSize};${references.map((r) => `/nix/store/${r}`).join(",")}`;
    const signed = optional("Sig")?.split(" ").some((sig) => {
      const at = sig.indexOf(":");
      return sig.slice(0, at) === CACHE_KEY.name &&
        verify(null, Buffer.from(fingerprint), publicKey, Buffer.from(sig.slice(at + 1), "base64"));
    });
    if (!signed) throw new Error(`${basename}: narinfo signature does not verify`);
    if (storePath !== `/nix/store/${basename}`) throw new Error(`${basename}: narinfo is for ${storePath}`);
    const compression = field("Compression");
    // The page decodes zstd only; cache.nixos.org has used it for years. Older paths are xz or bzip2.
    if (compression !== "zstd" && compression !== "none") throw new Error(`${basename}: ${compression} NAR; the page only decodes zstd`);
    return {
      url: `${CACHE}/${field("URL")}`,
      compression,
      fileSize: Number(field("FileSize")),
      narHash,
      narSize: Number(narSize),
      references: references.filter((r) => r !== basename),
    };
  })();
  narinfos.set(basename, info);
  return info;
}

async function closure(roots: string[]) {
  const paths: Record<string, PathInfo> = {};
  let frontier = roots;
  while (frontier.length) {
    const infos = await Promise.all(frontier.map(async (b) => [b, await pathInfo(b)] as const));
    frontier = [];
    for (const [basename, info] of infos) {
      paths[basename] = info;
      for (const r of info.references) if (!(r in paths) && !frontier.includes(r)) frontier.push(r);
    }
  }
  return paths;
}

// `bun run closures [id…]`: only those browsers, so adding one doesn't re-resolve the others.
const only = process.argv.slice(2);
for (const browser of BROWSERS.filter((b) => !only.length || only.includes(b.id))) {
  const attrs = [...browser.packages, ...COMMON_PACKAGES];
  const store: Record<string, string> = {};
  for (const spec of attrs) store[attrOf(spec)] = await resolve(spec);
  const roots = Object.values(store).map((p) => p.slice("/nix/store/".length));
  const paths = await closure(roots);
  const size = (k: "fileSize" | "narSize") => Object.values(paths).reduce((s, p) => s + p[k], 0) / 2 ** 20;
  await Bun.write(`${OUT}${browser.id}.json`, JSON.stringify({ store, roots, paths }));
  console.log(`${browser.id}: ${store[attrOf(browser.packages[0]!)]}, ${Object.keys(paths).length} paths, ` +
    `${size("fileSize").toFixed(0)} MiB compressed, ${size("narSize").toFixed(0)} MiB unpacked`);
}
