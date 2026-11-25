// Decodes zstd NARs off the page's thread: the biggest unpack to hundreds of MiB.
import { Decompress } from "fzstd";

self.onmessage = ({ data: { id, compressed, size } }: MessageEvent<{ id: number; compressed: Uint8Array; size: number }>) => {
  try {
    const out = new Uint8Array(size);
    let at = 0;
    new Decompress((chunk) => {
      if (at + chunk.length > size) throw new Error("NAR longer than the narinfo says");
      out.set(chunk, at);
      at += chunk.length;
    }).push(compressed, true);
    if (at !== size) throw new Error(`NAR is ${at} bytes, the narinfo says ${size}`);
    postMessage({ id, out }, { transfer: [out.buffer] });
  } catch (err) {
    postMessage({ id, error: String((err as Error).message ?? err) });
  }
};
