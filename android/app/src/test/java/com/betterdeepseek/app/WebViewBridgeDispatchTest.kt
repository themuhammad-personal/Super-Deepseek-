package com.betterdeepseek.app

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyInt
import org.mockito.Mockito.mock
import org.mockito.Mockito.when
import java.util.concurrent.TimeUnit

/**
 * JVM-only tests for the [WebViewBridge.fetch] dispatch branches that replaced
 * the extension's background service worker. The real components (MCP /
 * Harness / RemoteDataSync / YouTubeTranscript) are injected pointed at a
 * MockWebServer, so each branch is exercised end-to-end through the
 * JSON-in/JSON-out boundary.
 */
class WebViewBridgeDispatchTest {

    private lateinit var server: MockWebServer
    private lateinit var context: Context
    private lateinit var prefs: InMemorySharedPreferences
    private lateinit var bridge: WebViewBridge

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        context = mock(Context::class.java)
        prefs = InMemorySharedPreferences()
        when(context.getSharedPreferences(any(), anyInt())).thenReturn(prefs)

        val httpClient = OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(2, TimeUnit.SECONDS)
            .callTimeout(5, TimeUnit.SECONDS)
            .build()

        bridge = WebViewBridge(
            context,
            httpClient,
            remoteDataSync = RemoteDataSync(
                prefs,
                httpClient,
                localeBaseUrl = server.url("/locales").toString(),
                remoteConfigUrl = server.url("/remote-config.json").toString(),
                remoteStatusUrl = server.url("/status.json").toString(),
            ),
            mcpClient = McpClient(httpClient),
            harnessClient = HarnessClient(httpClient),
            youtubeTranscript = YouTubeTranscript(
                httpClient,
                innerTubePlayerUrl = server.url("/inner-tube").toString(),
                watchPageUrlTemplate = server.url("/watch?v=").toString() + "%s",
                captionHostSuffix = "localhost",
            ),
        )
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    // ── MCP dispatch ─────────────────────────────────────────────────────

    @Test
    fun `fetch dispatches bds mcp list tools and returns the rpc result`() {
        server.enqueue(MockResponse().setBody("""{"jsonrpc":"2.0","id":1,"result":{}}"""))
        server.enqueue(MockResponse().setBody("{}"))
        val tools = """{"tools":[{"name":"echo","description":"echoes"}]}"""
        server.enqueue(MockResponse().setBody("""{"jsonrpc":"2.0","id":2,"result":$tools}"""))

        val out = JSONObject(
            bridge.fetch(
                JSONObject()
                    .put("type", "bds-mcp-list-tools")
                    .put("serverUrl", server.url("/mcp").toString())
                    .put("apiKey", "k")
                    .toString(),
            ),
        )

        assertTrue(out.getBoolean("ok"))
        assertEquals(
            "echo",
            out.getJSONObject("tools").getJSONArray("tools").getJSONObject(0).getString("name"),
        )
    }

    @Test
    fun `fetch bds mcp list tools without serverUrl fails cleanly`() {
        val out = JSONObject(bridge.fetch("""{"type":"bds-mcp-list-tools"}"""))
        assertFalse(out.getBoolean("ok"))
        assertTrue(out.getString("error").contains("serverUrl"))
    }

    @Test
    fun `fetch dispatches bds mcp call and returns the rpc result`() {
        server.enqueue(MockResponse().setBody("""{"jsonrpc":"2.0","id":1,"result":{}}"""))
        server.enqueue(MockResponse().setBody("{}"))
        val rpcResult = """{"content":[{"type":"text","text":"42"}]}"""
        server.enqueue(MockResponse().setBody("""{"jsonrpc":"2.0","id":2,"result":$rpcResult}"""))

        val out = JSONObject(
            bridge.fetch(
                JSONObject()
                    .put("type", "bds-mcp-call")
                    .put("serverUrl", server.url("/mcp").toString())
                    .put("toolName", "answer")
                    .put("args", JSONObject().put("q", "6*7"))
                    .toString(),
            ),
        )

        assertTrue(out.getBoolean("ok"))
        assertEquals(
            "42",
            out.getJSONObject("result").getJSONArray("content").getJSONObject(0).getString("text"),
        )
    }

