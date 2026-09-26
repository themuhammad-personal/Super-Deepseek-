/**
 * DOM observation and page scanning.
 */

import state, { withObserverPaused, CHAT_OBSERVER_OPTIONS } from "./state.js";
import { LONG_WORK_STALE_MS } from "../lib/constants.js";
import { devLog } from "../lib/dev-log.js";
import {
  processMessageNode,
  disposeMessageNode,
  disposeDetachedMessageOverlays,
  isSystemGenerating,
  resetMessagePricing,
} from "./message-processor.svelte.js";
import { mount, unmount } from "svelte";
import AttachMenu from "./ui/AttachMenu.svelte";
import ExpandToggle from "./ui/ExpandToggle.svelte";
import RagPreview from "./ui/RagPreview.svelte";
import DeepResearchToggle from "./ui/DeepResearchToggle.svelte";
import { injectSearchInput } from "./ui/SidebarSearch.js";
import { checkPendingExport } from "./tools/pending-export.js";
import { hideTagsInSidebar, hideTagsInHeader, hideBdsTagsInPopovers } from "./tags/tag-hider.js";
import { injectShareDialogWarning } from "./dom/share-dialog-injector.js";
import { setDeepResearchEnabled } from "./deep-research.js";
import { loadDeepCodeState } from "./deep-code.js";
import { tryExecuteRawInput } from "./commands/executor.js";
import { isAndroidWebView } from "../lib/platform.js";
import { checkPendingHandoff } from "./commands/context-handoff.js";
import Autocomplete from "./commands/Autocomplete.svelte";
import CommandsHelp from "./commands/CommandsHelp.svelte";

// ── Incremental scan state ──
const dirtyNodes = new Set();
const removedNodes = new Set();
let pendingFullScan = false;
let previousLatestAssistant = null;
let previousAbsoluteLast = null;

/**
 * Ordered registry of known connected message nodes, seeded by full scans
 * and updated incrementally by observer additions/removals/reparents.
 * Avoids O(N) `collectMessageNodes()` DOM walks on every incremental flush.
 * @type {Element[]}
 */
let knownNodes = [];
let knownNodesInitialized = false;
let knownNodeIndexes = new WeakMap();
let knownLatestAssistant = null;

function rebuildKnownNodes(nodes) {
  knownNodes = nodes;
  knownNodesInitialized = true;
  knownNodeIndexes = new WeakMap();
  for (let index = 0; index < knownNodes.length; index += 1) {
    knownNodeIndexes.set(knownNodes[index], index);
  }
  knownLatestAssistant = findLatestAssistantMessageNode(knownNodes);
}

function updateKnownIndexes(startIndex) {
  for (let index = startIndex; index < knownNodes.length; index += 1) {
    knownNodeIndexes.set(knownNodes[index], index);
  }
}

function recomputeKnownLatestAssistant() {
  knownLatestAssistant = findLatestAssistantMessageNode(knownNodes);
}

function removeKnownNode(node) {
  let index = knownNodeIndexes.get(node);
  if (index === undefined) return false;
  if (knownNodes[index] !== node) {
    index = knownNodes.indexOf(node);
  }
  if (index === -1) return false;

  knownNodes.splice(index, 1);
  knownNodeIndexes.delete(node);
  updateKnownIndexes(index);
  if (knownLatestAssistant === node) recomputeKnownLatestAssistant();
  return true;
}

function findKnownInsertIndex(node) {
  let low = 0;
  let high = knownNodes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const position = knownNodes[middle].compareDocumentPosition(node);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) low = middle + 1;
    else high = middle;
  }
  return low;
}

function registerKnownNode(node) {
  if (!knownNodesInitialized || !document.contains(node)) return;

  const wasKnown = removeKnownNode(node);
  let index;
  const last = knownNodes[knownNodes.length - 1];
  if (!last || (last.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) {
    index = knownNodes.length;
    knownNodes.push(node);
    knownNodeIndexes.set(node, index);
  } else {
    index = findKnownInsertIndex(node);
    knownNodes.splice(index, 0, node);
    updateKnownIndexes(index);
  }

  if (wasKnown) {
    recomputeKnownLatestAssistant();
  } else if (
    detectMessageRole(node) === "assistant" &&
    (!knownLatestAssistant || index > (knownNodeIndexes.get(knownLatestAssistant) ?? -1))
  ) {
    knownLatestAssistant = node;
  }
}

let scanTimerArmedAt = 0;
const MAX_SCAN_WAIT_MS = 100;

// ── Internal: arm the shared debounce timer ──
function armScanTimer() {
  const now = Date.now();
  if (state.scanTimer) {
    // If a timer is already pending within the max wait window, let it run
    // rather than resetting indefinitely on rapid streaming token events.
    if (now - scanTimerArmedAt < MAX_SCAN_WAIT_MS) {
      return;
    }
    clearTimeout(state.scanTimer);
  }
  scanTimerArmedAt = now;
  state.scanTimer = window.setTimeout(() => {
    state.scanTimer = 0;
    scanTimerArmedAt = 0;
    scanPage();
  }, 60);
}

/**
 * Collect all message nodes from the chat DOM.
 */
export function collectMessageNodes() {
  const set = new Set();

  for (const node of document.querySelectorAll("div.ds-message._63c77b1")) {
    set.add(node);
  }

  if (!set.size) {
    for (const node of document.querySelectorAll("div.ds-message")) {
      set.add(node);
    }
  }

  return Array.from(set);
}

/**
 * Find the latest assistant message node.
 * Accepts an optional pre-collected nodes array to avoid redundant DOM walks.
 */
export function findLatestAssistantMessageNode(nodes) {
  const list = nodes || collectMessageNodes();
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const candidate = list[index];
    if (!candidate || candidate.closest("#bds-root")) {
      continue;
    }

    if (detectMessageRole(candidate) === "assistant") {
      return candidate;
    }
  }

  return null;
}

/**
 * Detect the role of a message DOM node.
 */
