/**
 * Parser for the app's auto-tool tags — the same protocol shape better-deepseek
 * pioneered (BDS:AUTO:MCP), namespaced SDS for Super DeepSeek. The model emits
 * a tag as its whole reply; the app executes it and feeds the result back as a
 * follow-up turn, so every connected capability is reachable without the user
 * doing anything.
 */

export type McpTagCall = {
  server: string;
  tool: string;
  args: Record<string, unknown>;
  raw: string;
};

const MCP_TAG_RE = /<SDS:AUTO:MCP\b([^<>]*?)>(?:<\/SDS:AUTO:MCP>)?/g;
const ATTR_RE = /([A-Za-z][\w-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

function decodeAttrs(attrStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrStr))) {
    out[m[1]] = m[3] ?? m[4] ?? "";
  }
  return out;
}

function decodeBase64Url(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Every MCP invocation tag found in a model reply, in order. */
export function extractMcpCalls(text: string): McpTagCall[] {
  const calls: McpTagCall[] = [];
  MCP_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MCP_TAG_RE.exec(text))) {
    const attrs = decodeAttrs(m[1] ?? "");
    const server = attrs.url ?? "";
    const tool = attrs.tool ?? "";
    if (!server || !tool) continue;
    let args: Record<string, unknown> = {};
    try {
      if (attrs.base64Args) args = JSON.parse(decodeBase64Url(attrs.base64Args));
      else if (attrs.args) args = JSON.parse(attrs.args);
    } catch {
      args = {};
    }
    calls.push({ server, tool, args, raw: m[0] });
  }
  return calls;
}

/** Remove auto-tool tags from text shown to the user (results arrive as chat). */
export function stripToolTags(text: string): string {
  return text.replace(MCP_TAG_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}
