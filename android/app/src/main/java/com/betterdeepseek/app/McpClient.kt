package com.betterdeepseek.app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.InterruptedIOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Native MCP (Model Context Protocol) client — the Android equivalent of the
 * `bds-mcp-*` handlers that used to live in the browser extension's background
 * service worker (`src/background/index.js`).
 *
 * Implements the Streamable HTTP transport:
 * - JSON-RPC 2.0 over POST with `Content-Type: application/json`
 * - `initialize` handshake with auth-method auto-detection:
 *   1. `Authorization: Bearer <apiKey>`
 *   2. `X-API-Key: <apiKey>`
 *   3. no auth header (public / URL-based `?apiKey=` servers)
 * - `Mcp-Session-Id` request/response header tracking
 * - JSON *and* SSE (`text/event-stream`) response decoding
 * - 30 s request timeout (mirrors `MCP_REQUEST_TIMEOUT_MS` on the JS side)
 * - 404/400 → re-initialize once and retry (session expiry recovery)
 *
 * All methods are synchronous and intended to be called from the WebView's
 * JavaBridge thread — the same threading model as the other
 * [WebViewBridge.fetch] handlers.
 */
internal class McpClient(private val httpClient: OkHttpClient) {

    companion object {
        const val REQUEST_TIMEOUT_MS = 30_000L
        const val PROTOCOL_VERSION = "2024-11-05"
        const val CLIENT_NAME = "better-deepseek"
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()
    }

    /** Thrown for JSON-RPC protocol / HTTP failures, carrying the HTTP status when known. */
    internal class McpException(message: String, val status: Int = -1) : RuntimeException(message)

    private class InitState(
        @Volatile var sessionId: String? = null,
        @Volatile var authMethod: String = "bearer",
    )

    /** Cached initialization per (serverUrl, apiKey), mirroring the JS `mcpInitCache`. */
    private val initCache = ConcurrentHashMap<String, InitState>()

    private val requestSeq = AtomicInteger(1)

    /**
     * `tools/list` — returns the JSON-RPC `result` object (usually `{ "tools": [...] }`).
     * Throws [McpException] on failure.
     */
    fun listTools(serverUrl: String, apiKey: String, clientVersion: String): JSONObject {
        return jsonRpcRequest(serverUrl, "tools/list", JSONObject(), apiKey, clientVersion)
    }

    /**
     * `tools/call` — returns the JSON-RPC `result` object. Throws [McpException] on failure.
     */
    fun callTool(
            serverUrl: String,
            toolName: String,
            args: JSONObject,
            apiKey: String,
            clientVersion: String,
    ): JSONObject {
        val params = JSONObject().put("name", toolName).put("arguments", args)
        return jsonRpcRequest(serverUrl, "tools/call", params, apiKey, clientVersion)
    }

    /** Drop the cached initialization for a server (session-expiry recovery). */
    fun clearInit(serverUrl: String, apiKey: String) {
        initCache.remove(cacheKey(serverUrl, apiKey))
    }

    private fun jsonRpcRequest(
            serverUrl: String,
            method: String,
            params: JSONObject,
            apiKey: String,
            clientVersion: String,
    ): JSONObject {
        val init = ensureInitialized(serverUrl, apiKey, clientVersion)
        return try {
            sendRequest(serverUrl, method, params, apiKey, init.sessionId, init.authMethod)
        } catch (e: McpException) {
            if (e.status == 404 || e.status == 400) {
                clearInit(serverUrl, apiKey)
                val retryInit = ensureInitialized(serverUrl, apiKey, clientVersion)
                sendRequest(serverUrl, method, params, apiKey, retryInit.sessionId, retryInit.authMethod)
            } else {
                throw e
            }
        }
    }

    private fun sendRequest(
            serverUrl: String,
            method: String,
            params: JSONObject,
            apiKey: String,
            sessionId: String?,
            authMethod: String,
    ): JSONObject {
        val body = JSONObject()
                .put("jsonrpc", "2.0")
                .put("id", requestSeq.incrementAndGet())
                .put("method", method)
                .put("params", params)
        return fetch(serverUrl, body, apiKey, sessionId, authMethod).result ?: JSONObject()
    }

