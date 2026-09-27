import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  AccentPref,
  Account,
  Attachment,
  CharacterEntry,
  Chat,
  ChatMode,
  CommandEntry,
  CssSnippet,
  LibraryTab,
  Locale,
  McpServer,
  MemoryEntry,
  Message,
  ProjectEntry,
  PromptEntry,
  QueuedItem,
  Settings,
  SkillEntry,
  ThemePref,
} from "./types";
import { uid } from "./utils";
import { defaultMcpServers } from "./mcp-presets";
import { titleFromPrompt } from "./group-chats";

export const defaultSettings: Settings = {
  theme: "oled",
  accent: "ice",
  locale: "en",
  showTimestamps: false,
  haptics: true,
  collapseLong: true,
  ragChunks: 5,
  syncLocale: true,
  preferredLang: "",
  disableSystemPrompt: false,
  disableMemory: false,
  injectSystemDateTime: true,
  skipDeletionConfirmation: false,
  systemPromptInjectionFrequency: "first",
  systemPromptInjectionInterval: 3,
  tokenPriceDisplay: false,
  oledDarkMode: true,
  disableTipBox: false,
  processGitignoreOnUpload: true,
  loadAllHistoryOnSession: false,
  projectRagEnabled: true,
  autoDownloadFiles: false,
  autoDownloadLongWorkZip: false,
  githubToken: "",
  searchProviders: ["ddg-lite", "ddg-html", "bing"],
  deepResearchDeepFetch: 1,
  deepResearchContextGuardEnabled: true,
  deepResearchContextLimitTokens: 128000,
  deepResearchContextStopPercent: 70,
  mcpInlineMaxChars: 8000,
  htmlToMarkdownMaxDepth: 400,
  maxChatSessions: 500,
  customCSS: "",
  activeSystemPromptId: "default",
  systemPromptMultiMode: false,
};

type UiState = {
  sidebarOpen: boolean;
  attachOpen: boolean;
  settingsOpen: boolean;
  mcpOpen: boolean;
  queueOpen: boolean;
  libraryOpen: boolean;
  libraryTab: LibraryTab;
  commandsOpen: boolean;
  artifactId: string | null;
  streamingId: string | null;
  mode: ChatMode;
  webSearch: boolean;
  online: boolean;
  hydrated: boolean;
  ragCount: number;
  loginError: string;
  loginBusy: boolean;
};

type AppState = {
  account: Account | null;
  chats: Chat[];
  activeChatId: string | null;
  settings: Settings;
  mcp: McpServer[];
  queue: QueuedItem[];
  prompts: PromptEntry[];
  memories: MemoryEntry[];
  skills: SkillEntry[];
  characters: CharacterEntry[];
  projects: ProjectEntry[];
  cssSnippets: CssSnippet[];
  commands: CommandEntry[];
  ui: UiState;
};

type CollectionPatch = {
  chats?: Chat[];
  mcp?: McpServer[];
  prompts?: PromptEntry[];
  memories?: MemoryEntry[];
  skills?: SkillEntry[];
  characters?: CharacterEntry[];
  projects?: ProjectEntry[];
  cssSnippets?: CssSnippet[];
  commands?: CommandEntry[];
};

