import { useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Menu, Plus } from "lucide-react";
import { Toaster } from "sonner";
import { Sidebar } from "./sidebar";
import { ChatThread } from "./chat-thread";
import { Composer } from "./composer";
import { AttachSheet } from "./attach-sheet";
import { SettingsSheet, refreshRagCount } from "./settings-sheet";
import { McpDashboard } from "./mcp-dashboard";
import { ArtifactsPanel } from "./artifacts-panel";
import { QueueSheet, flushQueue } from "./queue-sheet";
import { LibrarySheet } from "./library-sheet";
import { CommandsSheet } from "./commands-sheet";
import { Splash } from "./splash";
import { LoginScreen } from "./login-screen";
import { activeArtifact, composedCss, useActiveChat, useAppStore } from "@/lib/app-store";
import { bindKeyboardInsets } from "@/lib/keyboard-insets";
import { sendChat } from "@/lib/send-chat";
import { t } from "@/lib/i18n";
import type { Attachment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { performHaptic } from "@/lib/haptics";

function resolvedTheme(pref: "oled" | "light" | "system"): "oled" | "light" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "oled";
  }
  return pref;
}

export function AppShell() {
  const hydrated = useAppStore((s) => s.ui.hydrated);
  const [splash, setSplash] = useState(true);
  const theme = useAppStore((s) => s.settings.theme);
  const accent = useAppStore((s) => s.settings.accent);
  const locale = useAppStore((s) => s.settings.locale);
  const customCSS = useAppStore((s) => s.settings.customCSS);
  const snippets = useAppStore((s) => s.cssSnippets);
  const sidebarOpen = useAppStore((s) => s.ui.sidebarOpen);
  const artifactId = useAppStore((s) => s.ui.artifactId);
  const streamingId = useAppStore((s) => s.ui.streamingId);
  const online = useAppStore((s) => s.ui.online);
  const account = useAppStore((s) => s.account);
  const chat = useActiveChat();
  const haptics = useAppStore((s) => s.settings.haptics);
  const [draft, setDraft] = useState("");
  const [atts, setAtts] = useState<Attachment[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const done = Promise.resolve(useAppStore.persist.rehydrate());
    void done.then(() => {
      useAppStore.getState().hydrateUi();
      refreshRagCount();
    });
    const tmr = window.setTimeout(() => setSplash(false), 900);
    return () => window.clearTimeout(tmr);
  }, []);

  useEffect(() => {
    if (!rootRef.current) return;
    return bindKeyboardInsets(rootRef.current);
  }, [hydrated]);

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolvedTheme(theme);
      document.documentElement.dataset.accent = accent;
      document.documentElement.style.colorScheme =
        resolvedTheme(theme) === "light" ? "light" : "dark";
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme, accent]);

  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 900);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const go = () => {
      useAppStore.getState().setOnline(navigator.onLine);
      if (navigator.onLine) void flushQueue();
    };
    go();
    window.addEventListener("online", go);
    window.addEventListener("offline", go);
    return () => {
      window.removeEventListener("online", go);
      window.removeEventListener("offline", go);
    };
  }, []);

  useEffect(() => {
    const onFill = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      setDraft(text);
    };
    window.addEventListener("sds:fill", onFill);
    return () => window.removeEventListener("sds:fill", onFill);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("share") || params.get("q") || params.get("text");
    if (shared) {
      setDraft(shared);
      performHaptic("open", haptics);
    }
  }, [haptics]);

  const art = activeArtifact(chat, artifactId);
  const css = composedCss();

  async function onSend() {
    const text = draft;
    const files = atts;
    setDraft("");
    setAtts([]);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    await sendChat(
      { content: text, attachments: files, chatId: chat?.id },
      abortRef.current,
    );
  }

  function onStop() {
    abortRef.current?.abort();
    useAppStore.getState().setStreaming(null);
  }

  if (!hydrated || splash) return <Splash />;
  if (!account) return <LoginScreen />;

  const thread = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-12 items-center gap-1 px-2 pt-[max(0px,env(safe-area-inset-top))] md:h-14">
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-elevated hover:text-fg md:hidden"
          aria-label="Menu"
          onClick={() => useAppStore.getState().setSidebar(true)}
        >
          <Menu className="size-5" />
        </button>
        <p className="min-w-0 flex-1 truncate px-2 text-sm font-medium">
          {chat?.title ?? t(locale, "newChat")}
        </p>
        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-elevated hover:text-fg"
          aria-label={t(locale, "newChat")}
          onClick={() => {
            performHaptic("open", haptics);
            useAppStore.getState().newChat();
            setDraft("");
            setAtts([]);
          }}
        >
          <Plus className="size-5" />
        </button>
      </header>
      {!online ? (
        <div className="mx-4 mb-1 rounded-[var(--radius-sm)] bg-warn/15 px-3 py-2 text-center text-xs text-warn">
          {t(locale, "offlineTitle")} — {t(locale, "offlineBody")}
        </div>
      ) : null}
      {account?.guest ? (
        <div className="mx-4 mb-1 flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-accent-dim px-3 py-2 text-xs text-accent">
          <span>{t(locale, "guestBanner")}</span>
          <button
            type="button"
            className="shrink-0 font-semibold"
            onClick={() => useAppStore.getState().setAccount(null)}
          >
            {t(locale, "signInNow")}
          </button>
        </div>
      ) : null}
      <ChatThread messages={chat?.messages ?? []} streamingId={streamingId} />
      <Composer
        value={draft}
        onChange={setDraft}
        attachments={atts}
        onRemoveAttachment={(id) => setAtts((xs) => xs.filter((a) => a.id !== id))}
        onSend={() => void onSend()}
        onStop={onStop}
      />
    </div>
  );

  return (
    <div ref={rootRef} className="app-root">
      {css ? <style>{css}</style> : null}
      <Toaster
        theme={resolvedTheme(theme) === "light" ? "light" : "dark"}
        position="top-center"
        toastOptions={{
          className: "font-sans",
        }}
      />
      <aside className="hidden w-72 shrink-0 border-r border-line md:block">
        <Sidebar />
      </aside>

      <div
        className={cn(
          "fixed inset-0 z-40 md:hidden",
          sidebarOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
      >
        <button
          type="button"
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity duration-200",
            sidebarOpen ? "opacity-100" : "opacity-0",
          )}
          aria-label={t(locale, "close")}
          onClick={() => useAppStore.getState().setSidebar(false)}
        />
        <div
          className={cn(
            "absolute inset-y-0 left-0 w-[min(20rem,88vw)] bg-surface shadow-[var(--shadow-pop)] transition-transform duration-300",
            sidebarOpen ? "translate-x-0" : "-translate-x-full",
          )}
          style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
        >
          <Sidebar />
        </div>
      </div>

      <main className="flex min-w-0 flex-1">
        {art && wide ? (
          <Group orientation="horizontal" className="h-full w-full">
            <Panel defaultSize={56} minSize={36}>
              {thread}
            </Panel>
            <Separator className="w-px bg-line" />
            <Panel defaultSize={44} minSize={28}>
              <ArtifactsPanel
                artifact={art}
                locale={locale}
                onClose={() => useAppStore.getState().setArtifact(null)}
                onChange={(code) => {
                  if (!chat) return;
                  for (const m of chat.messages) {
                    if (!m.artifacts) continue;
                    if (m.artifacts.some((a) => a.id === art.id)) {
                      useAppStore.getState().patchMessage(chat.id, m.id, {
                        artifacts: m.artifacts.map((a) =>
                          a.id === art.id ? { ...a, code } : a,
                        ),
                      });
                    }
                  }
                }}
              />
            </Panel>
          </Group>
        ) : (
          thread
        )}
      </main>

      {art && !wide ? (
        <div className="fixed inset-0 z-30 bg-bg">
          <ArtifactsPanel
            artifact={art}
            locale={locale}
            onClose={() => useAppStore.getState().setArtifact(null)}
            onChange={() => {}}
          />
        </div>
      ) : null}

      <AttachSheet onAdd={(items) => setAtts((xs) => [...xs, ...items])} />
      <SettingsSheet />
      <McpDashboard />
      <QueueSheet />
      <LibrarySheet />
      <CommandsSheet />
      <span className="sr-only">
        {customCSS}
        {snippets.length}
      </span>
    </div>
  );
}
