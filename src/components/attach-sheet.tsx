import { useRef, useState } from "react";
import {
  Image as ImageIcon,
  Camera,
  FileText,
  Folder,
  Github,
  Globe,
  Command,
} from "lucide-react";
import { BottomSheet } from "./ui/bottom-sheet";
import { useAppStore } from "@/lib/app-store";
import { t } from "@/lib/i18n";
import { compressImage, readAsDataUrl } from "@/lib/compress-image";
import { indexFiles, ragList } from "@/lib/rag";
import { uid } from "@/lib/utils";
import type { Attachment } from "@/lib/types";
import { performHaptic } from "@/lib/haptics";

type Props = {
  onAdd: (items: Attachment[]) => void;
};

const TEXT_MAX = 80_000;
const DOC_MAX = 50 * 1024 * 1024;
const IMG_MAX = 25 * 1024 * 1024;

async function fileToAttachment(file: File): Promise<Attachment | null> {
  const isImg = file.type.startsWith("image/");
  if (isImg && file.size > IMG_MAX) return null;
  if (!isImg && file.size > DOC_MAX) return null;
  if (isImg) {
    // Canvas re-encode can throw on HEIC/exotic decoders inside a WebView; fall
    // back to the raw bytes so the user at least sees their photo attached.
    try {
      const packed = await compressImage(file);
      return {
        id: uid("att"),
        kind: "image",
        name: file.name,
        mime: "image/jpeg",
        size: packed.bytes,
        dataUrl: packed.dataUrl,
      };
    } catch {
      if (file.size <= 8 * 1024 * 1024) {
        const dataUrl = await readAsDataUrl(file).catch(() => null);
        if (dataUrl) {
          return {
            id: uid("att"),
            kind: "image",
            name: file.name,
            mime: file.type || "image/jpeg",
            size: file.size,
            dataUrl,
          };
        }
      }
      return null;
    }
  }
  let text: string | undefined;
  if (
    file.type.startsWith("text/") ||
    /\.(md|txt|csv|json|ts|tsx|js|py|kt|html|css|xml|java|go|rs|yml|yaml)$/i.test(file.name)
  ) {
    text = (await file.text()).slice(0, TEXT_MAX);
  }
  return {
    id: uid("att"),
    kind: "file",
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    text,
  };
}

export function AttachSheet({ onAdd }: Props) {
  const open = useAppStore((s) => s.ui.attachOpen);
  const locale = useAppStore((s) => s.settings.locale);
  const haptics = useAppStore((s) => s.settings.haptics);
  const token = useAppStore((s) => s.settings.githubToken);
  const photoRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<null | "github" | "web">(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function close() {
    useAppStore.getState().setAttachOpen(false);
    setDialog(null);
    setUrl("");
    setErr("");
  }

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    performHaptic("select", haptics);
    const items: Attachment[] = [];
    let failed = 0;
    for (const f of Array.from(files)) {
      const a = await fileToAttachment(f).catch(() => null);
      if (a) items.push(a);
      else failed++;
    }
    if (failed > 0) {
      setErr(
        failed === 1
          ? `Could not attach "${files[0].name}".`
          : `Could not attach ${failed} file(s).`,
      );
    }
    if (items.length) onAdd(items);
    if (items.length) close();
  }

  async function indexFolder(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const n = await indexFiles(files);
      const all = await ragList();
      useAppStore.getState().setRagCount(all.length);
      onAdd([
        {
          id: uid("att"),
          kind: "folder",
          name: `${n} files indexed`,
          mime: "text/plain",
          size: n,
          text: `Indexed ${n} local files into Deep Code RAG.`,
        },
      ]);
      performHaptic("success", haptics);
      close();
    } finally {
      setBusy(false);
    }
  }

  async function importRemote() {
    if (!url.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: dialog,
          url: url.trim(),
          githubToken: token || undefined,
        }),
      });
      const data = (await res.json()) as { ok: boolean; title?: string; text?: string; error?: string };
      if (!data.ok || !data.text) {
        setErr(data.error || "Import failed");
        performHaptic("error", haptics);
        return;
      }
      onAdd([
        {
          id: uid("att"),
          kind: "file",
          name: data.title || url,
          mime: "text/plain",
          size: data.text.length,
          text: data.text,
        },
      ]);
      performHaptic("success", haptics);
      close();
    } catch {
      setErr("Import failed");
      performHaptic("error", haptics);
    } finally {
      setBusy(false);
    }
  }

  const actions = [
    { id: "photos", icon: ImageIcon, label: t(locale, "photos"), desc: t(locale, "photosDesc"), onClick: () => photoRef.current?.click() },
    { id: "camera", icon: Camera, label: t(locale, "camera"), desc: t(locale, "cameraDesc"), onClick: () => camRef.current?.click() },
    { id: "docs", icon: FileText, label: t(locale, "documents"), desc: t(locale, "documentsDesc"), onClick: () => docRef.current?.click() },
    { id: "folder", icon: Folder, label: t(locale, "folder"), desc: t(locale, "folderDesc"), onClick: () => folderRef.current?.click() },
    { id: "github", icon: Github, label: t(locale, "github"), desc: t(locale, "githubDesc"), onClick: () => setDialog("github") },
    { id: "web", icon: Globe, label: t(locale, "webpage"), desc: t(locale, "webpageDesc"), onClick: () => setDialog("web") },
    {
      id: "commands",
      icon: Command,
      label: t(locale, "commands"),
      desc: t(locale, "commandsDesc"),
      onClick: () => {
        useAppStore.getState().setCommandsOpen(true);
      },
    },
  ];

  return (
    <BottomSheet open={open} onOpenChange={(v) => (v ? useAppStore.getState().setAttachOpen(true) : close())} title={t(locale, "attach")}>
      <input ref={photoRef} type="file" accept="image/*" multiple hidden onChange={(e) => void pick(e.target.files)} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void pick(e.target.files)} />
      <input ref={docRef} type="file" multiple hidden onChange={(e) => void pick(e.target.files)} />
      <input
        ref={folderRef}
        type="file"
        multiple
        hidden
        className="hidden"
        onChange={(e) => void indexFolder(e.target.files)}
        // @ts-expect-error non-standard directory picker
        webkitdirectory=""
      />

      {dialog ? (
        <div className="space-y-3 py-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t(locale, dialog === "github" ? "githubPlaceholder" : "webPlaceholder")}
            className="h-11 w-full rounded-[var(--radius-sm)] bg-elevated px-3 text-sm outline-none shadow-[var(--shadow-border)]"
          />
          {err ? <p className="text-sm text-danger">{err}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              className="h-11 flex-1 rounded-[var(--radius-sm)] bg-elevated text-sm"
              onClick={() => setDialog(null)}
            >
              {t(locale, "cancel")}
            </button>
            <button
              type="button"
              disabled={busy}
              className="h-11 flex-1 rounded-[var(--radius-sm)] bg-accent text-sm font-medium text-accent-fg disabled:opacity-40"
              onClick={() => void importRemote()}
            >
              {busy ? t(locale, "importing") : t(locale, "import")}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 py-3">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={a.onClick}
              disabled={busy}
              className="flex min-h-24 flex-col items-start justify-center gap-1.5 rounded-[var(--radius-md)] bg-elevated px-3 py-3 text-left text-sm text-fg shadow-[var(--shadow-border)] active:scale-[0.98]"
            >
              <a.icon className="size-5 text-accent" />
              <span className="font-medium">{a.label}</span>
              <span className="text-[11px] leading-4 text-muted">{a.desc}</span>
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}
