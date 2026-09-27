import type { McpServer } from "./types";

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type RpcReply = {
  result?: { tools?: McpTool[]; content?: { type?: string; text?: string }[]; [k: string]: unknown };
  error?: { message?: string; code?: number };
};

function headers(server: McpServer): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(server.apiKey ? { Authorization: `Bearer ${server.apiKey}` } : {}),
  };
}

/** Some MCP servers answer JSON-RPC over SSE; pull the first reply frame. */
function parseSseReply(text: string): RpcReply | null {
  for (const line of text.split("\n")) {
    const l = line.trim();
    if (!l.startsWith("data:")) continue;
    const payload = l.slice(5).trim();
    if (!payload) continue;
    try {
      const j = JSON.parse(payload) as RpcReply;
      if (j && typeof j === "object" && (j.result !== undefined || j.error !== undefined)) return j;
    } catch {
      /* not json */
    }
  }
  return null;
}

type NativeReply = { status?: number; contentType?: string; body?: string; error?: string };

declare global {
  interface Window {
    // AndroidBridge (incl. mcpRequest) is declared in deepseek/client-direct.ts.
    __mcpResult?: (name: string, json: string) => void;
  }
}

const nativePending = new Map<string, (r: NativeReply) => void>();
let nativeSeq = 0;

function ensureNativeRegistry(): void {
  if (typeof window === "undefined") return;
  if (!window.__mcpResult) {
    window.__mcpResult = (name, json) => {
      const cb = nativePending.get(name);
      nativePending.delete(name);
      try {
        cb?.(JSON.parse(json) as NativeReply);
      } catch {
        cb?.({ error: "bad native json" });
      }
    };
  }
}

function nativeAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.AndroidBridge?.mcpRequest === "function";
}

/**
 * Route the JSON-RPC call through the Kotlin OkHttp bridge when present. MCP
 * endpoints refuse the WebView origin via CORS, so the native side is the only
 * transport that works inside the APK; the browser dev build falls back to fetch.
 */
function rpcNative(server: McpServer, method: string, params: unknown, timeoutMs: number): Promise<RpcReply> {
  ensureNativeRegistry();
  const name = `mcp${++nativeSeq}`;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  return new Promise<RpcReply>((resolve, reject) => {
    const timer = setTimeout(() => {
      nativePending.delete(name);
      reject(new Error(`MCP server timed out (${timeoutMs}ms)`));
    }, timeoutMs);
    nativePending.set(name, (r) => {
      clearTimeout(timer);
      if (r.error) return reject(new Error(r.error));
      const ct = r.contentType ?? "";
      if (ct.includes("text/event-stream")) {
        const reply = parseSseReply(r.body ?? "");
        if (!reply) return reject(new Error("MCP server sent an SSE stream without a JSON-RPC reply"));
        return resolve(reply);
      }
      try {
        resolve(JSON.parse(r.body ?? "") as RpcReply);
      } catch {
        reject(new Error("MCP server returned unparseable JSON"));
      }
    });
    window.AndroidBridge?.mcpRequest?.(server.endpoint, JSON.stringify(headers(server)), body, name);
  });
}

async function rpc(server: McpServer, method: string, params: unknown, timeoutMs: number): Promise<RpcReply> {
  if (nativeAvailable()) return rpcNative(server, method, params, timeoutMs);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(server.endpoint, {
      method: "POST",
      headers: headers(server),
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now() % 1_000_000, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`MCP server replied HTTP ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/event-stream")) {
      const reply = parseSseReply(await res.text());
      if (!reply) throw new Error("MCP server sent an SSE stream without a JSON-RPC reply");
      return reply;
    }
    return (await res.json()) as RpcReply;
  } finally {
    clearTimeout(timer);
  }
}

export async function listTools(server: McpServer, timeoutMs = 8000): Promise<McpTool[]> {
  const reply = await rpc(server, "tools/list", {}, timeoutMs);
  if (reply.error) throw new Error(reply.error.message || "tools/list failed");
  const tools = reply.result?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.filter((t) => t && typeof t.name === "string");
}

/** Run one tool and flatten the textual result, bounded for prompt safety. */
export async function callTool(
  server: McpServer,
  tool: string,
  args: Record<string, unknown>,
  maxChars = 8000,
  timeoutMs = 20000,
): Promise<string> {
  const reply = await rpc(server, "tools/call", { name: tool, arguments: args }, timeoutMs);
  if (reply.error) throw new Error(reply.error.message || `tool ${tool} failed`);
  const content = reply.result?.content;
  if (!Array.isArray(content)) return JSON.stringify(reply.result ?? {}).slice(0, maxChars);
  const text = content
    .map((c) => (typeof c?.text === "string" ? c.text : JSON.stringify(c)))
    .join("\n")
    .slice(0, maxChars);
  return text || "(empty result)";
}
