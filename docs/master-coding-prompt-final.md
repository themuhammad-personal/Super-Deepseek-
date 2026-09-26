# Better DeepSeek — UI Restructure Master Prompt (`master-coding-prompt-final.md`)

> **Restoration note (read first).** The original upload of this file was not
> present in the session workspace (`/home/user/uploads/` does not exist and no
> `master-coding-prompt*` file was on disk), so this copy is reconstructed from
> the requirement set that was pasted into the working session and then applied
> to the checkout. Every locked requirement, label, conflict resolution and
> acceptance check is preserved; only the surrounding prose is rebuilt.

---

## 0. Mission

Restructure the Better DeepSeek (`better-deepseek`) UI that ships in this
repository, working from the **shipped Better DeepSeek extension source from the
GitHub repo** as the reference implementation for behaviour, not as a source of
new features.

The work is a **UI relocation**, not a rewrite:

- no feature logic may be rewritten,
- no existing feature, UI surface or asset may be dropped,
- no new features may be added,
- no storage/migration work,
- scope is limited to UI relocation plus **two passthrough APIs**
  (`openDrawerSection`, `scrollToSection`) and **one Android inset tweak**.

## 1. Locked requirements (authoritative — E/F/L override earlier drafts)

### E.1 — Composer action row

The composer action row must contain **exactly five icons, left → right**:

1. **Plus** (Upload)
2. **Deep Think** (native)
3. **Web Search** (native)
4. **Deep Research** (BDS, existing component)
5. **Send** (native)

Slot 4 **is** Deep Research — no substitution is permitted. Reuse the existing
functionality of every control. Remove the standalone **Project** composer icon;
its entry point moves into the Plus drawer.

The Android `BDS_TARGET === "android"` DeepCode-skip intent (one icon fewer)
must be preserved. The composer-side branch is gone, so the intent must be
re-expressed at DeepCode's next host.

### F.1 — Plus → Upload Drawer

Plus opens a redesigned **2×3 Upload Drawer**:

| | |
|---|---|
| File | Index folder |
| GitHub repo | Web page |
| Command | Project |

Every card calls the **existing** handler for that action. The **Project** card
replaces the removed standalone composer icon.

### F.2 — Command lives in the drawer only

Command appears **only** in the Upload Drawer. There is **no standalone Commands
section in the default settings surfaces**. The command registry, parser,
executor, autocomplete and persistence stay untouched and no second
implementation may be introduced.

### F.3 — Sidebar search

Remove the long custom BDS sidebar search bar. Keep the **native small search
icon** exactly as it is. `SidebarSearch.js` may remain in source but **must not
mount by default**.

### F.4 — Settings trigger

Remove the floating top BDS settings trigger `#bds-toggle`. Settings are reached
from the **sidebar account/profile menu**. The Drawer and Settings functionality
must be fully preserved.

### F.5 — Account popover

The account popover contains **exactly**:

1. **Plugins** → Plugins settings
2. **Advanced Settings** → Advanced UI
3. **Official Settings** → native settings (never intercepted)
4. **Log out** → native logout (never intercepted)

It must **not** contain **Tags**, **Export Chat**, **Get BDS App** or
**What's New**. Tags + Export stay in the **chat-context menu only**; the
injection must be fixed so `injectOptions()` no longer leaks into the account
`.ds-dropdown-menu` (lead D.6).

**Get BDS App** and **What's New** are *not deleted* — they relocate to the
**Drawer footer**, next to the GitHub link (Conflict 4). The native
**Help & Feedback** entry stays untouched.

### F.6 — Physically separate settings systems

Settings must be **physically separate systems** — a real decomposition, not
accordions/tabs/anchors inside `SettingsPanel.svelte`:

- **Advanced Settings** = the old general settings, renamed, own component.
- **Plugins** = the old MCP area, renamed.
- The Upload-Drawer configuration is separate from both.
- Shared utils/state are allowed; **UI ownership must be separated**.

Related conflicts: `subMcp` labelKey must be `mcp.sectionTitle` (D.5) and there
must be **no literal "General Settings" section** — the panel is the whole
settings surface minus MCP (Conflict 5).

### F.7 — Premium, mobile-first dark redesign

Redesign the split settings: hierarchy, cards, spacing/typography, grouping,
expand/collapse, transitions, large touch targets, responsive layout,
consistent iconography, and a clear Advanced-vs-Plugins distinction — with
**no functional loss**.

