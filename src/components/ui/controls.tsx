import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="mt-0.5 text-xs leading-5 text-muted">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex max-w-full rounded-[var(--radius-sm)] bg-bg p-1 shadow-[var(--shadow-border)]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "h-8 min-w-0 flex-1 rounded-[6px] px-2 text-xs font-medium",
            value === o.id ? "bg-surface text-fg" : "text-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200",
        on ? "bg-accent" : "bg-bg shadow-[var(--shadow-border)]",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-6 rounded-full bg-fg transition-transform duration-200",
          on ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4 rounded-[var(--radius-lg)] bg-elevated px-4 shadow-[var(--shadow-border)]">
      <h3 className="pt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{title}</h3>
      {children}
    </section>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block py-2.5">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-[var(--radius-sm)] bg-bg px-3 text-sm shadow-[var(--shadow-border)] outline-none placeholder:text-faint"
      />
    </label>
  );
}
