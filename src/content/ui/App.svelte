<script>
  import { tick } from "svelte";
  import Drawer from "./Drawer.svelte";
  import ToastStack from "./ToastStack.svelte";
  import QuestionPanel from "./QuestionPanel.svelte";
  import QueuePanel from "./QueuePanel.svelte";
  import DeepResearchRevisionPanel from "./DeepResearchRevisionPanel.svelte";
  import WhatsNewModal from "./WhatsNewModal.svelte";
  import SelectionOverlay from "./SelectionOverlay.svelte";
  import StatusBanner from "./StatusBanner.svelte";
  import AnnouncementBanner from "./AnnouncementBanner.svelte";
  import PreviewPanel from "./PreviewPanel.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import DeepCodeModal from "./DeepCodeModal.svelte";
  import ApiPlayground from "../api-playground/ApiPlayground.svelte";
  import appState from "../state.js";

  let drawerOpen = $state(false);
  let apiPlaygroundOpen = $state(false);
  let deepCodeModalOpen = $state(false);
  let whatsNewPending = $state(appState.whatsNewPending);

  let previewVisible = $state(false);
  let previewTitle = $state("");
  let previewContent = $state("");

  /** @type {Array<{id: number, message: string}>} */
  let toasts = $state([]);
  let toastId = 0;

  let confirmVisible = $state(false);
  let confirmMessage = $state("");
  let confirmResolve = null;

  export function showConfirm(message) {
    return new Promise((resolve) => {
      confirmResolve = resolve;
      confirmMessage = message;
      confirmVisible = true;
    });
  }

  function handleConfirm(result) {
    confirmVisible = false;
    confirmMessage = "";
    if (confirmResolve) {
      confirmResolve(result);
      confirmResolve = null;
    }
  }

  // ── Public API (called from non-Svelte code via mount.js) ──

  export function showToast(message, duration = 2880) {
    const id = ++toastId;
    toasts = [...toasts, { id, message }];

    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
    }, duration);
  }

  export function showLongWorkOverlay(_visible) {}

  // Settings/skills/memories refresh — forwarded to Drawer
  let drawerRef = $state(null);

  export function refreshSettings() {
    if (drawerRef) drawerRef.refreshSettings();
  }
  export function refreshSkills() {
    if (drawerRef) drawerRef.refreshSkills();
  }
  export function refreshCharacters() {
    if (drawerRef) drawerRef.refreshCharacters();
  }
  export function refreshMemories() {
    if (drawerRef) drawerRef.refreshMemories();
  }
  export function refreshProjects() {
    if (drawerRef) drawerRef.refreshProjects();
    if (appState.heroBarRef) appState.heroBarRef.refresh();
  }
  export function refreshSavedItems() {
    if (drawerRef) drawerRef.refreshSavedItems();
  }
  export function refreshCssSnippets() {
    if (drawerRef) drawerRef.refreshCssSnippets();
  }

  export function refreshWhatsNew() {
    whatsNewPending = appState.whatsNewPending;
  }

  export function showPreviewPanel(title, content) {
    previewTitle = title;
    previewContent = content;
    previewVisible = true;
  }

  export function hidePreviewPanel() {
    previewVisible = false;
    previewTitle = "";
    previewContent = "";
  }

  /**
   * Opens the BDS drawer. The floating top trigger was removed (BDS-UI F.4) —
   * the drawer is reached from the sidebar account menu, which calls
   * `openDrawerSection` below through the ui API.
   */
  export function openDrawer() {
    drawerOpen = true;
  }

  /** Opens the drawer and jumps to a named section (BDS-UI F.4 / F.5). */
  export async function openDrawerSection(section) {
    drawerOpen = true;
    await tick();
    if (drawerRef && drawerRef.openDrawerSection) {
      await drawerRef.openDrawerSection(section);
    }
  }

  /** Forwards a section scroll to the drawer (BDS-UI scrollToSection API). */
  export function scrollToSection(section) {
    if (drawerRef && drawerRef.scrollToSection) {
      drawerRef.scrollToSection(section);
    }
  }

  /** Called by the drawer once it decided it may close (unsaved checks ran there). */
  function closeDrawer() {
    drawerOpen = false;
  }

  function openApiPlayground() {
    apiPlaygroundOpen = true;
  }

  function closeApiPlayground() {
    apiPlaygroundOpen = false;
  }

  // Handle external selection mode toggle
  window.addEventListener("bds:toggleSelectionMode", () => {
    appState.selectionMode = true;
    drawerOpen = false;
  });

  window.addEventListener("bds:open-deep-code-modal", () => {
    deepCodeModalOpen = true;
  });
</script>

<!-- BDS-UI F.4: the floating top BDS Settings trigger was removed on purpose.
     The drawer opens from the sidebar account/profile menu (Plugins, Advanced
     Settings) which calls ui.openDrawerSection(section). -->

<Drawer bind:this={drawerRef} open={drawerOpen} onclose={closeDrawer} onopenapiplayground={openApiPlayground} />

{#if apiPlaygroundOpen}
  <ApiPlayground onclose={closeApiPlayground} />
{/if}

<DeepCodeModal
  show={deepCodeModalOpen}
  activeDirectory={appState.deepCode.activeDirectory}
  fileCount={appState.deepCode.fileCount}
  onclose={() => deepCodeModalOpen = false}
/>

<ToastStack {toasts} />
<QuestionPanel />
<QueuePanel />
<DeepResearchRevisionPanel />

{#if whatsNewPending}
  <WhatsNewModal onDismiss={() => whatsNewPending = false} />
{/if}

<SelectionOverlay />
<StatusBanner />
<AnnouncementBanner />
<PreviewPanel
  visible={previewVisible}
  title={previewTitle}
  content={previewContent}
  onclose={hidePreviewPanel}
/>

<ConfirmDialog
  show={confirmVisible}
  message={confirmMessage}
  onconfirm={() => handleConfirm(true)}
  oncancel={() => handleConfirm(false)}
/>
