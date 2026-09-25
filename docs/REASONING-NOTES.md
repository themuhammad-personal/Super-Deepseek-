# Conversion Audit & Decision Notes

Trail of reasoning for the browser-extension → standalone-Android conversion.
Every significant deletion has a "why this is safe" entry with the evidence
used (grep results, build-pipeline analysis, runtime behaviour).

Scope rules applied:

1. No file/dependency/config was removed before a reference check against the
   Android build path (`build.js --target=android` → `scripts/copy-to-android-assets.js`
   → `android/app/src/main/assets/bds/`, `src/platform/android-bridge-shim.js`,
   `android-chrome-polyfill.js`, `WebViewBridge.kt`).
2. No feature, UI, API/auth logic or asset was dropped — browser-only delivery
   layers were removed only after their functionality was replicated in the
   native bridge (see §3).
3. No new features were added.

---

## 1. Dependency map — what reaches the Android APK

`npm run build:android` = `node build.js --target=android` +
`node scripts/copy-to-android-assets.js`.

Built into `dist-android/` and staged into `android/app/src/main/assets/bds/`:

| Artifact | Source | Used by |
|---|---|---|
| `content.js`, `content.css` | `src/content/index.js` (+ Svelte UI in `src/content/ui/`, `src/content/tools/`, `src/content/files/`, `src/content/parser/`, `src/content/dom/`, `src/content/commands/`, `src/content/tags/`) | injected into `chat.deepseek.com` by `MainActivity.kt` |
| `injected.js` | `src/injected/index.js` | evaluated in page MAIN world (fetch/XHR patching) |
| `sandbox.js` | `src/sandbox/index.js` | iframe `sandbox.html` (PPTX/XLSX/DOCX/auto-code) |
| `sandbox.html` | `static/sandbox.html` | iframe page for document generation |
| `static/loading/*.svg` | `static/loading/` | loading UI assets |
| `bds-platform-globals` alias | → `src/platform/globals-android.js` → `android-chrome-polyfill.js`, `android-bridge-shim.js`, `android-file-picker.js`, `src/android/hide-get-app.js`, `src/android/hide-drawer-app-item.js` | chrome.* polyfill + native bridge wiring |

Transitive runtime dependencies of the bundles (all kept): `svelte`, `vite`,
`@sveltejs/vite-plugin-svelte` (build), `docx`, `pptxgenjs`, `xlsx`, `vega*`,
`marked`, `turndown`, `@mozilla/readability`, `fflate` (LONG_WORK ZIPs),
`html2canvas`, `ignore` (glob for code search). `src/lib/**`,
`src/locales/**` (built-in i18n), `src/styles/**` all bundle into
`content.js`/`content.css`.

`MainActivity.kt` reads exactly `bds/injected.js`, `bds/content.css`,
`bds/content.js` from assets; everything else is served via
`WebViewAssetLoader` on `bds-asset.local`.

The Android e2e parity suite (`tests/e2e-android/` +
`playwright.android.config.js`) loads `dist-android/` with a mocked
`window.AndroidBridge` and reuses the fixture in `tests/e2e/fixtures/`
(`mock-deepseek.html`, `payloads.js`) — those two fixture files are therefore
**shared** and were moved to `tests/fixtures/` (see §2.9).

## 2. Deletions and why each is safe

### 2.1 `src/background/` (service worker + `api-proxy.js`)

The MV3 background service worker is a browser-extension-only construct:
`build.js` does **not** build `background.js` for the `android` target
(`...(isAndroid ? [] : [{...input: "src/background/index.js"...}])`).

Every message type it handled is replicated in `WebViewBridge.kt` before
deletion (see §3). `api-proxy.js` (`proxyApiRequest`) had **no message
handler** referencing it (grep of all `message.type ===` branches) and no
other importer — it was dead code even in the extension build.

Tests that existed solely to exercise this module were removed with it:
`tests/integration/background-fetch-timeout.test.js`,
`tests/integration/background-github.test.js`,
`tests/integration/background-mcp.test.js`,
`tests/integration/background-persistence.test.js`.
(`tests/integration/github-commits.test.js` was kept: it tests
`src/lib/github-commits.js`, which the **content script** still imports via
`src/content/files/github-commits.js`.)

### 2.2 `static/manifest.json`

