const { Plugin, Notice, PluginSettingTab, Setting } = require("obsidian");

const DEFAULT_SETTINGS = {
  showStrikethrough: true,
  checkedOpacity: 0.45,
  uncheckedCheckboxOpacity: 0.5,
};

class FileExplorerCheckboxes extends Plugin {
  checkedFiles = {};
  hiddenFiles = {};
  settings = {};
  observer = null;
  debounceTimer = null;
  isInjecting = false;

  async onload() {
    await this.loadSettings();
    await this.loadPersistedState();
    this.cleanStalePaths();
    this.updateDynamicStyles();

    this.addSettingTab(new CheckboxSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      setTimeout(() => {
        this.injectCheckboxes();
        this.startObserver();
      }, 500);
    });

    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.debouncedInject();
      })
    );

    // Track file renames so checked/hidden state follows the file
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (this.checkedFiles[oldPath] !== undefined) {
          this.checkedFiles[file.path] = this.checkedFiles[oldPath];
          delete this.checkedFiles[oldPath];
        }
        if (this.hiddenFiles[oldPath] !== undefined) {
          this.hiddenFiles[file.path] = this.hiddenFiles[oldPath];
          delete this.hiddenFiles[oldPath];
        }
        this.savePersistedState();
        this.debouncedInject();
      })
    );

    // Clean up deleted files
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        delete this.checkedFiles[file.path];
        delete this.hiddenFiles[file.path];
        this.savePersistedState();
      })
    );

    // Right-click context menu
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        const path = file.path;
        if (!path) return;

        const isHidden = !!this.hiddenFiles[path];

        menu.addItem((item) => {
          item
            .setTitle(isHidden ? "Show checkbox" : "Hide checkbox")
            .setIcon(isHidden ? "check-square" : "square")
            .onClick(() => {
              if (isHidden) {
                delete this.hiddenFiles[path];
              } else {
                this.hiddenFiles[path] = true;
                delete this.checkedFiles[path];
              }
              this.savePersistedState();
              this.forceReinject();
            });
        });
      })
    );

    this.addCommand({
      id: "clear-all-checkboxes",
      name: "Clear all file explorer checkboxes",
      callback: () => {
        this.checkedFiles = {};
        this.savePersistedState();
        document.querySelectorAll(".fec-checkbox").forEach((cb) => {
          cb.checked = false;
          cb.closest(".nav-file-title")?.classList.remove("fec-checked");
        });
        new Notice("All checkboxes cleared");
      },
    });

    this.addCommand({
      id: "show-checkbox-progress",
      name: "Show file explorer checkbox progress",
      callback: () => {
        const total = this.app.vault.getMarkdownFiles().length;
        const hiddenCount = Object.keys(this.hiddenFiles).length;
        const checked = Object.values(this.checkedFiles).filter(Boolean).length;
        const trackable = total - hiddenCount;
        const pct = trackable > 0 ? Math.round((checked / trackable) * 100) : 0;
        new Notice(
          `Progress: ${checked}/${trackable} checked (${pct}%) \u2022 ${hiddenCount} hidden`
        );
      },
    });
  }

  onunload() {
    if (this.observer) {
      this.observer.disconnect();
    }
    document.querySelectorAll(".fec-checkbox-wrap").forEach((el) => el.remove());
    document
      .querySelectorAll(".fec-checked")
      .forEach((el) => el.classList.remove("fec-checked"));
    this.removeDynamicStyles();
  }

  // --- Settings ---

  async loadSettings() {
    const stored = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored?.settings || {});
  }

  async saveSettings() {
    await this.saveAllData();
    this.updateDynamicStyles();
    this.forceReinject();
  }

  // --- Persisted state (checked/hidden files) ---

  async loadPersistedState() {
    const stored = await this.loadData();
    if (!stored) return;

    // Handle migration from old flat format
    if (stored.checkedFiles) {
      this.checkedFiles = stored.checkedFiles;
      this.hiddenFiles = stored.hiddenFiles || {};
    } else if (!stored.settings && !stored.hiddenFiles) {
      // Old format: the entire object was checkedFiles
      this.checkedFiles = stored;
      this.hiddenFiles = {};
      // Migrate immediately
      await this.saveAllData();
    }
  }

  async savePersistedState() {
    await this.saveAllData();
  }

  async saveAllData() {
    await this.saveData({
      checkedFiles: this.checkedFiles,
      hiddenFiles: this.hiddenFiles,
      settings: this.settings,
    });
  }

  cleanStalePaths() {
    const allPaths = new Set(
      this.app.vault.getFiles().map((f) => f.path)
    );

    let changed = false;

    for (const path of Object.keys(this.checkedFiles)) {
      if (!allPaths.has(path)) {
        delete this.checkedFiles[path];
        changed = true;
      }
    }

    for (const path of Object.keys(this.hiddenFiles)) {
      if (!allPaths.has(path)) {
        delete this.hiddenFiles[path];
        changed = true;
      }
    }

    if (changed) {
      this.saveAllData();
    }
  }

  // --- Dynamic styles (settings-dependent) ---

  updateDynamicStyles() {
    this.removeDynamicStyles();

    const el = document.createElement("style");
    el.id = "fec-dynamic-styles";

    const strikethrough = this.settings.showStrikethrough
      ? `text-decoration: line-through; text-decoration-color: var(--text-faint);`
      : `text-decoration: none;`;

    el.textContent = `
      .fec-checkbox {
        opacity: ${this.settings.uncheckedCheckboxOpacity};
      }
      .fec-checkbox:hover,
      .fec-checkbox:checked {
        opacity: 1;
      }
      .nav-file-title.fec-checked .nav-file-title-content {
        opacity: ${this.settings.checkedOpacity};
        ${strikethrough}
      }
    `;

    document.head.appendChild(el);
  }

  removeDynamicStyles() {
    document.getElementById("fec-dynamic-styles")?.remove();
  }

  // --- Checkbox injection ---

  debouncedInject() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.injectCheckboxes();
    }, 200);
  }

  forceReinject() {
    document.querySelectorAll(".fec-checkbox-wrap").forEach((el) => el.remove());
    document
      .querySelectorAll(".fec-checked")
      .forEach((el) => el.classList.remove("fec-checked"));
    this.injectCheckboxes();
  }

  injectCheckboxes() {
    if (this.isInjecting) return;
    this.isInjecting = true;

    if (this.observer) {
      this.observer.disconnect();
    }

    try {
      const fileItems = document.querySelectorAll(".nav-file-title");

      fileItems.forEach((titleEl) => {
        const path = titleEl.dataset.path;
        if (!path) return;

        // Hidden files get no checkbox
        if (this.hiddenFiles[path]) {
          const existing = titleEl.querySelector(".fec-checkbox-wrap");
          if (existing) existing.remove();
          titleEl.classList.remove("fec-checked");
          return;
        }

        // Already injected, just sync
        const existing = titleEl.querySelector(".fec-checkbox-wrap");
        if (existing) {
          const cb = existing.querySelector(".fec-checkbox");
          if (cb) {
            cb.checked = !!this.checkedFiles[path];
            titleEl.classList.toggle("fec-checked", !!this.checkedFiles[path]);
          }
          return;
        }

        // Create wrapper that blocks events from reaching file explorer
        const wrapper = document.createElement("div");
        wrapper.className = "fec-checkbox-wrap";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "fec-checkbox";
        checkbox.checked = !!this.checkedFiles[path];

        if (this.checkedFiles[path]) {
          titleEl.classList.add("fec-checked");
        }

        const blockEvent = (e) => {
          e.stopPropagation();
          e.stopImmediatePropagation();
        };

        wrapper.addEventListener("mousedown", blockEvent, true);
        wrapper.addEventListener("mouseup", blockEvent, true);
        wrapper.addEventListener("click", blockEvent, true);
        wrapper.addEventListener("dblclick", blockEvent, true);
        wrapper.addEventListener("auxclick", blockEvent, true);
        wrapper.addEventListener("pointerdown", blockEvent, true);
        wrapper.addEventListener("pointerup", blockEvent, true);

        checkbox.addEventListener("change", () => {
          this.checkedFiles[path] = checkbox.checked;
          titleEl.classList.toggle("fec-checked", checkbox.checked);
          this.savePersistedState();
        });

        wrapper.appendChild(checkbox);
        titleEl.insertBefore(wrapper, titleEl.firstChild);
      });
    } finally {
      this.isInjecting = false;
      this.startObserver();
    }
  }

  // --- Mutation observer ---

  startObserver() {
    if (this.observer) {
      this.observer.disconnect();
    }

    const explorerEl = document.querySelector(".nav-files-container");
    if (!explorerEl) return;

    this.observer = new MutationObserver((mutations) => {
      const dominated = mutations.every((m) => {
        if (m.type === "childList") {
          for (const node of m.addedNodes) {
            if (
              node.nodeType === 1 &&
              (node.classList?.contains("fec-checkbox-wrap") ||
                node.classList?.contains("fec-checkbox"))
            ) {
              return true;
            }
          }
        }
        if (m.type === "attributes" && m.attributeName === "class") {
          return true;
        }
        return false;
      });

      if (!dominated) {
        this.debouncedInject();
      }
    });

    this.observer.observe(explorerEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }
}

