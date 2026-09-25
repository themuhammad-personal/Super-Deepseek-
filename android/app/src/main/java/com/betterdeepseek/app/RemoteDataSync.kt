package com.betterdeepseek.app

import android.content.SharedPreferences
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date
import java.util.Locale

/**
 * Native remote-data persistence — the Android equivalent of the background
 * service worker's startup / locale handlers (`BDS_WAIT_FOR_STARTUP`,
 * `BDS_UPDATE_LANGUAGES`, `BDS_RESET_LANGUAGES`).
 *
 * Ported from `src/lib/remote-persistence.js` + `src/background/index.js`:
 *
 * - [updateLanguages] fetches every shipped locale (`src/locales/*.json`) from
 *   the published repo, keeps only valid `{ ..., messages: {...} }` roots,
 *   merges them into the `bds_locale_updates` store (preserving stored values
 *   for codes that failed this round) and stamps `bds_locale_update_last_checked`.
 * - [waitForStartup] persists the status feed (`bds_remote_announcement`) and
 *   the remote config (`bds_remote_config` + `bds_remote_config_meta`).
 * - [resetLanguages] clears the locale-update store keys.
 *
 * Storage layout matches the JS chrome.storage.local contract exactly: every
 * value is the `JSON.stringify` of the stored value (the same format the
 * `android-chrome-polyfill.js` writes via [WebViewBridge.setStorage]), so the
 * content-side i18n / settings code reads identical data regardless of which
 * side performed the write.
 */
