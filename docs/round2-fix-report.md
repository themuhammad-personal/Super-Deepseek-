# Round-2 fix report — locale outage, tap targets, cold launch, composer evidence

Branch `arena/01a0d81f-super-deepseek` · base `main` @ `f4a8348`
Commits: `e928145` (settings scope split) → `d081afa` (locale-proof native menu
handling + banner) → `2a766f3` (autocomplete × composer + reveal gate) →
`5f7e1f2` (locale-proof action-row detection).

Everything below was reproduced, fixed and verified in this repository. The
Android build and its Kotlin tests run in GitHub Actions (no JDK/Android SDK in
the sandbox); the generated APKs are attached to those runs.

---

## 1. B.1 — account/chat menu injection: dead in every non-English locale

**Symptom (reported).** On Bengali the account popover showed only
`Settings / Report issue / Download mobile App / Log out`; no *Plugins*, no
*Advanced Settings*, and the chat-row menu had no *Tags* / *Export*.

**Cause.** `SidebarMenuInjector.js` decided which popover it was looking at by
matching **English labels** (`ACCOUNT_MENU_SETTINGS_LABELS`,
`ACCOUNT_MENU_LOGOUT_LABELS`, `CHAT_MENU_LABELS`, …). DeepSeek translates every
one of those labels, so `isAccountMenu()` / `isChatContextMenu()` returned false
for any other UI language and *nothing* was injected.

**Fix.** Tiered, locale-independent detection (the same shape as
`scanner.js::isDeepThinkControl`):

| Tier | Signal | Why it cannot be translated away |
| --- | --- | --- |
| T1 | trigger context captured on `mousedown` (`classifyMenuTrigger`): chat-row three-dot lives in/near `a[href*="/chat/s/"]`, the account row is the sidebar control that renders the avatar (2 s memory, `getLastMenuTriggerKind()`) | structural |
| T2 | popover structure: avatar image, `*avatar*/*user*/*profile*/*account*` hooks, or the account e-mail | structural |
| T3 | English labels | documented fallback only |

A `chat` T1 hit vetoes the account test, so BDS rows can never land in the wrong
popover. Tags/Export insertion uses the destructive row (or the last native row)
instead of the English word "Delete".

**Verified.** 8 new unit tests across Bengali and Japanese (structure path and
trigger path), plus 2 new Android E2E tests driving `?lang=bn` end to end.

## 2. B.2 — "Official Settings" label, in every locale

`injectSettingsDrawerOptions()` now relabels the **first** native entry to
`t('sidebarMenu.officialSettings')` — the key already exists in all five shipped
locales (en/fa/ru/tr/zh-cn) — by replacing only the
`.ds-dropdown-menu-option__label` text node and marking the row with
`data-bds-official-settings`.

The check re-runs on **every** scan (MutationObserver, backup click scan) because
React re-renders the popover on each open and restores the native text; a unit
test removes the label and proves the next scan reinstates it.

Extra native entries are hidden **positionally** (`data-bds-hidden-entry` on
everything between the first entry and the last one, plus the CSS rule appended
to `content.css`), so the popover ends up as exactly
**Plugins / Advanced Settings / Official Settings / Log out** in any language —
without matching a single translated word. The user's own block (avatar, name,
e-mail) is never relabelled or hidden.

## 3. B.3 — `/` autocomplete visible but not tappable

**Cause.** On a touch screen the editor blurred as the finger landed on a list
item; `handleBlur()` set `isOpen = false`, Svelte unmounted the `{#if isOpen}`
block — including the button being tapped — before `click` was dispatched.

**Fix (`Autocomplete.svelte`).**
* `mousedown` inside the dropdown calls `preventDefault()` → the editor keeps
  focus, the list is never unmounted mid-gesture.
* `blur` is deferred by 150 ms and cancelled by any pointer/touch press inside
  the list (covers browsers that blur on `touchstart`).
* Touch/pen presses never `preventDefault()` (that could swallow the synthesised
  click) — the deferred blur is what protects them.
* Escape, plain blur and `selectCurrent()` branching are unchanged.

