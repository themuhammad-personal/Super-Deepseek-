export type Role = "user" | "assistant" | "system";

export type ChatMode = "instant" | "think" | "research";

export type ThemePref = "oled" | "light" | "system";

export type AccentPref = "ice" | "ocean" | "sage" | "graphite";

export type Locale = "en" | "bn";

export type AttachmentKind = "image" | "file" | "folder";

export type Attachment = {
  id: string;
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number;
  dataUrl?: string;
  text?: string;
  ocrText?: string;
};

export type ResearchStep = {
  id: string;
  title: string;
  detail?: string;
  status: "pending" | "running" | "done";
};

export type Artifact = {
  id: string;
  title: string;
  language: string;
  code: string;
};

export type TerminalOutput = {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  attachments?: Attachment[];
  thinking?: string;
  thinkingMs?: number;
  researchSteps?: ResearchStep[];
  artifacts?: Artifact[];
  terminal?: TerminalOutput;
  error?: string;
  queued?: boolean;
};

export type Chat = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  messages: Message[];
  dsSessionId?: string;
  /** Server id of the last streamed assistant message; next completion's parent_message_id. */
  dsLastMessageId?: string;
  projectId?: string;
  tags?: string[];
};

export type McpStatus = "online" | "offline" | "checking";

export type McpServer = {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  enabled: boolean;
  builtin: boolean;
  status: McpStatus;
  lastPingMs?: number;
  latency?: number;
  apiKey?: string;
};

export type PromptEntry = {
  id: string;
  name: string;
  content: string;
};

export type MemoryEntry = {
  id: string;
  key: string;
  value: string;
  importance: "always" | "called";
};

export type SkillEntry = {
  id: string;
  name: string;
  usage: string;
  content: string;
  active: boolean;
};

export type CharacterEntry = {
  id: string;
  name: string;
  usage: string;
  content: string;
  active: boolean;
};

export type ProjectEntry = {
  id: string;
  name: string;
  instructions: string;
  active: boolean;
};

export type CssSnippet = {
  id: string;
  name: string;
  css: string;
  active: boolean;
};

export type CommandEntry = {
  id: string;
  name: string;
  prompt: string;
};

export type Account = {
  token: string;
  email: string;
  mobile: string;
  guest?: boolean;
};

export type Settings = {
  theme: ThemePref;
  accent: AccentPref;
  locale: Locale;
  showTimestamps: boolean;
  haptics: boolean;
  collapseLong: boolean;
  ragChunks: number;
  syncLocale: boolean;
  preferredLang: string;
  disableSystemPrompt: boolean;
  disableMemory: boolean;
  injectSystemDateTime: boolean;
  skipDeletionConfirmation: boolean;
  systemPromptInjectionFrequency: "first" | "always" | "every_n";
  systemPromptInjectionInterval: number;
  tokenPriceDisplay: boolean;
  oledDarkMode: boolean;
  disableTipBox: boolean;
  processGitignoreOnUpload: boolean;
  loadAllHistoryOnSession: boolean;
  projectRagEnabled: boolean;
  autoDownloadFiles: boolean;
  autoDownloadLongWorkZip: boolean;
  githubToken: string;
  searchProviders: string[];
  deepResearchDeepFetch: number;
  deepResearchContextGuardEnabled: boolean;
  deepResearchContextLimitTokens: number;
  deepResearchContextStopPercent: number;
  mcpInlineMaxChars: number;
  htmlToMarkdownMaxDepth: number;
  maxChatSessions: number;
  customCSS: string;
  activeSystemPromptId: string;
  systemPromptMultiMode: boolean;
};

export type QueuedItem = {
  id: string;
  chatId: string;
  content: string;
  attachments: Attachment[];
  mode: ChatMode;
  webSearch: boolean;
  createdAt: number;
};

export type RagDoc = {
  id: string;
  name: string;
  path: string;
  text: string;
  addedAt: number;
};

export type LibraryTab = "prompts" | "memories" | "skills" | "characters" | "projects";