type Actions = {
  hydrateUi: () => void;
  hydrateCollections: (p: CollectionPatch) => void;
  setOnline: (v: boolean) => void;
  setLocale: (l: Locale) => void;
  setTheme: (t: ThemePref) => void;
  setAccent: (a: AccentPref) => void;
  patchSettings: (p: Partial<Settings>) => void;
  setAccount: (a: Account | null) => void;
  setSidebar: (v: boolean) => void;
  setAttachOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  setMcpOpen: (v: boolean) => void;
  setQueueOpen: (v: boolean) => void;
  setLibraryOpen: (v: boolean, tab?: LibraryTab) => void;
  setCommandsOpen: (v: boolean) => void;
  setMode: (m: ChatMode) => void;
  setWebSearch: (v: boolean) => void;
  setRagCount: (n: number) => void;
  setArtifact: (id: string | null) => void;
  setLoginError: (s: string) => void;
  setLoginBusy: (v: boolean) => void;
  newChat: () => string;
  selectChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  deleteChat: (id: string) => void;
  pinChat: (id: string) => void;
  bindDsSession: (chatId: string, dsSessionId: string) => void;
  bindDsLastMessage: (chatId: string, dsLastMessageId: string) => void;
  appendMessage: (chatId: string, msg: Message) => void;
  patchMessage: (chatId: string, msgId: string, patch: Partial<Message>) => void;
  setStreaming: (id: string | null) => void;
  enqueue: (item: Omit<QueuedItem, "id" | "createdAt">) => void;
  dequeue: (id: string) => void;
  clearQueue: () => void;
  toggleMcp: (id: string) => void;
  setMcpStatus: (id: string, patch: Partial<McpServer>) => void;
  upsertMcp: (m: McpServer) => void;
  deleteMcp: (id: string) => void;
  upsertPrompt: (p: PromptEntry) => void;
  deletePrompt: (id: string) => void;
  upsertMemory: (m: MemoryEntry) => void;
  deleteMemory: (id: string) => void;
  upsertSkill: (s: SkillEntry) => void;
  deleteSkill: (id: string) => void;
  upsertCharacter: (c: CharacterEntry) => void;
  deleteCharacter: (id: string) => void;
  upsertProject: (p: ProjectEntry) => void;
  deleteProject: (id: string) => void;
  upsertSnippet: (s: CssSnippet) => void;
  deleteSnippet: (id: string) => void;
  upsertCommand: (c: CommandEntry) => void;
  deleteCommand: (id: string) => void;
  ensureChat: (prompt: string) => string;
  signOut: () => void;
};

const emptyUi = (): UiState => ({
  sidebarOpen: false,
  attachOpen: false,
  settingsOpen: false,
  mcpOpen: false,
  queueOpen: false,
  libraryOpen: false,
  libraryTab: "prompts",
  commandsOpen: false,
  artifactId: null,
  streamingId: null,
  mode: "instant",
  webSearch: false,
  online: true,
  hydrated: false,
  ragCount: 0,
  loginError: "",
  loginBusy: false,
});