export function detectMessageRole(node) {
  if (node.classList && node.classList.contains("d29f3d7d")) {
    return "user";
  }

  if (node.closest("div._4f9bf79._43c05b5")) {
    return "assistant";
  }

  if (node.closest("div._9663006")) {
    return "user";
  }

  if (node.classList && node.classList.contains("ds-message")) {
    return "assistant";
  }

  const roleAttr = node.getAttribute("data-message-author-role");
  if (roleAttr) {
    return String(roleAttr).toLowerCase();
  }

  return "unknown";
}

/**
 * Check if a node is the absolute last message in the entire chat.
 * Accepts an optional pre-collected nodes array.
 */
export function isAbsoluteLastMessage(node, nodes) {
  const list = nodes || collectMessageNodes();
  return list[list.length - 1] === node;
}

/**
 * Check if a node is the latest assistant message.
 * Accepts an optional pre-collected nodes array.
 */
export function isLatestAssistantMessage(node, nodes) {
  return findLatestAssistantMessageNode(nodes) === node;
}

/**
 * Find the closest message ancestor for a given DOM node.
 * Returns null if the node is not inside a message.
 */
function closestMessageNode(target) {
  if (!target || target === document.body || target === document.documentElement) return null;
  const el = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
  if (!el || el.closest?.("#bds-root") || el.closest?.(".bds-host-wrapper")) return null;
  const msg = el.closest?.("div.ds-message");
  return msg && !msg.closest("#bds-root") ? msg : null;
}

/**
 * Set up a MutationObserver on the document body.
 * Collects dirty message nodes for incremental processing.
 * Arms the scan timer but never requests a full scan on its own.
 */
export function observeChatDom() {
  if (state.observer || !document.body) {
    return;
  }

  state.observer = new MutationObserver((records) => {
    let hasExternalMutation = false;

    for (const r of records) {
      const targetEl = r.target.nodeType === Node.ELEMENT_NODE ? r.target : r.target.parentElement;
      // Ignore records where the target itself is within #bds-root or a BDS host
      if (!targetEl || targetEl.closest?.("#bds-root") || targetEl.closest?.(".bds-host-wrapper")) continue;

      let recordHasExternal = false;

      // Collect removed message subtrees
      for (const removed of r.removedNodes) {
        if (removed.nodeType !== Node.ELEMENT_NODE) continue;
        if (removed.closest?.("#bds-root") || removed.closest?.(".bds-host-wrapper")) continue;

        recordHasExternal = true;

        const removedMessages = removed.classList?.contains("ds-message")
          ? [removed]
          : Array.from(removed.querySelectorAll?.("div.ds-message") || []);
        for (const rm of removedMessages) {
          if (!rm.closest?.("#bds-root")) {
            removedNodes.add(rm);
          }
        }
      }

      // Collect added/modified messages
      for (const added of r.addedNodes) {
        if (added.nodeType !== Node.ELEMENT_NODE) continue;
        if (added.closest?.("#bds-root") || added.closest?.(".bds-host-wrapper")) continue;

        recordHasExternal = true;

        if (added.classList?.contains("ds-message")) {
          dirtyNodes.add(added);
          registerKnownNode(added);
          continue;
        }

        const descendantMessages = added.querySelectorAll?.("div.ds-message");
        if (descendantMessages?.length) {
          for (const dm of descendantMessages) {
            if (!dm.closest?.("#bds-root")) {
              dirtyNodes.add(dm);
              registerKnownNode(dm);
            }
          }
        }
      }

      // For mutations without explicit message nodes (or characterData mutations), find closest message ancestor
      const target = r.target;
      if (target && target !== document.body) {
        const msg = closestMessageNode(target);
        if (msg) {
          recordHasExternal = true;
          dirtyNodes.add(msg);
        }
      }

      if (recordHasExternal) {
        hasExternalMutation = true;
      }
    }

    // Only arm the timer when at least one external mutation exists.
    // A batch wholly inside #bds-root produces no external record and
    // must not schedule a scan.
    if (hasExternalMutation) {
      armScanTimer();
    }
  });

  state.observer.observe(document.body, CHAT_OBSERVER_OPTIONS);
}

/**
 * Schedule targeted reprocessing of a single message node.
 * Coalesced under the same debounce timer. Never requests a full scan.
 */
export function scheduleMessageScan(node) {
  // Require a connected div.ds-message element. Non-message elements, text
  // nodes, detached nodes, and nodes inside #bds-root must not arm a scan.
  if (
    !node ||
    !(node instanceof Element) ||
    !node.classList?.contains("ds-message") ||
    !document.contains(node) ||
    node.closest?.("#bds-root")
  ) {
    return;
  }
  dirtyNodes.add(node);
  if (!knownNodesInitialized) rebuildKnownNodes(collectMessageNodes());
  registerKnownNode(node);
  armScanTimer();
}

/**
 * Schedule a full page scan. Explicit full-scan API for initialization,
 * settings/pricing changes, URL/focus recovery, timestamp refreshes.
 */
export function scheduleScan() {
  pendingFullScan = true;
  armScanTimer();
}

/**
 * Central scan dispatcher. Called when the debounce timer fires.
 */
