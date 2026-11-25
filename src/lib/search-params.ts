// The router reads and writes plain query strings (?a=1&b=x&b=y) rather than its default JSON
// values, so links stay readable and links from before keep working. A repeated key becomes an
// array; true is written as 1, and false, null and undefined are left out.
export function parseSearch(search: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    const had = out[key];
    out[key] = had === undefined ? value : [...(Array.isArray(had) ? had : [had]), value];
  }
  return out;
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === undefined || item === null || item === false) continue;
      params.append(key, item === true ? "1" : String(item));
    }
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}
