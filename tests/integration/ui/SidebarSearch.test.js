// @vitest-environment jsdom

/**
 * BDS-UI F.3 — the long custom BDS sidebar search bar must not mount by
 * default. The native compact search icon stays untouched; only the extra
 * full-width BDS field (with tag filtering) is gated off. The module keeps its
 * exports so scanner rescans and the tag manager stay untouched.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/content/bridge.js", () => ({ pushConfigToPage: vi.fn() }));

import {
  initSidebarSearch,
  injectSearchInput,
  renderTagChips,
} from "../../../src/content/ui/SidebarSearch.js";
import { resetAppState } from "../../helpers/app-state.js";

/** Sidebar markup the injector looks for: the native "New Chat" row. */
function buildSidebar() {
  const sidebar = document.createElement("div");
  sidebar.className = "_262baab";
  sidebar.innerHTML = `
    <a class="bds-logo-link" href="/">
      <svg viewBox="0 0 1 1"><path d="M8 0.599609M0 0"></path></svg>
    </a>
    <div id="chat-list"></div>
  `;
  document.body.appendChild(sidebar);
}

describe("SidebarSearch mounting (BDS-UI F.3)", () => {
  beforeEach(() => {
    resetAppState({ ui: { showToast: vi.fn() } });
    document.body.innerHTML = "";
  });

  it("does not inject the long BDS search bar on init", () => {
    buildSidebar();
    initSidebarSearch();

    expect(document.getElementById("bds-sidebar-search-container")).toBeNull();
    expect(document.querySelector(".bds-sidebar-search-wrapper")).toBeNull();
    expect(document.getElementById("bds-sidebar-search-input")).toBeNull();
  });

  it("keeps injectSearchInput a no-op for rescans and tag refreshes", () => {
    buildSidebar();
    injectSearchInput();
    injectSearchInput();

    expect(document.querySelectorAll("#bds-sidebar-search-container")).toHaveLength(0);
    expect(document.querySelectorAll(".bds-sidebar-search-wrapper")).toHaveLength(0);
  });

  it("still exports renderTagChips (used by the tag manager refresh hook)", () => {
    expect(typeof renderTagChips).toBe("function");
    expect(() => renderTagChips()).not.toThrow();
  });
});
