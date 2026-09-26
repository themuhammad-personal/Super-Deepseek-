import { exportSession } from "../tools/exporter.js";
import { setPendingExport, checkPendingExport } from "../tools/pending-export.js";
import { openTagEditor } from "../tags/tag-editor.js";
import { i18n } from "../../lib/i18n.svelte.js";
import appState from "../state.js";
import { devLog } from "../../lib/dev-log.js";

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

// ── Menu discrimination (BDS-UI F.5 · locale-proof, Round-2 B.1/B.2) ───────
//
// DeepSeek draws the chat-context menu (three-dot on a chat row) and the
// sidebar account popover with the same `.ds-dropdown-menu` component and the
// same hashed class names, and it *translates every native label*. Matching the
// English words alone therefore stops working the moment DeepSeek's UI language
// is anything but English: on Bengali no BDS entry was injected at all.
//
// Detection is tiered, strongest signal first (the same shape as
// scanner.js::isDeepThinkControl, which pairs an SVG signature with a
// documented text fallback):
//
//   T1 · trigger context — captured on `mousedown`, before the popover opens:
//        a chat-row three-dot lives inside / right next to an
//        `a[href*="/chat/s/"]`, the account row is a sidebar control that shows
//        the signed-in user's avatar. Neither fact is translatable.
//   T2 · popover structure — the account popover carries the user block
//        (avatar image, `*avatar*` / `*user*` / `*profile*` / `*account*` class
//        or the account's e-mail address); a chat-row menu never does.
//   T3 · English labels — kept as the documented best-effort fallback for
//        exotic DOM layouts and for the English test fixtures.
//
// A T1 "chat" hit vetoes the account test, so BDS rows can never land in the
// wrong popover even when both are on screen at once.

/** English labels — T3 fallback only; never the primary signal. */
const ACCOUNT_MENU_LOGOUT_LABELS = ["log out", "logout", "sign out", "log-out"];
const ACCOUNT_MENU_SETTINGS_LABELS = ["settings"];
const ACCOUNT_MENU_HELP_LABELS = ["help & feedback", "help and feedback"];
const CHAT_MENU_LABELS = ["delete", "rename"];

const CHAT_LINK_SELECTOR = 'a[href*="/chat/s/"]';
/** Anything DeepSeek renders an icon-button / menu trigger with. */
const MENU_TRIGGER_SELECTOR =
  'button, [role="button"], [aria-haspopup], .ds-icon-button, .ds-button';
/** How far up from a trigger we look for the row that owns it. */
const TRIGGER_CHAT_DEPTH = 2;
const TRIGGER_USER_DEPTH = 3;
const USER_HINT_RE = /avatar|user|profile|account/i;
const USER_BLOCK_SELECTOR =
  'img, [class*="avatar" i], [class*="user" i], [class*="profile" i], [class*="account" i]';
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

/** Attribute markers BDS writes onto native rows (never React-owned). */
export const HIDDEN_ENTRY_ATTR = "data-bds-hidden-entry";
export const OFFICIAL_SETTINGS_ATTR = "data-bds-official-settings";

/**
 * The most recent classified trigger. A popover opens within a few hundred ms
 * of the press that caused it, so the memory is deliberately short-lived — a
 * stale "chat" must never veto an account popover opened later.
 */
const MENU_TRIGGER_TTL_MS = 2000;
let lastMenuTrigger = null;

function rememberMenuTrigger(kind) {
  lastMenuTrigger = { kind, at: Date.now() };
}

function isElementNode(node) {
  return Boolean(node && node.nodeType === 1);
}

function classHint(node) {
  const className = node && typeof node.className === "string" ? node.className : "";
  const testId = node?.getAttribute?.("data-testid") || "";
  return `${className} ${testId}`;
}

/** An avatar-ish image: the sidebar account row is the only one DeepSeek has. */
function isUserishImage(img) {
  const hint = `${classHint(img)} ${img.getAttribute?.("src") || ""} ${img.getAttribute?.("alt") || ""}`;
  return USER_HINT_RE.test(hint);
}

/** True when the node itself renders or contains the signed-in user's block. */
function hasUserSignal(node) {
  if (!isElementNode(node)) return false;
  if (USER_HINT_RE.test(classHint(node))) return true;
  if (node.tagName === "IMG" && isUserishImage(node)) return true;
  if (node.querySelector?.('img[class*="avatar" i], img[src*="avatar" i], img[alt*="avatar" i]')) {
    return true;
  }
  if (node.querySelector?.('[class*="avatar" i], [class*="user" i], [class*="profile" i], [class*="account" i]')) {
    return true;
  }
  return false;
}

/** `true` when a class/id/data hook looks like an avatar/user element. */
function looksUserish(node) {
  return isElementNode(node) && USER_HINT_RE.test(classHint(node));
}

function menuOptionLabels(menu) {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll(".ds-dropdown-menu-option__label"))
    .map((node) => (node.textContent || "").trim().toLowerCase())
    .filter(Boolean);
}