function scanPage() {
  withObserverPaused(() => {
    if (
      state.longWork.active &&
      Date.now() - state.longWork.lastActivityAt > LONG_WORK_STALE_MS
    ) {
      state.longWork.active = false;
      state.longWork.files.clear();
      if (state.ui) {
        state.ui.showLongWorkOverlay(false);
        state.ui.showToast("LONG_WORK timeout cleared.");
      }
    }

    const doFullScan = pendingFullScan;
    pendingFullScan = false;

    // Always process disconnected removedNodes first — full scan must not discard disposal
    const toDispose = new Set(removedNodes);
    removedNodes.clear();
    for (const rn of toDispose) {
      if (!document.contains(rn)) {
        removeKnownNode(rn);
        disposeMessageNode(rn);
      } else {
        registerKnownNode(rn);
      }
    }

    if (doFullScan) {
      // Full scan: rebuild knownNodes from DOM, process all
      disposeDetachedMessageOverlays();
      dirtyNodes.clear();

      const nodes = collectMessageNodes();
      rebuildKnownNodes(nodes);
      const latestAssistant = knownLatestAssistant;
      const absoluteLast = nodes[nodes.length - 1] || null;
      const systemGenerating = isSystemGenerating();
      const context = {
        latestAssistantNode: latestAssistant,
        absoluteLastNode: absoluteLast,
        systemGenerating,
      };

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        try {
          processMessageNode(node, i, nodes, context);
        } catch (err) {
          console.error("[BDS] Error processing message node:", err, node);
        }
      }

      previousLatestAssistant = latestAssistant;
      previousAbsoluteLast = absoluteLast;
    } else if (dirtyNodes.size > 0 || toDispose.size > 0) {
      // Incremental: use cached knownNodes — no O(N) DOM walk after initial seed.
      // Seed with one full collection if the registry is empty (first run after nav).
      if (!knownNodesInitialized) rebuildKnownNodes(collectMessageNodes());

      // Dispose remaining dirty nodes disconnected at flush time
      for (const dn of dirtyNodes) {
        if (!document.contains(dn)) {
          disposeMessageNode(dn);
          removeKnownNode(dn);
        }
      }

      const latestAssistant = knownLatestAssistant;
      const absoluteLast = knownNodes[knownNodes.length - 1] || null;
      const systemGenerating = isSystemGenerating();

      // Build process set from dirty + transition nodes
      const toProcess = new Set();
      for (const dn of dirtyNodes) {
        if (document.contains(dn)) {
          toProcess.add(dn);
        }
      }
      if (previousLatestAssistant && document.contains(previousLatestAssistant)) {
        toProcess.add(previousLatestAssistant);
      }
      if (previousAbsoluteLast && document.contains(previousAbsoluteLast)) {
        toProcess.add(previousAbsoluteLast);
      }
      if (latestAssistant) toProcess.add(latestAssistant);
      if (absoluteLast) toProcess.add(absoluteLast);

      dirtyNodes.clear();

      const context = {
        latestAssistantNode: latestAssistant,
        absoluteLastNode: absoluteLast,
        systemGenerating,
      };

      // Use knownNodes for index lookups (no rebuild)
      for (const node of toProcess) {
        const idx = knownNodeIndexes.get(node);
        if (idx === undefined) continue;
        try {
          processMessageNode(node, idx, knownNodes, context);
        } catch (err) {
          console.error("[BDS] Error processing message node:", err, node);
        }
      }

      previousLatestAssistant = latestAssistant;
      previousAbsoluteLast = absoluteLast;
    }

    // Page-wide enhancers always run (composer, sidebar, logo, etc.)
    linkifyLogo();
    linkifyNewChatButton();
    injectSearchInput();
    scanInputArea();
    hideTagsInSidebar();
    hideTagsInHeader();
    hideBdsTagsInPopovers();
    injectShareDialogWarning();
  });
}

/**
 * Reset conversation-processing state when conversation DOM is replaced
 * (URL change). Preserves the disconnected-removal queue so overlays from
 * removed messages are disposed at the next flush even across navigation.
 */
export function resetIncrementalState() {
  dirtyNodes.clear();
  pendingFullScan = false;
  previousLatestAssistant = null;
  previousAbsoluteLast = null;
  knownNodes = [];
  knownNodesInitialized = false;
  knownNodeIndexes = new WeakMap();
  knownLatestAssistant = null;
  // Do NOT clear removedNodes — disposal must survive navigation.
}

/**
 * Check whether the current page has a genuine chat composer surface.
 *
 * Returns true only when at least one chat-specific marker is found:
 *   - multi-file upload input
 *   - native DeepThink / prompt action row
 *   - DeepSeek send button
 *   - #chat-input textarea, .ds-textarea textarea, or contenteditable rich editor
 *
 * If the only "editor" found is a plain <input> (text/email/tel/password with
 * placeholder — typical of login/auth pages) with none of the markers above,
 * this is not a chat composer and Deep Research / attach controls must not mount.
 */
function isChatComposer() {
  if (findActiveFileInput()) return true;
  if (findNativePromptActionRow()) return true;
  if (findDeepSeekSendButton()) return true;

  const editor = findComposerEditor();
  if (!editor) return false;

  const tag = editor.tagName.toLowerCase();
  // textarea or contenteditable = rich chat composer
  if (tag === "textarea" || editor.isContentEditable) return true;

  // plain <input> with no chat markers = auth/form page
  return false;
}

/**
 * Scan for the chat text input area to inject custom attachment menu
 */
