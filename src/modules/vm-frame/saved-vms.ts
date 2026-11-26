// Saved VMs: an encoded snapshot of a VM with its browser running, kept in the origin's private
// file system (OPFS), so a later visit resumes it in seconds instead of booting Linux and starting
// the browser again. The page's Reset deletes them all.

const DIR = "saved-vms";

// What the browser showed when the VM was saved: a resumed VM starts from there.
export interface SavedVmMeta {
  url: string;
  mobile: boolean;
}

const folder = async (create: boolean) => (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create });

async function write(dir: FileSystemDirectoryHandle, name: string, data: Uint8Array<ArrayBuffer> | string) {
  const file = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await file.write(data);
  await file.close();
}

// The saved VM under `key`, or undefined: none saved, or no OPFS in this browser.
export async function loadSavedVm(key: string) {
  try {
    const dir = await folder(false);
    const read = async (name: string) => (await dir.getFileHandle(name)).getFile();
    const [snapshot, meta] = await Promise.all([read(`${key}.snap`), read(`${key}.json`)]);
    return { bytes: new Uint8Array(await snapshot.arrayBuffer()), meta: JSON.parse(await meta.text()) as SavedVmMeta };
  } catch {
    return undefined;
  }
}

// Keys are "<browser>.<hash of its settings>". Saving one replaces the browser's older saves (other
// settings, or an earlier build), which would only take up space. The .json goes last: a snapshot
// without it is never loaded, so a write cut short isn't resumed.
export async function saveVm(key: string, bytes: Uint8Array<ArrayBuffer>, meta: SavedVmMeta) {
  const dir = await folder(true);
  const browser = key.slice(0, key.indexOf(".") + 1);
  const names: string[] = [];
  for await (const name of dir.keys()) names.push(name);
  for (const name of names)
    if (name.startsWith(browser) && !name.startsWith(`${key}.`)) await dir.removeEntry(name).catch(() => {});
  await write(dir, `${key}.snap`, bytes);
  await write(dir, `${key}.json`, JSON.stringify(meta));
}

export async function forgetSavedVm(key: string) {
  const dir = await folder(false).catch(() => undefined);
  await Promise.all([`${key}.json`, `${key}.snap`].map((name) => dir?.removeEntry(name).catch(() => {})));
}

export async function forgetAllSavedVms() {
  await (await navigator.storage.getDirectory()).removeEntry(DIR, { recursive: true }).catch(() => {});
}
