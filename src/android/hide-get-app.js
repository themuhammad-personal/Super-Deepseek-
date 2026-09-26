import { devLog } from "../lib/dev-log.js";

/**
 * Hides the "Get App" promotional banner that chat.deepseek.com renders at the
 * top of the page on mobile viewports. Installed by
 * src/platform/globals-android.js when the Android content bundle starts.
 *
 * Uses a CSS rule with !important so the hiding survives framework re-renders
 * that overwrite inline styles, and a MutationObserver so freshly created bars
 * are re-marked.
 *
 * ── Round-2 D: the label is translated, the banner must not survive it ──────
 * The original detector only matched the exact English word "Get App", so the
 * banner stayed visible for every user whose DeepSeek language is not English
 * (reported on Bengali). Detection is now tiered, strongest signal first:
 *
 *   T1 · a link/button that leads to a store or an APK download
 *        (`play.google.com`, `market://`, `apps.apple.com`, `*.apk`) — those
 *        URLs are never translated, and the promotion exists only to send the
 *        user there;
 *   T2 · an app-promo class / id / data-testid hook
 *        (`get-app`, `app-download`, `download-app`, `app-banner`, …);
 *   T3 · the English "Get App" label — kept as the documented best-effort
 *        fallback for markup that carries neither of the above.
 *
 * T1/T2 additionally require the element to *look like* a top banner (pinned to
 * the top of the viewport, full width, shallow). Elements that are not laid out
 * (jsdom, or a frame before first paint) skip the geometry part, because the
 * structural signal alone is already specific enough.
 */

const HIDE_ATTR = "data-bds-hide";

/** Store / installer links — the one locale-independent part of the banner. */
const STORE_HREF_RE =
  /play\.google\.com|market:\/\/|apps\.apple\.com|itunes\.apple\.com|app-?store|\.apk(\?|#|$)/i;

/** Class / id / data-testid hooks DeepSeek uses for the app promotion. */
const APP_PROMO_HOOK_RE =
  /(get|download|install|promo|open)[-_]?app|app[-_]?(download|banner|bar|promo|install|installer)|appdownload|download[-_]?app/i;

const BANNER_MAX_HEIGHT = 160;
const BANNER_MAX_TOP = 160;

/**
 * The structural passes (T1/T2) have to walk a lot of elements, so they run at
 * most this often after the first pass — a phone WebView must not rescan the
 * whole tree on every character React writes.
 */
const STRUCTURAL_SCAN_INTERVAL_MS = 500;

function isElement(node) {
  return Boolean(node && node.nodeType === 1);
}

export function hideGetAppButton() {
  if (window.__bdsGetAppObserver) return;

  const style = document.createElement("style");
  style.textContent = `[${HIDE_ATTR}] { display: none !important; }`;
  (document.head || document.documentElement).appendChild(style);

  function getHideTarget(label) {
    const control = label.closest?.("button, .ds-button, [role='button']");
    if (!control) return null;
    return control.matches?.(".ds-button") ? control : (control.parentElement || control);
  }

  /**
   * Geometry check: a shallow bar pinned to the top of the viewport. Returns
   * true when the document is not laid out (jsdom / pre-paint), where the
   * structural signals have to carry the decision alone.
   */
  function looksLikeTopBanner(el) {
    const rect = el.getBoundingClientRect?.();
    if (!rect || (!rect.width && !rect.height)) return true;
    if (rect.top > BANNER_MAX_TOP) return false;
    if (rect.height > BANNER_MAX_HEIGHT) return false;
    const viewportWidth = window.innerWidth || rect.width;
    return !viewportWidth || rect.width >= viewportWidth * 0.6;
  }

  function markHidden(target, reason) {
    if (!target || target.hasAttribute(HIDE_ATTR)) return;
    target.setAttribute(HIDE_ATTR, "");
    devLog("HideGetApp", `hidden app banner (${reason})`);
  }

  /** T1: anything that offers the store/APK download. */
  function hideStorePromotion() {
    const links = document.querySelectorAll("a[href]");
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      if (!STORE_HREF_RE.test(href)) continue;
      // Walk up a few levels: a promo hook wins, otherwise the nearest
      // banner-shaped ancestor. Without one the link is just a store link
      // somewhere on the page (footer, settings, …) and stays untouched.
      let target = null;
      let node = link.parentElement;
      for (let depth = 0; node && node !== document.body && depth < 3; depth += 1, node = node.parentElement) {
        if (APP_PROMO_HOOK_RE.test(`${node.className || ""} ${node.id || ""}`)) {
          target = node;
          break;
        }
        if (!target && looksLikeTopBanner(node)) target = node;
      }
      if (!isElement(target)) continue;
      markHidden(target, "store link");
    }
  }

  /** T2: an app-promo hook that looks like a top banner and holds a control. */
  function hideHookBanners() {
    const candidates = document.querySelectorAll(
      "[class], [id], [data-testid], [data-test-id]",
    );
    for (const el of candidates) {
      const hook = `${el.className || ""} ${el.id || ""} ${
        el.getAttribute?.("data-testid") || el.getAttribute?.("data-test-id") || ""
      }`;
      if (!APP_PROMO_HOOK_RE.test(hook)) continue;
      if (el.hasAttribute(HIDE_ATTR)) continue;
      if (!el.querySelector("button, a[href], [role='button'], .ds-button")) continue;
      if (!looksLikeTopBanner(el)) continue;
      markHidden(el, "app-promo hook");
    }
  }

  /** T3: the English label — best effort, unchanged from the original code. */
  function hideEnglishLabel() {
    const spans = document.querySelectorAll("span");
    for (const span of spans) {
      if (span.textContent.trim() !== "Get App") continue;
      markHidden(getHideTarget(span), "english label");
    }
  }

  let lastStructuralScan = 0;

  function hideButton(force = false) {
    try {
      // T3 is cheap and always runs.
      hideEnglishLabel();
      const now = Date.now();
      if (!force && now - lastStructuralScan < STRUCTURAL_SCAN_INTERVAL_MS) return;
      lastStructuralScan = now;
      hideStorePromotion();
      hideHookBanners();
    } catch (err) {
      console.warn("[BDS] hideGetAppButton failed:", err);
    }
  }

  hideButton(true);

  let rafId = 0;
  const observer = new MutationObserver(() => {
    hideButton();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => hideButton());
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  window.__bdsGetAppObserver = observer;
}
