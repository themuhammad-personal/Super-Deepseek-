package com.superdeepseek.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Pure decision tests for [MainFrameTracker]. */
class MainFrameTrackerTest {

    @Test
    fun `matching URLs are the main frame`() {
        assertTrue(MainFrameTracker.isMainFrame(
            "https://chat.deepseek.com/a/chat/s/abc",
            "https://chat.deepseek.com/a/chat/s/abc",
        ))
    }

    @Test
    fun `fragment differences are still the main frame`() {
        assertTrue(MainFrameTracker.isMainFrame(
            "https://chat.deepseek.com/a/chat/s/abc#msg-42",
            "https://chat.deepseek.com/a/chat/s/abc",
        ))
        assertTrue(MainFrameTracker.isMainFrame(
            "https://chat.deepseek.com/a/chat/s/abc",
            "https://chat.deepseek.com/a/chat/s/abc#msg-42",
        ))
    }

    @Test
    fun `a different URL is a subframe`() {
        assertFalse(MainFrameTracker.isMainFrame(
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://chat.deepseek.com/a/chat/s/abc",
        ))
        assertFalse(MainFrameTracker.isMainFrame(
            "https://chat.deepseek.com/a/chat/s/abc",
            "https://evil.example.com/portal",
        ))
    }

    @Test
    fun `first load with no WebView URL is the main frame`() {
        assertTrue(MainFrameTracker.isMainFrame("https://chat.deepseek.com/", null))
        assertTrue(MainFrameTracker.isMainFrame("https://chat.deepseek.com/", ""))
        assertFalse(MainFrameTracker.isMainFrame(null, "https://chat.deepseek.com/"))
        assertFalse(MainFrameTracker.isMainFrame("", "https://chat.deepseek.com/"))
    }

    @Test
    fun `trust follows the WebView URL when the callback is a subframe`() {
        // Foreign iframe on the DeepSeek page: stay trusted.
        assertTrue(MainFrameTracker.trustedForPage(
            "https://accounts.google.com/o/oauth2/v2/auth",
            "https://chat.deepseek.com/a/chat/s/abc",
        ))
        // DeepSeek iframe on a foreign page: stay untrusted.
        assertFalse(MainFrameTracker.trustedForPage(
            "https://chat.deepseek.com/a/chat/s/abc",
            "https://evil.example.com/portal",
        ))
    }

    @Test
    fun `trust follows the callback when it is the main frame`() {
        assertTrue(MainFrameTracker.trustedForPage(
            "https://chat.deepseek.com/a/chat/s/abc",
            "https://chat.deepseek.com/a/chat/s/abc",
        ))
        assertFalse(MainFrameTracker.trustedForPage(
            "https://evil.example.com/?next=chat.deepseek.com",
            "https://evil.example.com/?next=chat.deepseek.com",
        ))
    }

    @Test
    fun `engine injection only for a trusted main frame`() {
        assertTrue(MainFrameTracker.shouldInjectEngine(
            "https://chat.deepseek.com/a/chat/s/abc",
            "https://chat.deepseek.com/a/chat/s/abc",
        ))
        // Subframe finish — even a DeepSeek one — never injects.
        assertFalse(MainFrameTracker.shouldInjectEngine(
            "https://chat.deepseek.com/a/chat/s/abc",
            "https://chat.deepseek.com/",
        ))
        // The old `url.contains("chat.deepseek.com")` let this through.
        assertFalse(MainFrameTracker.shouldInjectEngine(
            "https://evil.example.com/?next=chat.deepseek.com",
            "https://evil.example.com/?next=chat.deepseek.com",
        ))
        assertFalse(MainFrameTracker.shouldInjectEngine(
            "https://evil.example.com/portal",
            "https://evil.example.com/portal",
        ))
        assertFalse(MainFrameTracker.shouldInjectEngine(null, null))
    }
}