export function scanInputArea() {
  const fileInput = findActiveFileInput();
  const wrapper = findComposerControlsWrapper(fileInput);
  const deepResearchWrapper = findDeepResearchControlsWrapper(fileInput, wrapper);
  if (!deepResearchWrapper) {
    return;
  }

  // Surface check: reject login/auth forms that lack chat-specific markers.
  if (!isChatComposer()) {
    return;
  }

  const insertBeforeNode = findDeepResearchInsertAnchor(
    deepResearchWrapper,
    fileInput,
    wrapper,
  );
  const nativeButton = fileInput ? findNativeFileInputTrigger(fileInput) : null;

  if (nativeButton) {
    nativeButton.style.setProperty("display", "none", "important");
  }

  // ── Locked composer icon order (BDS-UI F.1 / E.1) ───────────────────────
  // Left → right: 1 Plus (upload drawer), 2 Deep Think (native), 3 Web Search
  // (native), 4 Deep Research (BDS), 5 Send (native). The Plus mount takes the
  // left-most slot of the native prompt action row (the slot the now-hidden
  // native upload trigger sits in) and the Deep Research mount is anchored
  // immediately before the native send cluster, so neither BDS control can
  // displace a native Deep Think / Web Search toggle.
  const hasNativeActionRow =
    deepResearchWrapper === findNativePromptActionRow() &&
    deepResearchWrapper !== document.body;
  const sendClusterAnchor = findSendClusterAnchor(deepResearchWrapper);
  const plusAnchor = nativeButton && nativeButton.parentElement === deepResearchWrapper
    ? nativeButton
    : (hasNativeActionRow ? firstNativeRowChild(deepResearchWrapper) : insertBeforeNode);
  const deepResearchAnchor = sendClusterAnchor;

  // C.1 evidence: the locked order is only guaranteed while both anchors exist.
  devLog(
    "Composer",
    "anchors",
    JSON.stringify({
      nativeActionRow: hasNativeActionRow,
      plusAnchor: describeElement(plusAnchor),
      deepResearchAnchor: describeElement(deepResearchAnchor),
      wrapper: describeElement(deepResearchWrapper),
      nativeUploadTriggerFound: Boolean(nativeButton),
    }),
  );

  // B.6: the shared action-row wrapper (the real native prompt row when we can
  // find it, otherwise the row the mounts live in) hosts every composer icon.
  const iconRow = hasNativeActionRow && deepResearchWrapper ? deepResearchWrapper : wrapper;
  applyComposerIconRowLayout(iconRow);

  const deepResearchMountPoint = ensureComposerMount(
    deepResearchWrapper,
    "bds-deep-research-mount",
    ".bds-deep-research-toggle",
    deepResearchAnchor,
  );
  if (!deepResearchMountPoint.dataset.bdsMounted) {
    mount(DeepResearchToggle, {
      target: deepResearchMountPoint,
      props: {
        enabled: state.deepResearch.enabled,
        onToggle: (enabled) => setDeepResearchEnabled(enabled),
      },
    });
    deepResearchMountPoint.dataset.bdsMounted = "1";
  }

  // NOTE (BDS-UI E.1): the DeepCode toggle is no longer mounted inside the
  // composer action row — the row is locked to exactly five icons (Plus, Deep
  // Think, Web Search, Deep Research, Send). DeepCode keeps its full
  // functionality and is now hosted by the BDS drawer (see Drawer.svelte),
  // which is also where the old Android-only skip branch went: Android simply
  // never renders that drawer section's composer-side toggle.
  // TODO(BDS-UI): re-check DeepCode placement once the drawer redesign ships.

  if (!fileInput || !wrapper) {
    neutralizeIconRowInnerMargins(hasNativeActionRow ? deepResearchWrapper : wrapper);
    markComposerControlsMounted(deepResearchWrapper, wrapper);
    return;
  }

  if (wrapper !== deepResearchWrapper) {
    markComposerControlsMounted(deepResearchWrapper);
  }

  const mountPoint = ensureComposerMount(
    hasNativeActionRow && deepResearchWrapper ? deepResearchWrapper : wrapper,
    "bds-attach-menu-mount",
    ".bds-attach-wrapper",
    hasNativeActionRow ? plusAnchor : fileInput,
  );
  if (!mountPoint.dataset.bdsMounted) {
    mount(AttachMenu, {
      target: mountPoint,
      props: {
        nativeInput: fileInput
      }
    });
    mountPoint.dataset.bdsMounted = "1";
  }

  // B.6: these two are not composer icons, so they live in the composer
  // container instead of the five-icon action row.
  const composerContainer = findComposerContainerOutsideIconRow(iconRow, wrapper);

  const toggleMountPoint = ensureComposerMount(
    composerContainer,
    "bds-expand-toggle-mount",
    ".bds-expand-toggle",
    null,
  );
  if (!toggleMountPoint.dataset.bdsMounted) {
    mount(ExpandToggle, { target: toggleMountPoint });
    toggleMountPoint.dataset.bdsMounted = "1";
  }

  const ragMountPoint = ensureComposerMount(
    composerContainer,
    "bds-rag-preview-mount",
    ".bds-rag-preview",
    null,
  );
  if (!ragMountPoint.dataset.bdsMounted) {
    mount(RagPreview, { target: ragMountPoint });
    ragMountPoint.dataset.bdsMounted = "1";
  }

  // B.6 (continued): the mounts now exist, so their inner margins can be
  // neutralised for the evenly spaced icon row.
  neutralizeIconRowInnerMargins(hasNativeActionRow ? deepResearchWrapper : wrapper);

  // C.1 evidence: the locked order as it actually ended up. A language switch
  // that moves an anchor shows up here as a changed list, which is what makes
  // the on-device chrome://inspect capture decisive.
  devLog("Composer", "order", describeComposerRow(iconRow));

  markComposerControlsMounted(wrapper);
}

export function findActiveFileInput() {
  const inputs = Array.from(document.querySelectorAll('input[type="file"][multiple]'))
    .filter((input) => !input.closest("#bds-root"));

  return inputs.find((input) =>
    isUsableComposerElement(input.parentElement || input)
  ) || inputs[0] || null;
}

function isUsableComposerElement(element) {
  if (!element || element.closest("#bds-root")) {
    return false;
  }

  for (let node = element; node && node !== document.body; node = node.parentElement) {
    const style = window.getComputedStyle?.(node);
    if (
      node.hidden ||
      node.getAttribute("aria-hidden") === "true" ||
      style?.display === "none" ||
      style?.visibility === "hidden"
    ) {
      return false;
    }
  }

  const rect = element.getBoundingClientRect?.();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  if (
    rect &&
    viewportWidth > 0 &&
    viewportHeight > 0 &&
    (rect.width > 0 || rect.height > 0)
  ) {
    return (
      rect.right >= 0 &&
      rect.bottom >= 0 &&
      rect.left <= viewportWidth &&
      rect.top <= viewportHeight
    );
  }

  return true;
}

function markComposerControlsMounted(...wrappers) {
  for (const wrapper of wrappers) {
    if (wrapper) {
      wrapper.setAttribute("data-bds-attach-menu-mounted", "true");
    }
  }
}

