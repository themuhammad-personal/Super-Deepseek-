import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { artifactSrcDoc } from "@/lib/artifacts";
import type { Artifact } from "@/lib/types";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/types";

export function ArtifactsPanel({
  artifact,
  locale,
  onClose,
  onChange,
}: {
  artifact: Artifact;
  locale: Locale;
  onClose: () => void;
  onChange: (code: string) => void;
}) {
  const [tab, setTab] = useState<"preview" | "source">("preview");
  const [code, setCode] = useState(artifact.code);

  useEffect(() => {
    setCode(artifact.code);
    setTab("preview");
  }, [artifact.id, artifact.code]);

  const doc = artifactSrcDoc({ ...artifact, code });

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{artifact.title}</p>
        <div className="flex rounded-[var(--radius-sm)] bg-elevated p-0.5">
          <button
            type="button"
            className={cn(
              "h-8 rounded-[6px] px-2.5 text-xs font-medium",
              tab === "preview" ? "bg-surface text-fg" : "text-muted",
            )}
            onClick={() => setTab("preview")}
          >
            {t(locale, "preview")}
          </button>
          <button
            type="button"
            className={cn(
              "h-8 rounded-[6px] px-2.5 text-xs font-medium",
              tab === "source" ? "bg-surface text-fg" : "text-muted",
            )}
            onClick={() => setTab("source")}
          >
            {t(locale, "source")}
          </button>
        </div>
        <button
          type="button"
          aria-label={t(locale, "close")}
          className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-elevated hover:text-fg"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>
      {tab === "preview" ? (
        <iframe
          title={artifact.title}
          sandbox="allow-scripts"
          className="min-h-0 flex-1 bg-bg"
          srcDoc={doc}
        />
      ) : (
        <textarea
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            onChange(e.target.value);
          }}
          className="min-h-0 flex-1 resize-none bg-code p-3 font-mono text-xs leading-relaxed outline-none"
          spellCheck={false}
        />
      )}
    </div>
  );
}
