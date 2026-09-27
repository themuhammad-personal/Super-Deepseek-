package com.superdeepseek.app

import android.webkit.WebView
import android.widget.FrameLayout
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Bridge trust must follow the MAIN frame only.
 *
 * Bug: `onPageStarted` set `bridge.trustedPage = isTrustedBridgeUrl(url)` for
 * every callback — including iframe navigations, which WebViewClient can fire
 * on several WebView versions. A foreign OAuth/hCaptcha iframe on the DeepSeek
 * page killed the bridge; a DeepSeek iframe on a foreign page granted it.
 *
 * These tests drive the REAL [MainActivity] WebViewClient callbacks and observe
 * the live [WebViewBridge.trustedPage] flag. They fail on the old behaviour and
 * pass after [MainFrameTracker]; they deliberately do not reference the
 * tracker so they compile against the old code too.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MainFrameTrustTest {

    private lateinit var activity: MainActivity
    private lateinit var webView: WebView
    private lateinit var bridge: WebViewBridge

    @Before
    fun setUp() {
        activity = Robolectric
            .buildActivity(MainActivity::class.java)
            .create()
            .start()
            .resume()
            .get()
        webView = findWebView(activity)
        bridge = bridgeOf(activity)
    }

    @Test
    fun `foreign iframe on the DeepSeek page must not revoke the bridge`() {
        webView.loadUrl("https://chat.deepseek.com/a/chat/s/abc")
        webView.webViewClient.onPageStarted(webView, "https://chat.deepseek.com/a/chat/s/abc", null)
        assertTrue("main frame DeepSeek page starts trusted", bridge.trustedPage)

        // An OAuth iframe navigates while the page is still chat.deepseek.com.
        webView.webViewClient.onPageStarted(webView, "https://accounts.google.com/o/oauth2/v2/auth", null)
        assertTrue("a subframe navigation must not revoke the bridge", bridge.trustedPage)
    }

    @Test
    fun `DeepSeek iframe on a foreign page must not grant the bridge`() {
        webView.loadUrl("https://evil.example.com/portal")
        webView.webViewClient.onPageStarted(webView, "https://evil.example.com/portal", null)
        assertFalse("foreign page starts untrusted", bridge.trustedPage)

        // The foreign page embeds a chat.deepseek.com iframe.
        webView.webViewClient.onPageStarted(webView, "https://chat.deepseek.com/a/chat/s/abc", null)
        assertFalse("a DeepSeek subframe must not grant the bridge", bridge.trustedPage)
    }

    @Test
    fun `main frame navigating away revokes the bridge`() {
        webView.loadUrl("https://chat.deepseek.com/a/chat/s/abc")
        webView.webViewClient.onPageStarted(webView, "https://chat.deepseek.com/a/chat/s/abc", null)
        assertTrue(bridge.trustedPage)

        webView.loadUrl("https://evil.example.com/portal")
        webView.webViewClient.onPageStarted(webView, "https://evil.example.com/portal", null)
        assertFalse("a real redirect to a foreign page must revoke the bridge", bridge.trustedPage)
    }

    @Test
    fun `query strings mentioning chat dot deepseek dot com are not DeepSeek`() {
        webView.loadUrl("https://evil.example.com/?next=chat.deepseek.com")
        webView.webViewClient.onPageStarted(webView, "https://evil.example.com/?next=chat.deepseek.com", null)
        assertFalse("host, not substring, decides trust", bridge.trustedPage)
    }

    @Test
    fun `fragment jumps on the DeepSeek page stay trusted`() {
        webView.loadUrl("https://chat.deepseek.com/a/chat/s/abc")
        webView.webViewClient.onPageStarted(webView, "https://chat.deepseek.com/a/chat/s/abc", null)
        webView.webViewClient.onPageStarted(webView, "https://chat.deepseek.com/a/chat/s/abc#msg-42", null)
        assertTrue("an in-page anchor is still the same main frame", bridge.trustedPage)
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private fun findWebView(activity: MainActivity): WebView {
        val content = activity.window.decorView
            .findViewById<android.view.ViewGroup>(android.R.id.content)
        val rootLayout = content.getChildAt(0) as FrameLayout
        return rootLayout.getChildAt(0) as WebView
    }

    private fun bridgeOf(activity: MainActivity): WebViewBridge {
        val field = MainActivity::class.java.getDeclaredField("bridge")
        field.isAccessible = true
        return field.get(activity) as WebViewBridge
    }
}
