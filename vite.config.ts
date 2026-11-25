// The page: a TanStack Start app built as a static SPA. Only the shell is prerendered (to
// index.html) and everything renders in the browser; there is no server code. public/ holds
// the VM frame (vm.html), built separately by scripts/build-vm.ts, and is copied as is.
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// The VM frame's version (vm.html carries its bundle's hash): frame URLs include it, so browsers
// don't reuse a frame cached from an earlier build. scripts/build-vm.ts runs first.
const frameVersion = createHash("sha256").update(readFileSync("public/vm.html")).digest("hex").slice(0, 12);

export default defineConfig({
  resolve: { tsconfigPaths: true },
  define: { __FRAME_VERSION__: JSON.stringify(frameVersion) },
  plugins: [
    tailwindcss(),
    tanstackStart({ spa: { enabled: true, prerender: { outputPath: "/index.html", crawlLinks: false } } }),
    viteReact(),
  ],
});
