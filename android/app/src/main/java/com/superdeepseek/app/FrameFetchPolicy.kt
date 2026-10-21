package com.superdeepseek.app

import okhttp3.Dns
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.UnknownHostException

/**
 * Network policy for fetches requested by generated visuals / artifacts
 * (`sdFetch` → `bds-frame-fetch`). The user approves each website in the page;
 * this layer enforces what no approval can override:
 *  - http(s) only, standard ports, no credentials in the URL;
 *  - never private, loopback, link-local, CGNAT, multicast or reserved
 *    addresses — checked on the RESOLVED address of every hop (redirects
 *    included) through a filtering [Dns], so DNS rebinding cannot bypass it;
 *  - no cookies (the client has no cookie jar), hop-by-hop / identity headers
 *    stripped, bounded body and time.
 */
internal object FrameFetchPolicy {
    const val MAX_RESPONSE_BYTES: Long = 8L * 1024 * 1024
    const val MAX_REQUEST_BODY_CHARS = 256 * 1024
    const val TIMEOUT_MS = 20_000L
    val METHODS = setOf("GET", "HEAD", "POST")
    private val BLOCKED_HEADERS = setOf(
        "cookie", "cookie2", "host", "origin", "referer", "connection", "proxy-authorization",
        "proxy-connection", "keep-alive", "transfer-encoding", "te", "upgrade", "content-length", "expect",
        "x-forwarded-for", "x-real-ip", "forwarded"
    )

    fun headerAllowed(name: String): Boolean {
        val n = name.trim().lowercase()
        return n.isNotEmpty() && n.length <= 64 && n !in BLOCKED_HEADERS && !n.startsWith("sec-") && !n.startsWith("proxy-") &&
            Regex("^[a-z0-9!#$%&'*+.^_`|~-]+$").matches(n)
    }

    /** Syntactic URL gate (before DNS). */
    fun urlAllowed(url: okhttp3.HttpUrl?): Boolean {
        if (url == null) return false
        if (url.scheme != "https" && url.scheme != "http") return false
        if (url.username.isNotEmpty() || url.password.isNotEmpty()) return false
        val port = url.port
        if (!(port == 80 || port == 443 || port == 8080 || port == 8443)) return false
        val host = url.host.lowercase()
        if (host == "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
            host.endsWith(".lan") || host.endsWith(".home") || host.endsWith(".corp") || !host.contains('.') && !host.contains(':')) return false
        // Literal IPs are checked here too (Dns is not consulted for them).
        literalAddress(host)?.let { if (isBlockedAddress(it)) return false }
        return true
    }

    private fun literalAddress(host: String): InetAddress? {
        val h = host.removePrefix("[").removeSuffix("]")
        val looksIp = Regex("^[0-9.]+$").matches(h) || h.contains(':')
        if (!looksIp) return null
        return runCatching { InetAddress.getByName(h) }.getOrNull()
    }

    fun isBlockedAddress(a: InetAddress): Boolean {
        if (a.isAnyLocalAddress || a.isLoopbackAddress || a.isLinkLocalAddress || a.isSiteLocalAddress || a.isMulticastAddress) return true
        val b = a.address
        if (a is Inet4Address) {
            val o0 = b[0].toInt() and 0xff; val o1 = b[1].toInt() and 0xff
            if (o0 == 0 || o0 == 10 || o0 == 127) return true
            if (o0 == 100 && o1 in 64..127) return true          // CGNAT 100.64/10
            if (o0 == 169 && o1 == 254) return true              // link-local / cloud metadata
            if (o0 == 172 && o1 in 16..31) return true
            if (o0 == 192 && o1 == 168) return true
            if (o0 == 192 && o1 == 0 && (b[2].toInt() and 0xff) == 0) return true
            if (o0 == 198 && (o1 == 18 || o1 == 19)) return true // benchmarking
            if (o0 >= 224) return true                           // multicast + reserved + broadcast
            return false
        }
        if (a is Inet6Address) {
            val f0 = b[0].toInt() and 0xff
            if (f0 == 0xfc || f0 == 0xfd) return true            // unique local fc00::/7
            if (f0 == 0xfe && (b[1].toInt() and 0xc0) == 0x80) return true // fe80::/10
            // IPv4-mapped / compatible: judge the embedded IPv4 address.
            val mapped = (0 until 10).all { b[it].toInt() == 0 } && ((b[10].toInt() and 0xff) == 0xff && (b[11].toInt() and 0xff) == 0xff || (b[10].toInt() == 0 && b[11].toInt() == 0))
            if (mapped) {
                val v4 = InetAddress.getByAddress(byteArrayOf(b[12], b[13], b[14], b[15]))
                return isBlockedAddress(v4)
            }
            if (f0 == 0x20 && (b[1].toInt() and 0xff) == 0x01 && (b[2].toInt() and 0xff) == 0x0d && (b[3].toInt() and 0xff) == 0xb8) return true // 2001:db8::/32 docs
            return false
        }
        return true
    }

    /** Resolves through [delegate] and refuses hosts that resolve to any blocked address. */
    class SafeDns(private val delegate: Dns = Dns.SYSTEM) : Dns {
        override fun lookup(hostname: String): List<InetAddress> {
            val all = delegate.lookup(hostname)
            if (all.isEmpty() || all.any { isBlockedAddress(it) }) throw UnknownHostException("Blocked address for $hostname (private or reserved network)")
            return all
        }
    }

    fun isTextual(contentType: String?): Boolean {
        val c = (contentType ?: "").lowercase()
        return c.isEmpty() || c.startsWith("text/") || c.contains("json") || c.contains("xml") || c.contains("javascript") ||
            c.contains("csv") || c.contains("x-www-form-urlencoded") || c.contains("svg")
    }

    /** Network interceptor: re-checks every hop, redirects included (SafeDns never sees IP literals). */
    object HopGuard : okhttp3.Interceptor {
        override fun intercept(chain: okhttp3.Interceptor.Chain): okhttp3.Response {
            if (!urlAllowed(chain.request().url)) throw java.net.UnknownHostException("Blocked: redirect to a non-public address")
            return chain.proceed(chain.request())
        }
    }
}
