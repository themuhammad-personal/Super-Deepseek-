<script>
  /**
   * BDS drawer — opened from the sidebar account/profile menu (BDS-UI F.4).
   *
   * It hosts the two physically separated settings systems:
   *   · settings/AdvancedSettings.svelte  — System Prompts + Skill Set
   *   · settings/PluginsSettings.svelte   — the ten feature subsections incl. MCP
   * plus the skill / character / memory / project / saved-item sections, the
   * relocated commands area and the relocated Get BDS App / What's New entries.
   */
  import { tick } from "svelte";
  import AdvancedSettings from "./settings/AdvancedSettings.svelte";
  import PluginsSettings from "./settings/PluginsSettings.svelte";
  import CharacterList from "./CharacterList.svelte";
  import MemoryList from "./MemoryList.svelte";
  import ProjectsManager from "./ProjectsManager.svelte";
  import ProjectsCard from "./ProjectsCard.svelte";
  import SavedItems from "./SavedItems.svelte";
  import CommandManager from "../commands/CommandManager.svelte";
  import DeepCodeToggle from "./DeepCodeToggle.svelte";
  import { COMMANDS } from "../commands/registry.js";
  import { insertCommandIntoChat } from "../commands/insert-command.js";
  import { setDeepCodeEnabled } from "../deep-code.js";
  import appState from "../state.js";
  import { i18n, t } from "../../lib/i18n.svelte.js";
  import { getExtensionVersion } from "../../lib/extension-version.js";
  import { scrollIntoViewSafe } from "./scroll-into-view.js";

  let { open = false, onclose, onopenapiplayground } = $props();

  // Resolved from the running manifest, so this never needs a manual bump.
  const extensionVersion = getExtensionVersion();

  // Same destination the account-menu entry used before it moved here.
  const GET_BDS_APP_URL = "https://github.com/EdgeTypE/better-deepseek/releases";

  // BDS-UI E.1 / J: the composer-side `BDS_TARGET === "android"` skip branch
  // moved here together with the DeepCode toggle. The WebView has no DeepSeek
  // Harness bridge, so Android keeps seeing one DeepCode control fewer — the
  // section is simply not rendered there, exactly like the old composer icon.
  // TODO(BDS-UI): revisit if the Android build ever ships the harness bridge.
  const showDeepCodeSection = (process.env.BDS_TARGET || "chrome") !== "android";

  let TIP_COUNT = $derived.by(() => {
    const tips = i18n.messages?.messages?.tips;
    return tips ? Object.keys(tips).filter((k) => /^\d+$/.test(k)).length : 0;
  });
  let currentTipIndex = $state(-1);
  let disableTipBox = $state(Boolean(appState.settings.disableTipBox));

  function handleSettingsSaved() {
    disableTipBox = Boolean(appState.settings.disableTipBox);
  }

  $effect(() => {
    disableTipBox = Boolean(appState.settings.disableTipBox);
    if (open && !disableTipBox && TIP_COUNT > 0) {
      queueMicrotask(() => {
        currentTipIndex = Math.floor(Math.random() * TIP_COUNT);
      });
    } else {
      currentTipIndex = -1;
    }
  });

  function openApiPlayground() {
    onclose();
    onopenapiplayground();
  }

  let advancedRef = $state(null);
  let pluginsRef = $state(null);
  let charactersRef = $state(null);
  let memoryRef = $state(null);
  let projectsManagerRef = $state(null);
  let savedItemsRef = $state(null);
  // BDS-UI F.2: commands are no longer a primary drawer section — the upload
  // drawer's Command card is the main entry point and the full list/manager
  // only appears when explicitly requested (openDrawerSection("commands")).
  let showCmdManager = $state(false);
  let showCommandsPanel = $state(false);

  let showProjectsManager = $state(false);

  export function refreshSettings() {
    if (advancedRef) advancedRef.refresh();
    if (pluginsRef) pluginsRef.refresh();
  }
  export function refreshCharacters() {
    if (charactersRef) charactersRef.refresh();
  }
  export function refreshSkills() {
    // The Skill Set lives inside AdvancedSettings since the Round-2 scope fix.
    if (advancedRef) advancedRef.refreshSkills();
  }
  export function refreshMemories() {
    if (memoryRef) memoryRef.refresh();
  }
  export function refreshProjects() {
    if (projectsManagerRef) projectsManagerRef.refresh();
    if (pluginsRef) pluginsRef.refreshProject();
  }
  export function refreshSavedItems() {
    if (savedItemsRef) savedItemsRef.refresh();
  }
  export function refreshCssSnippets() {
    if (pluginsRef) pluginsRef.refreshCssSnippets();
  }

  function openProjectsManager() {
    showProjectsManager = true;
  }

  function closeProjectsManager() {
    showProjectsManager = false;
  }

  function insertCommand(cmdId) {
    insertCommandIntoChat(cmdId);
    onclose();
  }

  // ── Drawer section navigation (BDS-UI openDrawerSection / scrollToSection) ──

  const SECTION_TARGETS = {
    advanced: "bds-settings-advanced",
    settings: "bds-settings-advanced",
    plugins: "bds-settings-plugins",
    mcp: "bds-settings-plugins",
    commands: "bds-section-commands",
    deepcode: "bds-section-deepcode",
    skills: "bds-section-skills", // inside AdvancedSettings
    characters: "bds-section-characters",
    memories: "bds-section-memories",
    projects: "bds-section-projects",
    saved: "bds-section-saved",
    savedItems: "bds-section-saved",
  };

  /** Scrolls the drawer body to a named section. */
  export function scrollToSection(section) {
    const id = SECTION_TARGETS[section];
    if (!id) return;
    scrollIntoViewSafe(document.getElementById(id));
  }

  /**
   * Reveals and scrolls to a named section. Called by the account-menu entries
   * (Plugins / Advanced Settings) and by the upload drawer's Command card.
   */
  export async function openDrawerSection(section) {
    if (section === "projects") {
      showProjectsManager = true;
      return;
    }
    showProjectsManager = false;
    if (section === "commands") {
      // BDS-UI F.2: the command manager is its own panel inside the drawer;
      // the advanced settings no longer host a Commands section.
      showCommandsPanel = true;
    }
    await tick();
    scrollToSection(section);
  }

  export async function handleClose() {
    const guards = [advancedRef, pluginsRef].filter((ref) => ref && ref.checkBeforeClose);
    for (const ref of guards) {
      const ok = await ref.checkBeforeClose();
      if (!ok) return;
    }
    onclose();
  }