function findComposerControlsWrapper(fileInput) {
  const resolved = resolveComposerControlsWrapper(fileInput);
  // Round-2 C.1: the composer icon order breaks after switching DeepSeek's UI
  // language, so every anchor decision is logged with the evidence needed to
  // see *which* element was picked (and why) from chrome://inspect.
  devLog(
    "Composer",
    "controls wrapper:",
    describeElement(resolved),
    "| file input:",
    describeElement(fileInput),
    "| fallback from parent:",
    Boolean(fileInput?.parentElement),
  );
  return resolved;
}

/**
 * Describes a DOM element for the composer dev log: tag, id, classes and the
 * first few words of its text — enough to recognise DeepSeek's own nodes
 * without attaching a debugger.
 */
function describeElement(element) {
  if (!element) return "none";
  const tag = String(element.tagName || "").toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes =
    typeof element.className === "string" && element.className.trim()
      ? `.${element.className.trim().split(/\s+/).slice(0, 3).join(".")}`
      : "";
  const text = normalizePromptControlText(element.textContent).slice(0, 24);
  return `<${tag}${id}${classes}${text ? ` "${text}"` : ""}>`;
}

function resolveComposerControlsWrapper(fileInput) {
  if (fileInput?.parentElement) {
    return fileInput.parentElement;
  }

  const sendButton = findDeepSeekSendButton() || findDeepSeekStopButton();
  if (sendButton?.parentElement) {
    const parent = sendButton.parentElement;
    if (
      parent !== document.body &&
      (parent.style.width === "fit-content" ||
        getComputedStyle(parent).width === "fit-content")
    ) {
      return parent.parentElement || parent;
    }
    return parent;
  }

  const editor = findComposerEditor();
  return editor?.parentElement || null;
}

function findDeepResearchControlsWrapper(fileInput, fallbackWrapper) {
  const actionRow = findNativePromptActionRow();
  if (actionRow) {
    devLog("Composer", "deep-research wrapper = native action row", describeElement(actionRow));
    return actionRow;
  }

  const fallback = fallbackWrapper || findComposerControlsWrapper(fileInput);
  devLog(
    "Composer",
    "deep-research wrapper = fallback (no native action row found)",
    describeElement(fallback),
  );
  return fallback;
}

function findNativePromptActionRow() {
  const editor = findComposerEditor();
  const controls = Array.from(
    document.querySelectorAll(
      'button, [role="button"], [tabindex], [aria-label], [title]',
    ),
  );

  for (const control of controls) {
    if (control.closest("#bds-root")) {
      continue;
    }

    if (editor && !isAfterNode(editor, control)) {
      continue;
    }

    if (!isDeepThinkControl(control)) {
      continue;
    }

    // C.1 evidence: which control was recognised as Deep Think and which row it
    // resolved to. A non-English UI changes the *label*, never this node — so a
    // missing entry here is what points at a detection (not a layout) problem.
    const row = findControlsRowFor(control, editor);
    devLog(
      "Composer",
      "deepthink control matched:",
      describeElement(control),
      "-> row:",
      describeElement(row),
    );
    if (row) {
      return row;
    }
  }

  return null;
}

function findComposerEditor() {
  const selectors = [
    "textarea#chat-input",
    ".ds-textarea textarea",
    '[role="textbox"][contenteditable]',
    '[role="textbox"]',
    ".ProseMirror[contenteditable]",
    "textarea[placeholder]",
    "input[placeholder]",
    "[contenteditable]",
  ];

  for (const selector of selectors) {
    const editor = Array.from(document.querySelectorAll(selector))
      .find((candidate) => !candidate?.closest?.(
        "#bds-root, .bds-question-panel, .bds-dr-revision-panel, .bds-attach-wrapper, .bds-rag-preview"
      ));
    if (editor) return editor;
  }

  return null;
}

function isAfterNode(reference, candidate) {
  if (!reference || !candidate || reference === candidate) {
    return true;
  }

  const following = globalThis.Node?.DOCUMENT_POSITION_FOLLOWING || 4;
  return Boolean(reference.compareDocumentPosition(candidate) & following);
}

function isDeepThinkControl(control) {
  // Match by class and SVG path (preferred, language-independent)
  const hasToggleClass = control.classList?.contains("ds-toggle-button") || 
                         control.querySelector?.(".ds-toggle-button");
  if (hasToggleClass && control.querySelector?.('svg path[d*="M7.0643"]')) {
    return true;
  }

  // Fallback to direct SVG path match
  if (control.querySelector?.('svg path[d*="M7.0643"]')) {
    return true;
  }

  // Fallback for test environments (English label text)
  const text = normalizePromptControlText(control.textContent);
  const label = normalizePromptControlText(
    `${control.getAttribute("aria-label") || ""} ${control.getAttribute("title") || ""}`,
  );

  return (
    text.includes("deepthink") ||
    text.includes("deep think") ||
    label.includes("deepthink") ||
    label.includes("deep think")
  );
}

function normalizePromptControlText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function findControlsRowFor(control, editor) {
  let fallback = null;
  let node = control.parentElement;
  let depth = 0;

  while (node && node !== document.body && depth < 6) {
    if (node.closest("#bds-root")) {
      return null;
    }

    if (editor && node.contains(editor)) {
      return fallback;
    }

    fallback ||= node;

    if (countPromptControls(node) > 1) {
      return node;
    }

    node = node.parentElement;
    depth += 1;
  }

  return fallback;
}

function countPromptControls(container) {
  return Array.from(
    container.querySelectorAll('button, [role="button"], [tabindex]'),
  ).filter((control) => !control.closest("#bds-root")).length;
}

function findDeepSeekSendButton() {
  const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
  return buttons.find((button) => {
    if (button.closest("#bds-root")) {
      return false;
    }
    return (
      button.querySelector?.('svg path[d*="M8.3125"], .ds-icon-send') ||
      button.querySelector?.('svg path[d*="M13.12 19.98"]') ||
      button.title === "Send message" ||
      button.ariaLabel === "Send Message" ||
      button.getAttribute("aria-label") === "Send Message"
    );
  }) || null;
}

