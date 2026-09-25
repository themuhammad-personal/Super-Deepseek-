# Android port — verification & bug-fix report

Report for the follow-up "fresh audit and repair" pass over the Better DeepSeek
Android conversion (`android/`, the shared JS bundle in `src/`, and the GitHub
Actions pipeline). Everything listed here was reproduced from the sources in
this repository; the previous conversion notes in `docs/REASONING-NOTES.md`
where checked against the code and, where they were wrong, corrected there as
well (see §5).

Branch: `arena/01a0d81f-super-deepseek` (base `main` @ `f4a8348`).
No feature, UI element or asset was removed, and none was added — the changes
are bug fixes, test repairs and CI correctness only.

---

## 1. Bugs that broke the build (the port had never compiled)

The Gradle wrapper 404'd in CI before `./gradlew test` could even run, so none of
the Kotlin sources had ever been compiled. Twenty fixes were needed before the
first successful `assembleDebug` / `assembleRelease`:

| # | File | Bug | Fix |
|---|------|-----|-----|
| 1 | `android/gradle/wrapper/gradle-wrapper.properties`, `scripts/ensure-gradle-wrapper.js` | Wrapper pinned `gradle-8.7.0-bin.zip`. The published asset for the 8.7 line is `gradle-8.7-bin.zip` (only patch releases carry a third component), so the wrapper download returned 404 for every build. | Pin `8.7` (`v8.7.0` stays the *git tag* used for the wrapper JAR) and make the bootstrap script rewrite a stale properties file. |
| 2 | `android/app/build.gradle.kts` | `signingConfigs { }` was nested inside `buildTypes { }` — invalid Kotlin DSL, it has to be a direct child of `android { }`. | Moved it out; `buildTypes.release` now references it as a sibling. |
| 3 | `android/app/build.gradle.kts` | The workflow passes `-PbdsBuildId=<run number>`, the script read `findProperty("BdsBuildId")`. Gradle property names are case-sensitive, so `BuildConfig.BUILD_ID` was always `0` and the beta updater could not tell two builds of the same version apart. | Read `bdsBuildId` (legacy spelling still accepted). |
| 4 | `android/app/build.gradle.kts` | The release signing config was attached unconditionally, so a repository without the `BDS_KEYSTORE` secret failed at `assembleRelease` (AGP cannot validate a signing config whose `storeFile` is missing) — the workflow's own "might fail or be unsigned" warning was never true. | Attach the config only when `android/ci-release.jks` exists; the workflow skips `apksigner verify` for an unsigned APK and warns instead of failing. |
| 5 | `WebViewBridge.kt` | Constructor parameters `remoteDataSync/mcpClient/harnessClient/youtubeTranscript/apiProxy` were declared `private val`, colliding with the resolved class properties of the same name ("conflicting declarations"). | Plain (non-`val`) parameters, mirroring the existing `httpClient` parameter/property pair. |
| 6 | `WebViewBridge.kt` | Public class constructor exposed `internal` types (`ApiProxyClient`, `HarnessClient`, …). | Class is `internal`, consistent with its collaborators. |
| 7 | `WebViewBridge.kt` | `remoteDataSync ?: RemoteDataSync(prefs, httpClient)` — the bare name still resolves to the *nullable* parameter, not the resolved property. | `this.httpClient`. |
| 8 | `RemoteDataSync.kt` | Kotlin block comments **nest**, so a literal `/*` inside a KDoc (`src/locales/*.json`) left the file with an unterminated comment; the compiler then could not resolve `RemoteDataSync` anywhere. | Re-worded the two offending KDoc lines. |
| 9 | `RemoteDataSync.kt` | `json.keys().toList()` — `org.json` hands out an `Iterator`, which has no `toList()`. | Added `keysOf(json) = json.keys().asSequence().toList()`. |
| 10 | `McpClient.kt` | `resp.body?.string()?.orEmpty().take(300)` — the safe call keeps the receiver nullable, so `.take()` did not compile. | `resp.body?.string().orEmpty().take(300)`. |
| 11 | `YouTubeTranscript.kt` | `okhttp3.HttpUrl.get(baseUrl)` — OkHttp 4 removed the static factory. | `baseUrl.toHttpUrlOrNull()`. |
| 12 | `HarnessClient.kt` | `Regex.matches()` is a **full-string** match, so `^[a-zA-Z]:[/\\]` rejected every real Windows path (`A:/Users/…`) and the harness refused all absolute `cwd`s. | `containsMatchIn` (the JS sibling uses `.test()`, a prefix test). |
| 13 | `HarnessClient.kt` | Redundant `!!` on a smart-cast non-null value (compiler warning). | Removed. |
| 14 | `ApiProxyClient.kt` | OkHttp appends `; charset=utf-8` to a **String** request body's media type, so the wire header was `application/json; charset=utf-8` while the browser extension sends exactly `application/json`. | Build the JSON body from bytes. |
| 15 | `InMemorySharedPreferences.kt` (test double) | Tests used `prefs["key"]`; the class had no `operator get/set`. | Added them (plus `containsKey`). |
| 16 | `WebViewBridgeDispatchTest.kt` | `import org.mockito.Mockito.when` — `when` is a Kotlin keyword. | Backticked import and call. |
| 17 | `YouTubeTranscriptTest.kt` | A backticked test name contained `youtu.be`; `.` is illegal in a JVM method name. | Renamed the test. |
| 18 | `McpClientTest.kt` / `HarnessClientTest.kt` | Tests asserted on the wrong `MockWebServer` request (init/notify handshake and plugin-ping requests are recorded first), and one test expected `{ok:false}` where the client throws `IllegalArgumentException`. | Consume the handshake requests first; `assertThrows` for the throwing path. |
| 19 | `HarnessClientTest.kt`, `WebViewBridgeDispatchTest.kt`, `YouTubeTranscriptTest.kt` | Several tests queued fewer responses than the client really sends (`session.prompt` after `session.create`, the watch-page fallback after an InnerTube failure). MockWebServer then has an empty queue and the request hangs until the read timeout, so assertions failed for the wrong reason. | Queue one response per real request and assert the request order. |
| 20 | `RemoteDataSync.kt` | The structural diff relied on `JSONObject.equals`, which `org.json` does **not** override (identity only). Every value therefore looked changed, defeating the "write only what changed" contract of `computeDiff`. The ported replacement then had its own bug: `Sequence.sorted()` returns a lazy `Sequence`, which also has no value equality, so the key-set comparison always reported a difference. | Faithful port of the extension's `deepEqual` (`src/lib/deep-equal.js`): ordered key lists (`toList()`), index-based arrays, numeric comparison for numbers. |

