package com.betterdeepseek.app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native DeepSeek-Harness bridge client — the Android equivalent of the
 * `PING_HARNESS` / `EXECUTE_HARNESS_TASK` handlers from the extension's
 * background service worker (`src/background/index.js`,
 * `handleHarnessTaskExecution`).
 *
 * The page itself cannot reach the harness: chat.deepseek.com is HTTPS and the
 * harness listens on `http://127.0.0.1:3080`, which the WebView blocks as
 * mixed content (`MIXED_CONTENT_NEVER_ALLOW` in MainActivity). The native side
 * has no such restriction, so every harness round trip goes through here.
 *
 * A 1:1 port of the JS logic, including the "Cordis" Mode A/B protocol:
 * - ping: plugin `GET /api/better-deepseek/ping` with
 *   `POST /api/host.describe` (Mode A) fallback.
 * - task: `workspace.list` folder-name lookup, `session.create`,
 *   `session.prompt` (queue mode).
 */
internal class HarnessClient(private val httpClient: OkHttpClient) {

    companion object {
        const val DEFAULT_BASE_URL = "http://127.0.0.1:3080"
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()

        /** Port of the JS `/^[a-zA-Z]:[\/\\]/` absolute-path check. */
        private val WINDOWS_DRIVE_PATTERN = Regex("^[a-zA-Z]:[/\\\\]")
    }

    /**
     * `PING_HARNESS`. Returns
     * `{ ok: true, available: true, mode: "plugin", pluginInfo? }`,
     * `{ ok: true, available: <bool>, mode: "native" }` or
     * `{ ok: false, available: false, error }`.
     */
    fun ping(baseUrl: String): JSONObject {
        val base = baseUrl.ifBlank { DEFAULT_BASE_URL }
        val pingUrl = "$base/api/better-deepseek/ping"

        val pluginResult = try {
            val response = httpClient.newCall(
                    Request.Builder().url(pingUrl).get().build(),
            ).execute()
            response.use { resp ->
                if (!resp.isSuccessful) {
                    null
                } else {
                    val body = resp.body?.string().orEmpty()
                    val pluginInfo = try {
                        JSONObject(body)
                    } catch (_: Exception) {
                        null
                    }
                    val out = JSONObject()
                            .put("ok", true)
                            .put("available", true)
                            .put("mode", "plugin")
                    if (pluginInfo != null) out.put("pluginInfo", pluginInfo)
                    out
                }
            }
        } catch (_: Exception) {
            null
        }
        if (pluginResult != null) return pluginResult

        // Fallback to standard host.describe (Mode A)
        return try {
            val reqBody = JSONObject()
                    .put("type", "client-request")
                    .put("rpcId", "ping")
                    .put("method", "host.describe")
                    .put("payload", JSONObject())
            val response = httpClient.newCall(
                    Request.Builder()
                            .url("$base/api/host.describe")
                            .post(reqBody.toString().toRequestBody(JSON_MEDIA_TYPE))
                            .header("Content-Type", "application/json")
                            .build(),
            ).execute()
            response.use { resp ->
                val data = JSONObject(resp.body?.string().orEmpty())
                val available = data.optJSONObject("result")?.opt("ok") ?: true
                JSONObject()
                        .put("ok", true)
                        .put("available", available)
                        .put("mode", "native")
            }
        } catch (e: Exception) {
            JSONObject()
                    .put("ok", false)
                    .put("available", false)
                    .put("error", e.message ?: "Harness unreachable")
        }
    }

