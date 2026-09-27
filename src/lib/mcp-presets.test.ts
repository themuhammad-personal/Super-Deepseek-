import assert from "node:assert/strict";
import test from "node:test";
import { defaultMcpServers, MCP_PRESETS, pingServer } from "./mcp-presets.ts";

test("default MCP presets include one-tap servers", () => {
  const ids = MCP_PRESETS.map((p) => p.id);
  assert.deepEqual(ids.sort(), ["github", "search", "termux", "weather", "web"].sort());
  const servers = defaultMcpServers();
  assert.equal(servers.find((s) => s.id === "termux")?.enabled, false);
  assert.equal(servers.find((s) => s.id === "web")?.enabled, true);
});

test("builtin ping is instant online", async () => {
  const r = await pingServer({
    id: "web",
    name: "Web",
    description: "",
    endpoint: "builtin://web",
    enabled: true,
    builtin: true,
    status: "checking",
  });
  assert.equal(r.status, "online");
});
