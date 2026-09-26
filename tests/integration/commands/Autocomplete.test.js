// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushUi, renderSvelte } from "../../helpers/svelte.js";
import { resetAppState } from "../../helpers/app-state.js";
import Autocomplete from "../../../src/content/commands/Autocomplete.svelte";
import state from "../../../src/content/state.js";

const mockExecute = vi.hoisted(() => vi.fn());
const mockInjectText = vi.hoisted(() => vi.fn());
vi.mock("../../../src/content/commands/executor.js", () => ({
  tryExecuteRawInput: mockExecute,
}));
vi.mock("../../../src/content/auto.js", () => ({
  injectPureTextAndSend: mockInjectText,
}));

async function setup() {
  const editor = document.createElement("textarea");
  document.body.appendChild(editor);
  const { target, cleanup } = renderSvelte(Autocomplete, { editor });
  await flushUi();
  return { editor, target, cleanup };
}

function type(editor, text) {
  editor.value = text;
  editor.setSelectionRange(text.length, text.length);
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("Autocomplete", () => {
  beforeEach(() => {
    resetAppState();
    mockExecute.mockReset();
    mockInjectText.mockReset();
    document.body.innerHTML = "";
  });

  it("opens dropdown when / is typed at start", async () => {
    const { editor, target, cleanup } = await setup();
    type(editor, "/");
    await flushUi();
    expect(target.querySelector(".bds-cmd-dropdown")).toBeTruthy();
    cleanup();
  });

  it("stays closed when typing plain text", async () => {
    const { editor, target, cleanup } = await setup();
    type(editor, "hello");
    await flushUi();
    expect(target.querySelector(".bds-cmd-dropdown")).toBeFalsy();
    cleanup();
  });

  it("stays closed when slash is not at start of input", async () => {
    const { editor, target, cleanup } = await setup();
    type(editor, "abc /def");
    await flushUi();
    expect(target.querySelector(".bds-cmd-dropdown")).toBeFalsy();
    cleanup();
  });

  it("stays closed when pasting a URL with slash", async () => {
    const { editor, target, cleanup } = await setup();
    type(editor, "https://example.com");
    await flushUi();
    expect(target.querySelector(".bds-cmd-dropdown")).toBeFalsy();
    cleanup();
  });

  it("filters commands based on query", async () => {
    const { editor, target, cleanup } = await setup();
    type(editor, "/se");
    await flushUi();
    const dropdown = target.querySelector(".bds-cmd-dropdown");
    expect(dropdown).toBeTruthy();
    expect(dropdown.textContent).toContain("/search");
    cleanup();
  });

  it("closes dropdown when space is typed after command", async () => {
    const { editor, target, cleanup } = await setup();
    type(editor, "/search ");
    await flushUi();
    expect(target.querySelector(".bds-cmd-dropdown")).toBeFalsy();
    cleanup();
  });

  it("closes dropdown on blur after the tap-then-click grace period", async () => {
    const { editor, target, cleanup } = await setup();
    type(editor, "/");
    await flushUi();
    expect(target.querySelector(".bds-cmd-dropdown")).toBeTruthy();
    editor.dispatchEvent(new Event("blur"));
    // Round-2 B.3: blur is deferred so a tap inside the list can still land.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flushUi();
    expect(target.querySelector(".bds-cmd-dropdown")).toBeFalsy();
    cleanup();
  });

  it("keeps the list mounted through the real mousedown → blur → click order", async () => {
    const { editor, target, cleanup } = await setup();
    type(editor, "/");
    await flushUi();

    const helpItem = Array.from(target.querySelectorAll(".bds-cmd-item")).find((item) =>
      item.textContent.includes("/help"),
    );
    expect(helpItem).toBeTruthy();

    const helpEvents = [];
    const onHelp = () => helpEvents.push("help");
    window.addEventListener("bds:show-help", onHelp);

    // Exactly what a phone does when the finger lands on a list item: the
    // mousedown moves focus, the editor blurs, then the click is dispatched.
    const downEvent = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    helpItem.dispatchEvent(downEvent);
    expect(downEvent.defaultPrevented).toBe(true); // focus stays on the editor
    editor.dispatchEvent(new Event("blur"));
    await flushUi();
    // …so the tapped button is still in the DOM when the click arrives.
    expect(target.querySelector(".bds-cmd-dropdown")).toBeTruthy();

    helpItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushUi();

    expect(helpEvents).toEqual(["help"]);
    expect(target.querySelector(".bds-cmd-dropdown")).toBeFalsy(); // selectCurrent() ran
    window.removeEventListener("bds:show-help", onHelp);
    cleanup();
  });

  it("cancels the pending blur when a pointer presses inside the list", async () => {
    const { editor, target, cleanup } = await setup();
    type(editor, "/");
    await flushUi();

    const item = target.querySelector(".bds-cmd-item");
    editor.dispatchEvent(new Event("blur"));
    item.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flushUi();

    expect(target.querySelector(".bds-cmd-dropdown")).toBeTruthy();
    cleanup();
  });

  it("closes dropdown on Escape key", async () => {
    const { editor, target, cleanup } = await setup();
    type(editor, "/");
    await flushUi();
    expect(target.querySelector(".bds-cmd-dropdown")).toBeTruthy();
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushUi();
    expect(target.querySelector(".bds-cmd-dropdown")).toBeFalsy();
    cleanup();
  });

  it("executes zero-arg command on Enter selection", async () => {
    const { editor, target, cleanup } = await setup();
    type(editor, "/n");
    await flushUi();
    const dropdown = target.querySelector(".bds-cmd-dropdown");
    expect(dropdown).toBeTruthy();
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flushUi();
    expect(mockExecute).toHaveBeenCalledWith("/new");
    cleanup();
  });

  it("inserts command prefix when selecting arg-required command", async () => {
    const { editor, target, cleanup } = await setup();
    type(editor, "/sea");
    await flushUi();
    const dropdown = target.querySelector(".bds-cmd-dropdown");
    expect(dropdown).toBeTruthy();
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await flushUi();
    expect(editor.value).toBe("/search ");
    cleanup();
  });

  it("navigates items with arrow keys", async () => {
    const { editor, target, cleanup } = await setup();
    type(editor, "/");
    await flushUi();
    const dropdown = target.querySelector(".bds-cmd-dropdown");
    expect(dropdown).toBeTruthy();
    const items = dropdown.querySelectorAll(".bds-cmd-item");
    expect(items.length).toBeGreaterThan(1);
    expect(items[0].classList.contains("bds-cmd-item--selected")).toBe(true);
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await flushUi();
    expect(items[1].classList.contains("bds-cmd-item--selected")).toBe(true);
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    await flushUi();
    expect(items[0].classList.contains("bds-cmd-item--selected")).toBe(true);
    cleanup();
  });

  it("shows and selects snippet commands", async () => {
    state.commands.customMappings = { greet: "snippet-1" };
    state.savedItems = [{ id: "snippet-1", title: "Greeting", content: "Hello!" }];
    const { editor, target, cleanup } = await setup();
    type(editor, "/gr");
    await flushUi();
    const dropdown = target.querySelector(".bds-cmd-dropdown");
    expect(dropdown).toBeTruthy();
    expect(dropdown.textContent).toContain("/greet");
    const snippetItem = dropdown.querySelector(".bds-cmd-item--snippet");
    expect(snippetItem).toBeTruthy();
    snippetItem.click();
    await flushUi();
    expect(mockInjectText).toHaveBeenCalledWith("Hello!", "/greet");
    cleanup();
  });
});
