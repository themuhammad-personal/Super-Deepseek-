// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushUi, renderSvelte } from "../../helpers/svelte.js";
import ExpandToggle from "../../../src/content/ui/ExpandToggle.svelte";

/**
 * The component polls for the editor once a second and touches the container it
 * will position its overlay against. That write used to happen whenever the
 * container had no *inline* position, which replaced DeepSeek's
 * `position: fixed` composer with `relative` and pushed the whole composer row
 * (including the BDS Plus button) below the fold.
 */
function buildComposer(composerPosition) {
  // The position has to come from a stylesheet (as it does on DeepSeek): the
  // bug was exactly that only the inline style was inspected.
  document.head.innerHTML = `
    <style>.composer-shell { position: ${composerPosition}; }</style>
  `;
  document.body.innerHTML = `
    <section class="composer-shell">
      <div class="ds-textarea"><textarea id="chat-input"></textarea></div>
    </section>
  `;
  return document.querySelector(".composer-shell");
}

async function waitForPoll() {
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await flushUi();
}

describe("ExpandToggle container positioning", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps a fixed composer fixed", async () => {
    const composer = buildComposer("fixed");
    const { cleanup } = renderSvelte(ExpandToggle);
    await flushUi();

    await waitForPoll();

    expect(composer.style.position).toBe("");
    cleanup();
  });

  it("adds a positioning context only to an unpositioned container", async () => {
    const composer = buildComposer("static");
    const { cleanup } = renderSvelte(ExpandToggle);
    await flushUi();

    await waitForPoll();

    expect(composer.style.position).toBe("relative");
    cleanup();
  });
});
