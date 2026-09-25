package com.betterdeepseek.app

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native YouTube transcript fetching — the Android equivalent of the
 * `bds-get-youtube-transcript` handler that used to run in the extension's
 * background service worker via the `youtube-transcript` npm package.
 *
 * The algorithm is a 1:1 port of that package (v1.3.0, browser build):
 *
 * 1. Resolve the 11-char video id from a raw id or any YouTube URL form.
 * 2. Try the InnerTube `youtubei/v1/player` endpoint (Android client context) —
 *    the page's `captionTracks` without needing the watch page.
 * 3. Fall back to scraping `ytInitialPlayerResponse` out of the watch page HTML
 *    (with the same captcha / unavailable / disabled error messages).
 * 4. Download the first caption track and parse the timed transcript XML
 *    (`<p t d>` segments with `<s>` spans, falling back to `<text start dur>`).
 *
 * Returns the same JSON array shape the JS side consumed:
 * `[{ text, offset, duration, lang }]` with `offset`/`duration` in milliseconds.
 *
 * Synchronous by design — called from the WebView JavaBridge thread, same as
 * the other [WebViewBridge.fetch] handlers.
 */
internal class YouTubeTranscript(
        private val httpClient: OkHttpClient,
        private val innerTubePlayerUrl: String = DEFAULT_INNER_TUBE_PLAYER_URL,
        private val watchPageUrlTemplate: String = DEFAULT_WATCH_PAGE_URL_TEMPLATE,
        private val captionHostSuffix: String = ".youtube.com",
) {

    companion object {
        const val DEFAULT_INNER_TUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false"
        const val DEFAULT_WATCH_PAGE_URL_TEMPLATE = "https://www.youtube.com/watch?v=%s"

        private const val ANDROID_CLIENT_VERSION = "20.10.38"
        private const val ANDROID_USER_AGENT = "com.google.android.youtube/$ANDROID_CLIENT_VERSION (Linux; U; Android 14)"
        private const val WEB_USER_AGENT =
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 " +
                        "(KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)"

        private val VIDEO_ID_PATTERN = Regex(
                "(?:youtube\\.com/(?:[^/]+\\/.+\\/|(?:v|e(?:mbed)?)\\/|.*[?&]v=)|youtu\\.be/)([^\"&?/\\s]{11})",
                RegexOption.IGNORE_CASE,
        )
        private val P_SEGMENT_PATTERN = Regex("""<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)</p>""")
        private val S_SPAN_PATTERN = Regex("""<s[^>]*>([^<]*)</s>""")
        private val TAG_STRIP_PATTERN = Regex("<[^>]+>")
        private val LEGACY_TEXT_PATTERN = Regex("""<text start="([^"]*)" dur="([^"]*)">([^<]*)</text>""")
        private val HEX_ENTITY_PATTERN = Regex("""&#x([0-9a-fA-F]+);""")
        private val DEC_ENTITY_PATTERN = Regex("""&#(\d+);""")
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()
    }

    /** Mirrors the npm package's `[YoutubeTranscript]` error family. */
    internal class TranscriptException(message: String) : RuntimeException(message)

    /**
     * Fetch the transcript for a video URL (or raw 11-char id).
     *
     * @throws TranscriptException with the same user-facing messages the JS
     *   package produced ("Impossible to retrieve Youtube video ID.", captcha,
     *   unavailable, disabled, no transcripts).
     */
    fun fetchTranscript(videoUrlOrId: String): JSONArray {
        val videoId = retrieveVideoId(videoUrlOrId)
        return fetchViaInnerTube(videoId) ?: fetchViaWebPage(videoId, videoUrlOrId)
    }

    private fun retrieveVideoId(url: String): String {
        if (url.length == 11) return url
        val match = VIDEO_ID_PATTERN.find(url)
        return match?.groupValues?.get(1)
                ?.takeIf { it.length == 11 }
                ?: throw TranscriptException("Impossible to retrieve Youtube video ID.")
    }

    /** InnerTube: returns the transcript, or null when the endpoint has no tracks. */
    private fun fetchViaInnerTube(videoId: String): JSONArray? {
        return try {
            val body = JSONObject()
                    .put(
                            "context",
                            JSONObject()
                                    .put(
                                            "client",
                                            JSONObject()
                                                    .put("clientName", "ANDROID")
                                                    .put("clientVersion", ANDROID_CLIENT_VERSION),
                                    ),
                    )
                    .put("videoId", videoId)

            val response = httpClient.newCall(
                    Request.Builder()
                            .url(innerTubePlayerUrl)
                            .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                            .header("Content-Type", "application/json")
                            .header("User-Agent", ANDROID_USER_AGENT)
                            .build(),
            ).execute()
            response.use { resp ->
                if (!resp.isSuccessful) return null
                val json = JSONObject(resp.body?.string().orEmpty())
                val tracks = json.optJSONObject("captions")
                        ?.optJSONObject("playerCaptionsTracklistRenderer")
                        ?.optJSONArray("captionTracks")
                if (tracks == null || tracks.length() == 0) null
                else fetchTranscriptFromTracks(tracks, videoId)
            }
        } catch (_: Exception) {
            // Faithful to the npm package: any InnerTube failure (including a caption
            // download error) falls through to the watch-page scrape below.
            null
        }
    }

    /** Watch-page fallback: always returns or throws. */
    private fun fetchViaWebPage(videoId: String, originalUrl: String): JSONArray {
        val pageUrl = watchPageUrlTemplate.replace("%s", videoId)
        val response = httpClient.newCall(
                Request.Builder()
                        .url(pageUrl)
                        .get()
                        .header("User-Agent", WEB_USER_AGENT)
                        .build(),
        ).execute()
        response.use { resp ->
            val html = resp.body?.string().orEmpty()
            if (html.contains("class=\"g-recaptcha\"")) {
                throw TranscriptException(
                        "YouTube is receiving too many requests from this IP and now requires solving a captcha to continue",
                )
            }
            if (!html.contains("\"playabilityStatus\":")) {
                throw TranscriptException("The video is no longer available ($originalUrl)")
            }
            val playerResponse = parseInlineJson(html, "ytInitialPlayerResponse")
                    ?: throw TranscriptException("The video is no longer available ($originalUrl)")
            val tracks = playerResponse.optJSONObject("captions")
                    ?.optJSONObject("playerCaptionsTracklistRenderer")
                    ?.optJSONArray("captionTracks")
            if (tracks == null || tracks.length() == 0) {
                throw TranscriptException("Transcript is disabled on this video ($originalUrl)")
            }
            return fetchTranscriptFromTracks(tracks, originalUrl)
        }
    }

    private fun fetchTranscriptFromTracks(tracks: JSONArray, videoRef: String): JSONArray {
        val first = tracks.optJSONObject(0) ?: throw TranscriptException("No transcripts are available for this video ($videoRef)")
        val baseUrl = first.optString("baseUrl")
        val lang = first.optString("languageCode")
        if (lang.isEmpty()) throw TranscriptException("No transcripts are available for this video ($videoRef)")

        val url = try {
            okhttp3.HttpUrl.get(baseUrl)
        } catch (_: Exception) {
            throw TranscriptException("No transcripts are available for this video ($videoRef)")
        }
        // Only download caption tracks from YouTube hosts (the npm package checks
        // `hostname.endsWith(".youtube.com")`); the suffix is injectable for tests.
        if (!url.host.endsWith(captionHostSuffix)) {
            throw TranscriptException("No transcripts are available for this video ($videoRef)")
        }

        val response = httpClient.newCall(
                Request.Builder()
                        .url(url)
                        .get()
                        .header("User-Agent", WEB_USER_AGENT)
                        .build(),
        ).execute()
        response.use { resp ->
            if (!resp.isSuccessful) {
                throw TranscriptException("No transcripts are available for this video ($videoRef)")
            }
            return parseTranscriptXml(resp.body?.string().orEmpty(), lang)
        }
    }

    private fun parseTranscriptXml(xml: String, lang: String): JSONArray {
        val result = JSONArray()

        for (match in P_SEGMENT_PATTERN.findAll(xml)) {
            val offsetMs = match.groupValues[1].toLongOrNull() ?: continue
            val durationMs = match.groupValues[2].toLongOrNull() ?: continue
            val inner = match.groupValues[3]

            var text = StringBuilder()
            for (span in S_SPAN_PATTERN.findAll(inner)) {
                text.append(span.groupValues[1])
            }
            if (text.isEmpty()) {
                text.append(TAG_STRIP_PATTERN.replace(inner, ""))
            }
            val decoded = decodeEntities(text.toString()).trim()
            if (decoded.isNotEmpty()) {
                result.put(
                        JSONObject()
                                .put("text", decoded)
                                .put("duration", durationMs)
                                .put("offset", offsetMs)
                                .put("lang", lang),
                )
            }
        }

        if (result.length() > 0) return result

        // Legacy caption format: <text start="0.0" dur="2.5">chunk</text>
        // Faithful to the npm package: the legacy branch stores the raw
        // start/dur values (seconds) in the same fields the primary branch fills
        // with milliseconds — the consumer (`youtube-reader.js`) divides by 1000
        // either way, so both branches behave exactly as in the extension build.
        for (match in LEGACY_TEXT_PATTERN.findAll(xml)) {
            val offset = match.groupValues[1].toDoubleOrNull() ?: continue
            val duration = match.groupValues[2].toDoubleOrNull() ?: continue
            result.put(
                    JSONObject()
                            .put("text", decodeEntities(match.groupValues[3]))
                            .put("duration", duration)
                            .put("offset", offset)
                            .put("lang", lang),
            )
        }
        return result
    }

    /**
     * Extract a top-level JSON object following the `var <name> = ` prefix by
     * brace-counting (the watch page embeds it inline in a script tag).
     */
    internal fun parseInlineJson(html: String, name: String): JSONObject? {
        val prefix = "var $name = "
        val start = html.indexOf(prefix)
        if (start == -1) return null
        var i = start + prefix.length
        var depth = 0
        for (idx in i until html.length) {
            when (html[idx]) {
                '{' -> depth++
                '}' -> {
                    depth--
                    if (depth == 0) {
                        return try {
                            JSONObject(html.substring(i, idx + 1))
                        } catch (_: Exception) {
                            null
                        }
                    }
                }
            }
        }
        return null
    }

    internal fun decodeEntities(value: String): String {
        var out = value
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&apos;", "'")
        out = HEX_ENTITY_PATTERN.replace(out) { m ->
            try {
                val code = m.groupValues[1].toInt(16)
                if (code in 0..0x10FFFF) Character.toChars(code).concatToString() else ""
            } catch (_: Exception) {
                m.value
            }
        }
        out = DEC_ENTITY_PATTERN.replace(out) { m ->
            try {
                val code = m.groupValues[1].toInt()
                if (code in 0..0x10FFFF) Character.toChars(code).concatToString() else ""
            } catch (_: Exception) {
                m.value
            }
        }
        return out
    }
}