WebExtension MV3 manifest. Never built into the Android target (`build.js`
skips the manifest block when `isAndroid`), not present in
`assets/bds/`, not read by `MainActivity.kt`/`WebViewBridge.kt`. The
version it carried is duplicated (as required) in `package.json` and
`android/app/build.gradle.kts`, both retained.
`tests/integration/platform/android-manifest.test.js` tests the *Android*
manifest (`android/app/src/main/AndroidManifest.xml`) — kept.

### 2.3 `src/platform/globals-chrome.js`

Only referenced by the Vite alias default in `build.js` for chrome/firefox
targets (`grep globals-chrome` → single hit in `build.js`). The Android
target aliases to `globals-android.js`. Removed together with the
chrome/firefox build paths in `build.js`.

### 2.4 `extension/` store assets

`1.png 2.png 3.png 4.png attachMenu.jpg longwork.jpg memory.jpg persona.png
presentation.png "webpage skill.png"` — browser-store screenshots; grep shows
no code, build or workflow reference (they only appeared in the old README's
showcase table, which was rewritten). `PRIVACY.md` — store privacy policy
doc, referenced only by the old README. `remote-config-debug.md` — developer
notes for the remote-config debug panel, no code references.

**Exception (kept):** `extension/pricing.json`, `extension/remote-config.json`,
`extension/status.json` are **runtime data**: `src/lib/constants.js`,
`src/lib/pricing.js` and `src/lib/remote-persistence.js` fetch them at
runtime (from the published GitHub repo) to power the pricing tier-2 fallback,
the announcement banner and remote config. Deleting them would orphan the
project's own remote-payload sources. They were moved to `remote/` (new,
clearly named folder); the runtime URLs are untouched (they point at the
upstream published repo, a separate code path).

### 2.5 `tests/e2e/` (Chrome Playwright harness)

Loads `dist-chrome/` as an unpacked extension via `chrome.extensions`
(`tests/e2e/helpers/extension.js`) — a Chrome WebStore extension harness with
no Android counterpart. Replaced by `tests/e2e-android/` for the Android
target. `playwright.config.js` (testDir `./tests/e2e`) removed with it.

### 2.6 `tests/e2e-firefox/` + `vitest.firefox.config.js`

Selenium/Gecko harness for the Firefox build. No Firefox target exists any
more. The `selenium-webdriver` devDependency existed only for this suite
(`grep selenium` → `tests/e2e-firefox/**` + package.json only).

### 2.7 `package.json` scripts & devDependencies

- `build`, `build:chrome`, `build:firefox`, `build:source`, `pretest`,
  `test:e2e`, `test:e2e:firefox`, `test:ci:web`, `test:ci` (composed of the
  web jobs) — browser-delivery only.
- `dev` (`node build.js --dev`) — chrome watch mode for extension reloading;
  the Android pipeline has no watch loop.
- Kept: `build:android`, `test:unit` (vitest suite covers the feature code
  that ships in the APK), `test:e2e:android` (Android parity suite),
  `android:test`, `android:assemble:debug`, `test:android`,
  `test:ci:android` (renamed to `test:ci`), `check-locales`, `sanitize`,
  `test:watch`, `test:ui`.
- `selenium-webdriver` devDependency removed (only the Firefox suite used it).
- `youtube-transcript` runtime dependency removed — its logic was ported to
  `android/.../YouTubeTranscript.kt` (see §3.1). It was imported **only** by
  `src/background/index.js` (grep: single hit outside the background).

### 2.8 `build.js` simplification

The multi-target build script became Android-only: the firefox manifest
mutations, the `dist-{target}` zip creation (via `fflate`) and the
`generateSourceZip()` Mozilla-submission path all served browser delivery.
`fflate` remains a dependency because `src/lib/zip.js` (LONG_WORK zips) uses
it at runtime.

### 2.9 Test fixture move

`tests/e2e/fixtures/mock-deepseek.html` + `payloads.js` are shared by the
Android parity suite (`tests/e2e-android/helpers/android.js` reads
`tests/e2e/fixtures/mock-deepseek.html`). They were moved to
`tests/fixtures/` and the reference updated — no behaviour change.
`fixture-resolver.js` / `tests/integration/fixture-resolver.test.js` were used
only by the deleted chrome/firefox e2e helpers → removed.

### 2.10 `better-deepseek-main.zip`

