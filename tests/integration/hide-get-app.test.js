// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hideGetAppButton } from "../../src/android/hide-get-app.js";

function makeGetAppButton() {
  const container = document.createElement("div");
  const button = document.createElement("button");
  button.type = "button";
  const icon = document.createElement("span");
  icon.textContent = "phone-icon";
  const label = document.createElement("span");
  label.textContent = "Get App";
  button.append(icon, label);
  container.appendChild(button);
  document.body.appendChild(container);
  return { container, button, label };
}

describe("hideGetAppButton", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete window.__bdsGetAppObserver;
  });

  afterEach(() => {
    // Disconnect live observer so it doesn't bleed between tests.
    window.__bdsGetAppObserver?.disconnect();
    delete window.__bdsGetAppObserver;
  });

  // ── immediate detection ────────────────────────────────────────────────

  it("hides the container div that wraps the button", () => {
    const { container } = makeGetAppButton();
    hideGetAppButton();
    expect(container.hasAttribute("data-bds-hide")).toBe(true);
  });

  it("hides DeepSeek's div-based ds-button markup", () => {
    const headerActions = document.createElement("div");
    headerActions.className = "_9579690";
    const button = document.createElement("div");
    button.className = "ds-button ds-button--outlinedNeutral ds-button--outlined ds-button--capsule ds-button--m ds-button--icon-relative-m ds-button--min-width ad8d4bfc";
    const label = document.createElement("span");
    label.className = "ds-button__content";
    label.textContent = "Get App";
    button.appendChild(label);
    headerActions.appendChild(button);
    document.body.appendChild(headerActions);

    hideGetAppButton();

    expect(button.hasAttribute("data-bds-hide")).toBe(true);
    expect(headerActions.hasAttribute("data-bds-hide")).toBe(false);
  });

  it("sets __bdsGetAppObserver on window", () => {
    makeGetAppButton();
    hideGetAppButton();
    expect(window.__bdsGetAppObserver).toBeTruthy();
  });

  it("ignores spans whose text does not match 'Get App'", () => {
    const container = document.createElement("div");
    const button = document.createElement("button");
    const span = document.createElement("span");
    span.textContent = "Download App";
    button.appendChild(span);
    container.appendChild(button);
    document.body.appendChild(container);
    hideGetAppButton();
    expect(container.hasAttribute("data-bds-hide")).toBe(false);
  });

  it("does nothing when 'Get App' span has no button ancestor", () => {
    const container = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = "Get App";
    container.appendChild(span);
    document.body.appendChild(container);
    expect(() => hideGetAppButton()).not.toThrow();
    expect(container.hasAttribute("data-bds-hide")).toBe(false);
  });

  it("does not throw when no Get App span exists at all", () => {
    expect(() => hideGetAppButton()).not.toThrow();
  });

  // ── idempotency ────────────────────────────────────────────────────────

  it("skips setup when __bdsGetAppObserver already set", () => {
    const sentinel = { disconnect: vi.fn() };
    window.__bdsGetAppObserver = sentinel;
    const { container } = makeGetAppButton();
    hideGetAppButton();
    expect(container.hasAttribute("data-bds-hide")).toBe(false);
    expect(window.__bdsGetAppObserver).toBe(sentinel);
  });

  // ── MutationObserver: deferred detection ──────────────────────────────

  it("hides container added to DOM after initial call", async () => {
    hideGetAppButton();
    const { container } = makeGetAppButton();
    await vi.waitFor(() => expect(container.hasAttribute("data-bds-hide")).toBe(true));
  });

  it("observer is set immediately (not deferred)", () => {
    hideGetAppButton();
    expect(window.__bdsGetAppObserver).toBeTruthy();
  });

  // ── SPA persistence: observer stays alive after first hide ────────────

  it("re-hides button when removed and re-inserted (SPA nav)", async () => {
    const { container } = makeGetAppButton();
    hideGetAppButton();
    expect(container.hasAttribute("data-bds-hide")).toBe(true);

    container.remove();
    const { container: container2 } = makeGetAppButton();
    await vi.waitFor(() => expect(container2.hasAttribute("data-bds-hide")).toBe(true));
  });

  it("hides all matching instances if multiple exist simultaneously", () => {
    const { container: c1 } = makeGetAppButton();
    const { container: c2 } = makeGetAppButton();
    hideGetAppButton();
    expect(c1.hasAttribute("data-bds-hide")).toBe(true);
    expect(c2.hasAttribute("data-bds-hide")).toBe(true);
  });

  // ── text-content resilience ────────────────────────────────────────────

  it("trims whitespace when matching span text", () => {
    const container = document.createElement("div");
    const button = document.createElement("button");
    const span = document.createElement("span");
    span.textContent = "  Get App  ";
    button.appendChild(span);
    container.appendChild(button);
    document.body.appendChild(container);
    hideGetAppButton();
    expect(container.hasAttribute("data-bds-hide")).toBe(true);
  });

  it("does not hide when text is 'Get App' cased differently", () => {
    const container = document.createElement("div");
    const button = document.createElement("button");
    const span = document.createElement("span");
    span.textContent = "get app";
    button.appendChild(span);
    container.appendChild(button);
    document.body.appendChild(container);
    hideGetAppButton();
    expect(container.hasAttribute("data-bds-hide")).toBe(false);
  });


  // ── Round-2 D: locale-proof detection of the top app-download banner ──────

  /** Stub layout so the top-banner geometry check can be exercised in jsdom. */
  function stubRect(el, rect) {
    el.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
      ...rect,
    });
  }

  function buildLocalisedBanner({ labels = {}, hookClass = null, withStoreLink = true } = {}) {
    const { label = "অ্যাপটি নিন", storeHref = "https://play.google.com/store/apps/details?id=x" } =
      labels;
    const bar = document.createElement("div");
    bar.className = hookClass || "mock-top-bar";
    stubRect(bar, { top: 0, height: 48, width: 800, right: 800, bottom: 48 });
    const control = withStoreLink ? document.createElement("a") : document.createElement("button");
    if (withStoreLink) control.setAttribute("href", storeHref);
    const span = document.createElement("span");
    span.textContent = label;
    control.appendChild(span);
    bar.appendChild(control);
    document.body.appendChild(bar);
    return { bar, control, span };
  }

  it("hides a translated banner through its store link", () => {
    const { bar } = buildLocalisedBanner({ labels: { label: "অ্যাপটি নিন" } });
    hideGetAppButton();
    expect(bar.hasAttribute("data-bds-hide")).toBe(true);
  });

  it("hides a translated banner through its app-promo class hook", () => {
    const { bar } = buildLocalisedBanner({
      hookClass: "app-download-bar",
      withStoreLink: false,
      labels: { label: "অ্যাপটি নিন" },
    });
    hideGetAppButton();
    expect(bar.hasAttribute("data-bds-hide")).toBe(true);
  });

  it("keeps a banner whose label is translated but carries no structural signal", () => {
    const { bar } = buildLocalisedBanner({
      hookClass: "composer-toolbar",
      withStoreLink: false,
      labels: { label: "অ্যাপটি নিন" },
    });
    hideGetAppButton();
    expect(bar.hasAttribute("data-bds-hide")).toBe(false);
  });

  it("does not hide a store link that lives at the bottom of the page", () => {
    const footer = document.createElement("div");
    footer.className = "page-footer";
    stubRect(footer, { top: 900, height: 120, width: 800, right: 800, bottom: 1020 });
    const link = document.createElement("a");
    link.href = "https://play.google.com/store/apps/details?id=x";
    footer.appendChild(link);
    document.body.appendChild(footer);

    hideGetAppButton();

    expect(footer.hasAttribute("data-bds-hide")).toBe(false);
    expect(link.hasAttribute("data-bds-hide")).toBe(false);
  });

  it("ignores a top bar that only holds unrelated controls", () => {
    const bar = document.createElement("div");
    bar.className = "mock-top-bar";
    stubRect(bar, { top: 0, height: 48, width: 800, right: 800, bottom: 48 });
    const button = document.createElement("button");
    button.textContent = "Settings";
    bar.appendChild(button);
    document.body.appendChild(bar);

    hideGetAppButton();

    expect(bar.hasAttribute("data-bds-hide")).toBe(false);
  });
});
