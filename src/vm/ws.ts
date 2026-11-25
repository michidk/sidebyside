// A WebSocket client over a raw byte stream (unkernel's vm.connect()), for the browsers' remote
// control servers in the guest: text messages only, no extensions.

export interface Duplex {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

export interface Frame {
  fin: boolean;
  opcode: number;
  payload: Uint8Array;
}

// A client frame: always masked (RFC 6455 5.3).
export function encodeFrame(opcode: number, payload: Uint8Array, mask = crypto.getRandomValues(new Uint8Array(4))) {
  const n = payload.length;
  const head = n < 126 ? [0x80 | opcode, 0x80 | n] : n < 65536 ? [0x80 | opcode, 0x80 | 126, n >> 8, n & 255] : null;
  const header = head ? Uint8Array.from(head) : new Uint8Array(10);
  if (!head) {
    header.set([0x80 | opcode, 0x80 | 127]);
    new DataView(header.buffer).setBigUint64(2, BigInt(n));
  }
  const out = new Uint8Array(header.length + 4 + n);
  out.set(header);
  out.set(mask, header.length);
  for (let i = 0; i < n; i++) out[header.length + 4 + i] = payload[i]! ^ mask[i & 3]!;
  return out;
}

// The complete frames at the start of `buf` (from the server: unmasked), and what is left over.
export function decodeFrames(buf: Uint8Array): { frames: Frame[]; rest: Uint8Array<ArrayBuffer> } {
  const frames: Frame[] = [];
  let at = 0;
  for (;;) {
    if (buf.length - at < 2) break;
    const view = new DataView(buf.buffer, buf.byteOffset + at);
    let len = buf[at + 1]! & 127;
    let head = 2;
    if (len === 126) {
      if (buf.length - at < 4) break;
      len = view.getUint16(2);
      head = 4;
    } else if (len === 127) {
      if (buf.length - at < 10) break;
      len = Number(view.getBigUint64(2));
      head = 10;
    }
    if (buf.length - at < head + len) break;
    frames.push({ fin: (buf[at]! & 0x80) !== 0, opcode: buf[at]! & 15, payload: buf.slice(at + head, at + head + len) });
    at += head + len;
  }
  return { frames, rest: buf.slice(at) };
}

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

// Open a WebSocket at `path` on `sock`, a connection to `host` (host:port, for the Host header). Messages go to `onMessage`; `closed` settles when the
// connection ends.
export async function openWebSocket(sock: Duplex, host: string, path: string, onMessage: (text: string) => void) {
  const writer = sock.writable.getWriter();
  const reader = sock.readable.getReader();
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const enc = new TextEncoder();
  await writer.write(
    enc.encode(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`),
  );

  // The handshake response, then frames right after it.
  let buf = new Uint8Array(0);
  let end = -1;
  while (end < 0) {
    const { value, done } = await reader.read();
    if (done) throw new Error("the WebSocket server closed during the handshake");
    buf = concat(buf, value);
    end = new TextDecoder().decode(buf).indexOf("\r\n\r\n");
  }
  const response = new TextDecoder().decode(buf);
  if (!/^HTTP\/1\.1 101\b/.test(response)) throw new Error(`WebSocket handshake failed: ${response.slice(0, 300).replace(/\s+/g, " ")}`);
  buf = buf.slice(end + 4);

  const send = (opcode: number, payload: Uint8Array) => writer.write(encodeFrame(opcode, payload));
  const closed = (async () => {
    const text = new TextDecoder();
    let message: Uint8Array[] = [];
    for (;;) {
      const { frames, rest } = decodeFrames(buf);
      buf = rest;
      for (const f of frames) {
        if (f.opcode === 8) return;
        if (f.opcode === 9) await send(10, f.payload);
        if (f.opcode === 1 || f.opcode === 0) {
          message.push(f.payload);
          if (f.fin) {
            onMessage(text.decode(message.reduce(concat)));
            message = [];
          }
        }
      }
      const { value, done } = await reader.read();
      if (done) return;
      buf = concat(buf, value);
    }
  })();

  return { send: (text: string) => send(1, enc.encode(text)), closed };
}
