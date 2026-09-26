package com.betterdeepseek.app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InterruptedIOException
import java.util.concurrent.TimeUnit

/**
 * Native DeepSeek API proxy — the Android equivalent of the
 * `bds-api-proxy` message handler that used to live in the browser extension's
 * background service worker (`src/background/api-proxy.js`, side-effect
 * imported by `src/background/index.js`).
 *
 * That handler was *not* dead code: the API Playground
 * (`src/content/api-playground/api-store.svelte.js`) posts
 * `{ type: "bds-api-proxy", request: { endpoint, apiKey, ... } }` through
 * `chrome.runtime.sendMessage`, which the Android polyfill forwards to
 * [WebViewBridge.fetch]. Without a native equivalent every Playground request
 * failed with "Unsupported bridge message type", so the logic is ported here
 * 1:1:
 *
 * - `chat/completions` → `POST https://api.deepseek.com/chat/completions`
 * - `completions` (FIM / prefix completion) → `POST https://api.deepseek.com/beta/completions`
 * - `models` → `GET https://api.deepseek.com/models`
 * - `user/balance` → `GET https://api.deepseek.com/user/balance`
 *
 * Request bodies are built exactly like the JS builder functions (camelCase UI
 * fields → snake_case API fields), streaming responses are decoded from SSE
 * (`data: {...}` lines, `[DONE]` terminator) into the same array of parsed
 * chunks, and the response contract the store expects is preserved:
 *
 * - success: `{ ok: true, data, latency, streamed }`
 * - failure: `{ ok: false, error, status }`
 *
 * Timeouts: the desktop handler used `fetch()` with no timeout at all, and the
 * Playground has no cancel button, so a long thinking completion must not be cut
 * off. The shared bridge client caps a call at 120 s — a `deepseek-v4-pro`
 * thinking answer can easily exceed that — so this client only keeps the connect
 * timeout and disables the read/call timeouts, mirroring the browser.
 */
