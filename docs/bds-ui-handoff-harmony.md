# Handoff — Better DeepSeek UI Restructure

**To:** Harmony / Claude (Tech Lead)
**From:** Arena agent (working branch `arena/01a0d81f-super-deepseek`)
**Subject:** UI restructure of the Android/WebView conversion — complete, verified against the shipped Better DeepSeek extension source from the GitHub repo, pushed, CI green

---

## 1. One-paragraph summary

The Better DeepSeek UI has been restructured exactly as the locked master prompt
requires: the composer is now a fixed five-icon row (Plus · Deep Think · Web
Search · Deep Research · Send), Plus opens a 2×3 upload drawer that absorbs the
old standalone Project icon, the long custom sidebar search bar is off, the
floating `#bds-toggle` trigger is gone (settings live behind the sidebar account
popover), the account popover offers exactly *Plugins* and *Advanced Settings*
plus the untouched native rows, Tags/Export stay chat-menu-only, *Get BDS App*
and *What's New* moved into the drawer footer, and the monolithic settings
panel is physically split into `AdvancedSettings.svelte` and
`PluginsSettings.svelte` with their own state, save buttons and unsaved-change
guards. The Android edge-to-edge inset strip is fixed. Nothing was rewritten:
every relocated control still calls the original handler, and no storage shape,
OAuth flow, cookie policy, package identity or signing configuration was
touched.

## 2. Branch, commits, CI

| Item | Value |
|---|---|
| Branch | `arena/01a0d81f-super-deepseek` |
| Base | `main` @ `f4a8348931f2ad5e595fe701ffe0ebbe3282e415` |
| Commits | `140e1ec` (audit/bug-fix pass) → `bfa2942` (restructure, 24 files, +1698/−697) → `3dd3e67` (Android e2e rework through the new entry points) → docs commit (this handoff, master prompt, tracking JSON, progress update) |
| CI | **run `36167256744` — success**: Unit tests ✔ · `build:android` ✔ · staged assets ✔ · Android WebView simulator suite ✔ · Kotlin unit tests ✔ · `assembleDebug` ✔ · artifacts uploaded |
| Earlier red run | `36163210120` failed in the Android job only because the committed e2e helper waited for a *visible* `#bds-drawer` while the drawer renders hidden (`bds-closed`). Reproduced locally, fixed, and superseded by the green run. |

## 3. Verification method (truthful, no hand-waving)

1. **Upstream cross-check.** The four supplied leads were verified or refuted by
   fetching the shipped extension sources from the GitHub repo
   (`EdgeTypE/better-deepseek`): `src/background/api-proxy.js`,
   `src/background/index.js` (the "dead code" claim was false — the module is
   imported for its side effects) and `src/lib/harness-bridge.js` (MOD A/B
   bridge contract), plus the upstream Android module layout. This is the
   "shipped source" the restructure was measured against; the relocated
   triggers call the same handler code the shipped extension uses.
2. **This repository's own suites** (the mobile conversion is the source of
   truth for the Android build):
   - `npm run check-locales` → PASS (5 locales key-compatible)
   - `npm run build` (= `build:android`) → PASS, 911 + 10 + 11 modules, 9 assets staged
   - `npm run test:unit` → PASS, **103 files / 1529 tests**
   - `npm run test:e2e:android` → **23/23 PASS**, five consecutive full runs
   - CI re-ran all of the above plus `./gradlew test` and `assembleDebug`.
3. **Local Android-run recipe** (because Playwright's own Chromium download and
   the Debian/JDK packages are blocked in the sandbox): the suite was driven by
   the Chromium shipped in `@sparticuz/chromium` (`/tmp/chromium`) with its
   Amazon-Linux libs on `LD_LIBRARY_PATH`, against the same mock-DeepSeek
   fixture the CI suite uses. The runner config was temporary and is **not**
   committed.

**Not verified here, honestly:** no physical device / emulator run, no visual
diff against the five mockups (they were never attached to the session — only
two annotated screenshots were), and no release APK from this branch, because
`gh workflow run release.yml` returns HTTP 403 with the integration token and
the temporary `arena/**` push trigger used for the previous release build was
deliberately removed afterwards.

## 4. Requirement-by-requirement result

