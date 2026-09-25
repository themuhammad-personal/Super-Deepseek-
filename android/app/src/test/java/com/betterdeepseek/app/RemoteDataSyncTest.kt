package com.betterdeepseek.app

import android.content.SharedPreferences
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

/**
 * JVM-only tests for [RemoteDataSync] — the native port of the background SW's
 * locale/remote-config persistence. Uses an in-memory SharedPreferences and a
 * MockWebServer standing in for the raw.githubusercontent.com payloads, and
 * asserts the exact storage keys/shapes the content-side JS reads.
 */
class RemoteDataSyncTest {

    private lateinit var server: MockWebServer
    private lateinit var prefs: InMemorySharedPreferences
    private lateinit var sync: RemoteDataSync

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        val httpClient = OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(2, TimeUnit.SECONDS)
            .callTimeout(5, TimeUnit.SECONDS)
            .build()
        prefs = InMemorySharedPreferences()
        sync = RemoteDataSync(
            prefs,
            httpClient,
            localeBaseUrl = server.url("/src/locales").toString(),
            remoteConfigUrl = server.url("/extension/remote-config.json").toString(),
            remoteStatusUrl = server.url("/extension/status.json").toString(),
        )
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun enqueueAllLocales(skip: List<String> = emptyList(), invalid: List<String> = emptyList()) {
        for (code in RemoteDataSync.LOCALE_CODES) {
            when {
                code in skip -> server.enqueue(MockResponse().setResponseCode(404))
                code in invalid -> server.enqueue(MockResponse().setBody("""{"notMessages":{}}"""))
                else -> server.enqueue(
                    MockResponse().setBody(
                        """{"code":"$code","messages":{"hello":"Hello"}}""",
                    ),
                )
            }
        }
    }

    // ── updateLanguages (BDS_UPDATE_LANGUAGES) ───────────────────────────

    @Test
    fun `updateLanguages fetches every locale and persists merged store`() {
        enqueueAllLocales()

        val result = sync.updateLanguages(1_700_000_000_000L)

        assertTrue(result.getBoolean("success"))
        assertEquals(2, result.getJSONArray("writtenKeys").length())

        val stored = JSONObject(prefs["bds_locale_updates"]!!)
        assertEquals(5, stored.length())
        assertEquals("en", stored.keySet().toList().first { it == "en" })
        assertEquals("Hello", stored.getJSONObject("en").getJSONObject("messages").getString("hello"))
        assertEquals("Hello", stored.getJSONObject("zh-cn").getJSONObject("messages").getString("hello"))
        assertTrue(prefs.containsKey("bds_locale_update_last_checked"))
    }

    @Test
    fun `updateLanguages preserves stored values for failed codes`() {
        // Pre-seed the store with a "fa" value from a previous successful run.
        prefs["bds_locale_updates"] = JSONObject()
            .put("fa", JSONObject().put("messages", JSONObject().put("hello", "Farsi previous")))
            .toString()

        // This round fa.json 404s, the rest succeed.
        enqueueAllLocales(skip = listOf("fa"))

        val result = sync.updateLanguages()
        assertTrue(result.getBoolean("success"))

        val stored = JSONObject(prefs["bds_locale_updates"]!!)
        assertEquals(5, stored.length())
        assertEquals(
            "Farsi previous",
            stored.getJSONObject("fa").getJSONObject("messages").getString("hello"),
        )
    }

    @Test
    fun `updateLanguages drops stale codes that are no longer requested`() {
        prefs["bds_locale_updates"] = JSONObject()
            .put("xx", JSONObject().put("messages", JSONObject()))
            .put("en", JSONObject().put("messages", JSONObject().put("hello", "old")))
            .toString()

        enqueueAllLocales()
        val result = sync.updateLanguages()
        assertTrue(result.getBoolean("success"))

        val stored = JSONObject(prefs["bds_locale_updates"]!!)
        assertFalse(stored.has("xx"))
        assertTrue(stored.has("en"))
    }

    @Test
    fun `updateLanguages with zero valid locales fails with the package error`() {
        enqueueAllLocales(skip = RemoteDataSync.LOCALE_CODES.toList())

        val result = sync.updateLanguages()
        assertFalse(result.getBoolean("success"))
        assertEquals("No valid locale files fetched", result.getString("error"))
    }