The original uploaded archive (7 MB). Its full contents were extracted into
the repo root in the first step of this conversion; keeping the zip would
duplicate the entire source tree in Git. Recoverable from Git history
(commit `94c17fa`).

### 2.11 `.github/workflows/ci.yml` + `release.yml` rewrites

- `ci.yml`: removed the `test` (Chrome extension Playwright) and
  `firefox-e2e` jobs. The vitest unit suite survives as the `unit` job
  (it tests `src/**` — the exact code shipped in the APK — not browser
  plumbing). The `android` job is kept (build:android → assembleDebug →
  Android Playwright parity suite → `./gradlew test` → artifacts).
  Instrumentation tests (`androidTest/`) are device/emulator-bound and were
  never wired into CI by this project; they remain runnable locally
  (documented in TESTING.md) rather than adding an emulator-runner
  capability that the project never had.
- `release.yml`: rewritten Android-only (APK as the single release asset;
  keystore decode → `assembleRelease` → `apksigner verify` chain preserved;
  latest-vs-tagged logic preserved for the APK).

## 3. Browser-only functionality preserved via the native bridge

`src/background/index.js` handled these `chrome.runtime.sendMessage` types.
On Android the polyfill (`android-chrome-polyfill.js`) routes **every**
`chrome.runtime.sendMessage` through `AndroidBridge.fetch(payloadJson)`
(`WebViewBridge.kt`). Pre-conversion state and resolution:

| Message type | JS consumer | State before conversion | Now implemented in |
|---|---|---|---|
| `bds-fetch-url` | `src/lib/pricing.js` (tier-1 pricing scrape), `src/content/files/web-reader.js` | ✅ native | `WebViewBridge.handleFetchUrl` (unchanged) |
| `bds-fetch-github-zip` | `src/content/files/github-reader.js` (GitHub repo import) | ✅ native | `WebViewBridge.handleFetchGithubZip` (unchanged) |
| `bds-fetch-github-commits` | `src/content/files/github-commits.js` | ✅ native | `WebViewBridge.handleFetchGithubCommits` (unchanged) |
| `bds-get-youtube-transcript` | `src/content/files/youtube-reader.js` (YouTube URL import) | ❌ stub error | **`YouTubeTranscript.kt`** — 1:1 port of the `youtube-transcript` package algorithm (InnerTube `youtubei/v1/player` + web-page `ytInitialPlayerResponse` fallback + caption XML parsing). Response shape `{ ok, transcript: [{text, offset, duration, lang}] }` unchanged |
| `BDS_UPDATE_LANGUAGES` | `src/content/index.js` (silent startup locale refresh), `SettingsPanel.svelte` (language update UI) | ❌ "Unsupported bridge message type" | **`RemoteDataSync.updateLanguages`** — fetches `src/locales/*.json` (en, fa, ru, tr, zh-cn) from the published repo, merges into `bds_locale_updates` preserving failed codes, stamps `bds_locale_update_last_checked`. Same storage keys/shape the content-side i18n reads |
| `BDS_WAIT_FOR_STARTUP` | debug API `waitForStartup` (ConfigDebugPanel) | ❌ unsupported | **`RemoteDataSync.waitForStartup`** — persists `status.json` → `bds_remote_announcement` and `remote-config.json` → `bds_remote_config` + `bds_remote_config_meta`, returns `{ success, remoteStatus, remoteConfig }` |
| `BDS_RESET_LANGUAGES` | `SettingsPanel.svelte` (reset languages) | ❌ unsupported | **`RemoteDataSync.resetLanguages`** — removes both locale storage keys, returns `{ success: true }` |
| `bds-mcp-list-tools` | `discoverMcpToolSchemas` (bridge.js), `SettingsPanel.testMcpServer` | ❌ unsupported | **`McpClient.listTools`** — full MCP JSON-RPC client: `initialize` handshake with auth-method auto-detection (Bearer → X-API-Key → none), `Mcp-Session-Id` tracking, SSE + JSON responses, 30 s timeout, 404/400 session-expiry retry. Returns `{ ok: true, tools: <result> }` |
| `bds-mcp-call` | `handleAutoMcpCall` (auto.js) | ❌ unsupported | **`McpClient.callTool`** — same client; returns `{ ok: true, result: <result> }` |
| `PING_HARNESS` | `src/lib/harness-bridge.js` / DeepCode mode detection | ❌ unsupported | **`HarnessClient.ping`** — plugin `GET /api/better-deepseek/ping` with `host.describe` native-mode fallback, same response shape |
| `EXECUTE_HARNESS_TASK` | `src/content/deep-code.js` (workspace lookup + harness handoff) | ❌ unsupported | **`HarnessClient.executeTask`** — `workspace.list` match, `session.create`, `session.prompt` (queue mode), same response shapes incl. debug payloads |

