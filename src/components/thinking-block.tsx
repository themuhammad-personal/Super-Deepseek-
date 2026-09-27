import { useState } from "react";
import { ChevronDown, Atom } from "lucide-react";
import type { ResearchStep } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ThinkingBlock({
  thinking,
  steps,
  thinkingMs,
  streaming,
  labels,
}: {
  thinking?: string;
  steps?: ResearchStep[];
  thinkingMs?: number;
  streaming: boolean;
  labels: { thinking: string; thoughtFor: string; researching: string };
}) {
  const [open, setOpen] = useState(streaming);
  if (!thinking && !steps?.length) return null;
  const seconds = Math.max(1, Math.round((thinkingMs ?? 0) / 1000));
  const title = streaming
    ? steps?.length
      ? labels.researching
      : labels.thinking
    : labels.thoughtFor.replace("{n}", String(seconds));

  return (
    <div className="mb-3 overflow-hidden rounded-[var(--radius-md)] bg-elevated shadow-[var(--shadow-border)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-muted"
      >
        <Atom className={cn("size-4 text-accent", streaming && "animate-spin")} />
        <span className="flex-1 font-medium text-fg">{title}</span>
        <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-line px-3 py-3 text-sm text-muted">
          {steps?.map((s) => (
            <div key={s.id} className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  s.status === "done" && "bg-ok",
                  s.status === "running" && "bg-accent",
                  s.status === "pending" && "bg-faint",
                )}
              />
              <div>
                <p className={cn("text-fg", s.status === "running" && "shimmer rounded-sm")}>{s.title}</p>
                {s.detail ? <p className="text-xs">{s.detail}</p> : null}
              </div>
            </div>
          ))}
          {thinking ? (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">{thinking}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
