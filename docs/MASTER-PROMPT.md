# Master prompt — final polish of Super DeepSeek

Copy everything below the line into a capable coding agent that has access to this
repository (GitHub `themuhammad-personal/Deepseek-`).

---

You are a senior Android engineer and UI/UX designer taking over **Super DeepSeek**, a
native Android app (Kotlin + WebView) that wraps the official `chat.deepseek.com` and
injects its own engine (JS) to add an AI agent with a built-in Linux sandbox ("Linux
Studio"), memory, MCP tools, slash commands, Deep Research and exports. Most of the
work is done and builds green in CI. Your job is the **final polish**: find and fix what
is still broken or rough, verify everything on real behaviour, and leave the app
release-ready. Work carefully; understand code before changing it.

## Hard rules (never break these)

1. Work only on the branch you were given. **Never merge into `main`, never open a PR**
   unless the owner explicitly asks.
2. **Signing and identity are frozen**: do not touch the keystore, signing config, CI
   signing secrets, `applicationId` / package `com.superdeepseek.app` (renamed once, from
   `com.betterdeepseek.app`, at the owner's request), or `versionName` handling. New builds
   must install as updates over the previous one.
3. Storage keys (`bds_*`), CSS classes (`bds-*`) and internal event
   names (`bds:*`, `bds-mcp-call`…) are historical and stay. Everything the **user or the
   model reads** must say *Super DeepSeek* / *SDS* — never "Better DeepSeek" / "BDS".
   The only allowed mention is the credit at the end of `README.md`.
4. The engine bundle `android/app/src/main/bds-assets/bds/content.js` (~3.3 MB,
   minified) is **never rebuilt or replaced from upstream**. Edit it only with exact,
   asserted string replacements (a script that fails if the match count is not 1) or
   AST/token tooling (acorn is available). After every edit: `node -e` parse check and
   `npm run test:engine`.
5. Never call `File.deleteRecursively()` / `walk()` on trees that may contain symlinks
   (the Linux rootfs does). Use the existing no-follow delete helpers.
6. `compileSdk` is 34 and CI uses the K1 Kotlin compiler: no API-35 overrides
   (e.g. `Service.onTimeout`), keep null checks inline (weak smart casts).
7. The official DeepSeek UI must never flash during launch; the launch screen
   (`BootScreenView`) stays until the enhanced page is ready (hard cap 18 s). Status and
   navigation bars must exactly match the chat colour in light and dark mode.
8. Do not add roadmap features (widgets, API mode, Play Store release…) unless asked.

## Map of the code

- `android/app/src/main/java/com/superdeepseek/app/`
  - `MainActivity.kt` — WebView setup, launch screen, bars (PixelCopy sampling), file
    chooser, permissions (mic for voice, notifications), renderer-crash recovery,
    liveness probe on resume, restoring the open chat (`ChatUrls.kt`).
  - `WebViewBridge.kt` — `window.AndroidBridge`: storage, pickers (files are streamed to
    the page as `https://chat.deepseek.com/__sd/blob/<token>` via
    `shouldInterceptRequest`, see `NativeBlobStore.kt`), downloads, CORS-free fetch,
    MCP client (Streamable HTTP + SSE), sandbox tool calls, update checks.
  - `Sandbox.kt`, `SandboxTools.kt`, `SandboxService.kt`, `TarGz.kt`,
    `StudioActivity.kt`, `StudioPreview.kt`, `StudioSheet.kt` — the Linux sandbox (Termux proot from `jniLibs/<abi>/libproot.so`
    + Alpine minirootfs installed on first use), its tools, the foreground service with
    Stop, and Linux Studio (terminal / files / preview).
  - `UiPolish.kt`, `PageActions.kt`, `BootScreenView.kt`, `UpdateChecker.kt`.
- `android/app/src/main/bds-assets/bds/` — engine: `content.js` (UI + logic; default
  system prompt `du`, template version `N1`, parser `pxe`, settings loader, one-time
  rename `sdsRebrandStored`), `injected.js` (prompt injection `O()`, MCP block `me()`),
  `sd-native.js` (native glue), `sd-agent.js` (sandbox agent glue, Stop chip, ask mode,
  continuity, live sandbox context for the prompt, the Settings → Linux & Agent card),
  `sd-sheets.js` (drag-to-dismiss sheets, Back for our own sheets),
  `content.css`, `our-skin.css`.
- `scripts/fetch_sandbox_deps.py` — CI step that downloads proot + library closure and
  Alpine metadata (SHA-verified). `docs/licenses/SANDBOX-NOTICE.md` — GPL/LGPL notices.
- `docs/ARCHITECTURE.md` — read this first.

## How to build and test

- `npm ci`, `npm run typecheck`, `npm run test:app`, `npm run test:engine`
  (`node --test 'android/app/src/test/js/*.test.mjs'`; use the quoted glob).
- Kotlin unit tests (JUnit + Robolectric) run in CI: `./gradlew testDebugUnitTest`,
  then `assembleRelease`. Workflow: `.github/workflows/build-and-release-apk.yml`
  (runs on this branch; the APK is uploaded as an artifact).
- Every change needs a test when it is testable without a device (pure Kotlin helpers,
  engine functions pulled out with acorn — see `engine-tags.test.mjs` for the pattern).
- Push, then watch CI with `gh run list --branch <branch>` and check annotations. Do not
  leave the branch red.

## What still needs work (in priority order)

1. **On-device verification of the Linux sandbox and agent** (it could not be run in CI):
   first-run install of Alpine, `apk add`, `pip`, `npm`, `git clone`, a long job
   (`job` tool), `preview` of a dev server, `export_file`, Stop from the chip and from the
   notification, "ask before each command" mode, Reset Linux. Check 16 KB-page devices
   and Android 14/15 (phantom-process killer, FGS rules). Fix whatever fails, with clear
   user-facing error messages.
2. **Long agent tasks in the background**: confirm the loop continues with the screen
   off for 10+ minutes (foreground service stays while `sandboxAgentActive` is true;
   renderer at IMPORTANT priority). If WebView JS still stalls, move the loop state to the
   native side so it can resume, and make sure a reloaded page does not run the same tool
   call twice.
3. **Uploads**: every file type selectable (code files, archives, office, media), files
   up to DeepSeek's 100 MB limit, several at once, fast (streamed, never base64 in
   memory). Test DeepSeek's own paperclip and the engine's + sheet. Show clear messages
   for skipped files (too large / unreadable).
4. **Full bug sweep**: read every Kotlin file and the glue JS (`sd-native.js`,
   `sd-agent.js`, `sd-sheets.js`, `injected.js`) for leaks, races (main vs. background threads, WebView
   callbacks after `onDestroy`), unhandled exceptions, wrong thread UI access, missing
   `runCatching` around WebView calls, and dead code from the old React-SPA era
   (`reactWebView`, legacy token polling / `dsLoginNative`) that can be removed safely.
5. **Branding and copy**: no "Better DeepSeek"/"BDS" anywhere a user or the model reads
   (check strings in all 6 UI languages, engine settings, help sheet, What's New,
   notifications, error messages). Bengali text must read naturally.
6. **UI/UX polish**: consistent spacing, typography and dark/light colours in Linux Studio
   and the engine sheets; touch targets ≥ 48 dp; TalkBack labels; no layout jumps when
   the keyboard opens; the Back button always closes the top-most sheet first.
7. **Modern Android**: plan the move to target/compile SDK 35–36 (Play requires 36 for
   new uploads) as a separate, well-tested change — edge-to-edge is already handled.

## Definition of done

- CI green on the branch; all JS and Kotlin tests pass; new behaviour is covered.
- A short written report: what you changed, what you verified and how, what remains
  unverified, and any risk. Keep the owner's language (Bengali) for the report if asked.
