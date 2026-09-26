package com.betterdeepseek.app

import android.os.Handler
import android.os.Looper
import android.view.View
import android.webkit.WebView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

/**
 * Round-2 B.7: cold launch must never show DeepSeek's native UI before BDS is
 * ready, and a bundle that never signals readiness must not leave a blank screen.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class WebViewRevealGateTest {

    private lateinit var view: WebView
    private lateinit var gate: WebViewRevealGate

    @Before
    fun setUp() {
        view = WebView(RuntimeEnvironment.getApplication())
        gate = WebViewRevealGate(view)
    }

    private fun idleMainLooperFor(millis: Long) {
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(millis))
    }

    @Test
    fun `reset hides the webview and arms the safety timeout`() {
        view.visibility = View.VISIBLE

        gate.reset()

        assertEquals(View.INVISIBLE, view.visibility)
        assertFalse(gate.isRevealed)
    }

    @Test
    fun `readiness signal reveals the webview before the timeout`() {
        gate.reset()

        gate.reveal("content-script")

        assertEquals(View.VISIBLE, view.visibility)
        assertTrue(gate.isRevealed)
    }

    @Test
    fun `reveal is idempotent`() {
        val reasons = mutableListOf<String>()
        val loggingGate = WebViewRevealGate(view, logger = { reasons.add(it) })
        loggingGate.reset()

        loggingGate.reveal("content-script")
        loggingGate.reveal("content-script")

        assertEquals(listOf("Revealing WebView (content-script)"), reasons)
        assertEquals(View.VISIBLE, view.visibility)
    }

    @Test
    fun `safety timeout reveals the webview when nothing signals readiness`() {
        gate.reset()

        idleMainLooperFor(WebViewRevealGate.DEFAULT_TIMEOUT_MS + 100)

        assertEquals(View.VISIBLE, view.visibility)
        assertTrue(gate.isRevealed)
    }

    @Test
    fun `the timeout does not fire early`() {
        gate.reset()

        idleMainLooperFor(WebViewRevealGate.DEFAULT_TIMEOUT_MS - 400)

        assertEquals(View.INVISIBLE, view.visibility)
    }

    @Test
    fun `signal after the timeout is harmless`() {
        gate.reset()
        idleMainLooperFor(WebViewRevealGate.DEFAULT_TIMEOUT_MS + 100)

        gate.reveal("content-script")

        assertEquals(View.VISIBLE, view.visibility)
        assertTrue(gate.isRevealed)
    }

    @Test
    fun `a new navigation hides the webview again and re-arms the timeout`() {
        gate.reset()
        gate.reveal("content-script")
        assertEquals(View.VISIBLE, view.visibility)

        gate.reset()

        assertEquals(View.INVISIBLE, view.visibility)
        idleMainLooperFor(WebViewRevealGate.DEFAULT_TIMEOUT_MS + 100)
        assertEquals(View.VISIBLE, view.visibility)
    }

    @Test
    fun `cancel drops a pending reveal`() {
        gate.reset()

        gate.cancel()
        idleMainLooperFor(WebViewRevealGate.DEFAULT_TIMEOUT_MS + 100)

        assertEquals(View.INVISIBLE, view.visibility)
    }

    /** The JS entry point MainActivity forwards to the gate must stay wired. */
    @Test
    fun `bridge uiReady callback drives the reveal`() {
        val bridge = WebViewBridge(RuntimeEnvironment.getApplication())
        var revealed = false
        bridge.onUiReady = {
            revealed = true
            gate.reveal("content-script")
        }
        gate.reset()

        bridge.uiReady()

        assertTrue(revealed)
        assertEquals(View.VISIBLE, view.visibility)
    }

    /** A handler-based implementation keeps working while the view is detached. */
    @Test
    fun `timeout works before the webview is attached`() {
        val detached = WebView(RuntimeEnvironment.getApplication())
        assertNotNull(Handler(Looper.getMainLooper()))
        val detachedGate = WebViewRevealGate(detached, timeoutMs = 100L)

        detachedGate.reset()
        idleMainLooperFor(250)

        assertEquals(View.VISIBLE, detached.visibility)
    }
}
