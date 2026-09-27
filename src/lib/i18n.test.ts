import assert from "node:assert/strict";
import test from "node:test";
import { dictionaries, t } from "./i18n.ts";

test("en and bn dictionaries expose the same keys", () => {
  const walk = (obj: unknown, prefix = ""): string[] => {
    if (!obj || typeof obj !== "object") return prefix ? [prefix] : [];
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      typeof v === "string" ? [`${prefix}${k}`] : walk(v, `${prefix}${k}.`),
    );
  };
  assert.deepEqual(walk(dictionaries.en).sort(), walk(dictionaries.bn).sort());
});

test("t interpolates variables and nested keys", () => {
  assert.equal(t("en", "thoughtFor", { n: 3 }), "Thought for 3s");
  assert.equal(t("en", "suggestions.code").length > 8, true);
  assert.equal(t("bn", "appName"), "Super DeepSeek");
  assert.equal(t("en", "missing.key"), "missing.key");
});

test("guest and login copy exist", () => {
  assert.match(t("en", "exploreWorkspace"), /Explore/);
  assert.match(t("bn", "exploreWorkspace"), /ওয়ার্কস্পেস/);
  assert.match(t("en", "signInToSend"), /DeepSeek/);
});