function findDeepSeekStopButton() {
  const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
  return buttons.find((button) => {
    if (button.closest("#bds-root")) {
      return false;
    }
    return (
      button.querySelector?.(".ds-icon-stop-circle, .ds-icon-stop") ||
      button.querySelector?.('svg path[d*="M3 3h10v10H3z"], svg path[d*="M6 6h12v12H6z"], svg path[d*="M2 4.88"]') ||
      button.title === "Stop generating" ||
      button.title === "Stop" ||
      button.getAttribute("aria-label")?.toLowerCase().includes("stop")
    );
  }) || null;
}

/**
 * Direct child of `row` that is the left-most non-BDS element — the slot the
 * native Deep Think / Web Search toggles start at (BDS-UI E.1 slot 2).
 */
function firstNativeRowChild(row) {
  if (!row) return null;
  return Array.from(row.children).find((child) => !isBdsMountPoint(child)) || null;
}

/**
 * Direct child of `row` that wraps the native send button, used as the anchor
 * for the Deep Research toggle so it lands in slot 4 (right of the native
 * toggles, left of Send).
 */
function findSendClusterAnchor(row) {
  if (!row) return null;
  const sendButton = findDeepSeekSendButton() || findDeepSeekStopButton();
  if (!sendButton) return null;

  let node = sendButton;
  if (node.closest?.("#bds-root")) return null;
  while (node.parentElement && node.parentElement !== row) {
    node = node.parentElement;
  }
  return node.parentElement === row ? node : null;
}

function isBdsMountPoint(element) {
  if (!element?.classList) return false;
  return (
    element.classList.contains("bds-deep-research-mount") ||
    element.classList.contains("bds-deep-code-mount") ||
    element.classList.contains("bds-attach-menu-mount") ||
    element.classList.contains("bds-expand-toggle-mount") ||
    element.classList.contains("bds-rag-preview-mount")
  );
}

function findDeepResearchInsertAnchor(wrapper, fileInput, fileInputWrapper) {
  if (fileInput && wrapper === fileInputWrapper) {
    const attachMount = wrapper.querySelector?.(".bds-attach-menu-mount");
    if (attachMount && attachMount.parentElement === wrapper) {
      return attachMount;
    }
    return fileInput;
  }

  return findComposerInsertAnchor(wrapper);
}

function findComposerInsertAnchor(wrapper) {
  return Array.from(wrapper.children).find((child) =>
    !child.classList?.contains("bds-deep-research-mount") &&
    !child.classList?.contains("bds-deep-code-mount") &&
    !child.closest?.("#bds-root")
  ) || null;
}

function findNativeFileInputTrigger(fileInput) {
  const candidate = fileInput.previousElementSibling;
  if (!candidate || candidate.closest("#bds-root")) {
    return null;
  }

  if (
    candidate.classList?.contains("bds-deep-research-mount") ||
    candidate.classList?.contains("bds-deep-code-mount") ||
    candidate.classList?.contains("bds-attach-menu-mount") ||
    candidate.classList?.contains("bds-expand-toggle-mount") ||
    candidate.classList?.contains("bds-rag-preview-mount")
  ) {
    return null;
  }

  const tag = String(candidate.tagName || "").toLowerCase();
  const isButtonLike =
    tag === "button" ||
    tag === "label" ||
    candidate.getAttribute("role") === "button";

  return isButtonLike ? candidate : null;
}

/**
 * Round-2 B.6: the five composer icons must be spread evenly instead of
 * clumping together, which is what happens when the native action row inherits
 * DeepSeek's own gap/flex-end styling (and it shifts again when the UI language
 * changes, because the native toggles change width).
 *
 * The rule is applied inline with `!important`, so a React re-render that
 * rewrites the row's style attribute cannot win, and the marker attribute lets
 * the E2E suite assert the layout without reading pixel values.
 *
 * Only rows that hold controls *and nothing else* are touched — the composer
 * container that also hosts the editor is left alone.
 */
const ICON_ROW_ATTR = "data-bds-icon-row";

/**
 * The composer container that also holds the editor — the home of the BDS
 * controls that are *not* composer icons. Keeping the (empty in their idle
 * state) expand-toggle / RAG mounts out of the action row is what lets the row
 * distribute exactly five icons with `space-between` (B.6).
 */
function findComposerContainerOutsideIconRow(iconRow, fallback) {
  if (!iconRow) return fallback;
  const editor = findComposerEditor();
  if (editor) {
    let node = iconRow.parentElement;
    while (node && node !== document.body) {
      if (node.contains(editor)) return node;
      node = node.parentElement;
    }
  }
  return iconRow.parentElement || fallback;
}

function applyComposerIconRowLayout(row) {
  if (!row || !isAndroidWebView()) return;
  if (row.querySelector?.('textarea, [role="textbox"], .ds-textarea, [contenteditable]')) {
    return;
  }

  const style = row.style;
  if (!style) return;

  row.setAttribute(ICON_ROW_ATTR, "1");
  const desired = [
    ["display", "flex"],
    ["align-items", "center"],
    ["justify-content", "space-between"],
    ["gap", "8px"],
    ["width", "100%"],
  ];
  for (const [property, value] of desired) {
    if (style.getPropertyValue(property) === value) continue;
    style.setProperty(property, value, "important");
  }

}

/**
 * The BDS controls keep a little horizontal margin of their own (the upload
 * wrapper reserves 6px on the right). Inside the space-between icon row that
 * margin is what makes the *visible* gaps uneven even though the flex items are
 * distributed correctly, so it is neutralised here — the row's own gap provides
 * the spacing. Runs after the mounts exist (they are created by this scan).
 */
function neutralizeIconRowInnerMargins(row) {
  if (!row) return;
  const inner = row.querySelectorAll(
    ".bds-attach-wrapper, .bds-deep-research-mount > *, .bds-deep-research-toggle, .bds-plus-btn",
  );
  for (const element of inner) {
    if (!element.style) continue;
    if (element.style.getPropertyValue("margin-left") !== "0px") {
      element.style.setProperty("margin-left", "0", "important");
    }
    if (element.style.getPropertyValue("margin-right") !== "0px") {
      element.style.setProperty("margin-right", "0", "important");
    }
  }
}

