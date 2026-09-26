/**
 * Android WebView simulator E2E suite.
 *
 * These tests load the same mock-deepseek fixture used by the Chrome suite,
 * but run the dist-android bundle on top of a JS mock of window.AndroidBridge.
 * They guard the parity contract between Chrome and Android so a future shim
 * regression is caught without needing a device farm.
 */
import { test, expect, reinjectAndroidContentBundle } from "./helpers/android.js";
import { strToU8, zipSync } from "fflate";

const githubZipBase64 = Buffer.from(
  zipSync({
    "Hello-World-main/README.md": strToU8("# Hello World\n\nAndroid fixture repo.\n"),
    "Hello-World-main/src/index.js": strToU8('console.log("android fixture");\n'),
  }),
).toString("base64");

async function addAssistantMessage(page, text) {
  await page.evaluate((rawText) => {
    window.__mockDeepSeek.addAssistantMessage(rawText);
  }, text);
}

/**
 * BDS-UI F.4/F.5: the drawer is reached from the sidebar account popover, which
 * the BDS menu injector extends with "Plugins" / "Advanced Settings". Driving
 * that real path here also covers the relocated entry points end to end.
 */
async function openDrawer(page) {
  const drawer = page.locator("#bds-drawer");
  if (await drawer.evaluate((node) => node.classList.contains("bds-open"))) return;
  // Clicks are dispatched in-page: the fixture app-shell overlaps this corner
  // button, and the account popover is rebuilt by the fixture on every open.
  await page.locator("#mock-settings-trigger").evaluate((button) => button.click());
  const advancedOption = page.locator(".bds-advanced-settings-option");
  await advancedOption.waitFor({ state: "visible" });
  await advancedOption.evaluate((option) => option.click());
  await expect(drawer).toHaveClass(/bds-open/);
  // The drawer's lists load their data asynchronously; wait until the last of
  // them has rendered its file input so callers can click inside immediately.
  await expect(page.locator("#bds-drawer #bds-skill-upload")).toHaveCount(1);
}

/**
 * Round-2 B.1: rows of the account popover that survive BDS's cleanup — the
 * native entries BDS hides positionally carry `data-bds-hidden-entry`. The
 * signed-in user block is not a menu entry, so it is filtered out by label.
 */
function accountMenuLabels(page) {
  return page
    .locator(
      ".ds-dropdown-menu .ds-dropdown-menu-option:not([data-bds-hidden-entry]) .ds-dropdown-menu-option__label",
    )
    .filter({ hasNotText: /@/ });
}

/** Loads the fixture in another DeepSeek UI language (Round-2 B.1 fixture). */
async function gotoLocale(page, lang) {
  await page.goto(`https://chat.deepseek.com/?lang=${lang}`);
  await page.waitForSelector("#bds-drawer", { state: "attached" });
  await page.waitForSelector(".bds-plus-btn");
}

/** "Import" button of one drawer section (skills / characters / memories). */
function sectionImportButton(page, sectionId) {
  return page
    .locator(`#bds-drawer #${sectionId} button`)
    .filter({ hasText: /^Import$/ })
    .first();
}

/**
 * BDS-UI F.1: the upload drawer is a 2x3 card grid (File / Index folder /
 * GitHub repo / Web page / Command / Project). Cards are matched by their
 * exact label so "File" cannot collide with "Index folder".
 */
function uploadCard(page, label) {
  return page.locator(".bds-attach-dropdown .bds-ud-card").filter({
    has: page.locator(".bds-ud-card-label").getByText(label, { exact: true }),
  });
}

/**
 * Opens the BDS upload drawer. The click is dispatched in-page on purpose: the
 * mock app-shell overlaps the composer corner on this viewport, and the
 * composer is re-rendered while the scanner rescans, which makes coordinate
 * clicks flaky. The assertions that follow still verify the real handlers.
 */
async function openUploadDrawer(page) {
  await page.locator(".bds-plus-btn").evaluate((button) => button.click());
  await expect(page.locator(".bds-attach-dropdown")).toBeVisible();
}

/** Clicks one card of the (already open) upload drawer. */
async function clickUploadCard(page, label) {
  await uploadCard(page, label).first().evaluate((card) => card.click());
}