function menuHasAnyLabel(labels, needles) {
  return needles.some((needle) => labels.some((label) => label.includes(needle)));
}

/** Native option rows only — never the rows BDS itself injected. */
function nativeOptionRows(menu) {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll(".ds-dropdown-menu-option")).filter(
    (opt) => !Array.from(opt.classList).some((name) => name.startsWith("bds-")),
  );
}

/** The user's own identity block — never relabelled and never hidden. */
function isUserHeaderRow(row) {
  if (!row) return false;
  if (looksUserish(row)) return true;
  if (row.querySelector?.("img") && Array.from(row.querySelectorAll("img")).some(isUserishImage)) {
    return true;
  }
  const label = row.querySelector(".ds-dropdown-menu-option__label");
  return EMAIL_RE.test(label?.textContent || "");
}

/**
 * T2: a popover that shows the signed-in user is the account popover. Chat-row
 * menus only ever list actions on a conversation.
 */
function hasAccountStructure(menu) {
  if (!menu) return false;
  if (menu.querySelector('[class*="avatar" i], [class*="user" i], [class*="profile" i], [class*="account" i]')) {
    return true;
  }
  if (Array.from(menu.querySelectorAll("img")).some(isUserishImage)) return true;
  return EMAIL_RE.test(menu.textContent || "");
}

/** True only for the sidebar account/profile popover. */
export function isAccountMenu(menu) {
  if (!menu) return false;
  // Self-identifying: it already carries a BDS account entry.
  if (menu.querySelector(".bds-plugins-option, .bds-advanced-settings-option")) return true;

  const labels = menuOptionLabels(menu);
  const englishChat = menuHasAnyLabel(labels, CHAT_MENU_LABELS);
  const englishAccount =
    menuHasAnyLabel(labels, ACCOUNT_MENU_LOGOUT_LABELS) ||
    menuHasAnyLabel(labels, ACCOUNT_MENU_SETTINGS_LABELS);

  // T1 veto: a popover opened from a chat row is never the account menu.
  const triggerKind = getLastMenuTriggerKind();
  if (triggerKind === "chat") return false;
  if (triggerKind === "account") return !englishChat;

  // T2: the user block is language-independent.
  if (hasAccountStructure(menu)) {
    return !englishChat && !menuHasAnyLabel(labels, ACCOUNT_MENU_HELP_LABELS);
  }

  // T3: English labels, best effort.
  if (englishChat) return false;
  return englishAccount;
}

/** True only for a chat-row context menu (three-dot menu next to a chat). */
export function isChatContextMenu(menu) {
  if (!menu) return false;
  // Self-identifying: it already carries a BDS chat entry.
  if (menu.querySelector(".bds-export-option, .bds-tags-option")) return true;

  const labels = menuOptionLabels(menu);
  const englishChat = menuHasAnyLabel(labels, CHAT_MENU_LABELS);
  const englishAccount =
    menuHasAnyLabel(labels, ACCOUNT_MENU_LOGOUT_LABELS) ||
    menuHasAnyLabel(labels, ACCOUNT_MENU_SETTINGS_LABELS);

  // T1: the trigger decides when we know where the popover came from.
  const triggerKind = getLastMenuTriggerKind();
  if (triggerKind === "chat") return !englishAccount;
  if (triggerKind === "account") return englishChat;

  // T2/T3 without a trigger context: never claim a popover that shows the user.
  if (englishAccount) return false;
  if (hasAccountStructure(menu)) return false;
  return englishChat;
}

/**
 * Classifies the element a popover was opened from: `"account"`, `"chat"` or
 * `null` when the trigger carries no structural hint. Runs on every mousedown,
 * so it must stay cheap and must never throw.
 */
export function classifyMenuTrigger(target) {
  if (!isElementNode(target)) return null;
  const trigger = target.closest?.(MENU_TRIGGER_SELECTOR) || target;

  // Chat row: inside the chat link, or a sibling in the same row container.
  if (trigger.closest?.(CHAT_LINK_SELECTOR)) return "chat";
  let node = trigger.parentElement;
  for (let depth = 0; node && node !== document.body && depth < TRIGGER_CHAT_DEPTH; depth += 1) {
    if (node.querySelector?.(CHAT_LINK_SELECTOR)) return "chat";
    node = node.parentElement;
  }

  // Account row: a sidebar control that renders the user's avatar.
  node = trigger;
  for (let depth = 0; node && node !== document.body && depth <= TRIGGER_USER_DEPTH; depth += 1) {
    if (hasUserSignal(node)) return "account";
    node = node.parentElement;
  }

  return null;
}

export function getLastMenuTriggerKind() {
  if (!lastMenuTrigger) return null;
  return Date.now() - lastMenuTrigger.at <= MENU_TRIGGER_TTL_MS ? lastMenuTrigger.kind : null;
}

/** Test hook: forget the last classified trigger. */
export function resetLastMenuTriggerKind() {
  lastMenuTrigger = null;
}

