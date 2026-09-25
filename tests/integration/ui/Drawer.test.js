// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  pushConfigToPage: vi.fn(),
  discoverMcpToolSchemas: vi.fn().mockResolvedValue(undefined),
}));

const projectManagerMocks = vi.hoisted(() => ({
  getActiveProject: vi.fn(() => null),
  updateProject: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  addProjectFilesBatch: vi.fn(),
  deleteProjectFile: vi.fn(),
  getFilesForProject: vi.fn(() => []),
  setActiveProject: vi.fn(),
  clearActiveProject: vi.fn(),
  tickFile: vi.fn(),
  untickFile: vi.fn(),
  clearActiveFiles: vi.fn(),
}));

const scannerMocks = vi.hoisted(() => ({
  scheduleScan: vi.fn(),
  collectMessageNodes: vi.fn(() => []),
  detectMessageRole: vi.fn(),
}));

const exporterMocks = vi.hoisted(() => ({
  exportSession: vi.fn(),
  collectMessages: vi.fn(() => []),
}));

const folderPickerMocks = vi.hoisted(() => ({
  pickFolderSelection: vi.fn(),
  pickFolderAndConcatenate: vi.fn(),
}));

vi.mock("../../../src/content/bridge.js", () => bridgeMocks);
vi.mock("../../../src/content/project-manager.js", () => projectManagerMocks);
vi.mock("../../../src/content/scanner.js", () => scannerMocks);
vi.mock("../../../src/content/tools/exporter.js", () => exporterMocks);
vi.mock("../../../src/lib/utils/folder-picker.js", () => folderPickerMocks);

import Drawer from "../../../src/content/ui/Drawer.svelte";
import { COMMANDS } from "../../../src/content/commands/registry.js";
import { resetAppState } from "../../helpers/app-state.js";
import { renderSvelte, flushUi } from "../../helpers/svelte.js";

function renderDrawer(props = {}) {
  return renderSvelte(Drawer, {
    open: true,
    onclose: vi.fn(),
    onopenapiplayground: vi.fn(),
    ...props,
  });
}

describe("Drawer restructure (BDS-UI F.1/F.2/F.4/F.5)", () => {
  beforeEach(() => {
    resetAppState({ ui: { showToast: vi.fn(), showConfirm: vi.fn(() => Promise.resolve(true)) } });
    bridgeMocks.pushConfigToPage.mockReset();
    projectManagerMocks.getActiveProject.mockReturnValue(null);
    delete process.env.BDS_TARGET;
    document.body.innerHTML = "";
  });

  it("hosts both settings systems as physically separate components", async () => {
    const { target, cleanup } = renderDrawer();
    await flushUi();

    const advanced = target.querySelector("#bds-settings-advanced");
    const plugins = target.querySelector("#bds-settings-plugins");
    expect(advanced).not.toBeNull();
    expect(plugins).not.toBeNull();
    expect(advanced).not.toBe(plugins);
    // Each system owns its surface and its own save button.
    expect(advanced.querySelector("#bds-save-settings")).not.toBeNull();
    expect(advanced.querySelector("#bds-save-plugins")).toBeNull();
    expect(plugins.querySelector("#bds-save-plugins")).not.toBeNull();
    expect(plugins.querySelector("#bds-save-settings")).toBeNull();

    cleanup();
  });

  it("keeps the command list collapsed by default and out of the settings systems", async () => {
    const { target, cleanup, instance } = renderDrawer();
    await flushUi();

    const section = target.querySelector("#bds-section-commands");
    expect(section).not.toBeNull();
    expect(section.querySelector(".bds-featured-list")).toBeNull();
    // BDS-UI F.2: no Commands section inside either settings system.
    expect(target.querySelector("#bds-settings-advanced .bds-featured-list")).toBeNull();
    expect(target.querySelector("#bds-settings-plugins .bds-featured-list")).toBeNull();

    await instance.openDrawerSection("commands");
    await flushUi();

    const list = section.querySelector(".bds-featured-list");
    expect(list).not.toBeNull();
    expect(list.querySelectorAll(".bds-featured-item")).toHaveLength(COMMANDS.length);
    expect(list.textContent).toContain("/" + COMMANDS[0].id);

    cleanup();
  });

  it("inserts a built-in command into the chat editor from the drawer", async () => {
    const editor = document.createElement("textarea");
    editor.id = "chat-input";
    document.body.appendChild(editor);

    const { target, cleanup, instance } = renderDrawer();
    await flushUi();

    await instance.openDrawerSection("commands");
    await flushUi();

    target.querySelector("#bds-section-commands .bds-featured-item").click();
    await flushUi();

    expect(editor.value).toBe("/" + COMMANDS[0].id + " ");

    cleanup();
  });

  it("keeps Get BDS App and What's New in the drawer footer next to GitHub", async () => {
    const openSpy = vi.fn();
    const originalOpen = window.open;
    window.open = openSpy;

    const { target, cleanup } = renderDrawer();
    await flushUi();

    const footer = target.querySelector(".bds-drawer-footer");
    const getApp = footer.querySelector("#bds-get-app-entry");
    const whatsNew = footer.querySelector("#bds-whats-new-entry");
    expect(getApp).not.toBeNull();
    expect(whatsNew).not.toBeNull();
    expect(footer.querySelector(".bds-github-link")).not.toBeNull();
    // The relocated entries sit next to the GitHub link, not in the account menu.
    expect(footer.querySelector(".bds-drawer-footer-actions").contains(getApp)).toBe(true);
    expect(footer.querySelector(".bds-drawer-footer-actions").contains(whatsNew)).toBe(true);

    getApp.click();
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/EdgeTypE/better-deepseek/releases",
      "_blank",
    );

    window.open = originalOpen;
    cleanup();
  });

  it("renders the DeepCode toggle host on non-Android targets", async () => {
    const { target, cleanup } = renderDrawer();
    await flushUi();

    expect(target.querySelector("#bds-section-deepcode")).not.toBeNull();

    cleanup();
  });

  it("keeps the moved Android DeepCode skip branch (one control fewer)", async () => {
    process.env.BDS_TARGET = "android";

    const { target, cleanup } = renderDrawer();
    await flushUi();

    expect(target.querySelector("#bds-section-deepcode")).toBeNull();
    // Everything else stays available on Android.
    expect(target.querySelector("#bds-settings-advanced")).not.toBeNull();
    expect(target.querySelector("#bds-settings-plugins")).not.toBeNull();

    delete process.env.BDS_TARGET;
    cleanup();
  });
});
