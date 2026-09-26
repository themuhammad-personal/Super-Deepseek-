// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushUi, renderSvelte } from "../../helpers/svelte.js";
import { resetAppState } from "../../helpers/app-state.js";
import CommandManager from "../../../src/content/commands/CommandManager.svelte";

describe("CommandManager (BDS drawer)", () => {
  beforeEach(() => {
    resetAppState();
    document.body.innerHTML = "";
  });

  it("closes through the onclose prop Drawer passes (Round-2 B.4)", async () => {
    const onclose = vi.fn();
    const { target, cleanup } = renderSvelte(CommandManager, { onclose });
    await flushUi();

    const closeButton = target.querySelector(".bds-cmd-manager-close");
    expect(closeButton).toBeTruthy();
    closeButton.click();
    await flushUi();

    expect(onclose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("does not declare the old camelCase onClose prop", async () => {
    // Svelte 5 props are case-sensitive: a `$props()` run with the legacyname
    // never matches what Drawer passes, which is why the × used to be dead.
    const onClose = vi.fn();
    const { target, cleanup } = renderSvelte(CommandManager, { onClose });
    await flushUi();

    target.querySelector(".bds-cmd-manager-close")?.click();
    await flushUi();

    expect(onClose).not.toHaveBeenCalled();
    cleanup();
  });

  it("stays silent when no close callback is provided", async () => {
    const { target, cleanup } = renderSvelte(CommandManager, {});
    await flushUi();

    expect(() => target.querySelector(".bds-cmd-manager-close").click()).not.toThrow();
    cleanup();
  });
});