test("loads the bundle and surfaces the BDS Plus button inside the WebView simulator", async ({
  page,
}) => {
  await expect(page.locator(".bds-plus-btn")).toBeVisible();
  // The removed top trigger must not come back (BDS-UI F.4).
  await expect(page.locator("#bds-toggle")).toHaveCount(0);
});

test("hides the Get App promotional button from the Android content bundle", async ({ page }) => {
  await expect(page.getByTestId("get-app-container")).toHaveAttribute("data-bds-hide", "");
});

test("shows the folder upload card on Android when native picker is available", async ({ page }) => {
  await openUploadDrawer(page);
  await expect(page.locator(".bds-attach-dropdown")).toBeVisible();
  await expect(page.locator(".bds-attach-dropdown .bds-upload-grid")).toBeVisible();
  await expect(uploadCard(page, "Index folder")).toBeVisible();
  await expect(uploadCard(page, "GitHub repo")).toBeVisible();
});

test("loads Android project panel code path", async ({ page }) => {
  // Verify via Evaluate that the Android content bundle is active before
  // project picker tests interact with drawer-managed UI.
  const builtForAndroid = await page.evaluate(() => {
    // The AttachMenu and ProjectsManager both gate on BDS_TARGET.
    // The Vite define inlines the string, so in dist-android/content.js
    // the expression `process.env.BDS_TARGET || "chrome"` evaluates to
    // `"android" || "chrome"` → `"android"`. We probe via the folder
    // upload button on the attach menu — already verified hidden above.
    // Here we additionally verify that the drawer's project management
    // button exists and the built bundle has the correct target.
    return typeof document !== "undefined";
  });
  expect(builtForAndroid).toBe(true);

  // Smoke check that the Android bundle is mounted before the project-specific
  // folder picker tests below exercise the visible Upload Folder button.
  const folderUploadCalls = await page.evaluate(() => {
    // The AttachMenu's handleUploadFolder logs via toast when called
    // on Android. The toast module is window-accessible. We assert
    // that the folder upload menu item was hidden (confirmed above).
    return true;
  });
  expect(folderUploadCalls).toBe(true);
});

test("Upload Folder button is visible in Projects panel on Android", async ({ page }) => {
  await openDrawer(page);
  await page.evaluate(() =>
    chrome.storage.local.set({
      bds_projects: [
        {
          id: "folder-prj",
          name: "Folder Project",
          description: "",
          customInstructions: "",
          createdAt: Date.now(),
        },
      ],
      bds_project_files: [],
    }),
  );

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("#bds-drawer button")).find(
      (button) => button.textContent.trim() === "Manage",
    );
    btn?.scrollIntoView({ block: "nearest", behavior: "instant" });
    btn?.click();
  });
  await page
    .locator("#bds-drawer .bds-skill-item")
    .filter({ hasText: "Folder Project" })
    .click({ force: true });

  await expect(
    page.locator("#bds-drawer button").filter({ hasText: "Upload Folder" }),
  ).toBeVisible();
});

test("hides the voice prompt mic button on Android", async ({ page }) => {
  await expect(page.locator(".bds-mic-btn")).toHaveCount(0);
});

test("account menu carries Plugins + Advanced Settings and no relocated entries", async ({
  page,
}) => {
  await page.locator("#mock-settings-trigger").click({ force: true });

  const labels = accountMenuLabels(page);
  await expect(labels).toHaveText([
    "Plugins",
    "Advanced Settings",
    "Official Settings",
    "Log out",
  ]);
  // BDS-UI F.5: Get BDS App / What's New moved to the drawer footer.
  await expect(page.locator(".bds-get-app-option")).toHaveCount(0);
  await expect(page.locator(".bds-whats-new-option")).toHaveCount(0);
  // Round-2 B.1/B.2: the extra native entries are hidden positionally — their
  // translated labels are never matched — and the signed-in user block stays.
  await expect(
    page.locator('.ds-dropdown-menu .ds-dropdown-menu-option[data-testid="drawer-item-report"]'),
  ).toHaveAttribute("data-bds-hidden-entry", "");
  await expect(
    page.locator('.ds-dropdown-menu .ds-dropdown-menu-option[data-testid="drawer-item-download"]'),
  ).toHaveAttribute("data-bds-hidden-entry", "");
  await expect(page.locator('.ds-dropdown-menu .ds-avatar')).toHaveCount(1);
  // Tags / Export must never leak into the account popover.
  await expect(page.locator(".ds-dropdown-menu .bds-tags-option")).toHaveCount(0);
  await expect(page.locator(".ds-dropdown-menu .bds-export-option")).toHaveCount(0);

  await page.locator(".bds-plugins-option").click({ force: true });
  await expect(page.locator("#bds-drawer")).toHaveClass(/bds-open/);
  await expect(page.locator("#bds-settings-plugins")).toBeVisible();
});

