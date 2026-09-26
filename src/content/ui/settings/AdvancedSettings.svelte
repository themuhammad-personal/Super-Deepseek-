<script>
  /**
   * Advanced Settings (BDS-UI F.6, Round-2 scope) — the AI-behaviour settings
   * system: System Prompts (multi-prompt mode, prompt list/editor, Save) plus
   * the Skill Set library. Every other settings subsection — Language, Chat,
   * Projects, Prompt & Memory injection, Deep Research, Voice, Integrations,
   * Custom CSS, MCP Servers and Utilities — is owned by the physically
   * separate settings/PluginsSettings.svelte.
   */
  import appState from "../../state.js";
  import { pushConfigToPage } from "../../bridge.js";
  import {
    STORAGE_KEYS,
    SYSTEM_PROMPT_TEMPLATE_VERSION,
    DOWNLOAD_BEHAVIOR_VERSION,
    DEFAULT_SYSTEM_PROMPT,
  } from "../../../lib/constants.js";
  import { t } from "../../../lib/i18n.svelte.js";
  import SkillList from "../SkillList.svelte";
  import { scrollIntoViewSafe } from "../scroll-into-view.js";

  let { onsave } = $props();

  let customSystemPrompts = $state(appState.settings.customSystemPrompts || []);
  let activeSystemPromptId = $state(appState.settings.activeSystemPromptId || "default");

  let showPromptEditor = $state(false);
  let editingPrompt = $state(null);
  let promptEditorName = $state("");
  let promptEditorContent = $state("");
  let promptEditorIsNew = $state(false);

  let multiEntryScheduleType = $state("first");
  let multiEntryScheduleInterval = $state(3);
  let multiEntryEnabled = $state(true);

  let systemPromptMultiMode = $state(Boolean(appState.settings.systemPromptMultiMode));
  let systemPromptEntries = $state(Array.isArray(appState.settings.systemPromptEntries) ? appState.settings.systemPromptEntries : []);
  let safeSystemPromptEntries = $derived(Array.isArray(systemPromptEntries) ? systemPromptEntries : []);

  let skillListRef = $state(null);

  // ── unsaved-changes guard (same contract the split systems both expose) ──
  let dirty = $state(false);
  let showUnsavedModal = $state(false);
  let unsavedResolve = null;

  function captureFormSnapshot() {
    return JSON.stringify({
      customSystemPrompts, activeSystemPromptId,
      systemPromptMultiMode, systemPromptEntries,
    });
  }

  let formSnapshot = $state(captureFormSnapshot());

  $effect(() => {
    dirty = captureFormSnapshot() !== formSnapshot;
  });

