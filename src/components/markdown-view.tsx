import { useMemo, useState, type ReactNode } from "react";
import { lexer, type Tokens } from "marked";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import kotlin from "highlight.js/lib/languages/kotlin";
import { Check, Copy, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Artifact } from "@/lib/types";

let registered = false;
function ensureHljs() {
  if (registered) return;
  registered = true;
  hljs.registerLanguage("javascript", javascript);
  hljs.registerLanguage("js", javascript);
  hljs.registerLanguage("typescript", typescript);
  hljs.registerLanguage("ts", typescript);
  hljs.registerLanguage("tsx", typescript);
  hljs.registerLanguage("jsx", javascript);
  hljs.registerLanguage("python", python);
  hljs.registerLanguage("py", python);
  hljs.registerLanguage("xml", xml);
  hljs.registerLanguage("html", xml);
  hljs.registerLanguage("svg", xml);
  hljs.registerLanguage("css", css);
  hljs.registerLanguage("json", json);
  hljs.registerLanguage("bash", bash);
  hljs.registerLanguage("sh", bash);
  hljs.registerLanguage("shell", bash);
  hljs.registerLanguage("markdown", markdown);
  hljs.registerLanguage("md", markdown);
  hljs.registerLanguage("sql", sql);
  hljs.registerLanguage("rust", rust);
  hljs.registerLanguage("go", go);
  hljs.registerLanguage("java", java);
  hljs.registerLanguage("kotlin", kotlin);
  hljs.registerLanguage("kt", kotlin);
}

function highlight(code: string, lang?: string): string {
  ensureHljs();
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeText(code);
  }
}

function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&" + "amp;";
    if (ch === "<") return "&" + "lt;";
    if (ch === ">") return "&" + "gt;";
    if (ch === '"') return "&" + "quot;";
    return "&#39;";
  });
}

type CodeProps = {
  lang: string;
  code: string;
  /** While streaming, skip hljs — highlighting a growing blob on every delta is what froze the app. */
  live?: boolean;
  onRun?: (code: string) => void;
  onOpenArtifact?: (art: Artifact) => void;
  copyLabel: string;
  copiedLabel: string;
  runLabel: string;
  artifactLabel: string;
};

function CodeBlock({
  lang,
  code,
  live,
  onRun,
  onOpenArtifact,
  copyLabel,
  copiedLabel,
  runLabel,
  artifactLabel,
}: CodeProps) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => (live ? escapeText(code) : highlight(code, lang)), [code, lang, live]);
  const runnable = lang === "javascript" || lang === "js";
  const isArt =
    ["html", "svg", "xml", "jsx", "tsx", "css"].includes(lang) ||
    code.trim().startsWith("<svg") ||
    code.trim().startsWith("<!DOCTYPE") ||
    code.trim().startsWith("<html");

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="code-block">
      <div className="code-bar">
        <span>{lang || "code"}</span>
        <div className="flex items-center gap-1">
          {runnable && onRun ? (
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-xs)] px-2 text-[11px] font-medium uppercase tracking-wide text-fg hover:bg-elevated"
              onClick={() => onRun(code)}
            >
              <Play className="size-3" />
              {runLabel}
            </button>
          ) : null}
          {isArt && onOpenArtifact ? (
            <button
              type="button"
              className="inline-flex h-7 items-center rounded-[var(--radius-xs)] px-2 text-[11px] font-medium uppercase tracking-wide text-accent hover:bg-accent-dim"
              onClick={() =>
                onOpenArtifact({
                  id: `inline_${lang}`,
                  title: lang === "svg" ? "SVG graphic" : "Live preview",
                  language: lang || "html",
                  code,
                })
              }
            >
              {artifactLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-xs)] px-2 text-[11px] font-medium uppercase tracking-wide text-fg hover:bg-elevated"
            onClick={() => void copy()}
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? copiedLabel : copyLabel}
          </button>
        </div>
      </div>
      <pre className="hljs">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

