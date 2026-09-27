# Super DeepSeek — real-world testing, update & bug hunt: working plan

Owner brief: verify the app the way users really use it, find every remaining bug, fix each one
with proof, keep the app up to date. Everything below is executed in the sandbox, pushed to
`themuhammad-personal/Super-Deepseek-` on the branch `qa/real-world-testing` (main is changed only
via PR after CI is green — owner rule).

## Baseline (recorded 2026-09-27, Node 22.20 / JDK 17.0.20, toolchain in sandbox)

| Suite | Start of work | Final |
|---|---|---|
| `npm run typecheck` | ✅ 0 errors | ✅ 0 errors |
| `npm run test:app` | ✅ 99/99 | ✅ 99/99 |
| `npm run test:engine` | ✅ 86/86 | ✅ 105/105 |
| `npm run test:template` | ❌ 18 failing | ✅ 192/192 |
| `npm run lint` | ⚠️ 2 warnings | ✅ 0 warnings / 0 errors |
| `npm run test:harness` | (did not exist) | ✅ 7 pass, 2 skip (needs real-page capture), 0 fail |
| `./gradlew testDebugUnitTest` | ⏳ | ✅ all classes green (see REPORT-BN.md) |

## Order of work — status

1. **Code reading sweep** ✅ — all Kotlin files + sd-native/sd-agent/sd-sheets/sd-health +
   the sd* parts of content.js; races, leaks and stale selectors recorded in the bug list.
2. **Known-risk audit (§4.1–4.11)** ✅ with evidence in the bug list.
3. **Repo health (§4.11)** ✅ — template tests cleared, eslint clean,
   `docs/ARCHITECTURE.md` synced.
4. **Security hardening (§4.4)** ✅ — SSRF guard (loopback/private ranges) with tests;
   bridge-trust re-audit found bug 6 (subframe trust flips); zip-slip/path handling
   (TarGzExtractorTest) reviewed.
5. **Engine fixes** ✅ — selector health check (sd-health.js), Continue-task chip after a
   run-once stall, reply-end detection fix (bug 7), model-badge classifier fix (bug 8).
   All content.js edits were asserted single-match replacements + `node --check`.
6. **Layer 2 harness (`tools/harness/`)** ✅ — real engine + fake AndroidBridge + fixture;
   the must-have scenarios; screenshots as CI artifacts. Fixture is a MODEL — the owner must
   replace it with a real capture (see tools/harness/README.md).
7. **Layer 3** ✅ — emulator CI job (`reactivecircus/android-emulator-runner@v2`), API
   30/34/35, smoke script (install/launch/liveness/crash markers); report-only until stable.
8. **Layer 4 prep** ✅ — debug-only WebView inspection (`BuildConfig.DEBUG`), Bengali test
   script for the owner in `docs/qa/REPORT-BN.md`, unverified-on-hardware list there too.
9. **Report** ✅ — `docs/qa/REPORT-BN.md` (Bengali), this plan kept current.

## Bug list (updated as findings are proven)

| # | Severity | Area | Finding | Status |
|---|---|---|---|---|
| 1 | High (security) | WebViewBridge fetch | SSRF: no block for loopback/private-network targets (risk §4.4) | ✅ fixed `825aa6c` — NetworkGuard + 21 unit tests |
| 2 | Medium (repo) | scripts tests | `test:template` 18 failing tests | ✅ fixed `7bae7b8` — 192/192 |
| 3 | Low (repo) | eslint | 2 react-refresh warnings | ✅ fixed `7bae7b8` — 0/0 |
| 4 | Medium (UX/robustness) | engine | DeepSeek DOM drift fails silently (risk §4.1) | ✅ fixed `e38e132` — sd-health.js + 9 tests |
| 5 | Medium (UX) | engine | run-once gate stalls after reload mid-task with no way to resume (risk §4.3) | ✅ fixed `e38e132` — Continue-task chip + 6 tests |
| 6 | High (security) | WebViewBridge trust | subframe navigations flip `trustedPage`; engine injected on `url.contains("chat.deepseek.com")` | ✅ fixed `4497666` — MainFrameTracker; fail-before 2/5 red → 5/5 + 7/7 green |
| 7 | Medium (UX) | sd-agent | reply-end detection misses short replies (500 ms poll edge) → keep-going nudges, Continue chip and reprocess dead | ✅ fixed `3832e6f` — harness `keep-going` red → green |
| 8 | Low (pricing) | engine classifier | model-badge label matched by exact equality ("DeepSeek Expert" mis-priced as flash) | ✅ fixed — engine-model.test.mjs red → green |

(Signature rule: a bug is *fixed* only when a test/repro fails on old code and passes on new,
and the full suite is green again.)

## Quick-win pass (verified 2026-09-27)

- **Model name** — badge classifier hardened (bug 8); API `model` label path verified by tests.
- **fetch_sandbox_deps SHA** — `python3 scripts/fetch_sandbox_deps.py` runs end-to-end:
  Termux proot/libtalloc .debs SHA-256-verified (5.1.107.95 / 2.4.3), Alpine minirootfs
  manifest pins sha256 for all four ABIs (3.24.2).
- **bds-sync dry run** — `scripts/bds-sync.sh` (no `--replace`) compared a fresh upstream
  build against the committed bundle: `sandbox.html` identical, our bundle is a patched
  superset; nothing to port.
- **Debug WebView inspection** — `WebView.setWebContentsDebuggingEnabled` under
  `BuildConfig.DEBUG` only (was missing entirely).
