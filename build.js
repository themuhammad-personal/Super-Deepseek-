/**
 * Vite build script for the Android app bundle.
 *
 * Builds the three JS worlds the WebView host injects, in order:
 *   1. content.js  — the content script (isolated world; chrome.* is routed
 *                    through the native bridge by src/platform/globals-android.js)
 *   2. injected.js — the MAIN-world script (page-level hooks)
 *   3. sandbox.js  — the safe-eval world (sandboxed code execution)
 *
 * Uses rollupOptions.input (not lib mode) to avoid aggressive tree-shaking
 * that strips side-effect code like event listeners, DOM mutations,
 * and bridge communication.
 *
 * The output is consumed by scripts/copy-to-android-assets.js, which stages it
 * under android/app/src/main/assets/bds/. There is no extension manifest, no
 * background service worker, and no browser ZIP — the APK is the only
 * deliverable.
 */
import { build } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync, readFileSync } from "fs";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Android is the only target. Anything else is a stale invocation.
const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
if (targetArg && targetArg !== "--target=android") {
  console.error(`❌ Unknown target "${targetArg.split("=")[1]}". This project only builds for Android.`);
  process.exit(1);
}
const target = "android";
console.log(`\n🎯 Target: ${target.toUpperCase()}`);

const distFolderName = `dist-${target}`;

// Vite alias for the platform globals entry imported by src/content/index.js.
// On Android this is the chrome.* polyfill that routes through the native
// WebView bridge (window.AndroidBridge).
const platformGlobalsFile = "src/platform/globals-android.js";

const sharedResolve = {
  alias: {
    "bds-platform-globals": resolve(__dirname, platformGlobalsFile),
  },
};

// package.json is the single source of truth for the version.
// android/app/build.gradle.kts carries a copy for Gradle, but the value
// compiled into the bundles always comes from here.
const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8"));

const sharedDefine = {
  "process.env.NODE_ENV": '"production"',
  "process.env.BDS_TARGET": JSON.stringify(target),
  // Read back by src/lib/extension-version.js. Needed on targets with no
  // extension manifest — the Android WebView shell has no getManifest().
  __BDS_VERSION__: JSON.stringify(pkg.version),
};

/** @type {Array<import('vite').InlineConfig>} */
const builds = [
  // ── Content Script ──
  {
    plugins: [svelte()],
    resolve: sharedResolve,
    esbuild: {
      charset: "ascii",
    },
    build: {
      emptyOutDir: true,
      outDir: resolve(__dirname, distFolderName),
      rollupOptions: {
        input: resolve(__dirname, "src/content/index.js"),
        output: {
          format: "iife",
          entryFileNames: "content.js",
          assetFileNames: "content.[ext]",
          inlineDynamicImports: true,
        },
        // Preserve all side-effect code (bridge events, DOM mutations, etc.)
        treeshake: false,
      },
      cssCodeSplit: false,
      minify: true,
      sourcemap: false,
    },
    define: sharedDefine,
  },

  // ── Injected Script (MAIN world) ──
  {
    plugins: [],
    resolve: sharedResolve,
    esbuild: {
      charset: "ascii",
    },
    build: {
      emptyOutDir: false,
      outDir: resolve(__dirname, distFolderName),
      rollupOptions: {
        input: resolve(__dirname, "src/injected/index.js"),
        output: {
          format: "iife",
          entryFileNames: "injected.js",
          inlineDynamicImports: true,
        },
        treeshake: false,
      },
      minify: true,
      sourcemap: false,
    },
    define: sharedDefine,
  },

  // ── Sandbox Script (Safe Eval World) ──
  {
    plugins: [],
    resolve: sharedResolve,
    esbuild: {
      charset: "ascii",
    },
    build: {
      emptyOutDir: false,
      outDir: resolve(__dirname, distFolderName),
      rollupOptions: {
        input: resolve(__dirname, "src/sandbox/index.js"),
        output: {
          format: "iife",
          entryFileNames: "sandbox.js",
          inlineDynamicImports: true,
        },
        treeshake: false,
      },
      minify: true,
      sourcemap: false,
    },
    define: sharedDefine,
  },
];

async function run() {
  for (const config of builds) {
    await build({ ...config, configFile: false });
  }

  // Copy static folder to dist (loading.html etc.) — everything except the
  // extension manifest (gone) and sandbox.html (copied to the dist root).
  console.log(`📂 Copying static assets to ${distFolderName}...`);
  const distDir = resolve(__dirname, distFolderName);
  const staticSrc = resolve(__dirname, "static");
  const staticDest = resolve(distDir, "static");

  function copyRecursiveSync(src, dest) {
    if (statSync(src).isDirectory()) {
      if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
      readdirSync(src).forEach((childItem) => {
        copyRecursiveSync(resolve(src, childItem), resolve(dest, childItem));
      });
    } else {
      copyFileSync(src, dest);
    }
  }

  if (existsSync(staticSrc)) {
    try {
      if (!existsSync(staticDest)) mkdirSync(staticDest, { recursive: true });
      readdirSync(staticSrc).forEach((item) => {
        if (item === "sandbox.html") return;
        copyRecursiveSync(resolve(staticSrc, item), resolve(staticDest, item));
      });
    } catch (e) {
      console.warn("Static copy warning:", e.message);
    }
  }

  // Copy sandbox.html to the dist root (the Android iframes load it from
  // the same path as the bundles).
  copyFileSync(
    resolve(__dirname, "static/sandbox.html"),
    resolve(distDir, "sandbox.html")
  );

  console.log("\n🧹 Cleaning non-ASCII characters from bundle...");
  try {
    execSync(`node scripts/sanitize-dist.js --target=${target}`, { stdio: "inherit" });
  } catch (e) {
    console.error("Sanitization failed:", e.message);
  }

  console.log(`\n✅ Build complete. Output ready in ${distFolderName}/`);
  console.log(`${new Date(Date.now()).toLocaleString()}`);
  console.log(`\nℹ️  Next: npm run build:android stages the bundle into android/app/src/main/assets/bds/ via scripts/copy-to-android-assets.js`);
}

run().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