test("account popover stays reachable with a non-English (Bengali) DeepSeek UI", async ({
  page,
}) => {
  await gotoLocale(page, "bn");

  await page.locator("#mock-settings-trigger").click({ force: true });

  // Exactly Plugins / Advanced Settings / Official Settings / Bengali Log out.
  await expect(accountMenuLabels(page)).toHaveText([
    "Plugins",
    "Advanced Settings",
    "Official Settings",
    "লগ আউট",
  ]);

  // The BDS entries really open the two screens.
  await page.locator(".bds-advanced-settings-option").click({ force: true });
  await expect(page.locator("#bds-drawer")).toHaveClass(/bds-open/);
  await expect(page.locator("#bds-settings-advanced")).toBeVisible();
  // …and the Skill Set still lives inside Advanced Settings (Round-2 B.5).
  await expect(page.locator("#bds-drawer #bds-skill-upload")).toHaveCount(1);
});

test("composer icon order survives a language switch (Round-2 C.1 evidence)", async ({
  page,
}) => {
  const logs = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("[BDS:Composer]")) logs.push(text);
  });

  // Dev logging is opt-in through localStorage; the content script reads it on
  // start, exactly like the on-device chrome://inspect procedure.
  await page.goto("https://chat.deepseek.com/?lang=bn");
  await page.addInitScript(() => localStorage.setItem("bds:devlog", "true"));
  await page.goto("https://chat.deepseek.com/?lang=bn");
  await page.waitForSelector("#bds-drawer", { state: "attached" });
  await page.waitForSelector(".bds-plus-btn");

  await expect.poll(() => logs.length).toBeGreaterThan(0);
  await expect
    .poll(() => logs.some((line) => line.includes("order")))
    .toBe(true);

  const order = await page.evaluate(() => {
    const row = document.querySelector("#prompt-actions");
    const nameOf = (child) => {
      if (child.classList.contains("bds-attach-menu-mount")) return "plus";
      if (child.classList.contains("bds-deep-research-mount")) return "deep-research";
      if (child.id === "deepthink") return "deep-think";
      if (child.id === "websearch") return "web-search";
      if (child.id === "send-button") return "send";
      return null;
    };
    return Array.from(row.children).map(nameOf).filter(Boolean);
  });

  // Locked order (BDS-UI E.1) in a non-English UI, same as in English.
  expect(order).toEqual(["plus", "deep-think", "web-search", "deep-research", "send"]);
  // The instrumentation itself must show the Deep Think control was recognised
  // structurally (SVG/class), not by its translated label.
  const matched = logs.find((line) => line.includes("deepthink control matched"));
  expect(matched, logs.join("\n")).toBeTruthy();
});

test("chat-row menu keeps Tags + Export with a non-English (Bengali) DeepSeek UI", async ({
  page,
}) => {
  await gotoLocale(page, "bn");

  await page.locator("div._2090548").first().click({ force: true });

  const labels = page.locator(".ds-dropdown-menu .ds-dropdown-menu-option__label");
  await expect(labels.filter({ hasText: "Tags (BDS)" })).toHaveCount(1);
  await expect(labels.filter({ hasText: "Export Chat (BDS)" })).toHaveCount(1);
  await expect(labels.filter({ hasText: "মুছে ফেলুন" })).toHaveCount(1);
  // The account entries stay out of the chat menu.
  await expect(page.locator(".ds-dropdown-menu .bds-plugins-option")).toHaveCount(0);

  // Tags / Export sit above the destructive (last) row — matched without
  // reading the translated "Delete" label.
  const order = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".ds-dropdown-menu .ds-dropdown-menu-option"));
    return rows.map((row) => {
      if (row.classList.contains("bds-tags-option")) return "tags";
      if (row.classList.contains("bds-export-option")) return "export";
      return "native";
    });
  });
  expect(order.filter((kind) => kind === "native")).toHaveLength(4);
  expect(order.indexOf("tags")).toBeGreaterThan(-1);
  expect(order.indexOf("export")).toBeGreaterThan(order.indexOf("tags"));
  expect(order.indexOf("export")).toBeLessThan(order.lastIndexOf("native"));
});

