import { TerminalSquare } from "lucide-react";
import type { TerminalOutput } from "@/lib/types";

export function TerminalCard({ term, label }: { term: TerminalOutput; label: string }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] bg-code shadow-[var(--shadow-border)]">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs uppercase tracking-wide text-muted">
        <TerminalSquare className="size-3.5" />
        {label}
        <span className="ml-auto font-mono normal-case text-faint">exit {term.exitCode}</span>
      </div>
      <pre className="max-h-64 overflow-auto p-3 font-mono text-xs leading-relaxed">
        <span className="text-muted">$ {term.command.slice(0, 80)}</span>
        {"\n"}
        {term.stdout ? <span className="text-ok">{term.stdout}</span> : null}
        {term.stderr ? <span className="text-danger">{term.stderr}</span> : null}
        {!term.stdout && !term.stderr ? <span className="text-faint">(no output)</span> : null}
      </pre>
    </div>
  );
}
