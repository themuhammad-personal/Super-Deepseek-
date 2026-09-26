import { devLog } from "../lib/dev-log.js";

/**
 * Round-2 B.7: tell the native layer that BDS is on screen.
 *
 * MainActivity keeps the WebView invisible from creation (and again on every
 * navigation) so the user never sees DeepSeek's own unstyled UI flash before
 * the injected bundle takes over. The native side also arms its own safety
 * timeout, so a missing signal can never leave a blank screen — which is why
 * this module stays silent on every other platform and never throws.
 */

/** Set once per page so repeated calls cannot spam the bridge. */
export const UI_READY_SIGNALLED_KEY = "__bdsUiReadySignalled";

/** Frames to wait so the first visible paint already contains the BDS UI. */
const READY_FRAMES = 2;

function bridgeSupportsUiReady() {
  if (typeof window === "undefined") return false;
  const bridge = window.AndroidBridge;
  return Boolean(bridge && typeof bridge.uiReady === "function");
}

/**
 * Signals readiness to the native shell, at most once per page load.
 * @param {string} reason free-form label used by the dev log
 * @returns {boolean} true when the signal was delivered
 */
export function signalUiReady(reason = "mount") {
  if (typeof window === "undefined") return false;
  if (window[UI_READY_SIGNALLED_KEY]) return false;
  if (!bridgeSupportsUiReady()) return false;

  window[UI_READY_SIGNALLED_KEY] = true;
  try {
    window.AndroidBridge.uiReady();
    devLog("UiReady", `signalled native WebView reveal (${reason})`);
    return true;
  } catch (error) {
    // The native layer reveals on its own timeout; a failed signal is not fatal.
    console.warn("[BDS] uiReady signal failed:", error);
    return false;
  }
}

/**
 * Waits for the given number of animation frames (falling back to a task when
 * rAF is unavailable) and then signals readiness.
 */
export function signalUiReadyAfterPaint(reason = "after-paint", frames = READY_FRAMES) {
  if (typeof window === "undefined") return;
  const requestFrame = window.requestAnimationFrame?.bind(window);
  if (!requestFrame) {
    setTimeout(() => signalUiReady(reason), 0);
    return;
  }

  let remaining = Math.max(0, frames);
  const step = () => {
    remaining -= 1;
    if (remaining > 0) {
      requestFrame(step);
      return;
    }
    signalUiReady(reason);
  };
  requestFrame(step);
}
