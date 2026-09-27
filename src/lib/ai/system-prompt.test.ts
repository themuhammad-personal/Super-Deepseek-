import assert from "node:assert/strict";
import test from "node:test";
import { buildSystemPrompt } from "./system-prompt.ts";

test("buildSystemPrompt includes mode, language, memories and skills", () => {
  const text = buildSystemPrompt({
    mode: "think",
    webSearch: true,
    locale: "bn",
    mcp: ["web", "github"],
    rag: "file.ts contents",
    preferredLang: "",
    injectDate: true,
    memories: [
      { id: "1", key: "name", value: "Nadia", importance: "always" },
      { id: "2", key: "tmp", value: "skip", importance: "called" },
    ],
    skills: [
      { id: "s", name: "Cite", usage: "", content: "Always cite.", active: true },
      { id: "off", name: "Off", usage: "", content: "no", active: false },
    ],
    character: { id: "c", name: "Mentor", usage: "", content: "Be kind.", active: true },
  });
  assert.match(text, /DeepThink is ON/);
  assert.match(text, /Bengali/);
  assert.match(text, /Nadia/);
  assert.doesNotMatch(text, /skip/);
  assert.match(text, /Always cite/);
  assert.doesNotMatch(text, /no$/m);
  assert.match(text, /Mentor/);
  assert.match(text, /file\.ts contents/);
  assert.match(text, /Live web search is ON/);
});

test("identity, capability list and MCP tool catalog are injected", () => {
  const text = buildSystemPrompt({
    mode: "instant",
    webSearch: false,
    locale: "en",
    mcp: [],
    rag: "",
    mcpTools: [
      {
        server: "exa",
        endpoint: "https://mcp.exa.ai/mcp",
        tools: [
          {
            name: "web_search_exa",
            description: "Search the web with Exa",
            inputSchema: { properties: { query: { type: "string" } } },
          },
        ],
      },
    ],
  });
  assert.match(text, /Super DeepSeek/);
  assert.match(text, /who you are/i);
  assert.match(text, /CONNECTED MCP TOOLS/);
  assert.match(text, /web_search_exa/);
  assert.match(text, /args: query/);
  assert.match(text, /SDS:AUTO:MCP/);
});

test("disableCore with no custom prompt is empty", () => {
  assert.equal(
    buildSystemPrompt({
      mode: "instant",
      webSearch: false,
      locale: "en",
      mcp: [],
      rag: "",
      disableCore: true,
    }),
    "",
  );
});

test("custom prompt replaces core when disableCore", () => {
  const text = buildSystemPrompt({
    mode: "research",
    webSearch: false,
    locale: "en",
    mcp: [],
    rag: "",
    disableCore: true,
    customPrompt: "You are a pirate.",
  });
  assert.equal(text.includes("pirate"), true);
  assert.equal(text.includes("Super DeepSeek"), false);
});