// --- Settings tab ---

class CheckboxSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "File Explorer Checkboxes" });

    new Setting(containerEl)
      .setName("Strikethrough checked notes")
      .setDesc("Show a strikethrough on the file name when checked.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showStrikethrough)
          .onChange(async (value) => {
            this.plugin.settings.showStrikethrough = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Checked note opacity")
      .setDesc("How faded checked notes appear (0.1 = very faded, 1.0 = normal).")
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 1.0, 0.05)
          .setValue(this.plugin.settings.checkedOpacity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.checkedOpacity = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Unchecked checkbox opacity")
      .setDesc("How visible unchecked checkboxes are (lower = more subtle).")
      .addSlider((slider) =>
        slider
          .setLimits(0.1, 1.0, 0.05)
          .setValue(this.plugin.settings.uncheckedCheckboxOpacity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.uncheckedCheckboxOpacity = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "Data" });

    new Setting(containerEl)
      .setName("Clear all checkboxes")
      .setDesc("Uncheck every note. This cannot be undone.")
      .addButton((btn) =>
        btn
          .setButtonText("Clear all")
          .setWarning()
          .onClick(async () => {
            this.plugin.checkedFiles = {};
            await this.plugin.savePersistedState();
            this.plugin.forceReinject();
            new Notice("All checkboxes cleared");
          })
      );

    new Setting(containerEl)
      .setName("Reset hidden files")
      .setDesc("Show checkboxes on all files again.")
      .addButton((btn) =>
        btn
          .setButtonText("Reset")
          .setWarning()
          .onClick(async () => {
            this.plugin.hiddenFiles = {};
            await this.plugin.savePersistedState();
            this.plugin.forceReinject();
            new Notice("All checkboxes restored");
          })
      );
  }
}

module.exports = FileExplorerCheckboxes;
