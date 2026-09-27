import { useState } from "react";
import { BottomSheet } from "./ui/bottom-sheet";
import { Toggle } from "./ui/controls";
import { useAppStore } from "@/lib/app-store";
import { t } from "@/lib/i18n";
import { uid } from "@/lib/utils";
import type { LibraryTab } from "@/lib/types";
import { cn } from "@/lib/utils";
import { performHaptic } from "@/lib/haptics";

const TABS: LibraryTab[] = ["prompts", "memories", "skills", "characters", "projects"];

export function LibrarySheet() {
  const open = useAppStore((s) => s.ui.libraryOpen);
  const tab = useAppStore((s) => s.ui.libraryTab);
  const locale = useAppStore((s) => s.settings.locale);
  const haptics = useAppStore((s) => s.settings.haptics);
  const skip = useAppStore((s) => s.settings.skipDeletionConfirmation);
  const prompts = useAppStore((s) => s.prompts);
  const memories = useAppStore((s) => s.memories);
  const skills = useAppStore((s) => s.skills);
  const characters = useAppStore((s) => s.characters);
  const projects = useAppStore((s) => s.projects);
  const activePrompt = useAppStore((s) => s.settings.activeSystemPromptId);

  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [extra, setExtra] = useState("");

  function reset() {
    setName("");
    setBody("");
    setExtra("");
  }

  function confirmDel(fn: () => void) {
    if (skip || window.confirm(t(locale, "confirmDelete"))) fn();
  }

  function add() {
    const n = name.trim();
    const c = body.trim();
    if (!n || !c) return;
    performHaptic("success", haptics);
    if (tab === "prompts") {
      const id = uid("prm");
      useAppStore.getState().upsertPrompt({ id, name: n, content: c });
    } else if (tab === "memories") {
      useAppStore.getState().upsertMemory({
        id: uid("mem"),
        key: n,
        value: c,
        importance: extra === "called" ? "called" : "always",
      });
    } else if (tab === "skills") {
      useAppStore.getState().upsertSkill({
        id: uid("sk"),
        name: n,
        usage: extra,
        content: c,
        active: true,
      });
    } else if (tab === "characters") {
      useAppStore.getState().upsertCharacter({
        id: uid("ch"),
        name: n,
        usage: extra,
        content: c,
        active: false,
      });
    } else {
      useAppStore.getState().upsertProject({
        id: uid("prj"),
        name: n,
        instructions: c,
        active: false,
      });
    }
    reset();
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => useAppStore.getState().setLibraryOpen(v)}
      title={t(locale, "library")}
    >
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-[var(--radius-sm)] bg-elevated p-1">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => useAppStore.getState().setLibraryOpen(true, id)}
            className={cn(
              "h-9 shrink-0 rounded-[6px] px-3 text-xs font-medium",
              tab === id ? "bg-surface text-fg" : "text-muted",
            )}
          >
            {t(locale, id)}
          </button>
        ))}
      </div>

      <div className="space-y-2 pb-4">
        {tab === "prompts" ? (
          <>
            <button
              type="button"
              onClick={() =>
                useAppStore.getState().patchSettings({ activeSystemPromptId: "default" })
              }
              className={cn(
                "w-full rounded-[var(--radius-md)] bg-elevated px-3 py-3 text-left shadow-[var(--shadow-border)]",
                activePrompt === "default" && "outline outline-1 outline-accent",
              )}
            >
              <p className="text-sm font-medium">{t(locale, "defaultPrompt")}</p>
            </button>
            {prompts.map((p) => (
              <Item
                key={p.id}
                title={p.name}
                body={p.content}
                active={activePrompt === p.id}
                onSelect={() =>
                  useAppStore.getState().patchSettings({ activeSystemPromptId: p.id })
                }
                onDelete={() => confirmDel(() => useAppStore.getState().deletePrompt(p.id))}
              />
            ))}
          </>
        ) : null}

        {tab === "memories"
          ? memories.map((m) => (
              <Item
                key={m.id}
                title={m.key}
                body={m.value}
                meta={t(locale, m.importance)}
                onDelete={() => confirmDel(() => useAppStore.getState().deleteMemory(m.id))}
              />
            ))
          : null}

        {tab === "skills"
          ? skills.map((s) => (
              <Item
                key={s.id}
                title={s.name}
                body={s.content}
                toggle={s.active}
                onToggle={(active) => useAppStore.getState().upsertSkill({ ...s, active })}
                onDelete={() => confirmDel(() => useAppStore.getState().deleteSkill(s.id))}
              />
            ))
          : null}

        {tab === "characters"
          ? characters.map((c) => (
              <Item
                key={c.id}
                title={c.name}
                body={c.content}
                toggle={c.active}
                onToggle={(active) => useAppStore.getState().upsertCharacter({ ...c, active })}
                onDelete={() => confirmDel(() => useAppStore.getState().deleteCharacter(c.id))}
              />
            ))
          : null}

        {tab === "projects"
          ? projects.map((p) => (
              <Item
                key={p.id}
                title={p.name}
                body={p.instructions}
                toggle={p.active}
                onToggle={(active) => useAppStore.getState().upsertProject({ ...p, active })}
                onDelete={() => confirmDel(() => useAppStore.getState().deleteProject(p.id))}
              />
            ))
          : null}

        {((tab === "prompts" && prompts.length === 0) ||
          (tab === "memories" && memories.length === 0) ||
          (tab === "skills" && skills.length === 0) ||
          (tab === "characters" && characters.length === 0) ||
          (tab === "projects" && projects.length === 0)) &&
        tab !== "prompts" ? (
          <p className="py-6 text-center text-sm text-muted">{t(locale, "emptyLibrary")}</p>
        ) : null}
      </div>

      <div className="rounded-[var(--radius-md)] bg-elevated p-3 shadow-[var(--shadow-border)]">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={
            tab === "memories"
              ? t(locale, "key")
              : t(locale, "name")
          }
          className="mb-2 h-10 w-full rounded-[var(--radius-sm)] bg-bg px-3 text-sm outline-none"
        />
        {tab === "memories" ? (
          <div className="mb-2">
            <SegmentMini
              value={extra === "called" ? "called" : "always"}
              onChange={setExtra}
              a={{ id: "always", label: t(locale, "always") }}
              b={{ id: "called", label: t(locale, "called") }}
            />
          </div>
        ) : tab === "skills" || tab === "characters" ? (
          <input
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder={t(locale, "usage")}
            className="mb-2 h-10 w-full rounded-[var(--radius-sm)] bg-bg px-3 text-sm outline-none"
          />
        ) : null}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={tab === "projects" ? t(locale, "instructions") : t(locale, "content")}
          rows={3}
          className="mb-2 w-full rounded-[var(--radius-sm)] bg-bg px-3 py-2 text-sm outline-none"
        />
        <button
          type="button"
          onClick={add}
          className="h-11 w-full rounded-[var(--radius-sm)] bg-accent text-sm font-medium text-accent-fg"
        >
          {t(
            locale,
            tab === "prompts"
              ? "newPrompt"
              : tab === "memories"
                ? "newMemory"
                : tab === "skills"
                  ? "newSkill"
                  : tab === "characters"
                    ? "newCharacter"
                    : "newProject",
          )}
        </button>
      </div>
    </BottomSheet>
  );
}

