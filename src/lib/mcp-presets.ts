import type { McpServer } from "./types";

export const MCP_PRESETS: Omit<McpServer, "status" | "enabled" | "lastPingMs" | "latency">[] = [
  {
    id: "web",
    name: "Web Content Fetcher",
    description: "Reads full text and markdown from any URL you share.",
    endpoint: "builtin://web",
    builtin: true,
  },
  {
    id: "search",
    name: "Live Web Search",
    description: "Real-time search and news discovery for Deep Research.",
    endpoint: "builtin://search",
    builtin: true,
  },
  {
    id: "weather",
    name: "Weather & Time",
    description: "Worldwide forecasts via Open-Meteo and local clocks.",
    endpoint: "https://api.open-meteo.com/v1/forecast?latitude=23.81&longitude=90.41&current=temperature_2m",
    builtin: true,
  },
  {
    id: "github",
    name: "GitHub Explorer",
    description: "Inspect public repositories, files, and commit history.",
    endpoint: "https://api.github.com",
    builtin: true,
  },
  {
    id: "termux",
    name: "Local Termux Bridge",
    description: "Connects to a Termux SSE server on the device LAN.",
    endpoint: "http://127.0.0.1:18080/sse",
    builtin: false,
  },
];

export function defaultMcpServers(): McpServer[] {
  return MCP_PRESETS.map((p) => ({
    ...p,
    enabled: p.id !== "termux",
    status: "checking",
  }));
}

export async function pingServer(server: McpServer): Promise<{ status: "online" | "offline"; latency: number }> {
  if (server.endpoint.startsWith("builtin://")) {
    return { status: "online", latency: 4 };
  }
  const started = performance.now();
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch(server.endpoint, {
      method: "GET",
      signal: ctrl.signal,
      mode: "cors",
    });
    window.clearTimeout(t);
    const latency = Math.round(performance.now() - started);
    return { status: res.ok || res.status === 404 ? "online" : "offline", latency };
  } catch {
    return { status: "offline", latency: Math.round(performance.now() - started) };
  }
}
