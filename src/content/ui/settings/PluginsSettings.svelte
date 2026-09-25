<script>
  /**
   * Plugins (BDS-UI F.6) — the MCP servers area that used to be the
   * `subMcp` block of the monolithic SettingsPanel.svelte, promoted to a
   * physically separate settings system with its own component, its own
   * state and its own save button.
   *
   * MCP behaviour (discovery, tool schemas, storage shape) is byte-for-byte
   * the same as before — only the UI ownership moved.
   */
  import { onMount } from "svelte";
  import appState from "../../state.js";
  import { pushConfigToPage, discoverMcpToolSchemas } from "../../bridge.js";
  import { STORAGE_KEYS } from "../../../lib/constants.js";
  import { t } from "../../../lib/i18n.svelte.js";
  import { scrollIntoViewSafe } from "../scroll-into-view.js";

  let { onsave } = $props();

  let showMcpEditor = $state(false);
  let editingMcp = $state(null);
  let mcpEditorName = $state("");
  let mcpEditorUrl = $state("");
  let mcpEditorApiKey = $state("");
  let mcpEditorEnabled = $state(true);
  let mcpEditorIsNew = $state(false);
  let mcpTestingIndex = $state(-1);
  let mcpServers = $state([...appState.mcpServers]);
  let mcpInlineMaxChars = $state(Number(appState.settings.mcpInlineMaxChars) || 8000);

  let dirty = $state(false);
  let showUnsavedModal = $state(false);
  let unsavedResolve = null;

  function captureSnapshot() {
    return JSON.stringify({
      mcpInlineMaxChars,
      servers: mcpServers.map((s) => ({ id: s.id, name: s.name, serverUrl: s.serverUrl, enabled: s.enabled !== false })),
    });
  }

  let formSnapshot = $state(captureSnapshot());

  $effect(() => {
    dirty = captureSnapshot() !== formSnapshot;
  });

  function closeEditor() {
    showMcpEditor = false;
    editingMcp = null;
  }

  function openMcpEditor(server = null) {
    if (server) {
      editingMcp = server;
      mcpEditorName = server.name;
      mcpEditorUrl = server.serverUrl;
      mcpEditorApiKey = server.apiKey || "";
      mcpEditorEnabled = server.enabled !== false;
      mcpEditorIsNew = false;
    } else {
      editingMcp = null;
      mcpEditorName = "";
      mcpEditorUrl = "";
      mcpEditorApiKey = "";
      mcpEditorEnabled = true;
      mcpEditorIsNew = true;
    }
    showMcpEditor = true;
  }

  async function saveMcpServer() {
    if (!mcpEditorName.trim() || !mcpEditorUrl.trim()) return;
    const entry = {
      id: editingMcp ? editingMcp.id : "mcp_" + Math.random().toString(36).substring(2, 9),
      name: mcpEditorName.trim(),
      serverUrl: mcpEditorUrl.trim(),
      apiKey: mcpEditorApiKey.trim(),
      enabled: mcpEditorEnabled,
      tools: editingMcp ? editingMcp.tools : [],
      createdAt: editingMcp ? editingMcp.createdAt : Date.now(),
    };
    if (mcpEditorIsNew) {
      mcpServers = [...mcpServers, entry];
    } else {
      mcpServers = mcpServers.map((s) => (s.id === entry.id ? entry : s));
    }
    const plain = JSON.parse(JSON.stringify(mcpServers));
    appState.mcpServers = plain;
    await chrome.storage.local.set({ [STORAGE_KEYS.mcpServers]: plain });
    await discoverMcpToolSchemas();
    pushConfigToPage();
    closeEditor();
    formSnapshot = captureSnapshot();
  }

  async function deleteMcpServer(id) {
    if (!appState.settings?.skipDeletionConfirmation) {
      if (!(await appState.ui.showConfirm(t("mcp.deleteConfirm", { name: mcpServers.find((s) => s.id === id)?.name })))) return;
    }
    mcpServers = mcpServers.filter((s) => s.id !== id);
    const plainDelete = JSON.parse(JSON.stringify(mcpServers));
    appState.mcpServers = plainDelete;
    await chrome.storage.local.set({ [STORAGE_KEYS.mcpServers]: plainDelete });
    await discoverMcpToolSchemas();
    pushConfigToPage();
  }

  async function testMcpServer(index) {
    mcpTestingIndex = index;
    const server = mcpServers[index];
    if (!server) {
      mcpTestingIndex = -1;
      return;
    }
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: "bds-mcp-list-tools", serverUrl: server.serverUrl, apiKey: server.apiKey || "" },
          (resp) => {
            if (resp?.ok) resolve(resp);
            else reject(new Error(resp?.error || "Connection failed"));
          },
        );
      });
      if (response.ok) {
        const tools = (Array.isArray(response.tools) ? response.tools : response.tools?.tools || []).map((tool) => ({
          name: tool.name,
          description: tool.description || "",
          inputSchema: tool.inputSchema || {},
        }));
        mcpServers = mcpServers.map((s, idx) => (idx === index ? { ...s, tools } : s));
        const plainTest = JSON.parse(JSON.stringify(mcpServers));
        appState.mcpServers = plainTest;
        await chrome.storage.local.set({ [STORAGE_KEYS.mcpServers]: plainTest });
        // Explicit "test connection": bypass the discovery cache so the schema
        // list reflects the server we just reached rather than a stale entry.
        await discoverMcpToolSchemas({ force: true });
        pushConfigToPage();
        if (appState.ui) appState.ui.showToast(t("mcp.connected", { count: tools.length }));
      }
    } catch (err) {
      if (appState.ui) appState.ui.showToast(t("mcp.testFailed", { message: err.message }));
    }
    mcpTestingIndex = -1;
  }

  /** Reloads plugin state from appState (storage is the source of truth). */
  export function refresh() {
    mcpServers = [...appState.mcpServers];
    mcpInlineMaxChars = Number(appState.settings.mcpInlineMaxChars) || 8000;
    formSnapshot = captureSnapshot();
  }

  /** Same unsaved-changes contract the old SettingsPanel exposed. */
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

  /** Scrolls this settings system into view (BDS-UI scrollToSection API). */
  export function scrollToSection() {
    scrollIntoViewSafe(document.getElementById("bds-settings-plugins"));
  }

  export async function save() {
    appState.settings.mcpInlineMaxChars = Math.max(
      500,
      Math.min(100000, Math.round(Number(mcpInlineMaxChars) || 8000)),
    );
    await chrome.storage.local.set({
      [STORAGE_KEYS.settings]: JSON.parse(JSON.stringify(appState.settings)),
    });
    await chrome.storage.local.set({
      [STORAGE_KEYS.mcpServers]: JSON.parse(JSON.stringify(appState.mcpServers)),
    });
    pushConfigToPage();

    formSnapshot = captureSnapshot();

    if (appState.ui) {
      appState.ui.showToast(t("settings.settingsSaved"));
    }

    onsave?.();
  }

  onMount(() => {
    formSnapshot = captureSnapshot();
  });
