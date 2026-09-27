import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Plus, Square, Atom, Globe, Telescope, X } from "lucide-react";
import { useAppStore } from "@/lib/app-store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { performHaptic } from "@/lib/haptics";
import type { Attachment, ChatMode } from "@/lib/types";

type Props = {
  value: string;
  onChange: (v: string) => void;
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  onSend: () => void;
  onStop: () => void;
};

function ModeChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 text-xs font-medium transition-colors duration-150",
        active ? "bg-accent-dim text-accent" : "text-muted hover:bg-elevated hover:text-fg",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function Composer({
  value,
  onChange,
  attachments,
  onRemoveAttachment,
  onSend,
  onStop,
}: Props) {
  const locale = useAppStore((s) => s.settings.locale);
  const haptics = useAppStore((s) => s.settings.haptics);
  const mode = useAppStore((s) => s.ui.mode);
  const webSearch = useAppStore((s) => s.ui.webSearch);
  const streaming = useAppStore((s) => s.ui.streamingId);
  const online = useAppStore((s) => s.ui.online);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  function setMode(next: ChatMode) {
    performHaptic("select", haptics);
    useAppStore.getState().setMode(mode === next ? "instant" : next);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!streaming) onSend();
    }
  }

  const canSend = Boolean(value.trim() || attachments.length) && !streaming;

  return (
    <div className="px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
      {!online ? (
        <p className="mb-2 text-center text-xs text-warn">{t(locale, "queued")}</p>
      ) : null}
      <div className="composer-shell rounded-[var(--radius-xl)] bg-surface p-2">
        {attachments.length > 0 ? (
          <div className="mb-2 flex gap-2 overflow-x-auto px-1 pt-1">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="relative flex h-16 min-w-16 max-w-40 items-center gap-2 rounded-[var(--radius-sm)] bg-elevated pr-8 shadow-[var(--shadow-border)]"
              >
                {a.kind === "image" && a.dataUrl ? (
                  <img src={a.dataUrl} alt="" className="h-16 w-16 rounded-[var(--radius-sm)] object-cover" />
                ) : (
                  <div className="flex h-16 min-w-0 flex-col justify-center px-2">
                    <span className="truncate text-xs font-medium">{a.name}</span>
                    <span className="text-[10px] uppercase text-faint">{a.kind}</span>
                  </div>
                )}
                <button
                  type="button"
                  aria-label={t(locale, "close")}
                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-bg/80 text-fg"
                  onClick={() => onRemoveAttachment(a.id)}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <textarea
          ref={taRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          placeholder={t(locale, "composerPlaceholder")}
          className="max-h-[200px] min-h-11 w-full resize-none bg-transparent px-3 py-2.5 text-[15px] leading-6 outline-none placeholder:text-faint"
        />

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t(locale, "attach")}
            className="flex size-10 items-center justify-center rounded-[var(--radius-pill)] text-muted hover:bg-elevated hover:text-fg"
            onClick={() => {
              performHaptic("open", haptics);
              useAppStore.getState().setAttachOpen(true);
            }}
          >
            <Plus className="size-5" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            <ModeChip
              active={mode === "think"}
              onClick={() => setMode("think")}
              icon={<Atom className="size-3.5" />}
              label={t(locale, "think")}
            />
            <ModeChip
              active={webSearch}
              onClick={() => {
                performHaptic("select", haptics);
                useAppStore.getState().setWebSearch(!webSearch);
              }}
              icon={<Globe className="size-3.5" />}
              label={t(locale, "search")}
            />
            <ModeChip
              active={mode === "research"}
              onClick={() => setMode("research")}
              icon={<Telescope className="size-3.5" />}
              label={t(locale, "research")}
            />
          </div>
          {streaming ? (
            <button
              type="button"
              aria-label={t(locale, "stop")}
              className="flex size-10 items-center justify-center rounded-[var(--radius-pill)] bg-fg text-bg"
              onClick={onStop}
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              aria-label={t(locale, "send")}
              disabled={!canSend}
              className="flex size-10 items-center justify-center rounded-[var(--radius-pill)] bg-accent text-accent-fg disabled:opacity-30"
              onClick={onSend}
            >
              <ArrowUp className="size-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