Verification for this group: the first CI run that passed
`./gradlew test` + `assembleDebug` (run `36138196717`) and the release
`assembleRelease` (run `36138793319`).

## 2. Functional regression: the API Playground was dead

**Lead L3 confirmed — and it was the most damaging defect.**

The browser extension registered `bds-api-proxy` in
`src/background/api-proxy.js`, imported for its side effect by
`src/background/index.js`. The Android conversion deleted the whole
`background/` directory, but `src/content/api-playground/api-store.svelte.js`
kept sending `chrome.runtime.sendMessage({ type: "bds-api-proxy", … })`. The
polyfill forwards that to `WebViewBridge.fetch`, which had no branch for it, so
**every** API Playground request — chat completions, FIM completions, models,
balance — failed with `Unsupported bridge message type: bds-api-proxy`.

* Fix: new `android/app/src/main/java/com/betterdeepseek/app/ApiProxyClient.kt`,
  a 1:1 port of `api-proxy.js` (endpoint → URL/verb, camelCase→snake_case body
  building, `prefix: true` on a trailing assistant message, SSE chunk decoding
  with `[DONE]`, `{ok,data,latency,streamed}` / `{ok:false,error,status}`
  contract, JS `ApiError` message resolution), dispatched from
  `WebViewBridge.handleApiProxy`.
* Regression guard: `tests/integration/platform/android-bridge-contract.test.js`
  statically compares every message type sent by the JS side with the Kotlin
  dispatcher, so a dropped handler fails `npm run test:unit`.
* New unit coverage: `ApiProxyClientTest.kt` (8 tests).

## 3. Other functional bugs

| Area | Bug | Fix |
|------|-----|-----|
| Remote data (pricing / remote config / status) | The conversion rewrote the published URLs to `remote/…`, a path that does not exist upstream (`extension/…` does), so all three fetches 404'd. Added a stale comment in `RemoteDataSync.kt` claiming the opposite. | Pointed `src/lib/constants.js`, `src/lib/remote-persistence.js` and `RemoteDataSync.kt` at the published `extension/…` paths. |
| Release pipeline | The published release body had lost the `<!-- bds-build-id: N -->` marker that `UpdateChecker` parses, so the in-app beta updater could not see CI build numbers. | Restored the marker in both release bodies. |
| Release pipeline | No way to build an APK for a branch: `release.yml` only ran on `main`/tags, and `workflow_dispatch` is only offered for workflows that exist on the default branch. | `workflow_dispatch` kept, and non-`main` runs now always upload the verified APK as a workflow artifact. |