function openPromptEditor(prompt = null) {
      if (prompt) {
        editingPrompt = prompt;
        promptEditorName = prompt.name;
        promptEditorContent = prompt.content;
        promptEditorIsNew = false;
      } else {
        editingPrompt = null;
        promptEditorName = "";
        promptEditorContent = "";
        promptEditorIsNew = true;
      }
      showPromptEditor = true;
    }

    function closePromptEditor() {
      showPromptEditor = false;
      editingPrompt = null;
    }

    function savePrompt() {
      if (!promptEditorName.trim() || !promptEditorContent.trim()) {
        if (appState.ui) appState.ui.showToast(t("settings.nameRequired"));
        return;
      }

      if (promptEditorIsNew) {
        const newPrompt = {
          id: "sp_" + Math.random().toString(36).substring(2, 9),
          name: promptEditorName.trim(),
          content: promptEditorContent.trim()
        };
        customSystemPrompts = [...customSystemPrompts, newPrompt];
      } else if (editingPrompt) {
        customSystemPrompts = customSystemPrompts.map(p => 
          p.id === editingPrompt.id 
            ? { ...p, name: promptEditorName.trim(), content: promptEditorContent.trim() }
            : p
        );
      }
    
      closePromptEditor();
      save(); // Persist immediately
    }

    async function deletePrompt(id) {
      const prompt = customSystemPrompts.find(p => p.id === id);
      if (!prompt) return;
      if (!appState.settings?.skipDeletionConfirmation) {
        if (!(await appState.ui.showConfirm(`Delete system prompt "${prompt.name}"?`))) return;
      }
      if (activeSystemPromptId === id) {
        activeSystemPromptId = "default";
      }
      customSystemPrompts = customSystemPrompts.filter(p => p.id !== id);
      save(); // Persist immediately
    }

    function baseOnDefault() {
      promptEditorContent = appState.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    }

    function scheduleLabel(entry) {
      if (!entry.schedule) return t('settings.firstMessage');
      switch (entry.schedule.type) {
        case "first": return t('settings.firstMessage');
        case "always": return t('settings.everyMessage');
        case "interval": return t('settings.injectEveryN', { n: entry.schedule.everyNTurns || 3 });
        default: return t('settings.firstMessage');
      }
    }

    function openMultiEntryEditor(entry = null) {
      if (entry) {
        editingPrompt = entry;
        promptEditorName = entry.name;
        promptEditorContent = entry.content;
        promptEditorIsNew = false;
        multiEntryScheduleType = entry.schedule?.type || "first";
        multiEntryScheduleInterval = entry.schedule?.everyNTurns || 3;
        multiEntryEnabled = entry.enabled !== false;
      } else {
        editingPrompt = null;
        promptEditorName = "";
        promptEditorContent = "";
        promptEditorIsNew = true;
        multiEntryScheduleType = "first";
        multiEntryScheduleInterval = 3;
        multiEntryEnabled = true;
      }
      showPromptEditor = true;
    }

    function saveMultiEntry() {
      if (!promptEditorName.trim() || !promptEditorContent.trim()) {
        if (appState.ui) appState.ui.showToast(t('settings.nameRequired'));
        return;
      }

      if (promptEditorIsNew) {
        const newEntry = {
          id: "sp_" + Math.random().toString(36).substring(2, 9),
          name: promptEditorName.trim(),
          content: promptEditorContent.trim(),
          enabled: multiEntryEnabled,
          schedule: {
            type: multiEntryScheduleType,
            everyNTurns: multiEntryScheduleType === "interval" ? Math.max(1, Math.floor(Number(multiEntryScheduleInterval) || 3)) : 1,
          },
        };
        const current = Array.isArray(systemPromptEntries) ? systemPromptEntries : [];
        systemPromptEntries = [...current, newEntry];
      } else if (editingPrompt) {
        const current = Array.isArray(systemPromptEntries) ? systemPromptEntries : [];
        systemPromptEntries = current.map(e =>
          e.id === editingPrompt.id
            ? {
                ...e,
                name: promptEditorName.trim(),
                content: promptEditorContent.trim(),
                enabled: multiEntryEnabled,
                schedule: {
                  type: multiEntryScheduleType,
                  everyNTurns: multiEntryScheduleType === "interval" ? Math.max(1, Math.floor(Number(multiEntryScheduleInterval) || 3)) : 1,
                },
              }
            : e
        );
      }

      closePromptEditor();
      save();
    }

    async function deleteMultiEntry(id) {
      if (!appState.settings?.skipDeletionConfirmation) {
        if (!(await appState.ui.showConfirm(`Delete system prompt entry?`))) return;
      }
      const entries = Array.isArray(systemPromptEntries) ? systemPromptEntries : [];
      systemPromptEntries = entries.filter(e => e.id !== id);
      save();
    }

    function toggleMultiMode() {
      systemPromptMultiMode = !systemPromptMultiMode;
      if (systemPromptMultiMode) {
        const entries = Array.isArray(systemPromptEntries) ? systemPromptEntries : [];
        if (entries.length === 0) {
          const newEntries = [];
          newEntries.push({
            id: "sp_default",
            name: t('settings.defaultPromptName'),
            content: appState.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT,
            // Injection schedule lives in PluginsSettings (Prompt & Memory);
            // read the persisted values instead of duplicating their state.
            enabled: !appState.settings.disableSystemPrompt,
            schedule: {
              type:
                appState.settings.systemPromptInjectionFrequency === "every_x"
                  ? "interval"
                  : appState.settings.systemPromptInjectionFrequency || "first",
              everyNTurns: Number(appState.settings.systemPromptInjectionInterval) || 3,
            },
          });
          for (const cp of (appState.settings.customSystemPrompts || [])) {
            newEntries.push({
              id: cp.id,
              name: cp.name,
              content: cp.content,
              enabled: cp.id === appState.settings.activeSystemPromptId,
              schedule: { type: "first", everyNTurns: 1 },
            });
          }
          systemPromptEntries = newEntries;
        }
      } else {
        const entries = Array.isArray(systemPromptEntries) ? systemPromptEntries : [];
        const firstEnabled = entries.find(e => e.enabled);
        if (firstEnabled) {
          customSystemPrompts = customSystemPrompts.filter(p => p.id === firstEnabled.id);
          if (!customSystemPrompts.find(p => p.id === firstEnabled.id)) {
            customSystemPrompts = [{
              id: firstEnabled.id,
              name: firstEnabled.name,
              content: firstEnabled.content,
            }, ...customSystemPrompts];
          }
          activeSystemPromptId = firstEnabled.id;
        }
      }
      save();
    }

  /** Reloads the system-prompt state from appState + refreshes the skill list. */
  export function refresh() {
    customSystemPrompts = appState.settings.customSystemPrompts || [];
    activeSystemPromptId = appState.settings.activeSystemPromptId || "default";
    systemPromptMultiMode = Boolean(appState.settings.systemPromptMultiMode);
    systemPromptEntries = Array.isArray(appState.settings.systemPromptEntries) ? appState.settings.systemPromptEntries : [];
    if (skillListRef?.refresh) skillListRef.refresh();
    formSnapshot = captureFormSnapshot();
  }

  /** Forwarded to the Skill Set list (BDS-UI F.6). */
  export function refreshSkills() {
    if (skillListRef?.refresh) skillListRef.refresh();
  }

  /** Scrolls this settings system to one of its own sections. */
  export function scrollToSection(sectionKey) {
    const id =
      sectionKey === "skills"
        ? "bds-section-skills"
        : sectionKey === "systemPrompts"
          ? "bds-section-system-prompts"
          : "bds-settings-advanced";
    scrollIntoViewSafe(document.getElementById(id));
  }

  export function checkBeforeClose() {
    if (!dirty) return Promise.resolve(true);
    return new Promise((resolve) => {
      unsavedResolve = resolve;
      showUnsavedModal = true;
    });
  }

  function discardAndClose() {
    showUnsavedModal = false;
    if (unsavedResolve) {
      unsavedResolve(true);
      unsavedResolve = null;
    }
  }

  function cancelClose() {
    showUnsavedModal = false;
    if (unsavedResolve) {
      unsavedResolve(false);
      unsavedResolve = null;
    }
  }

  async function save() {
    // Only the fields this system owns are written; every other settings field
    // belongs to PluginsSettings.svelte and is left untouched here.
    let snapshots = [];
    try {
      // @ts-ignore
      snapshots = $state.snapshot(customSystemPrompts);
    } catch (e) {
      snapshots = JSON.parse(JSON.stringify(customSystemPrompts));
    }

    appState.settings.customSystemPrompts = snapshots;
    appState.settings.activeSystemPromptId = activeSystemPromptId;
    appState.settings.systemPromptMultiMode = systemPromptMultiMode;
    let entriesSnapshot;
    try {
      entriesSnapshot = $state.snapshot(systemPromptEntries);
    } catch (e) {
      entriesSnapshot = JSON.parse(JSON.stringify(systemPromptEntries));
    }
    if (!Array.isArray(entriesSnapshot)) entriesSnapshot = [];
    appState.settings.systemPromptEntries = entriesSnapshot;

    // When "default" is active, ensure the stored prompt always reflects the
    // latest built-in default so subsequent page loads see the current version.
    if (activeSystemPromptId === "default") {
      appState.settings.systemPrompt = DEFAULT_SYSTEM_PROMPT;
    }

    appState.settings.systemPromptTemplateVersion = SYSTEM_PROMPT_TEMPLATE_VERSION;
    appState.settings.downloadBehaviorVersion = DOWNLOAD_BEHAVIOR_VERSION;

    await chrome.storage.local.set({
      [STORAGE_KEYS.settings]: JSON.parse(JSON.stringify(appState.settings)),
    });
    pushConfigToPage();

    formSnapshot = captureFormSnapshot();

    if (appState.ui) {
      appState.ui.showToast(t("settings.settingsSaved"));
    }

    onsave?.();
  }