### F.8 — Android full screen

Preserve OAuth/session/cookie/package/signing behaviour. Fix the top
banner/inset strip (`applyRootWindowInsets` padding), keep bottom and IME
handling, verify visually, and update `EdgeToEdgeTest.kt`.

## 2. Constraints C / H

- No changes to OAuth, session, login, WebView cookies, package identity or
  signing.
- No feature-logic rewrites: relocate triggers, reuse handlers.
- No duplicate File/Folder/GitHub/Web/Project/Command implementations.
- Keep the storage shapes: `appState`, `appState.projects`, `customMappings`,
  `appState.settings`.
- Ambiguity → choose the minimal reversible option and leave a
  `// TODO(BDS-UI):` comment.
- No migration logic.

## 3. Tests to update/add (J)

- `AttachMenu` grid plus the Command and Project cards.
- Absence of the long sidebar search mount.
- `SidebarMenuInjector`: chat-context vs account-menu discrimination.
- `hide-get-app.test.js` and `hide-drawer-app-item.test.js`.
- Settings tests: `scrollToSection`.
- App / MountUi / mount tests for `openDrawerSection` and `#bds-toggle` removal.
- Composer ordering plus "no `bds-project-btn`".
- Commands relocation assertions.
- `EdgeToEdgeTest.kt`.

## 4. Android safety (I)

- Do not touch `WebViewBridge.kt` file-picker/session/cookie code.
- Do not change `MainActivity` OAuth/WebView session handling.
- Re-run `WebViewNavigationTest`, `WebViewBridgeTest`,
  `WebViewBridgePickerTest`, `WebViewBridgeDeliveryTest`,
  `WebViewBridgeBoundedReadTest`, `FileChooserTest`, `CookiePolicyTest`
  **unmodified** — only `EdgeToEdgeTest.kt` may change.
- Keep the Android DeepCodeToggle-skip intent (`BDS_TARGET === "android"`).

## 5. Acceptance (L / M) — 19 measurable checks

1. Composer row = exactly `Plus, Deep Think, Web Search, Deep Research, Send`.
2. No standalone Project icon in the composer.
3. No DeepCode icon mounted in the composer action row.
4. Plus opens the 2×3 upload drawer with the locked card order.
5. Every card invokes the pre-existing handler (no duplicate implementations).
6. The Project card reuses the existing project panel.
7. The Command card inserts `/<id> ` into the chat editor through shared code.
8. No Commands section in the default settings surfaces.
9. The long BDS sidebar search bar does not mount by default.
10. `#bds-toggle` no longer exists in the DOM.
11. Account popover = Plugins / Advanced Settings / Official Settings / Log out.
12. Account popover has no Tags / Export Chat / Get BDS App / What's New.
13. Tags + Export Chat still exist in the chat-context menu only.
14. Get BDS App / What's New are reachable from the drawer footer.
15. Native Help & Feedback is untouched.
16. Advanced Settings and Plugins are separate components with separate state,
    save buttons and unsaved-change guards.
17. No literal "General Settings" section; `subMcp` uses `mcp.sectionTitle`.
18. The redesigned settings keep every setting functional (no functional loss).
19. OAuth/session/cookies/package identity/signing unchanged; Android top inset
    is 0 with bottom `max(systemBars.bottom, ime.bottom)`; the DeepCode Android
    skip is preserved.

## 6. Required commands (run in this order; never invent scripts)

```
npm run build          # = build:android
npm run test:unit
npm run test:e2e:android
npm run android:assemble:debug
npm run android:test
npm run test:ci
```

There is **no** `build:chrome` script.

## 7. Deliverables

1. This master prompt, restored into the workspace.
2. Progress-tracking JSON.
3. Exact progress-update text.
4. Paste-ready handoff markdown addressed to **Harmony / Claude (Tech Lead)**,
   stating that the work was **verified against the shipped Better DeepSeek
   extension source from the GitHub repo**, with a truthful description of the
   verification method.

## 8. Reference material

Four mockups are referenced by the prompt (`63672.png`, `63673.png`,
`63674.jpg`, `63675.jpg`, `63676.jpg`). They were **not attached** to the
implementation session; only the two annotated phone screenshots in the chat
were available. Where the images conflicted with the source, the locked
requirements above were followed and the conflict was reported.