## 4. Verify-as-you-go results

All results below come from the GitHub Actions runs on this branch (the sandbox
has no JDK/Android SDK, and its egress only reaches github.com, so CI **is** the
compiler and test runner here).

| Check | Result |
|-------|--------|
| `npm run test:unit` (vitest, 101 files) | ✅ pass — CI "Unit tests" job, runs `36138196717`, `36138797405` |
| `npm run test:e2e:android` (Playwright WebView simulator) | ✅ pass — CI "Android" job |
| `./gradlew test` (205 Kotlin JVM unit tests in 17 classes) | ✅ pass |
| `./gradlew assembleDebug` | ✅ pass — `android-apk-debug` artifact, 6,880,896 bytes |
| `./gradlew assembleRelease` (`release.yml`) | ✅ pass — `better-deepseek-android-signed-apk` artifact, 5,526,915 bytes, named `better-deepseek-android-v0.1.14-signed.apk` |
| Manifest / resources | ✅ every manifest reference (`Theme.BetterDeepSeek*`, `ic_launcher(_round)`, `bds_file_provider_paths`, `network_security_config`, `@color/launcher_background`) resolves; the four translated `strings.xml` files are complete (they intentionally omit `app_name`, `bds_asset_authority`, `bds_target_url`, which must not be localised) |

### Known limitation — signing secrets

The `release.yml` run proved the release build, but the produced APK is
**unsigned**: this repository has no `BDS_KEYSTORE` / `BDS_KEYSTORE_PASSWORD` /
`BDS_KEY_ALIAS` / `BDS_KEY_PASSWORD` secrets configured (the job now logs a
warning and skips signature verification instead of failing). To obtain a
signed APK, add those four secrets and re-run the workflow — with the secret
present the behaviour is byte-for-byte the previous intent.

Artifacts cannot be downloaded into this sandbox (GitHub serves them from
`*.blob.core.windows.net`, which is not reachable here); they are available from
the Actions UI of the two runs above.

## 5. Verification of the supplied leads, and of the previous AI's notes

| Lead | Verdict |
|------|---------|
| **L1** `signingConfigs` nested inside `buildTypes` | Reproduced. It is invalid Kotlin DSL and was fixed (bug 2). Note: the upstream extension repo carries the same nesting and still released an APK, which is why the mistake survived — the *real* build breaker was the wrapper URL (bug 1). |
| **L2** `bdsBuildId` vs `BdsBuildId` | Reproduced (bug 3). |
| **L3** deleted `api-proxy.js` while the front-end still calls it | Reproduced exactly as described: `background/index.js` did `import "./api-proxy.js"`, so it was live code and the Playground was broken on Android. Fixed in §2. |
| **L4** `docs/REASONING-NOTES.md` claims | The "dead code" claims about `api-proxy.js` were false and are now corrected in place (§2 of the notes, with a dated correction block). Every other "unused"/"no other importer" claim was re-grepped; the remaining ones held. |

Additional items re-checked while auditing: `gradle.properties`,
`settings.gradle.kts`, `android/build.gradle.kts`, `gradle-wrapper.jar`
bootstrap, `AndroidManifest.xml` (permissions, `FileProvider`, network security
config, `WebViewAssetLoader` authority), all `res/` files, `.gitignore` coverage
of build output, and every step/attribute/path in both workflows.

## 6. Files added or changed

* Added: `android/app/src/main/java/com/betterdeepseek/app/ApiProxyClient.kt`,
  `android/app/src/test/java/com/betterdeepseek/app/ApiProxyClientTest.kt`,
  `tests/integration/platform/android-bridge-contract.test.js`.
* Android sources: `WebViewBridge.kt`, `RemoteDataSync.kt`, `HarnessClient.kt`,
  `McpClient.kt`, `YouTubeTranscript.kt`, `app/build.gradle.kts`,
  `gradle/wrapper/gradle-wrapper.properties`.
* JS: `src/lib/constants.js`, `src/lib/remote-persistence.js`.
* CI: `.github/workflows/ci.yml`, `.github/workflows/release.yml`,
  `scripts/ensure-gradle-wrapper.js`.
* Tests/docs: the JVM test sources listed in §1 plus `docs/REASONING-NOTES.md`.