</script>

<!--
  Advanced Settings (BDS-UI F.6): own component, own state, own UI — System
  Prompts + Skill Set only. The ten language/feature subsections live in
  settings/PluginsSettings.svelte.

  Layout/visual language: premium, mobile-first dark (BDS-UI F.7).
-->
<div class="bds-settings-shell bds-settings-shell--advanced" id="bds-settings-advanced">
  <header class="bds-settings-hero">
    <span class="bds-settings-hero-icon" aria-hidden="true">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="8" y1="13" x2="16" y2="13"></line>
        <line x1="8" y1="17" x2="13" y2="17"></line>
      </svg>
    </span>
    <span class="bds-settings-hero-text">
      <span class="bds-settings-hero-title">{t('settings.advancedSettings')}</span>
      <span class="bds-settings-hero-sub">{t('settings.systemPrompts')}</span>
    </span>
    <span class="bds-settings-badge">AI</span>
  </header>

  <div id="bds-section-system-prompts">
  <div class="bds-section-title">
    <label class="bds-label">{t('settings.systemPrompts')}</label>
  </div>

  <div class="bds-toggle-row" style="margin-bottom: 8px;">
    <span class="bds-toggle-label" style="font-size: 12px;">{t('settings.multiPromptMode')}</span>
    <label class="bds-switch">
      <input type="checkbox" checked={systemPromptMultiMode} onchange={toggleMultiMode} />
      <span class="bds-switch-track"></span>
    </label>
  </div>

  {#if systemPromptMultiMode}
    <div class="bds-list">
      {#each safeSystemPromptEntries as entry (entry.id)}
        <div class="bds-skill-item">
          <label class="bds-switch" style="margin-right: 8px; flex: none;">
            <input type="checkbox" checked={entry.enabled} onchange={() => {
              systemPromptEntries = (Array.isArray(systemPromptEntries) ? systemPromptEntries : []).map(e =>
                e.id === entry.id ? { ...e, enabled: !e.enabled } : e
              );
              save();
            }} />
            <span class="bds-switch-track"></span>
          </label>
          <div class="bds-prompt-info">
            <span class="bds-prompt-name">{entry.name}</span>
            <span class="bds-prompt-status">{scheduleLabel(entry)}</span>
          </div>
          <div class="bds-prompt-actions">
            <button class="bds-btn-outlined" style="font-size: 11px; padding: 4px 8px;" title={t('settings.edit')} onclick={() => openMultiEntryEditor(entry)}>
              {t('settings.edit')}
            </button>
            <button class="bds-btn-danger" title={t('settings.delete')} onclick={() => deleteMultiEntry(entry.id)}>
              {t('settings.delete')}
            </button>
          </div>
        </div>
      {/each}

      <button class="bds-add-prompt-btn" type="button" onclick={() => openMultiEntryEditor(null)}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        {t('settings.addNewPrompt')}
      </button>
    </div>
  {:else}
    <div class="bds-list">
      <div class="bds-skill-item" class:active={activeSystemPromptId === "default"}>
        <label onclick={() => { activeSystemPromptId = "default"; save(); }} role="button" tabindex="0">
          <input type="radio" checked={activeSystemPromptId === "default"} readonly />
          <div class="bds-prompt-info">
            <span class="bds-prompt-name">{t('settings.defaultPromptName')}</span>
            <span class="bds-prompt-status">{t('settings.defaultPromptStatus')}</span>
          </div>
        </label>
        <div class="bds-prompt-actions">
          <button class="bds-btn-outlined" style="font-size: 11px; padding: 4px 8px;" title={t('settings.view')} onclick={() => openPromptEditor({ id: 'default', name: t('settings.defaultPromptName'), content: appState.settings.systemPrompt || DEFAULT_SYSTEM_PROMPT, readonly: true })}>
            {t('settings.view')}
          </button>
        </div>
      </div>

      {#each customSystemPrompts as prompt (prompt.id)}
        <div class="bds-skill-item" class:active={activeSystemPromptId === prompt.id}>
          <label onclick={() => { activeSystemPromptId = prompt.id; save(); }} role="button" tabindex="0">
            <input type="radio" checked={activeSystemPromptId === prompt.id} readonly />
            <div class="bds-prompt-info">
              <span class="bds-prompt-name">{prompt.name}</span>
              <span class="bds-prompt-status">{t('settings.customPromptStatus')}</span>
            </div>
          </label>
          <div class="bds-prompt-actions">
            <button class="bds-btn-outlined" style="font-size: 11px; padding: 4px 8px;" title={t('settings.edit')} onclick={() => openPromptEditor(prompt)}>
              {t('settings.edit')}
            </button>
            <button class="bds-btn-danger" title={t('settings.delete')} onclick={() => deletePrompt(prompt.id)}>
              {t('settings.delete')}
            </button>
          </div>
        </div>
      {/each}

      <button class="bds-add-prompt-btn" type="button" onclick={() => openPromptEditor()}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        {t('settings.addNewPrompt')}
      </button>
    </div>
  {/if}

  {#if showPromptEditor}
    <div class="bds-modal-overlay">
      <div class="bds-modal">
        <div class="bds-modal-header">
          <div class="ds-modal-content__title">
            {#if systemPromptMultiMode}
              {promptEditorIsNew ? t('settings.addNewTitle') : t('settings.editTitle')}
            {:else}
              {promptEditorIsNew ? t('settings.addNewTitle') : (editingPrompt?.readonly ? t('settings.viewTitle') : t('settings.editTitle'))}
            {/if}
          </div>
          <button class="bds-modal-close" onclick={closePromptEditor}>×</button>
        </div>
      
        <div class="bds-modal-body">
          <div class="bds-field">
            <label class="bds-label">{t('settings.nameLabel')}</label>
            <input type="text" class="bds-input" bind:value={promptEditorName} placeholder={t('settings.namePlaceholder')} readonly={editingPrompt?.readonly && !systemPromptMultiMode} />
          </div>

          {#if systemPromptMultiMode}
            <div class="bds-field">
              <label class="bds-label">{t('settings.scheduleType')}</label>
              <select class="bds-select" bind:value={multiEntryScheduleType}>
                <option value="first">{t('settings.firstMessage')}</option>
                <option value="always">{t('settings.everyMessage')}</option>
                <option value="interval">{t('settings.everyNMessages')}</option>
              </select>
            </div>

            {#if multiEntryScheduleType === "interval"}
              <div class="bds-field">
                <label class="bds-label">{t('settings.injectionInterval')}</label>
                <input type="number" min="2" class="bds-input" style="width: 100px;" bind:value={multiEntryScheduleInterval} />
                <p style="font-size: 10px; opacity: 0.5; margin: 2px 0 0;">
                  {t('settings.injectEveryN', { n: multiEntryScheduleInterval })}
                </p>
              </div>
            {/if}

            <div class="bds-toggle-row" style="padding: 0;">
              <span class="bds-toggle-label">{t('settings.enabled')}</span>
              <label class="bds-switch">
                <input type="checkbox" bind:checked={multiEntryEnabled} />
                <span class="bds-switch-track"></span>
              </label>
            </div>
          {/if}
        
          <div class="bds-field">
            <div class="bds-label-row">
              <label class="bds-label">{t('settings.contentLabel')}</label>
              {#if !editingPrompt?.readonly || systemPromptMultiMode}
                <button class="bds-reset-btn" type="button" onclick={baseOnDefault}>{t('settings.baseOnDefault')}</button>
              {/if}
            </div>
            <textarea class="bds-input" style="min-height: 240px;" bind:value={promptEditorContent} placeholder={t('settings.contentPlaceholder')} readonly={editingPrompt?.readonly && !systemPromptMultiMode}></textarea>
          </div>
        </div>

        <div class="bds-modal-footer">
          <button class="bds-btn-outlined" onclick={closePromptEditor}>{t('settings.cancel')}</button>
          {#if !editingPrompt?.readonly || systemPromptMultiMode}
            <button class="bds-btn" onclick={systemPromptMultiMode ? saveMultiEntry : savePrompt}>{t('settings.savePrompt')}</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
  </div>

  <hr />

  <!-- Skill Set (BDS-UI F.6): the SkillList component moved here from the
       drawer so both AI-behaviour settings live in one settings system. -->
  <div id="bds-section-skills">
    <SkillList bind:this={skillListRef} />
  </div>

{#if showUnsavedModal}
  <div class="bds-modal-overlay">
    <div class="bds-modal bds-unsaved-modal">
      <div class="bds-modal-header">
        <div class="ds-modal-content__title">{t('settings.unsavedTitle')}</div>
      </div>
      <div class="bds-modal-body">
        <p style="margin: 0; font-size: 14px; opacity: 0.85;">{t('settings.unsavedMessage')}</p>
      </div>
      <div class="bds-modal-footer">
        <button class="bds-btn-outlined" onclick={cancelClose}>{t('settings.keepEditing')}</button>
        <button class="bds-btn-danger" onclick={discardAndClose}>{t('settings.discard')}</button>
      </div>
    </div>
  </div>
{/if}

<button id="bds-save-settings" type="button" onclick={save}>
  {t('settings.save')}
</button>
</div>
