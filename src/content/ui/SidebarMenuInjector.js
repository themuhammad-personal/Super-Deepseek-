import { exportSession } from "../tools/exporter.js";
import { setPendingExport, checkPendingExport } from "../tools/pending-export.js";
import { openTagEditor } from "../tags/tag-editor.js";
import { i18n } from "../../lib/i18n.svelte.js";
import appState from "../state.js";

// Keep track of which chat item's menu was opened
let lastClickedChatUrl = null;

// Selection Icon
const SELECTION_ICON = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9 11l3 3L22 4"></path>
  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
</svg>`;

// Tag Icon
const TAG_ICON = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
  <line x1="7" y1="7" x2="7.01" y2="7"/>
</svg>`;

// Plugins (MCP) Icon — used by the account-menu "Plugins" entry
const PLUGINS_ICON = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9 3v4a2 2 0 0 1-2 2H3"/>
  <path d="M15 3v4a2 2 0 0 0 2 2h4"/>
  <path d="M9 21v-4a2 2 0 0 0-2-2H3"/>
  <path d="M15 21v-4a2 2 0 0 1 2-2h4"/>
</svg>`;

// Advanced Settings Icon — used by the account-menu "Advanced Settings" entry
const ADVANCED_ICON = `
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
</svg>`;

// ── Menu discrimination (BDS-UI F.5) ───────────────────────────────────────
// DeepSeek renders both the chat-context menu (three-dot on a chat row) and the
// sidebar account/profile menu as `.ds-dropdown-menu`. Tags / Export Chat must
// only ever land in the chat menu and the BDS settings entries only in the
// account menu, so every injection is gated on the labels the menu really has.

const ACCOUNT_MENU_LOGOUT_LABELS = ["log out", "logout", "sign out", "log-out"];
const ACCOUNT_MENU_SETTINGS_LABELS = ["settings"];
const ACCOUNT_MENU_HELP_LABELS = ["help & feedback", "help and feedback"];
const CHAT_MENU_LABELS = ["delete", "rename"];

function menuOptionLabels(menu) {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll(".ds-dropdown-menu-option__label"))
    .map((node) => (node.textContent || "").trim().toLowerCase())
    .filter(Boolean);
}

function menuHasAnyLabel(labels, needles) {
  return needles.some((needle) => labels.some((label) => label.includes(needle)));
}

/** True only for the sidebar account/profile popover. */
export function isAccountMenu(menu) {
  const labels = menuOptionLabels(menu);
  if (!labels.length) return false;
  if (menuHasAnyLabel(labels, CHAT_MENU_LABELS)) return false;
  if (menuHasAnyLabel(labels, ACCOUNT_MENU_LOGOUT_LABELS)) return true;
  return menuHasAnyLabel(labels, ACCOUNT_MENU_SETTINGS_LABELS);
}

/** True only for a chat-row context menu (three-dot menu next to a chat). */
export function isChatContextMenu(menu) {
  if (!menu) return false;
  const labels = menuOptionLabels(menu);
  if (!labels.length) return false;
  if (menuHasAnyLabel(labels, ACCOUNT_MENU_LOGOUT_LABELS)) return false;
  if (menuHasAnyLabel(labels, ACCOUNT_MENU_HELP_LABELS)) return false;
  return menuHasAnyLabel(labels, CHAT_MENU_LABELS);
}

/** Lets React close the native dropdown instead of force-removing DOM nodes. */
function dismissNativeMenu() {
  document.body.click();
}

export function initSidebarMenuInjector() {
  // Capture the chat URL from any click inside a sidebar chat link.
  // The three-dot menu button is a descendant of the <a> element, so this
  // fires reliably without depending on auto-generated class names.
  function captureLinkFromClick(e) {
    // Fast path: button is inside the chat link element (some DOM layouts)
    let link = e.target.closest('a[href*="/chat/s/"]');
    if (link) {
      lastClickedChatUrl = link.href;
      return;
    }
    // Fallback: button is a sibling of the chat link rather than a descendant.
    // Walk up until we find the nearest container that holds a chat link.
    // Stops at the first match to avoid capturing the wrong session.
    let el = e.target.parentElement;
    while (el && el !== document.body) {
      link = el.querySelector('a[href*="/chat/s/"]');
      if (link) {
        lastClickedChatUrl = link.href;
        return;
      }
      el = el.parentElement;
    }
  }

  // Secondary backup for menu injection on any click
  function handleBackupScan() {
    setTimeout(() => {
      if (typeof document === "undefined") return;
      document.querySelectorAll(".ds-dropdown-menu").forEach((menu) => {
        injectOptions(menu);
        injectSettingsDrawerOptions(menu);
      });
    }, 100);
  }

  document.addEventListener("mousedown", captureLinkFromClick, true);
  document.addEventListener("click", handleBackupScan, true);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) {
          if (node.classList.contains("ds-dropdown-menu")) {
            injectOptions(node);
            injectSettingsDrawerOptions(node);
          } else {
            const menu = node.querySelector(".ds-dropdown-menu");
            if (menu) {
              injectOptions(menu);
              injectSettingsDrawerOptions(menu);
            }
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial check for pending exports
  checkPendingExport();

  return function cleanup() {
    document.removeEventListener("mousedown", captureLinkFromClick, true);
    document.removeEventListener("click", handleBackupScan, true);
    observer.disconnect();
  };
}

async function handleExportAction(format) {
  const targetUrl = lastClickedChatUrl;
  if (!targetUrl) {
    console.warn("[BDS] handleExportAction: no chat URL captured — three-dot button may be outside chat link");
    return;
  }

  // For selection mode
  if (format === "selection") {
    if (window.location.href === targetUrl) {
      window.dispatchEvent(new CustomEvent("bds:toggleSelectionMode"));
    } else {
      await setPendingExport(targetUrl, format);
      window.location.href = targetUrl;
    }
    return;
  }

  if (window.location.href === targetUrl) {
    exportSession(format);
  } else {
    await setPendingExport(targetUrl, format);
    window.location.href = targetUrl;
  }
}

function injectOptions(menu) {
  if (menu.querySelector(".bds-export-option")) return;

  // BDS-UI F.5 / D.6: chat-only entries. Without this guard the Tags / Export
  // Chat rows leaked into the sidebar account popover whenever no "Delete"
  // option existed to anchor them (they were appended to the end instead).
  if (!isChatContextMenu(menu)) return;

  const deleteOption = Array.from(
    menu.querySelectorAll(".ds-dropdown-menu-option")
  ).find((opt) =>
    opt.querySelector(".ds-dropdown-menu-option__label")?.textContent.toLowerCase().includes("delete")
  );

  const insertBefore = deleteOption || null;

  // Tags option
  const tagsOption = createMenuOption(i18n.t('sidebarMenu.tags'), TAG_ICON, "bds-tags-option", () => {
    if (!lastClickedChatUrl) {
      console.warn("[BDS] Tags action: no chat URL captured — three-dot button may be outside chat link");
      return;
    }
    // Dismiss the dropdown by clicking the body — lets React close it naturally
    // (force-removing DOM nodes crashes React's reconciliation)
    document.body.click();
    // Open the tag editor after a small delay to let React clean up
    const url = lastClickedChatUrl;
    setTimeout(() => openTagEditor(url), 50);
  });

  const exportOption = createMenuOption(i18n.t('sidebarMenu.exportChat'), SELECTION_ICON, "bds-export-option", () => {
    handleExportAction("selection");
  });

  // Insert: Tags first, then Export, both before Delete
  tagsOption.style.borderTop = "1px solid rgba(0,0,0,0.05)";
  tagsOption.style.marginTop = "4px";
  tagsOption.style.paddingTop = "8px";

  menu.insertBefore(tagsOption, insertBefore);
  menu.insertBefore(exportOption, insertBefore);
}

function injectSettingsDrawerOptions(menu) {
  if (!menu || menu.querySelector(".bds-plugins-option")) return;

  // BDS-UI F.5: the account popover carries exactly two BDS-owned entries —
  // "Plugins" and "Advanced Settings". "Official Settings" and "Log out" stay
  // native/untouched (never intercepted) and are used only as anchors.
  //
  // Get BDS App and What's New deliberately do NOT live here any more; they
  // were relocated to the drawer footer next to the GitHub link.
  if (!isAccountMenu(menu)) return;

  const options = Array.from(menu.querySelectorAll(".ds-dropdown-menu-option"));
  const labelOf = (opt) =>
    (opt.querySelector(".ds-dropdown-menu-option__label")?.textContent || "").trim().toLowerCase();
  const anchor =
    options.find((opt) => menuHasAnyLabel([labelOf(opt)], ACCOUNT_MENU_SETTINGS_LABELS)) ||
    options.find((opt) => menuHasAnyLabel([labelOf(opt)], ACCOUNT_MENU_LOGOUT_LABELS)) ||
    null;

  if (!anchor) return;

  const openSection = (section) => {
    dismissNativeMenu();
    // Let React finish closing the popover before the drawer animates in.
    setTimeout(() => {
      if (appState.ui?.openDrawerSection) {
        appState.ui.openDrawerSection(section);
      }
    }, 50);
  };

  const advancedOption = createMenuOption(
    i18n.t('sidebarMenu.advancedSettings'),
    ADVANCED_ICON,
    "bds-advanced-settings-option",
    () => openSection("advanced")
  );

  const pluginsOption = createMenuOption(
    i18n.t('sidebarMenu.plugins'),
    PLUGINS_ICON,
    "bds-plugins-option",
    () => openSection("plugins")
  );

  // Locked order (BDS-UI F.5): Plugins, then Advanced Settings, then the
  // native Official Settings / Log out rows.
  anchor.parentNode.insertBefore(pluginsOption, anchor);
  anchor.parentNode.insertBefore(advancedOption, anchor);
}

function createMenuOption(label, iconHtml, className, onClick) {
  const opt = document.createElement("div");
  opt.className = `ds-dropdown-menu-option ds-dropdown-menu-option--none ${className}`;
  
  opt.innerHTML = `
    <div class="ds-dropdown-menu-option__icon">${iconHtml}</div>
    <div class="ds-dropdown-menu-option__label">${label}</div>
  `;

  opt.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });

  return opt;
}
