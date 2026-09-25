package com.betterdeepseek.app

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.Assert.assertThrows
import java.util.concurrent.TimeUnit

/**
 * JVM-only tests for [McpClient] — the native port of the background SW's
 * MCP JSON-RPC helpers. Drives a MockWebServer and asserts the same protocol
 * behaviour the JS implementation had: init handshake, auth auto-detection,
 * session id propagation, SSE decoding, JSON-RPC errors and 404/400 retry.
 */
class McpClientTest {

    private lateinit var server: MockWebServer
    private lateinit var client: McpClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        val httpClient = OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(2, TimeUnit.SECONDS)
            .callTimeout(5, TimeUnit.SECONDS)
            .build()
        client = McpClient(httpClient)
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun jsonRpcResult(result: JSONObject, sessionId: String? = null): MockResponse {
        val body = JSONObject().put("jsonrpc", "2.0").put("id", 1).put("result", result)
        val response = MockResponse().setBody(body.toString())
        if (sessionId != null) {
            response.addHeader("Mcp-Session-Id", sessionId)
        }
        return response
    }

    @Test
    fun `listTools performs init handshake with bearer auth then tools list`() {
        val url = server.url("/mcp").toString()
        server.enqueue(jsonRpcResult(JSONObject().put("serverInfo", "x"), sessionId = "sess-1"))
        server.enqueue(MockResponse().setBody("{}")) // notifications/initialized (no id)
        val tools = JSONObject().put(
            "tools",
            org.json.JSONArray().put(JSONObject().put("name", "echo").put("description", "d")),
        )
        server.enqueue(jsonRpcResult(tools, sessionId = "sess-1"))

        val result = client.listTools(url, "secret-key", "0.1.14")

        assertEquals(3, server.requestCount)

        val initReq = server.takeRequest()
        assertEquals("POST", initReq.method)
        assertEquals("Bearer secret-key", initReq.getHeader("Authorization"))
        assertEquals("application/json, text/event-stream", initReq.getHeader("Accept"))
        val initBody = JSONObject(initReq.body.readUtf8())
        assertEquals("initialize", initBody.getString("method"))
        assertEquals("2024-11-05", initBody.getJSONObject("params").getString("protocolVersion"))
        assertEquals("better-deepseek", initBody.getJSONObject("params").getJSONObject("clientInfo").getString("name"))
        assertEquals("0.1.14", initBody.getJSONObject("params").getJSONObject("clientInfo").getString("version"))

        val notifyReq = server.takeRequest()
        assertEquals("notifications/initialized", JSONObject(notifyReq.body.readUtf8()).getString("method"))
        assertEquals("sess-1", notifyReq.getHeader("Mcp-Session-Id"))

        val listReq = server.takeRequest()
        assertEquals("tools/list", JSONObject(listReq.body.readUtf8()).getString("method"))
        assertEquals("sess-1", listReq.getHeader("Mcp-Session-Id"))

        assertEquals(tools, result)
    }

    @Test
    fun `listTools falls back to x-api-key after bearer 401`() {
        val url = server.url("/mcp").toString()
        server.enqueue(MockResponse().setResponseCode(401).setBody("unauthorized"))
        server.enqueue(jsonRpcResult(JSONObject(), sessionId = "sess-2"))
        server.enqueue(MockResponse().setBody("{}"))
        server.enqueue(jsonRpcResult(JSONObject().put("tools", org.json.JSONArray())))

        client.listTools(url, "k", "1.0")

        val bearerReq = server.takeRequest()
        assertEquals("Bearer k", bearerReq.getHeader("Authorization"))
        assertEquals(null, bearerReq.getHeader("X-API-Key"))

        val apiKeyReq = server.takeRequest()
        assertEquals(null, apiKeyReq.getHeader("Authorization"))
        assertEquals("k", apiKeyReq.getHeader("X-API-Key"))
    }

    @Test
    fun `listTools without apiKey sends no auth headers`() {
        val url = server.url("/mcp").toString()
        server.enqueue(jsonRpcResult(JSONObject()))
        server.enqueue(MockResponse().setBody("{}"))
        server.enqueue(jsonRpcResult(JSONObject().put("tools", org.json.JSONArray())))

        client.listTools(url, "", "1.0")

        val initReq = server.takeRequest()
        assertEquals(null, initReq.getHeader("Authorization"))
        assertEquals(null, initReq.getHeader("X-API-Key"))
    }

