<script>

  import { onMount } from "svelte";
  import appState from "../../state.js";
  import { pushConfigToPage, discoverMcpToolSchemas } from "../../bridge.js";
  import {
    STORAGE_KEYS,
  } from "../../../lib/constants.js";
  import { getActiveProject, updateProject } from "../../project-manager.js";
  import { t, i18n, availableLocaleCodes } from "../../../lib/i18n.svelte.js";
  import { SEARCH_PROVIDER_CATALOG } from "../../files/search-reader.js";
  import { CSS_PRESETS } from "../../../lib/constants.js";
  import { openNativeFilePicker } from "../../files/native-file-input.js";
  import { encryptData, decryptData } from "../../../lib/utils/crypto.js";
  import { makeId } from "../../../lib/utils/helpers.js";
  import SnippetList from "../SnippetList.svelte";
  import { scrollIntoViewSafe } from "../scroll-into-view.js";

  let { onapiplayground, onimportdata, onsave } = $props();


  let autoFiles = $state(Boolean(appState.settings.autoDownloadFiles));
  let autoZip = $state(Boolean(appState.settings.autoDownloadLongWorkZip));
  let voiceMode = $state(Boolean(appState.settings.voiceMode));
  let voiceLanguage = $state(
    appState.settings.voiceLanguage ||
      (typeof navigator !== "undefined" ? navigator.language : "en-US"),
  );
  let autoSubmitVoice = $state(Boolean(appState.settings.autoSubmitVoice));
  let vadSilenceTimeout = $state(Number(appState.settings.vadSilenceTimeout) || 1500);
  let preferredLang = $state(appState.settings.preferredLang || "");
  let githubToken = $state(appState.settings.githubToken || "");
  let showGithubToken = $state(shouldShowGithubTokenByDefault(appState.settings.githubToken));
  let disableSystemPrompt = $state(
    Boolean(appState.settings.disableSystemPrompt),
  );
  let systemPromptInjectionFrequency = $state(
    appState.settings.systemPromptInjectionFrequency || "first",
  );
  let systemPromptInjectionInterval = $state(
    Number(appState.settings.systemPromptInjectionInterval) || 3,
  );
  let disableMemory = $state(Boolean(appState.settings.disableMemory));
  let htmlToMarkdownMaxDepth = $state(
    Number(appState.settings.htmlToMarkdownMaxDepth) || 200,
  );
  let maxChatSessions = $state(
    Number(appState.settings.maxChatSessions) || 500,
  );
  let tokenPriceDisplay = $state(Boolean(appState.settings.tokenPriceDisplay));
  let showTimestamps = $state(Boolean(appState.settings.showTimestamps));
  let collapseLongUserMessages = $state(Boolean(appState.settings.collapseLongUserMessages));
  let loadAllHistoryOnSession = $state(Boolean(appState.settings.loadAllHistoryOnSession));
  let projectRagEnabled = $state(Boolean(appState.settings.projectRagEnabled));
  let projectRagLimit = $state(Number(appState.settings.projectRagLimit) || 5);
  let processGitignoreOnUpload = $state(Boolean(appState.settings.processGitignoreOnUpload));
  let injectSystemDateTime = $state(Boolean(appState.settings.injectSystemDateTime));
  let skipDeletionConfirmation = $state(Boolean(appState.settings.skipDeletionConfirmation));
  let deepResearchDeepFetch = $state(Number(appState.settings.deepResearchDeepFetch) ?? 1);
  let deepResearchContextGuardEnabled = $state(Boolean(appState.settings.deepResearchContextGuardEnabled));
  let deepResearchContextLimitTokens = $state(Number(appState.settings.deepResearchContextLimitTokens) || 128000);
  let deepResearchContextStopPercent = $state(Number(appState.settings.deepResearchContextStopPercent) || 70);
  let searchProviderRows = $state(buildSearchProviderRows(appState.settings.searchProviders));
  let activeSearchProviderCount = $derived(searchProviderRows.filter((row) => row.enabled).length);
  let locale = $state(appState.settings.locale || availableLocaleCodes[0] || "en");
  let syncLocale = $state(Boolean(appState.settings.syncLocale));
  let customCSS = $state(appState.settings.customCSS || "");
  let editingSnippetId = $state(null);
  let snippetListRef = $state(null);
  let isSnippetsOpen = $state(false);
  let cssSnippets = $state([...appState.cssSnippets]);
  let activeSnippetsCount = $derived(cssSnippets.filter(s => s.active).length);
  let showSaveSnippetModal = $state(false);
  let newSnippetName = $state("");
  let saveSnippetError = $state("");
  // ── MCP servers (moved here from the old MCP-only PluginsSettings) ──
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
  let subMcpOpen = $state(false);

  let subLanguageOpen = $state(false);
  let subChatOpen = $state(false);
  let subProjectsOpen = $state(false);
  let subInjectionOpen = $state(false);
  let subResearchOpen = $state(false);
  let subVoiceOpen = $state(false);
  let subIntegrationsOpen = $state(false);
  let subUtilitiesOpen = $state(false);
  let subCSSOpen = $state(false);
  let disableTipBox = $state(Boolean(appState.settings.disableTipBox));
  let advancedSearchQuery = $state("");
  let autocompleteSelectedIndex = $state(-1);
  let savedSectionStates = $state(null);
  let lastCheckedDate = $state("");
  let updatingLanguages = $state(false);

  let dirty = $state(false);
  let showUnsavedModal = $state(false);
  let unsavedResolve = null;

  // ── Export / Import All ──
  let showExportAllModal = $state(false);
  let showImportPasswordModal = $state(false);
  let showImportSelectModal = $state(false);
  let exportPassword = $state("");
  let exportPasswordConfirm = $state("");
  let exportEncrypt = $state(false);
  let importAllFileInput = $state(null);
  let importPassword = $state("");
  let importData = $state(null);
  let importEncrypted = $state(false);
  let importPasswordError = $state("");
  let exportPasswordError = $state("");
  let isExporting = $state(false);
  let isImporting = $state(false);

  const EXPORT_SECTIONS = [
    { key: "settings", label: t('drawer.sectionSettings') },
    { key: "customSystemPrompts", label: t('drawer.sectionPrompts') },
    { key: "skills", label: t('drawer.sectionSkills') },
    { key: "characters", label: t('drawer.sectionCharacters') },
    { key: "memories", label: t('drawer.sectionMemories') },
    { key: "mcpServers", label: t('drawer.sectionMcpServers') },
    { key: "cssSnippets", label: t('drawer.sectionCssSnippets') },
    { key: "projects", label: t('drawer.sectionProjects') },
    { key: "projectFiles", label: t('drawer.sectionProjectFiles') },
    { key: "chatTags", label: t('drawer.sectionChatTags') },
    { key: "savedItems", label: t('drawer.sectionSavedItems') },
  ];
  let selectedSections = $state(new Set(EXPORT_SECTIONS.map(s => s.key)));

  function normalizeSearchProvidersSetting(raw) {
    const known = new Set(SEARCH_PROVIDER_CATALOG.map((provider) => provider.id));
    const seen = new Set();
    const enabled = [];
    if (Array.isArray(raw)) {
      for (const id of raw) {
        const key = String(id);
        if (known.has(key) && !seen.has(key)) {
          enabled.push(key);
          seen.add(key);
        }
      }
    }
    return enabled;
  }

  function buildSearchProviderRows(raw) {
    // Enabled providers keep their configured order; disabled ones follow in
    // canonical catalog order so every provider stays visible and toggleable.
    const enabled = normalizeSearchProvidersSetting(raw);
    return SEARCH_PROVIDER_CATALOG.map((provider) => ({
      id: provider.id,
      labelKey: provider.labelKey,
      name: provider.name,
      enabled: enabled.includes(provider.id),
    })).sort((a, b) => {
      const ai = enabled.indexOf(a.id);
      const bi = enabled.indexOf(b.id);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return 0;
    });
  }

  function enabledSearchProviderIds() {
    return searchProviderRows.filter((row) => row.enabled).map((row) => row.id);
  }

  function toggleSearchProvider(row) {
    if (row.enabled && activeSearchProviderCount <= 1) return;
    searchProviderRows = searchProviderRows.map((candidate) =>
      candidate.id === row.id ? { ...candidate, enabled: !candidate.enabled } : candidate
    );
  }

  function moveSearchProvider(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= searchProviderRows.length) return;
    if (searchProviderRows[target].enabled !== searchProviderRows[index].enabled) return;
    const next = [...searchProviderRows];
    [next[index], next[target]] = [next[target], next[index]];
    searchProviderRows = next;
  }

  function captureFormSnapshot() {
    return JSON.stringify({
      autoFiles, autoZip, voiceMode, voiceLanguage, autoSubmitVoice,
      vadSilenceTimeout,
      preferredLang, githubToken, disableSystemPrompt,
      systemPromptInjectionFrequency, systemPromptInjectionInterval,
      disableMemory, htmlToMarkdownMaxDepth, maxChatSessions,
      tokenPriceDisplay, showTimestamps, projectRagEnabled, projectRagLimit,
      processGitignoreOnUpload, injectSystemDateTime, skipDeletionConfirmation,
      deepResearchDeepFetch,
      searchProviders: enabledSearchProviderIds(),
      locale, syncLocale, collapseLongUserMessages,
      loadAllHistoryOnSession, customCSS, disableTipBox,
      mcpInlineMaxChars,
      mcpServers: mcpServers.map((s) => ({
        id: s.id, name: s.name, serverUrl: s.serverUrl, apiKey: s.apiKey,
        enabled: s.enabled !== false, tools: (s.tools || []).map((tl) => tl.name),
      })),
    });
  }

  let formSnapshot = $state(captureFormSnapshot());

  // ── Export / Import All ──

  function resetExportAllModal() {
    exportPassword = "";
    exportPasswordConfirm = "";
    exportEncrypt = false;
    exportPasswordError = "";
    isExporting = false;
  }

  function openExportAllModal() {
    resetExportAllModal();
    showExportAllModal = true;
  }

  function closeExportAllModal() {
    showExportAllModal = false;
  }

  /**
   * Returns true when a chrome API call fails because the extension was
   * reloaded/updated while the page tab was still open (orphaned content script).
   * The user must reload the page to re-establish the extension context.
   */
  function isExtensionContextError(e) {
    const msg = (e && e.message) ? e.message.toLowerCase() : "";
    return msg.includes("extension context invalidated") ||
           msg.includes("context invalidated") ||
           msg.includes("cannot access");
  }

  async function doExportAll() {
    if (exportEncrypt) {
      if (!exportPassword || exportPassword.length < 4) {
        exportPasswordError = t('drawer.passwordTooShort');
        return;
      }
      if (exportPassword !== exportPasswordConfirm) {
        exportPasswordError = t('drawer.passwordMismatch');
        return;
      }
    }
    exportPasswordError = "";
    isExporting = true;

    try {
      // Strip migration-only flags from exported settings so they don't
      // corrupt the version-upgrade logic on the destination device.
      const settingsToExport = { ...appState.settings, githubToken: "" };
      delete settingsToExport.systemPromptBackupDone;
      delete settingsToExport.systemPromptTemplateVersion;
      delete settingsToExport.downloadBehaviorVersion;
      // customSystemPrompts is exported as its own top-level key so it can be
      // imported independently; remove it from the settings blob to avoid
      // double-importing when the settings section is selected.
      delete settingsToExport.customSystemPrompts;

      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: settingsToExport,
        cssSnippets: appState.cssSnippets,
        customSystemPrompts: appState.settings.customSystemPrompts || [],
        skills: appState.skills,
        characters: appState.characters,
        memories: appState.memories,
        mcpServers: appState.mcpServers,
        projects: appState.projects,
        projectFiles: appState.projectFiles,
        chatTags: appState.chatTags,
        savedItems: appState.savedItems,
      };

      let blob;
      if (exportEncrypt) {
        const encrypted = await encryptData(JSON.stringify(data), exportPassword);
        blob = new Blob([JSON.stringify(encrypted)], { type: "application/json" });
      } else {
        blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bds_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      closeExportAllModal();
      if (appState.ui) appState.ui.showToast(t('drawer.exportDone'));
    } catch (e) {
      if (isExtensionContextError(e)) {
        if (appState.ui) appState.ui.showToast(t('drawer.importContextError'), 8000);
      } else {
        if (appState.ui) appState.ui.showToast(t('drawer.exportFailed'));
      }
    }

    isExporting = false;
  }

  function triggerImportAll() {
    openNativeFilePicker(importAllFileInput, { preferSingle: true });
  }

  function resetImportState() {
    importPassword = "";
    importData = null;
    importEncrypted = false;
    importPasswordError = "";
    isImporting = false;
    selectedSections = new Set(EXPORT_SECTIONS.map(s => s.key));
  }

  async function handleImportAll(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);

      if (parsed.encrypted) {
        resetImportState();
        importData = parsed;
        importEncrypted = true;
        showImportPasswordModal = true;
      } else {
        resetImportState();
        importData = parsed;
        importEncrypted = false;
        showImportSelectModal = true;
      }
    } catch (e) {
      if (appState.ui) appState.ui.showToast(t('drawer.importParseError'));
    } finally {
      input.value = "";
    }
  }

  async function doDecryptAndShow() {
    if (!importPassword) {
      importPasswordError = t('drawer.passwordRequired');
      return;
    }
    importPasswordError = "";
    isImporting = true;

    try {
      const decrypted = await decryptData(importData, importPassword);
      importData = JSON.parse(decrypted);
      showImportPasswordModal = false;
      importPassword = "";
      showImportSelectModal = true;
    } catch (e) {
      importPasswordError = t('drawer.passwordWrong');
    }

    isImporting = false;
  }

  function toggleSection(key) {
    const next = new Set(selectedSections);
    if (next.has(key)) next.delete(key); else next.add(key);
    selectedSections = next;
  }

  async function doImportAll() {
    if (!importData) return;
    isImporting = true;

    // Toast message is deferred until after the modal closes (finally block)
    // so it is never hidden behind the overlay or cut off by its animation.
    let pendingToast = null;
    let pendingToastDuration = 2880;

    try {
      const d = importData;

      const plain = (obj) => JSON.parse(JSON.stringify(obj ?? null));

      // Sections this file can actually satisfy. A single-section export
      // dropped into "Import All Data" matches none of them, and reporting
      // success for a no-op is worse than reporting nothing happened.
      const matchedSections = EXPORT_SECTIONS.filter(
        (section) => selectedSections.has(section.key) && Boolean(d[section.key]),
      );

      if (selectedSections.has("settings") && d.settings) {
        const oldToken = appState.settings.githubToken;
        // Preserve migration flags from the destination device so that
        // loadStateFromStorage()'s upgrade logic remains correct after reload.
        const migrationsToKeep = {
          systemPromptBackupDone: appState.settings.systemPromptBackupDone,
          systemPromptTemplateVersion: appState.settings.systemPromptTemplateVersion,
          downloadBehaviorVersion: appState.settings.downloadBehaviorVersion,
        };
        // Use a reactive spread (not Object.assign) so Svelte 5 tracks the change.
        appState.settings = {
          ...appState.settings,
          ...d.settings,
          ...migrationsToKeep,
          githubToken: oldToken,
          // customSystemPrompts is managed by its own section below; prevent
          // the settings blob from silently overwriting it regardless of the
          // user's section selection.
          customSystemPrompts: appState.settings.customSystemPrompts,
        };
        await chrome.storage.local.set({ [STORAGE_KEYS.settings]: plain(appState.settings) });
      }
      if (selectedSections.has("customSystemPrompts") && d.customSystemPrompts) {
        appState.settings = {
          ...appState.settings,
          customSystemPrompts: plain(d.customSystemPrompts),
        };
        await chrome.storage.local.set({ [STORAGE_KEYS.settings]: plain(appState.settings) });
      }
      if (selectedSections.has("cssSnippets") && d.cssSnippets) {
        appState.cssSnippets = plain(d.cssSnippets);
        await chrome.storage.local.set({ [STORAGE_KEYS.cssSnippets]: appState.cssSnippets });
      }
      if (selectedSections.has("skills") && d.skills) {
        appState.skills = plain(d.skills);
        await chrome.storage.local.set({ [STORAGE_KEYS.skills]: appState.skills });
      }
      if (selectedSections.has("characters") && d.characters) {
        appState.characters = plain(d.characters);
        await chrome.storage.local.set({ [STORAGE_KEYS.characters]: appState.characters });
      }
      if (selectedSections.has("memories") && d.memories) {
        appState.memories = plain(d.memories);
        await chrome.storage.local.set({ [STORAGE_KEYS.memories]: appState.memories });
      }
      if (selectedSections.has("mcpServers") && d.mcpServers) {
        appState.mcpServers = plain(d.mcpServers);
        await chrome.storage.local.set({ [STORAGE_KEYS.mcpServers]: appState.mcpServers });
      }
      if (selectedSections.has("projects") && d.projects) {
        appState.projects = plain(d.projects);
        await chrome.storage.local.set({ [STORAGE_KEYS.projects]: appState.projects });
      }
      if (selectedSections.has("projectFiles") && d.projectFiles) {
        appState.projectFiles = plain(d.projectFiles);
        await chrome.storage.local.set({ [STORAGE_KEYS.projectFiles]: appState.projectFiles });
      }
      if (selectedSections.has("chatTags") && d.chatTags) {
        appState.chatTags = plain(d.chatTags);
        await chrome.storage.local.set({ [STORAGE_KEYS.chatTags]: appState.chatTags });
      }
      if (selectedSections.has("savedItems") && d.savedItems) {
        appState.savedItems = plain(d.savedItems);
        await chrome.storage.local.set({ [STORAGE_KEYS.savedItems]: appState.savedItems });
      }

      // Explicitly refresh the settings form so local $state variables
      // reflect the newly imported values without requiring a page reload.
      if (matchedSections.length === 0) {
        pendingToast = t('drawer.importNoSections');
        pendingToastDuration = 6000;
      } else {
        refresh();

        pushConfigToPage();
        onimportdata?.();

        pendingToast = t('drawer.importDone');
      }
    } catch (e) {
      console.error("[BDS] doImportAll error:", e);
      if (isExtensionContextError(e)) {
        pendingToast = t('drawer.importContextError');
        pendingToastDuration = 8000;
      } else {
        pendingToast = t('drawer.importFailed');
      }
    } finally {
      showImportSelectModal = false;
      resetImportState();
      isImporting = false;
    }

    // Show feedback only after the modal is fully closed so the toast is
    // never obscured by the overlay and the user always sees the result.
    if (pendingToast && appState.ui) {
      appState.ui.showToast(pendingToast, pendingToastDuration);
    }
  }


  function closeImportPasswordModal() {
    showImportPasswordModal = false;
    resetImportState();
  }

  function closeImportSelectModal() {
    showImportSelectModal = false;
    resetImportState();
  }

  $effect(() => {
    const current = captureFormSnapshot();
    dirty = current !== formSnapshot;
  });

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

  let activeProject = $state(getActiveProject());
  let projectInstructions = $state(activeProject?.customInstructions || "");
  let projectSaveTimer = null;
  const GITHUB_TOKEN_MASK_CHAR = "\u25cf";

  // ── Single source of truth: section → setting i18n keys ──
  const SECTION_SETTINGS = [
    { key: 'subLanguage', labelKey: 'settings.subLanguage', settingKeys: [
      'settings.syncLocale', 'settings.selectLanguage', 'settings.checkUpdates',
      'settings.resetFactory', 'settings.preferredLang',
    ]},
    { key: 'subChat', labelKey: 'settings.subChat', settingKeys: [
      'settings.collapseLongUserMessages', 'settings.loadAllHistoryOnSession', 'settings.chatSessionCap',
    ]},
    { key: 'subProjects', labelKey: 'settings.subProjects', settingKeys: [
      'settings.projectAutoContext', 'settings.processGitignore',
      'settings.autoDownloadFiles', 'settings.autoDownloadZip',
    ]},
    { key: 'subInjection', labelKey: 'settings.subInjection', settingKeys: [
      'settings.disableSystemPrompt', 'settings.disableMemory',
      'settings.injectSystemDateTime', 'settings.skipDeletionConfirmation',
      'settings.injectionFrequency',
    ]},
    { key: 'subResearch', labelKey: 'settings.subResearch', settingKeys: [
      'settings.deepFetchPerSearch',
      'settings.searchProviders', 'settings.searchProvider.ddgLite',
      'settings.searchProvider.ddgHtml', 'settings.searchProvider.bing',
      'settings.contextGuardEnabled', 'settings.contextGuardLimit',
      'settings.contextGuardStopPercent',
    ]},
    { key: 'subVoice', labelKey: 'settings.subVoice', settingKeys: [
      'settings.voiceMode', 'settings.autoSubmitVoice',
      'settings.speechLanguage', 'settings.vadSilenceTimeout',
    ]},
    { key: 'subIntegrations', labelKey: 'settings.subIntegrations', settingKeys: [
      'settings.markdownMaxDepth', 'settings.githubToken',
      'settings.tokenPriceEstimation', 'settings.showTimestamps',
    ]},
    { key: 'subCSS', labelKey: 'settings.subCSS', settingKeys: [
      'settings.customCSS', 'settings.cssPresets',
      'settings.saveAsSnippet', 'settings.manageSnippets',
    ]},
    { key: 'subMcp', labelKey: 'mcp.sectionTitle', settingKeys: [
      'mcp.description', 'mcp.transportNote', 'mcp.addServer', 'mcp.inlineMaxChars',
    ]},
    { key: 'subUtilities', labelKey: 'settings.subUtilities', settingKeys: [
      'apiPlayground.title', 'drawer.exportAll', 'drawer.importAll', 'settings.disableTipBox',
    ]},
  ];

  let searchIndex = $derived(
    SECTION_SETTINGS.map(s => ({
      sectionKey: s.key,
      sectionLabel: t(s.labelKey),
      settings: s.settingKeys.map(k => ({ label: t(k) }))
    }))
  );

  let filteredSearchSections = $derived.by(() => {
    const q = advancedSearchQuery.toLowerCase().trim();
    if (!q) return null;
    return searchIndex.map(section => {
      const sectionMatch = section.sectionLabel.toLowerCase().includes(q);
      return { ...section, match: sectionMatch || section.settings.some(s => s.label.toLowerCase().includes(q)) };
    }).filter(s => s.match);
  });

  let autocompleteItems = $derived.by(() => {
    const q = advancedSearchQuery.toLowerCase().trim();
    if (!q || q.length < 1) return [];
    const items = [];
    const seen = new Set();
    for (const section of searchIndex) {
      const sl = section.sectionLabel.toLowerCase();
      if (sl.includes(q) && !seen.has(section.sectionKey)) {
        seen.add(section.sectionKey);
        items.push({ type: 'section', sectionKey: section.sectionKey, label: section.sectionLabel });
      }
      for (const setting of section.settings) {
        if (setting.label.toLowerCase().includes(q)) {
          const dedupKey = section.sectionKey + '::' + setting.label;
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            items.push({ type: 'setting', sectionKey: section.sectionKey, label: setting.label, parentLabel: section.sectionLabel });
          }
        }
      }
    }
    return items;
  });

  let searchActive = $derived(advancedSearchQuery.trim().length > 0);

  $effect(() => {
    autocompleteItems;
    autocompleteSelectedIndex = -1;
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
    formSnapshot = captureFormSnapshot();
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

  function snapshotSectionStates() {
    return {
      subLanguage: subLanguageOpen, subChat: subChatOpen,
      subProjects: subProjectsOpen, subInjection: subInjectionOpen,
      subResearch: subResearchOpen, subVoice: subVoiceOpen,
      subIntegrations: subIntegrationsOpen, subCSS: subCSSOpen,
      subMcp: subMcpOpen,
      subUtilities: subUtilitiesOpen,
    };
  }

  function restoreSectionStates(states) {
    if (!states) return;
    subLanguageOpen = states.subLanguage; subChatOpen = states.subChat;
    subProjectsOpen = states.subProjects; subInjectionOpen = states.subInjection;
    subResearchOpen = states.subResearch; subVoiceOpen = states.subVoice;
    subIntegrationsOpen = states.subIntegrations; subCSSOpen = states.subCSS;
    subMcpOpen = states.subMcp;
    subUtilitiesOpen = states.subUtilities;
  }

  let wasSearchActive = false;

  $effect(() => {
    if (searchActive && !wasSearchActive) {
      savedSectionStates = snapshotSectionStates();
    } else if (!searchActive && wasSearchActive && savedSectionStates) {
      restoreSectionStates(savedSectionStates);
      savedSectionStates = null;
    }
    wasSearchActive = searchActive;
    if (!searchActive) return;
    const matchingKeys = new Set(filteredSearchSections?.map(s => s.sectionKey) || []);
    subLanguageOpen = matchingKeys.has('subLanguage');
    subChatOpen = matchingKeys.has('subChat');
    subProjectsOpen = matchingKeys.has('subProjects');
    subInjectionOpen = matchingKeys.has('subInjection');
    subResearchOpen = matchingKeys.has('subResearch');
    subVoiceOpen = matchingKeys.has('subVoice');
    subIntegrationsOpen = matchingKeys.has('subIntegrations');
    subCSSOpen = matchingKeys.has('subCSS');
    subMcpOpen = matchingKeys.has('subMcp');
    subUtilitiesOpen = matchingKeys.has('subUtilities');
  });

  function isSectionMatch(sectionKey) {
    if (!searchActive) return true;
    return filteredSearchSections?.some(s => s.sectionKey === sectionKey) ?? false;
  }

  function handleAdvancedSearchKeydown(e) {
    if (!autocompleteItems.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); autocompleteSelectedIndex = Math.min(autocompleteSelectedIndex + 1, autocompleteItems.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); autocompleteSelectedIndex = autocompleteSelectedIndex <= 0 ? autocompleteItems.length - 1 : autocompleteSelectedIndex - 1; }
    else if (e.key === 'Enter') { e.preventDefault(); if (autocompleteSelectedIndex < 0) autocompleteSelectedIndex = 0; selectAutocompleteItem(); }
    else if (e.key === 'Escape') { e.preventDefault(); advancedSearchQuery = ''; }
  }

  function selectAutocompleteItem() {
    const item = autocompleteItems[autocompleteSelectedIndex];
    if (!item) return;
    advancedSearchQuery = item.label;
    // Selecting a section jumps straight to its card (BDS-UI scrollToSection).
    if (item.type === 'section') scrollToSection(item.sectionKey);
  }

  /**
   * Expands and scrolls to one settings section card. Exposed through the
   * Drawer/App UI API so other surfaces can deep-link into Advanced Settings
   * without re-implementing the search-expansion logic.
   */
  export function scrollToSection(sectionKey) {
    if (!sectionKey) return;
    const toggle = document.querySelector(`[data-bds-section="${sectionKey}"]`);
    if (!toggle) return;
    if (searchActive && filteredSearchSections?.length) {
      const matching = new Set(filteredSearchSections.map((s) => s.sectionKey));
      if (!matching.has(sectionKey)) {
        advancedSearchQuery = "";
      }
    }
    toggle.click();
    requestAnimationFrame(() => {
      scrollIntoViewSafe(toggle);
    });
  }

  function handleAutocompleteMouseDown(e, index) { e.preventDefault(); autocompleteSelectedIndex = index; selectAutocompleteItem(); }

  function shouldShowGithubTokenByDefault(tokenValue = githubToken) {
    return !String(tokenValue || "").trim();
  }

  export function refresh() {
    mcpServers = [...appState.mcpServers];
    mcpInlineMaxChars = Number(appState.settings.mcpInlineMaxChars) || 8000;
    autoFiles = Boolean(appState.settings.autoDownloadFiles);
    autoZip = Boolean(appState.settings.autoDownloadLongWorkZip);
    voiceMode = Boolean(appState.settings.voiceMode);
    voiceLanguage =
      appState.settings.voiceLanguage ||
      (typeof navigator !== "undefined" ? navigator.language : "en-US");
    autoSubmitVoice = Boolean(appState.settings.autoSubmitVoice);
    vadSilenceTimeout = Number(appState.settings.vadSilenceTimeout) || 1500;
    preferredLang = appState.settings.preferredLang || "";
    githubToken = appState.settings.githubToken || "";
    showGithubToken = shouldShowGithubTokenByDefault(githubToken);
    disableSystemPrompt = Boolean(appState.settings.disableSystemPrompt);
    systemPromptInjectionFrequency =
      appState.settings.systemPromptInjectionFrequency || "first";
    systemPromptInjectionInterval =
      Number(appState.settings.systemPromptInjectionInterval) || 3;
    disableMemory = Boolean(appState.settings.disableMemory);
    htmlToMarkdownMaxDepth =
      Number(appState.settings.htmlToMarkdownMaxDepth) || 200;
    maxChatSessions = Number(appState.settings.maxChatSessions) || 500;
    tokenPriceDisplay = Boolean(appState.settings.tokenPriceDisplay);
    showTimestamps = Boolean(appState.settings.showTimestamps);
    collapseLongUserMessages = Boolean(appState.settings.collapseLongUserMessages);
    loadAllHistoryOnSession = Boolean(appState.settings.loadAllHistoryOnSession);
    projectRagEnabled = Boolean(appState.settings.projectRagEnabled);
    projectRagLimit = Number(appState.settings.projectRagLimit) || 5;
    deepResearchDeepFetch = Number(appState.settings.deepResearchDeepFetch) ?? 1;
    searchProviderRows = buildSearchProviderRows(appState.settings.searchProviders);
    processGitignoreOnUpload = Boolean(appState.settings.processGitignoreOnUpload);
    injectSystemDateTime = Boolean(appState.settings.injectSystemDateTime);
    skipDeletionConfirmation = Boolean(appState.settings.skipDeletionConfirmation);
    locale = appState.settings.locale || availableLocaleCodes[0] || "en";
    syncLocale = Boolean(appState.settings.syncLocale);
    customCSS = appState.settings.customCSS || "";
    disableTipBox = Boolean(appState.settings.disableTipBox);
    cssSnippets = [...appState.cssSnippets];
    if (snippetListRef) snippetListRef.refresh();
    chrome.storage.local.get("bds_locale_update_last_checked", (data) => {
      lastCheckedDate = data.bds_locale_update_last_checked || "";
    });
    formSnapshot = captureFormSnapshot();
  }

  export function refreshCssSnippets() {
    cssSnippets = [...appState.cssSnippets];
    if (snippetListRef) snippetListRef.refresh();
  }

  function editSnippet(snippetId) {
    const snippet = appState.cssSnippets.find((s) => s.id === snippetId);
    if (!snippet) return;
    editingSnippetId = snippet.id;
    customCSS = snippet.css;
    const textarea = document.querySelector(".bds-css-editor");
    if (textarea) {
      textarea.focus();
      textarea.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function cancelEditSnippet() {
    editingSnippetId = null;
    customCSS = appState.settings.customCSS || "";
  }

  async function updateSnippet() {
    if (!editingSnippetId) return;
    const snippet = appState.cssSnippets.find((s) => s.id === editingSnippetId);
    if (!snippet) return;

    snippet.css = customCSS;
    await chrome.storage.local.set({
      [STORAGE_KEYS.cssSnippets]: appState.cssSnippets,
    });

    editingSnippetId = null;
    customCSS = appState.settings.customCSS || "";

    cssSnippets = [...appState.cssSnippets];
    if (snippetListRef) snippetListRef.refresh();
    window.dispatchEvent(new CustomEvent("bds:cssSnippetsChanged"));
    pushConfigToPage();

    if (appState.ui) {
      appState.ui.showToast(t("settings.snippetUpdated"));
    }
  }

  function saveAsSnippet() {
    if (!customCSS || !customCSS.trim()) return;
    newSnippetName = "";
    saveSnippetError = "";
    showSaveSnippetModal = true;
  }

  async function submitSaveSnippet() {
    const trimmedName = newSnippetName.trim();
    if (!trimmedName) {
      saveSnippetError = t("settings.nameRequired");
      return;
    }

    const exists = appState.cssSnippets.some(
      (s) => s.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (exists) {
      saveSnippetError = t("settings.duplicateNameError");
      return;
    }

    const newSnippet = {
      id: makeId(),
      name: trimmedName,
      css: customCSS,
      active: true,
      isPreset: false
    };

    appState.cssSnippets.push(newSnippet);
    await chrome.storage.local.set({
      [STORAGE_KEYS.cssSnippets]: appState.cssSnippets
    });

    customCSS = "";

    cssSnippets = [...appState.cssSnippets];
    if (snippetListRef) snippetListRef.refresh();
    window.dispatchEvent(new CustomEvent("bds:cssSnippetsChanged"));
    pushConfigToPage();

    showSaveSnippetModal = false;

    if (appState.ui) {
      appState.ui.showToast(t("settings.snippetSaved"));
    }
  }

  onMount(() => {
    chrome.storage.local.get("bds_locale_update_last_checked", (data) => {
      lastCheckedDate = data.bds_locale_update_last_checked || "";
    });
    formSnapshot = captureFormSnapshot();
  });

  async function checkLanguageUpdates() {
    if (updatingLanguages) return;
    updatingLanguages = true;

    chrome.runtime.sendMessage({ type: "BDS_UPDATE_LANGUAGES" }, (response) => {
      updatingLanguages = false;
      if (response && response.success) {
        chrome.storage.local.get("bds_locale_update_last_checked", (data) => {
          lastCheckedDate = data.bds_locale_update_last_checked || new Date().toLocaleDateString();
        });
        if (appState.ui) {
          appState.ui.showToast(t("settings.updatedSuccess"));
        }
      } else {
        if (appState.ui) {
          appState.ui.showToast(t("settings.updateFailed"));
        }
      }
    });
  }

  async function resetLanguageFactory() {
    chrome.runtime.sendMessage({ type: "BDS_RESET_LANGUAGES" }, (response) => {
      if (response && response.success) {
        lastCheckedDate = "";
        if (appState.ui) {
          appState.ui.showToast(t("settings.resetSuccess"));
        }
      } else {
        if (appState.ui) {
          appState.ui.showToast(t("settings.updateFailed"));
        }
      }
    });
  }

  export function refreshProject() {
    activeProject = getActiveProject();
    projectInstructions = activeProject?.customInstructions || "";
  }

  function scheduleProjectSave() {
    if (projectSaveTimer) clearTimeout(projectSaveTimer);
    projectSaveTimer = setTimeout(async () => {
      projectSaveTimer = null;
      const project = getActiveProject();
      if (!project) return;
      await updateProject(project.id, {
        customInstructions: projectInstructions,
      });
      pushConfigToPage();
    }, 600);
  }

  async function save() {
    // System prompt fields (customSystemPrompts, activeSystemPromptId, multi
    // mode, entries, template versions) are owned by AdvancedSettings.svelte —
    // this system never touches them.
    appState.settings.autoDownloadFiles = autoFiles;
    appState.settings.autoDownloadLongWorkZip = autoZip;
    appState.settings.voiceMode = voiceMode;
    appState.settings.voiceLanguage = voiceLanguage;
    appState.settings.autoSubmitVoice = autoSubmitVoice;
    appState.settings.vadSilenceTimeout = Math.max(500, Math.min(3000, Math.round(vadSilenceTimeout)));
    appState.settings.preferredLang = preferredLang.trim();
    appState.settings.githubToken = githubToken.trim();
    appState.settings.disableSystemPrompt = disableSystemPrompt;
    appState.settings.systemPromptInjectionFrequency =
      systemPromptInjectionFrequency;
    appState.settings.systemPromptInjectionInterval =
      systemPromptInjectionInterval;
    appState.settings.disableMemory = disableMemory;
    appState.settings.htmlToMarkdownMaxDepth = Math.max(
      10,
      Math.floor(Number(htmlToMarkdownMaxDepth) || 200),
    );
    appState.settings.maxChatSessions = Math.max(
      10,
      Math.floor(Number(maxChatSessions) || 500),
    );
    appState.settings.tokenPriceDisplay = tokenPriceDisplay;
    appState.settings.showTimestamps = showTimestamps;
    appState.settings.collapseLongUserMessages = collapseLongUserMessages;
    appState.settings.loadAllHistoryOnSession = loadAllHistoryOnSession;
    appState.settings.projectRagEnabled = projectRagEnabled;
    appState.settings.projectRagLimit = Number(projectRagLimit) || 5;
    appState.settings.processGitignoreOnUpload = processGitignoreOnUpload;
    appState.settings.injectSystemDateTime = injectSystemDateTime;
    appState.settings.skipDeletionConfirmation = skipDeletionConfirmation;
    appState.settings.deepResearchDeepFetch = Math.max(0, Math.min(5, Math.round(Number(deepResearchDeepFetch) || 0)));
    // Never persist an empty provider list — fall back to the full default order.
    const enabledProviders = enabledSearchProviderIds();
    appState.settings.searchProviders = enabledProviders.length > 0
      ? enabledProviders
      : SEARCH_PROVIDER_CATALOG.map((provider) => provider.id);
    appState.settings.deepResearchContextGuardEnabled = deepResearchContextGuardEnabled;
    appState.settings.deepResearchContextLimitTokens = Math.max(16000, Math.min(1000000, Math.round(Number(deepResearchContextLimitTokens) || 128000)));
    appState.settings.deepResearchContextStopPercent = Math.max(50, Math.min(95, Math.round(Number(deepResearchContextStopPercent) || 70)));
    appState.settings.locale = locale;
    appState.settings.syncLocale = syncLocale;
    appState.settings.customCSS = customCSS;
    appState.settings.disableTipBox = disableTipBox;
    appState.settings.mcpInlineMaxChars = Math.max(
      500,
      Math.min(100000, Math.round(Number(mcpInlineMaxChars) || 8000)),
    );
    appState.mcpServers = JSON.parse(JSON.stringify(mcpServers));

    await chrome.storage.local.set({
      [STORAGE_KEYS.settings]: JSON.parse(JSON.stringify(appState.settings)),
    });
    await chrome.storage.local.set({
      [STORAGE_KEYS.mcpServers]: JSON.parse(JSON.stringify(appState.mcpServers)),
    });
    if (!syncLocale) {
      i18n.setLocale(locale);
    }
    pushConfigToPage();

    formSnapshot = captureFormSnapshot();

    if (appState.ui) {
      appState.ui.showToast(t("settings.settingsSaved"));
    }

    onsave?.();
  }

  function getGithubTokenDisplayValue() {
    if (showGithubToken) {
      return githubToken;
    }

    if (!githubToken) {
      return "";
    }

    // Operational security: Don't show the actual token
    // when "Show" is not active. 
    // Instead, show a fixed number of mask characters to indicate
    // that a token is set without revealing it.
    return GITHUB_TOKEN_MASK_CHAR.repeat(999);
  }
</script>

<!--
  Plugins (BDS-UI F.6, Round-2 scope): owns ALL ten former settings
  subsections — Language & Region, Chat & Messages, Projects & Files,
  Prompt & Memory, Deep Research, Voice, Integrations, Custom CSS,
  MCP Servers and Utilities — with their original state, persistence and the
  in-panel settings search. "Advanced Settings" (system prompts + skills) is a
  separate component: settings/AdvancedSettings.svelte.

  Layout/visual language: premium, mobile-first dark (BDS-UI F.7).
-->
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

{#if activeProject}
  <div class="bds-label-row" style="margin-top: 12px;">
    <label class="bds-label" for="bds-project-instructions">
      {t('settings.projectInstructions')} — <em style="font-weight: 400; opacity: 0.7;"
        >{activeProject.name}</em
      >
    </label>
  </div>
  <textarea
    id="bds-project-instructions"
    class="bds-input"
    spellcheck="false"
    bind:value={projectInstructions}
    oninput={scheduleProjectSave}
    placeholder={t('settings.projectInstructionsPlaceholder')}
  ></textarea>
  <p style="font-size: 10px; opacity: 0.5; margin: 2px 0 12px;">{t('settings.autoSaved')}</p>
{/if}

  <div class="bds-advanced-content bds-open">
    <div class="bds-advanced-search-wrapper">
      <div class="bds-advanced-search-input-wrapper">
        <svg class="bds-advanced-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          class="bds-advanced-search-input"
          placeholder={t('settings.advancedSearchPlaceholder')}
          bind:value={advancedSearchQuery}
          onkeydown={handleAdvancedSearchKeydown}
        />
      </div>
      {#if advancedSearchQuery.trim().length > 0 && autocompleteItems.length > 0}
        <div class="bds-advanced-autocomplete">
          {#each autocompleteItems as item, i}
            <button
              type="button"
              class="bds-advanced-ac-item"
              class:selected={i === autocompleteSelectedIndex}
              onmousedown={(e) => handleAutocompleteMouseDown(e, i)}
              onmouseenter={() => { autocompleteSelectedIndex = i; }}
            >
              <span class="bds-advanced-ac-label">{item.label}</span>
              {#if item.type === 'setting'}
                <span class="bds-advanced-ac-section">— {item.parentLabel}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
      {#if advancedSearchQuery.trim().length > 0 && filteredSearchSections?.length === 0}
        <div class="bds-advanced-no-results">{t('settings.advancedNoResults')}</div>
      {/if}
    </div>

    <div class="bds-advanced-inner">
    <!-- Each sub-section visibility is controlled by isSectionMatch() when search is active -->
    {#if isSectionMatch('subLanguage')}
    <button type="button" class="bds-sub-toggle" class:open={subLanguageOpen} data-bds-section="subLanguage" onclick={() => subLanguageOpen = !subLanguageOpen} aria-expanded={subLanguageOpen}>
      {t('settings.subLanguage')}
      <span class="bds-chevron">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>
    <div class="bds-sub-content" class:open={subLanguageOpen}>
      <div class="bds-sub-inner">
        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.syncLocale')}</span>
          <label class="bds-switch">
            <input type="checkbox" bind:checked={syncLocale} />
            <span class="bds-switch-track"></span>
          </label>
        </div>

        {#if !syncLocale}
          <div class="bds-toggle-row">
            <span class="bds-toggle-label">{t('settings.selectLanguage')}</span>
            <select class="bds-select" bind:value={locale} style="width: 140px; max-width: 100%; box-sizing: border-box;">
              {#each availableLocaleCodes as code}
                <option value={code}>{i18n.getNativeName(code)}</option>
              {/each}
            </select>
          </div>
        {/if}

        <div class="bds-toggle-row" style="flex-direction: column; align-items: stretch; gap: 8px;">
          <div class="bds-lang-btn-group">
            <button type="button" class="bds-btn-outlined bds-lang-btn" onclick={checkLanguageUpdates} disabled={updatingLanguages}>
              {updatingLanguages ? t('common.working') : t('settings.checkUpdates')}
            </button>
            <button type="button" class="bds-btn-outlined bds-lang-btn bds-lang-reset-btn" onclick={resetLanguageFactory}>
              {t('settings.resetFactory')}
            </button>
          </div>
          {#if lastCheckedDate}
            <span style="font-size: 10px; opacity: 0.5; text-align: center; display: block; margin-top: 2px;">
              {t('settings.lastChecked').replace('{{date}}', lastCheckedDate)}
            </span>
          {/if}
        </div>

        <div class="bds-toggle-row" style="flex-direction: column; align-items: flex-start; gap: 6px;">
          <span class="bds-toggle-label">{t('settings.preferredLang')}</span>
          <input id="bds-preferred-lang" type="text" class="bds-input" style="width: 100%; box-sizing: border-box;" placeholder={t('settings.preferredLangPlaceholder')} bind:value={preferredLang} />
          <p style="font-size: 10px; opacity: 0.5; margin: 0;">
            {t('settings.preferredLangHint')}
          </p>
        </div>
      </div>
    </div>
    {/if}

    {#if isSectionMatch('subChat')}
    <button type="button" class="bds-sub-toggle" class:open={subChatOpen} data-bds-section="subChat" onclick={() => subChatOpen = !subChatOpen} aria-expanded={subChatOpen}>
      {t('settings.subChat')}
      <span class="bds-chevron">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>
    <div class="bds-sub-content" class:open={subChatOpen}>
      <div class="bds-sub-inner">
        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.collapseLongUserMessages')}</span>
          <label class="bds-switch">
            <input id="bds-collapse-user-messages" type="checkbox" bind:checked={collapseLongUserMessages} />
            <span class="bds-switch-track"></span>
          </label>
        </div>

        <div class="bds-toggle-row" style="flex-direction: column; align-items: flex-start; gap: 6px;">
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 12px;">
            <span class="bds-toggle-label">{t('settings.loadAllHistoryOnSession')}</span>
            <label class="bds-switch">
              <input id="bds-load-all-history" type="checkbox" bind:checked={loadAllHistoryOnSession} />
              <span class="bds-switch-track"></span>
            </label>
          </div>
          <p style="font-size: 10px; opacity: 0.5; margin: 0;">
            {t('settings.loadAllHistoryHint')}
          </p>
        </div>

        <div class="bds-toggle-row" style="flex-direction: column; align-items: flex-start; gap: 6px;">
          <span class="bds-toggle-label">{t('settings.chatSessionCap')}</span>
          <input id="bds-max-chat-sessions" type="number" min="10" step="50" class="bds-input" style="width: 120px; box-sizing: border-box;" bind:value={maxChatSessions} />
          <p style="font-size: 10px; opacity: 0.5; margin: 0;">
            {t('settings.chatSessionCapHint')}
          </p>
        </div>
      </div>
    </div>
    {/if}

    {#if isSectionMatch('subProjects')}
    <button type="button" class="bds-sub-toggle" class:open={subProjectsOpen} data-bds-section="subProjects" onclick={() => subProjectsOpen = !subProjectsOpen} aria-expanded={subProjectsOpen}>
      {t('settings.subProjects')}
      <span class="bds-chevron">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>
    <div class="bds-sub-content" class:open={subProjectsOpen}>
      <div class="bds-sub-inner">
        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.projectAutoContext')}</span>
          <label class="bds-switch">
            <input id="bds-project-rag" type="checkbox" bind:checked={projectRagEnabled} />
            <span class="bds-switch-track"></span>
          </label>
        </div>

        {#if projectRagEnabled}
          <div class="bds-toggle-row" style="flex-direction: column; align-items: flex-start; gap: 6px; padding-left: 12px; border-left: 2px solid rgba(255, 255, 255, 0.1); margin-left: 4px;">
            <span class="bds-toggle-label">{t('settings.ragChunks')}</span>
            <select class="bds-select" bind:value={projectRagLimit}>
              <option value={3}>{t('settings.ragChunks3')}</option>
              <option value={5}>{t('settings.ragChunks5')}</option>
              <option value={8}>{t('settings.ragChunks8')}</option>
              <option value={10}>{t('settings.ragChunks10')}</option>
            </select>
            <p style="font-size: 10px; opacity: 0.5; margin: 0;">
              {t('settings.ragHint')}
            </p>
          </div>
        {/if}

        <div class="bds-toggle-row" style="flex-wrap: wrap;">
          <span class="bds-toggle-label">{t('settings.processGitignore')}</span>
          <label class="bds-switch">
            <input id="bds-gitignore-upload" type="checkbox" bind:checked={processGitignoreOnUpload} />
            <span class="bds-switch-track"></span>
          </label>
        </div>

        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.autoDownloadFiles')}</span>
          <label class="bds-switch">
            <input id="bds-auto-files" type="checkbox" bind:checked={autoFiles} />
            <span class="bds-switch-track"></span>
          </label>
        </div>

        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.autoDownloadZip')}</span>
          <label class="bds-switch">
            <input id="bds-auto-zip" type="checkbox" bind:checked={autoZip} />
            <span class="bds-switch-track"></span>
          </label>
        </div>
      </div>
    </div>
    {/if}

    {#if isSectionMatch('subInjection')}
    <button type="button" class="bds-sub-toggle" class:open={subInjectionOpen} data-bds-section="subInjection" onclick={() => subInjectionOpen = !subInjectionOpen} aria-expanded={subInjectionOpen}>
      {t('settings.subInjection')}
      <span class="bds-chevron">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>
    <div class="bds-sub-content" class:open={subInjectionOpen}>
      <div class="bds-sub-inner">
        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.disableSystemPrompt')}</span>
          <label class="bds-switch">
            <input id="bds-disable-prompt" type="checkbox" bind:checked={disableSystemPrompt} />
            <span class="bds-switch-track"></span>
          </label>
        </div>

        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.disableMemory')}</span>
          <label class="bds-switch">
            <input id="bds-disable-memory" type="checkbox" bind:checked={disableMemory} />
            <span class="bds-switch-track"></span>
          </label>
        </div>

        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.injectSystemDateTime')}</span>
          <label class="bds-switch">
            <input id="bds-inject-datetime" type="checkbox" bind:checked={injectSystemDateTime} />
            <span class="bds-switch-track"></span>
          </label>
        </div>

        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.skipDeletionConfirmation')}</span>
          <label class="bds-switch">
            <input id="bds-skip-deletion-confirm" type="checkbox" bind:checked={skipDeletionConfirmation} />
            <span class="bds-switch-track"></span>
          </label>
        </div>

        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.injectionFrequency')}</span>
          <select class="bds-select" bind:value={systemPromptInjectionFrequency}>
            <option value="first">{t('settings.firstMessage')}</option>
            <option value="always">{t('settings.everyMessage')}</option>
            <option value="every_x">{t('settings.everyNMessages')}</option>
          </select>
        </div>

        {#if systemPromptInjectionFrequency === "every_x"}
          <div class="bds-toggle-row" style="flex-direction: column; align-items: flex-start; gap: 6px; padding-left: 12px; border-left: 2px solid rgba(255, 255, 255, 0.1); margin-left: 4px;">
            <span class="bds-toggle-label">{t('settings.injectionInterval')}</span>
            <input id="bds-injection-interval" type="number" min="2" class="bds-input" style="width: 100px; box-sizing: border-box;" bind:value={systemPromptInjectionInterval} />
            <p style="font-size: 10px; opacity: 0.5; margin: 0;">
              {t('settings.injectEveryN', { n: systemPromptInjectionInterval })}
            </p>
          </div>
        {/if}
      </div>
    </div>
    {/if}

    {#if isSectionMatch('subResearch')}
    <button type="button" class="bds-sub-toggle" class:open={subResearchOpen} data-bds-section="subResearch" onclick={() => subResearchOpen = !subResearchOpen} aria-expanded={subResearchOpen}>
      {t('settings.subResearch')}
      <span class="bds-chevron">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>
    <div class="bds-sub-content" class:open={subResearchOpen}>
      <div class="bds-sub-inner">
        <div class="bds-toggle-row" style="flex-direction: column; align-items: flex-start; gap: 6px;">
          <span class="bds-toggle-label">Deep Fetch per Search</span>
          <input id="bds-deep-research-deep-fetch" type="number" min="0" max="5" step="1" class="bds-input" style="width: 80px; box-sizing: border-box;" bind:value={deepResearchDeepFetch} />
          <p style="font-size: 10px; opacity: 0.5; margin: 0;">
            How many top search results Deep Research opens and adds as page evidence for each search step. Higher values improve source detail but spend context fast and may stop long runs earlier. Use 0 for results only, 1 for long research, 3+ for short high-detail runs.
          </p>
        </div>

        <div class="bds-toggle-row" style="flex-direction: column; align-items: flex-start; gap: 6px;">
          <span class="bds-toggle-label">{t('settings.searchProviders')}</span>
          <div class="bds-search-provider-list" role="list">
            {#each searchProviderRows as row, index (row.id)}
              <div class="bds-search-provider-row" role="listitem">
                <label class="bds-search-provider-label">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    disabled={row.enabled && activeSearchProviderCount <= 1}
                    onchange={() => toggleSearchProvider(row)}
                  />
                  <span>{t(row.labelKey)}</span>
                </label>
                <span class="bds-search-provider-controls">
                  <button
                    type="button"
                    class="bds-search-provider-move"
                    aria-label={t('settings.providerMoveUp')}
                    title={t('settings.providerMoveUp')}
                    disabled={index === 0 || searchProviderRows[index - 1].enabled !== row.enabled}
                    onclick={() => moveSearchProvider(index, -1)}
                  >↑</button>
                  <button
                    type="button"
                    class="bds-search-provider-move"
                    aria-label={t('settings.providerMoveDown')}
                    title={t('settings.providerMoveDown')}
                    disabled={index === searchProviderRows.length - 1 || searchProviderRows[index + 1].enabled !== row.enabled}
                    onclick={() => moveSearchProvider(index, 1)}
                  >↓</button>
                </span>
              </div>
            {/each}
          </div>
          <p style="font-size: 10px; opacity: 0.5; margin: 0;">{t('settings.searchProvidersHint')}</p>
        </div>

        <div class="bds-toggle-row" style="flex-direction: column; align-items: flex-start; gap: 6px;">
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 12px;">
            <span class="bds-toggle-label">{t('settings.contextGuardEnabled')}</span>
            <label class="bds-switch">
              <input id="bds-context-guard-enabled" type="checkbox" bind:checked={deepResearchContextGuardEnabled} />
              <span class="bds-switch-track"></span>
            </label>
          </div>
          <p style="font-size: 10px; opacity: 0.5; margin: 0;">
            {t('settings.contextGuardEnabledHint')}
          </p>
        </div>

        {#if deepResearchContextGuardEnabled}
          <div class="bds-toggle-row" style="flex-direction: column; align-items: flex-start; gap: 6px;">
            <span class="bds-toggle-label">{t('settings.contextGuardLimit')}</span>
            <input id="bds-context-guard-limit" type="number" min="16000" max="1000000" step="1000" class="bds-input" style="width: 140px; box-sizing: border-box;" bind:value={deepResearchContextLimitTokens} />
            <p style="font-size: 10px; opacity: 0.5; margin: 0;">
              {t('settings.contextGuardLimitHint')}
            </p>
          </div>

          <div class="bds-toggle-row">
            <span class="bds-toggle-label">{t('settings.contextGuardStopPercent')}</span>
            <div class="bds-slider-group">
              <input type="range" min="50" max="95" step="1" bind:value={deepResearchContextStopPercent} class="bds-slider" />
              <span class="bds-slider-value">{deepResearchContextStopPercent}%</span>
            </div>
          </div>
          <p style="font-size: 10px; opacity: 0.5; margin: -4px 0 8px; padding-left: 0;">
            {t('settings.contextGuardStopPercentHint', { threshold: Math.floor(deepResearchContextLimitTokens * deepResearchContextStopPercent / 100).toLocaleString() })}
          </p>
        {/if}
      </div>
    </div>
    {/if}

    {#if isSectionMatch('subVoice')}
    <button type="button" class="bds-sub-toggle" class:open={subVoiceOpen} data-bds-section="subVoice" onclick={() => subVoiceOpen = !subVoiceOpen} aria-expanded={subVoiceOpen}>
      {t('settings.subVoice')}
      <span class="bds-chevron">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>
    <div class="bds-sub-content" class:open={subVoiceOpen}>
      <div class="bds-sub-inner">
        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.voiceMode')}</span>
          <label class="bds-switch">
            <input id="bds-voice-mode" type="checkbox" bind:checked={voiceMode} />
            <span class="bds-switch-track"></span>
          </label>
        </div>

        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.autoSubmitVoice')}</span>
          <label class="bds-switch">
            <input id="bds-voice-autosubmit" type="checkbox" bind:checked={autoSubmitVoice} />
            <span class="bds-switch-track"></span>
          </label>
        </div>

        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.speechLanguage')}</span>
          <select class="bds-select" bind:value={voiceLanguage}>
            <option value="en-US">English (US)</option>
            <option value="en-GB">English (UK)</option>
            <option value="tr-TR">Türkçe (TR)</option>
            <option value="de-DE">Deutsch (DE)</option>
            <option value="ru-RU">Русский (RU)</option>
            <option value="fr-FR">Français (FR)</option>
            <option value="es-ES">Español (ES)</option>
            <option value="it-IT">Italiano (IT)</option>
            <option value="zh-CN">简体中文 (CN)</option>
            <option value="ja-JP">日本語 (JP)</option>
          </select>
        </div>

        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.vadSilenceTimeout')}</span>
          <div class="bds-slider-group">
            <input type="range" min="500" max="3000" step="100" bind:value={vadSilenceTimeout} class="bds-slider" />
            <span class="bds-slider-value">{(vadSilenceTimeout / 1000).toFixed(1)}s</span>
          </div>
        </div>
      </div>
    </div>
    {/if}

    {#if isSectionMatch('subIntegrations')}
    <button type="button" class="bds-sub-toggle" class:open={subIntegrationsOpen} data-bds-section="subIntegrations" onclick={() => subIntegrationsOpen = !subIntegrationsOpen} aria-expanded={subIntegrationsOpen}>
      {t('settings.subIntegrations')}
      <span class="bds-chevron">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>
    <div class="bds-sub-content" class:open={subIntegrationsOpen}>
      <div class="bds-sub-inner">
        <div class="bds-toggle-row" style="flex-direction: column; align-items: flex-start; gap: 6px;">
          <span class="bds-toggle-label">{t('settings.markdownMaxDepth')}</span>
          <input id="bds-html-md-depth" type="number" min="10" step="10" class="bds-input" style="width: 120px; box-sizing: border-box;" bind:value={htmlToMarkdownMaxDepth} />
          <p style="font-size: 10px; opacity: 0.5; margin: 0;">
            {t('settings.markdownMaxDepthHint')}
          </p>
        </div>

        <div class="bds-toggle-row" style="flex-direction: column; align-items: flex-start; gap: 8px;">
          <span class="bds-toggle-label">{t('settings.githubToken')}</span>
          <div class="bds-token-field">
            <input id="bds-github-token" type="text" class="bds-input bds-token-text" style="width: 100%; box-sizing: border-box;" placeholder={t('settings.githubTokenPlaceholder')} value={getGithubTokenDisplayValue()} readonly={!showGithubToken} oninput={(e) => { if (showGithubToken) { githubToken = e.currentTarget.value; } }} autocomplete="off" autocapitalize="off" spellcheck="false" />
            <div class="bds-token-actions">
              <button type="button" class="bds-btn-outlined bds-token-btn" onclick={() => (showGithubToken = !showGithubToken)}>
                {showGithubToken ? t('settings.githubTokenHide') : t('settings.githubTokenShow')}
              </button>
              <button type="button" class="bds-btn-outlined bds-token-btn" onclick={() => { githubToken = ""; showGithubToken = true; }} disabled={!githubToken}>
                {t('settings.githubTokenClear')}
              </button>
            </div>
          </div>
          <p class="bds-token-help">
            {t('settings.githubTokenHelp')}
          </p>
        </div>

        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.tokenPriceEstimation')}</span>
          <label class="bds-switch">
            <input id="bds-token-price" type="checkbox" bind:checked={tokenPriceDisplay} />
            <span class="bds-switch-track"></span>
          </label>
        </div>
        <p style="font-size: 10px; opacity: 0.5; margin: -8px 0 8px; padding-left: 0;">
          {t('settings.tokenPriceHint')}
        </p>

        <div class="bds-toggle-row">
          <span class="bds-toggle-label">{t('settings.showTimestamps')}</span>
          <label class="bds-switch">
            <input id="bds-show-timestamps" type="checkbox" bind:checked={showTimestamps} />
            <span class="bds-switch-track"></span>
          </label>
        </div>
        <p style="font-size: 10px; opacity: 0.5; margin: -8px 0 8px; padding-left: 0;">
          {t('settings.showTimestampsHint')}
        </p>
      </div>
    </div>
    {/if}

    {#if isSectionMatch('subCSS')}
    <button type="button" class="bds-sub-toggle" class:open={subCSSOpen} data-bds-section="subCSS" onclick={() => subCSSOpen = !subCSSOpen} aria-expanded={subCSSOpen}>
      {t('settings.subCSS')}
      <span class="bds-chevron">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>
    <div class="bds-sub-content" class:open={subCSSOpen}>
      <div class="bds-sub-inner">
        <div class="bds-toggle-row" style="flex-direction: column; align-items: stretch; gap: 0;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
            {#if editingSnippetId}
              {@const activeSnippet = appState.cssSnippets.find(s => s.id === editingSnippetId)}
              {#if activeSnippet}
                {@const displayName = activeSnippet.name.startsWith('preset') ? t('settings.' + activeSnippet.name) : activeSnippet.name}
                <div class="bds-editing-badge">
                  <span>{t('settings.editingSnippet', { name: displayName })}</span>
                  <button type="button" class="bds-exit-edit-btn" onclick={cancelEditSnippet}>
                    {t('settings.exitEditMode')} ×
                  </button>
                </div>
              {/if}
            {/if}
          </div>
          <textarea class="bds-input bds-css-editor" spellcheck="false" bind:value={customCSS} placeholder={t('settings.customCSSPlaceholder')}></textarea>
          <div class="bds-css-toolbar" class:open={isSnippetsOpen}>
            <button type="button" class="bds-css-toggle-btn" class:active={isSnippetsOpen} onclick={() => isSnippetsOpen = !isSnippetsOpen}>
              <svg class="bds-snippets-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
              <span>{t('settings.manageSnippets')}</span>
              {#if activeSnippetsCount > 0}
                <span class="bds-snippets-badge">{activeSnippetsCount}</span>
              {/if}
              <svg class="bds-chevron {isSnippetsOpen ? 'bds-chevron-rotated' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            <button type="button" class="bds-btn-outlined bds-save-snippet-btn" disabled={!customCSS || !customCSS.trim()} onclick={editingSnippetId ? updateSnippet : saveAsSnippet}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              {editingSnippetId ? t('settings.updateSnippet') : t('settings.saveAsSnippet')}
            </button>
          </div>
          <SnippetList bind:this={snippetListRef} bind:isOpen={isSnippetsOpen} onedit={editSnippet} />
        </div>
      </div>
    </div>
    {/if}

    {#if isSectionMatch('subMcp')}
    <button type="button" class="bds-sub-toggle" class:open={subMcpOpen} data-bds-section="subMcp" onclick={() => subMcpOpen = !subMcpOpen} aria-expanded={subMcpOpen}>
      {t('mcp.sectionTitle')}
      <span class="bds-chevron">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>
    <div class="bds-sub-content" class:open={subMcpOpen}>
      <div class="bds-sub-inner">
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
      </div>
    </div>
    {/if}

    {#if isSectionMatch('subUtilities')}
    <button type="button" class="bds-sub-toggle" class:open={subUtilitiesOpen} data-bds-section="subUtilities" onclick={() => subUtilitiesOpen = !subUtilitiesOpen} aria-expanded={subUtilitiesOpen}>
      {t('settings.subUtilities')}
      <span class="bds-chevron">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>
    <div class="bds-sub-content" class:open={subUtilitiesOpen}>
      <div class="bds-sub-inner">
        <div class="bds-toggle-row" role="button" tabindex="0" onclick={onapiplayground} onkeydown={(e) => e.key === 'Enter' && onapiplayground?.()} style="cursor: pointer;">
          <span class="bds-toggle-label">API Playground</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </div>

        <div class="bds-toggle-row">
          <div>
            <span class="bds-toggle-label">{t('settings.disableTipBox')}</span>
            <p style="font-size: 10px; opacity: 0.5; margin: 2px 0 0;">{t('settings.disableTipBoxHint')}</p>
          </div>
          <label class="bds-switch">
            <input type="checkbox" bind:checked={disableTipBox} />
            <span class="bds-switch-track"></span>
          </label>
        </div>

        <div class="bds-export-section">
          <span>{t('drawer.exportAll')} / {t('drawer.importAll')}</span>
          <div class="bds-export-buttons">
            <button type="button" class="bds-btn-outlined" onclick={openExportAllModal}>
              {t('drawer.exportAll')}
            </button>
            <button type="button" class="bds-btn-outlined" onclick={triggerImportAll}>
              {t('drawer.importAll')}
            </button>
            <input type="file" accept=".json" style="display: none;" bind:this={importAllFileInput} onchange={handleImportAll} />
          </div>
        </div>
      </div>
    </div>
    {/if}
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
          <label class="bds-label" for="bds-mcp-editor-name">{t('mcp.nameLabel')}</label>
          <input id="bds-mcp-editor-name" type="text" class="bds-input" bind:value={mcpEditorName} placeholder={t('mcp.namePlaceholder')} />
        </div>
        <div class="bds-field">
          <label class="bds-label" for="bds-mcp-editor-url">{t('mcp.serverUrlLabel')}</label>
          <input id="bds-mcp-editor-url" type="url" class="bds-input" bind:value={mcpEditorUrl} placeholder={t('mcp.serverUrlPlaceholder')} />
        </div>
        <div class="bds-field">
          <label class="bds-label" for="bds-mcp-editor-key">{t('mcp.apiKeyLabel')}</label>
          <input id="bds-mcp-editor-key" type="password" class="bds-input" bind:value={mcpEditorApiKey} placeholder={t('mcp.apiKeyPlaceholder')} />
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
<button id="bds-save-plugins" type="button" onclick={save}>
  {t('settings.save')}
</button>

{#if showExportAllModal}
  <div class="bds-modal-overlay" role="dialog" onclick={closeExportAllModal}>
    <div class="bds-modal" role="document" onclick={(e) => e.stopPropagation()}>
      <div class="bds-modal-header">
        <span>{t('drawer.exportAll')}</span>
        <button class="bds-modal-close" onclick={closeExportAllModal}>×</button>
      </div>
      <div class="bds-modal-body">
        <label class="bds-modal-check">
          <input type="checkbox" bind:checked={exportEncrypt} />
          <span>{t('drawer.exportEncrypt')}</span>
        </label>
        {#if exportEncrypt}
          <input type="password" class="bds-input" placeholder={t('drawer.enterPassword')} bind:value={exportPassword} />
          <input type="password" class="bds-input" placeholder={t('drawer.confirmPassword')} bind:value={exportPasswordConfirm} />
        {/if}
        {#if exportPasswordError}
          <span class="bds-modal-error">{exportPasswordError}</span>
        {/if}
      </div>
      <div class="bds-modal-footer">
        <button type="button" class="bds-btn-outlined" onclick={closeExportAllModal}>{t('cancel')}</button>
        <button type="button" class="bds-btn" disabled={isExporting} onclick={doExportAll}>
          {isExporting ? t('exporting') : t('drawer.download')}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showSaveSnippetModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="bds-modal-overlay" role="dialog" onclick={() => showSaveSnippetModal = false} style="z-index: 10002;">
    <div class="bds-modal" role="document" onclick={(e) => e.stopPropagation()} style="max-width: 320px;">
      <div class="bds-modal-header">
        <span>{t('settings.saveAsSnippet')}</span>
        <button class="bds-modal-close" onclick={() => showSaveSnippetModal = false}>×</button>
      </div>
      <div class="bds-modal-body" style="padding-top: 12px; padding-bottom: 12px;">
        <div class="bds-field">
          <label class="bds-label" for="bds-snippet-name-input" style="margin-bottom: 4px;">{t('settings.nameLabel')}</label>
          <input
            id="bds-snippet-name-input"
            type="text"
            class="bds-input"
            bind:value={newSnippetName}
            placeholder={t('settings.namePlaceholder')}
            autofocus
            onkeydown={(e) => e.key === 'Enter' && submitSaveSnippet()}
          />
          {#if saveSnippetError}
            <span class="bds-modal-error" style="margin-top: 4px;">{saveSnippetError}</span>
          {/if}
        </div>
      </div>
      <div class="bds-modal-footer">
        <button type="button" class="bds-btn-outlined" onclick={() => showSaveSnippetModal = false}>{t('cancel')}</button>
        <button type="button" class="bds-btn" onclick={submitSaveSnippet}>{t('settings.savePrompt')}</button>
      </div>
    </div>
  </div>
{/if}

{#if showImportPasswordModal}
  <div class="bds-modal-overlay" role="dialog" onclick={closeImportPasswordModal}>
    <div class="bds-modal" role="document" onclick={(e) => e.stopPropagation()}>
      <div class="bds-modal-header">
        <span>{t('drawer.enterPassword')}</span>
        <button class="bds-modal-close" onclick={closeImportPasswordModal}>×</button>
      </div>
      <div class="bds-modal-body">
        <input type="password" class="bds-input" placeholder={t('drawer.importPasswordPlaceholder')} bind:value={importPassword} />
        {#if importPasswordError}
          <span class="bds-modal-error">{importPasswordError}</span>
        {/if}
      </div>
      <div class="bds-modal-footer">
        <button type="button" class="bds-btn-outlined" onclick={closeImportPasswordModal}>{t('cancel')}</button>
        <button type="button" class="bds-btn" disabled={isImporting} onclick={doDecryptAndShow}>
          {isImporting ? t('importing') : t('drawer.decrypt')}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showImportSelectModal}
  <div class="bds-modal-overlay" role="dialog" onclick={closeImportSelectModal}>
    <div class="bds-modal" role="document" onclick={(e) => e.stopPropagation()}>
      <div class="bds-modal-header">
        <span>{t('drawer.selectSections')}</span>
        <button class="bds-modal-close" onclick={closeImportSelectModal}>×</button>
      </div>
      <div class="bds-modal-body">
        {#each EXPORT_SECTIONS as section}
          <label class="bds-modal-check">
            <input type="checkbox" checked={selectedSections.has(section.key)} onchange={() => toggleSection(section.key)} />
            <span>{section.label}</span>
          </label>
        {/each}
      </div>
      <div class="bds-modal-footer">
        <button type="button" class="bds-btn-outlined" onclick={closeImportSelectModal}>{t('cancel')}</button>
        <button type="button" class="bds-btn" disabled={isImporting || selectedSections.size === 0} onclick={doImportAll}>
          {isImporting ? t('importing') : t('drawer.importBtn')}
        </button>
      </div>
    </div>
  </div>
{/if}
</div>
</div>
