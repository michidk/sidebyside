// Nix ARchive parsing, NAR listings (`<digest>.ls`) and Nix's base-32 hashes.

export type Node =
  | { type: "file"; size: number; executable: boolean; data?: Uint8Array }
  | { type: "dir"; entries: string[] }
  | { type: "symlink"; target: string };

// Store-relative path ("" is the path itself, else "a/b") to node.
export type Tree = Map<string, Node>;

const join = (dir: string, name: string) => (dir === "" ? name : `${dir}/${name}`);

// A NAR is length-prefixed strings (u64 little-endian length, padded to 8 bytes).
// File contents in the result are views into `nar`, not copies.
export function parseNar(nar: Uint8Array): Tree {
  const view = new DataView(nar.buffer, nar.byteOffset, nar.byteLength);
  const text = new TextDecoder();
  let at = 0;
  const bytes = () => {
    const length = Number(view.getBigUint64(at, true));
    const out = nar.subarray(at + 8, at + 8 + length);
    at += 8 + Math.ceil(length / 8) * 8;
    return out;
  };
  const str = () => text.decode(bytes());
  const expect = (want: string) => {
    const got = str();
    if (got !== want) throw new Error(`bad NAR: expected "${want}", got "${got.slice(0, 40)}"`);
  };
  const tree: Tree = new Map();

  function node(path: string) {
    expect("(");
    expect("type");
    const type = str();
    if (type === "regular") {
      let executable = false;
      let tag = str();
      if (tag === "executable") {
        expect("");
        executable = true;
        tag = str();
      }
      if (tag !== "contents") throw new Error(`bad NAR: expected "contents", got "${tag}"`);
      const data = bytes();
      tree.set(path, { type: "file", size: data.length, executable, data });
      expect(")");
    } else if (type === "symlink") {
      expect("target");
      tree.set(path, { type: "symlink", target: str() });
      expect(")");
    } else if (type === "directory") {
      const entries: string[] = [];
      tree.set(path, { type: "dir", entries });
      for (let tag = str(); tag !== ")"; tag = str()) {
        if (tag !== "entry") throw new Error(`bad NAR: expected "entry", got "${tag}"`);
        expect("(");
        expect("name");
        const name = str();
        if (!name || name === "." || name === ".." || name.includes("/")) throw new Error(`bad NAR: entry name "${name}"`);
        expect("node");
        entries.push(name);
        node(join(path, name));
        expect(")");
      }
    } else {
      throw new Error(`bad NAR: node type "${type}"`);
    }
  }

  expect("nix-archive-1");
  node("");
  return tree;
}

interface ListingNode {
  type: "regular" | "directory" | "symlink";
  size?: number;
  executable?: boolean;
  target?: string;
  entries?: Record<string, ListingNode>;
}

// A cache's NAR listing: the same tree without file contents.
export function parseListing(listing: { root: ListingNode }): Tree {
  const tree: Tree = new Map();
  const walk = (path: string, n: ListingNode) => {
    if (n.type === "regular") tree.set(path, { type: "file", size: n.size ?? 0, executable: n.executable === true });
    else if (n.type === "symlink") tree.set(path, { type: "symlink", target: n.target ?? "" });
    else if (n.type === "directory") {
      const names = Object.keys(n.entries ?? {});
      tree.set(path, { type: "dir", entries: names });
      for (const name of names) walk(join(path, name), n.entries![name]!);
    } else throw new Error(`bad listing: node type "${(n as ListingNode).type}"`);
  };
  walk("", listing.root);
  return tree;
}

const NIX32 = "0123456789abcdfghijklmnpqrsvwxyz";

// Nix's base-32 (as in "sha256:1b8m03r6..."), least significant digit last.
export function nix32Decode(s: string): Uint8Array {
  const out = new Uint8Array(Math.floor((s.length * 5) / 8));
  for (let n = 0; n < s.length; n++) {
    const char = s.charAt(s.length - 1 - n);
    const digit = NIX32.indexOf(char);
    if (digit < 0) throw new Error(`bad nix32 character "${char}"`);
    const bit = n * 5;
    const i = bit >> 3;
    const j = bit & 7;
    out[i] = out[i]! | ((digit << j) & 0xff);
    if (i + 1 < out.length) out[i + 1] = out[i + 1]! | (digit >> (8 - j));
    else if (digit >> (8 - j)) throw new Error("bad nix32: value too large");
  }
  return out;
}

// Throws unless `data`'s SHA-256 is the narinfo-style hash ("sha256:<nix32>").
export async function checkHash(data: Uint8Array<ArrayBuffer>, hash: string, what: string) {
  const [algo, digest = ""] = hash.split(":");
  if (algo !== "sha256") throw new Error(`${what}: unsupported hash ${algo}`);
  const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const expected = nix32Decode(digest);
  if (actual.length !== expected.length || actual.some((b, i) => b !== expected[i])) {
    throw new Error(`${what}: hash mismatch`);
  }
}
