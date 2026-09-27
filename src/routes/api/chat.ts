import { createFileRoute } from "@tanstack/react-router";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import type { Attachment, ChatMode, Locale } from "@/lib/types";

type Incoming = {
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: Attachment[];
};

type Body = {
  messages: Incoming[];
  mode?: ChatMode;
  webSearch?: boolean;
  rag?: string;
  locale?: Locale;
  mcp?: string[];
};

type XaiPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function toXaiMessages(messages: Incoming[], system: string) {
  const out: { role: string; content: string | XaiPart[] }[] = [
    { role: "system", content: system },
  ];
  for (const m of messages) {
    const images = (m.attachments ?? []).filter((a) => a.kind === "image" && a.dataUrl);
    const texts = (m.attachments ?? [])
      .map((a) => {
        if (a.text) return `Attached ${a.name}:\n${a.text.slice(0, 12000)}`;
        if (a.ocrText) return `OCR from ${a.name}:\n${a.ocrText}`;
        return a.kind === "image" ? "" : `Attached file: ${a.name}`;
      })
      .filter(Boolean);
    const text = [m.content, ...texts].filter(Boolean).join("\n\n");
    if (m.role === "user" && images.length) {
      const parts: XaiPart[] = [{ type: "text", text: text || "Please review the attached image." }];
      for (const img of images.slice(0, 4)) {
        if (img.dataUrl) parts.push({ type: "image_url", image_url: { url: img.dataUrl } });
      }
      out.push({ role: "user", content: parts });
    } else {
      out.push({ role: m.role === "assistant" ? "assistant" : "user", content: text });
    }
  }
  return out;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.XAI_API_KEY;
        if (!apiKey) {
          return Response.json(
            { error: "The reasoning engine is unavailable right now." },
            { status: 503 },
          );
        }

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "Invalid request" }, { status: 400 });
        }

        const mode: ChatMode = body.mode ?? "instant";
        const system = buildSystemPrompt({
          mode,
          webSearch: Boolean(body.webSearch),
          locale: body.locale ?? "en",
          mcp: body.mcp ?? [],
          rag: body.rag ?? "",
        });

        const maxTokens = mode === "research" ? 4096 : mode === "think" ? 3072 : 2048;
        const payload: Record<string, unknown> = {
          model: "grok-4.5",
          stream: true,
          temperature: mode === "think" ? 0.3 : 0.7,
          max_tokens: maxTokens,
          messages: toXaiMessages(body.messages ?? [], system),
        };
        if (body.webSearch || mode === "research") {
          payload.search_parameters = { mode: "on", return_citations: true };
        }

        const upstream = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: request.signal,
        });

        if (!upstream.ok || !upstream.body) {
          const errText = await upstream.text().catch(() => "");
          return Response.json(
            { error: `xAI API error ${upstream.status}`, detail: errText.slice(0, 400) },
            { status: 502 },
          );
        }

        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (obj: unknown) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
            };
            const reader = upstream.body!.getReader();
            let buf = "";
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const parts = buf.split("\n\n");
                buf = parts.pop() ?? "";
                for (const part of parts) {
                  const line = part.split("\n").find((l) => l.startsWith("data:"));
                  if (!line) continue;
                  const raw = line.slice(5).trim();
                  if (!raw || raw === "[DONE]") continue;
                  try {
                    const json = JSON.parse(raw) as {
                      choices?: {
                        delta?: {
                          content?: string;
                          reasoning_content?: string;
                          reasoning?: string;
                        };
                      }[];
                    };
                    const delta = json.choices?.[0]?.delta;
                    const thinking = delta?.reasoning_content || delta?.reasoning;
                    const text = delta?.content;
                    if (thinking) send({ type: "thinking", thinking });
                    if (text) send({ type: "delta", text });
                  } catch {
                    /* skip */
                  }
                }
              }
              send({ type: "done" });
            } catch (e) {
              send({ type: "error", error: String(e) });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
