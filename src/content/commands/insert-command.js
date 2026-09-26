/**
 * Shared command-insertion helper (BDS-UI F.1 / F.2).
 *
 * The command system (registry, parser, executor, autocomplete, persistence)
 * stays exactly as it was — this module only exposes the single insertion
 * primitive that used to live privately inside `Drawer.svelte`, so the Upload
 * Drawer's "Command" card and the drawer's command area both call
 * the same implementation instead of duplicating it.
 */

import { findChatEditor, setChatInputText } from "../auto.js";

/**
 * Writes `/<commandId> ` into the chat editor and focuses it.
 *
 * @param {string} commandId
 * @param {{ focus?: boolean }} [options]
 * @returns {boolean} true when the chat editor was found and filled.
 */
export function insertCommandIntoChat(commandId, options = {}) {
  if (!commandId) return false;

  const editor = findChatEditor();
  if (!editor) return false;

  setChatInputText("/" + commandId + " ");
  if (options.focus !== false) {
    editor.focus();
  }
  return true;
}

export default insertCommandIntoChat;
