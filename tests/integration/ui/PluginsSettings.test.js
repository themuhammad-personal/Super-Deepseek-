// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  pushConfigToPage: vi.fn(),
  discoverMcpToolSchemas: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/content/bridge.js", () => bridgeMocks);

import PluginsSettings from "../../../src/content/ui/settings/PluginsSettings.svelte";
import state from "../../../src/content/state.js";
import { resetAppState } from "../../helpers/app-state.js";
import { renderSvelte, flushUi } from "../../helpers/svelte.js";

const SERVER = {
  id: "mcp_1",
  name: "Local Tools",
  serverUrl: "https://mcp.example.com/sse",
  apiKey: "",
  enabled: true,
  tools: [{ name: "ping", description: "", inputSchema: {} }],
};

/** flushUi() only drains microtasks; the save/refresh chains await storage. */
async function settle() {
  await flushUi();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushUi();
}

function lastMcpPayload() {
  return chrome.storage.local.set.mock.calls
    .map((call) => call[0])
    .filter((payload) => payload && payload.bds_mcp_servers)
    .pop();
}

describe("PluginsSettings (BDS-UI F.6)", () => {
  beforeEach(() => {
    resetAppState({
      ui: { showToast: vi.fn(), showConfirm: vi.fn(() => Promise.resolve(true)) },
    });
    state.mcpServers = [{ ...SERVER }];
    state.settings.mcpInlineMaxChars = 8000;
    bridgeMocks.pushConfigToPage.mockReset();
    bridgeMocks.discoverMcpToolSchemas.mockClear();
    document.body.innerHTML = "";
  });

  it("renders its own plugins shell and save button", async () => {
    const { target, cleanup } = renderSvelte(PluginsSettings);
    await settle();

    expect(target.querySelector("#bds-settings-plugins")).not.toBeNull();
    expect(target.querySelector(".bds-settings-hero-title").textContent).toBe("Plugins");
    expect(target.querySelector("#bds-save-plugins")).not.toBeNull();
    // Split settings: the advanced panel is a separate component/system.
    expect(target.querySelector("#bds-settings-advanced")).toBeNull();
    expect(target.querySelector(".bds-plugin-name").textContent).toBe("Local Tools");

    cleanup();
  });

  it("saves the inline max chars value through its own save button", async () => {
    const { target, cleanup } = renderSvelte(PluginsSettings);
    await settle();

    const inlineInput = target.querySelector("#bds-mcp-inline-max-chars");
    inlineInput.value = "120000";
    inlineInput.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();

    target.querySelector("#bds-save-plugins").click();
    await settle();

    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({
        bds_settings: expect.objectContaining({ mcpInlineMaxChars: 100000 }),
      }),
    );
    expect(bridgeMocks.pushConfigToPage).toHaveBeenCalled();
    cleanup();
  });

  it("adds an MCP server through the editor modal and persists it", async () => {
    const { target, cleanup } = renderSvelte(PluginsSettings);
    await settle();

    target.querySelector(".bds-add-prompt-btn").click();
    await settle();

    const inputs = Array.from(target.querySelectorAll(".bds-modal-body input"));
    inputs[0].value = "Remote Tools";
    inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    inputs[1].value = "https://remote.example.com/sse";
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    await settle();

    target.querySelector(".bds-modal-footer .bds-btn").click();
    await settle();

    const saved = lastMcpPayload();
    expect(saved).toBeTruthy();
    expect(saved.bds_mcp_servers).toHaveLength(2);
    expect(saved.bds_mcp_servers[1]).toEqual(
      expect.objectContaining({
        name: "Remote Tools",
        serverUrl: "https://remote.example.com/sse",
      }),
    );
    expect(state.mcpServers).toHaveLength(2);
    expect(bridgeMocks.pushConfigToPage).toHaveBeenCalled();
    cleanup();
  });

  it("deletes an MCP server after the confirmation prompt", async () => {
    const { target, cleanup } = renderSvelte(PluginsSettings);
    await settle();

    target.querySelector(".bds-plugin-actions .bds-btn-danger").click();
    await settle();

    const saved = lastMcpPayload();
    expect(saved).toBeTruthy();
    expect(saved.bds_mcp_servers).toHaveLength(0);
    expect(state.mcpServers).toHaveLength(0);
    cleanup();
  });

  it("guards closing when plugin settings are dirty", async () => {
    const { target, cleanup, instance } = renderSvelte(PluginsSettings);
    await settle();

    await expect(instance.checkBeforeClose()).resolves.toBe(true);

    const inlineInput = target.querySelector("#bds-mcp-inline-max-chars");
    inlineInput.value = "9000";
    inlineInput.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();

    const pending = instance.checkBeforeClose();
    await settle();
    const modal = target.querySelector(".bds-unsaved-modal");
    expect(modal).not.toBeNull();

    // "Discard" lets the drawer close.
    modal.querySelector(".bds-btn-danger").click();
    await expect(pending).resolves.toBe(true);

    cleanup();
  });

  it("refreshes from appState and keeps the empty state", async () => {
    const { target, cleanup, instance } = renderSvelte(PluginsSettings);
    await settle();

    state.mcpServers = [
      {
        id: "mcp_2",
        name: "Second",
        serverUrl: "https://second.example.com",
        enabled: true,
        tools: [],
      },
    ];
    instance.refresh();
    await settle();

    expect(target.querySelectorAll(".bds-plugin-card")).toHaveLength(1);
    expect(target.querySelector(".bds-plugin-name").textContent).toBe("Second");

    state.mcpServers = [];
    instance.refresh();
    await settle();

    expect(target.querySelectorAll(".bds-plugin-card")).toHaveLength(0);
    expect(target.querySelector(".bds-plugin-empty")).not.toBeNull();

    cleanup();
  });
});