function inlineTokens(tokens: Tokens.Generic[] | undefined): ReactNode {
  if (!tokens) return null;
  return tokens.map((tok, i) => {
    switch (tok.type) {
      case "strong":
        return <strong key={i}>{inlineTokens((tok as Tokens.Strong).tokens)}</strong>;
      case "em":
        return <em key={i}>{inlineTokens((tok as Tokens.Em).tokens)}</em>;
      case "codespan":
        return <code key={i}>{(tok as Tokens.Codespan).text}</code>;
      case "link": {
        const l = tok as Tokens.Link;
        return (
          <a key={i} href={l.href} target="_blank" rel="noreferrer">
            {inlineTokens(l.tokens) ?? l.text}
          </a>
        );
      }
      case "br":
        return <br key={i} />;
      case "text":
        return <span key={i}>{(tok as Tokens.Text).text}</span>;
      case "escape":
        return <span key={i}>{(tok as Tokens.Escape).text}</span>;
      case "del":
        return <s key={i}>{inlineTokens((tok as Tokens.Del).tokens)}</s>;
      default:
        return <span key={i}>{"text" in tok ? String((tok as { text?: string }).text ?? "") : null}</span>;
    }
  });
}

export function MarkdownView({
  markdown,
  live,
  copyLabel = "Copy",
  copiedLabel = "Copied",
  runLabel = "Run",
  artifactLabel = "Open",
  onRun,
  onOpenArtifact,
}: {
  markdown: string;
  /** True while the message is still streaming — enables cheap rendering. */
  live?: boolean;
  copyLabel?: string;
  copiedLabel?: string;
  runLabel?: string;
  artifactLabel?: string;
  onRun?: (code: string) => void;
  onOpenArtifact?: (art: Artifact) => void;
}) {
  const tokens = useMemo(() => lexer(markdown || ""), [markdown]);

  return (
    <div className="md-body">
      {tokens.map((tok, i) => {
        switch (tok.type) {
          case "heading": {
            const h = tok as Tokens.Heading;
            const Tag = (`h${Math.min(h.depth, 3)}` as unknown) as "h1" | "h2" | "h3";
            const cls =
              h.depth === 1 ? "text-xl" : h.depth === 2 ? "text-lg" : "text-base";
            return (
              <Tag key={i} className={cn("font-semibold tracking-tight", cls)}>
                {inlineTokens(h.tokens)}
              </Tag>
            );
          }
          case "paragraph":
            return <p key={i}>{inlineTokens((tok as Tokens.Paragraph).tokens)}</p>;
          case "list": {
            const list = tok as Tokens.List;
            const ListTag = list.ordered ? "ol" : "ul";
            return (
              <ListTag key={i} className={list.ordered ? "list-decimal" : "list-disc"}>
                {list.items.map((item, j) => (
                  <li key={j}>{inlineTokens(item.tokens)}</li>
                ))}
              </ListTag>
            );
          }
          case "code": {
            const c = tok as Tokens.Code;
            return (
              <CodeBlock
                key={i}
                lang={(c.lang ?? "").split(" ")[0] ?? ""}
                code={c.text}
                live={live}
                onRun={onRun}
                onOpenArtifact={onOpenArtifact}
                copyLabel={copyLabel}
                copiedLabel={copiedLabel}
                runLabel={runLabel}
                artifactLabel={artifactLabel}
              />
            );
          }
          case "blockquote":
            return (
              <blockquote key={i}>
                {inlineTokens((tok as Tokens.Blockquote).tokens)}
              </blockquote>
            );
          case "table": {
            const table = tok as Tokens.Table;
            return (
              <div key={i} className="table-scroll my-3 rounded-[var(--radius-sm)] shadow-[var(--shadow-border)]">
                <table>
                  <thead>
                    <tr>
                      {table.header.map((cell, ci) => (
                        <th key={ci}>{inlineTokens(cell.tokens)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci}>{inlineTokens(cell.tokens)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          case "hr":
            return <hr key={i} className="border-0 border-t border-line" />;
          case "space":
            return <div key={i} className="h-2" />;
          case "html":
            return null;
          default:
            if ("text" in tok && tok.type === "text") {
              return <p key={i}>{(tok as Tokens.Text).text}</p>;
            }
            return null;
        }
      })}
    </div>
  );
}
