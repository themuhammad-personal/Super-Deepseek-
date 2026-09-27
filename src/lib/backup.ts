import { useAppStore } from "./app-store";

export type BackupPayload = {
  version: 2;
  exportedAt: number;
  settings?: unknown;
  chats?: unknown;
  mcp?: unknown;
  prompts?: unknown;
  memories?: unknown;
  skills?: unknown;
  characters?: unknown;
  projects?: unknown;
  cssSnippets?: unknown;
  commands?: unknown;
};

export const SECTION_KEYS = [
  "settings",
  "chats",
  "mcp",
  "prompts",
  "memories",
  "skills",
  "characters",
  "projects",
  "cssSnippets",
  "commands",
] as const;

export type BackupSection = (typeof SECTION_KEYS)[number];

export const BACKUP_SECTIONS: { key: BackupSection; labelKey: string }[] = [
  { key: "settings", labelKey: "sectionSettings" },
  { key: "chats", labelKey: "sectionChats" },
  { key: "prompts", labelKey: "sectionPrompts" },
  { key: "memories", labelKey: "sectionMemories" },
  { key: "skills", labelKey: "sectionSkills" },
  { key: "characters", labelKey: "sectionCharacters" },
  { key: "projects", labelKey: "sectionProjects" },
  { key: "mcp", labelKey: "sectionMcp" },
  { key: "cssSnippets", labelKey: "sectionCss" },
  { key: "commands", labelKey: "sectionCommands" },
];

export function collectBackup(sections: Set<BackupSection>): BackupPayload {
  const s = useAppStore.getState();
  const out: BackupPayload = { version: 2, exportedAt: Date.now() };
  if (sections.has("settings")) out.settings = s.settings;
  if (sections.has("chats")) out.chats = s.chats;
  if (sections.has("mcp")) out.mcp = s.mcp.map(({ status: _status, latency: _latency, lastPingMs: _lastPingMs, ...rest }) => rest);
  if (sections.has("prompts")) out.prompts = s.prompts;
  if (sections.has("memories")) out.memories = s.memories;
  if (sections.has("skills")) out.skills = s.skills;
  if (sections.has("characters")) out.characters = s.characters;
  if (sections.has("projects")) out.projects = s.projects;
  if (sections.has("cssSnippets")) out.cssSnippets = s.cssSnippets;
  if (sections.has("commands")) out.commands = s.commands;
  return out;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: 120_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function serializeBackup(payload: BackupPayload, password?: string): Promise<string> {
  const json = JSON.stringify(payload);
  if (!password) return json;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    new TextEncoder().encode(json),
  );
  return JSON.stringify({
    enc: "sds-aes-gcm",
    salt: btoa(String.fromCharCode(...salt)),
    iv: btoa(String.fromCharCode(...iv)),
    data: btoa(String.fromCharCode(...new Uint8Array(cipher))),
  });
}

export async function parseBackup(raw: string, password?: string): Promise<BackupPayload> {
  const parsed = JSON.parse(raw) as BackupPayload & {
    enc?: string;
    salt?: string;
    iv?: string;
    data?: string;
  };
  if (parsed.enc === "sds-aes-gcm") {
    if (!password) throw new Error("password");
    const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const salt = fromB64(parsed.salt || "");
    const iv = fromB64(parsed.iv || "");
    const data = fromB64(parsed.data || "");
    const key = await deriveKey(password, salt);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
      key,
      data.buffer as ArrayBuffer,
    );
    return JSON.parse(new TextDecoder().decode(plain)) as BackupPayload;
  }
  if (parsed.version !== 2 && !(parsed as { settings?: unknown }).settings) {
    throw new Error("format");
  }
  return parsed;
}

export function applyBackup(payload: BackupPayload, sections: Set<BackupSection>): void {
  const store = useAppStore.getState();
  if (sections.has("settings") && payload.settings) {
    store.patchSettings(payload.settings as Parameters<typeof store.patchSettings>[0]);
  }
  store.hydrateCollections({
    chats: sections.has("chats") ? (payload.chats as never) : undefined,
    mcp: sections.has("mcp") ? (payload.mcp as never) : undefined,
    prompts: sections.has("prompts") ? (payload.prompts as never) : undefined,
    memories: sections.has("memories") ? (payload.memories as never) : undefined,
    skills: sections.has("skills") ? (payload.skills as never) : undefined,
    characters: sections.has("characters") ? (payload.characters as never) : undefined,
    projects: sections.has("projects") ? (payload.projects as never) : undefined,
    cssSnippets: sections.has("cssSnippets") ? (payload.cssSnippets as never) : undefined,
    commands: sections.has("commands") ? (payload.commands as never) : undefined,
  });
}
