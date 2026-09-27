import assert from "node:assert/strict";
import test from "node:test";
import { extractMcpCalls, stripToolTags } from "./tool-tags.ts";

test("extracts an MCP call with single-quoted JSON args", () => {
  const text =
    'Before text\n<SDS:AUTO:MCP url="exa" tool="web_search_exa" args=\'{"query": "ai news"}\'></SDS:AUTO:MCP>';
  const calls = extractMcpCalls(text);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].server, "exa");
  assert.equal(calls[0].tool, "web_search_exa");
  assert.deepEqual(calls[0].args, { query: "ai news" });
});

test("base64Args round-trips URL-safe payloads", () => {
  const json = '{"q": "say <hi> & \\"quote\\""}';
  const b64 = Buffer.from(json, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const calls = extractMcpCalls(`<SDS:AUTO:MCP url="s" tool="t" base64Args="${b64}"></SDS:AUTO:MCP>`);
  assert.deepEqual(calls[0].args, JSON.parse(json));
});

test("skips malformed or attribute-less tags", () => {
  assert.equal(extractMcpCalls("<SDS:AUTO:MCP></SDS:AUTO:MCP>").length, 0);
  assert.equal(extractMcpCalls("<SDS:AUTO:MCP url=\"x\" args='nope'></SDS:AUTO:MCP>").length, 0);
});

test("stripToolTags removes tags and collapses blank lines", () => {
  const out = stripToolTags(
    "I will look that up.\n\n<SDS:AUTO:MCP url=\"a\" tool=\"b\" args='{}'></SDS:AUTO:MCP>\n\n\nDone.",
  );
  assert.equal(out, "I will look that up.\n\nDone.");
});
