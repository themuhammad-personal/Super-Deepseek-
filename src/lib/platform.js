/**
 * Runtime platform probes shared by the content scripts.
 *
 * The Android build installs `window.AndroidBridge` (see
 * src/platform/globals-android.js and the native WebViewBridge.kt); the Chrome
 * build never does. Module code must not cache the answer at import time,
 * because the bridge is injected by the native layer before the bundle runs but
 * tests (and the Playwright Android simulator) may install it late.
 */

/** True when the content bundle runs inside the BDS Android WebView. */
export function isAndroidWebView() {
  if (typeof window === "undefined") return false;
  const bridge = window.AndroidBridge;
  if (!bridge) return false;
  // The bridge always exposes at least one of these; a stray global that only
  // happens to be named AndroidBridge must not flip platform behaviour.
  return (
    typeof bridge.getStorage === "function" ||
    typeof bridge.fetch === "function" ||
    typeof bridge.getAssetUrl === "function"
  );
}
