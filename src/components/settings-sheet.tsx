import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { BottomSheet } from "./ui/bottom-sheet";
import { Card, Field, Row, Segment, Toggle } from "./ui/controls";
import { useAppStore } from "@/lib/app-store";
import { t } from "@/lib/i18n";
import { ragClear, ragList } from "@/lib/rag";
import { SEARCH_PROVIDERS } from "@/lib/search-providers";
import {
  BACKUP_SECTIONS,
  applyBackup,
  collectBackup,
  parseBackup,
  serializeBackup,
  type BackupSection,
} from "@/lib/backup";
import type { AccentPref, Locale, ThemePref } from "@/lib/types";
import { uid } from "@/lib/utils";
import { toast } from "sonner";

export function SettingsSheet() {
  const open = useAppStore((s) => s.ui.settingsOpen);
  const settings = useAppStore((s) => s.settings);
  const ragCount = useAppStore((s) => s.ui.ragCount);
  const snippets = useAppStore((s) => s.cssSnippets);
  const locale = settings.locale;
  const patch = useAppStore.getState().patchSettings;
  const [q, setQ] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [exportPw, setExportPw] = useState("");
  const [exportPw2, setExportPw2] = useState("");
  const [encrypt, setEncrypt] = useState(false);
  const [importPw, setImportPw] = useState("");
  const [selected, setSelected] = useState<Set<BackupSection>>(
    () => new Set(BACKUP_SECTIONS.map((s) => s.key)),
  );
  const importRef = useRef<HTMLInputElement>(null);
  const [snippetName, setSnippetName] = useState("");

  const hay = q.trim().toLowerCase();
  const show = (keys: string[]) =>
    !hay || keys.some((k) => t(locale, k).toLowerCase().includes(hay) || k.includes(hay));

  const cssPresets = useMemo(
    () => [
      { id: "compact", label: t(locale, "presetCompact"), css: ".md-body{font-size:0.9rem} .composer-shell{padding:6px}" },
      { id: "wide", label: t(locale, "presetWide"), css: ".md-body{max-width:48rem;margin-inline:auto}" },
      { id: "code", label: t(locale, "presetCode"), css: ".hljs,.code-block{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:13px}" },
    ],
    [locale],
  );

  async function doExport() {
    if (encrypt) {
      if (exportPw.length < 4) {
        toast.error(t(locale, "passwordTooShort"));
        return;
      }
      if (exportPw !== exportPw2) {
        toast.error(t(locale, "passwordMismatch"));
        return;
      }
    }
    const payload = collectBackup(selected);
    const body = await serializeBackup(payload, encrypt ? exportPw : undefined);
    const blob = new Blob([body], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `super-deepseek-backup.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(t(locale, "exportDone"));
  }

  async function onImportFile(file: File | undefined) {
    if (!file) return;
    try {
      const raw = await file.text();
      const payload = await parseBackup(raw, importPw || undefined);
      applyBackup(payload, selected);
      toast.success(t(locale, "importDone"));
    } catch (e) {
      const msg = String(e);
      toast.error(msg.includes("password") ? t(locale, "wrongPassword") : t(locale, "importFailed"));
    }
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => useAppStore.getState().setSettingsOpen(v)}
      title={t(locale, "settings")}
    >
      <label className="mb-4 flex h-11 items-center gap-2 rounded-[var(--radius-sm)] bg-elevated px-3 shadow-[var(--shadow-border)]">
        <Search className="size-4 text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t(locale, "advancedSearch")}
          className="h-full w-full bg-transparent text-sm outline-none placeholder:text-faint"
        />
      </label>

      {show(["appearance", "theme", "accent"]) ? (
        <Card title={t(locale, "appearance")}>
          <Row label={t(locale, "theme")}>
            <Segment<ThemePref>
              value={settings.theme}
              onChange={(theme) => patch({ theme })}
              options={[
                { id: "oled", label: t(locale, "oled") },
                { id: "light", label: t(locale, "light") },
                { id: "system", label: t(locale, "system") },
              ]}
            />
          </Row>
          <Row label={t(locale, "accent")}>
            <Segment<AccentPref>
              value={settings.accent}
              onChange={(accent) => patch({ accent })}
              options={[
                { id: "ice", label: "Ice" },
                { id: "ocean", label: "Ocean" },
                { id: "sage", label: "Sage" },
                { id: "graphite", label: "Ink" },
              ]}
            />
          </Row>
        </Card>
      ) : null}

      {show(["language", "languageRegion", "syncLocale", "preferredLang"]) ? (
        <Card title={t(locale, "languageRegion")}>
          <Row label={t(locale, "language")}>
            <Segment<Locale>
              value={settings.locale}
              onChange={(l) => useAppStore.getState().setLocale(l)}
              options={[
                { id: "en", label: "EN" },
                { id: "bn", label: "বাংলা" },
              ]}
            />
          </Row>
          <Row label={t(locale, "syncLocale")}>
            <Toggle on={settings.syncLocale} onChange={(syncLocale) => patch({ syncLocale })} />
          </Row>
          <Field
            label={t(locale, "preferredLang")}
            value={settings.preferredLang}
            onChange={(preferredLang) => patch({ preferredLang })}
            placeholder={t(locale, "preferredLangPlaceholder")}
          />
          <p className="-mt-1 pb-3 text-xs text-muted">{t(locale, "preferredLangHint")}</p>
        </Card>
      ) : null}

      {show(["chat", "timestamps", "haptics", "collapse", "sessionCap", "tokenPrice"]) ? (
        <Card title={t(locale, "chat")}>
          <Row label={t(locale, "timestamps")}>
            <Toggle on={settings.showTimestamps} onChange={(showTimestamps) => patch({ showTimestamps })} />
          </Row>
          <Row label={t(locale, "haptics")}>
            <Toggle on={settings.haptics} onChange={(haptics) => patch({ haptics })} />
          </Row>
          <Row label={t(locale, "collapse")} hint={t(locale, "collapseHint")}>
            <Toggle on={settings.collapseLong} onChange={(collapseLong) => patch({ collapseLong })} />
          </Row>
          <Row label={t(locale, "skipConfirm")}>
            <Toggle
              on={settings.skipDeletionConfirmation}
              onChange={(skipDeletionConfirmation) => patch({ skipDeletionConfirmation })}
            />
          </Row>
          <Row label={t(locale, "loadAllHistory")}>
            <Toggle
              on={settings.loadAllHistoryOnSession}
              onChange={(loadAllHistoryOnSession) => patch({ loadAllHistoryOnSession })}
            />
          </Row>
          <Row label={t(locale, "tokenPrice")} hint={t(locale, "tokenPriceHint")}>
            <Toggle on={settings.tokenPriceDisplay} onChange={(tokenPriceDisplay) => patch({ tokenPriceDisplay })} />
          </Row>
          <Row label={t(locale, "sessionCap")} hint={t(locale, "sessionCapHint")}>
            <input
              type="number"
              min={20}
              max={2000}
              value={settings.maxChatSessions}
              onChange={(e) => patch({ maxChatSessions: Number(e.target.value) || 500 })}
              className="h-9 w-20 rounded-[var(--radius-sm)] bg-bg px-2 text-sm shadow-[var(--shadow-border)]"
            />
          </Row>
        </Card>
      ) : null}

      {show(["promptInjection", "disableSystemPrompt", "disableMemory", "injectDate"]) ? (
        <Card title={t(locale, "promptInjection")}>
          <Row label={t(locale, "disableSystemPrompt")}>
            <Toggle
              on={settings.disableSystemPrompt}
              onChange={(disableSystemPrompt) => patch({ disableSystemPrompt })}
            />
          </Row>
          <Row label={t(locale, "disableMemory")}>
            <Toggle on={settings.disableMemory} onChange={(disableMemory) => patch({ disableMemory })} />
          </Row>
          <Row label={t(locale, "injectDate")}>
            <Toggle
              on={settings.injectSystemDateTime}
              onChange={(injectSystemDateTime) => patch({ injectSystemDateTime })}
            />
          </Row>
          <Row label={t(locale, "injectionFreq")}>
            <Segment<"first" | "always" | "every_n">
              value={settings.systemPromptInjectionFrequency}
              onChange={(systemPromptInjectionFrequency) => patch({ systemPromptInjectionFrequency })}
              options={[
                { id: "first", label: t(locale, "firstMessage") },
                { id: "always", label: t(locale, "everyMessage") },
                { id: "every_n", label: t(locale, "everyN") },
              ]}
            />
          </Row>
          {settings.systemPromptInjectionFrequency === "every_n" ? (
            <Row label={t(locale, "injectionInterval")}>
              <input
                type="number"
                min={2}
                max={20}
                value={settings.systemPromptInjectionInterval}
                onChange={(e) => patch({ systemPromptInjectionInterval: Number(e.target.value) || 3 })}
                className="h-9 w-16 rounded-[var(--radius-sm)] bg-bg px-2 text-sm shadow-[var(--shadow-border)]"
              />
            </Row>
          ) : null}
        </Card>
      ) : null}

      {show(["rag", "deepCode", "projectRag", "processGitignore"]) ? (
        <Card title={t(locale, "rag")}>
          <Row label={t(locale, "indexedFiles")} hint={t(locale, "deepCodeHint")}>
            <span className="tabular-nums text-sm">{ragCount}</span>
          </Row>
          <Row label={t(locale, "projectRag")}>
            <Toggle on={settings.projectRagEnabled} onChange={(projectRagEnabled) => patch({ projectRagEnabled })} />
          </Row>
          <Row label={t(locale, "processGitignore")}>
            <Toggle
              on={settings.processGitignoreOnUpload}
              onChange={(processGitignoreOnUpload) => patch({ processGitignoreOnUpload })}
            />
          </Row>
          <Row label={t(locale, "ragChunks")}>
            <Segment<string>
              value={String(settings.ragChunks)}
              onChange={(v) => patch({ ragChunks: Number(v) })}
              options={[
                { id: "3", label: "3" },
                { id: "5", label: "5" },
                { id: "8", label: "8" },
                { id: "10", label: "10" },
              ]}
            />
          </Row>
          <button
            type="button"
            className="mb-3 h-10 w-full rounded-[var(--radius-sm)] bg-surface text-sm text-danger"
            onClick={() => {
              void ragClear().then(() => useAppStore.getState().setRagCount(0));
            }}
          >
            {t(locale, "clearIndex")}
          </button>
        </Card>
      ) : null}

      {show(["deepResearch", "contextGuard", "searchProviders"]) ? (
        <Card title={t(locale, "deepResearch")}>
          <Row label={t(locale, "contextGuard")} hint={t(locale, "contextGuardHint")}>
            <Toggle
              on={settings.deepResearchContextGuardEnabled}
              onChange={(deepResearchContextGuardEnabled) => patch({ deepResearchContextGuardEnabled })}
            />
          </Row>
          <Row label={t(locale, "contextLimit")}>
            <input
              type="number"
              min={8000}
              step={1000}
              value={settings.deepResearchContextLimitTokens}
              onChange={(e) =>
                patch({ deepResearchContextLimitTokens: Number(e.target.value) || 128000 })
              }
              className="h-9 w-28 rounded-[var(--radius-sm)] bg-bg px-2 text-sm shadow-[var(--shadow-border)]"
            />
          </Row>
          <Row label={t(locale, "stopPercent")}>
            <input
              type="number"
              min={50}
              max={95}
              value={settings.deepResearchContextStopPercent}
              onChange={(e) =>
                patch({ deepResearchContextStopPercent: Number(e.target.value) || 70 })
              }
              className="h-9 w-16 rounded-[var(--radius-sm)] bg-bg px-2 text-sm shadow-[var(--shadow-border)]"
            />
          </Row>
          <Row label={t(locale, "deepFetch")}>
            <Segment<string>
              value={String(settings.deepResearchDeepFetch)}
              onChange={(v) => patch({ deepResearchDeepFetch: Number(v) })}
              options={[
                { id: "0", label: "0" },
                { id: "1", label: "1" },
                { id: "3", label: "3" },
                { id: "5", label: "5" },
              ]}
            />
          </Row>
          <p className="pt-1 text-xs font-medium text-muted">{t(locale, "searchProviders")}</p>
          <p className="pb-2 text-xs text-faint">{t(locale, "searchProvidersHint")}</p>
          <div className="space-y-1 pb-3">
            {SEARCH_PROVIDERS.map((p, i) => {
              const on = settings.searchProviders.includes(p.id);
              return (
                <div key={p.id} className="flex items-center gap-2 py-1">
                  <Toggle
                    on={on}
                    onChange={(next) => {
                      const cur = settings.searchProviders.filter((id) => id !== p.id);
                      patch({ searchProviders: next ? [...cur, p.id] : cur });
                    }}
                  />
                  <span className="flex-1 text-sm">{p.name}</span>
                  <button
                    type="button"
                    className="text-xs text-muted"
                    disabled={i === 0}
                    onClick={() => {
                      const ids = [...settings.searchProviders];
                      const idx = ids.indexOf(p.id);
                      if (idx > 0) {
                        [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
                        patch({ searchProviders: ids });
                      }
                    }}
                  >
                    {t(locale, "moveUp")}
                  </button>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {show(["integrations", "githubToken"]) ? (
        <Card title={t(locale, "integrations")}>
          <label className="block py-2.5">
            <span className="mb-1.5 block text-xs font-medium text-muted">{t(locale, "githubToken")}</span>
            <div className="flex gap-2">
              <input
                type={showToken ? "text" : "password"}
                value={settings.githubToken}
                onChange={(e) => patch({ githubToken: e.target.value })}
                placeholder="ghp_…"
                className="h-11 min-w-0 flex-1 rounded-[var(--radius-sm)] bg-bg px-3 text-sm shadow-[var(--shadow-border)] outline-none"
              />
              <button
                type="button"
                className="h-11 rounded-[var(--radius-sm)] bg-surface px-3 text-xs"
                onClick={() => setShowToken((v) => !v)}
              >
                {t(locale, showToken ? "hide" : "show")}
              </button>
            </div>
            <p className="mt-1.5 pb-2 text-xs text-muted">{t(locale, "githubTokenHint")}</p>
          </label>
        </Card>
      ) : null}

      {show(["utilities", "autoDownload", "disableTips"]) ? (
        <Card title={t(locale, "utilities")}>
          <Row label={t(locale, "autoDownload")}>
            <Toggle on={settings.autoDownloadFiles} onChange={(autoDownloadFiles) => patch({ autoDownloadFiles })} />
          </Row>
          <Row label={t(locale, "autoZip")}>
            <Toggle
              on={settings.autoDownloadLongWorkZip}
              onChange={(autoDownloadLongWorkZip) => patch({ autoDownloadLongWorkZip })}
            />
          </Row>
          <Row label={t(locale, "disableTips")}>
            <Toggle on={settings.disableTipBox} onChange={(disableTipBox) => patch({ disableTipBox })} />
          </Row>
          <p className="pt-2 text-xs font-medium text-muted">{t(locale, "selectSections")}</p>
          <div className="flex flex-wrap gap-1.5 py-2">
            {BACKUP_SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  const next = new Set(selected);
                  if (next.has(s.key)) next.delete(s.key);
                  else next.add(s.key);
                  setSelected(next);
                }}
                className={`h-8 rounded-[var(--radius-pill)] px-2.5 text-xs ${
                  selected.has(s.key) ? "bg-accent-dim text-accent" : "bg-bg text-muted"
                }`}
              >
                {t(locale, s.labelKey)}
              </button>
            ))}
          </div>
          <Row label={t(locale, "exportEncrypt")}>
            <Toggle on={encrypt} onChange={setEncrypt} />
          </Row>
          {encrypt ? (
            <>
              <Field label={t(locale, "enterPassword")} value={exportPw} onChange={setExportPw} type="password" />
              <Field label={t(locale, "confirmPassword")} value={exportPw2} onChange={setExportPw2} type="password" />
            </>
          ) : null}
          <button
            type="button"
            className="mb-2 h-11 w-full rounded-[var(--radius-sm)] bg-accent text-sm font-medium text-accent-fg"
            onClick={() => void doExport()}
          >
            {t(locale, "exportAll")}
          </button>
          <Field
            label={t(locale, "enterPassword")}
            value={importPw}
            onChange={setImportPw}
            type="password"
            placeholder={t(locale, "enterPassword")}
          />
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => void onImportFile(e.target.files?.[0])}
          />
          <button
            type="button"
            className="mb-3 h-11 w-full rounded-[var(--radius-sm)] bg-surface text-sm"
            onClick={() => importRef.current?.click()}
          >
            {t(locale, "importAll")}
          </button>
        </Card>
      ) : null}

      {show(["customCss", "cssPresets"]) ? (
        <Card title={t(locale, "customCss")}>
          <p className="pt-1 text-xs text-muted">{t(locale, "cssPresets")}</p>
          <div className="flex flex-wrap gap-1.5 py-2">
            {cssPresets.map((p) => (
              <button
                key={p.id}
                type="button"
                className="h-8 rounded-[var(--radius-pill)] bg-bg px-2.5 text-xs"
                onClick={() => patch({ customCSS: `${settings.customCSS}\n${p.css}`.trim() })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <textarea
            value={settings.customCSS}
            onChange={(e) => patch({ customCSS: e.target.value })}
            placeholder={t(locale, "cssPlaceholder")}
            rows={5}
            className="mb-2 w-full rounded-[var(--radius-sm)] bg-bg p-3 font-mono text-xs leading-5 shadow-[var(--shadow-border)] outline-none"
          />
          <div className="mb-3 flex gap-2">
            <input
              value={snippetName}
              onChange={(e) => setSnippetName(e.target.value)}
              placeholder={t(locale, "snippetName")}
              className="h-10 min-w-0 flex-1 rounded-[var(--radius-sm)] bg-bg px-3 text-sm shadow-[var(--shadow-border)]"
            />
            <button
              type="button"
              className="h-10 rounded-[var(--radius-sm)] bg-surface px-3 text-xs"
              onClick={() => {
                if (!snippetName.trim() || !settings.customCSS.trim()) return;
                useAppStore.getState().upsertSnippet({
                  id: uid("css"),
                  name: snippetName.trim(),
                  css: settings.customCSS,
                  active: true,
                });
                setSnippetName("");
              }}
            >
              {t(locale, "saveSnippet")}
            </button>
          </div>
          {snippets.map((sn) => (
            <Row key={sn.id} label={sn.name}>
              <Toggle
                on={sn.active}
                onChange={(active) => useAppStore.getState().upsertSnippet({ ...sn, active })}
              />
            </Row>
          ))}
        </Card>
      ) : null}

      {hay &&
      !show([
        "appearance",
        "language",
        "chat",
        "promptInjection",
        "rag",
        "deepResearch",
        "integrations",
        "utilities",
        "customCss",
      ]) ? (
        <p className="py-8 text-center text-sm text-muted">{t(locale, "noResults")}</p>
      ) : null}
    </BottomSheet>
  );
}

export function refreshRagCount() {
  void ragList().then((d) => useAppStore.getState().setRagCount(d.length));
}
