import { useMemo, useRef, useState } from "react";
import {
  Pin,
  Trash2,
  Plus,
  Search,
  Settings,
  Puzzle,
  WifiOff,
  Library,
  LogOut,
} from "lucide-react";
import { LogoMark } from "./logo-mark";
import { useAppStore } from "@/lib/app-store";
import { groupChats, type ChatGroupKey } from "@/lib/group-chats";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { performHaptic } from "@/lib/haptics";
import type { Chat } from "@/lib/types";

const GROUP_LABEL: Record<ChatGroupKey, "pinned" | "today" | "yesterday" | "previous7" | "older"> = {
  pinned: "pinned",
  today: "today",
  yesterday: "yesterday",
  week: "previous7",
  older: "older",
};

function SwipeChat({
  chat,
  active,
  onSelect,
  onPin,
  onDelete,
}: {
  chat: Chat;
  active: boolean;
  onSelect: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const startX = useRef(0);
  const [dx, setDx] = useState(0);
  const dragging = useRef(false);

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-sm)]">
      <div className="absolute inset-y-0 left-0 flex w-20 items-center justify-center bg-accent-dim text-accent">
        <Pin className="size-4" />
      </div>
      <div className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-danger/20 text-danger">
        <Trash2 className="size-4" />
      </div>
      <button
        type="button"
        className={cn(
          "swipe-row relative flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors duration-150",
          active ? "bg-elevated text-fg" : "bg-surface text-muted hover:bg-elevated hover:text-fg",
        )}
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={(e) => {
          dragging.current = true;
          startX.current = e.clientX;
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const next = Math.max(-96, Math.min(96, e.clientX - startX.current));
          setDx(next);
        }}
        onPointerUp={() => {
          dragging.current = false;
          if (dx > 56) onPin();
          else if (dx < -56) onDelete();
          setDx(0);
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setDx(0);
        }}
        onClick={() => {
          if (Math.abs(dx) < 8) onSelect();
        }}
      >
        {chat.pinned ? <Pin className="size-3 shrink-0 text-accent" /> : null}
        <span className="min-w-0 flex-1 truncate">{chat.title}</span>
      </button>
    </div>
  );
}

export function Sidebar() {
  const chats = useAppStore((s) => s.chats);
  const active = useAppStore((s) => s.activeChatId);
  const locale = useAppStore((s) => s.settings.locale);
  const haptics = useAppStore((s) => s.settings.haptics);
  const skip = useAppStore((s) => s.settings.skipDeletionConfirmation);
  const queue = useAppStore((s) => s.queue);
  const account = useAppStore((s) => s.account);
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const filtered = q
      ? chats.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()))
      : chats;
    return groupChats(filtered);
  }, [chats, q]);

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2.5 px-4 pb-3 pt-[max(16px,env(safe-area-inset-top))]">
        <LogoMark className="size-9" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight">{t(locale, "appName")}</p>
          <p className="truncate text-[11px] text-muted">{t(locale, "tagline")}</p>
        </div>
      </div>

      <div className="px-3">
        <button
          type="button"
          className="flex h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-accent text-sm font-semibold text-accent-fg active:scale-[0.96]"
          onClick={() => {
            performHaptic("open", haptics);
            useAppStore.getState().newChat();
          }}
        >
          <Plus className="size-4" />
          {t(locale, "newChat")}
        </button>
      </div>

      <label className="mx-3 mt-3 flex h-10 items-center gap-2 rounded-[var(--radius-sm)] bg-elevated px-3 shadow-[var(--shadow-border)]">
        <Search className="size-4 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t(locale, "searchChats")}
          className="h-full w-full bg-transparent text-sm outline-none placeholder:text-faint"
        />
      </label>

      <nav className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {groups.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">{t(locale, "noChats")}</p>
        ) : (
          groups.map((g) => (
            <section key={g.key} className="mb-4">
              <h2 className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
                {t(locale, GROUP_LABEL[g.key])}
              </h2>
              <div className="space-y-0.5">
                {g.items.map((c) => (
                  <SwipeChat
                    key={c.id}
                    chat={c}
                    active={c.id === active}
                    onSelect={() => useAppStore.getState().selectChat(c.id)}
                    onPin={() => {
                      performHaptic("select", haptics);
                      useAppStore.getState().pinChat(c.id);
                    }}
                    onDelete={() => {
                      if (!skip && !window.confirm(t(locale, "confirmDelete"))) return;
                      performHaptic("error", haptics);
                      useAppStore.getState().deleteChat(c.id);
                    }}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </nav>

      <div className="space-y-1 border-t border-line px-2 py-2 pb-[max(10px,env(safe-area-inset-bottom))]">
        {account ? (
          <div className="px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-faint">{t(locale, "signedInAs")}</p>
            <p className="truncate text-sm">{account.email || account.mobile}</p>
          </div>
        ) : null}
        <button
          type="button"
          className="flex h-11 w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 text-sm text-muted hover:bg-elevated hover:text-fg"
          onClick={() => useAppStore.getState().setLibraryOpen(true)}
        >
          <Library className="size-4" />
          {t(locale, "library")}
        </button>
        <button
          type="button"
          className="flex h-11 w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 text-sm text-muted hover:bg-elevated hover:text-fg"
          onClick={() => useAppStore.getState().setMcpOpen(true)}
        >
          <Puzzle className="size-4" />
          {t(locale, "plugins")}
        </button>
        <button
          type="button"
          className="flex h-11 w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 text-sm text-muted hover:bg-elevated hover:text-fg"
          onClick={() => useAppStore.getState().setSettingsOpen(true)}
        >
          <Settings className="size-4" />
          {t(locale, "settings")}
        </button>
        {queue.length > 0 ? (
          <button
            type="button"
            className="flex h-11 w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 text-sm text-warn hover:bg-elevated"
            onClick={() => useAppStore.getState().setQueueOpen(true)}
          >
            <WifiOff className="size-4" />
            {t(locale, "queueTitle")}
            <span className="ml-auto tabular-nums text-xs">{queue.length}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="flex h-11 w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 text-sm text-muted hover:bg-elevated hover:text-fg"
          onClick={() => useAppStore.getState().signOut()}
        >
          <LogOut className="size-4" />
          {t(locale, "signOut")}
        </button>
      </div>
    </div>
  );
}
