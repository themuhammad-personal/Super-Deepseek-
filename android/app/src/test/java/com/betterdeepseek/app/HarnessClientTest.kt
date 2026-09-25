package com.betterdeepseek.app

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

/**
 * JVM-only tests for [HarnessClient] — the native port of the background SW's
 * `PING_HARNESS` / `EXECUTE_HARNESS_TASK` handlers. MockWebServer plays the
 * local DeepSeek-Harness ApiProxy on 127.0.0.1.
 */
class HarnessClientTest {

    private lateinit var server: MockWebServer
    private lateinit var harness: HarnessClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        val httpClient = OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(2, TimeUnit.SECONDS)
            .callTimeout(5, TimeUnit.SECONDS)
            .build()
        harness = HarnessClient(httpClient)
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun base(): String = server.url("/").toString().trimEnd('/')

    // ── ping ─────────────────────────────────────────────────────────────

    @Test
    fun `ping plugin mode returns pluginInfo when plugin responds with json`() {
        server.enqueue(MockResponse().setBody("""{"name":"cordis","version":"1.2"}"""))

        val result = harness.ping(base())

        assertTrue(result.getBoolean("ok"))
        assertTrue(result.getBoolean("available"))
        assertEquals("plugin", result.getString("mode"))
        assertEquals("cordis", result.getJSONObject("pluginInfo").getString("name"))
    }

    @Test
    fun `ping plugin mode without parseable body omits pluginInfo`() {
        server.enqueue(MockResponse().setBody("not-json"))

        val result = harness.ping(base())

        assertEquals("plugin", result.getString("mode"))
        assertFalse(result.has("pluginInfo"))
    }

    @Test
    fun `ping falls back to native host describe when plugin is absent`() {
        server.enqueue(MockResponse().setResponseCode(404))
        server.enqueue(
            MockResponse().setBody(
                """{"type":"server-response","result":{"ok":true,"name":"harness"}}""",
            ),
        )

        val result = harness.ping(base())

        assertTrue(result.getBoolean("ok"))
        assertTrue(result.getBoolean("available"))
        assertEquals("native", result.getString("mode"))

        // The plugin ping is attempted first (and 404s here); the recorded
        // requests come back in arrival order, so the describe POST is second.
        val pingReq = server.takeRequest()
        assertEquals("/api/better-deepseek/ping", pingReq.path)

        val describeReq = server.takeRequest()
        assertEquals("POST", describeReq.method)
        assertEquals("/api/host.describe", describeReq.path)
        val body = JSONObject(describeReq.body.readUtf8())
        assertEquals("client-request", body.getString("type"))
        assertEquals("host.describe", body.getString("method"))
    }

    @Test
    fun `ping with empty baseUrl uses the documented default`() {
        // The default http://127.0.0.1:3080 is not listening → connection
        // refused → both attempts fail → ok:false.
        val result = harness.ping("")
        assertFalse(result.getBoolean("ok"))
        assertFalse(result.getBoolean("available"))
        assertTrue(result.has("error"))
    }

    @Test
    fun `ping reports both attempts failing`() {
        server.enqueue(MockResponse().setResponseCode(500))
        server.enqueue(MockResponse().setResponseCode(500))

        val result = harness.ping(base())

        assertFalse(result.getBoolean("ok"))
        assertFalse(result.getBoolean("available"))
    }

    // ── executeTask ──────────────────────────────────────────────────────

