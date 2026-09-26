# Better DeepSeek

**Better DeepSeek** is a standalone Android app that turns [chat.deepseek.com](https://chat.deepseek.com) into a fully-featured, power-user chat client. The app opens the official DeepSeek web interface in a WebView and layers the complete Better DeepSeek enhancement suite on top of it — hidden prompts, tool tags, Deep Research, DeepCode, MCP tools, document generation, voice, and more — delivered natively, with no browser extension involved.

Everything runs on the real `chat.deepseek.com` service: your account, your conversations, DeepSeek's models. The app only adds the enhancement layer and its native bridge.

## Features

All features below are implemented in `src/content/` and available in the Android app:

### Prompt engineering
- **Hidden system prompt** — a private system prompt prepended to your requests (Settings → Prompt).
- **Tool tags** — `BDS:` tags in the chat steer DeepSeek's output (`<BDS:chart>`, `<BDS:CODE:RUN>`, search tags, …) with tag editing, hiding, and validation ([`src/content/tags/`](src/content/tags/)).
- **Prompt presets & snippets** — reusable prompt libraries and snippet collections (Settings).

### Research & long-running work
- **Deep Research** — plan-driven multi-step research with reports, revisions, and step tracking ([`src/content/deep-research.js`](src/content/deep-research.js)).
- **Long Work mode** — long-task orchestration with a dedicated overlay ([`src/content/files/long-work.js`](src/content/files/long-work.js)).
- **Message queue** — queue follow-up messages and send them in order.

### Code
- **Code runner** — sandboxed execution of code blocks with result cards ([`src/content/ui/CodeRunner.svelte`](src/content/ui/CodeRunner.svelte), backed by the `sandbox.js` eval world).
- **Auto code** — `<BDS:AUTO:CODE>` tags run code automatically ([`src/content/auto.js`](src/content/auto.js)).
- **DeepCode (experimental)** — link a local directory into the session and run it through the local **DeepSeek Harness** (workspace lookup, session creation, prompt queueing over the local ApiProxy) ([`src/content/deep-code.js`](src/content/deep-code.js), [`HarnessClient.kt`](android/app/src/main/java/com/betterdeepseek/app/HarnessClient.kt)).
- **MCP (Model Context Protocol) tools** — connect any MCP server, auto-discover its tool schemas, and call tools from chat ([`McpClient.kt`](android/app/src/main/java/com/betterdeepseek/app/McpClient.kt)).

### Generative output
- **Documents** — Word (`.docx`), Excel (`.xlsx`) and PowerPoint (`.pptx`) generation with download cards ([`DocxCard`](src/content/ui/DocxCard.svelte) / [`ExcelCard`](src/content/ui/ExcelCard.svelte) / [`PptxCard`](src/content/ui/PptxCard.svelte)).
- **Interactive charts** — Vega / Vega-Lite visualizer cards with feedback ([`VisualizerCard`](src/content/ui/VisualizerCard.svelte)).
- **Image output** — rendered image cards with download.

### Knowledge & context
- **Persistent memory** — curated memory entries the model can use, with import/export ([`MemoryList`](src/content/ui/MemoryList.svelte)).
- **Skills & snippets** — reusable skill definitions and code snippets.
- **Personas (characters)** — named persona profiles for consistent behavior ([`CharacterList`](src/content/ui/CharacterList.svelte)).
- **Reader integrations** — YouTube transcripts (fetched natively, [`YouTubeTranscript.kt`](android/app/src/main/java/com/betterdeepseek/app/YouTubeTranscript.kt)), web articles (Readability), web search results, Twitter/X threads, GitHub repos and commit history, and local folders ([`src/content/files/`](src/content/files/)).
- **Projects** — project manager with per-project context ([`src/content/project-manager.js`](src/content/project-manager.js)).
- **Load all history** — pull the full conversation history of a chat into context.
- **Context budget** — per-feature context usage budgeting.
- **Attach menu** — attach files, folders, links and more directly into the chat.

### App experience
- **Voice** — speech-to-text mic input (browser STT with VAD preprocessing) and text-to-speech playback.
- **Themes** — dark / light / system, in sync with the page.
- **Localization** — English, Persian (Farsi), Russian, Turkish, and Simplified Chinese, with **runtime language updates** fetched from the repository ([`RemoteDataSync.kt`](android/app/src/main/java/com/betterdeepseek/app/RemoteDataSync.kt)) — no app update needed for new translations.
- **DeepSeek status monitor** — live service status banner.
- **API playground** — build, send and inspect DeepSeek API requests from the drawer, with presets and history.
- **Export / import** — export chats as Markdown/JSON and export/import all settings.
- **Announcements** — project announcements delivered through the remote status feed.
- **In-app update checking** — checks GitHub Releases for newer builds (Settings).

## Download & install

Releases are published to [GitHub Releases](https://github.com/EdgeTypE/better-deepseek/releases):

- **Latest build** — the `latest` pre-release is updated on every push to `main`. Best for trying the newest changes.
- **Versioned releases** — tagged builds (`v*`) are stable releases.

To install an APK:

1. Download the `better-deepseek-android-…-signed.apk` from the release.
2. On your phone, open the downloaded file. If prompted, allow **Install unknown apps** for your browser/file manager.
3. Confirm the installation and launch **Better DeepSeek**.
4. Open [chat.deepseek.com](https://chat.deepseek.com) (or tap an existing DeepSeek link — the app handles `chat.deepseek.com` deep links) and sign in as usual.

The APK is **digitally signed**; if you update from an older build installed with the same key, the update replaces it in place.

## Building from source

### Prerequisites

- **Node.js 20+**
- **JDK 17** (Temurin recommended)
- **Android SDK** (platform 34, build-tools 34.0.0) — the wrapper JAR is fetched automatically on first Gradle run

### Build

```bash
# 1. Install JS dependencies
npm ci

# 2. Build the web bundle and stage it into android/app/src/main/assets/bds/
npm run build:android

# 3. Build the debug APK
npm run android:assemble:debug
#    (equivalent to: cd android && ./gradlew assembleDebug)
```

The debug APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`.

Install it with `adb install android/app/build/outputs/apk/debug/app-debug.apk`.

### Run the test suites

```bash
npm run test:unit          # 1,400+ Vitest unit/integration tests
npm run test:e2e:android   # Playwright Android WebView simulator suite
npm run android:test       # Kotlin unit tests (./gradlew test)
```

See [TESTING.md](TESTING.md) for details and [LOCALIZATION.md](LOCALIZATION.md) for adding a language.

## Project structure

```
├── src/
│   ├── content/        # the enhancement suite (Svelte 5 UI, readers, tags, …)
│   ├── injected/       # MAIN-world script (page-level hooks)
│   ├── sandbox/        # safe-eval world for the code runner
│   ├── platform/       # globals-android.js → window.AndroidBridge polyfill
│   └── locales/        # en, fa, ru, tr, zh-cn translation files
├── static/             # loading UI + sandbox.html
├── remote/             # pricing / remote-config / status feeds (published JSON)
├── scripts/            # build helpers (asset staging, wrapper bootstrap, sanitizing)
├── tests/              # Vitest suites + Android WebView simulator (Playwright)
├── docs/               # reasoning notes, privacy policy, remote-config docs
└── android/
    ├── app/src/main/java/com/betterdeepseek/app/
    │   ├── MainActivity.kt      # WebView shell, injection lifecycle, deep links
    │   ├── WebViewBridge.kt     # window.AndroidBridge (storage, fetch, downloads,
    │   │                        #   picker, theme + all former background handlers)
    │   ├── ApiProxyClient.kt    # native DeepSeek API proxy (API Playground)
    │   ├── McpClient.kt         # native MCP JSON-RPC client
    │   ├── YouTubeTranscript.kt # native YouTube transcript fetching
    │   ├── RemoteDataSync.kt    # locale / remote-config / status persistence
    │   ├── HarnessClient.kt     # DeepSeek-Harness (loopback) bridge
    │   └── UpdateChecker.kt     # GitHub Releases update checking
    └── app/src/main/assets/bds/ # generated bundle (git-ignored)
```

## Release process

[`.github/workflows/release.yml`](.github/workflows/release.yml) handles publishing:

| Trigger | Artifact | Release |
|---|---|---|
| Push to `main` | `better-deepseek-android-latest-signed.apk` | `latest` (pre-release) |
| Push to a `v*` tag | `better-deepseek-android-v<version>-signed.apk` | versioned release |
| Manual dispatch (`gh workflow run release.yml --ref <branch>`) | same APK, uploaded as the `better-deepseek-android-signed-apk` workflow artifact | — (no release) |

Steps in the workflow: `npm ci` → `build:android` → staged-asset verification → `assembleRelease` (signed with the `BDS_KEYSTORE` secret, `-PbdsBuildId=<run number>`, which becomes `BuildConfig.BUILD_ID`) → `apksigner verify` → publish via `softprops/action-gh-release`. The `latest` release body carries the matching `<!-- bds-build-id: <run number> -->` marker that the in-app beta updater parses. The app's in-app update checker reads these same releases (`/releases/latest` for stable, `/releases/tags/latest` for the beta channel).

Bumping the version: update `version` in [`package.json`](package.json) (it drives the bundle) and the version fields in [`android/app/build.gradle.kts`](android/app/build.gradle.kts) (they drive the APK), then push the tag.

## Development notes

- The content script uses **Svelte 5** for reactive UI; the injected script patches `window.fetch` / `XMLHttpRequest` for outgoing chat-completion requests.
- All data (settings, skills, memories, characters) is stored locally on the device (WebView localStorage + native SharedPreferences — the two stores are kept in sync by the bridge).
- The app is non-intrusive by design: it only adds host containers next to messages and hides original markdown when tool tags are present.
- Audit notes for the browser-extension → Android conversion live in [`docs/REASONING-NOTES.md`](docs/REASONING-NOTES.md).

## Privacy

Better DeepSeek does not collect, transmit, or sell any personal data. All settings, memories, skills, and characters are stored locally on your device. If you configure a GitHub personal access token for private repository support, it is stored locally and only sent to GitHub when you explicitly fetch a repository. See the full [Privacy Policy](docs/PRIVACY.md) for details.

## License

[MIT](LICENSE) © Çağrı DÜRÜ
