// Runs against cache.nixos.org: the real listing, NAR, decompression and hash check.
import { expect, test } from "bun:test";
import { nix32Decode, parseNar } from "./nar.ts";
import { Store, type Manifest } from "./store.ts";

const manifest: Manifest = await Bun.file(new URL("../../public/closures/firefox.json", import.meta.url)).json();
const cacert = manifest.store.cacert!.slice("/nix/store/".length);

test("nix32 decodes a known sha256", () => {
  // sha256("") = e3b0c442...; its nix32 form, as `nix hash convert` prints it.
  const hex = Buffer.from(nix32Decode("0mdqa9w1p6cmli6976v4wi0sw9r4p5prkj7lzfd1877wk11c9c73")).toString("hex");
  expect(hex).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("a NAR with a bad entry name is refused", () => {
  const s = (t: string) => {
    const b = new TextEncoder().encode(t);
    const out = new Uint8Array(8 + Math.ceil(b.length / 8) * 8);
    new DataView(out.buffer).setBigUint64(0, BigInt(b.length), true);
    out.set(b, 8);
    return out;
  };
  const nar = Buffer.concat(["nix-archive-1", "(", "type", "directory", "entry", "(", "name", "..", "node"].map(s));
  expect(() => parseNar(nar)).toThrow(/entry name/);
});

test("reads the CA bundle out of cacert, lazily and verified", async () => {
  const store = new Store(manifest);
  const dir = await store.readdir(`/${cacert}/etc/ssl/certs`);
  expect(dir.map((e) => e.name)).toContain("ca-bundle.crt");
  const attr = await store.getattr(`/${cacert}/etc/ssl/certs/ca-bundle.crt`);
  const file = await store.open(`/${cacert}/etc/ssl/certs/ca-bundle.crt`);
  const head = new TextDecoder().decode(await file.read(0, attr.size!));
  expect(head).toContain("-----BEGIN CERTIFICATE-----");
  expect(store.stats.fetched).toBe(1);
}, 60_000);

test("a NAR whose hash doesn't match is refused", async () => {
  const bad = structuredClone(manifest);
  bad.paths[cacert]!.narHash = `sha256:${"0".repeat(52)}`;
  const store = new Store(bad);
  await expect(store.open(`/${cacert}/etc/ssl/certs/ca-bundle.crt`)).rejects.toThrow(/hash mismatch/);
}, 60_000);
