# Build instructions (Super DeepSeek 2.71 — one card per agent run)

Toolchain: JDK 17, Android SDK platform 34 + build-tools 34.0.0, Node 20+ (22 in CI).
The version lives in `package.json` and in `android/app/build.gradle.kts`
(`versionName`; `versionCode` is `major*1e6 + minor*1e4 + patch*1e3 + CI build id`).
`npm run test:engine` fails if the two disagree or if a release bump skips the
versionCode step — see `repo-consistency.test.mjs`.

1. `npm ci`
2. `npm test`                         — engine unit tests + compliance-harness self-test
3. `npx playwright install chromium && npm run genui:acceptance`   — 21 GenUI acceptance checks
4. `npm run android:stage-engine`     — copies `android/app/src/main/bds-assets/bds` → `android/app/src/main/assets/bds` (REQUIRED)
5. `python3 scripts/fetch_sandbox_deps.py` — optional Linux sandbox runtime
6. `cd android && ./gradlew testDebugUnitTest` then `./gradlew assembleRelease` (separately on machines with ≤ 2 GB RAM)

Signing: the release key is **not** in the repository (`*.jks` is git-ignored). CI decodes it
from the `BDS_KEYSTORE` Actions secret (base64 of `superdeepseek-release.jks`) and reads
`BDS_KEYSTORE_PASSWORD` / `BDS_KEY_ALIAS` / `BDS_KEY_PASSWORD`. All builds since 2.50 use this key,
so each one installs over the previous one. For a local release build, put the key at
`android/app/superdeepseek-release.jks`. Without the secret or the file, CI generates a throwaway
key and that APK will **not** update an installed app.
To set the secret: Settings → Secrets and variables → Actions → New repository secret,
value = output of `base64 -w0 superdeepseek-release.jks`.

Low-memory machines (2 GB): tests with `./gradlew --no-daemon --max-workers=1 "-Dorg.gradle.jvmargs=-Xmx448m -XX:MaxMetaspaceSize=256m -XX:+UseSerialGC" -Pkotlin.compiler.execution.strategy=in-process -PtestMaxHeap=560m testDebugUnitTest`; release alone with `-Xmx760m`. `GRADLE_OPTS` does not size the build daemon — use `-Dorg.gradle.jvmargs`.

Live MCP check: `npm run genui:mcp-live -- https://mcp.quran.ai interactive_study '{"surah":1}'`.
