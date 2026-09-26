// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const exporterMocks = vi.hoisted(() => ({ exportSession: vi.fn() }));
const pendingExportMocks = vi.hoisted(() => ({
  setPendingExport: vi.fn().mockResolvedValue(undefined),
  checkPendingExport: vi.fn(),
}));
const tagEditorMocks = vi.hoisted(() => ({ openTagEditor: vi.fn() }));

vi.mock("../../../src/content/tools/exporter.js", () => exporterMocks);
vi.mock("../../../src/content/tools/pending-export.js", () => pendingExportMocks);
vi.mock("../../../src/content/tags/tag-editor.js", () => tagEditorMocks);

function buildChatLink(href = "https://chat.deepseek.com/chat/s/test") {
  const link = document.createElement("a");
  link.href = href;
  const btn = document.createElement("button");
  btn.textContent = "...";
  link.appendChild(btn);
  document.body.appendChild(link);
  return { link, btn };
}

function buildDropdownMenu() {
  const menu = document.createElement("div");
  menu.className = "ds-dropdown-menu";
  const deleteOpt = document.createElement("div");
  deleteOpt.className = "ds-dropdown-menu-option";
  const deleteLabel = document.createElement("div");
  deleteLabel.className = "ds-dropdown-menu-option__label";
  deleteLabel.textContent = "Delete";
  deleteOpt.appendChild(deleteLabel);
  menu.appendChild(deleteOpt);
  document.body.appendChild(menu);
  return menu;
}

function buildDropdownMenuInto(parent) {
  const menu = document.createElement("div");
  menu.className = "ds-dropdown-menu";
  for (const text of ["Rename", "Delete"]) {
    const opt = document.createElement("div");
    opt.className = "ds-dropdown-menu-option";
    const label = document.createElement("div");
    label.className = "ds-dropdown-menu-option__label";
    label.textContent = text;
    opt.appendChild(label);
    menu.appendChild(opt);
  }
  parent.appendChild(menu);
  return menu;
}

/**
 * Round-2 B.1/B.2 fixture: DeepSeek's account popover with *translated* labels
 * and the signed-in user block (avatar + e-mail) that makes it recognisable
 * without English text.
 */
function buildLocalisedAccountMenu({
  official = "অফিসিয়াল সেটিংস",
  report = "সমস্যা জানান",
  download = "মোবাইল অ্যাপ ডাউনলোড করুন",
  logout = "লগ আউট",
  email = "user@example.com",
  extraEntries = [report, download],
  withAvatar = true,
} = {}) {
  const root = document.createElement("div");
  root.className = "mock-settings-menu";
  const menu = document.createElement("div");
  menu.className = "ds-dropdown-menu";

  if (withAvatar) {
    const header = document.createElement("div");
    header.className = "ds-dropdown-menu-option";
    header.innerHTML = `
      <img class="ds-avatar" src="https://cdn.deepseek.com/avatar/u1.png" alt="avatar" />
      <div class="ds-dropdown-menu-option__label">${email}</div>
    `;
    menu.appendChild(header);
  }

  const texts = [official, ...extraEntries, logout];
  for (const text of texts) {
    const opt = document.createElement("div");
    opt.className = "ds-dropdown-menu-option";
    opt.innerHTML = `
      <div class="ds-dropdown-menu-option__icon"></div>
      <div class="ds-dropdown-menu-option__label">${text}</div>
    `;
    menu.appendChild(opt);
  }

  root.appendChild(menu);
  document.body.appendChild(root);
  return { root, menu };
}

/** The sidebar account row: the only button that shows the user's avatar. */
function buildAccountTrigger() {
  const button = document.createElement("button");
  button.className = "_a1b2c3";
  button.setAttribute("aria-haspopup", "menu");
  button.innerHTML = `
    <img class="ds-avatar" src="https://cdn.deepseek.com/avatar/u1.png" alt="avatar" />
    <span>User Name</span>
  `;
  document.body.appendChild(button);
  return button;
}

function visibleLabels(menu) {
  return Array.from(menu.querySelectorAll(".ds-dropdown-menu-option"))
    .filter((row) => !row.hasAttribute("data-bds-hidden-entry"))
    .map((row) => row.querySelector(".ds-dropdown-menu-option__label")?.textContent.trim());
}