    /**
     * `EXECUTE_HARNESS_TASK`. Port of `handleHarnessTaskExecution`: workspace
     * lookup, session creation and prompt queueing against the harness ApiProxy.
     */
    fun executeTask(payload: JSONObject): JSONObject {
        val baseUrl = (payload.optString("baseUrl").ifBlank { DEFAULT_BASE_URL })
                .trimEnd('/')

        if (payload.optBoolean("queryWorkspacesOnly")) {
            return queryWorkspacePath(payload)
        }

        val rawCwd = payload.optString("cwd").trim()
        val workspaceId = payload.optString("workspaceId").trim()
        val promptText = (payload.optString("prompt").ifBlank { payload.optString("task") }).trim()

        if (rawCwd.isEmpty() && workspaceId.isEmpty()) {
            throw IllegalArgumentException("Missing required cwd or workspaceId for Harness session creation.")
        }
        if (rawCwd.isNotEmpty() && !isAbsolute(rawCwd)) {
            return JSONObject()
                    .put("ok", false)
                    .put(
                            "error",
                            "Absolute path is required for Harness (e.g. A:/Users/Edige/GitHub/asistan). " +
                                    "Relative path \"$rawCwd\" is forbidden.",
                    )
                    .put(
                            "debug",
                            JSONObject()
                                    .put("providedCwd", rawCwd)
                                    .put("recommendation", "Please enter full absolute directory path in the path field."),
                    )
        }

        // 1. Create Session via POST /api/better-deepseek/session.create
        val createPayload = if (workspaceId.isNotEmpty()) {
            JSONObject().put("workspaceId", workspaceId)
        } else {
            JSONObject().put("cwd", rawCwd)
        }
        val reqBody = JSONObject()
                .put("type", "client-request")
                .put("rpcId", "bd-create-${System.currentTimeMillis()}")
                .put("method", "session.create")
                .put("payload", createPayload)

        val targetUrl = "$baseUrl/api/better-deepseek/session.create"
        val createResult = post(targetUrl, reqBody)

        if (createResult == null) {
            return JSONObject()
                    .put("ok", false)
                    .put(
                            "error",
                            "Network Error: Cannot connect to Harness server at $baseUrl. Ensure local Harness is running on 127.0.0.1:3080.",
                    )
                    .put(
                            "debug",
                            JSONObject().put("url", targetUrl).put("requestPayload", reqBody),
                    )
        }

        val (status, bodyText) = createResult

        if (status < 200 || status >= 300) {
            val messageDetail = try {
                val errJson = JSONObject(bodyText)
                val nested = errJson.optJSONObject("result")?.optJSONObject("error")?.optString("message")
                nested
                        ?: errJson.optString("message")
                        .ifBlank { errJson.optString("error") }
                        .ifBlank { bodyText }
            } catch (_: Exception) {
                bodyText.ifBlank { "HTTP $status" }
            }
            return JSONObject()
                    .put("ok", false)
                    .put("error", "Harness session.create HTTP $status: $messageDetail")
                    .put(
                            "debug",
                            JSONObject()
                                    .put("url", targetUrl)
                                    .put("status", status)
                                    .put("requestPayload", reqBody)
                                    .put("responseBody", bodyText),
                    )
        }

        val createData = try {
            JSONObject(bodyText)
        } catch (e: Exception) {
            return JSONObject()
                    .put("ok", false)
                    .put("error", "Failed to parse JSON response from session.create: $bodyText")
                    .put("debug", JSONObject().put("url", targetUrl).put("responseBody", bodyText))
        }

        val result = createData.optJSONObject("result")
        val sessionId = result?.optJSONObject("value")?.optString("sessionId").orEmpty()
        if (result == null || !result.optBoolean("ok") || sessionId.isEmpty()) {
            val errMsg = result?.optJSONObject("error")?.optString("message")
                    ?.ifBlank { null }
                    ?: "Failed to create session on Harness (missing sessionId)."
            return JSONObject()
                    .put("ok", false)
                    .put("error", errMsg)
                    .put("debug", JSONObject().put("url", targetUrl).put("responseData", createData))
        }

        // 2. Prompt Session via POST /api/better-deepseek/session.prompt
        if (promptText.isNotEmpty()) {
            val promptReqBody = JSONObject()
                    .put("type", "client-request")
                    .put("rpcId", "bd-prompt-${System.currentTimeMillis()}")
                    .put("method", "session.prompt")
                    .put(
                            "payload",
                            JSONObject()
                                    .put("sessionId", sessionId)
                                    .put("text", promptText)
                                    .put("mode", "queue")
                                    .put(
                                            "content",
                                            JSONArray().put(JSONObject().put("type", "text").put("text", promptText)),
                                    ),
                    )

            val pUrl = "$baseUrl/api/better-deepseek/session.prompt"
            val promptResult = post(pUrl, promptReqBody)
            if (promptResult == null) {
                return JSONObject()
                        .put("ok", false)
                        .put("error", "Harness session.prompt HTTP Error: network failure")
                        .put(
                                "debug",
                                JSONObject()
                                        .put("url", pUrl)
                                        .put("requestPayload", promptReqBody),
                        )
            }
            val (pStatus, pText) = promptResult!!
            if (pStatus < 200 || pStatus >= 300) {
                return JSONObject()
                        .put("ok", false)
                        .put("error", "Harness session.prompt HTTP $pStatus: $pText")
                        .put(
                                "debug",
                                JSONObject()
                                        .put("url", pUrl)
                                        .put("status", pStatus)
                                        .put("requestPayload", promptReqBody)
                                        .put("responseBody", pText),
                        )
            }
        }

        return JSONObject()
                .put("ok", true)
                .put("sessionId", sessionId)
                .put("baseUrl", baseUrl)
    }

