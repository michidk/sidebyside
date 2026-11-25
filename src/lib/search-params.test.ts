import { expect, test } from "bun:test";
import { parseSearch, stringifySearch } from "./search-params.ts";

test("query strings round-trip, repeated keys as arrays", () => {
  const search = "?url=https%3A%2F%2Fx.test%2F&wisp=a&wisp=b&mobile=1";
  expect(parseSearch(search)).toEqual({ url: "https://x.test/", wisp: ["a", "b"], mobile: "1" });
  expect(stringifySearch(parseSearch(search))).toBe(search);
});

test("flags are 1 when on and left out when off", () => {
  expect(stringifySearch({ console: true, stats: false, mem: undefined, browsers: "a,b" })).toBe("?console=1&browsers=a%2Cb");
  expect(stringifySearch({})).toBe("");
});