    @Test
    fun `updateLanguages with no diff writes nothing`() {
        enqueueAllLocales()
        val first = sync.updateLanguages(1_700_000_000_000L)
        assertEquals(2, first.getJSONArray("writtenKeys").length())

        // Same inputs → identical stored values → no diff.
        enqueueAllLocales()
        val second = sync.updateLanguages(1_700_000_000_000L)
        assertTrue(second.getBoolean("success"))
        assertEquals(0, second.getJSONArray("writtenKeys").length())
    }

    @Test
    fun `zz debug updateLanguages diff keys`() {
        enqueueAllLocales()
        sync.updateLanguages(1_700_000_000_000L)
        val beforeLocales = prefs.getString("bds_locale_updates", null)
        val beforeChecked = prefs.getString("bds_locale_update_last_checked", null)

        enqueueAllLocales()
        val second = sync.updateLanguages(1_700_000_000_000L)

        throw AssertionError(
            "written=" + second.getJSONArray("writtenKeys") +
                " | checked=" + beforeChecked +
                " | afterChecked=" + prefs.getString("bds_locale_update_last_checked", null) +
                " | locales=" + beforeLocales +
                " | afterLocales=" + prefs.getString("bds_locale_updates", null),
        )
    }

    // ── resetLanguages (BDS_RESET_LANGUAGES) ─────────────────────────────

    @Test
    fun `resetLanguages removes both locale keys`() {
        prefs["bds_locale_updates"] = "{}"
        prefs["bds_locale_update_last_checked"] = "1/1/2026"

        val result = sync.resetLanguages()

        assertTrue(result.getBoolean("success"))
        assertFalse(prefs.containsKey("bds_locale_updates"))
        assertFalse(prefs.containsKey("bds_locale_update_last_checked"))
    }

    // ── waitForStartup (BDS_WAIT_FOR_STARTUP) ────────────────────────────

    @Test
    fun `waitForStartup persists status announcements and config with meta`() {
        server.enqueue(
            MockResponse().setBody(
                """[{"id":"a1","body":"First announcement"}]""",
            ),
        )
        server.enqueue(
            MockResponse().setBody(
                """{"meta":{"version":7},"features":{"x":true}}""",
            ),
        )

        val result = sync.waitForStartup(1_700_000_000_000L)

        assertTrue(result.getBoolean("success"))
        assertTrue(result.getJSONObject("remoteStatus").getBoolean("success"))
        assertTrue(result.getJSONObject("remoteConfig").getBoolean("success"))

        val announcements = JSONArray(prefs["bds_remote_announcement"]!!)
        assertEquals(1, announcements.length())
        assertEquals("First announcement", announcements.getJSONObject(0).getString("body"))

        val config = JSONObject(prefs["bds_remote_config"]!!)
        assertTrue(config.getJSONObject("features").getBoolean("x"))

        val meta = JSONObject(prefs["bds_remote_config_meta"]!!)
        assertEquals(1_700_000_000_000L, meta.getLong("lastFetched"))
        assertEquals(7L, meta.getLong("version"))
    }

    @Test
    fun `waitForStartup wraps single-object status payload in an array`() {
        server.enqueue(MockResponse().setBody("""{"id":"single","body":"one"}"""))
        server.enqueue(MockResponse().setBody("""{"meta":{"version":1}}"""))

        val result = sync.waitForStartup()
        assertTrue(result.getBoolean("success"))

        val announcements = JSONArray(prefs["bds_remote_announcement"]!!)
        assertEquals(1, announcements.length())
        assertEquals("one", announcements.getJSONObject(0).getString("body"))
    }

    @Test
    fun `waitForStartup reports failure when config is not an object`() {
        server.enqueue(MockResponse().setBody("""[{"id":"a"}]"""))
        server.enqueue(MockResponse().setBody("""["not","an","object"]"""))

        val result = sync.waitForStartup()

        assertFalse(result.getBoolean("success"))
        assertTrue(result.getJSONObject("remoteStatus").getBoolean("success"))
        assertFalse(result.getJSONObject("remoteConfig").getBoolean("success"))
        assertEquals("Invalid config root", result.getJSONObject("remoteConfig").getString("error"))
    }

    @Test
    fun `waitForStartup reports HTTP failure for status feed`() {
        server.enqueue(MockResponse().setResponseCode(503))
        server.enqueue(MockResponse().setBody("""{"meta":{"version":1}}"""))

        val result = sync.waitForStartup()

        assertFalse(result.getBoolean("success"))
        assertEquals("HTTP 503", result.getJSONObject("remoteStatus").getString("error"))
        assertTrue(result.getJSONObject("remoteConfig").getBoolean("success"))
    }

}
