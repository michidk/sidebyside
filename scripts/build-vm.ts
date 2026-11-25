// Build the VM frame into public/ (vm.html loads it): its bundle, plus unkernel's and wland's
// runtime files copied verbatim from node_modules (they load siblings by relative URL, so they
// aren't bundled). Vite then copies public/ into the site as is. The frame is plain TypeScript,
// not React: its main thread already runs the compositor and the boot log.
import { mkdir, rm, cp } from "node:fs/promises";
import { brotliDecompressSync } from "node:zlib";

const root = new URL("../", import.meta.url).pathname;
const pub = `${root}public/`;
const mod = (p: string) => `${root}node_modules/${p}`;

await rm(`${pub}vendor`, { recursive: true, force: true });
await rm(`${pub}vm`, { recursive: true, force: true });
await mkdir(`${pub}vendor/unkernel/_chunks`, { recursive: true });
await mkdir(`${pub}vendor/wland`, { recursive: true });

// unkernel: the kernel (GPL-2.0) and its SDK (MIT). No virgl: the VMs have no GPU.
for (const f of ["web.mjs", "_chunks/core.mjs", "unkernel.wasm"]) await cp(mod(`unkernel/dist/${f}`), `${pub}vendor/unkernel/${f}`);
for (const f of ["LICENSE", "LICENSE-MIT"]) await cp(mod(`unkernel/${f}`), `${pub}vendor/unkernel/${f}`);

// wland's compositor (MPL-2.0 AND MIT): client.mjs and what it imports.
for (const m of ["client", "engine", "view", "input", "wm", "clipboard", "link-ws", "link-stream", "remote-core", "present"]) {
  await cp(mod(`wland/dist/${m}.mjs`), `${pub}vendor/wland/${m}.mjs`);
}
await cp(mod("wland/dist/wland.wasm"), `${pub}vendor/wland/wland.wasm`);
await cp(mod("wland/LICENSE"), `${pub}vendor/wland/LICENSE`);
// The relay the guest runs: wland's prebuilt static aarch64 binary.
await Bun.write(`${pub}vendor/wlandr`, brotliDecompressSync(await Bun.file(mod("wland/dist/wlandr-linux-arm64.br")).bytes()));

// Static hosts can't send COOP/COEP; this service worker adds them.
await cp(mod("coi-serviceworker/coi-serviceworker.js"), `${pub}coi-serviceworker.js`);

const built = await Bun.build({
  entrypoints: [`${root}src/vm/main.ts`, `${root}src/vm/unzstd.worker.ts`],
  outdir: pub,
  root: `${root}src`,
  naming: { entry: "[dir]/[name].[ext]" },
  target: "browser",
  minify: true,
  sourcemap: "linked",
});
if (!built.success) {
  for (const m of built.logs) console.error(m);
  process.exit(1);
}
console.log(built.outputs.map((o) => o.path.replace(pub, "public/")).join("\n"));

// vm.html, stamped with the bundle's hash: the page puts the same version in each frame's URL
// (see vite.config.ts), so a new build never runs with a frame or bundle a browser cached earlier.
const bundle = await Bun.file(`${pub}vm/main.js`).bytes();
const version = Bun.hash(bundle).toString(36);
const html = await Bun.file(`${root}src/vm/vm.html`).text();
await Bun.write(`${pub}vm.html`, html.replace('src="vm/main.js"', `src="vm/main.js?v=${version}"`));
