/**
 * Parse DeepSeek web completion SSE into thinking + text.
 *
 * The live format (verified against a production reverse-engineered proxy that
 * parses the same upstream stream) is a mix of JSON-patch fragments:
 *
 * Old format:
 *   data: {"p":"response/thinking_content","v":"…"}        first thinking chunk
 *   data: {"o":"APPEND","v":"…"}                            thinking continuation (no p!)
 *   data: {"v":"…"}                                         continuation (no p, no o)
 *   data: {"p":"response/content","o":"APPEND","v":"…"}     first answer chunk
 *   data: {"v":"…"}                                         answer continuation
 *   data: {"p":"response/status","v":"FINISHED"}            metadata, skip
 *
 * New format:
 *   data: {"v":{"response":{"fragments":[{"type":"THINK","content":"…"}]}}}
 *   data: {"p":"response/fragments","o":"APPEND","v":[{"id":1,"type":"RESPONSE","content":"…"}]}
 *   data: {"p":"response/fragments/-1/content","o":"APPEND","v":"…"}
 *
 * The critical subtlety: MOST delta events carry NO `p` field — they continue
 * whichever fragment/phase was opened by the last path event. A parser that only
 * looks at `p` (the previous behaviour) silently drops the entire answer.
 *
 * Also possible: `{"type":"error","content":…}`, toast errors
 * `{"v":{"type":"error",…}}`, and bare envelope errors `{"code":40xxx,"msg":…}`.
 */

export type SseAcc = {
  thinking: string;
  text: string;
  /** Which channel pathless continuation lines belong to (old format). */
  phase?: "thinking" | "content" | null;
  /** Current fragment type (new format): THINK vs RESPONSE/other. */
  fragmentType?: string | null;
  /**
   * The server-side id of the assistant message being streamed. The next
   * completion must send it as `parent_message_id` — that chain (not a
   * messages array) is how DeepSeek keeps multi-turn context.
   */
  messageId?: string | null;
};

export type DsDelta = {
  thinking?: string;
  text?: string;
  error?: string;
  done?: boolean;
};

export function createSseAcc(): SseAcc {
  return { thinking: "", text: "", phase: null, fragmentType: null, messageId: null };
}

function snap(acc: SseAcc): DsDelta {
  return { thinking: acc.thinking, text: acc.text };
}

function appendTo(acc: SseAcc, target: "thinking" | "content", v: string): void {
  if (target === "thinking") acc.thinking += v;
  else acc.text += v;
}

/** Channel for pathless continuation lines. */
function continuationTarget(acc: SseAcc): "thinking" | "content" {
  if (acc.fragmentType) return acc.fragmentType === "THINK" ? "thinking" : "content";
  return acc.phase === "thinking" ? "thinking" : "content";
}

type Frag = { type?: unknown; content?: unknown };

function absorbFragment(acc: SseAcc, frag: Frag): void {
  if (typeof frag.type === "string" && frag.type) acc.fragmentType = frag.type;
  if (typeof frag.content === "string" && frag.content) {
    appendTo(acc, acc.fragmentType === "THINK" ? "thinking" : "content", frag.content);
  }
}

/**
 * Feed one SSE line (with or without the `data:` prefix) into `acc`.
 * Mutates `acc` and returns the new totals, an error, or `{done:true}`.
 * Returns null for lines that carry no user-visible payload.
 */
export function parseSseChunk(raw: string, acc: SseAcc): DsDelta | null {
  const line = raw.trim();
  if (!line) return null;
  if (line.startsWith("event:") || line.startsWith(":")) return null;

  let payload = line;
  if (payload.startsWith("data:")) payload = payload.slice(5).trim();
  if (!payload || payload === ":") return null;
  if (payload === "[DONE]") return { done: true };

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  // The stream tags every content event with the assistant message's server id;
  // the NEXT completion must carry it as parent_message_id or the server treats
  // the turn as a brand-new root and forgets the conversation (deepseek-cli, a
  // working production client, does exactly this).
  const mid =
    typeof obj.message_id === "string"
      ? obj.message_id
      : typeof obj.response_message_id === "string"
        ? obj.response_message_id
        : null;
  if (mid) acc.messageId = mid;

  // Bare envelope error inside the stream ({"code":40003,…}, account muted, …).
  if (typeof obj.code === "number" && obj.code >= 40000) {
    return { error: String(obj.msg || `DeepSeek error ${obj.code}`) };
  }

  // {"type":"error","content":"…","finish_reason":"…"}
  if (obj.type === "error") {
    return { error: String(obj.content || "DeepSeek returned an error.") };
  }

  const val = obj.v;

  // Object-valued events: toast errors or fragment metadata.
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const v = val as { type?: unknown; content?: unknown; finish_reason?: unknown; response?: { fragments?: unknown } };
    if (v.type === "error" && v.finish_reason) {
      return { error: String(v.content || "DeepSeek returned an error.") };
    }
    const frags = v.response?.fragments;
    if (Array.isArray(frags)) {
      for (const f of frags) {
        if (f && typeof f === "object") absorbFragment(acc, f as Frag);
      }
      return snap(acc);
    }
    return null; // other metadata, e.g. {"v":{"response":{…}}}
  }

  const path = typeof obj.p === "string" ? obj.p : "";

  // New format: a fragment boundary carries the type switch + initial content.
  if (path === "response/fragments" && obj.o === "APPEND" && Array.isArray(val)) {
    const last = val[val.length - 1];
    if (last && typeof last === "object") absorbFragment(acc, last as Frag);
    return snap(acc);
  }

  // New format: append to the current fragment.
  if (path === "response/fragments/-1/content") {
    if (typeof val === "string" && val) appendTo(acc, continuationTarget(acc), val);
    return snap(acc);
  }

  // Old format: first chunks carry the path.
  if (path === "response/content" && (obj.o == null || obj.o === "APPEND")) {
    acc.phase = "content";
    if (typeof val === "string" && val) appendTo(acc, "content", val);
    return snap(acc);
  }
  if (path === "response/thinking_content" && (obj.o == null || obj.o === "APPEND")) {
    acc.phase = "thinking";
    if (typeof val === "string" && val) appendTo(acc, "thinking", val);
    return snap(acc);
  }

  // Any other path is metadata (status, elapsed_secs, ids, BATCH, …).
  if (path) return null;

  // Pathless continuation — the bulk of the stream. Route by fragment/phase.
  if (typeof val === "string" && val) {
    appendTo(acc, continuationTarget(acc), val);
    return snap(acc);
  }

  // Fallback: OpenAI-like deltas (kept for the web proxy path).
  const choices = (obj as { choices?: { delta?: { content?: string; reasoning_content?: string } }[] }).choices;
  if (choices?.[0]?.delta) {
    const d = choices[0].delta;
    if (d.reasoning_content) acc.thinking += d.reasoning_content;
    if (d.content) acc.text += d.content;
    return snap(acc);
  }

  return null;
}