    /**
     * Ensure the session is initialized (cached per url|apiKey). Auto-detects the
     * working auth method by trying Bearer, X-API-Key, then none — 401/403 moves
     * to the next attempt, any other error aborts and clears the cache entry.
     */
    private fun ensureInitialized(serverUrl: String, apiKey: String, clientVersion: String): InitState {
        val key = cacheKey(serverUrl, apiKey)
        initCache[key]?.let { return it }

        val entry = InitState()
        initCache[key] = entry

        val initBody = JSONObject()
                .put("jsonrpc", "2.0")
                .put("id", 1)
                .put("method", "initialize")
                .put(
                        "params",
                        JSONObject()
                                .put("protocolVersion", PROTOCOL_VERSION)
                                .put("capabilities", JSONObject())
                                .put(
                                        "clientInfo",
                                        JSONObject().put("name", CLIENT_NAME).put("version", clientVersion),
                                ),
                )

        val attempts = buildList {
            if (apiKey.isNotEmpty()) {
                add("bearer" to apiKey)
                add("x-api-key" to apiKey)
            }
            add("none" to "")
        }

        var lastError: McpException? = null
        for ((authMethod, key_) in attempts) {
            try {
                val fetched = fetch(serverUrl, initBody, key_, null, authMethod)
                entry.sessionId = fetched.sessionId
                entry.authMethod = authMethod
                // Send the `notifications/initialized` notification. It carries no id and has no
                // observable effect on later calls, so failures are ignored (the JS side fires it
                // and discards the promise).
                try {
                    fetch(
                            serverUrl,
                            JSONObject().put("jsonrpc", "2.0").put("method", "notifications/initialized"),
                            key_,
                            entry.sessionId,
                            authMethod,
                    )
                } catch (_: Exception) {
                    // Notification failures never break tool calls.
                }
                return entry
            } catch (e: McpException) {
                if (e.status == 401 || e.status == 403) {
                    lastError = e
                    continue
                }
                initCache.remove(key)
                throw e
            }
        }

        initCache.remove(key)
        throw lastError ?: McpException("All auth methods failed for $serverUrl")
    }

    private data class FetchResult(val result: JSONObject?, val sessionId: String?)

    /**
     * Single JSON-RPC round trip. Decodes JSON and SSE bodies, surfaces JSON-RPC
     * `error` objects as [McpException], and returns the response session id.
     */
    private fun fetch(
            serverUrl: String,
            body: JSONObject,
            apiKey: String,
            sessionId: String?,
            authMethod: String,
    ): FetchResult {
        val builder = Request.Builder()
                .url(serverUrl)
                .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json, text/event-stream")
        if (apiKey.isNotEmpty() && authMethod == "bearer") {
            builder.header("Authorization", "Bearer $apiKey")
        } else if (apiKey.isNotEmpty() && authMethod == "x-api-key") {
            builder.header("X-API-Key", apiKey)
        }
        if (sessionId != null) {
            builder.header("Mcp-Session-Id", sessionId)
        }

        val timeoutClient = httpClient.newBuilder()
                .callTimeout(REQUEST_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                .build()

        val response: Response = try {
            timeoutClient.newCall(builder.build()).execute()
        } catch (e: InterruptedIOException) {
            throw McpException("MCP server did not respond within 30s")
        }

        response.use { resp ->
            if (!resp.isSuccessful) {
                val detail = resp.body?.string()?.orEmpty().take(300)
                throw McpException(
                        "MCP server returned ${resp.code}${if (detail.isNotEmpty()) ": $detail" else ""}",
                        resp.code,
                )
            }

            val responseSessionId = resp.header("Mcp-Session-Id")
            val contentType = (resp.header("Content-Type") ?: "").lowercase()
            val text = resp.body?.string().orEmpty()

            val result: JSONObject? = if (contentType.contains("text/event-stream")) {
                decodeSse(text)
            } else {
                if (text.trim().isEmpty()) {
                    null
                } else {
                    val data = JSONObject(text)
                    val error = data.optJSONObject("error")
                    if (error != null) {
                        throw McpException(error.optString("message").ifEmpty { error.toString() })
                    }
                    data.optJSONObject("result")
                }
            }

            return FetchResult(result, responseSessionId)
        }
    }

    /**
     * SSE decoding: the last `data:` payload carrying a `result` wins; JSON-RPC
     * `error` payloads abort. Mirrors the background SW line-by-line loop.
     */
    private fun decodeSse(text: String): JSONObject? {
        var lastResult: JSONObject? = null
        for (line in text.split("\n")) {
            if (!line.startsWith("data: ")) continue
            val raw = line.removePrefix("data: ").trim()
            if (raw == "[DONE]") continue
            val parsed = try {
                JSONObject(raw)
            } catch (_: Exception) {
                continue
            }
            val error = parsed.optJSONObject("error")
            if (error != null) {
                throw McpException(error.optString("message").ifEmpty { error.toString() })
            }
            val result = parsed.optJSONObject("result")
            if (result != null) lastResult = result
        }
        return lastResult
    }

    private fun cacheKey(serverUrl: String, apiKey: String): String = "$serverUrl|$apiKey"
}
