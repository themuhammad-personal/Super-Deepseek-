// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  pushConfigToPage: vi.fn(),
}));

const projectManagerMocks = vi.hoisted(() => ({
  getActiveProject: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("../../../src/content/bridge.js", () => bridgeMocks);
vi.mock("../../../src/content/project-manager.js", () => projectManagerMocks);

import AdvancedSettings from "../../../src/content/ui/settings/AdvancedSettings.svelte";
import state from "../../../src/content/state.js";
import { resetAppState } from "../../helpers/app-state.js";
import { renderSvelte, flushUi } from "../../helpers/svelte.js";

describe("AdvancedSettings integration (System Prompts + Skill Set)", () => {
  beforeEach(() => {
    resetAppState({
      ui: { showToast: vi.fn() },
    });
    state.settings.systemPrompt = "Initial prompt";
    state.settings.githubToken = "ghp_secret";
    bridgeMocks.pushConfigToPage.mockReset();
    projectManagerMocks.getActiveProject.mockReset();
    projectManagerMocks.updateProject.mockReset();
    projectManagerMocks.getActiveProject.mockReturnValue({
      id: "p1",
      name: "Project One",
      customInstructions: "Initial project instructions",
    });
    document.body.innerHTML = "";
  });

  it("adds a custom system prompt and saves settings to chrome storage", async () => {
    const { target, cleanup } = renderSvelte(AdvancedSettings);

    target.querySelector(".bds-add-prompt-btn").click();
    await flushUi();

    const nameInput = target.querySelector(".bds-modal-body input");
    nameInput.value = "My Rules";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    const contentArea = target.querySelector(".bds-modal-body textarea");
    contentArea.value = "Be concise and helpful";
    contentArea.dispatchEvent(new Event("input", { bubbles: true }));

    target.querySelector(".bds-modal-footer .bds-btn").click();
    await flushUi();

    target.querySelector("#bds-save-settings").click();
    await flushUi();

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        bds_settings: expect.objectContaining({
          customSystemPrompts: expect.arrayContaining([
            expect.objectContaining({
              name: "My Rules",
              content: "Be concise and helpful",
            }),
          ]),
          activeSystemPromptId: expect.any(String),
        }),
      }),
    );
    expect(bridgeMocks.pushConfigToPage).toHaveBeenCalled();
    expect(state.ui.showToast).toHaveBeenCalledWith("Settings saved.");
    cleanup();
  });
});

describe("AdvancedSettings shell (BDS-UI F.6/F.7)", () => {
  beforeEach(() => {
    resetAppState({ ui: { showToast: vi.fn() } });
    bridgeMocks.pushConfigToPage.mockReset();
    projectManagerMocks.getActiveProject.mockReturnValue(null);
    document.body.innerHTML = "";
  });

  it("renders its own settings shell with no accordion wrapper", async () => {
    const { target, cleanup } = renderSvelte(AdvancedSettings);
    await flushUi();

    expect(target.querySelector("#bds-settings-advanced")).not.toBeNull();
    expect(target.querySelector(".bds-settings-hero-title").textContent).toBe("Advanced Settings");
    // The old open/close advanced accordion is gone.
    expect(target.querySelector(".bds-advanced-toggle")).toBeNull();

    cleanup();
  });

  it("owns System Prompts and the Skill Set, and nothing else (Round-2 scope)", async () => {
    const { target, cleanup } = renderSvelte(AdvancedSettings);
    await flushUi();

    // System Prompts are here…
    expect(target.querySelector(".bds-add-prompt-btn")).not.toBeNull();
    // …the Skill Set library is here…
    expect(target.querySelector("#bds-section-skills")).not.toBeNull();
    expect(target.textContent).toContain("Skill Set");
    // …and none of the ten feature subsections are (they live in Plugins).
    for (const id of [
      "subLanguage", "subChat", "subProjects", "subInjection", "subResearch",
      "subVoice", "subIntegrations", "subCSS", "subMcp", "subUtilities",
    ]) {
      expect(target.querySelector(`[data-bds-section="${id}"]`)).toBeNull();
    }
    expect(target.querySelector("#bds-settings-plugins")).toBeNull();
    expect(target.querySelector("#bds-mcp-inline-max-chars")).toBeNull();

    cleanup();
  });

  it("exposes scrollToSection for its own surfaces", async () => {
    const { target, cleanup, instance } = renderSvelte(AdvancedSettings);
    await flushUi();

    expect(typeof instance.scrollToSection).toBe("function");
    // 'skills' resolves to the Skill Set block inside this system.
    expect(() => instance.scrollToSection("skills")).not.toThrow();
    expect(() => instance.scrollToSection("systemPrompts")).not.toThrow();
    expect(() => instance.scrollToSection("unknown-section")).not.toThrow();

    cleanup();
  });

  it("writes only the system-prompt fields it owns on save", async () => {
    const { target, cleanup } = renderSvelte(AdvancedSettings);
    await flushUi();

    // Values owned by the Plugins system must survive an Advanced save
    // untouched (the two systems share appState.settings).
    state.settings.githubToken = "ghp_untouched";
    state.settings.mcpInlineMaxChars = 4321;

    target.querySelector("#bds-save-settings").click();
    await flushUi();

    const payload = chrome.storage.local.set.mock.calls
      .map((call) => call[0])
      .filter((p) => p && p.bds_settings)
      .pop();
    expect(payload).toBeTruthy();
    expect(payload.bds_settings).toHaveProperty("systemPromptTemplateVersion");
    expect(payload.bds_settings.githubToken).toBe("ghp_untouched");
    expect(payload.bds_settings.mcpInlineMaxChars).toBe(4321);

    cleanup();
  });

  it("guards closing when system prompts are dirty", async () => {
    const { target, cleanup, instance } = renderSvelte(AdvancedSettings);
    await flushUi();

    await expect(instance.checkBeforeClose()).resolves.toBe(true);

    target.querySelector(".bds-add-prompt-btn").click();
    await flushUi();
    const nameInput = target.querySelector(".bds-modal-body input");
    nameInput.value = "Dirty";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    await flushUi();

    cleanup();
  });
});

