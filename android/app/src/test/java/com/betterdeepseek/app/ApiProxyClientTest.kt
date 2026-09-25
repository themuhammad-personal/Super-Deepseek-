package com.betterdeepseek.app

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

/**
 * JVM-only tests for [ApiProxyClient] — the native port of the extension's
 * `bds-api-proxy` background handler (`src/background/api-proxy.js`).
 *
 * The API Playground depends on every one of these behaviours, so the tests pin
 * the request mapping (endpoint → URL/verb/body), the auth/accept headers, SSE
 * streaming, latency reporting and the error contract.
 */
class ApiProxyClientTest {

    private lateinit var server: MockWebServer
    private lateinit var client: ApiProxyClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        val httpClient = OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(2, TimeUnit.SECONDS)
            .callTimeout(5, TimeUnit.SECONDS)
            .build()
        client = ApiProxyClient(
            httpClient,
            baseUrl = server.url("/").toString(),
            betaBaseUrl = server.url("/beta").toString(),
        )
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun request(endpoint: String, apiKey: String = "sk-test"): JSONObject =
        JSONObject().put("endpoint", endpoint).put("apiKey", apiKey)

    @Test
    fun `chat completions maps camelCase fields to the snake case API body`() {
        server.enqueue(
            MockResponse().setBody("""{"choices":[{"message":{"content":"hi"}}],"usage":{"total_tokens":3}}"""),
        )

        val out = client.proxy(
            request("chat/completions")
                .put("model", "deepseek-v4-flash")
                .put(
                    "messages",
                    JSONArray()
                        .put(JSONObject().put("role", "system").put("content", "sys"))
                        .put(JSONObject().put("role", "user").put("content", "hello")),
                )
                .put("maxTokens", 1024)
                .put("temperature", 0.7)
                .put("topP", 0.9)
                .put("stop", JSONArray().put("\n\n"))
                .put("userId", "u-1")
                .put("topLogprobs", 5)
                .put("logprobs", true)
                .put("thinking", JSONObject().put("type", "enabled"))
                .put("reasoningEffort", "high")
                .put("responseFormat", JSONObject().put("type", "json_object"))
                .put("stream", false),
        )

        assertTrue(out.getBoolean("ok"))
        assertFalse(out.getBoolean("streamed"))
        assertEquals("hi", out.getJSONObject("data").getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content"))
        assertTrue(out.getDouble("latency") >= 0.0)

        val recorded = server.takeRequest()
        assertEquals("/chat/completions", recorded.path)
        assertEquals("POST", recorded.method)
        assertEquals("Bearer sk-test", recorded.getHeader("Authorization"))
        assertEquals("application/json", recorded.getHeader("Accept"))
        assertEquals("application/json", recorded.getHeader("Content-Type"))

        val body = JSONObject(recorded.body.readUtf8())
        assertEquals("deepseek-v4-flash", body.getString("model"))
        assertEquals(1024, body.getInt("max_tokens"))
        assertEquals(0.7, body.getDouble("temperature"), 0.0001)
        assertEquals(0.9, body.getDouble("top_p"), 0.0001)
        assertEquals("\n\n", body.getJSONArray("stop").getString(0))
        assertEquals("u-1", body.getString("user_id"))
        assertEquals(5, body.getInt("top_logprobs"))
        assertTrue(body.getBoolean("logprobs"))
        assertEquals("enabled", body.getJSONObject("thinking").getString("type"))
        assertEquals("high", body.getString("reasoning_effort"))
        assertEquals("json_object", body.getJSONObject("response_format").getString("type"))
        assertEquals("user", body.getJSONArray("messages").getJSONObject(1).getString("role"))
    }

    @Test
    fun `chat completions marks a trailing assistant message as a prefix`() {
        server.enqueue(MockResponse().setBody("""{"choices":[]}"""))

        client.proxy(
            request("chat/completions")
                .put("model", "deepseek-v4-pro")
                .put(
                    "messages",
                    JSONArray()
                        .put(JSONObject().put("role", "user").put("content", "write code"))
                        .put(JSONObject().put("role", "assistant").put("content", "```python\n")),
                ),
        )

        val body = JSONObject(server.takeRequest().body.readUtf8())
        val messages = body.getJSONArray("messages")
        assertFalse(messages.getJSONObject(0).has("prefix"))
        assertTrue(messages.getJSONObject(1).getBoolean("prefix"))
    }

    @Test
    fun `completions uses the beta base url and maps the FIM fields`() {
        server.enqueue(MockResponse().setBody("""{"choices":[{"text":"fib"}]}"""))

        val out = client.proxy(
            request("completions")
                .put("model", "deepseek-v4-pro")
                .put("prompt", "def fib(n):\n    ")
                .put("suffix", "\n    return fib(n)")
                .put("maxTokens", 256)
                .put("logprobs", 3)
                .put("echo", true),
        )

        assertTrue(out.getBoolean("ok"))
        val recorded = server.takeRequest()
        assertEquals("/beta/completions", recorded.path)
        val body = JSONObject(recorded.body.readUtf8())
        assertEquals("def fib(n):\n    ", body.getString("prompt"))
        assertEquals("\n    return fib(n)", body.getString("suffix"))
        assertEquals(256, body.getInt("max_tokens"))
        assertEquals(3, body.getInt("logprobs"))
        assertTrue(body.getBoolean("echo"))
    }

    @Test
    fun `models and balance endpoints are plain authenticated GETs`() {
        server.enqueue(MockResponse().setBody("""{"data":[{"id":"deepseek-chat"}]}"""))
        server.enqueue(
            MockResponse().setBody("""{"is_available":true,"balance_infos":[{"currency":"CNY"}]}"""),
        )

        val models = client.proxy(request("models"))
        val balance = client.proxy(request("user/balance"))

        assertTrue(models.getBoolean("ok"))
        assertEquals("deepseek-chat", models.getJSONObject("data").getJSONArray("data").getJSONObject(0).getString("id"))
        assertTrue(balance.getBoolean("ok"))
        assertTrue(balance.getJSONObject("data").getBoolean("is_available"))

        val modelsRequest = server.takeRequest()
        assertEquals("GET", modelsRequest.method)
        assertEquals("/models", modelsRequest.path)
        assertEquals("Bearer sk-test", modelsRequest.getHeader("Authorization"))

        val balanceRequest = server.takeRequest()
        assertEquals("GET", balanceRequest.method)
        assertEquals("/user/balance", balanceRequest.path)
    }

    @Test
    fun `streaming responses are decoded from SSE into a chunk array`() {
        val sse =
            """
            data: {"choices":[{"delta":{"content":"Hel"}}]}

            data: {"choices":[{"delta":{"content":"lo"}}]}

            : keep-alive
            data: [DONE]

            """.trimIndent()
        server.enqueue(MockResponse().setBody(sse).setHeader("Content-Type", "text/event-stream"))

        val out = client.proxy(
            request("chat/completions")
                .put("model", "deepseek-v4-flash")
                .put("stream", true)
                .put("streamOptions", JSONObject().put("includeUsage", true))
                .put("messages", JSONArray().put(JSONObject().put("role", "user").put("content", "hi"))),
        )

        assertTrue(out.getBoolean("ok"))
        assertTrue(out.getBoolean("streamed"))
        val chunks = out.getJSONArray("data")
        assertEquals(2, chunks.length())
        assertEquals("Hel", chunks.getJSONObject(0).getJSONArray("choices").getJSONObject(0).getJSONObject("delta").getString("content"))

        val recorded = server.takeRequest()
        assertEquals("text/event-stream", recorded.getHeader("Accept"))
        val body = JSONObject(recorded.body.readUtf8())
        assertTrue(body.getBoolean("stream"))
        assertTrue(body.getJSONObject("stream_options").getBoolean("include_usage"))
    }

    @Test
    fun `api failures keep the error message and status`() {
        server.enqueue(
            MockResponse()
                .setResponseCode(401)
                .setBody("""{"error":{"message":"Authentication Fails, Your api key is invalid"}}"""),
        )

        val out = client.proxy(request("chat/completions", apiKey = "bad"))

        assertFalse(out.getBoolean("ok"))
        assertEquals(401, out.getInt("status"))
        assertEquals("Authentication Fails, Your api key is invalid", out.getString("error"))
    }

    @Test
    fun `missing api key fails before any request is sent`() {
        val out = client.proxy(JSONObject().put("endpoint", "chat/completions"))

        assertFalse(out.getBoolean("ok"))
        assertEquals(0, out.getInt("status"))
        assertEquals("API key is required.", out.getString("error"))
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `unknown endpoints are rejected without a request`() {
        val out = client.proxy(request("chat/completionz"))

        assertFalse(out.getBoolean("ok"))
        assertTrue(out.getString("error").startsWith("Unknown endpoint: "))
        assertEquals(0, server.requestCount)
    }
}