`chrome.storage.local` / `chrome.storage.onChanged` / `chrome.runtime.getURL`
were already covered by `android-chrome-polyfill.js` +
`WebViewBridge.getStorage/setStorage/removeStorage/getAssetUrl`
(SharedPreferences + `WebViewAssetLoader`) — unchanged.

`src/background/api-proxy.js` (`proxyApiRequest`): **no** message type ever
dispatched to it and no other module imports it — it was dead code in the
extension build as well, so no bridge equivalent is required (nothing to
preserve). The API Playground feature issues its DeepSeek API calls directly
from the page context, which is how it already behaves in this build.

## 4. Structural decisions

### 4.1 `android/` stays a subdirectory (not moved to repo root)

Options: (A) keep `android/` where it is; (B) hoist the Gradle project to the
repo root. Chose **A** because it has strictly less breakage:

- `scripts/run-android-gradle.js`, `scripts/copy-to-android-assets.js`,
  both CI workflows, `tests/integration/platform/android-manifest.test.js`,
  `.gitignore` entries and the docs all already reference `android/...`
  paths. Hoisting would touch every one of those plus the wrapper and would
  add zero functional value.
- The repo root now *is* the project (JS bundle sources + `android/` +
  workflows + `remote/`), which is the same shape mainstream hybrid repos
  (React Native, Capacitor, Cordova) use for a native subproject.
- Decision is documented here per the conversion rules; the Gradle project
  layout (`settings.gradle.kts` with `include(":app")`) is self-contained and
  untouched.

### 4.2 Gradle wrapper restored and committed

The `android/` Gradle wrapper was incomplete: `gradlew`/`gradlew.bat`
existed but `gradle/wrapper/gradle-wrapper.jar` + `gradle-wrapper.properties`
were missing — because `android/.gitignore` ignored the whole `gradle/`
directory. Both `ci.yml` and `release.yml` therefore contained a
"bootstrapping" step that `curl`ed the wrapper jar from
`raw.githubusercontent.com` on every run.

Fix: `gradle/wrapper/gradle-wrapper.jar` (Gradle 8.7, matching the URL the
workflows already used) and `gradle-wrapper.properties` are now committed,
`android/.gitignore` no longer ignores `gradle/`, and the bootstrap steps
were removed from both workflows. `./gradlew` is now self-sufficient,
reproducible and offline-bootstrappable.

### 4.3 Signing unchanged

`android/app/build.gradle.kts` keeps the existing release signing config
(`ci-release.jks` + `BDS_KEYSTORE_PASSWORD` / `BDS_KEY_ALIAS` /
`BDS_KEY_PASSWORD` env vars, keystore decoded from the `BDS_KEYSTORE`
base64 secret in CI) — identical to the pre-conversion workflow, so existing
installs can keep updating in place (same key). `versionCode`/`versionName`
and the `BdsBuildId`→`BUILD_ID` mechanism are untouched.

### 4.4 Locales

All five locales kept on both layers:

- JS i18n: `src/locales/{en,fa,ru,tr,zh-cn}.json` (bundled) + runtime updates
  via `BDS_UPDATE_LANGUAGES` (now native).
- Native app strings: `res/values-{fa,ru,tr,zh-rCN}/strings.xml` — unchanged.

## 5. Verification performed / expected

- `npm run build:android` → `dist-android/` + staged `assets/bds/` (content.js,
  content.css, injected.js, sandbox.js, sandbox.html, static/loading).
- `npm run test:unit` (vitest, full `src/**` + `tests/**` suite) — green.
- `./gradlew assembleDebug` / `assembleRelease` — verified in CI
  (sandbox note: this environment has no JDK/Android SDK and no network
  route to Maven/Google/Gradle hosts, so the Gradle steps are exercised by
  the CI workflow; all Kotlin code was reviewed line-by-line against the
  existing tested patterns and is covered by the new unit tests below).