internal class ApiProxyClient(
        httpClient: OkHttpClient,
        private val baseUrl: String = DEFAULT_BASE_URL,
        private val betaBaseUrl: String = DEFAULT_BETA_BASE_URL,
) {

    companion object {
        const val DEFAULT_BASE_URL = "https://api.deepseek.com"
        const val DEFAULT_BETA_BASE_URL = "https://api.deepseek.com/beta"

        const val ENDPOINT_CHAT_COMPLETIONS = "chat/completions"
        const val ENDPOINT_COMPLETIONS = "completions"
        const val ENDPOINT_MODELS = "models"
        const val ENDPOINT_USER_BALANCE = "user/balance"

        private val JSON_MEDIA_TYPE = "application/json".toMediaType()
    }

    private val base = baseUrl.trimEnd('/')
    private val betaBase = betaBaseUrl.trimEnd('/')

    private val proxyClient: OkHttpClient =
            httpClient.newBuilder()
                    .callTimeout(0, TimeUnit.MILLISECONDS)
                    .readTimeout(0, TimeUnit.MILLISECONDS)
                    .build()

    /**
     * Run one Playground request. Never throws: every failure is reported as
     * `{ ok: false, error, status }`, the shape the JS `sendResponse` catch-all
     * produced.
     */
    fun proxy(request: JSONObject): JSONObject {
        val endpoint = request.optString("endpoint")
        val apiKey = request.optString("apiKey")
        if (apiKey.isEmpty()) {
            return error("API key is required.", status = 0)
        }

        val isStreaming = isTruthy(request.opt("stream"))
        val (url, method, body) =
                when (endpoint) {
                    ENDPOINT_CHAT_COMPLETIONS ->
                            Triple("$base/chat/completions", "POST", buildChatCompletionsBody(request))
                    ENDPOINT_COMPLETIONS ->
                            Triple("$betaBase/completions", "POST", buildCompletionsBody(request))
                    ENDPOINT_MODELS -> Triple("$base/models", "GET", null)
                    ENDPOINT_USER_BALANCE -> Triple("$base/user/balance", "GET", null)
                    else -> return error("Unknown endpoint: $endpoint", status = 0)
                }

        val builder =
                Request.Builder()
                        .url(url)
                        .header("Authorization", "Bearer $apiKey")
                        .header("Accept", if (isStreaming) "text/event-stream" else "application/json")
        if (!isStreaming) {
            builder.header("Content-Type", "application/json")
        }
        when (method) {
            "GET" -> builder.get()
            "HEAD" -> builder.head()
            else ->
                    builder.method(
                            method,
                            // Built from bytes on purpose: OkHttp appends
                            // "; charset=utf-8" to a *String* body's media type, while the
                            // JS sibling sends exactly "application/json".
                            (body ?: "{}").toByteArray(Charsets.UTF_8).toRequestBody(JSON_MEDIA_TYPE),
                    )
        }

        val startedAt = System.nanoTime()
        val response: Response =
                try {
                    proxyClient.newCall(builder.build()).execute()
                } catch (e: InterruptedIOException) {
                    return error(e.message ?: "Request interrupted", status = 0)
                } catch (e: Exception) {
                    return error(e.message ?: e.javaClass.simpleName, status = 0)
                }

        response.use { resp ->
            if (!resp.isSuccessful) {
                val bodyText = safeBody(resp)
                return error(apiErrorMessage(resp.code, bodyText), status = resp.code)
            }

            return if (isStreaming) {
                val chunks =
                        try {
                            decodeSseChunks(resp)
                        } catch (e: Exception) {
                            return error(e.message ?: e.javaClass.simpleName, status = 0)
                        }
                JSONObject()
                        .put("ok", true)
                        .put("data", chunks)
                        .put("latency", elapsedMillis(startedAt))
                        .put("streamed", true)
            } else {
                val bodyText = safeBody(resp)
                val data =
                        try {
                            JSONObject(bodyText)
                        } catch (e: Exception) {
                            return error(e.message ?: "Unexpected response body", status = 0)
                        }
                JSONObject()
                        .put("ok", true)
                        .put("data", data)
                        .put("latency", elapsedMillis(startedAt))
                        .put("streamed", false)
            }
        }
    }

    // ── Request builders (ports of buildChatCompletionsRequest / buildCompletionsRequest) ──

    private fun buildChatCompletionsBody(request: JSONObject): String {
        val body =
                JSONObject()
                        .put("messages", prefixedMessages(request.optJSONArray("messages")))
        putIfNotEmpty(body, "model", request.optString("model"))

        if (hasValue(request, "maxTokens")) body.put("max_tokens", request.get("maxTokens"))
        if (hasValue(request, "temperature")) body.put("temperature", request.get("temperature"))
        if (hasValue(request, "topP")) body.put("top_p", request.get("topP"))
        if (lengthOf(request.optJSONArray("stop")) > 0) body.put("stop", request.getJSONArray("stop"))
        if (isTruthy(request.opt("stream"))) {
            body.put("stream", true)
            if (request.optJSONObject("streamOptions")?.optBoolean("includeUsage") == true) {
                body.put("stream_options", JSONObject().put("include_usage", true))
            }
        }
        val thinking = request.optJSONObject("thinking")
        if (thinking?.optString("type") == "enabled") {
            body.put("thinking", thinking)
            if (request.optString("reasoningEffort").isNotEmpty()) {
                body.put("reasoning_effort", request.optString("reasoningEffort"))
            }
        }
        if (request.optJSONObject("responseFormat")?.optString("type") == "json_object") {
            body.put("response_format", JSONObject().put("type", "json_object"))
        }
        val tools = request.optJSONArray("tools")
        if (lengthOf(tools) > 0) {
            body.put("tools", tools)
            val toolChoice = request.optString("toolChoice")
            body.put("tool_choice", toolChoice.ifEmpty { "auto" })
        }
        if (isTruthy(request.opt("logprobs"))) body.put("logprobs", true)
        if (numberOf(request.opt("topLogprobs")) > 0 && !request.isNull("topLogprobs")) {
            body.put("top_logprobs", request.get("topLogprobs"))
        }
        if (request.optString("userId").isNotEmpty()) {
            body.put("user_id", request.optString("userId"))
        }

        return body.toString()
    }

    private fun buildCompletionsBody(request: JSONObject): String {
        val body = JSONObject().put("prompt", request.optString("prompt"))
        putIfNotEmpty(body, "model", request.optString("model"))

        if (request.optString("suffix").isNotEmpty()) body.put("suffix", request.optString("suffix"))
        if (hasValue(request, "maxTokens")) body.put("max_tokens", request.get("maxTokens"))
        if (hasValue(request, "temperature")) body.put("temperature", request.get("temperature"))
        if (hasValue(request, "topP")) body.put("top_p", request.get("topP"))
        if (lengthOf(request.optJSONArray("stop")) > 0) body.put("stop", request.getJSONArray("stop"))
        if (isTruthy(request.opt("stream"))) {
            body.put("stream", true)
            if (request.optJSONObject("streamOptions")?.optBoolean("includeUsage") == true) {
                body.put("stream_options", JSONObject().put("include_usage", true))
            }
        }
        if (numberOf(request.opt("logprobs")) > 0) {
            body.put("logprobs", request.get("logprobs"))
        }
        if (isTruthy(request.opt("echo"))) body.put("echo", true)

        return body.toString()
    }

    /**
     * The beta prefix-completion contract: a trailing `assistant` message is sent
     * with `prefix: true`. The JS builder mutates the caller's array, so the flag
     * ends up in the request body; here the flag is applied to the copy that goes
     * into the body instead of mutating the incoming payload.
     */
    private fun prefixedMessages(messages: JSONArray?): JSONArray {
        val copy = JSONArray()
        if (messages == null) return copy
        for (index in 0 until messages.length()) {
            val message = messages.optJSONObject(index) ?: continue
            copy.put(JSONObject(message.toString()))
        }
        if (copy.length() == 0) return copy
        val last = copy.optJSONObject(copy.length() - 1) ?: return copy
        if (last.optString("role") == "assistant") {
            last.put("prefix", true)
        }
        return copy
    }

    // ── Response decoding ─────────────────────────────────────────────────

    /**
     * SSE decoding, line by line, exactly like the JS reader: only `data: `
     * prefixed lines are considered, `[DONE]` is skipped and unparsable payloads
     * are ignored (never fatal).
     */
    private fun decodeSseChunks(response: Response): JSONArray {
        val chunks = JSONArray()
        val body = response.body ?: return chunks
        val reader: BufferedReader = body.charStream().buffered()
        while (true) {
            val line = reader.readLine() ?: break
            val trimmed = line.trim()
            if (!trimmed.startsWith("data: ")) continue
            val jsonText = trimmed.removePrefix("data: ").trim()
            if (jsonText == "[DONE]") continue
            try {
                chunks.put(JSONObject(jsonText))
            } catch (_: Exception) {
                // Non-JSON keep-alive payloads are dropped, as in JS.
            }
        }
        return chunks
    }

    /**
     * Port of the JS `ApiError` message resolution:
     * `error.message` → `error` (string) → the serialised body → `HTTP <status>`.
     */
    private fun apiErrorMessage(status: Int, bodyText: String): String {
        if (bodyText.isNotBlank()) {
            val parsed =
                    try {
                        JSONObject(bodyText)
                    } catch (_: Exception) {
                        null
                    }
            if (parsed != null) {
                val error = parsed.opt("error")
                when (error) {
                    is JSONObject -> {
                        val message = error.optString("message")
                        if (message.isNotEmpty()) return message
                    }
                    is String -> if (error.isNotEmpty()) return error
                }
                return parsed.toString()
            }
            return bodyText
        }
        return "HTTP $status"
    }

    private fun safeBody(response: Response): String =
            try {
                response.body?.string().orEmpty()
            } catch (_: Exception) {
                ""
            }

    private fun elapsedMillis(startedAtNanos: Long): Double =
            (System.nanoTime() - startedAtNanos) / 1_000_000.0

    private fun error(message: String, status: Int): JSONObject =
            JSONObject()
                    .put("ok", false)
                    .put("error", message)
                    .put("status", status)

    /** `req.x != null` in JS — present and not JSON `null`. */
    private fun hasValue(json: JSONObject, key: String): Boolean =
            json.has(key) && !json.isNull(key)

    /** JS `JSON.stringify` drops `undefined` fields, so empty strings are omitted as well. */
    private fun putIfNotEmpty(json: JSONObject, key: String, value: String) {
        if (value.isNotEmpty()) json.put(key, value)
    }

    /**
     * JS truthiness for the handful of flag fields the builders read.
     *
     * `JSONObject.opt` returns the `JSONObject.NULL` sentinel for absent keys,
     * which is compared by identity here (`is JSONObject.NULL` is not valid
     * Kotlin — `is` needs a type, not a value).
     */
    private fun isTruthy(value: Any?): Boolean =
            when {
                value == null || value === JSONObject.NULL -> false
                value is Boolean -> value
                value is Number -> value.toDouble() != 0.0
                value is String -> value.isNotEmpty()
                else -> true
            }

    /** `req.stop?.length` / `req.tools?.length`. */
    private fun lengthOf(array: JSONArray?): Int = array?.length() ?: 0

    /** `req.topLogprobs > 0` / `req.logprobs > 0`. */
    private fun numberOf(value: Any?): Double =
            when (value) {
                is Number -> value.toDouble()
                is String -> value.toDoubleOrNull() ?: 0.0
                else -> 0.0
            }
}