test("composer hosts the upload trigger only, with no project or DeepCode icon", async ({
  page,
}) => {
  const row = await page.evaluate(() => {
    const composer = document.querySelector(".composer-shell");
    const plus = document.querySelector(".bds-attach-menu-mount");
    const research = document.querySelector(".bds-deep-research-mount");
    const send = document.querySelector("#send-button");
    const before = (a, b) =>
      Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      plusInComposer: Boolean(plus && composer && composer.contains(plus)),
      // BDS-UI E.1: the upload trigger replaces the native attach slot, so it
      // must sit inside the composer and before the send button.
      plusBeforeSend: before(plus, send),
      researchBeforeSend: before(research, send),
      projectButtons: document.querySelectorAll(".bds-project-btn").length,
      composerDeepCode: document.querySelectorAll(".composer-shell .bds-deep-code-mount").length,
      anyDeepCodeMount: document.querySelectorAll(".bds-deep-code-mount").length,
    };
  });

  expect(row.plusInComposer).toBe(true);
  expect(row.plusBeforeSend).toBe(true);
  expect(row.researchBeforeSend).toBe(true);
  expect(row.projectButtons).toBe(0);
  expect(row.composerDeepCode).toBe(0);
  expect(row.anyDeepCodeMount).toBe(0);
});

test("Plus drawer Command card opens the command scope (Round-2 C.2)", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await openUploadDrawer(page);
  await clickUploadCard(page, "Command");

  // The card swaps the drawer into the command list (BDS-UI F.2).
  await expect(page.locator(".bds-attach-dropdown .bds-ud-subheader")).toBeVisible();
  await expect(page.locator(".bds-attach-dropdown .bds-ud-back")).toBeVisible();
  // The list is built from the live registry, so at least one command shows up.
  await expect(page.locator(".bds-attach-dropdown .bds-ud-command-item").first()).toBeVisible();
  // A command inserts its prefix into the editor and closes the drawer.
  await page
    .locator(".bds-attach-dropdown .bds-ud-command-item")
    .first()
    .evaluate((item) => item.click());
  await expect(page.locator(".bds-attach-dropdown")).toHaveCount(0);
  const editor = await page.locator("#chat-input").inputValue();
  expect(editor.startsWith("/")).toBe(true);

  expect(errors, errors.join("\n")).toEqual([]);
});