function buildSettingsDrawerMenu(labelText) {
  const menu = document.createElement("div");
  menu.className = "ds-dropdown-menu";
  const items = ["Settings", "Report issue", labelText, "Log out"];
  for (const text of items) {
    const opt = document.createElement("div");
    opt.className = "ds-dropdown-menu-option";
    const itemLabel = document.createElement("div");
    itemLabel.className = "ds-dropdown-menu-option__label";
    itemLabel.textContent = text;
    opt.appendChild(itemLabel);
    menu.appendChild(opt);
  }
  document.body.appendChild(menu);
  return menu;
}

describe("SidebarMenuInjector", () => {
  let initSidebarMenuInjector;
  let cleanup;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = "";
    const mod = await import("../../../src/content/ui/SidebarMenuInjector.js");
    initSidebarMenuInjector = mod.initSidebarMenuInjector;
    cleanup = initSidebarMenuInjector();
  });

  afterEach(() => {
    cleanup?.();
  });

  describe("URL capture via href-based mousedown listener", () => {
    it("captures URL when mousedown fires on the chat link element itself", async () => {
      const { link } = buildChatLink("https://chat.deepseek.com/chat/s/abc");
      link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      const menu = buildDropdownMenu();
      await vi.waitFor(() => expect(menu.querySelector(".bds-tags-option")).not.toBeNull());

      menu.querySelector(".bds-tags-option").click();
      await vi.waitFor(() =>
        expect(tagEditorMocks.openTagEditor).toHaveBeenCalledWith(
          "https://chat.deepseek.com/chat/s/abc"
        )
      );
    });

    it("captures URL when mousedown fires on a descendant inside the chat link (three-dot button)", async () => {
      const { btn } = buildChatLink("https://chat.deepseek.com/chat/s/xyz");
      btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      const menu = buildDropdownMenu();
      await vi.waitFor(() => expect(menu.querySelector(".bds-tags-option")).not.toBeNull());

      menu.querySelector(".bds-tags-option").click();
      await vi.waitFor(() =>
        expect(tagEditorMocks.openTagEditor).toHaveBeenCalledWith(
          "https://chat.deepseek.com/chat/s/xyz"
        )
      );
    });

    it("captures URL when mousedown fires on sibling button (button outside <a>, real Chrome/Firefox layout)", async () => {
      const container = document.createElement("div");
      const link = document.createElement("a");
      link.href = "https://chat.deepseek.com/chat/s/sibling";
      link.textContent = "Chat Title";
      const btn = document.createElement("button");
      btn.textContent = "...";
      container.appendChild(link);
      container.appendChild(btn);
      document.body.appendChild(container);

      btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      const menu = buildDropdownMenu();
      await vi.waitFor(() => expect(menu.querySelector(".bds-tags-option")).not.toBeNull());

      menu.querySelector(".bds-tags-option").click();
      await vi.waitFor(() =>
        expect(tagEditorMocks.openTagEditor).toHaveBeenCalledWith(
          "https://chat.deepseek.com/chat/s/sibling"
        )
      );
    });

    it("does not capture URL from mousedown outside any chat link", async () => {
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      const menu = buildDropdownMenu();
      await vi.waitFor(() => expect(menu.querySelector(".bds-tags-option")).not.toBeNull());

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      menu.querySelector(".bds-tags-option").click();

      await new Promise((r) => setTimeout(r, 100));
      expect(tagEditorMocks.openTagEditor).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[BDS]"));
      warnSpy.mockRestore();
    });

    it("updates captured URL on each mousedown (last click wins)", async () => {
      const { link: link1 } = buildChatLink("https://chat.deepseek.com/chat/s/first");
      const { link: link2 } = buildChatLink("https://chat.deepseek.com/chat/s/second");

      link1.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      link2.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

      const menu = buildDropdownMenu();
      await vi.waitFor(() => expect(menu.querySelector(".bds-tags-option")).not.toBeNull());

      menu.querySelector(".bds-tags-option").click();
      await vi.waitFor(() =>
        expect(tagEditorMocks.openTagEditor).toHaveBeenCalledWith(
          "https://chat.deepseek.com/chat/s/second"
        )
      );
    });
  });

  describe("menu injection via MutationObserver", () => {
    it("injects Tags and Export options when .ds-dropdown-menu is appended to DOM", async () => {
      const menu = buildDropdownMenu();
      await vi.waitFor(() => {
        expect(menu.querySelector(".bds-tags-option")).not.toBeNull();
        expect(menu.querySelector(".bds-export-option")).not.toBeNull();
      });
    });

    it("places Tags and Export options before Delete", async () => {
      const menu = buildDropdownMenu();
      await vi.waitFor(() => expect(menu.querySelector(".bds-tags-option")).not.toBeNull());

      const opts = Array.from(menu.querySelectorAll(".ds-dropdown-menu-option"));
      const tagsIdx = opts.findIndex((o) => o.classList.contains("bds-tags-option"));
      const exportIdx = opts.findIndex((o) => o.classList.contains("bds-export-option"));
      const deleteIdx = opts.findIndex((o) =>
        o.querySelector(".ds-dropdown-menu-option__label")?.textContent
          .toLowerCase()
          .includes("delete")
      );

      expect(tagsIdx).toBeGreaterThanOrEqual(0);
      expect(exportIdx).toBeGreaterThanOrEqual(0);
      expect(tagsIdx).toBeLessThan(deleteIdx);
      expect(exportIdx).toBeLessThan(deleteIdx);
    });

    it("does not inject BDS options twice into the same menu", async () => {
      const menu = buildDropdownMenu();
      await vi.waitFor(() => expect(menu.querySelector(".bds-export-option")).not.toBeNull());

      // Trigger backup click handler which rescans existing dropdown menus
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));

      expect(menu.querySelectorAll(".bds-tags-option")).toHaveLength(1);
      expect(menu.querySelectorAll(".bds-export-option")).toHaveLength(1);
    });

    it("injects into a nested chat .ds-dropdown-menu added as child of another node", async () => {
      const wrapper = document.createElement("div");
      const menu = buildDropdownMenuInto(wrapper);
      document.body.appendChild(wrapper);

      await vi.waitFor(() => expect(menu.querySelector(".bds-export-option")).not.toBeNull());
    });

    it("never injects chat entries into an account menu (BDS-UI F.5/D.6)", async () => {
      const menu = buildSettingsDrawerMenu("Get App");

      await vi.waitFor(() => expect(menu.querySelector(".bds-plugins-option")).not.toBeNull());
      await new Promise((r) => setTimeout(r, 150));

      expect(menu.querySelector(".bds-tags-option")).toBeNull();
      expect(menu.querySelector(".bds-export-option")).toBeNull();
    });
  });

  describe("account menu injection (BDS-UI F.5)", () => {
    it("injects Plugins and Advanced Settings before the native Settings item", async () => {
      const menu = buildSettingsDrawerMenu("Get App");
      await vi.waitFor(() => expect(menu.querySelector(".bds-plugins-option")).not.toBeNull());

      const labels = Array.from(menu.querySelectorAll(".ds-dropdown-menu-option")).map((o) =>
        o.querySelector(".ds-dropdown-menu-option__label")?.textContent.trim()
      );

      const settingsIdx = labels.indexOf("Official Settings");
      const advancedIdx = labels.indexOf("Advanced Settings");
      const pluginsIdx = labels.indexOf("Plugins");
      expect(pluginsIdx).toBe(0);
      expect(advancedIdx).toBe(1);
      // Round-2 B.2: the native row is relabelled so it cannot be confused with
      // the BDS screens.
      expect(settingsIdx).toBe(2);
      expect(labels).not.toContain("Settings");
      expect(labels).toContain("Log out");
      // Round-2 B.1: the extra native entries are hidden positionally, leaving
      // exactly Plugins / Advanced Settings / Official Settings / Log out.
      expect(visibleLabels(menu)).toEqual([
        "Plugins",
        "Advanced Settings",
        "Official Settings",
        "Log out",
      ]);
    });

    it("no longer injects Get BDS App or What's New (relocated to the drawer footer)", async () => {
      const menu = buildSettingsDrawerMenu("Download mobile App");
      await vi.waitFor(() => expect(menu.querySelector(".bds-plugins-option")).not.toBeNull());
      await new Promise((r) => setTimeout(r, 120));

      expect(menu.querySelector(".bds-get-app-option")).toBeNull();
      expect(menu.querySelector(".bds-whats-new-option")).toBeNull();
    });

    it("does not inject account options into chat context menus", async () => {
      const menu = buildDropdownMenu();
      await vi.waitFor(() => expect(menu.querySelector(".bds-export-option")).not.toBeNull());
      await new Promise((r) => setTimeout(r, 120));

      expect(menu.querySelector(".bds-plugins-option")).toBeNull();
      expect(menu.querySelector(".bds-advanced-settings-option")).toBeNull();
    });

    it("does not inject account options twice", async () => {
      const menu = buildSettingsDrawerMenu("Get App");
      await vi.waitFor(() => expect(menu.querySelector(".bds-plugins-option")).not.toBeNull());

      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 150));

      expect(menu.querySelectorAll(".bds-plugins-option")).toHaveLength(1);
      expect(menu.querySelectorAll(".bds-advanced-settings-option")).toHaveLength(1);
    });

    it("opens the drawer plugins section when Plugins is clicked", async () => {
      const stateModule = await import("../../../src/content/state.js");
      const appState = stateModule.default;
      const openDrawerSection = vi.fn();
      appState.ui = { openDrawerSection, showConfirm: vi.fn(() => Promise.resolve(true)) };

      const menu = buildSettingsDrawerMenu("Get App");
      await vi.waitFor(() => expect(menu.querySelector(".bds-plugins-option")).not.toBeNull());

      menu.querySelector(".bds-plugins-option").click();
      await new Promise((r) => setTimeout(r, 80));

      expect(openDrawerSection).toHaveBeenCalledWith("plugins");
    });

    it("opens the drawer advanced section when Advanced Settings is clicked", async () => {
      const stateModule = await import("../../../src/content/state.js");
      const appState = stateModule.default;
      const openDrawerSection = vi.fn();
      appState.ui = { openDrawerSection, showConfirm: vi.fn(() => Promise.resolve(true)) };

      const menu = buildSettingsDrawerMenu("Get App");
      await vi.waitFor(() =>
        expect(menu.querySelector(".bds-advanced-settings-option")).not.toBeNull()
      );

      menu.querySelector(".bds-advanced-settings-option").click();
      await new Promise((r) => setTimeout(r, 80));

      expect(openDrawerSection).toHaveBeenCalledWith("advanced");
    });
  });

  describe("Tags and Export handler warnings", () => {
    it("warns when Tags clicked with no captured URL", async () => {
      const menu = buildDropdownMenu();
      await vi.waitFor(() => expect(menu.querySelector(".bds-tags-option")).not.toBeNull());

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      menu.querySelector(".bds-tags-option").click();

      await new Promise((r) => setTimeout(r, 100));
      expect(tagEditorMocks.openTagEditor).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[BDS]"));
      warnSpy.mockRestore();
    });

    it("warns when Export Chat clicked with no captured URL", async () => {
      const menu = buildDropdownMenu();
      await vi.waitFor(() => expect(menu.querySelector(".bds-export-option")).not.toBeNull());

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      menu.querySelector(".bds-export-option").click();

      await new Promise((r) => setTimeout(r, 50));
      expect(exporterMocks.exportSession).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[BDS]"));
      warnSpy.mockRestore();
    });
  });
  describe("locale-proof detection (Round-2 B.1/B.2)", () => {
    const LOCALES = [
      {
        name: "Bengali",
        labels: {
          official: "অফিসিয়াল সেটিংস",
          report: "সমস্যা জানান",
          download: "মোবাইল অ্যাপ ডাউনলোড করুন",
          logout: "লগ আউট",
        },
      },
      {
        name: "Japanese",
        labels: {
          official: "公式設定",
          report: "問題を報告",
          download: "モバイルアプリをダウンロード",
          logout: "ログアウト",
        },
      },
    ];

    for (const locale of LOCALES) {
      it(`recognises the ${locale.name} account popover from its structure`, async () => {
        const { menu } = buildLocalisedAccountMenu(locale.labels);
        const mod0 = await import("../../../src/content/ui/SidebarMenuInjector.js");

        await vi.waitFor(() => expect(menu.querySelector(".bds-plugins-option")).not.toBeNull());

        const labels = visibleLabels(menu);
        // The signed-in user block stays first (kept, never relabelled), then
        // exactly Plugins / Advanced Settings / Official Settings / Log out.
        // The official-settings label is BDS's own translation (the app locale
        // is English in tests) — the *native* Bengali/Japanese label it
        // replaced is what proves detection worked.
        expect(labels).toEqual([
          "user@example.com",
          "Plugins",
          "Advanced Settings",
          "Official Settings",
          locale.labels.logout,
        ]);
        expect(menu.textContent).not.toContain(locale.labels.official);
        // The user block is neither relabelled nor hidden.
        expect(menu.querySelector(".ds-avatar")).not.toBeNull();
        expect(menu.textContent).toContain("user@example.com");
        // No chat entry leaked in.
        expect(menu.querySelector(".bds-tags-option")).toBeNull();
        expect(menu.querySelector(".bds-export-option")).toBeNull();
      });

      it(`recognises the ${locale.name} account popover from the tapped row`, async () => {
        const trigger = buildAccountTrigger();
        trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

        const { menu } = buildLocalisedAccountMenu({ ...locale.labels, withAvatar: false });
        await vi.waitFor(() => expect(menu.querySelector(".bds-plugins-option")).not.toBeNull());

        expect(visibleLabels(menu)).toContain("Official Settings");
      });

      it(`keeps chat menus chat-only in ${locale.name}`, async () => {
        const container = document.createElement("div");
        const link = document.createElement("a");
        link.href = "https://chat.deepseek.com/chat/s/localised";
        const btn = document.createElement("button");
        btn.textContent = "...";
        link.appendChild(btn);
        container.appendChild(link);
        document.body.appendChild(container);

        btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

        const menu = document.createElement("div");
        menu.className = "ds-dropdown-menu";
        for (const text of ["নাম পরিবর্তন", "মুছে ফেলুন"]) {
          const opt = document.createElement("div");
          opt.className = "ds-dropdown-menu-option";
          opt.innerHTML = `<div class="ds-dropdown-menu-option__label">${text}</div>`;
          menu.appendChild(opt);
        }
        document.body.appendChild(menu);

        await vi.waitFor(() => expect(menu.querySelector(".bds-export-option")).not.toBeNull());

        // Tags / Export land before the destructive (last) row and the account
        // entries stay out.
        const labelsInMenu = Array.from(menu.querySelectorAll(".ds-dropdown-menu-option")).map(
          (row) => row.querySelector(".ds-dropdown-menu-option__label")?.textContent.trim(),
        );
        expect(labelsInMenu).toEqual([
          "নাম পরিবর্তন",
          "Tags (BDS)",
          "Export Chat (BDS)",
          "মুছে ফেলুন",
        ]);
        expect(menu.querySelector(".bds-plugins-option")).toBeNull();
        expect(menu.querySelector(".bds-advanced-settings-option")).toBeNull();
      });
    }

    it("re-checked every scan: React re-render re-applies the Official Settings label", async () => {
      const { menu } = buildLocalisedAccountMenu();
      await vi.waitFor(() => expect(menu.querySelector(".bds-plugins-option")).not.toBeNull());

      // Simulate React re-rendering the popover: restore one native label and
      // ask for another scan via the document click backup path.
      const nativeRow = menu.querySelector(
        "[data-bds-official-settings]",
      );
      const labelNode = nativeRow.querySelector(".ds-dropdown-menu-option__label");
      labelNode.textContent = "সেটিংস";

      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(labelNode.textContent).toBe("Official Settings");
      expect(nativeRow.hasAttribute("data-bds-official-settings")).toBe(true);
    });

    it("classifies triggers without depending on language", async () => {
      const mod = await import("../../../src/content/ui/SidebarMenuInjector.js");
      const { classifyMenuTrigger } = mod;

      const accountTrigger = buildAccountTrigger();
      expect(classifyMenuTrigger(accountTrigger)).toBe("account");

      const row = document.createElement("div");
      const link = document.createElement("a");
      link.href = "https://chat.deepseek.com/chat/s/xyz";
      const threeDot = document.createElement("button");
      row.append(link, threeDot);
      document.body.appendChild(row);
      expect(classifyMenuTrigger(threeDot)).toBe("chat");

      const unrelated = document.createElement("div");
      unrelated.textContent = "no hints";
      document.body.appendChild(unrelated);
      expect(classifyMenuTrigger(unrelated)).toBeNull();
    });
  });
});