internal class RemoteDataSync(
        private val prefs: SharedPreferences,
        private val httpClient: OkHttpClient,
        private val localeBaseUrl: String = DEFAULT_LOCALE_BASE_URL,
        private val remoteConfigUrl: String = DEFAULT_REMOTE_CONFIG_URL,
        private val remoteStatusUrl: String = DEFAULT_REMOTE_STATUS_URL,
) {

    companion object {
        // These are the *published* URLs of the upstream repository, which is the single source of
        // truth for remote data (the in-app updater reads the same repository's releases). The
        // payload files also live in this repo under `remote/` as a mirror, but the published
        // paths are `extension/…` — pointing at `remote/…` upstream returns 404. Keep these in sync
        // with PRICING_URLS / REMOTE_CONFIG_URL / LOCALE_BASE_URL in src/lib/constants.js and
        // src/lib/remote-persistence.js.
        const val DEFAULT_LOCALE_BASE_URL =
                "https://raw.githubusercontent.com/EdgeTypE/better-deepseek/main/src/locales"
        const val DEFAULT_REMOTE_CONFIG_URL =
                "https://raw.githubusercontent.com/EdgeTypE/better-deepseek/main/extension/remote-config.json"
        const val DEFAULT_REMOTE_STATUS_URL =
                "https://raw.githubusercontent.com/EdgeTypE/better-deepseek/main/extension/status.json"

        /** Mirrors the `src/locales/*.json` files bundled with the app. */
        val LOCALE_CODES = listOf("en", "fa", "ru", "tr", "zh-cn")

        private const val KEY_LOCALES = "bds_locale_updates"
        private const val KEY_LOCALE_CHECKED = "bds_locale_update_last_checked"
        private const val KEY_ANNOUNCEMENT = "bds_remote_announcement"
        private const val KEY_CONFIG = "bds_remote_config"
        private const val KEY_CONFIG_META = "bds_remote_config_meta"
    }

    /**
     * `BDS_UPDATE_LANGUAGES`. Fetches all locales in parallel-equivalent fashion
     * (sequentially over OkHttp — the JavaBridge thread is dedicated to this
     * call), merges into storage, returns `{ success, writtenKeys, error? }`.
     */
    fun updateLanguages(now: Long = System.currentTimeMillis()): JSONObject {
        return try {
            val fetched = JSONObject()
            for (code in LOCALE_CODES) {
                val json = getJson("$localeBaseUrl/$code.json?t=$now") ?: continue
                val messages = json.optJSONObject("messages")
                if (json.length() > 0 && messages != null) {
                    fetched.put(code, json)
                }
            }

            if (fetched.length() == 0) {
                return result(success = false, writtenKeys = emptyList(), error = "No valid locale files fetched")
            }

            val storedLocales = parseJsonObject(prefs.getString(KEY_LOCALES, null)) ?: JSONObject()

            val merged = JSONObject()
            for (code in LOCALE_CODES) {
                if (fetched.has(code)) {
                    merged.put(code, fetched.get(code))
                } else {
                    val previous = storedLocales.opt(code)
                    if (previous != null) {
                        merged.put(code, previous)
                    }
                }
            }

            val lastChecked = mediumDate(now)

            val diff = diffOf(
                    Triple(KEY_LOCALES, storedValue(KEY_LOCALES), merged),
                    Triple(KEY_LOCALE_CHECKED, storedValue(KEY_LOCALE_CHECKED), lastChecked),
            )
            return if (diff != null) {
                writeMap(diff)
                result(success = true, writtenKeys = diff.keys().toList())
            } else {
                result(success = true, writtenKeys = emptyList())
            }
        } catch (e: Exception) {
            result(success = false, writtenKeys = emptyList(), error = e.message ?: "Unknown error")
        }
    }

    /**
     * `BDS_WAIT_FOR_STARTUP`. Persists remote status + remote config, returns
     * `{ success, remoteStatus, remoteConfig }`.
     */
    fun waitForStartup(now: Long = System.currentTimeMillis()): JSONObject {
        val remoteStatus = persistRemoteStatus(now)
        val remoteConfig = persistRemoteConfig(now)
        return JSONObject()
                .put("success", remoteStatus.optBoolean("success") && remoteConfig.optBoolean("success"))
                .put("remoteStatus", remoteStatus)
                .put("remoteConfig", remoteConfig)
    }

    /**
     * `BDS_RESET_LANGUAGES`. Removes the locale-update keys, returns
     * `{ success: true }` (or `{ success: false, error }` on failure).
     */
    fun resetLanguages(): JSONObject {
        return try {
            prefs.edit()
                    .remove(KEY_LOCALES)
                    .remove(KEY_LOCALE_CHECKED)
                    .apply()
            result(success = true, writtenKeys = emptyList())
        } catch (e: Exception) {
            result(success = false, writtenKeys = emptyList(), error = e.message ?: "Unknown error")
        }
    }

    // ── internals ─────────────────────────────────────────────────────────

    /** `persistRemoteStatus` in remote-persistence.js. */
    private fun persistRemoteStatus(now: Long): JSONObject {
        return try {
            val response = httpClient.newCall(
                    Request.Builder().url("$remoteStatusUrl?t=$now").get().build(),
            ).execute()
            response.use { resp ->
                if (!resp.isSuccessful) {
                    return result(success = false, writtenKeys = emptyList(), error = "HTTP ${resp.code}")
                }
                val rawText = resp.body?.string().orEmpty()
                val data = try {
                    JSONObject(rawText)
                } catch (e: Exception) {
                    try {
                        JSONArray(rawText)
                    } catch (_: Exception) {
                        return result(success = false, writtenKeys = emptyList(), error = "Empty status payload")
                    }
                }
                val announcements = if (data is JSONArray) data else JSONArray().put(data)

                val diff = diffOf(Triple(KEY_ANNOUNCEMENT, storedValue(KEY_ANNOUNCEMENT), announcements))
                return if (diff != null) {
                    writeMap(diff)
                    result(success = true, writtenKeys = diff.keys().toList())
                } else {
                    result(success = true, writtenKeys = emptyList())
                }
            }
        } catch (e: Exception) {
            result(success = false, writtenKeys = emptyList(), error = e.message ?: "Unknown error")
        }
    }

    /** `persistRemoteConfig` in remote-persistence.js. */
    private fun persistRemoteConfig(now: Long): JSONObject {
        return try {
            val response = httpClient.newCall(
                    Request.Builder().url("$remoteConfigUrl?t=$now").get().build(),
            ).execute()
            response.use { resp ->
                if (!resp.isSuccessful) {
                    return result(success = false, writtenKeys = emptyList(), error = "HTTP ${resp.code}")
                }
                // Only non-array plain objects are accepted roots — parsing a
                // JSONArray/scalar body throws, which maps to the JS
                // "Invalid config root" error.
                val config = try {
                    JSONObject(resp.body?.string().orEmpty())
                } catch (_: Exception) {
                    return result(success = false, writtenKeys = emptyList(), error = "Invalid config root")
                }

                val meta = JSONObject()
                        .put("lastFetched", now)
                        .put("version", config.optJSONObject("meta")?.opt("version") ?: 0)

                val diff = diffOf(
                        Triple(KEY_CONFIG, storedValue(KEY_CONFIG), config),
                        Triple(KEY_CONFIG_META, storedValue(KEY_CONFIG_META), meta),
                )
                return if (diff != null) {
                    writeMap(diff)
                    result(success = true, writtenKeys = diff.keys().toList())
                } else {
                    result(success = true, writtenKeys = emptyList())
                }
            }
        } catch (e: Exception) {
            result(success = false, writtenKeys = emptyList(), error = e.message ?: "Unknown error")
        }
    }

    /**
     * Build a key→value map of only the changed entries (the JS `computeDiff`),
     * or null when nothing changed.
     */
    private fun diffOf(vararg triples: Triple<String, Any?, Any?>): JSONObject? {
        val diff = JSONObject()
        for ((key, stored, newValue) in triples) {
            if (!deepEqualJson(stored, newValue)) {
                diff.put(key, newValue)
            }
        }
        return if (diff.length() > 0) diff else null
    }

    private fun writeMap(values: JSONObject) {
        val editor = prefs.edit()
        for (key in values.keys()) {
            editor.putString(key, values.get(key).toString())
        }
        editor.apply()
    }

    /** Current stored value for [key] as a parsed JSON value (null when absent/invalid). */
    private fun storedValue(key: String): Any? {
        val raw = prefs.getString(key, null) ?: return null
        return try {
            val trimmed = raw.trim()
            when {
                trimmed.startsWith("{") -> JSONObject(trimmed)
                trimmed.startsWith("[") -> JSONArray(trimmed)
                trimmed.isEmpty() -> null
                else -> raw // plain string value
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun deepEqualJson(a: Any?, b: Any?): Boolean {
        if (a === b) return true
        if (a == null || b == null) return a == b
        return when {
            a is JSONObject && b is JSONObject -> a.equals(b)
            a is JSONArray && b is JSONArray -> a.equals(b)
            a is Number && b is Number -> a.toLong() == b.toLong()
            else -> a.equals(b)
        }
    }

    private fun parseJsonObject(raw: String?): JSONObject? {
        if (raw.isNullOrBlank()) return null
        return try {
            val trimmed = raw.trim()
            if (trimmed.startsWith("{")) JSONObject(trimmed) else null
        } catch (_: Exception) {
            null
        }
    }

    private fun getJson(url: String): JSONObject? {
        val response = httpClient.newCall(Request.Builder().url(url).get().build()).execute()
        response.use { resp ->
            if (!resp.isSuccessful) return null
            return try {
                JSONObject(resp.body?.string().orEmpty())
            } catch (_: Exception) {
                null
            }
        }
    }

    /**
     * Medium date in the device locale — the display-only equivalent of JS
     * `new Date(now).toLocaleDateString()` (SettingsPanel renders it verbatim).
     */
    private fun mediumDate(now: Long): String =
            DateFormat.getDateInstance(DateFormat.MEDIUM, Locale.getDefault()).format(Date(now))

    private fun result(success: Boolean, writtenKeys: List<String>, error: String? = null): JSONObject {
        val out = JSONObject()
                .put("success", success)
                .put("writtenKeys", JSONArray(writtenKeys))
        if (error != null) out.put("error", error)
        return out
    }
}