    @Test
    fun `executeTask rejects relative cwd with the user facing message`() {
        val result = harness.executeTask(JSONObject().put("cwd", "projects/asistan"))

        assertFalse(result.getBoolean("ok"))
        assertTrue(result.getString("error").startsWith("Absolute path is required"))
        assertEquals(
            "projects/asistan",
            result.getJSONObject("debug").getString("providedCwd"),
        )
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `executeTask accepts windows drive and unix absolute cwd`() {
        for (cwd in listOf("A:/Users/Edige/GitHub/asistan", "C:\\dev\\asistan", "/home/dev/asistan")) {
            server.enqueue(
                MockResponse().setBody("""{"result":{"ok":true,"value":{"sessionId":"s"}}}"""),
            )
            val result = harness.executeTask(
                JSONObject().put("baseUrl", base()).put("cwd", cwd).put("prompt", "do it"),
            )
            assertTrue("cwd should be accepted: $cwd", result.getBoolean("ok"))
        }
    }

    @Test
    fun `executeTask rejects empty cwd and workspaceId`() {
        // The client throws; WebViewBridge.fetch catches it and turns it into
        // `{ ok: false, error }` for the JS side (see WebViewBridgeDispatchTest).
        val ex = assertThrows(IllegalArgumentException::class.java) {
            harness.executeTask(JSONObject().put("prompt", "hi"))
        }
        assertTrue(ex.message!!.contains("Missing required cwd or workspaceId"))
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `executeTask creates session and queues prompt`() {
        server.enqueue(
            MockResponse().setBody(
                """{"result":{"ok":true,"value":{"sessionId":"sess-abc"}}}""",
            ),
        )
        server.enqueue(MockResponse().setBody("""{"result":{"ok":true}}"""))

        val result = harness.executeTask(
            JSONObject()
                .put("baseUrl", base())
                .put("cwd", "A:/Users/Edige/GitHub/asistan")
                .put("prompt", "fix the bug"),
        )

        assertTrue(result.getBoolean("ok"))
        assertEquals("sess-abc", result.getString("sessionId"))
        assertEquals(base(), result.getString("baseUrl"))

        val createReq = server.takeRequest()
        assertEquals("/api/better-deepseek/session.create", createReq.path)
        val createBody = JSONObject(createReq.body.readUtf8())
        assertEquals("session.create", createBody.getString("method"))
        assertEquals(
            "A:/Users/Edige/GitHub/asistan",
            createBody.getJSONObject("payload").getString("cwd"),
        )

        val promptReq = server.takeRequest()
        assertEquals("/api/better-deepseek/session.prompt", promptReq.path)
        val promptBody = JSONObject(promptReq.body.readUtf8())
        assertEquals("session.prompt", promptBody.getString("method"))
        val payload = promptBody.getJSONObject("payload")
        assertEquals("sess-abc", payload.getString("sessionId"))
        assertEquals("fix the bug", payload.getString("text"))
        assertEquals("queue", payload.getString("mode"))
        assertEquals("fix the bug", payload.getJSONArray("content").getJSONObject(0).getString("text"))
    }

    @Test
    fun `executeTask uses workspaceId when provided`() {
        server.enqueue(
            MockResponse().setBody("""{"result":{"ok":true,"value":{"sessionId":"s2"}}}"""),
        )

        val result = harness.executeTask(
            JSONObject()
                .put("baseUrl", base())
                .put("workspaceId", "ws-42"),
        )

        assertTrue(result.getBoolean("ok"))
        val createBody = JSONObject(server.takeRequest().body.readUtf8())
        assertEquals("ws-42", createBody.getJSONObject("payload").getString("workspaceId"))
        assertFalse(createBody.getJSONObject("payload").has("cwd"))
    }

    @Test
    fun `executeTask surfaces session create http error with details`() {
        server.enqueue(
            MockResponse()
                .setResponseCode(400)
                .setBody("""{"result":{"error":{"message":"cwd not found"}}}"""),
        )

        val result = harness.executeTask(
            JSONObject()
                .put("baseUrl", base())
                .put("cwd", "A:/missing")
                .put("prompt", "do it"),
        )

        assertFalse(result.getBoolean("ok"))
        assertTrue(result.getString("error").contains("HTTP 400"))
        assertTrue(result.getString("error").contains("cwd not found"))
        assertTrue(result.has("debug"))
    }

    @Test
    fun `executeTask surfaces session create failure without sessionId`() {
        server.enqueue(MockResponse().setBody("""{"result":{"ok":false}}"""))

        val result = harness.executeTask(
            JSONObject()
                .put("baseUrl", base())
                .put("cwd", "A:/x")
                .put("prompt", "do it"),
        )

        assertFalse(result.getBoolean("ok"))
        assertTrue(result.getString("error").contains("missing sessionId"))
    }

    @Test
    fun `executeTask reports network failure when harness is down`() {
        // Point at a port nothing is listening on.
        val result = harness.executeTask(
            JSONObject()
                .put("baseUrl", "http://127.0.0.1:1")
                .put("cwd", "A:/x")
                .put("prompt", "do it"),
        )

        assertFalse(result.getBoolean("ok"))
        assertTrue(result.getString("error").startsWith("Network Error"))
    }

    @Test
    fun `queryWorkspacesOnly matches folder name against workspace list`() {
        server.enqueue(
            MockResponse().setBody(
                """{"result":{"value":{"list":[
                    {"name":"other","path":"C:/dev/other"},
                    {"name":"asistan","path":"C:/dev/asistan"}
                ]}}}""",
            ),
        )

        val result = harness.executeTask(
            JSONObject()
                .put("baseUrl", base())
                .put("queryWorkspacesOnly", true)
                .put("folderName", "ASISTAN"),
        )

        assertTrue(result.getBoolean("ok"))
        assertEquals("C:/dev/asistan", result.getString("matchedPath"))
    }

    @Test
    fun `queryWorkspacesOnly returns empty match when nothing matches`() {
        server.enqueue(
            MockResponse().setBody("""{"result":{"value":{"list":[{"name":"other","path":"C:/dev/other"}]}}}"""),
        )

        val result = harness.executeTask(
            JSONObject()
                .put("baseUrl", base())
                .put("queryWorkspacesOnly", true)
                .put("folderName", "nope"),
        )

        assertFalse(result.getBoolean("ok"))
        assertEquals("", result.getString("matchedPath"))
    }
}
