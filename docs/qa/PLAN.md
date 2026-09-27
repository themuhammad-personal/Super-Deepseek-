# Super DeepSeek — real-world testing, update & bug hunt: working plan

Owner brief: verify the app the way users really use it, find every remaining bug, fix each one
with proof, keep the app up to date. Everything below is executed in the sandbox, pushed to
`themuhammad-personal/Super-Deepseek-` on the branch `qa/real-world-testing` (main is changed only
via PR after CI is green — owner rule).

## Baseline (recorded 2026-09-27, Node 22.20 / JDK 17.0.20, toolchain in sandbox)

| Suite | Result |
|---|---|
| `npm run typecheck` | ✅ 0 errors |
| `npm run test:app` | ✅ 99/99 |
| `npm run test:engine` | ✅ 86/86 |
| `npm run test:template` | ❌ 18 failing (template-era scripts) |
| `npm run lint` | ⚠️ 2 warnings (`react-refresh/only-export-components`) |
| `./gradlew testDebugUnitTest` | ⏳ to be run (needs Android SDK; CI is the source of truth) |

## Order of work

1. **Code reading sweep** (master prompt §4): every Kotlin file + `sd-native.js`, `sd-agent.js`,
   `sd-sheets.js`, `injected.js`, and the `sd*` parts of `content.js`. Record races, leaks,
   missing `runCatching`, dead code, unlocalised strings.
2. **Known-risk audit** (§4.1–4.11), one by one, with evidence.
3. **Repo health** (§4.11): fix the 18 `test:template` failures or delete obsolete template-era
   tests with a clear commit; clean the 2 eslint warnings; sync `docs/ARCHITECTURE.md`.
4. **Security hardening** (§4.4): private/loopback IP blocking in the bridge `fetch` (with tests),
   bridge trust re-audit, path traversal / zip-slip / workspace-escape checks.
5. **Engine fixes** (only asserted single-match edits to `content.js`): selector health check
   (§4.1), "Continue task" chip after a run-once stall (§4.3), anything else found.
6. **Layer 2 harness** (`tools/harness/`): puppeteer-core + Chromium, fixture page captured from
   the real DOM structure, fake `AndroidBridge`, engine injected in MainActivity's order; the
   must-have scenarios; screenshots as CI artifacts.
7. **Layer 3**: emulator CI job (`reactivecircus/android-emulator-runner`), API 30/34/35,
   `connectedDebugAndroidTest`, test-only fixture flag.
8. **Layer 4 prep**: debug-only WebView inspection flag if missing; Bengali test script for the
   owner; list of everything unverified on real hardware.
9. **Push often**, keep CI green, final report in Bengali (`docs/qa/REPORT-BN.md`).

## Bug list (updated as findings are proven)

| # | Severity | Area | Finding | Status |
|---|---|---|---|---|
| 1 | High (security) | WebViewBridge fetch | SSRF: no block for loopback/private-network targets (risk §4.4) | confirmed in source, fix pending |
| 2 | Medium (repo) | scripts tests | `test:template` 18 failing tests | confirmed, fix pending |
| 3 | Low (repo) | eslint | 2 react-refresh warnings | confirmed, fix pending |
| 4 | Medium (UX/robustness) | engine | DeepSeek DOM drift fails silently (risk §4.1) | fix pending |
| 5 | Medium (UX) | engine | run-once gate stalls after reload mid-task with no way to resume (risk §4.3) | fix pending |

(Signature rule: a bug is *fixed* only when a test/repro fails on old code and passes on new,
and the full suite is green again.)
