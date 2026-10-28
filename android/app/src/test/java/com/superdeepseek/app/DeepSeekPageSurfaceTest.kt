package com.superdeepseek.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeepSeekPageSurfaceTest {
    @Test
    fun `parses WebView JSON string results`() {
        assertEquals(DeepSeekPageSurface.CHAT, parseDeepSeekPageSurface("\"chat\""))
        assertEquals(DeepSeekPageSurface.AUTH, parseDeepSeekPageSurface("\"auth\""))
        assertEquals(DeepSeekPageSurface.LOADING, parseDeepSeekPageSurface("\"loading\""))
    }

    @Test
    fun `unknown or missing probe results fail closed`() {
        listOf(null, "", "null", "\"unexpected\"", "\"CHAT\"").forEach {
            assertEquals(DeepSeekPageSurface.LOADING, parseDeepSeekPageSurface(it))
        }
    }

    @Test
    fun `probe checks CAPTCHA and sign-in before allowing engine injection`() {
        assertTrue(DEEPSEEK_PAGE_SURFACE_PROBE_JS.contains("captcha"))
        assertTrue(DEEPSEEK_PAGE_SURFACE_PROBE_JS.contains("hcaptcha"))
        assertTrue(DEEPSEEK_PAGE_SURFACE_PROBE_JS.contains("sign[_-]?in"))
        assertTrue(DEEPSEEK_PAGE_SURFACE_PROBE_JS.contains("textarea#chat-input"))
        assertTrue(DEEPSEEK_PAGE_SURFACE_PROBE_JS.contains("return 'loading'"))
    }
}
