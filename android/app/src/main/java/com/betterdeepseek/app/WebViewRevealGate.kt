package com.betterdeepseek.app

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View

/**
 * Keeps the WebView hidden until the BDS content script reports that its UI is mounted
 * (Round-2 B.7).
 *
 * Cold start used to paint DeepSeek's own, still-unstyled UI for a moment before the injected
 * bundle replaced it. Holding the WebView [View.INVISIBLE] and revealing it on the content
 * script's ready signal removes that flash.
 *
 * A safety timeout always reveals the view, so a bundle that fails to load (or a page that never
 * mounts BDS) can never leave the user looking at a blank screen.
 *
 * The Handler is explicit rather than `View.postDelayed` so the timer runs on the main looper even
 * while the view is detached (which is also what makes the behaviour testable).
 */
internal class WebViewRevealGate(
        private val view: View,
        private val timeoutMs: Long = DEFAULT_TIMEOUT_MS,
        private val handler: Handler = Handler(Looper.getMainLooper()),
        private val logger: (String) -> Unit = { message -> Log.i(TAG, message) },
) {

    private val timeoutRunnable = Runnable { reveal("safety-timeout") }

    /** True once the view has been made visible for the current page. */
    var isRevealed: Boolean = false
        private set

    /**
     * Called when a new page starts loading: hide the view again and arm the safety net. A page
     * that never signals readiness is still revealed after [timeoutMs].
     */
    fun reset() {
        isRevealed = false
        handler.removeCallbacks(timeoutRunnable)
        view.visibility = View.INVISIBLE
        handler.postDelayed(timeoutRunnable, timeoutMs)
    }

    /**
     * Shows the view (idempotent). Called from the onUiReady() bridge callback, or by the safety
     * timeout.
     */
    fun reveal(reason: String) {
        if (isRevealed) return
        isRevealed = true
        handler.removeCallbacks(timeoutRunnable)
        view.visibility = View.VISIBLE
        logger("Revealing WebView ($reason)")
    }

    /** Drops any pending reveal timer, e.g. when the Activity is destroyed. */
    fun cancel() {
        handler.removeCallbacks(timeoutRunnable)
    }

    companion object {
        private const val TAG = "BdsRevealGate"

        /**
         * How long the WebView may stay hidden waiting for the BDS ready signal: long enough for a
         * cold, network-bound first paint, short enough that a failure is not perceived as a hang.
         */
        const val DEFAULT_TIMEOUT_MS = 2500L
    }
}
