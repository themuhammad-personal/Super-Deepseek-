import type { Message } from "../types";

export type WireMessage = { role: "user" | "assistant"; content: string };

const MAX_MESSAGES = 24;
const MAX_CHARS = 48000;

/**
 * DeepSeek's web completion endpoint accepts an OpenAI-style `messages`
 * array — that is how the official client keeps multi-turn context (verified
 * against better-deepseek's payload-mutator, which reads and rewrites exactly
 * this shape on the live official requests). Sending `prompt` alone makes the
 * model forget everything said earlier in the same chat, which is precisely
 * the complaint this fixes.
 *
 * We rebuild the history from the local thread: real user/assistant turns
 * with visible text, newest last, bounded so a marathon session cannot blow
 * the model's input limit.
 */
export function buildWireHistory(
  messages: Message[],
  maxMessages: number = MAX_MESSAGES,
  maxChars: number = MAX_CHARS,
): WireMessage[] {
  const eligible = messages.filter(
    (m) =>
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim().length > 0 &&
      !m.error,
  );
  const sliced = eligible.slice(-maxMessages);

  const chosen: WireMessage[] = [];
  let total = 0;
  for (let i = sliced.length - 1; i >= 0; i--) {
    const content = sliced[i].content.trim();
    if (total + content.length > maxChars) break;
    total += content.length;
    chosen.unshift({ role: sliced[i].role as "user" | "assistant", content });
  }

  // The model must always see the exchange end on the turn it should answer;
  // callers append the fresh user message afterwards.
  return chosen;
}
