import assert from "node:assert/strict";
import test from "node:test";
import { artifactSrcDoc, extractArtifacts } from "./artifacts.ts";

test("extractArtifacts pulls substantial HTML/SVG fences", () => {
  const md = [
    "Intro",
    "```html",
    "<!DOCTYPE html><html><body><h1>Hello dashboard</h1><p>Charts go here.</p></body></html>",
    "```",
    "```js",
    "console.log(1)",
    "```",
    "```svg",
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
    "```",
  ].join("\n");
  const arts = extractArtifacts(md);
  assert.equal(arts.length, 2);
  assert.equal(arts[0]?.language, "html");
  assert.equal(arts[1]?.language, "svg");
});

test("artifactSrcDoc wraps fragments", () => {
  const html = artifactSrcDoc({
    id: "a",
    title: "t",
    language: "html",
    code: "<div>hi</div>",
  });
  assert.match(html, /<!doctype html>/i);
  const svg = artifactSrcDoc({
    id: "b",
    title: "g",
    language: "svg",
    code: '<svg viewBox="0 0 10 10"></svg>',
  });
  assert.match(svg, /place-items:center/);
});
