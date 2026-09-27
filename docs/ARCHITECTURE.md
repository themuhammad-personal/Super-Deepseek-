# Architecture

Super DeepSeek is a native Android shell around the **official** DeepSeek web chat.
Instead of re-implementing DeepSeek's private API, it loads `chat.deepseek.com` in a
WebView and injects the Super DeepSeek engine, which adds every feature on top of the
real page. The protocol, sign-in, anti-bot checks and model behaviour stay exactly
what DeepSeek ships.

```
┌──────────────────────────── MainActivity ───────────────────────────┐
│ system splash ─▶ BootScreenView (native launch screen, see below)   │
│                                                                     │
│ officialWebView ──▶ https://chat.deepseek.com/                      │
│   onPageFinished ─▶ injectBdsScripts():                             │
│        1. injected.js   network hooks (prompt injection, tool tags) │
│        2. content.css   engine styles  (style#bds-css)              │
│        3. content.js    engine UI + logic (Svelte)                  │
│        4. UiPolish      hides out-of-scope features, signals ready  │
│   shouldInterceptRequest ─▶ https://bds-asset.local/bds/* from APK  │
│                                                                     │
│ AndroidBridge (WebViewBridge) — JS ⇄ native                         │
│   storage · file/camera picker · downloads · haptics · MCP fetch    │
│   locale/theme · update checks (UpdateChecker)                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Layers

| Layer | Where | Responsibility |
|---|---|---|
| Native shell | `android/app/src/main/java/com/superdeepseek/app/` | WebView setup, splash/boot overlay, insets, back handling, file chooser, external links |
| Bridge | `WebViewBridge.kt` | `window.AndroidBridge`: persistent storage, native pickers, blob downloads, haptics, CORS-free fetch for MCP/web tools |
| Engine | `android/app/src/main/bds-assets/bds/` | `content.js` (UI + features), `content.css`, `injected.js` (network layer), `sandbox.*` (isolated code runners) |
| Polish | `UiPolish.kt` | Small, unit-tested DOM sweep: hides voice / Deep Code entries and repairs raw labels |
| Updates | `UpdateChecker.kt` | Polls this repository's GitHub Releases (stable or beta channel) and installs the signed APK |

The application id and Kotlin package are `com.superdeepseek.app`. Earlier builds
used `com.betterdeepseek.app`; Android treats the new
id as a different app, so it installs next to the old one and cannot read its data. Settings move
over with the engine's own Export → Import (README, "Coming from an older build?"). Keep the new id and the keystore unchanged from
now on, or updates break again.

## The engine bundle

The engine is a patched, pre-built bundle committed to the repo. It began as the
open-source [better-deepseek](https://github.com/EdgeTypE/better-deepseek) extension and
now carries this project's own UI, mobile layouts, Bengali translations and fixes, so
**never overwrite it with an upstream build**. `scripts/bds-sync.sh` can diff it against
upstream in dry-run mode.

Things inside the bundle that deliberately keep their original names:

- the parser still accepts the old `<BetterDeepSeek>` context wrapper and `BDS:` tool tags
  found in older conversations (new messages use `<SuperDeepSeek>` and `SDS:`); stored
  skills, memories and custom prompts are renamed once on first start
  (`sdsRebrandStored`);
- storage keys (`bds_*`) and CSS classes (`bds-*`), so user data survives updates;
- the third-party DeepSeek Harness *Better DeepSeek Bridge* plugin and its endpoints.

## Linux sandbox and the agent

| Piece | Where | Role |
|---|---|---|
| `Sandbox.kt` | native | Alpine minirootfs under `noBackupFilesDir/sandbox`, run through `libproot.so` from `nativeLibraryDir` (Termux proot + its libraries, fetched and SHA-checked by `scripts/fetch_sandbox_deps.py` in CI) |
| `SandboxTools.kt` | native | The MCP-shaped tools: `run`, `job`, `read_file`, `write_file`, `edit_file`, `list_dir`, `install_packages`, `preview`, `export_file`, `status` |
| `SandboxService.kt` | native | Foreground service (`specialUse`) with a Stop action, kept while a command runs **or** the agent loop is active (`AndroidBridge.sandboxAgentActive`) |
| `StudioActivity.kt` | native | Linux Studio: terminal, files (viewer with Preview / Ask the AI / Share / Save), preview, settings; shows the AI's commands and file writes live |
| `StudioPreview.kt` | native | Preview of workspace files at `https://workspace.invalid/<guest path>` (served by `shouldInterceptRequest`, never a real host): folders, HTML with relative assets, Markdown (safe renderer), images, video, audio |
| `StudioSheet.kt` | native | Studio's bottom sheets: slide up, drag down (or fling, tap outside, Back) to dismiss |
| `ShellProtocol.kt` | native | Studio terminal ↔ shell: end-of-command markers (exit code, folder), Run/Stop state |
| `sd-agent.js` | engine | Exposes the sandbox to the engine as MCP server `sandbox`, re-reads exact tool arguments from the chat history, the Stop chip, the "ask" mode, continuity (re-scans a finished reply for missed tool calls and nudges a reply that stopped mid-task, at most twice per user message; switchable), the scroll guard (never pulls a reader who scrolled up back to the bottom), the live sandbox state line in the MCP prompt (`promptContext()` ← `AndroidBridge.sandboxContext()`), and the **Linux & Agent** settings page — its own row on the Advanced settings overview (content.js `sdBuildOverview` → page `linux` → `sdMountLinux` → `__sdAgent.mountSettings`, `#sd-linux-page`; prefs `sd_sandbox_enabled` / `sd_sandbox_mode` / `sd_agent_autocontinue`, shared with Linux Studio; the engine language is mirrored to `sd_ui_locale` so Studio follows it) |
| `sd-sheets.js` | engine | The engine's bottom sheets (+ menu, projects, settings drawer) follow the finger: drag down or fling to dismiss |