    /**
     * `queryWorkspacesOnly` branch: match a folder name against
     * `POST /api/workspace.list` and return its resolved path.
     */
    private fun queryWorkspacePath(payload: JSONObject): JSONObject {
        try {
            val wsRes = post(
                    (payload.optString("baseUrl").ifBlank { DEFAULT_BASE_URL }).trimEnd('/') + "/api/workspace.list",
                    JSONObject()
                            .put("type", "client-request")
                            .put("rpcId", "ws-list-${System.currentTimeMillis()}")
                            .put("method", "workspace.list")
                            .put("payload", JSONObject()),
            ) ?: return JSONObject().put("ok", false).put("matchedPath", "")

            if (wsRes.status in 200..299) {
                val wsData = JSONObject(wsRes.body)
                val list: List<JSONObject> = buildList {
                    val valueList = wsData.optJSONObject("result")?.optJSONObject("value")?.optJSONArray("list")
                    val resultList = wsData.optJSONObject("result")?.optJSONArray("list")
                    val rootList = wsData.optJSONArray("list")
                    val chosen = valueList ?: resultList ?: rootList ?: return@buildList
                    for (i in 0 until chosen.length()) {
                        chosen.optJSONObject(i)?.let { add(it) }
                    }
                }

                val fn = payload.optString("folderName").lowercase().trim()
                val match = list.firstOrNull { ws ->
                    val name = ws.optString("name").lowercase()
                    val p = (ws.optString("path").ifBlank { ws.optString("cwd") }.ifBlank { ws.optString("uri") })
                            .lowercase()
                            .replace('\\', '/')
                    name == fn || p.endsWith("/$fn") || p.endsWith("\\$fn") || p == fn
                }
                if (match != null) {
                    val resPath = match.optString("path").ifBlank { match.optString("cwd") }.ifBlank { match.optString("uri") }
                    return JSONObject().put("ok", true).put("matchedPath", resPath)
                }
            }
        } catch (_: Exception) {
            // Workspace list query failed — fall through to the empty match.
        }
        return JSONObject().put("ok", false).put("matchedPath", "")
    }

    private data class HttpOutcome(val status: Int, val body: String)

    /** POST JSON; returns null on network failure (connection refused etc.). */
    private fun post(url: String, body: JSONObject): HttpOutcome? {
        return try {
            val response = httpClient.newCall(
                    Request.Builder()
                            .url(url)
                            .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                            .header("Content-Type", "application/json")
                            .header("Accept", "application/json")
                            .build(),
            ).execute()
            response.use { resp ->
                val text = try {
                    resp.body?.string().orEmpty()
                } catch (_: Exception) {
                    ""
                }
                HttpOutcome(resp.code, text)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun isAbsolute(p: String): Boolean {
        if (p.isEmpty()) return false
        // `containsMatchIn` is the equivalent of the JS `.test()` (a prefix test):
        // `matches` would require the whole path to match the pattern and reject
        // every real path such as "A:/Users/Edige/GitHub/asistan".
        return p.startsWith("/") || p.startsWith("\\") || WINDOWS_DRIVE_PATTERN.containsMatchIn(p)
    }
}