function SegmentMini({
  value,
  onChange,
  a,
  b,
}: {
  value: string;
  onChange: (v: string) => void;
  a: { id: string; label: string };
  b: { id: string; label: string };
}) {
  return (
    <div className="flex rounded-[var(--radius-sm)] bg-bg p-1">
      {[a, b].map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "h-8 flex-1 rounded-[6px] text-xs font-medium",
            value === o.id ? "bg-surface text-fg" : "text-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Item({
  title,
  body,
  meta,
  active,
  toggle,
  onSelect,
  onToggle,
  onDelete,
}: {
  title: string;
  body: string;
  meta?: string;
  active?: boolean;
  toggle?: boolean;
  onSelect?: () => void;
  onToggle?: (v: boolean) => void;
  onDelete: () => void;
}) {
  const locale = useAppStore((s) => s.settings.locale);
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] bg-elevated p-3 shadow-[var(--shadow-border)]",
        active && "outline outline-1 outline-accent",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onSelect}
          disabled={!onSelect}
        >
          <p className="text-sm font-medium">{title}</p>
          {meta ? <p className="text-[11px] uppercase tracking-wide text-faint">{meta}</p> : null}
          <p className="mt-1 line-clamp-2 text-xs text-muted">{body}</p>
        </button>
        {onToggle ? <Toggle on={Boolean(toggle)} onChange={onToggle} /> : null}
      </div>
      <button
        type="button"
        className="mt-2 text-xs text-danger"
        onClick={onDelete}
      >
        {t(locale, "delete")}
      </button>
    </div>
  );
}