/**
 * B.2: the native "Settings" entry is relabelled "Official Settings" (i18n) so
 * it can never be confused with the BDS screens. Only the label text node is
 * replaced, and the check re-runs on *every* scan because React re-renders the
 * popover (restoring the native text) on each open.
 */
function relabelNativeSettingsRow(row) {
  if (!row) return;
  const labelNode = row.querySelector(".ds-dropdown-menu-option__label");
  if (!labelNode) return;
  const official = i18n.t("sidebarMenu.officialSettings");
  if (!official) return;
  const current = (labelNode.textContent || "").trim();
  if (current !== official) {
    labelNode.textContent = official;
    devLog("SidebarMenu", "relabelled native settings row", JSON.stringify(current), "->", official);
  }
  row.setAttribute(OFFICIAL_SETTINGS_ATTR, "");
}

/**
 * Hides native account entries that are neither the first ("Official
 * Settings") nor the last ("Log out") one — e.g. "Report issue" or "Download
 * mobile App". Those labels are translated, so the rule is positional: the
 * popover must end up with exactly Plugins / Advanced Settings / Official
 * Settings / Log out in every locale.
 */
function hideAccountEntry(row) {
  if (!row || row.hasAttribute(HIDDEN_ENTRY_ATTR)) return;
  row.setAttribute(HIDDEN_ENTRY_ATTR, "");
  devLog("SidebarMenu", "hid extra account entry", JSON.stringify((row.textContent || "").trim()));
}

/**
 * Insertion anchor for Tags / Export inside a chat menu: the destructive row
 * ("Delete") when DeepSeek marks it as such, otherwise the last native row —
 * both keep the BDS entries above DeepSeek's destructive action without reading
 * a translated label.
 */
function findChatInsertAnchor(menu) {
  const rows = nativeOptionRows(menu).filter((row) =>
    row.querySelector(".ds-dropdown-menu-option__label"),
  );
  if (!rows.length) return null;
  const dangerRow = rows.find((row) => /danger|destructive|delete/i.test(classHint(row)));
  return dangerRow || rows[rows.length - 1];
}

/** Lets React close the native dropdown instead of force-removing DOM nodes. */
function dismissNativeMenu() {
  document.body.click();
}

export function initSidebarMenuInjector() {
  // Capture the chat URL *and* the kind of popover the press will open. Both
  // run on mousedown so they are known before DeepSeek renders the menu; the
  // URL is what Export/Tags act on, the kind is what makes menu detection
  // locale-proof (T1, see the classifier above).
  function captureTriggerContext(e) {
    // T1 of the menu discriminator is resolved first: the early returns below
    // (chat-link fast path) would otherwise skip it, which is exactly the
    // layout the three-dot button uses on a chat row.
    const kind = classifyMenuTrigger(e.target);
    if (kind) {
      rememberMenuTrigger(kind);
      devLog("SidebarMenu", "menu trigger kind:", kind);
    }

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

  document.addEventListener("mousedown", captureTriggerContext, true);
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
    document.removeEventListener("mousedown", captureTriggerContext, true);
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

  // Locale-proof anchor (Round-2 B.1): the destructive row when DeepSeek marks
  // it, else the last native row. The English "Delete" match was the only
  // signal before, so Tags/Export vanished in every non-English locale.
  const insertBefore = findChatInsertAnchor(menu);

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
  if (!menu) return;

  // B.2 must run on every scan, even after the BDS rows were injected: React
  // re-renders the popover on each open and would otherwise restore the native
  // "Settings" label.
  if (!isAccountMenu(menu)) return;

  const rows = nativeOptionRows(menu).filter((row) =>
    row.querySelector(".ds-dropdown-menu-option__label"),
  );
  if (!rows.length) return;

  // The signed-in user's own block (avatar / name / e-mail) is not a menu
  // entry: never relabel it, never hide it.
  const entries = rows.filter((row) => !isUserHeaderRow(row));
  if (!entries.length) return;

  const settingsRow = entries[0];
  const logoutRow = entries.length > 1 ? entries[entries.length - 1] : null;

  relabelNativeSettingsRow(settingsRow);

  // Exactly Plugins / Advanced Settings / Official Settings / Log out.
  for (const row of entries.slice(1, logoutRow ? -1 : entries.length)) {
    hideAccountEntry(row);
  }

  if (menu.querySelector(".bds-plugins-option")) return;

  // BDS-UI F.5: the account popover carries exactly two BDS-owned entries.
  // "Official Settings" and "Log out" stay native/untouched and are used only
  // as anchors. Get BDS App and What's New deliberately live in the drawer
  // footer instead.
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
  settingsRow.parentNode.insertBefore(pluginsOption, settingsRow);
  settingsRow.parentNode.insertBefore(advancedOption, settingsRow);

  devLog("SidebarMenu", "injected account entries before", JSON.stringify((settingsRow.textContent || "").trim()));
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