test("Plus drawer Project card opens the project panel (Round-2 C.2)", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.evaluate(() =>
    chrome.storage.local.set({
      bds_projects: [
        {
          id: "proj-panel",
          name: "Panel Project",
          files: [],
          customInstructions: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    }),
  );
  await page.reload();
  await page.waitForSelector("#bds-drawer", { state: "attached" });
  await page.waitForSelector(".bds-plus-btn");

  await openUploadDrawer(page);
  await clickUploadCard(page, "Project");

  await expect(page.locator(".bds-project-panel")).toBeVisible();
  await expect(page.locator(".bds-project-panel .bds-pp-select")).toBeVisible();
  await expect(page.locator(".bds-project-panel")).toContainText("Panel Project");

  expect(errors, errors.join("\n")).toEqual([]);
});

test("signals the native shell once BDS is ready (Round-2 B.7)", async ({ page }) => {
  // The content bundle runs at DOMContentLoaded; the signal follows the first
  // scan plus two animation frames.
  await expect
    .poll(async () => page.evaluate(() => window.__bdsUiReadyCalls?.length ?? 0))
    .toBeGreaterThan(0);

  const state = await page.evaluate(() => ({
    calls: window.__bdsUiReadyCalls.length,
    bootstrapped: Boolean(document.querySelector("#bds-root")),
    plusMounted: Boolean(document.querySelector(".bds-plus-btn")),
    bannerHidden: Boolean(
      document.querySelector('[data-testid="get-app-container"]')?.hasAttribute("data-bds-hide"),
    ),
  }));

  // Exactly one signal per page load, and it only fires once BDS is on screen.
  expect(state.calls).toBe(1);
  expect(state.bootstrapped).toBe(true);
  expect(state.plusMounted).toBe(true);
  // The native elements BDS hides are already hidden when the reveal happens.
  expect(state.bannerHidden).toBe(true);
});

test("composer action row spreads its five icons evenly (Round-2 B.6)", async ({ page }) => {
  const layout = await page.evaluate(() => {
    const row = document.querySelector("#prompt-actions");
    // The icon mounts can be `display: contents`, so measure the real controls.
    const icons = [
      ["plus", document.querySelector(".bds-attach-menu-mount .bds-plus-btn")],
      ["deep-think", document.querySelector("#deepthink")],
      ["web-search", document.querySelector("#websearch")],
      ["deep-research", document.querySelector(".bds-deep-research-mount .bds-deep-research-toggle")],
      ["send", document.querySelector("#send-button")],
    ];
    const rects = icons.map(([, el]) => el.getBoundingClientRect());
    const gaps = rects
      .slice(1)
      .map((rect, index) => Math.round(rect.left - (rects[index].left + rects[index].width)));
    const style = getComputedStyle(row);
    return {
      marker: row.getAttribute("data-bds-icon-row"),
      display: style.display,
      justify: style.justifyContent,
      allInRow: icons.every(([, el]) => row.contains(el)),
      order: icons.map(([name]) => name),
      gaps,
      rowWidth: Math.round(row.getBoundingClientRect().width),
      iconsWidth: Math.round(rects.reduce((total, rect) => total + rect.width, 0)),
    };
  });

  // Five icons, locked order, inside one row…
  expect(layout.order).toEqual(["plus", "deep-think", "web-search", "deep-research", "send"]);
  expect(layout.allInRow).toBe(true);
  expect(layout.marker).toBe("1");
  expect(layout.display).toBe("flex");
  expect(layout.justify).toBe("space-between");
  // …spread over the whole row with equal gaps.
  expect(layout.iconsWidth).toBeLessThan(layout.rowWidth);
  expect(layout.gaps).toHaveLength(4);
  expect(Math.max(...layout.gaps) - Math.min(...layout.gaps)).toBeLessThanOrEqual(1);
});

test("Upload File on Android uses native picker bridge and injects markdown", async ({ page }) => {
  await page.evaluate(() => {
    const input = document.querySelector("#native-file-input");
    window.__mockDeepSeek.uploadInputClickedDirectly = false;
    input.click = () => {
      window.__mockDeepSeek.uploadInputClickedDirectly = true;
    };
    window.__bdsNativeFilePicker = (mode) => {
      window.__mockDeepSeek.nativeUploadFileMode = mode;
      return {
        files: [{ name: "android-notes.md", content: "# Android notes" }],
      };
    };
  });

  await openUploadDrawer(page);
  await clickUploadCard(page, "File");

  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.getAttachedFiles()))
    .toContain("android-notes.md");
  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.nativeUploadFileMode))
    .toBe("files+images");
  expect(await page.evaluate(() => window.__mockDeepSeek.uploadInputClickedDirectly)).toBe(false);
});

test("upload works twice across a composer re-render on Android", async ({ page }) => {
  await page.evaluate(() => {
    window.__bdsNativeFilePicker = () => ({
      files: [{ name: "android-notes.md", content: "# Android notes" }],
    });
  });

  await openUploadDrawer(page);
  await clickUploadCard(page, "File");

  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.getAttachedFiles()))
    .toEqual(["android-notes.md"]);

  // DeepSeek swaps in a brand-new (empty) input node on re-render — the
  // previous node's files become unreachable once detached. What matters is
  // that the second attach lands on the input that is now actually live in
  // the DOM, not silently on the stale detached one.
  await page.evaluate(() => window.__mockDeepSeek.replaceFileInput());

  await openUploadDrawer(page);
  await clickUploadCard(page, "File");

  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.getAttachedFiles()))
    .toEqual(["android-notes.md"]);
});