**Verified.** The new test replays the real **mousedown → blur → click** order,
asserts `defaultPrevented === true`, that the list is still mounted when the
click arrives, and that the command actually executed (`bds:show-help` fired,
dropdown closed). A second test cancels a pending blur with a `pointerdown`.

## 4. B.4 — dead `×` in the Command Manager

`CommandManager.svelte` declared `let { onClose } = $props()` while
`Drawer.svelte` passes `onclose={…}`; Svelte 5 props are case-sensitive, so the
handler was `undefined`.

**Fix.** The prop is now `onclose` (the dominant convention: `Drawer`,
`DeepCodeModal`, `AddDirectoryModal`, `ConfirmDialog`), called defensively.
**Verified.** New `CommandManager.test.js`: the real prop invokes the callback,
the old camelCase spelling does not, and a missing callback does not throw.

## 5. B.5 — scope split, behaviour unchanged

* **Advanced Settings** = System Prompts + the **Skill Set** library (moved in
  from the drawer) → `#bds-save-settings`, `#bds-section-system-prompts`,
  internal `#bds-section-skills`.
* **Plugins** = all ten subsections (Language, Chat, Projects, Injection,
  Research, Voice, Integrations, CSS, **MCP**, Utilities) with its own
  `#bds-save-plugins`, the settings search, import/export and the combined
  unsaved-change guard.
* `Drawer.svelte` renders each surface once (`#bds-skill-upload` count 1),
  routes `refreshSkills()` → AdvancedSettings and
  `refreshProject()`/`refreshCssSnippets()` → PluginsSettings.
* Saving one screen never rewrites the other's fields (asserted).

## 6. B.6 — five composer icons evenly spaced

The shared action-row wrapper gets `data-bds-icon-row` and an inline
`flex / space-between / gap 8px / width 100%` rule **with `!important`**, so a
React re-render that rewrites `style` cannot win. The expand-toggle and
RAG-preview mounts were moved out of the row into the composer container, and
the BDS mounts' own horizontal margins are neutralised — that margin (6 px on
the upload wrapper) was what made equal flex distribution look uneven. Android
only (`isAndroidWebView()` from the new `src/lib/platform.js`).

**Verified.** Unit tests (marker + priorities, desktop untouched, and a guard
that refuses to restyle a container that also holds the editor) and an E2E test
that measures the five real icon boxes and asserts equal gaps in locked order
`plus → deep-think → web-search → deep-research → send`.

## 7. B.7 — no native UI before BDS is ready

* `MainActivity` creates the WebView `INVISIBLE` and re-hides it on every
  `chat.deepseek.com` `onPageStarted`.
* New `AndroidBridge.uiReady()` (`WebViewBridge.uiReady()` → `onUiReady`)
  is called by `src/android/ui-ready.js` two animation frames after the first
  scan (`src/content/index.js`), i.e. after BDS mounted and after the hide
  rules ran.
* New `WebViewRevealGate` reveals the view once, logs the reason, and carries a
  **2.5 s safety timeout** so a broken bundle can never leave a blank screen;
  `cancel()` on destroy.
* All existing lifecycle logic (insets, cookies, UA metadata, pickers, updates,
  popup handling) is untouched.

**Verified.** Robolectric `WebViewRevealGateTest` (9 cases: reset hides, signal
reveals, idempotence, timeout, no early timeout, late signal, re-arm per
navigation, cancel, detached view) + a bridge test, all of which run in CI's
`android:test` task; the Android E2E suite asserts exactly one signal per page
load and that the hidden native banner was already hidden when it fired.

## 8. C.1 — composer order after a language switch: **root cause found**

Diagnosis-first, as instructed. The new `[BDS:Composer]` instrumentation captured
this on a Bengali page:

```
[BDS:Composer] deep-research wrapper = fallback (no native action row found)
[BDS:Composer] anchors {"nativeActionRow":false, "plusAnchor":"<div.native-attach-btn "আপলোড">", …}
```

`findNativePromptActionRow()` identified the row **only** through
`isDeepThinkControl()`, whose last resort was the English words
"deepthink"/"deep think". With a translated label no control matched, no native
action row was found, the anchors degraded to the composer wrapper and the
locked order changed — the exact screenshot the round was opened with.

