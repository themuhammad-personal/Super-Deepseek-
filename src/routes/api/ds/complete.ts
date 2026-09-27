import { createFileRoute } from "@tanstack/react-router";
import { bearerFromRequest, dsCompleteStream, dsCreateSession } from "@/lib/deepseek/server";
import { parseSseChunk } from "@/lib/deepseek/parse-sse";

type Body = {
  prompt: string;
  sessionId?: string;
  thinking?: boolean;
  search?: boolean;
  parentMessageId?: string | null;
};

export const Route = createFileRoute("/api/ds/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearerFromRequest(request);
        if (!token) return Response.json({ error: "Sign in with DeepSeek to chat." }, { status: 401 });

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "Invalid request" }, { status: 400 });
        }
        const prompt = String(body.prompt || "").trim();
        if (!prompt) return Response.json({ error: "Empty message" }, { status: 400 });

        try {
          const sessionId = body.sessionId || (await dsCreateSession(token));
          const upstream = await dsCompleteStream({
            token,
            sessionId,
            prompt,
            thinking: Boolean(body.thinking),
            search: Boolean(body.search),
            parentMessageId: body.parentMessageId,
            signal: request.signal,
          });

          if (!upstream.ok || !upstream.body) {
            const errText = await upstream.text().catch(() => "");
            return Response.json(
              {
                error:
                  upstream.status === 401
                    ? "Session expired. Please sign in again."
                    : `DeepSeek error ${upstream.status}`,
                detail: errText.slice(0, 400),
                sessionId,
              },
              { status: upstream.status === 401 ? 401 : 502 },
            );
          }

          const encoder = new TextEncoder();
          const decoder = new TextDecoder();
          const acc = { thinking: "", text: "" };
          const stream = new ReadableStream({
            async start(controller) {
              const send = (obj: unknown) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
              };
              send({ type: "session", sessionId });
              const reader = upstream.body!.getReader();
              let buf = "";
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  buf += decoder.decode(value, { stream: true });
                  const parts = buf.split("\n");
                  buf = parts.pop() ?? "";
                  for (const part of parts) {
                    const line = part.startsWith("data:") ? part.slice(5).trim() : part.trim();
                    if (!line || line.startsWith("event:")) continue;
                    const delta = parseSseChunk(line, acc);
                    if (!delta) continue;
                    if (delta.error) send({ type: "error", error: delta.error });
                    else if (delta.done) send({ type: "done" });
                    else send({ type: "delta", text: delta.text, thinking: delta.thinking });
                  }
                }
                send({ type: "done", sessionId });
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
              "X-Ds-Session": sessionId,
            },
          });
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "DeepSeek is unavailable." },
            { status: 502 },
          );
        }
      },
    },
  },
});
