// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  pushConfigToPage: vi.fn(),
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

import App from "../../../src/content/ui/App.svelte";
import { resetAppState } from "../../helpers/app-state.js";
import { renderSvelte, flushUi } from "../../helpers/svelte.js";

/** Drawer close runs through the async unsaved-changes guards of both settings
 *  systems, so the assertion needs one macrotask, not just microtasks. */
async function flushGuards() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushUi();
}

describe("App drawer entry points (BDS-UI F.4)", () => {
  beforeEach(() => {
    resetAppState({ ui: { showToast: vi.fn() } });
    bridgeMocks.pushConfigToPage.mockReset();
    document.body.innerHTML = "";
  });

  it("no longer renders a floating #bds-toggle settings trigger", async () => {
    const { target, cleanup } = renderSvelte(App);
    await flushUi();

    expect(target.querySelector("#bds-toggle")).toBeNull();
    expect(document.querySelector("#bds-toggle")).toBeNull();

    cleanup();
  });

  it("keeps the drawer closed until an entry point opens it", async () => {
    const { target, cleanup } = renderSvelte(App);
    await flushUi();

    expect(target.querySelector("#bds-drawer").className).toContain("bds-closed");

    cleanup();
  });

  it("openDrawerSection opens the drawer and forwards the section", async () => {
    const { target, cleanup, instance } = renderSvelte(App);
    await flushUi();

    expect(typeof instance.openDrawerSection).toBe("function");
    await instance.openDrawerSection("plugins");
    await flushUi();

    const drawer = target.querySelector("#bds-drawer");
    expect(drawer.className).toContain("bds-open");
    expect(drawer.querySelector("#bds-settings-plugins")).not.toBeNull();

    cleanup();
  });

  it("openDrawer exposes the whole drawer without a section", async () => {
    const { target, cleanup, instance } = renderSvelte(App);
    await flushUi();

    instance.openDrawer();
    await flushUi();

    expect(target.querySelector("#bds-drawer").className).toContain("bds-open");

    cleanup();
  });

  it("close button inside drawer closes it", async () => {
    const { target, cleanup, instance } = renderSvelte(App);
    await flushUi();

    await instance.openDrawerSection("advanced");
    await flushUi();
    expect(target.querySelector("#bds-drawer").className).toContain("bds-open");

    target.querySelector("#bds-close").click();
    await flushGuards();
    expect(target.querySelector("#bds-drawer").className).toContain("bds-closed");

    cleanup();
  });

  it("layers both settings systems inside the drawer as separate components", async () => {
    const { target, cleanup, instance } = renderSvelte(App);
    await flushUi();

    await instance.openDrawerSection("advanced");
    await flushUi();

    const advanced = target.querySelector("#bds-settings-advanced");
    const plugins = target.querySelector("#bds-settings-plugins");
    expect(advanced).not.toBeNull();
    expect(plugins).not.toBeNull();
    // Physically separate systems, each with its own save button.
    expect(advanced.querySelector("#bds-save-settings")).not.toBeNull();
    expect(plugins.querySelector("#bds-save-plugins")).not.toBeNull();

    cleanup();
  });
});