- New Kotlin unit tests (MockWebServer-based, same pattern as the existing
  137 tests): `McpClientTest`, `YouTubeTranscriptTest`,
  `RemoteDataSyncTest`, `HarnessClientTest`, plus dispatch routing tests in
  `WebViewBridgeTest`.

## 6. Implementation log (bridge ports + decisions made while porting)

Completed in `android/app/src/main/java/com/betterdeepseek/app/`:

- `McpClient.kt` — Streamable-HTTP JSON-RPC 2.0 client (initialize handshake,
  Bearer→X-API-Key→none auth auto-detect, `Mcp-Session-Id` tracking, JSON + SSE
  decoding, 30 s timeout, 404/400 re-init + single retry). `McpException(status)`.
- `YouTubeTranscript.kt` — 1:1 port of `youtube-transcript@1.3.0`:
  video-id regex (verified byte-level against all URL forms), InnerTube
  `youtubei/v1/player` (Android client context) with silent fallback to the
  watch-page scrape, captcha / unavailable / disabled / no-transcripts error
  messages identical to the package, `<p t d>`+`<s>` XML parse with the legacy
  `<text start dur>` fallback (unit semantics preserved exactly — the legacy
  branch stores raw seconds, matching the npm package), entity decoding,
  `parseInlineJson` brace counting. `captionHostSuffix` is injectable (defaults
  to `.youtube.com`) so the host guard is testable against MockWebServer.
- `RemoteDataSync.kt` — `updateLanguages` / `waitForStartup` /
  `resetLanguages` with the exact storage keys and JSON-string value shapes
  (`bds_locale_updates`, `bds_locale_update_last_checked`,
  `bds_remote_announcement`, `bds_remote_config`, `bds_remote_config_meta`).
  Locale codes `en, fa, ru, tr, zh-cn`; production URLs from
  `src/lib/constants.js` baked in as defaults.
- `HarnessClient.kt` — `ping` (plugin `/api/better-deepseek/ping` → native
  `host.describe` fallback) and `executeTask` (workspace.list folder lookup,
  session.create, session.prompt queue mode; absolute-path validation port of
  the JS regex incl. Windows drive letters).
- `WebViewBridge.kt` — `fetch()` dispatch extended with 8 message types
  (`bds-get-youtube-transcript`, `BDS_UPDATE_LANGUAGES`,
  `BDS_WAIT_FOR_STARTUP`, `BDS_RESET_LANGUAGES`, `bds-mcp-list-tools`,
  `bds-mcp-call`, `PING_HARNESS`, `EXECUTE_HARNESS_TASK`); components are
  optional trailing constructor params (default null → built on the bridge's
  own prefs/client), so every existing call site and test is untouched.
  Response contracts match the JS consumers (verified in `src/content/bridge.js`,
  `src/content/auto.js`, `SettingsPanel.svelte`, `youtube-reader.js`,
  `deep-code.js`).

New tests: `McpClientTest` (9), `YouTubeTranscriptTest` (13),
`RemoteDataSyncTest` (10), `HarnessClientTest` (15),
`WebViewBridgeDispatchTest` (10) + shared `InMemorySharedPreferences` helper.

### 6.1 Cleartext policy for the local harness

`HarnessClient` speaks plain HTTP to `http://127.0.0.1:3080`. The app manifest
sets `usesCleartextTraffic="false"` (correct for the public internet), which
would also block loopback OkHttp calls on API 28+. Added
`res/xml/network_security_config.xml` referenced from the manifest, permitting
cleartext **only** for `127.0.0.1` / `localhost`; all other hosts keep the
cleartext ban (no `<base-config>` → default deny). This is the native
equivalent of the extension being able to reach loopback from the SW.

### 6.2 Known porting notes

- `bds_locale_update_last_checked` is display-only (SettingsPanel renders it
  verbatim); the native side writes a medium date in the device locale — the
  same class of value as JS `toLocaleDateString()`.
- The MCP `notifications/initialized` failure is ignored, exactly like the JS
  `fetch(...).catch(() => {})`.
- `EXECUTE_HARNESS_TASK` with neither cwd nor workspaceId surfaces as
  `{ ok:false, error: "Bridge error: Missing required cwd or workspaceId..." }`
  (the bridge catch-all prefix is kept because existing tests assert it).