export const useAppStore = create<AppState & Actions>()(
  persist(
    (set, get) => ({
      account: null,
      chats: [],
      activeChatId: null,
      settings: defaultSettings,
      mcp: defaultMcpServers(),
      queue: [],
      prompts: [],
      memories: [],
      skills: [],
      characters: [],
      projects: [],
      cssSnippets: [],
      commands: [],
      ui: emptyUi(),
      hydrateUi: () => set((s) => ({ ui: { ...s.ui, hydrated: true } })),
      hydrateCollections: (p) =>
        set((s) => ({
          chats: p.chats ?? s.chats,
          mcp: p.mcp ?? s.mcp,
          prompts: p.prompts ?? s.prompts,
          memories: p.memories ?? s.memories,
          skills: p.skills ?? s.skills,
          characters: p.characters ?? s.characters,
          projects: p.projects ?? s.projects,
          cssSnippets: p.cssSnippets ?? s.cssSnippets,
          commands: p.commands ?? s.commands,
        })),
      setOnline: (v) => set((s) => ({ ui: { ...s.ui, online: v } })),
      setLocale: (locale) => set((s) => ({ settings: { ...s.settings, locale } })),
      setTheme: (theme) => set((s) => ({ settings: { ...s.settings, theme } })),
      setAccent: (accent) => set((s) => ({ settings: { ...s.settings, accent } })),
      patchSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      setAccount: (account) => set({ account }),
      setSidebar: (sidebarOpen) => set((s) => ({ ui: { ...s.ui, sidebarOpen } })),
      setAttachOpen: (attachOpen) => set((s) => ({ ui: { ...s.ui, attachOpen } })),
      setSettingsOpen: (settingsOpen) => set((s) => ({ ui: { ...s.ui, settingsOpen } })),
      setMcpOpen: (mcpOpen) => set((s) => ({ ui: { ...s.ui, mcpOpen } })),
      setQueueOpen: (queueOpen) => set((s) => ({ ui: { ...s.ui, queueOpen } })),
      setLibraryOpen: (libraryOpen, tab) =>
        set((s) => ({
          ui: { ...s.ui, libraryOpen, libraryTab: tab ?? s.ui.libraryTab },
        })),
      setCommandsOpen: (commandsOpen) => set((s) => ({ ui: { ...s.ui, commandsOpen } })),
      setMode: (mode) =>
        set((s) => ({
          ui: {
            ...s.ui,
            mode,
            webSearch: mode === "research" ? true : s.ui.webSearch,
          },
        })),
      setWebSearch: (webSearch) => set((s) => ({ ui: { ...s.ui, webSearch } })),
      setRagCount: (ragCount) => set((s) => ({ ui: { ...s.ui, ragCount } })),
      setArtifact: (artifactId) => set((s) => ({ ui: { ...s.ui, artifactId } })),
      setLoginError: (loginError) => set((s) => ({ ui: { ...s.ui, loginError } })),
      setLoginBusy: (loginBusy) => set((s) => ({ ui: { ...s.ui, loginBusy } })),
      newChat: () => {
        const activeProject = get().projects.find((p) => p.active);
        const chat: Chat = {
          id: uid("chat"),
          title: "New chat",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          pinned: false,
          messages: [],
          projectId: activeProject?.id,
        };
        set((s) => ({
          chats: [chat, ...s.chats].slice(0, s.settings.maxChatSessions),
          activeChatId: chat.id,
          ui: { ...s.ui, sidebarOpen: false, artifactId: null },
        }));
        return chat.id;
      },
      selectChat: (id) =>
        set((s) => ({
          activeChatId: id,
          ui: { ...s.ui, sidebarOpen: false, artifactId: null },
        })),
      renameChat: (id, title) =>
        set((s) => ({
          chats: s.chats.map((c) => (c.id === id ? { ...c, title } : c)),
        })),
      deleteChat: (id) =>
        set((s) => {
          const chats = s.chats.filter((c) => c.id !== id);
          const activeChatId =
            s.activeChatId === id ? (chats[0]?.id ?? null) : s.activeChatId;
          return { chats, activeChatId };
        }),
      pinChat: (id) =>
        set((s) => ({
          chats: s.chats.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
        })),
      bindDsSession: (chatId, dsSessionId) =>
        set((s) => ({
          chats: s.chats.map((c) => (c.id === chatId ? { ...c, dsSessionId } : c)),
        })),
      bindDsLastMessage: (chatId, dsLastMessageId) =>
        set((s) => ({
          chats: s.chats.map((c) => (c.id === chatId ? { ...c, dsLastMessageId } : c)),
        })),
      appendMessage: (chatId, msg) =>
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: [...c.messages, msg], updatedAt: Date.now() }
              : c,
          ),
        })),
      patchMessage: (chatId, msgId, patch) =>
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id !== chatId
              ? c
              : {
                  ...c,
                  updatedAt: Date.now(),
                  messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
                },
          ),
        })),
      setStreaming: (streamingId) => set((s) => ({ ui: { ...s.ui, streamingId } })),
      enqueue: (item) =>
        set((s) => ({
          queue: [...s.queue, { ...item, id: uid("q"), createdAt: Date.now() }],
        })),
      dequeue: (id) => set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })),
      clearQueue: () => set({ queue: [] }),
      toggleMcp: (id) =>
        set((s) => ({
          mcp: s.mcp.map((m) => (m.id === id ? { ...m, enabled: !m.enabled } : m)),
        })),
      setMcpStatus: (id, patch) =>
        set((s) => ({
          mcp: s.mcp.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        })),
      upsertMcp: (m) =>
        set((s) => ({
          mcp: s.mcp.some((x) => x.id === m.id)
            ? s.mcp.map((x) => (x.id === m.id ? { ...x, ...m } : x))
            : [...s.mcp, m],
        })),
      deleteMcp: (id) =>
        set((s) => ({ mcp: s.mcp.filter((m) => m.id !== id || m.builtin) })),
      upsertPrompt: (p) =>
        set((s) => ({
          prompts: s.prompts.some((x) => x.id === p.id)
            ? s.prompts.map((x) => (x.id === p.id ? p : x))
            : [...s.prompts, p],
        })),
      deletePrompt: (id) => set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) })),
      upsertMemory: (m) =>
        set((s) => ({
          memories: s.memories.some((x) => x.id === m.id)
            ? s.memories.map((x) => (x.id === m.id ? m : x))
            : [...s.memories, m],
        })),
      deleteMemory: (id) => set((s) => ({ memories: s.memories.filter((m) => m.id !== id) })),
      upsertSkill: (sk) =>
        set((s) => ({
          skills: s.skills.some((x) => x.id === sk.id)
            ? s.skills.map((x) => (x.id === sk.id ? sk : x))
            : [...s.skills, sk],
        })),
      deleteSkill: (id) => set((s) => ({ skills: s.skills.filter((s0) => s0.id !== id) })),
      upsertCharacter: (c) =>
        set((s) => ({
          characters: s.characters.some((x) => x.id === c.id)
            ? s.characters.map((x) =>
                x.id === c.id ? c : { ...x, active: c.active ? false : x.active },
              )
            : [...s.characters.map((x) => ({ ...x, active: c.active ? false : x.active })), c],
        })),
      deleteCharacter: (id) =>
        set((s) => ({ characters: s.characters.filter((c) => c.id !== id) })),
      upsertProject: (p) =>
        set((s) => ({
          projects: s.projects.some((x) => x.id === p.id)
            ? s.projects.map((x) =>
                x.id === p.id ? p : { ...x, active: p.active ? false : x.active },
              )
            : [...s.projects.map((x) => ({ ...x, active: p.active ? false : x.active })), p],
        })),
      deleteProject: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),
      upsertSnippet: (sn) =>
        set((s) => ({
          cssSnippets: s.cssSnippets.some((x) => x.id === sn.id)
            ? s.cssSnippets.map((x) => (x.id === sn.id ? sn : x))
            : [...s.cssSnippets, sn],
        })),
      deleteSnippet: (id) =>
        set((s) => ({ cssSnippets: s.cssSnippets.filter((x) => x.id !== id) })),
      upsertCommand: (c) =>
        set((s) => ({
          commands: s.commands.some((x) => x.id === c.id)
            ? s.commands.map((x) => (x.id === c.id ? c : x))
            : [...s.commands, c],
        })),
      deleteCommand: (id) =>
        set((s) => ({ commands: s.commands.filter((c) => c.id !== id) })),
      ensureChat: (prompt) => {
        const s = get();
        const active = s.chats.find((c) => c.id === s.activeChatId);
        if (active && active.messages.length === 0) {
          if (active.title === "New chat") {
            get().renameChat(active.id, titleFromPrompt(prompt));
          }
          return active.id;
        }
        const id = get().newChat();
        get().renameChat(id, titleFromPrompt(prompt));
        return id;
      },
      signOut: () => set({ account: null }),
    }),
    {
      name: "super-deepseek-v2",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...p,
          settings: { ...defaultSettings, ...(p.settings ?? {}) },
          ui: current.ui,
          mcp: p.mcp?.length ? p.mcp : current.mcp,
          prompts: p.prompts ?? [],
          memories: p.memories ?? [],
          skills: p.skills ?? [],
          characters: p.characters ?? [],
          projects: p.projects ?? [],
          cssSnippets: p.cssSnippets ?? [],
          commands: p.commands ?? [],
        };
      },
      partialize: (s) => ({
        account: s.account,
        chats: s.chats,
        activeChatId: s.activeChatId,
        settings: s.settings,
        mcp: s.mcp.map(({ status: _st, latency: _l, lastPingMs: _p, ...rest }) => ({
          ...rest,
          status: "checking" as const,
        })),
        queue: s.queue,
        prompts: s.prompts,
        memories: s.memories,
        skills: s.skills,
        characters: s.characters,
        projects: s.projects,
        cssSnippets: s.cssSnippets,
        commands: s.commands,
      }),
    },
  ),
);

if (typeof window !== 'undefined') {
  (window as any).useAppStore = useAppStore;
  (window as any).K = useAppStore; // compat
}

export function useActiveChat(): Chat | undefined {
  return useAppStore((s) => s.chats.find((c) => c.id === s.activeChatId));
}

export function activeArtifact(chat: Chat | undefined, artifactId: string | null) {
  if (!chat || !artifactId) return null;
  for (const m of chat.messages) {
    const hit = m.artifacts?.find((a) => a.id === artifactId);
    if (hit) return hit;
  }
  return null;
}

export function emptyMessage(partial: Partial<Message> & Pick<Message, "role" | "content">): Message {
  return {
    id: uid("msg"),
    createdAt: Date.now(),
    ...partial,
  };
}

export function draftUser(content: string, attachments: Attachment[]): Message {
  return emptyMessage({ role: "user", content, attachments });
}

export function composedCss(): string {
  const s = useAppStore.getState();
  const bits = [s.settings.customCSS, ...s.cssSnippets.filter((x) => x.active).map((x) => x.css)];
  return bits.filter(Boolean).join("\n");
}
