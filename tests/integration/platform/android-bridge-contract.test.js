/**
 * Cross-language contract tests: every bridge call the JavaScript side makes
 * must exist on the Kotlin side.
 *
 * The Android port replaced the extension's background service worker with
 * `WebViewBridge.fetch(...)` in Kotlin. A message type that JS sends but Kotlin
 * never dispatches fails at runtime with "Unsupported bridge message type" —
 * silently, and only when the user reaches that feature. That is exactly how
 * the API Playground (`bds-api-proxy`) shipped broken: the handler existed in
 * `src/background/api-proxy.js` and was deleted with the background folder
 * while `api-store.svelte.js` kept sending the message.
 *
 * These tests are static (no device, no emulator): they read the sources and
 * compare the two halves of the contract, so a future port cannot drop a
 * handler again without failing `npm run test:unit`.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC_DIR = path.resolve(ROOT, "src");
const BRIDGE_KT = path.resolve(
  ROOT,
  "android/app/src/main/java/com/betterdeepseek/app/WebViewBridge.kt",
);
const SHIM_JS = path.resolve(ROOT, "src/platform/android-bridge-shim.js");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = fs.statSync(full);
    if (stats.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// Shipped sources only: co-located *.test.js files use throwaway message types.
const jsFiles = walk(SRC_DIR).filter(
  (file) => /\.(js|svelte)$/.test(file) && !/\.test\.js$/.test(file),
);

/** `{ type }` values passed to `chrome.runtime.sendMessage(...)`. */
function collectJsMessageTypes() {
  /** @type {Map<string, string[]>} */
  const found = new Map();
  for (const file of jsFiles) {
    const text = fs.readFileSync(file, "utf8");
    const call = /sendMessage\s*\(/g;
    let match;
    while ((match = call.exec(text)) !== null) {
      // The payload literal always follows the call parenthesis closely.
      const window = text.slice(match.index, match.index + 400);
      const type = window.match(/type:\s*["']([^"']+)["']/);
      if (!type) continue;
      const relative = path.relative(ROOT, file);
      found.set(type[1], [...(found.get(type[1]) ?? []), relative]);
    }
  }
  return found;
}

/** `"some-type" -> handler(...)` branches of the Kotlin `when` dispatch. */
function collectKotlinMessageTypes() {
  const text = fs.readFileSync(BRIDGE_KT, "utf8");
  const whenIndex = text.indexOf('when (val type = payload.optString("type"))');
  expect(whenIndex, "WebViewBridge.fetch must dispatch on payload.type").toBeGreaterThan(-1);

  const elseIndex = text.indexOf("else ->", whenIndex);
  expect(elseIndex, "the dispatch must keep a catch-all else branch").toBeGreaterThan(whenIndex);

  const block = text.slice(whenIndex, elseIndex);
  const types = new Set();
  for (const match of block.matchAll(/^\s*"([^"]+)"\s*->/gm)) {
    types.add(match[1]);
  }
  return types;
}

/** `AndroidBridge.method(...)` names used anywhere in the JS sources. */
function collectJsBridgeMethods() {
  /** @type {Map<string, string[]>} */
  const found = new Map();
  for (const file of jsFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/AndroidBridge\??\.([A-Za-z_$][\w$]*)/g)) {
      const relative = path.relative(ROOT, file);
      found.set(match[1], [...(found.get(match[1]) ?? []), relative]);
    }
  }
  return found;
}

/** `@JavascriptInterface fun name(...)` declarations in WebViewBridge.kt. */
function collectKotlinBridgeMethods() {
  const text = fs.readFileSync(BRIDGE_KT, "utf8");
  const methods = new Set();
  for (const match of text.matchAll(/@JavascriptInterface\s+fun\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    methods.add(match[1]);
  }
  return methods;
}

describe("chrome.runtime.sendMessage contract (JS -> Kotlin WebViewBridge.fetch)", () => {
  const jsTypes = collectJsMessageTypes();
  const kotlinTypes = collectKotlinMessageTypes();

  it("finds message types on both sides of the bridge", () => {
    expect(jsTypes.size).toBeGreaterThan(5);
    expect(kotlinTypes.size).toBeGreaterThan(5);
  });

  it.each([...jsTypes.keys()].sort())(
    "handles the %s message type in WebViewBridge.kt",
    (type) => {
      expect(
        kotlinTypes.has(type),
        `src sources send "${type}" (from ${jsTypes.get(type).join(", ")}) but ` +
          `WebViewBridge.fetch has no "${type}" branch — it would answer ` +
          `"Unsupported bridge message type" at runtime`,
      ).toBe(true);
    },
  );

  it("keeps the API Playground proxy wired end to end", () => {
    // Regression guard for the deleted src/background/api-proxy.js handler.
    expect(jsTypes.has("bds-api-proxy")).toBe(true);
    expect(kotlinTypes.has("bds-api-proxy")).toBe(true);
  });
});

describe("window.AndroidBridge contract (JS -> Kotlin @JavascriptInterface)", () => {
  const jsMethods = collectJsBridgeMethods();
  const kotlinMethods = collectKotlinBridgeMethods();

  it("declares every JS-used method on the Kotlin bridge", () => {
    expect(jsMethods.size).toBeGreaterThan(5);
    for (const [method, files] of jsMethods) {
      expect(
        kotlinMethods.has(method),
        `AndroidBridge.${method}() is called from ${files.join(", ")} but is not a ` +
          `@JavascriptInterface method on WebViewBridge`,
      ).toBe(true);
    }
  });

  it("documents the same method list in android-bridge-shim.js", () => {
    const shim = fs.readFileSync(SHIM_JS, "utf8");
    for (const method of kotlinMethods) {
      expect(
        shim.includes(`${method}(`),
        `android-bridge-shim.js should document AndroidBridge.${method}()`,
      ).toBe(true);
    }
  });
});