    // ── YouTube dispatch ─────────────────────────────────────────────────

    @Test
    fun `fetch dispatches bds get youtube transcript through the native port`() {
        val tracks =
            """{"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
            {"baseUrl":"${server.url("/timedtext").toString()}","languageCode":"en"}]}}}"""
        server.enqueue(MockResponse().setBody(tracks))
        server.enqueue(
            MockResponse().setBody(
                """<transcript><p t="0" d="1000"><s a="0">Hello</s></p></transcript>""",
            ),
        )

        val out = JSONObject(
            bridge.fetch(
                JSONObject().put("type", "bds-get-youtube-transcript").put("videoId", "dQw4w9WgXcQ").toString(),
            ),
        )

        assertTrue(out.getBoolean("ok"))
        assertEquals("Hello", out.getJSONArray("transcript").getJSONObject(0).getString("text"))
    }

    @Test
    fun `fetch bds get youtube transcript without videoId fails cleanly`() {
        val out = JSONObject(bridge.fetch("""{"type":"bds-get-youtube-transcript"}"""))
        assertFalse(out.getBoolean("ok"))
        assertTrue(out.getString("error").contains("videoId"))
    }

    // ── remote-data dispatch ─────────────────────────────────────────────

    @Test
    fun `fetch dispatches BDS RESET LANGUAGES to the native sync`() {
        prefs.set("bds_locale_updates", "{}")

        val out = JSONObject(bridge.fetch("""{"type":"BDS_RESET_LANGUAGES"}"""))

        assertTrue(out.getBoolean("success"))
        assertFalse(prefs.contains("bds_locale_updates"))
    }

    @Test
    fun `fetch dispatches BDS UPDATE LANGUAGES and reports written keys`() {
        for (code in listOf("en", "fa", "ru", "tr", "zh-cn")) {
            server.enqueue(
                MockResponse().setBody("""{"code":"$code","messages":{"hello":"hi"}}"""),
            )
        }

        val out = JSONObject(bridge.fetch("""{"type":"BDS_UPDATE_LANGUAGES"}"""))

        assertTrue(out.getBoolean("success"))
        assertEquals(2, out.getJSONArray("writtenKeys").length())
        assertTrue(prefs.contains("bds_locale_updates"))
        assertTrue(prefs.contains("bds_locale_update_last_checked"))
    }

    @Test
    fun `fetch dispatches unknown types with the unsupported error`() {
        val out = JSONObject(bridge.fetch("""{"type":"SOMETHING_ELSE"}"""))
        assertFalse(out.getBoolean("ok"))
        assertTrue(out.getString("error").startsWith("Unsupported bridge message type"))
    }

    // ── harness dispatch ─────────────────────────────────────────────────

    @Test
    fun `fetch dispatches PING HARNESS to the native client`() {
        server.enqueue(MockResponse().setBody("""{"name":"cordis"}"""))

        val out = JSONObject(
            bridge.fetch(
                JSONObject().put("type", "PING_HARNESS").put("baseUrl", server.url("/").toString()).toString(),
            ),
        )

        assertTrue(out.getBoolean("ok"))
        assertEquals("plugin", out.getString("mode"))
    }

    @Test
    fun `fetch dispatches EXECUTE HARNESS TASK with nested payload`() {
        server.enqueue(MockResponse().setBody("""{"result":{"ok":true,"value":{"sessionId":"s9"}}}"""))

        val out = JSONObject(
            bridge.fetch(
                JSONObject()
                    .put("type", "EXECUTE_HARNESS_TASK")
                    .put(
                        "payload",
                        JSONObject()
                            .put("baseUrl", server.url("/").toString())
                            .put("cwd", "A:/x")
                            .put("prompt", "go"),
                    )
                    .toString(),
            ),
        )

        assertTrue(out.getBoolean("ok"))
        assertEquals("s9", out.getString("sessionId"))
    }
}