    @Test
    fun `listTools decodes SSE responses taking the last result`() {
        val url = server.url("/mcp").toString()
        server.enqueue(jsonRpcResult(JSONObject()))
        server.enqueue(MockResponse().setBody("{}"))
        val sse = "data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"partial\":1}}\n" +
            "data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"a\"}]}}\n" +
            "data: [DONE]\n"
        server.enqueue(MockResponse().setBody(sse).addHeader("Content-Type", "text/event-stream"))

        val result = client.listTools(url, "", "1.0")

        assertEquals("a", result.getJSONArray("tools").getJSONObject(0).getString("name"))
    }

    @Test
    fun `listTools surfaces JSON-RPC error messages`() {
        val url = server.url("/mcp").toString()
        server.enqueue(jsonRpcResult(JSONObject()))
        server.enqueue(MockResponse().setBody("{}"))
        val errorBody = JSONObject().put("jsonrpc", "2.0").put("id", 2)
            .put("error", JSONObject().put("code", -32000).put("message", "boom"))
        server.enqueue(MockResponse().setBody(errorBody.toString()))

        val ex = assertThrows(McpClient.McpException::class.java) {
            client.listTools(url, "", "1.0")
        }
        assertEquals("boom", ex.message)
        assertEquals(-1, ex.status)
    }

    @Test
    fun `listTools retries after 404 by re-initializing`() {
        val url = server.url("/mcp").toString()
        // First init + first list (404 = session expired)
        server.enqueue(jsonRpcResult(JSONObject(), sessionId = "old"))
        server.enqueue(MockResponse().setBody("{}"))
        server.enqueue(MockResponse().setResponseCode(404).setBody("session gone"))
        // Re-init + retry list
        server.enqueue(jsonRpcResult(JSONObject(), sessionId = "new"))
        server.enqueue(MockResponse().setBody("{}"))
        server.enqueue(jsonRpcResult(JSONObject().put("tools", org.json.JSONArray()), sessionId = "new"))

        val result = client.listTools(url, "", "1.0")

        assertEquals(6, server.requestCount)
        assertNotNull(result)
        val retryReq = server.takeRequest()
        assertEquals("new", retryReq.getHeader("Mcp-Session-Id"))
    }

    @Test
    fun `callTool sends name and arguments in tools call params`() {
        val url = server.url("/mcp").toString()
        server.enqueue(jsonRpcResult(JSONObject()))
        server.enqueue(MockResponse().setBody("{}"))
        server.enqueue(jsonRpcResult(JSONObject().put("content", org.json.JSONArray())))

        val args = JSONObject().put("q", "hello")
        client.callTool(url, "search", args, "", "1.0")

        val callReq = server.takeRequest()
        val body = JSONObject(callReq.body.readUtf8())
        assertEquals("tools/call", body.getString("method"))
        assertEquals("search", body.getJSONObject("params").getString("name"))
        assertEquals("hello", body.getJSONObject("params").getJSONObject("arguments").getString("q"))
    }

    @Test
    fun `non 401 403 init error aborts without trying other auth methods`() {
        val url = server.url("/mcp").toString()
        server.enqueue(MockResponse().setResponseCode(500).setBody("server exploded"))

        val ex = assertThrows(McpClient.McpException::class.java) {
            client.listTools(url, "k", "1.0")
        }
        assertEquals(500, ex.status)
        assertTrue(ex.message!!.contains("MCP server returned 500"))
        assertEquals(1, server.requestCount)
    }

    @Test
    fun `init result is cached so a second call skips the handshake`() {
        val url = server.url("/mcp").toString()
        server.enqueue(jsonRpcResult(JSONObject(), sessionId = "s1"))
        server.enqueue(MockResponse().setBody("{}"))
        server.enqueue(jsonRpcResult(JSONObject().put("tools", org.json.JSONArray())))
        server.enqueue(jsonRpcResult(JSONObject().put("tools", org.json.JSONArray())))

        client.listTools(url, "k", "1.0")
        client.listTools(url, "k", "1.0")

        assertEquals(4, server.requestCount)
        // The fourth request (second list) must still carry the session id.
        server.takeRequest()
        server.takeRequest()
        server.takeRequest()
        assertEquals("s1", server.takeRequest().getHeader("Mcp-Session-Id"))
    }
}