**Fix (no blind rewrite).** `isDeepThinkControl()` is now tiered —
T1 `.ds-toggle-button` (DeepSeek's own toggle class), T2 the documented SVG
path, T3 toggle semantics (`aria-pressed` / `role="switch"`, accepted only when
the resolved row also owns the send cluster), T4 the English label — and the row
can additionally be derived from the **send cluster alone**
(`findPromptActionRowBySendCluster`), which is entirely structural. The toggle
path still prefers a row containing Send, but keeps its previous behaviour for
layouts where Send is in its own cluster (no regression).

**Verified.** Two E2E tests — the Bengali page, and a live
`rerenderComposerForLanguage("bn")` that mimics React dropping the BDS mounts
and rebuilding the toggles with translated labels — both assert the restored
locked order and that the control was recognised structurally. On-device the
same evidence is available with `localStorage.setItem("bds:devlog","true")` plus
`chrome://inspect`.

## 9. C.2 — Command / Project cards

`openCommandScope` / `openProjectPanel` were **not** touched. A fresh build was
tested first (your APK predates the drawer rewrite), and both cards work: two new
E2E tests open the upload drawer, click **Command** (the command list renders
from the live registry, a command inserts `/…` into the editor and the drawer
closes) and **Project** (the project panel opens with the seeded project
selectable). Both tests fail if any application console error or page error
occurs — none did. The earlier symptom was a stale APK, not a code defect.

## 10. D — native top app-download banner, hidden in every locale

`hideGetAppButton()` previously matched the exact English string "Get App", so
the banner survived any other UI language. Detection is now tiered:
T1 a store/APK link (`play.google.com`, `market://`, `apps.apple.com`, `*.apk`),
T2 an app-promo class/id/`data-testid` hook, T3 the English label; T1/T2 also
require top-banner geometry (top ≤ 160 px, height ≤ 160 px, ≥ 60 % viewport
width) and an actual control inside, so a footer store link or an unrelated top
bar is left alone. Structural passes are throttled to 500 ms for the phone
WebView; the cheap English pass still runs on every mutation.

**Verified.** 5 new unit tests (translated banner found via store link and via
hook, translated banner *without* structural signal left alone, bottom store
link untouched, unrelated top bar untouched — the old 13 tests still pass) and
the existing Android E2E check.

---

## Verification summary

| Check | Result |
| --- | --- |
| `npm run check-locales` | PASS — no missing keys in any locale |
| `npm run build:android` | PASS (exit 0, 9 assets staged) |
| `npm run test:unit` | PASS — **106 files / 1560 tests** |
| Android WebView E2E | **31/31 PASS** (23 before + 8 new) |
| Repeat runs | 3 consecutive full-suite green runs |
| Kotlin/Robolectric | runs in CI (`npm run android:test`) |
| Android E2E in CI | runs in CI (`test:e2e:android`) |

New tests added this round: locale-proof menu detection (8), label re-check and
trigger classification, banner rules (5), autocomplete event order (2),
CommandManager close (3), composer layout (3), reveal gate + bridge (10),
ui-ready signalling (6), settings scope split (rewritten, 20), plus 8 Android
E2E tests (Bengali account popover, Bengali chat menu, C.1 evidence + live
switch, C.2 command/project, B.6 spacing, B.7 signal).

## Not fixed / to confirm on device

* **On-device confirmation** of the two native behaviours (B.7 reveal timing and
  the Bengali popover) needs the freshly built APK on your phone — the simulator
  covers the JS contract; the Robolectric tests cover the Kotlin gate.
* `findNativePromptActionRow`'s new T3 signal (`aria-pressed`) is deliberately
  conservative; if a future DeepSeek build marks an unrelated pressed control
  inside the composer, the send-cluster requirement is what keeps it safe.
* The temporary `arena/**` trigger in `.github/workflows/release.yml` **must be
  removed before merging to main** (owner decision: keep for now).
* The release APK stays unsigned until `BDS_KEYSTORE` and friends are added;
  install the CI debug artifact (`android-apk-debug`) meanwhile.