</script>

<aside id="bds-drawer" class={open ? "bds-open" : "bds-closed"}>
  <div class="bds-drawer-header">
    <div class="ds-modal-content__title">{t("drawer.title")}</div>
    <button
      id="bds-close"
      type="button"
      onclick={handleClose}
      aria-label={t("drawer.close")}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M14.1871 13.1265L13.1265 14.1872L1.81275 2.87347L2.87341 1.81281L14.1871 13.1265Z"
          fill="currentColor"
        ></path>
        <path
          d="M13.1265 1.81282L14.1871 2.87348L2.8734 14.1872L1.81274 13.1265L13.1265 1.81282Z"
          fill="currentColor"
        ></path>
      </svg>
    </button>
  </div>

  {#if showProjectsManager}
    <div class="bds-projects-body">
      <ProjectsManager
        bind:this={projectsManagerRef}
        onback={closeProjectsManager}
      />
    </div>
  {:else}
    <div class="bds-drawer-body">
      <AdvancedSettings bind:this={advancedRef} onsave={handleSettingsSaved} />

      <hr />

      <PluginsSettings
        bind:this={pluginsRef}
        onsave={handleSettingsSaved}
        onapiplayground={openApiPlayground}
        onimportdata={() => {
          refreshSettings();
          refreshSkills();
          refreshCharacters();
          refreshMemories();
          refreshProjects();
          refreshSavedItems();
        }}
      />

      <hr />

      <div class="bds-drawer-section" id="bds-section-characters">
        <CharacterList bind:this={charactersRef} />
      </div>

      <hr />

      <div class="bds-drawer-section" id="bds-section-memories">
        <MemoryList bind:this={memoryRef} />
      </div>

      <hr />

      <div class="bds-drawer-section" id="bds-section-projects">
        <ProjectsCard onmanage={openProjectsManager} />
      </div>

      <hr />

      <div class="bds-drawer-section" id="bds-section-saved">
        <SavedItems bind:this={savedItemsRef} />
      </div>

      <hr />

      {#if showDeepCodeSection}
      <!-- DeepCode (BDS-UI E.1): the composer row is locked to five icons, so
           the DeepCode toggle lives here — same component, same state, same
           harness bridge, only the host surface changed. -->
      <div class="bds-drawer-section" id="bds-section-deepcode">
        <div class="bds-section-title">
          <span class="bds-icon-inline">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><polyline points="16 18 22 12 16 6"></polyline><polyline
                points="8 6 2 12 8 18"
              ></polyline></svg
            >
          </span>
          <span>{t("drawer.sectionDeepCode")}</span>
        </div>
        <p class="bds-drawer-section-hint">{t("drawer.deepCodeHint")}</p>
        <div class="bds-deep-code-host">
          <DeepCodeToggle
            enabled={appState.deepCode.enabled}
            onToggle={(enabled) => setDeepCodeEnabled(enabled)}
            onOpenModal={() => window.dispatchEvent(new CustomEvent("bds:open-deep-code-modal"))}
          />
        </div>
      </div>

      <hr />
      {/if}

      <!-- Commands (BDS-UI F.2): collapsed by default; the upload drawer's
           Command card is the primary entry point. -->
      <div class="bds-drawer-section" id="bds-section-commands">
        <div class="bds-section-title">
          <div
            style="display: flex; align-items: center; justify-content: space-between; width: 100%;"
          >
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="bds-icon-inline">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><polygon
                    points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"
                  /></svg
                >
              </span>
              <span>{t("commands.title")}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button
                type="button"
                class="bds-btn-outlined"
                style="font-size:11px;padding:3px 7px;"
                onclick={() => (showCommandsPanel = !showCommandsPanel)}
              >
                {showCommandsPanel ? t("commands.done") : t("commands.helpTitle")}
              </button>
              <button
                type="button"
                class="bds-btn-outlined"
                style="font-size:11px;padding:3px 7px;"
                onclick={() => (showCmdManager = !showCmdManager)}
              >
                {showCmdManager ? t("commands.done") : t("commands.manage")}
              </button>
            </div>
          </div>
        </div>
        {#if showCommandsPanel && !showCmdManager}
          <div class="bds-featured-list">
            <h4>{t("commands.builtinCommands")}</h4>
            {#each COMMANDS as cmd (cmd.id)}
              <button
                type="button"
                class="bds-featured-item"
                onclick={() => insertCommand(cmd.id)}
              >
                <span class="bds-cmd-icon">{@html cmd.icon}</span>
                <span class="bds-cmd-info">
                  <span class="bds-cmd-name">/{cmd.id}</span>
                  <span class="bds-cmd-desc">{t(cmd.descKey)}</span>
                </span>
                <span class="bds-cmd-usage">{t(cmd.usageKey)}</span>
              </button>
            {/each}
          </div>
        {/if}
        {#if showCmdManager}
          <CommandManager onclose={() => (showCmdManager = false)} />
        {/if}
      </div>
    </div>

    <div class="bds-drawer-bottom">
      {#if TIP_COUNT > 0 && !disableTipBox && currentTipIndex >= 0}
        <div class="bds-tip-bar">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M9 18h6" /><path d="M10 22h4" /><path
              d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"
            /></svg
          >
          <span>{@html t("tips." + currentTipIndex)}</span>
        </div>
      {/if}
      <div class="bds-drawer-footer">
        <!-- BDS-UI F.5 (Conflict 4): Get BDS App and What's New moved out of the
             account popover and live next to the GitHub link instead. -->
        <div class="bds-drawer-footer-actions">
          <button
            type="button"
            id="bds-get-app-entry"
            class="bds-drawer-footer-action"
            onclick={() => window.open(GET_BDS_APP_URL, "_blank")}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline
                points="7 10 12 15 17 10"
              /><line x1="12" y1="15" x2="12" y2="3" /></svg
            >
            {t("drawer.getBdsApp")}
          </button>
          <button
            type="button"
            id="bds-whats-new-entry"
            class="bds-drawer-footer-action"
            onclick={() => {
              appState.whatsNewPending = true;
              if (appState.ui) appState.ui.refreshWhatsNew();
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><path d="M12 2l2.4 5.2 5.6.7-4.1 3.9 1.1 5.6L12 14.8 6.9 17.4l1.1-5.6L3.9 7.9l5.6-.7z" /></svg
            >
            {t("drawer.whatsNew")}
          </button>
        </div>
        <a
          href="https://github.com/EdgeTypE/better-deepseek"
          target="_blank"
          rel="noopener noreferrer"
          class="bds-github-link"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
            ></path>
          </svg>
          <span
            >{t("drawer.github")}
            <small style="opacity: 0.6; font-weight: 400; margin-left: 4px;"
              >{t("drawer.version", { version: extensionVersion })}</small
            ></span
          >
        </a>
      </div>
    </div>
  {/if}
</aside>
