# Generative UI — readiness report (2.70.0, 2026-10-21)

**Status:** implemented and verified in automated tests (JVM/Robolectric,
Node, real Chromium) and against real public MCP servers.

**Not yet verified:**

* On a physical Android device.
* Against the live chat.deepseek.com page.
* Live-model compliance with the v3 prompt (not measured).

Read "Not verified" before relying on anything here.

## What changed in 2.70 (after testing 2.60.1)

| 2.60.1 problem | 2.70 |
|---|---|
| Raw code flashed before cards / visuals appeared (first render, streaming, old chats) | **Claim layer**: our blocks are hidden inside the MutationObserver microtask — before the first paint — and a skeleton with the final surface's geometry takes their place (artifact-card height for artifacts, 168 px for visuals). Old chats render at once (no 1.6 s wait for blocks that are not in the last message). |
| Visual blocks jumped while generating | Inline frames only grow while streaming; the first real size is awaited (≤ 1.4 s); skeleton → loading box → surface share one geometry; no entrance animations on cards that re-mount. |
| Errors showed raw code | **Lenient parser** (headers without `---`, missing/odd kind inferred, slugged ids, titles from `<title>`/`#`, repaired JSON envelopes). Only unrecoverable bodies fail, and they show a quiet error card (**Show code** / **Ask to fix**), never raw code. |
| MCP viewer ≤ 20 %: quran.ai connected but its reader did not show | Real-server compatibility: 8 MB resources (was 160 KB), robust streamable-HTTP/SSE parser (`McpSse.kt`), `_meta.ui.resourceUri` on results, OpenAI Apps SDK templates (`openai/outputTemplate`, `text/html+skybridge`, `window.openai`), app-only tools hidden from the model and auto-allowed (unless destructive), views restored on reload. Live: quran.ai reader, Excalidraw, MCP playground all render. |
| No web access from visuals | `fetch()` / `sdFetch()` / `sdImage()` in visuals and artifacts, **consent once per website**, no cookies, private networks always blocked (JS + native DNS + every redirect hop). |
| Uploads limited | `sd-files.js`: every file type except audio/video. Accepted files go to DeepSeek unchanged; refused ones are converted to text on the device (OpenDocument, EPUB, RTF, Office, archives, unknown text, binary summary); huge text is split into noted parts. Streamed native picks up to 100 MB. |
| Cards not premium | New design layer: artifact card (kind-tinted tile, 16 px radius, quiet elevation), skeletons, error card, consent sheet, MCP header, viewer, sds-ui widgets — plus the content.js todo / question & info / chart / file cards and the + sheet / settings icon tiles, restyled with page theme tokens only (light + dark). |

## Verified (evidence you can re-run)

| Gate | Result | Command |
|---|---|---|
| Engine unit + contract tests | **149 / 149 pass** (incl. 9 new `sd-files` tests on real ZIP/docx/xlsx/pptx/odt/epub/rtf bytes) | `npm run test:engine` |
| Compliance harness self-test | pass (synthetic fixtures only — not model compliance) | `npm run test:compliance-harness` |
| Generative UI acceptance (Chromium, 390×844 light + 1280×900 dark, strict-CSP fixture) | **21 / 21 checks pass**, zero page errors | `npm run genui:acceptance` |
| Live MCP App, `https://mcp.quran.ai` `interactive_study {"surah":1}` | **pass**: 17 model-visible tools, resource `ui://interactive_study_v450.html` (2.3 M chars) read, reader rendered inline (Sūrat al-Fātiḥah), app-only tools called without consent prompts | `npm run genui:mcp-live -- https://mcp.quran.ai interactive_study '{"surah":1}'` |
| Kotlin unit tests (Robolectric) | **279 / 279 pass** (incl. new `FrameFetchPolicyTest` 5, `McpSseTest`) | `./gradlew testDebugUnitTest` |
| Release APK | see *Release* below | `./gradlew assembleRelease` |

New acceptance checks in 2.70 (`scripts/genui-browser-check.mjs`, screenshots
in `qa/genui/`):

* **00** no raw-code flash: blocks hidden before first paint, skeleton →
  surface; snippets stay code; old chats render at once (< 1.2 s); errors never
  show raw code.
* **04** malformed block → quiet error card (code behind a toggle); unknown
  kinds inferred; later blocks still render.
* **09d** MCP app-only tools hidden + auto-allowed; skybridge templates get
  `window.openai`.
* **11** kill switch removes every surface and skeleton and restores the code
  blocks; re-enable renders again.
* **15** web access: consent once per website (one sheet at a time), then the
  native fetch; private hosts never prompt and never reach the bridge; blocked
  `<img>` retried through the host.
* **16** uploads: refused files converted on the device before the page sees
  them; accepted files untouched; audio/video refused.

## Not verified (honest gaps)

* **Live chat.deepseek.com CSP.** srcdoc frames inherit the host page CSP.
  If DeepSeek blocks inline scripts, the 6 s watchdog shows "could not start
  here → Open full screen" (verified with a strict-CSP fixture). Check on the
  device with *Generative UI settings → Run diagnostics*.
* **DeepSeek's real upload input.** `sd-files.js` decides by the input's
  `accept` list; the exact list on the live page and DeepSeek's server-side
  size limits were not observable here. What DeepSeek accepts is uploaded as
  is; its own limits still apply.
* **Native web fetch on a device.** `bds-frame-fetch` (OkHttp, SafeDns,
  HopGuard) is unit-tested for the policy; the end-to-end consent → render path
  ran in Chromium with a mocked bridge. No real network call went through the
  Kotlin path here.
* **MCP Apps through the Kotlin transport on a device.** The engine side ran
  against real servers with Node standing in for `WebViewBridge`; the 8 MB
  native resource path (quran.ai's 2.3 MB reader) is covered by unit tests
  only.
* **Design on the real page.** The content.js card restyle was reviewed in
  the design harness (`design-preview/cards.html`, real Svelte styles), not on
  the live page next to DeepSeek's own UI.
* **Android System WebView** specifics (share sheet, Keystore on hardware,
  back gesture, low-end performance) ran only in Robolectric / desktop
  Chromium. `DecompressionStream('deflate-raw')` (used to unzip uploads) needs
  WebView 103+.
* **Model compliance** with the v3 prompt: not measured. Collect real
  responses and run `npm run genui:compliance`.

## Release

* Same signing key as 2.50/2.60, so it **updates 2.60.x in place**.
  versionCode base: `2_700_000 + CI run number`.
* Local release build (2026-10-21): `super-deepseek-2.70.0.apk`, 8,461,056 bytes,
  versionName `2.70.0`, versionCode `2700000` (local build id 0), `apksigner verify` OK,
  signer certificate SHA-256 `75:eb:ff:1c:a3:3e:27:e8:f1:4d:98:12:2d:c5:e6:db:81:1a:1c:77:f3:71:33:b7:bb:bd:24:cd:75:ba:38:03`
  (same as 2.50/2.60). Packaged engine checked with `unzip -p` (`assets/bds/sd-files.js`,
  `sd-genui-frame.js` with the web-access runtime, content.js upload text).
* APK SHA-256 `cad600211f75ff103fa031363455b4fa966fc06a8a07ecea7fee2af3b6454427`.
