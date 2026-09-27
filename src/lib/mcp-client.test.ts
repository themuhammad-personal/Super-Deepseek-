import assert from "node:assert/strict";
import test from "node:test";
import { callTool, listTools } from "./mcp-client.ts";
import type { McpServer } from "./types.ts";

const server = {
  id: "s",
  name: "srv",
  description: "",
  endpoint: "https://example.test/mcp",
  enabled: true,
  builtin: false,
  status: "online",
} as McpServer;

function withFetch(body: string, contentType: string, fn: () => Promise<void>): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(body, { headers: { "content-type": contentType } })) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = orig;
  });
}

test("listTools parses a JSON-RPC result", async () => {
  await withFetch(
    JSON.stringify({ result: { tools: [{ name: "t1", description: "d" }] } }),
    "application/json",
    async () => {
      const tools = await listTools(server);
      assert.equal(tools.length, 1);
      assert.equal(tools[0].name, "t1");
    },
  );
});

test("listTools surfaces JSON-RPC errors", async () => {
  await withFetch(
    JSON.stringify({ error: { message: "nope" } }),
    "application/json",
    async () => {
      await assert.rejects(() => listTools(server), /nope/);
    },
  );
});

test("callTool flattens SSE text content and bounds it", async () => {
  await withFetch(
    "event: message\ndata: " +
      JSON.stringify({
        result: { content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }] },
      }) +
      "\n\n",
    "text/event-stream",
    async () => {
      const out = await callTool(server, "t", {}, 1000);
      assert.equal(out, "hello \nworld");
    },
  );
});