| ID | Requirement | Result | Where |
|---|---|---|---|
| E.1 | Composer = exactly 5 icons L→R; no Project icon; Android DeepCode skip preserved | done | `scanner.js`, `AttachMenu.svelte`, `Drawer.svelte` |
| F.1 | Plus → 2×3 upload drawer; existing handlers; Project card replaces the icon | done | `AttachMenu.svelte` |
| F.2 | Command only in the drawer; no Commands section in settings; system untouched | done | `Drawer.svelte`, `commands/insert-command.js` |
| F.3 | Long sidebar search off, native icon untouched | done | `SidebarSearch.js` (`ENABLE_LONG_SIDEBAR_SEARCH = false`) |
| F.4 | `#bds-toggle` removed; settings via the account popover | done | `App.svelte`, `mount.js` |
| F.5 | Popover = Plugins / Advanced Settings / Official Settings / Log out; no Tags/Export/Get App/What's New; Get BDS App + What's New in the drawer footer; Help & Feedback untouched | done | `SidebarMenuInjector.js`, `Drawer.svelte` |
| F.6 | Settings physically split; no "General Settings"; `subMcp` = `mcp.sectionTitle` | done | `settings/AdvancedSettings.svelte`, `settings/PluginsSettings.svelte`, `SettingsPanel.svelte` deleted |
| F.7 | Mobile-first dark redesign, no functional loss | done | `styles/settings.css` + the two components; all legacy settings tests pass |
| F.8 | Android edge-to-edge inset fix; bottom/IME kept; `EdgeToEdgeTest.kt` updated | done | `MainActivity.kt`, `EdgeToEdgeTest.kt` |
| C/H | No OAuth/session/cookie/package/signing changes; no logic rewrites; no duplicate handlers; storage shapes kept | done | see §5 |
| J | Tests updated/added | done | 10 test files; 1529 unit tests + 23 e2e |
| L/M | 19 acceptance checks | done | each check maps to an assertion in the suites listed in §3 |

## 5. Safety audit (explicitly unchanged)

- OAuth / login / session: untouched. `MainActivity.kt` diff is the inset line only.
- WebView cookies and the file-picker bridge: untouched (`WebViewBridge.kt`,
  `android-file-picker.js` untouched; `WebViewNavigationTest`,
  `WebViewBridgeTest`, `WebViewBridgePickerTest`, `WebViewBridgeDeliveryTest`,
  `WebViewBridgeBoundedReadTest`, `FileChooserTest`, `CookiePolicyTest` ran
  unmodified in CI).
- Package identity and signing: untouched.
- Storage shapes (`appState`, `appState.projects`, `customMappings`,
  `appState.settings`) and all persistence keys: unchanged; no migration.
- Command registry / parser / executor / autocomplete / persistence: untouched;
  the drawer's Command card calls a new shared one-liner
  (`commands/insert-command.js`) that wraps the pre-existing
  `findChatEditor` / `setChatInputText` helpers instead of duplicating logic.

## 6. Warnings / decisions you may want to revisit

1. **DeepCode relocation.** The composer row is locked to five icons, so the
   DeepCode toggle moved into the BDS drawer (same component, same state, same
   harness bridge). The old Android-only "one icon fewer" branch moved with it:
   Android does not render that drawer section at all. Revisit if the Android
   build ever ships the harness bridge (`// TODO(BDS-UI)` in `Drawer.svelte`).
2. **Long sidebar search.** Kept in source, disabled by default per F.3 — a
   one-line flip restores it, no other file changes.
3. **Mockups.** `63672.png`, `63673.png`, `63674.jpg`, `63675.jpg`, `63676.jpg`
   never arrived; the redesign follows the locked text plus the two annotated
   screenshots. If the mockups disagree anywhere, the split-settings layout is
   the part to compare first.
4. **Pre-existing a11y warnings.** The codebase already emits ~120 Svelte a11y
   warnings; the three that `PluginsSettings.svelte` introduced were fixed
   (labels now target their inputs). The rest were left untouched to keep this
   change set reviewable.
5. **Release APK.** Ask me (or anyone with admin scope) to re-enable the
   temporary `arena/**` trigger — or dispatch the workflow manually — if you
   want a signed APK produced from this branch; CI already uploads the debug APK.

## 7. Files most worth reading first

- `src/content/ui/AttachMenu.svelte` — upload drawer (grid, command sub-view, portal-click fix)
- `src/content/ui/Drawer.svelte` — drawer host, section routing, DeepCode host, footer entries
- `src/content/ui/SidebarMenuInjector.js` — account vs chat menu discrimination
- `src/content/ui/settings/AdvancedSettings.svelte`, `.../PluginsSettings.svelte` — the split systems
- `src/content/scanner.js` — composer order lock (Plus anchor, Deep Research → send anchor)
- `tests/e2e-android/android.spec.js`, `tests/e2e-android/helpers/android.js` — the new entry-point contract
- `docs/bds-ui-tracking.json` — machine-readable status, evidence and open items