The engine does the agent loop itself: the model writes
`<SDS:AUTO:MCP url="sandbox" tool="run">{…}</SDS:AUTO:MCP>`, the engine calls the tool and
sends the result back as the next message. For long tasks the app keeps the renderer at
foreground priority, reloads a page that stops answering after the app returns
(`probePageLiveness`), and after a renderer crash or process restore reopens the same
conversation (`ChatUrls`).

## Slash commands

Typing `/` in the composer opens the command popup.

- Choosing an item only **fills the composer** (`/help `, `/export `…); nothing runs yet.
- A command runs when it is **sent** — Enter on a keyboard, or the send button, which
  is intercepted in the capture phase before DeepSeek's own handler.
- Unknown `/text` is sent to the AI unchanged.
- `/new` and `/compress` switch chats through DeepSeek's own new-chat control, so the
  page is never reloaded (a reload would briefly show the un-enhanced official page).

## Page lifecycle

The engine is injected on every `onPageFinished` of `chat.deepseek.com`. In-app
navigation (DeepSeek is a single-page app) keeps the engine alive; a full reload
re-injects it.

## Launch screen

`BootScreenView` is a single native view drawn on the Canvas, in the chat's own dark
palette: the page's dark background colour (measured on an earlier run and remembered,
see below) with a soft vignette, a slow star field and an occasional faint shooting star,
the app icon with a faint brand-blue glow, and the Sora wordmark. The wordmark **is the
progress indicator**: its letters rise in dim, then fill with light from left to right
while the page loads, with a soft blue glow on the moving edge. The fill approaches 92%
and waits; it only completes when the page is ready. It is timed from its own frame
clock, so it plays even when the user has turned system animations off. The system
splash hands over on the first frame (same colour, icon in the same place).

The screen is released only when the enhanced page is really on screen, never on a
timer alone:

1. `onPageFinished` injects the engine and starts polling `READY_PROBE_JS` every 300 ms.
   The probe needs the engine CSS (`style#bds-css`), a fully-run `content.js`
   (`window.__sdHandleBack`) and a visible composer or sign-in field.
2. The probe must pass **and** `AndroidBridge.onUiPolished()` must have fired, or 3 s must
   have passed since `onPageFinished` if the polish signal never comes.
3. The wordmark fills to the end, a light sweeps across it and the screen fades into
   the chat. A minimum intro of 2 s keeps a fast (cached) launch from cutting the
   animation short.

The hard cap is 18 s (`BOOT_FORCE_DISMISS_MS`), so a stalled network can never trap the
user on the launch screen.

## System bars

The WebView stays inside the safe area (the root layout is padded by the status and
navigation bar insets), so DeepSeek's header buttons keep their position. The strips
behind the bars take the page's own colour, and the bar icons switch between light and
dark for contrast.

The colour is **measured on screen**: `PixelCopy` copies a 2 dp strip just inside the
top and the bottom edge of the page, and the dominant colour of each strip
(`dominantColor`) becomes the status bar and the navigation bar colour (opaque, with the
system contrast scrims turned off). Reading computed CSS is not exact enough, because
DeepSeek paints its header with gradient fade bands and layered surfaces. The bars are
measured again after every touch (drawers, sheets and navigation change the page),
after a light/dark switch (`AndroidBridge.reportTheme()`, which also recolours the bars
at once) and on resume. While the launch screen covers the page, a CSS estimate
(`PAGE_BG_PROBE_JS`) is used and the bars stay transparent over the launch scene.

The measured dark page colour is stored (`sd_ui` preferences), and the next launch
screen is built on it, so the launch screen and the chat share exactly the same
background. It is only stored at trustworthy moments: the fresh page right after the
launch screen, or just after a switch to dark, and never after a touch (an open sheet's
dim scrim must not be mistaken for the page colour).

## Back button

`MainActivity` asks the engine first: it evaluates `window.__sdHandleBack()` (defined at
the end of `content.js`). The helper closes the topmost engine surface — command popup,
dialog, help sheet, or steps a drawer subpage back to the overview — and returns `true`.
Only when it returns `false` does the WebView navigate back (or the app move to the
background on the first page).

## Tests

- Kotlin unit tests: `android/app/src/test/…` (`./gradlew testDebugUnitTest`), run in CI.
- Web workspace checks: `npm run typecheck && npm run test:app`, run in CI.
- CI (`.github/workflows/build-and-release-apk.yml`) builds and verifies a signed release
  APK; failing unit-test reports are uploaded as a workflow artifact.

## Legacy code

`src/` contains the earlier React SPA. It is type-checked and unit-tested in CI but is no
longer part of the APK: the official site is the chat surface. The APK's only web assets
are the engine files staged from `android/app/src/main/bds-assets/bds`.
