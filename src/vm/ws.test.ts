import { expect, test } from "bun:test";
import { decodeFrames, encodeFrame } from "./ws.ts";

// A server frame: unmasked.
const serverFrame = (opcode: number, payload: Uint8Array, fin = true) => {
  const n = payload.length;
  const head = n < 126 ? [(fin ? 0x80 : 0) | opcode, n] : [(fin ? 0x80 : 0) | opcode, 126, n >> 8, n & 255];
  return Uint8Array.from([...head, ...payload]);
};

test("client frames are masked, with 16- and 64-bit lengths", () => {
  const mask = Uint8Array.from([1, 2, 3, 4]);
  const short = encodeFrame(1, new TextEncoder().encode("hi"), mask);
  expect([...short]).toEqual([0x81, 0x82, 1, 2, 3, 4, "h".charCodeAt(0) ^ 1, "i".charCodeAt(0) ^ 2]);
  expect([...encodeFrame(1, new Uint8Array(300), mask).subarray(0, 4)]).toEqual([0x81, 0xfe, 1, 44]);
  const big = encodeFrame(1, new Uint8Array(70_000), mask);
  expect(big[1]).toBe(0xff);
  expect(new DataView(big.buffer).getBigUint64(2)).toBe(70_000n);
  expect(big.length).toBe(10 + 4 + 70_000);
});

test("server frames decode across chunk boundaries", () => {
  const text = new TextEncoder().encode("x".repeat(200));
  const bytes = Uint8Array.from([...serverFrame(1, text), ...serverFrame(9, new Uint8Array(0))]);
  const first = decodeFrames(bytes.subarray(0, 100));
  expect(first.frames).toEqual([]);
  expect(first.rest.length).toBe(100);
  const all = decodeFrames(bytes);
  expect(all.frames.map((f) => [f.opcode, f.fin, f.payload.length])).toEqual([[1, true, 200], [9, true, 0]]);
  expect(all.rest.length).toBe(0);
});
