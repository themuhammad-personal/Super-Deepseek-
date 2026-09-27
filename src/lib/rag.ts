import type { RagDoc } from "./types";
import { uid } from "./utils";

const DB = "super-deepseek";
const STORE = "docs";
const SKIP = /(node_modules|\.git|dist|build|\.next|coverage)(\/|$)/i;
const TEXT_EXT = /\.(md|txt|csv|json|ts|tsx|js|jsx|mjs|cjs|py|kt|java|go|rs|css|scss|html|xml|yml|yaml|toml|sql|sh|swift|c|h|cpp|hpp|rb|php|vue|svelte)$/i;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function ragList(): Promise<RagDoc[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as RagDoc[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function ragPut(doc: RagDoc): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(doc);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function ragClear(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function shouldIndexFile(path: string): boolean {
  if (SKIP.test(path)) return false;
  return TEXT_EXT.test(path);
}

export async function indexFiles(files: FileList | File[]): Promise<number> {
  const list = Array.from(files);
  let n = 0;
  for (const file of list) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (!shouldIndexFile(path) && !file.type.startsWith("text/")) continue;
    if (file.size > 400_000) continue;
    try {
      const text = await file.text();
      await ragPut({
        id: uid("doc"),
        name: file.name,
        path,
        text: text.slice(0, 80_000),
        addedAt: Date.now(),
      });
      n += 1;
    } catch {
      /* skip unreadable */
    }
  }
  return n;
}

function score(query: string, text: string): number {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  if (!terms.length) return 0;
  const hay = text.toLowerCase();
  let s = 0;
  for (const t of terms) {
    let from = 0;
    let hits = 0;
    while (hits < 8) {
      const i = hay.indexOf(t, from);
      if (i < 0) break;
      hits += 1;
      from = i + t.length;
    }
    s += hits;
  }
  return s;
}

export async function ragRetrieve(query: string, k: number): Promise<RagDoc[]> {
  const docs = await ragList();
  return docs
    .map((d) => ({ d, s: score(query, `${d.path}\n${d.text}`) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.d);
}

export function formatRagContext(docs: RagDoc[]): string {
  if (!docs.length) return "";
  return docs
    .map((d) => `### ${d.path}\n${d.text.slice(0, 1400)}`)
    .join("\n\n");
}
