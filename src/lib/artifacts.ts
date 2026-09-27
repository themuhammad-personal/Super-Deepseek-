import type { Artifact } from "./types";

const FENCE = /```(\w+)[^\n]*\n([\s\S]*?)```/g;

const ARTIFACT_LANGS = new Set(["html", "svg", "xml", "jsx", "tsx", "react", "vue", "css"]);

function artId(): string {
  return `art_${Math.random().toString(36).slice(2, 10)}`;
}

export function extractArtifacts(markdown: string): Artifact[] {
  const out: Artifact[] = [];
  const re = new RegExp(FENCE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const language = (m[1] ?? "txt").toLowerCase();
    const code = (m[2] ?? "").trim();
    if (!code) continue;
    const looksUi =
      ARTIFACT_LANGS.has(language) ||
      (language === "javascript" && /document\.|createElement|innerHTML/.test(code)) ||
      (code.startsWith("<svg") || code.startsWith("<!DOCTYPE") || code.startsWith("<html"));
    if (!looksUi) continue;
    if (code.length < 40) continue;
    out.push({
      id: artId(),
      title: language === "svg" ? "SVG graphic" : language === "html" ? "Live preview" : `${language} artifact`,
      language,
      code,
    });
  }
  return out.slice(0, 3);
}

export function artifactSrcDoc(art: Artifact): string {
  const code = art.code;
  if (art.language === "svg" || code.trim().startsWith("<svg")) {
    return `<!doctype html><html><head><style>html,body{margin:0;background:#0b0b0c;display:grid;place-items:center;min-height:100%}svg{max-width:96%;max-height:96vh}</style></head><body>${code}</body></html>`;
  }
  if (art.language === "css") {
    return `<!doctype html><html><head><style>${code}</style></head><body><div class="preview">Styled preview</div></body></html>`;
  }
  if (/^<!doctype|^<html/i.test(code)) return code;
  return `<!doctype html><html><head><meta charset="utf-8"/><style>html,body{margin:0;padding:16px;font-family:ui-sans-serif,system-ui;background:#0b0b0c;color:#eee}</style></head><body>${code}</body></html>`;
}
