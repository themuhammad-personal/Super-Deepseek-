package com.betterdeepseek.app

import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.Assert.assertThrows
import java.util.concurrent.TimeUnit

/**
 * JVM-only tests for [YouTubeTranscript] — the native port of the
 * `youtube-transcript` npm package. Uses a MockWebServer for the InnerTube
 * player endpoint, the watch page and the caption track download
 * (`captionHostSuffix` relaxed to "localhost" so the host guard passes).
 */
class YouTubeTranscriptTest {

    private lateinit var server: MockWebServer
    private lateinit var transcript: YouTubeTranscript

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        val httpClient = OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(2, TimeUnit.SECONDS)
            .callTimeout(5, TimeUnit.SECONDS)
            .build()
        transcript = YouTubeTranscript(
            httpClient,
            innerTubePlayerUrl = server.url("/youtubei/v1/player?prettyPrint=false").toString(),
            watchPageUrlTemplate = server.url("/watch?v=").toString() + "%s",
            captionHostSuffix = "localhost",
        )
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private fun captionUrl(): String = server.url("/api/timedtext?v=dQw4w9WgXcQ&lang=en").toString()

    private fun tracksJson(baseUrl: String, lang: String = "en"): String =
        """{"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
            {"baseUrl":"$baseUrl","languageCode":"$lang"}]}}}"""

    private fun watchPageHtml(tracks: String): String =
        """<html><head><title>test</title></head><body>
        <script>var ytInitialPlayerResponse = $tracks;</script>
        "playabilityStatus":{"status":"OK"}
        </body></html>"""

    private fun pSegmentXml(): String =
        """<transcript>
        <p t="120" d="3500"><s a="0">Hello</s><s a="800"> &amp; welcome</s></p>
        <p t="3700" d="2000"><s a="0">Second chunk</s></p>
        </transcript>"""

    // ── video id extraction ──────────────────────────────────────────────

    @Test
    fun `fetchTranscript rejects non-video input with the package error`() {
        val ex = assertThrows(YouTubeTranscript.TranscriptException::class.java) {
            transcript.fetchTranscript("not-a-video-url-at-all")
        }
        assertEquals("Impossible to retrieve Youtube video ID.", ex.message)
    }

    @Test
    fun `fetchTranscript accepts raw 11 char ids via inner tube`() {
        server.enqueue(MockResponse().setBody(tracksJson(captionUrl())))
        server.enqueue(MockResponse().setBody(pSegmentXml()))

        val result = transcript.fetchTranscript("dQw4w9WgXcQ")
        assertEquals(2, result.length())
    }

    @Test
    fun `fetchTranscript extracts id from watch embed and youtu.be urls`() {
        for (url in listOf(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ?t=10",
        )) {
            // InnerTube down -> watch page fallback (proves the id was resolved).
            server.enqueue(MockResponse().setResponseCode(404))
            server.enqueue(MockResponse().setBody(watchPageHtml(tracksJson(captionUrl()))))
            server.enqueue(MockResponse().setBody(pSegmentXml()))

            val result = transcript.fetchTranscript(url)
            assertEquals(2, result.length())
        }
    }

    // ── caption XML parsing ──────────────────────────────────────────────

    @Test
    fun `p segment xml parses into text offset duration lang`() {
        server.enqueue(MockResponse().setBody(tracksJson(captionUrl())))
        server.enqueue(MockResponse().setBody(pSegmentXml()))

        val result = transcript.fetchTranscript("dQw4w9WgXcQ")

        assertEquals(2, result.length())
        val first = result.getJSONObject(0)
        assertEquals("Hello & welcome", first.getString("text"))
        assertEquals(120L, first.getLong("offset"))
        assertEquals(3500L, first.getLong("duration"))
        assertEquals("en", first.getString("lang"))
        assertEquals("Second chunk", result.getJSONObject(1).getString("text"))
    }

    @Test
    fun `legacy text xml falls back when no p segments exist`() {
        val legacy = """<transcript>
        <text start="0.0" dur="2.5">First chunk</text>
        <text start="2.5" dur="1.5">Second chunk</text>
        </transcript>"""
        server.enqueue(MockResponse().setBody(tracksJson(captionUrl())))
        server.enqueue(MockResponse().setBody(legacy))

        val result = transcript.fetchTranscript("dQw4w9WgXcQ")

        assertEquals(2, result.length())
        assertEquals("First chunk", result.getJSONObject(0).getString("text"))
        assertEquals(0.0, result.getJSONObject(0).getDouble("offset"), 0.0001)
        assertEquals(2.5, result.getJSONObject(1).getDouble("offset"), 0.0001)
    }

