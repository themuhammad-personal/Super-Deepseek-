import { useEffect, useRef, useState } from "react";
import { MarkdownView } from "./markdown-view";
import { ThinkingBlock } from "./thinking-block";
import { TerminalCard } from "./terminal-card";
import { LogoMark } from "./logo-mark";
import { useAppStore } from "@/lib/app-store";
import { t } from "@/lib/i18n";
import { formatTime } from "@/lib/utils";
import { attachTerminal, runJsInSandbox } from "@/lib/send-chat";
import type { Artifact, Message } from "@/lib/types";
import { cn } from "@/lib/utils";

function estimateCost(text: string): string {
  const tokens = Math.max(1, Math.ceil(text.length / 4));
  const usd = (tokens / 1_000_000) * 0.28;
  return usd < 0.01 ? `<$0.01 · ${tokens} tok` : `$${usd.toFixed(3)} · ${tokens} tok`;
}

function Bubble({
  msg,
  streaming,
}: {
  msg: Message;
  streaming: boolean;
}) {
  const locale = useAppStore((s) => s.settings.locale);
  const showTime = useAppStore((s) => s.settings.showTimestamps);
  const collapse = useAppStore((s) => s.settings.collapseLong);
  const price = useAppStore((s) => s.settings.tokenPriceDisplay);
  const [expanded, setExpanded] = useState(false);
  const long = collapse && msg.role === "user" && msg.content.length > 420;
  const body = long && !expanded ? `${msg.content.slice(0, 360)}…` : msg.content;

  if (msg.terminal) {
    return (
      <div className="msg-enter mx-auto w-full max-w-3xl px-4 py-2">
        <TerminalCard term={msg.terminal} label={t(locale, "terminal")} />
      </div>
    );
  }

  const isUser = msg.role === "user";

  return (
    <div className={cn("msg-enter mx-auto w-full max-w-3xl px-4 py-3", isUser && "flex justify-end")}>
      <div className={cn("min-w-0", isUser ? "max-w-[85%]" : "w-full")}>
        {isUser ? (
          <div className="rounded-[var(--radius-lg)] rounded-br-[6px] bg-user px-4 py-3 shadow-[var(--shadow-border)]">
            {msg.attachments?.length ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {msg.attachments.map((a) =>
                  a.kind === "image" && a.dataUrl ? (
                    <img
                      key={a.id}
                      src={a.dataUrl}
                      alt={a.name}
                      className="h-24 w-24 rounded-[var(--radius-sm)] object-cover"
                    />
                  ) : (
                    <span
                      key={a.id}
                      className="rounded-[var(--radius-pill)] bg-elevated px-2.5 py-1 text-xs text-muted"
                    >
                      {a.name}
                    </span>
                  ),
                )}
              </div>
            ) : null}
            <p className="whitespace-pre-wrap text-[15px] leading-6">{body}</p>
            {long ? (
              <button
                type="button"
                className="mt-1 text-xs text-accent"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? t(locale, "close") : t(locale, "preview")}
              </button>
            ) : null}
          </div>
        ) : (
          <div>
            <ThinkingBlock
              thinking={msg.thinking}
              steps={msg.researchSteps}
              thinkingMs={msg.thinkingMs}
              streaming={streaming}
              labels={{
                thinking: t(locale, "thinking"),
                thoughtFor: t(locale, "thoughtFor"),
                researching: t(locale, "researching"),
              }}
            />
            {msg.error ? (
              <p className="rounded-[var(--radius-md)] bg-danger/10 px-3 py-2 text-sm text-danger">
                {msg.error}
              </p>
            ) : msg.content ? (
              <MarkdownView
                markdown={msg.content}
                live={streaming}
                copyLabel={t(locale, "copy")}
                copiedLabel={t(locale, "copied")}
                runLabel={t(locale, "run")}
                artifactLabel={t(locale, "openArtifact")}
                onRun={(code) => {
                  const chatId = useAppStore.getState().activeChatId;
                  if (!chatId) return;
                  attachTerminal(chatId, "node sandbox", runJsInSandbox(code));
                }}
                onOpenArtifact={(art: Artifact) => {
                  const chatId = useAppStore.getState().activeChatId;
                  if (!chatId) return;
                  useAppStore.getState().patchMessage(chatId, msg.id, {
                    artifacts: [...(msg.artifacts ?? []).filter((a) => a.id !== art.id), art],
                  });
                  useAppStore.getState().setArtifact(art.id);
                }}
              />
            ) : streaming ? (
              <p className="text-sm text-muted">
                <span className="dot-pulse inline-block align-middle" />{" "}
                {t(locale, "thinking")}
              </p>
            ) : null}
          </div>
        )}
        {showTime || (price && !isUser && msg.content) ? (
          <p className={cn("mt-1 text-[11px] text-faint", isUser && "text-right")}>
            {showTime ? formatTime(msg.createdAt) : null}
            {price && !isUser && msg.content
              ? `${showTime ? " · " : ""}${t(locale, "estimatedCost", { n: estimateCost(msg.content) })}`
              : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function ChatThread({
  messages,
  streamingId,
}: {
  messages: Message[];
  streamingId: string | null;
}) {
  const locale = useAppStore((s) => s.settings.locale);
  const bottom = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const lastCount = useRef(messages.length);

  // Auto-follow the stream only while the user is at the bottom. Smooth
  // scrolling on every delta used to queue overlapping animations and made the
  // thread bounce; instant jumps are imperceptible at 10Hz patch rates.
  useEffect(() => {
    const grew = messages.length > lastCount.current;
    lastCount.current = messages.length;
    const last = messages[messages.length - 1];
    if (grew && last?.role === "user") nearBottom.current = true;
    if (!nearBottom.current) return;
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, streamingId]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <LogoMark className="size-16" />
        <h1 className="mt-6 max-w-md text-2xl font-semibold tracking-tight">
          {t(locale, "emptyTitle")}
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted">{t(locale, "emptyBody")}</p>
        <div className="mt-8 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
          {(
            [
              ["suggestions.research", "research"],
              ["suggestions.code", "instant"],
              ["suggestions.explain", "think"],
              ["suggestions.prompt", "prompt"],
            ] as const
          ).map(([key, kind]) => (
            <button
              key={key}
              type="button"
              className="rounded-[var(--radius-md)] bg-surface px-4 py-3 text-left text-sm text-fg shadow-[var(--shadow-border)] hover:bg-elevated"
              onClick={() => {
                if (kind === "research") useAppStore.getState().setMode("research");
                if (kind === "think") useAppStore.getState().setMode("think");
                const text = t(locale, key);
                window.dispatchEvent(new CustomEvent("sds:fill", { detail: text }));
              }}
            >
              {t(locale, key)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scroller}
      onScroll={() => {
        const el = scroller.current;
        if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      }}
      className="overscroll-chat min-h-0 flex-1 overflow-y-auto pt-2"
    >
      {messages.map((m) => (
        <Bubble key={m.id} msg={m} streaming={streamingId === m.id} />
      ))}
      <div ref={bottom} className="h-4" />
    </div>
  );
}
