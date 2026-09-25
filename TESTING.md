# Testing

## Test stack

- `Vitest` drives unit and integration coverage.
- `jsdom` is used for DOM-bound module and Svelte component tests.
- `Playwright` runs the Android WebView simulator parity suite against the built
  `dist-android/` bundle (mobile Chromium context + a JS mock of
  `window.AndroidBridge` — no device or emulator required).
- `Gradle` runs the Kotlin unit tests and APK assembly for the Android shell.
- The chrome.* surface is mocked centrally in [tests/mocks/chrome.js](tests/mocks/chrome.js)
  (backed by [tests/mocks/manifest.json](tests/mocks/manifest.json)).

## Commands

```bash
npm run build:android     # build dist-android/ + stage assets into android/
npm run test:unit         # Vitest unit + integration suite
npm run test:e2e:android  # Playwright Android WebView simulator suite
npm run android:test              # Kotlin unit tests (./gradlew test)
npm run android:assemble:debug    # debug APK (./gradlew assembleDebug)
npm run test:android      # build:android + test:e2e:android
npm run test:ci:android   # the exact Android CI job, locally
npm test                  # build (pretest) + unit + Android simulator suite
```

Useful variants:

- `npm run test:watch` runs Vitest in watch mode.
- `npm run test:ui` opens the Vitest UI.
- `npm run test:ci:android` mirrors the Android GitHub Actions job
  (build → asset check → simulator suite → Kotlin tests → debug APK).

## Suite layout

- Unit tests live next to the source file when the module is mostly pure.
- Integration tests live under `tests/integration/`.
- Android simulator E2E tests live under `tests/e2e-android/`.
- Shared DOM helpers live under `tests/helpers/`.
- The mock DeepSeek page lives at `tests/fixtures/mock-deepseek.html`.
- Kotlin unit tests live under `android/app/src/test/`; instrumentation tests
  under `android/app/src/androidTest/`.

## Vitest conventions

- Keep tests independent. Reset mutable state in `beforeEach`.
- Use the AAA pattern.
- Prefer `vi.mock(...)` over source edits when isolating dependencies.
- For Svelte 5 components, mount via `mount()` through [tests/helpers/svelte.js](tests/helpers/svelte.js).
- If a test touches browser-extension APIs, extend the shared chrome mock
  instead of creating one-off mocks.

## Playwright workflow (Android WebView simulator)

1. Build the Android bundle first with `npm run build:android`.
2. Playwright loads the shared mock DeepSeek fixture in a mobile Chromium
   context (Pixel 5 viewport).
3. `tests/e2e-android/helpers/android.js` installs a JS mock of
   `window.AndroidBridge` before the app bundle runs, so the exact
   `dist-android/` code paths execute against the same contract the native
   bridge implements.
4. The suite verifies Android-specific platform gating, download routing,
   storage persistence, and folder-payload reassembly without a device farm.

## Kotlin tests

- JVM unit tests (`android/app/src/test/`) run with `./gradlew test` (via
  `npm run android:test`). HTTP-dependent tests use `MockWebServer` and an
  in-memory `SharedPreferences` double — no device, no network.
- Instrumentation tests (`android/app/src/androidTest/`) require an emulator or
  device and are run manually / in CI when a device is available:
  `./gradlew connectedAndroidTest`.

## CI

- GitHub Actions runs two jobs: **Unit tests** and **Android**.
- The unit job runs `npm ci` + `npm run test:unit` and uploads coverage.
- The Android job: `npm ci` → `build:android` → staged-asset verification →
  `test:e2e:android` → Kotlin unit tests → `assembleDebug`, uploading the debug
  APK, Playwright reports, and Kotlin test results.
- Releases (`.github/workflows/release.yml`) build the **signed** release APK
  on every push to `main` (published to the `latest` pre-release) and on every
  `v*` tag (published as a versioned release), verifying the signature with
  `apksigner` before publishing.