    @Test
    fun `decodeEntities handles named and numeric entities`() {
        val decoded = transcript.decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &apos;f&apos; &#x41; &#66;")
        assertEquals("a & b <c> \"d\" 'e' 'f' A B", decoded)
    }

    // ── error paths ──────────────────────────────────────────────────────

    @Test
    fun `captcha page throws the too-many-requests error`() {
        server.enqueue(MockResponse().setResponseCode(404)) // InnerTube down
        server.enqueue(
            MockResponse().setBody(
                """<html>var ytInitialPlayerResponse = {"x":1}; <div class="g-recaptcha"></div></html>""",
            ),
        )

        val ex = assertThrows(YouTubeTranscript.TranscriptException::class.java) {
            transcript.fetchTranscript("dQw4w9WgXcQ")
        }
        assertTrue(ex.message!!.contains("requires solving a captcha"))
    }

    @Test
    fun `page without playabilityStatus reports video unavailable`() {
        server.enqueue(MockResponse().setResponseCode(404))
        server.enqueue(MockResponse().setBody("<html><body>just a page</body></html>"))

        val ex = assertThrows(YouTubeTranscript.TranscriptException::class.java) {
            transcript.fetchTranscript("dQw4w9WgXcQ")
        }
        assertTrue(ex.message!!.startsWith("The video is no longer available"))
    }

    @Test
    fun `page with player response but no tracks reports transcript disabled`() {
        server.enqueue(MockResponse().setResponseCode(404))
        server.enqueue(
            MockResponse().setBody(
                """<html><script>var ytInitialPlayerResponse = {"captions":{}};</script> "playabilityStatus":{} </html>""",
            ),
        )

        val ex = assertThrows(YouTubeTranscript.TranscriptException::class.java) {
            transcript.fetchTranscript("dQw4w9WgXcQ")
        }
        assertTrue(ex.message!!.startsWith("Transcript is disabled"))
    }

    @Test
    fun `caption baseUrl on non allowed host is rejected`() {
        server.enqueue(MockResponse().setBody(tracksJson("https://evil.example.com/timedtext")))

        val ex = assertThrows(YouTubeTranscript.TranscriptException::class.java) {
            transcript.fetchTranscript("dQw4w9WgXcQ")
        }
        assertTrue(ex.message!!.startsWith("No transcripts are available"))
    }

    @Test
    fun `inner tube failure falls through to watch page scrape`() {
        server.enqueue(MockResponse().setResponseCode(500))
        server.enqueue(MockResponse().setBody(watchPageHtml(tracksJson(captionUrl()))))
        server.enqueue(MockResponse().setBody(pSegmentXml()))

        val result = transcript.fetchTranscript("dQw4w9WgXcQ")
        assertEquals(2, result.length())
    }

    @Test
    fun `inner tube with no tracks falls through to watch page`() {
        server.enqueue(MockResponse().setBody("""{"playabilityStatus":{"status":"OK"}}"""))
        server.enqueue(MockResponse().setBody(watchPageHtml(tracksJson(captionUrl()))))
        server.enqueue(MockResponse().setBody(pSegmentXml()))

        val result = transcript.fetchTranscript("dQw4w9WgXcQ")
        assertEquals(2, result.length())
    }

    @Test
    fun `parseInlineJson extracts the player response object from html`() {
        val html = """prefix garbage <script>var ytInitialPlayerResponse = {"a":{"b":[1,2]}}; var other = 1;</script>"""
        val parsed = transcript.parseInlineJson(html, "ytInitialPlayerResponse")
        assertEquals(2, parsed?.optJSONObject("a")?.optJSONArray("b")?.length())
        assertEquals(null, transcript.parseInlineJson(html, "missingName"))
    }

    @Test
    fun `failed caption download status throws not available`() {
        server.enqueue(MockResponse().setBody(tracksJson(captionUrl())))
        server.enqueue(MockResponse().setResponseCode(404))

        val ex = assertThrows(YouTubeTranscript.TranscriptException::class.java) {
            transcript.fetchTranscript("dQw4w9WgXcQ")
        }
        assertTrue(ex.message!!.startsWith("No transcripts are available"))
    }
}
