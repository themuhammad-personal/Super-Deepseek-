import assert from "node:assert/strict";
import test from "node:test";
import { SEARCH_PROVIDERS } from "./search-providers.ts";

test("search provider catalog is ordered and unique", () => {
  const ids = SEARCH_PROVIDERS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("ddg-lite"));
  assert.ok(ids.includes("bing"));
});