/**
 * Labels the composer row's children for the C.1 dev log: BDS mounts by name,
 * native controls by their (possibly translated) text plus id, everything else
 * by tag. Order in this list *is* the on-screen order.
 */
function describeComposerRow(row) {
  if (!row) return "none";
  return Array.from(row.children)
    .map((child) => {
      if (child.classList?.contains("bds-attach-menu-mount")) return "plus(BDS)";
      if (child.classList?.contains("bds-deep-research-mount")) return "deep-research(BDS)";
      if (isBdsMountPoint(child)) return `${child.className.split(" ")[0]}(BDS)`;
      const tag = String(child.tagName || "").toLowerCase();
      if (tag === "input") return "input[type=file]";
      const text = normalizePromptControlText(child.textContent).slice(0, 16);
      return `${tag}${child.id ? `#${child.id}` : ""}${text ? `"${text}"` : ""}`;
    })
    .join(" → ");
}

function ensureComposerMount(wrapper, className, descendantSelector, beforeNode) {
  let mountPoint = Array.from(wrapper.children).find((child) =>
    child.classList && child.classList.contains(className)
  );

  if (!mountPoint && (className === "bds-deep-research-mount" || className === "bds-deep-code-mount")) {
    mountPoint = document.querySelector(`.${className}`);
  }

  if (!mountPoint) {
    mountPoint = Array.from(wrapper.children).find((child) =>
      child.querySelector && child.querySelector(descendantSelector)
    );
  }

  if (!mountPoint) {
    mountPoint = document.createElement("div");
  }

  mountPoint.classList.add(className);
  if (mountPoint.querySelector && mountPoint.querySelector(descendantSelector)) {
    mountPoint.dataset.bdsMounted = "1";
  }
  if (mountPoint.parentElement !== wrapper) {
    wrapper.insertBefore(mountPoint, beforeNode);
  } else if (
    beforeNode &&
    beforeNode.parentElement === wrapper &&
    mountPoint.nextElementSibling !== beforeNode
  ) {
    // The locked composer order may have changed between versions (or another
    // mount was reordered); move the mount back to its anchor position.
    wrapper.insertBefore(mountPoint, beforeNode);
  }
  return mountPoint;
}

/**
 * Overlays an <a> tag over the logo div to support "Open in new tab" without reparenting.
 */
function linkifyLogo() {
  // Look for the DeepSeek logo SVG
  const logoSvg = document.querySelector('svg[viewBox="0 0 143 23"]');
  if (!logoSvg) return;

  const container = logoSvg.closest('div');
  if (!container || container.tagName === 'A' || container.closest('a')) {
    return;
  }

  let target = container;
  if (target.parentElement && target.parentElement.classList.contains('_262baab')) {
    target = target.parentElement;
  }

  if (target.tagName === 'A' || target.querySelector(':scope > .bds-logo-link')) return;

  target.style.position = target.style.position || 'relative';

  const link = document.createElement('a');
  link.href = '/';
  link.className = 'bds-logo-link';
  link.setAttribute('data-bds-linkified', 'true');

  link.addEventListener('click', (e) => {
    if (e.button === 0 && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
    }
  });

  target.appendChild(link);
}

/**
 * Overlays an <a> tag over the "New Chat" div button without reparenting.
 */
function linkifyNewChatButton() {
  const allSvgs = document.querySelectorAll('svg');
  let newChatSvg = null;
  for (const svg of allSvgs) {
    if (svg.querySelector('path[d*="M8 0.599609"]')) {
      newChatSvg = svg;
      break;
    }
  }

  if (!newChatSvg) return;

  const container = newChatSvg.closest('div[tabindex="0"]');
  if (!container || container.tagName === 'A' || container.closest('a')) {
    return;
  }

  if (container.querySelector(':scope > .bds-logo-link') || container.hasAttribute('data-bds-linkified')) return;

  container.style.position = container.style.position || 'relative';

  const link = document.createElement('a');
  link.href = '/';
  link.className = 'bds-logo-link';
  link.setAttribute('data-bds-linkified', 'true');

  link.addEventListener('click', (e) => {
    if (e.button === 0 && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
    }
  });

  container.appendChild(link);
}

/**
 * Watch for URL changes (SPA navigation).
 */