</script>

<div class="bds-settings-shell bds-settings-shell--plugins" id="bds-settings-plugins">
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
        <path d="M9 3v4a2 2 0 0 1-2 2H3"></path>
        <path d="M15 3v4a2 2 0 0 0 2 2h4"></path>
        <path d="M9 21v-4a2 2 0 0 0-2-2H3"></path>
        <path d="M15 21v-4a2 2 0 0 1 2-2h4"></path>
      </svg>
    </span>
    <span class="bds-settings-hero-text">
      <span class="bds-settings-hero-title">{t('plugins.title')}</span>
      <span class="bds-settings-hero-sub">{t('plugins.subtitle')}</span>
    </span>
    <span class="bds-settings-badge">MCP</span>
  </header>

  <p class="bds-settings-note">{t('mcp.description')}</p>
  <p class="bds-settings-note">{t('mcp.transportNote')}</p>

  <div class="bds-settings-section-label">
    {t('mcp.sectionTitle')}
    <span class="bds-plugin-chip">{mcpServers.length}</span>
  </div>

  {#if mcpServers.length === 0}
    <div class="bds-plugin-empty">
      <span>{t('plugins.empty')}</span>
    </div>
  {:else}
    {#each mcpServers as server, i (server.id)}
      <div class="bds-plugin-card">
        <div class="bds-plugin-card-main">
          <span class="bds-plugin-name">{server.name}</span>
          <span class="bds-plugin-meta">
            <span class="bds-plugin-url" title={server.serverUrl}>{server.serverUrl}</span>
            <span class="bds-plugin-chip" class:bds-plugin-chip--ok={server.tools?.length > 0}>
              {t('mcp.toolsCount', { count: server.tools?.length || 0 })}
            </span>
            {#if server.enabled === false}
              <span class="bds-plugin-chip">{t('mcp.detailHide')}</span>
            {/if}
          </span>
        </div>
        <div class="bds-plugin-actions">
          <button
            class="bds-btn-outlined"
            onclick={() => testMcpServer(i)}
            disabled={mcpTestingIndex === i}
          >
            {mcpTestingIndex === i ? t('mcp.testLoading') : t('mcp.test')}
          </button>
          <button class="bds-btn-outlined" onclick={() => openMcpEditor(server)}>{t('mcp.edit')}</button>
          <button class="bds-btn-danger" aria-label={t('commands.remove')} onclick={() => deleteMcpServer(server.id)}>×</button>
        </div>
      </div>
    {/each}
  {/if}

  <button class="bds-add-prompt-btn" onclick={() => openMcpEditor()}>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="margin-right: 4px;">
      <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
    {t('mcp.addServer')}
  </button>

  <div class="bds-plugin-setting">
    <div class="bds-plugin-setting-row">
      <span class="bds-toggle-label">{t('mcp.inlineMaxChars')}</span>
      <input
        id="bds-mcp-inline-max-chars"
        type="number"
        min="500"
        max="100000"
        step="500"
        class="bds-input"
        style="width: 104px; flex-shrink: 0;"
        bind:value={mcpInlineMaxChars}
      />
    </div>
    <p class="bds-settings-note">{t('mcp.inlineMaxCharsHint')}</p>
  </div>

  <button id="bds-save-plugins" type="button" onclick={save}>{t('settings.save')}</button>
</div>

{#if showMcpEditor}
  <div class="bds-modal-overlay">
    <div class="bds-modal">
      <div class="bds-modal-header">
        <span>{mcpEditorIsNew ? t('mcp.addModalTitle') : t('mcp.editModalTitle')}</span>
        <button class="bds-modal-close" aria-label={t('mcp.cancel')} onclick={closeEditor}>×</button>
      </div>
      <div class="bds-modal-body">
        <div class="bds-field">
          <label class="bds-label">{t('mcp.nameLabel')}</label>
          <input type="text" class="bds-input" bind:value={mcpEditorName} placeholder={t('mcp.namePlaceholder')} />
        </div>
        <div class="bds-field">
          <label class="bds-label">{t('mcp.serverUrlLabel')}</label>
          <input type="url" class="bds-input" bind:value={mcpEditorUrl} placeholder={t('mcp.serverUrlPlaceholder')} />
        </div>
        <div class="bds-field">
          <label class="bds-label">{t('mcp.apiKeyLabel')}</label>
          <input type="password" class="bds-input" bind:value={mcpEditorApiKey} placeholder={t('mcp.apiKeyPlaceholder')} />
        </div>
        <div class="bds-toggle-row" style="padding: 0;">
          <span class="bds-toggle-label">{t('mcp.enabledLabel')}</span>
          <label class="bds-switch">
            <input type="checkbox" bind:checked={mcpEditorEnabled} />
            <span class="bds-switch-track"></span>
          </label>
        </div>
      </div>
      <div class="bds-modal-footer">
        <button class="bds-btn-outlined" onclick={closeEditor}>{t('mcp.cancel')}</button>
        <button class="bds-btn" onclick={saveMcpServer} disabled={!mcpEditorName.trim() || !mcpEditorUrl.trim()}>
          {t('mcp.save')}
        </button>
      </div>
    </div>
  </div>
{/if}

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
