import { Atom, Globe, Plus, Telescope, Zap } from "lucide-react";
import { BottomSheet } from "./ui/bottom-sheet";
import { useAppStore } from "@/lib/app-store";
import { t } from "@/lib/i18n";
import { performHaptic } from "@/lib/haptics";
import { uid } from "@/lib/utils";
import { useState } from "react";

function fill(text: string) {
  window.dispatchEvent(new CustomEvent("sds:fill", { detail: text }));
}

export function CommandsSheet() {
  const open = useAppStore((s) => s.ui.commandsOpen);
  const locale = useAppStore((s) => s.settings.locale);
  const haptics = useAppStore((s) => s.settings.haptics);
  const prompts = useAppStore((s) => s.prompts);
  const commands = useAppStore((s) => s.commands);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");

  const builtins = [
    {
      id: "think",
      icon: Atom,
      label: t(locale, "builtinThink"),
      run: () => useAppStore.getState().setMode("think"),
    },
    {
      id: "search",
      icon: Globe,
      label: t(locale, "builtinSearch"),
      run: () => useAppStore.getState().setWebSearch(!useAppStore.getState().ui.webSearch),
    },
    {
      id: "research",
      icon: Telescope,
      label: t(locale, "builtinResearch"),
      run: () => useAppStore.getState().setMode("research"),
    },
    {
      id: "new",
      icon: Plus,
      label: t(locale, "builtinNew"),
      run: () => useAppStore.getState().newChat(),
    },
  ];

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => useAppStore.getState().setCommandsOpen(v)}
      title={t(locale, "commandTitle")}
    >
      <p className="pb-3 text-sm text-muted">{t(locale, "commandHint")}</p>
      <div className="space-y-2 pb-4">
        {builtins.map((b) => (
          <button
            key={b.id}
            type="button"
            className="flex h-12 w-full items-center gap-3 rounded-[var(--radius-md)] bg-elevated px-3 text-sm shadow-[var(--shadow-border)]"
            onClick={() => {
              performHaptic("select", haptics);
              b.run();
              useAppStore.getState().setCommandsOpen(false);
              useAppStore.getState().setAttachOpen(false);
            }}
          >
            <b.icon className="size-4 text-accent" />
            {b.label}
          </button>
        ))}
        {prompts.map((p) => (
          <button
            key={p.id}
            type="button"
            className="flex w-full items-start gap-3 rounded-[var(--radius-md)] bg-elevated px-3 py-3 text-left text-sm shadow-[var(--shadow-border)]"
            onClick={() => {
              fill(p.content);
              useAppStore.getState().setCommandsOpen(false);
              useAppStore.getState().setAttachOpen(false);
            }}
          >
            <Zap className="mt-0.5 size-4 text-accent" />
            <span>
              <span className="block font-medium">{p.name}</span>
              <span className="line-clamp-2 text-xs text-muted">{p.content}</span>
            </span>
          </button>
        ))}
        {commands.map((c) => (
          <button
            key={c.id}
            type="button"
            className="flex w-full items-start gap-3 rounded-[var(--radius-md)] bg-elevated px-3 py-3 text-left text-sm shadow-[var(--shadow-border)]"
            onClick={() => {
              fill(c.prompt);
              useAppStore.getState().setCommandsOpen(false);
              useAppStore.getState().setAttachOpen(false);
            }}
          >
            <Zap className="mt-0.5 size-4 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">/{c.name}</span>
              <span className="line-clamp-2 text-xs text-muted">{c.prompt}</span>
            </span>
          </button>
        ))}
      </div>
      <div className="rounded-[var(--radius-md)] bg-elevated p-3 shadow-[var(--shadow-border)]">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(locale, "name")}
          className="mb-2 h-10 w-full rounded-[var(--radius-sm)] bg-bg px-3 text-sm outline-none"
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(locale, "content")}
          rows={3}
          className="mb-2 w-full rounded-[var(--radius-sm)] bg-bg px-3 py-2 text-sm outline-none"
        />
        <button
          type="button"
          className="h-11 w-full rounded-[var(--radius-sm)] bg-accent text-sm font-medium text-accent-fg"
          onClick={() => {
            if (!name.trim() || !prompt.trim()) return;
            useAppStore.getState().upsertCommand({
              id: uid("cmd"),
              name: name.trim().replace(/^\//, ""),
              prompt: prompt.trim(),
            });
            setName("");
            setPrompt("");
          }}
        >
          {t(locale, "add")}
        </button>
      </div>
    </BottomSheet>
  );
}