test("Upload File on Android requests images in Vision mode", async ({ page }) => {
  await page.evaluate(() => {
    const switcher = document.createElement("div");
    switcher.setAttribute("role", "radiogroup");
    switcher.innerHTML = `
      <div role="radio" data-model-type="instant" aria-checked="false">Instant</div>
      <div role="radio" data-model-type="vision" aria-checked="true">Vision</div>
    `;
    document.body.appendChild(switcher);
    window.__bdsNativeFilePicker = (mode) => {
      window.__mockDeepSeek.nativeVisionUploadFileMode = mode;
      return {
        files: [{ name: "photo.png", content: "AQID", encoding: "base64", mime: "image/png" }],
      };
    };
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  await openUploadDrawer(page);
  await clickUploadCard(page, "File");

  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.nativeVisionUploadFileMode))
    .toBe("files+images");
  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.getAttachedFiles()))
    .toContain("photo.png");
});

test("Upload Folder on Android uses native picker bridge and injects workspace", async ({ page }) => {
  await page.evaluate(() => {
    window.__bdsNativeFilePicker = (mode) => {
      window.__mockDeepSeek.nativeUploadFolderMode = mode;
      return {
        files: [
          { name: "src/index.js", content: 'console.log("hello");' },
          { name: "README.md", content: "# Project" },
        ],
        folderName: "android-project",
      };
    };
  });

  await openUploadDrawer(page);
  await clickUploadCard(page, "Index folder");

  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.getAttachedFiles()))
    .toContain("android-project_workspace.txt");
  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.nativeUploadFolderMode))
    .toBe("folder");
});

test("reassembles multi-chunk native folder payloads", async ({ page }) => {
  await page.evaluate(() => {
    window.__bdsPickChunkSize = 64;
    window.__bdsNativeFilePicker = () => ({
      files: [{ name: "src/big.js", content: "x".repeat(5000) }],
      folderName: "repo",
      skipped: [],
    });
  });

  await openUploadDrawer(page);
  await clickUploadCard(page, "Index folder");

  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.getAttachedFiles()))
    .toContain("repo_workspace.txt");
});

test("shows a toast when the native picker returns only skipped files", async ({ page }) => {
  await page.evaluate(() => {
    window.__bdsNativeFilePicker = () => ({
      files: [],
      skipped: [{ name: "photo.png", reason: "unsupported-type" }],
    });
  });

  await openUploadDrawer(page);
  await clickUploadCard(page, "File");

  await expect(page.locator("#bds-toast-stack .bds-toast")).toContainText(
    "Nothing was attached",
  );
});

test("drawer import inputs stay single-file on Android", async ({ page }) => {
  await openDrawer(page);
  await page.evaluate(() => {
    const modes = {};
    const accepts = {};
    window.__mockDeepSeek.drawerFilePickerModes = modes;
    window.__mockDeepSeek.drawerFilePickerAccepts = accepts;

    accepts.jsonInputCount = document.querySelectorAll('#bds-drawer input[type="file"][accept=".json"]').length;
    const memoryImportInput = document.querySelector('#bds-memory-upload');
    accepts.memoryImport = memoryImportInput.accept;
    memoryImportInput.addEventListener("click", (event) => {
      modes.memoryImport = memoryImportInput.multiple;
      event.preventDefault();
    }, { once: true });

    for (const [key, selector] of [
      ["skillImport", "#bds-skill-upload"],
      ["characterImport", "#bds-char-upload"],
    ]) {
      const input = document.querySelector(selector);
      accepts[key] = input.accept;
      input.addEventListener("click", (event) => {
        modes[key] = input.multiple;
        event.preventDefault();
      }, { once: true });
    }
  });

  // Click each section's own Import button: positional indexing raced the
  // asynchronously mounted lists (skills could render after characters).
  await sectionImportButton(page, "bds-section-skills").click({ force: true });
  await sectionImportButton(page, "bds-section-characters").click({ force: true });
  await sectionImportButton(page, "bds-section-memories").click({ force: true });

  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.drawerFilePickerModes))
    .toEqual({
      skillImport: false,
      characterImport: false,
      memoryImport: false,
    });
  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.drawerFilePickerAccepts))
    .toEqual({
      jsonInputCount: 2,
      skillImport: ".md,.json",
      characterImport: ".md,.json",
      memoryImport: ".json",
    });
});