export function startUrlWatcher() {
  if (state.urlWatchTimer) {
    return;
  }

  state.urlWatchTimer = window.setInterval(() => {
    if (location.href === state.lastUrl) {
      if (autocompleteInstance && currentEditor && !document.contains(currentEditor)) {
        devLog("Cmd", "Editor detached — re-initializing")
        if (currentKeydownHandler) {
          currentEditor.removeEventListener("keydown", currentKeydownHandler)
          currentKeydownHandler = null
        }
        currentEditor = null
        unmount(autocompleteInstance)
        autocompleteInstance = null
        document.querySelector(".bds-cmd-autocomplete")?.remove()
        document.querySelector(".bds-cmd-help-mount")?.remove()
        if (cmdSetupTimer) { clearInterval(cmdSetupTimer); cmdSetupTimer = 0 }
        scheduleScan()
        setupCommandListener()
        checkPendingExport()
      } else if (!autocompleteInstance && !cmdSetupTimer) {
        setupCommandListener()
      }
      return;
    }
    const oldUrl = state.lastUrl;
    state.lastUrl = location.href;
    resetIncrementalState();
    // Clear processed-standalone-files signature set so identical files can
    // render in a later conversation without growing across sessions.
    state.processedStandaloneFiles.clear();
    window.dispatchEvent(new CustomEvent("bds:urlChanged"));

    const isNewSessionTransition = (oldUrl === "https://chat.deepseek.com/" || oldUrl === "https://chat.deepseek.com") && state.lastUrl.includes("/chat/s/");

    state.longWork.active = false;
    state.longWork.files.clear();
    state.longWork.lastActivityAt = 0;
    
    // Only reset session pricing if it's NOT the first message transition
    if (!isNewSessionTransition) {
      resetMessagePricing();
      state.pricing.pendingInjections.clear();
    } else {
      // Migrate "default" pending injection to the new real ID
      const defaultPending = state.pricing.pendingInjections.get("default");
      if (defaultPending) {
        const newId = location.href.match(/\/chat\/s\/([^\/]+)/)?.[1];
        if (newId) {
          state.pricing.pendingInjections.set(newId, defaultPending);
          state.pricing.pendingInjections.delete("default");
        }
      }
    }
    
    if (state.ui) {
      state.ui.showLongWorkOverlay(false);
    }
    const oldTotal = document.querySelector(".bds-session-total");
    if (oldTotal) oldTotal.remove();
    if (autocompleteInstance || commandsHelpInstance || document.querySelector(".bds-cmd-autocomplete")) devLog("Cmd", "URL change cleanup")
    if (currentEditor && currentKeydownHandler) {
      currentEditor.removeEventListener("keydown", currentKeydownHandler)
      currentKeydownHandler = null
      currentEditor = null
    }
    if (autocompleteInstance) { unmount(autocompleteInstance); autocompleteInstance = null }
    if (commandsHelpInstance) { unmount(commandsHelpInstance); commandsHelpInstance = null }
    document.querySelector(".bds-cmd-autocomplete")?.remove()
    document.querySelector(".bds-cmd-help-mount")?.remove()
    if (cmdSetupTimer) { clearInterval(cmdSetupTimer); cmdSetupTimer = 0 }
    scheduleScan();
    setupCommandListener();
    checkPendingExport();
  }, 1000);

  // Focus/Visibility triggers to handle background-to-foreground transitions
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleScan();
      if (!autocompleteInstance) setupCommandListener();
    }
  });

  window.addEventListener("focus", () => {
    scheduleScan();
    if (!autocompleteInstance) setupCommandListener();
  });

  window.addEventListener("bds:settingsChanged", () => {
    scheduleScan();
  });

  setupCommandListener();
  checkPendingHandoff();
}

let autocompleteInstance = null
let commandsHelpInstance = null
let cmdSetupTimer = 0
let currentEditor = null
let currentKeydownHandler = null

function retrySetupCommandListener() {
  devLog("Cmd", "retrySetupCommandListener start, autoInst=", !!autocompleteInstance, "timer=", !!cmdSetupTimer)
  if (autocompleteInstance || cmdSetupTimer) {
    devLog("Cmd", "retrySetupCommandListener skipped")
    return
  }
  let delay = 500
  const MAX_DELAY = 30000
  const poll = () => {
    if (autocompleteInstance) { cmdSetupTimer = 0; devLog("Cmd", "poll cancelled (autoInst set)"); return }
    const ed = findComposerEditor()
    devLog("Cmd", "poll editor=", !!ed, "tag=", ed?.tagName, "id=", ed?.id)
    if (ed) { cmdSetupTimer = 0; setupCommandListener(ed); return }
    delay = Math.min(delay * 2, MAX_DELAY)
    cmdSetupTimer = setTimeout(poll, delay)
  }
  cmdSetupTimer = setTimeout(poll, delay)
}

function setupCommandListener(editor) {
  devLog("Cmd", "setupCommandListener called, editor=", !!editor, "autoInst=", !!autocompleteInstance, "tag=", editor?.tagName, "id=", editor?.id)
  if (autocompleteInstance) {
    devLog("Cmd", "setupCommandListener skipped (already mounted)")
    return
  }
  if (!editor) { retrySetupCommandListener(); return }

  if (currentEditor && currentKeydownHandler) {
    currentEditor.removeEventListener("keydown", currentKeydownHandler)
  }

  const handler = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (!document.contains(editor)) { devLog("Cmd", "Enter ignored — editor detached"); return }
      const dropdown = document.querySelector(".bds-cmd-dropdown")
      if (dropdown) { devLog("Cmd", "Enter ignored — dropdown open"); return }
      const text = (() => { const t = (editor.tagName || "").toLowerCase(); return t === "textarea" || t === "input" ? editor.value : (editor.textContent || "") })()
      devLog("Cmd", "Enter pressed, text=", text.substring(0, 80).replace(/\n/g, "\\n"))
      if (text.startsWith("/")) {
        const hasSpaceAfterCmd = /^\/[a-z0-9_]+\s/.test(text)
        if (hasSpaceAfterCmd || /^\/[a-z0-9_]+$/.test(text)) {
          e.preventDefault()
          const ok = tryExecuteRawInput(text)
          devLog("Cmd", "Enter execute cmd result=", ok)
          if (ok) {
            const t = (editor.tagName || "").toLowerCase()
            if (t === "textarea" || t === "input") editor.value = ""
            else editor.textContent = ""
            editor.dispatchEvent(new Event("input", { bubbles: true }))
          }
        }
      }
    }
  }
  editor.addEventListener("keydown", handler)
  currentEditor = editor
  currentKeydownHandler = handler

  document.querySelector(".bds-cmd-autocomplete")?.remove()
  const mountPoint = document.createElement("div")
  mountPoint.className = "bds-cmd-autocomplete"
  document.body.appendChild(mountPoint)

  devLog("Cmd", "Mounting Autocomplete component, editor=", editor?.tagName, "#" + (editor?.id || ""))
  autocompleteInstance = mount(Autocomplete, {
    target: mountPoint,
    props: { editor },
  })

  editor.dispatchEvent(new Event("input", { bubbles: true }))

  document.querySelector(".bds-cmd-help-mount")?.remove()
  const helpMountPoint = document.createElement("div")
  helpMountPoint.className = "bds-cmd-help-mount"
  document.body.appendChild(helpMountPoint)

  commandsHelpInstance = mount(CommandsHelp, { target: helpMountPoint })
}

