/**
 * Ensure the Gradle wrapper for the android/ project is present.
 *
 * The wrapper JAR is a ~40 kB binary that this repository keeps out of git
 * (android/.gitignore ignores `gradle/wrapper/*` except the properties file),
 * so it is fetched on demand from the official Gradle repository. CI does the
 * same thing in .github/workflows. Run this before any ./gradlew invocation:
 *   node scripts/ensure-gradle-wrapper.js
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const androidDir = resolve(__dirname, "..", "android");
const wrapperDir = resolve(androidDir, "gradle", "wrapper");
const jarPath = resolve(wrapperDir, "gradle-wrapper.jar");
const propertiesPath = resolve(wrapperDir, "gradle-wrapper.properties");

// Must stay in sync with android/gradle/wrapper/gradle-wrapper.properties
// (committed) and the CI bootstrap steps in .github/workflows.
//
// Two different version spellings are involved, and conflating them breaks the
// build with a 404 before Gradle even starts:
//   * the git tag in gradle/gradle is `v8.7.0`;
//   * the published distribution asset is `gradle-8.7-bin.zip` — there is no
//     `gradle-8.7.0-bin.zip` (only patch releases such as 8.7.1 carry a third
//     component in their asset name).
const GRADLE_VERSION = "8.7";
const GRADLE_GIT_TAG = "v8.7.0";
const JAR_URL = `https://raw.githubusercontent.com/gradle/gradle/${GRADLE_GIT_TAG}/gradle/wrapper/gradle-wrapper.jar`;

const PROPERTIES = [
  "distributionBase=GRADLE_USER_HOME",
  "distributionPath=wrapper/dists",
  `distributionUrl=https\\://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip`,
  "networkTimeout=10000",
  "validateDistributionUrl=true",
  "zipStoreBase=GRADLE_USER_HOME",
  "zipStorePath=wrapper/dists",
  "",
].join("\n");

/**
 * The exact distribution the properties file must pin. Compared against the
 * whole URL (not just the version fragment) so a stale `gradle-8.7.0-bin.zip`
 * style value can never be mistaken for the correct one.
 */
const EXPECTED_DISTRIBUTION = `services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip`;

function fileSize(p) {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

if (existsSync(propertiesPath)) {
  const current = readFileSync(propertiesPath, "utf8");
  if (!current.includes(EXPECTED_DISTRIBUTION)) {
    console.warn(
      `[ensure-gradle-wrapper] properties file does not pin Gradle ${GRADLE_VERSION} (${EXPECTED_DISTRIBUTION}); rewriting it`,
    );
    writeFileSync(propertiesPath, PROPERTIES, "utf8");
  }
} else {
  mkdirSync(wrapperDir, { recursive: true });
  writeFileSync(propertiesPath, PROPERTIES, "utf8");
  console.log(`[ensure-gradle-wrapper] wrote ${propertiesPath}`);
}

if (fileSize(jarPath) > 0) {
  console.log("[ensure-gradle-wrapper] wrapper jar already present");
  process.exit(0);
}

console.log(`[ensure-gradle-wrapper] fetching Gradle ${GRADLE_VERSION} wrapper jar...`);
mkdirSync(wrapperDir, { recursive: true });

// curl is the bootstrap path (fast, streaming); wget is the fallback.
let result = spawnSync("curl", ["-sSL", "--fail", "--max-time", "120", JAR_URL, "-o", jarPath], {
  stdio: ["ignore", "ignore", "inherit"],
});
if (result.status !== 0 || fileSize(jarPath) === 0) {
  result = spawnSync("wget", ["-q", "--tries=3", "--timeout=60", JAR_URL, "-O", jarPath], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

if (result.status !== 0 || fileSize(jarPath) === 0) {
  console.error("[ensure-gradle-wrapper] failed to download the wrapper jar.");
  console.error(`[ensure-gradle-wrapper] manual fallback: download ${JAR_URL} into ${jarPath}`);
  process.exit(1);
}

console.log(`[ensure-gradle-wrapper] wrapper jar ready (${fileSize(jarPath)} bytes)`);
