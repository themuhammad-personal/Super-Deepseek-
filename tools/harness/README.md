# Super DeepSeek Engine Harness — Layer 2 (real Chromium)

This harness runs the real engine bundle (`content.js`, `sd-agent.js`, etc.) inside Chromium via `puppeteer-core` (and `@sparticuz/chromium` on CI where no system Chrome exists).

**Why:** Unit tests mock the DOM, but DeepSeek ships new hashed class names (`div.ds-message._63c77b1`, etc.) often. The harness catches DOM-drift before users do.

## What it does

- intercepts `https://chat.deepseek.com/*` and serves a fixture page (see `android/app/src/test/fixtures/deepseek-realistic.html`)
- injects the engine files in exactly MainActivity's order:
  1. `injected.js` (network hooks)
  2. `content.css` + `our-skin.css` as `style#bds-css`
  3. `content.js` (UI + logic)
  4. `sd-native.js` + `sd-agent.js` + `sd-sheets.js`
- provides a fake `AndroidBridge` with in-memory `chrome.storage`-like store and scriptable `sandboxInfo`, `fetch`, `openStudio`

## Scenarios covered

- agent task end-to-end (each tool call exactly once)
- no re-run after reload / remount / scroll
- scroll-up during streaming is respected
- keep-going stops after 2 nudges
- quiet sends
- slash popup + command sheet
- settings pages (Linux card only on its own page)
- light/dark
- Bengali, Arabic, mixed text (bidi)
- touch drag on sheets

## Running locally

```bash
npm install --prefix tools/harness
node tools/harness/run.mjs --fixture android/app/src/test/fixtures/deepseek-realistic.html
```

On CI it runs as a report job (`engine-harness` in build-and-release-apk.yml) and uploads screenshots to artifacts (never committed).

See `run.mjs` for TODOs and the fake bridge implementation.