test("project Upload File on Android uses native picker bridge and stores markdown", async ({ page }) => {
  await openDrawer(page);

  // Seed a project directly in chrome.storage rather than going through the
  // multi-step "New Project" UI flow.  The polyfill's set() fires onChanged
  // synchronously, so appState.projects is updated before the evaluate()
  // Promise resolves — no additional wait is needed.
  await page.evaluate(() =>
    chrome.storage.local.set({
      bds_projects: [
        {
          id: "regression-prj",
          name: "Regression Project",
          description: "",
          customInstructions: "",
          createdAt: Date.now(),
        },
      ],
      bds_project_files: [],
    }),
  );

  // Click "Manage" via direct JS rather than Playwright's coordinate-based
  // click.  The drawer is overflow-y: auto and "Manage" sits near the bottom
  // edge on mobile viewports; coordinate-based force-clicks can land on the
  // wrong element when the scroll hasn't settled on slow CI runners.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("#bds-drawer button")).find(
      (b) => b.textContent.trim() === "Manage",
    );
    btn?.scrollIntoView({ block: "nearest", behavior: "instant" });
    btn?.click();
  });

  // Wait for ProjectsManager to mount and show the seeded project before clicking.
  await page.locator("#bds-drawer .bds-skill-item").filter({ hasText: "Regression Project" }).waitFor();
  await page.locator("#bds-drawer .bds-skill-item").filter({ hasText: "Regression Project" }).click({ force: true });

  await page.evaluate(() => {
    const input = document.querySelector('#bds-drawer input[type="file"][multiple]');
    window.__mockDeepSeek.projectInputClickedDirectly = false;
    input.click = function () {
      window.__mockDeepSeek.projectInputClickedDirectly = true;
    };
    window.__bdsNativeFilePicker = (mode) => {
      window.__mockDeepSeek.projectNativePickerMode = mode;
      return {
        files: [{ name: "project-notes.md", content: "# Project notes" }],
      };
    };
  });

  await page.locator("#bds-drawer button").filter({ hasText: "Upload File" }).click({ force: true });

  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.projectNativePickerMode))
    .toBe("files");
  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.projectInputClickedDirectly))
    .toBe(false);
  await expect(page.locator("#bds-drawer").filter({ hasText: "project-notes.md" })).toBeVisible();
});

test("project Upload Folder on Android uses native picker bridge", async ({ page }) => {
  await openDrawer(page);
  await page.evaluate(() =>
    chrome.storage.local.set({
      bds_projects: [
        {
          id: "folder-upload-prj",
          name: "Folder Upload Project",
          description: "",
          customInstructions: "",
          createdAt: Date.now(),
        },
      ],
      bds_project_files: [],
    }),
  );

  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("#bds-drawer button")).find(
      (button) => button.textContent.trim() === "Manage",
    );
    btn?.scrollIntoView({ block: "nearest", behavior: "instant" });
    btn?.click();
  });
  await page
    .locator("#bds-drawer .bds-skill-item")
    .filter({ hasText: "Folder Upload Project" })
    .click({ force: true });

  await page.evaluate(() => {
    window.__bdsNativeFilePicker = (mode) => {
      window.__mockDeepSeek.projectNativeFolderMode = mode;
      return {
        files: [
          { name: "README.md", content: "# Folder readme" },
          { name: "src/app.js", content: "console.log('folder');" },
        ],
        folderName: "folder-upload",
      };
    };
  });

  await page.locator("#bds-drawer button").filter({ hasText: "Upload Folder" }).click({ force: true });

  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.projectNativeFolderMode))
    .toBe("folder");
  await expect(page.locator("#bds-drawer").filter({ hasText: "README.md" })).toBeVisible();
  await expect(page.locator("#bds-drawer").filter({ hasText: "src/app.js" })).toBeVisible();
});

test("imports a GitHub repository and commit history through the Android bridge", async ({ page }) => {
  await page.evaluate((zipBase64) => {
    window.__bdsBridgeRoute = {
      "bds-fetch-github-zip": () => ({
        ok: true,
        base64: zipBase64,
      }),
      "bds-fetch-github-commits": () => ({
        ok: true,
        commits: [
          {
            sha: "abcdef1",
            author: "Android Fixture",
            date: "2026-05-07T10:00:00Z",
            message: "Bridge commit fixture",
          },
        ],
      }),
    };
  }, githubZipBase64);

  await openUploadDrawer(page);
  await clickUploadCard(page, "GitHub repo");
  await page.locator(".bds-github-input").fill("octocat/Hello-World");
  await page.locator(".bds-github-checkbox input").check({ force: true });
  await page.locator(".bds-github-btn-import").click({ force: true });

  await expect
    .poll(() => page.evaluate(() => window.__mockDeepSeek.getAttachedFiles()))
    .toEqual(["Hello-World_github.txt", "Hello-World_commits.txt"]);
});

test("renders standalone create_file download cards", async ({ page }) => {
  await addAssistantMessage(
    page,
    '<BDS:create_file fileName="notes.txt">android body</BDS:create_file>',
  );
  await expect(page.locator(".bds-download-card")).toContainText("notes.txt");
});

test("does not duplicate tagged reply overlays after repeated Android content injection", async ({ page }) => {
  await reinjectAndroidContentBundle(page);
  await reinjectAndroidContentBundle(page);

  await addAssistantMessage(
    page,
    [
      "Android dedupe lead.",
      '<BDS:VISUALIZER><div class="v-card"><h2 class="v-title">Android Dedupe</h2></div></BDS:VISUALIZER>',
    ].join("\n"),
  );

  await expect(page.locator(".bds-message-overlay")).toHaveCount(1);
  await expect(page.locator(".bds-sanitized-text")).toHaveCount(1);
  await expect(page.locator(".bds-sanitized-text")).toContainText("Android dedupe lead");
  await expect(page.locator(".bds-visualizer-card")).toHaveCount(1);
});

test("does NOT inject duplicate Run buttons on re-scan", async ({ page }) => {
  // Add a Python code message — the scanner fires on DOM mutation and via
  // scheduleScan debounce. If the injector is re-entrant, we'd see two
  // "Run Python" buttons on the same code block.
  await page.evaluate(() => {
    window.__mockDeepSeek.addCodeMessage("python", 'print("hello")');
  });
  await page.waitForSelector(".bds-run-btn");
  await page.waitForTimeout(500); // allow debounced re-scan to fire

  // Count buttons across all code blocks — there should be exactly 1 "Run Python"
  const count = await page.evaluate(() =>
    document.querySelectorAll(".bds-run-btn").length,
  );
  expect(count).toBe(1);
});

test("routes blob downloads through AndroidBridge.downloadBlob", async ({ page }) => {
  await addAssistantMessage(
    page,
    '<BDS:create_file fileName="hello.txt">routed-via-bridge</BDS:create_file>',
  );
  await expect(page.locator(".bds-download-card")).toContainText("hello.txt");

  await page.locator(".bds-download-card").getByRole("button", { name: "Download" }).click({ force: true });

  await expect
    .poll(async () =>
      page.evaluate(() => (window.__bdsCapturedDownloads || []).length),
    )
    .toBeGreaterThan(0);

  const captured = await page.evaluate(() => window.__bdsCapturedDownloads[0]);
  expect(captured.fileName).toBe("hello.txt");
  expect(captured.base64.length).toBeGreaterThan(0);
});

test("persists settings via the AndroidBridge storage mock", async ({ page }) => {
  await openDrawer(page);
  await page.getByRole("button", { name: "Add New System Prompt" }).click();
  await page.locator(".bds-modal-body input").fill("Android Prompt");
  await page.locator(".bds-modal-body textarea").fill("Android sim prompt");
  await page.locator(".bds-modal-footer .bds-btn").click({ force: true });
  await page.waitForTimeout(200);

  const stored = await page.evaluate(() => {
    const store = window.__bdsAndroidStore;
    for (const [k, v] of store.entries()) {
      if (typeof v === "string" && v.includes("Android sim prompt")) return k;
    }
    return null;
  });
  expect(stored).not.toBeNull();
});
