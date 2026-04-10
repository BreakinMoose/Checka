const { Plugin, Notice, PluginSettingTab, Setting, Modal } = require("obsidian");

const DEFAULT_SETTINGS = {
  showStrikethrough: true,
  checkedOpacity: 0.45,
  uncheckedCheckboxOpacity: 0.5,
  showDueBadges: true,
};

const SR_INTERVALS = {
  hard: { base: 1, multiplier: 1.2 },
  meh: { base: 2, multiplier: 1.5 },
  great: { base: 4, multiplier: 2.0 },
};

class RatingModal extends Modal {
  constructor(app, filePath, onRate) {
    super(app);
    this.filePath = filePath;
    this.onRate = onRate;
    this.rated = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("checka-rating-modal");

    const fileName = this.filePath.split("/").pop().replace(/\.md$/, "");
    contentEl.createEl("p", {
      text: `How well do you know "${fileName}"?`,
      cls: "checka-rating-question",
    });

    const btnContainer = contentEl.createDiv({ cls: "checka-rating-buttons" });

    const makeBtn = (label, rating, cls) => {
      const btn = btnContainer.createEl("button", {
        text: label,
        cls: `checka-rating-btn checka-rating-${cls}`,
      });
      btn.addEventListener("click", () => {
        this.rated = true;
        this.onRate(rating);
        this.close();
      });
    };

    makeBtn("Hard", "hard", "hard");
    makeBtn("Meh", "meh", "meh");
    makeBtn("Great", "great", "great");
  }

  onClose() {
    this.contentEl.empty();
  }
}

class Checka extends Plugin {
  fileData = {};
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

    this.addSettingTab(new CheckaSettingTab(this.app, this));

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

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (this.fileData[oldPath] !== undefined) {
          this.fileData[file.path] = this.fileData[oldPath];
          delete this.fileData[oldPath];
        }
        if (this.hiddenFiles[oldPath] !== undefined) {
          this.hiddenFiles[file.path] = this.hiddenFiles[oldPath];
          delete this.hiddenFiles[oldPath];
        }
        this.savePersistedState();
        this.debouncedInject();
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        delete this.fileData[file.path];
        delete this.hiddenFiles[file.path];
        this.savePersistedState();
      })
    );

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
                delete this.fileData[path];
              }
              this.savePersistedState();
              this.forceReinject();
            });
        });

        if (this.fileData[path]) {
          menu.addItem((item) => {
            item
              .setTitle("Reset review data")
              .setIcon("rotate-ccw")
              .onClick(() => {
                delete this.fileData[path];
                this.savePersistedState();
                this.forceReinject();
                new Notice("Review data reset");
              });
          });
        }
      })
    );

    this.addCommand({
      id: "clear-all-reviews",
      name: "Clear all review data",
      callback: () => {
        this.fileData = {};
        this.savePersistedState();
        this.forceReinject();
        new Notice("All review data cleared");
      },
    });

    this.addCommand({
      id: "show-review-progress",
      name: "Show review progress",
      callback: () => {
        const total = this.app.vault.getMarkdownFiles().length;
        const hiddenCount = Object.keys(this.hiddenFiles).length;
        const reviewed = Object.keys(this.fileData).length;
        const trackable = total - hiddenCount;
        const now = Date.now();
        let dueCount = 0;
        for (const entry of Object.values(this.fileData)) {
          if (entry.nextReview && entry.nextReview <= now) dueCount++;
        }
        const pct = trackable > 0 ? Math.round((reviewed / trackable) * 100) : 0;
        new Notice(
          `Reviewed: ${reviewed}/${trackable} (${pct}%)\nDue now: ${dueCount}\nHidden: ${hiddenCount}`
        );
      },
    });

    this.addCommand({
      id: "show-due-notes",
      name: "Show notes due for review",
      callback: () => {
        const now = Date.now();
        const due = [];
        for (const [path, entry] of Object.entries(this.fileData)) {
          if (entry.nextReview && entry.nextReview <= now) {
            due.push(path.split("/").pop().replace(/\.md$/, ""));
          }
        }
        if (due.length === 0) {
          new Notice("Nothing due for review right now!");
        } else {
          new Notice(
            `Due for review (${due.length}):\n${due.slice(0, 15).join("\n")}${due.length > 15 ? `\n...and ${due.length - 15} more` : ""}`
          );
        }
      },
    });
  }

  onunload() {
    if (this.observer) this.observer.disconnect();
    document.querySelectorAll(".checka-wrap").forEach((el) => el.remove());
    document
      .querySelectorAll(".checka-reviewed, .checka-due-soon, .checka-overdue")
      .forEach((el) => el.classList.remove("checka-reviewed", "checka-due-soon", "checka-overdue"));
    this.removeDynamicStyles();
  }

  // --- Spaced repetition ---

  getNextReview(rating, entry) {
    const sr = SR_INTERVALS[rating];
    let newInterval;

    if (!entry || !entry.interval) {
      newInterval = sr.base;
    } else {
      newInterval = Math.max(1, Math.ceil(entry.interval * sr.multiplier));
    }

    return {
      interval: newInterval,
      nextReview: Date.now() + newInterval * 24 * 60 * 60 * 1000,
      lastReview: Date.now(),
      lastRating: rating,
      reviewCount: (entry?.reviewCount || 0) + 1,
    };
  }

  getDueStatus(path) {
    const entry = this.fileData[path];
    if (!entry || !entry.nextReview) return "none";
    const hoursLeft = (entry.nextReview - Date.now()) / (1000 * 60 * 60);
    if (hoursLeft <= 0) return "overdue";
    if (hoursLeft <= 24) return "due-soon";
    return "reviewed";
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

  // --- Persisted state ---

  async loadPersistedState() {
    const stored = await this.loadData();
    if (!stored) return;

    if (stored.fileData) {
      this.fileData = stored.fileData;
      this.hiddenFiles = stored.hiddenFiles || {};
    } else if (stored.checkedFiles) {
      this.fileData = {};
      for (const [path, checked] of Object.entries(stored.checkedFiles)) {
        if (checked) {
          this.fileData[path] = {
            interval: 1,
            nextReview: Date.now(),
            lastReview: Date.now(),
            lastRating: "meh",
            reviewCount: 1,
          };
        }
      }
      this.hiddenFiles = stored.hiddenFiles || {};
      await this.saveAllData();
    }
  }

  async savePersistedState() {
    await this.saveAllData();
  }

  async saveAllData() {
    await this.saveData({
      fileData: this.fileData,
      hiddenFiles: this.hiddenFiles,
      settings: this.settings,
    });
  }

  cleanStalePaths() {
    const allPaths = new Set(this.app.vault.getFiles().map((f) => f.path));
    let changed = false;
    for (const path of Object.keys(this.fileData)) {
      if (!allPaths.has(path)) { delete this.fileData[path]; changed = true; }
    }
    for (const path of Object.keys(this.hiddenFiles)) {
      if (!allPaths.has(path)) { delete this.hiddenFiles[path]; changed = true; }
    }
    if (changed) this.saveAllData();
  }

  // --- Styles ---

  updateDynamicStyles() {
    this.removeDynamicStyles();
    const el = document.createElement("style");
    el.id = "checka-dynamic-styles";

    const strike = this.settings.showStrikethrough
      ? `text-decoration: line-through; text-decoration-color: var(--text-faint);`
      : `text-decoration: none;`;

    el.textContent = `
      .checka-cb {
        opacity: ${this.settings.uncheckedCheckboxOpacity};
      }
      .checka-cb:hover, .checka-cb:checked {
        opacity: 1;
      }
      .nav-file-title.checka-reviewed .nav-file-title-content {
        opacity: ${this.settings.checkedOpacity};
        ${strike}
      }
    `;
    document.head.appendChild(el);
  }

  removeDynamicStyles() {
    document.getElementById("checka-dynamic-styles")?.remove();
  }

  // --- Injection ---

  debouncedInject() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.injectCheckboxes(), 200);
  }

  forceReinject() {
    document.querySelectorAll(".checka-wrap").forEach((el) => el.remove());
    document
      .querySelectorAll(".checka-reviewed, .checka-due-soon, .checka-overdue")
      .forEach((el) => el.classList.remove("checka-reviewed", "checka-due-soon", "checka-overdue"));
    this.injectCheckboxes();
  }

  injectCheckboxes() {
    if (this.isInjecting) return;
    this.isInjecting = true;
    if (this.observer) this.observer.disconnect();

    try {
      const fileItems = document.querySelectorAll(".nav-file-title");

      fileItems.forEach((titleEl) => {
        const path = titleEl.dataset.path;
        if (!path) return;

        if (this.hiddenFiles[path]) {
          const existing = titleEl.querySelector(".checka-wrap");
          if (existing) existing.remove();
          titleEl.classList.remove("checka-reviewed", "checka-due-soon", "checka-overdue");
          return;
        }

        const dueStatus = this.getDueStatus(path);
        const hasData = !!this.fileData[path];

        titleEl.classList.remove("checka-reviewed", "checka-due-soon", "checka-overdue");
        if (dueStatus === "overdue") titleEl.classList.add("checka-overdue");
        else if (dueStatus === "due-soon") titleEl.classList.add("checka-due-soon");
        else if (dueStatus === "reviewed") titleEl.classList.add("checka-reviewed");

        const existing = titleEl.querySelector(".checka-wrap");
        if (existing) {
          const cb = existing.querySelector(".checka-cb");
          if (cb) cb.checked = hasData;
          this.updateBadge(existing, path);
          return;
        }

        const wrapper = document.createElement("div");
        wrapper.className = "checka-wrap";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "checka-cb";
        checkbox.checked = hasData;

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
          if (checkbox.checked) {
            const modal = new RatingModal(this.app, path, (rating) => {
              this.fileData[path] = this.getNextReview(rating, this.fileData[path]);
              this.savePersistedState();
              this.forceReinject();
              const days = this.fileData[path].interval;
              new Notice(`Rated "${rating}" - next review in ${days} day${days !== 1 ? "s" : ""}`);
            });
            modal.open();

            // If closed without rating, uncheck
            const origOnClose = modal.onClose.bind(modal);
            modal.onClose = () => {
              origOnClose();
              if (!modal.rated) {
                checkbox.checked = false;
              }
            };
          } else {
            delete this.fileData[path];
            this.savePersistedState();
            titleEl.classList.remove("checka-reviewed", "checka-due-soon", "checka-overdue");
            this.updateBadge(wrapper, path);
          }
        });

        wrapper.appendChild(checkbox);
        this.updateBadge(wrapper, path);
        titleEl.insertBefore(wrapper, titleEl.firstChild);
      });
    } finally {
      this.isInjecting = false;
      this.startObserver();
    }
  }

  updateBadge(wrapper, path) {
    let badge = wrapper.querySelector(".checka-badge");
    const entry = this.fileData[path];

    if (!entry || !this.settings.showDueBadges) {
      if (badge) badge.remove();
      return;
    }

    const status = this.getDueStatus(path);
    if (status === "reviewed") {
      if (badge) badge.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement("span");
      badge.className = "checka-badge";
      wrapper.appendChild(badge);
    }

    if (status === "overdue") {
      badge.textContent = "!";
      badge.title = "Due for review";
    } else if (status === "due-soon") {
      badge.textContent = "~";
      badge.title = "Due within 24h";
    }
  }

  // --- Observer ---

  startObserver() {
    if (this.observer) this.observer.disconnect();

    const explorerEl = document.querySelector(".nav-files-container");
    if (!explorerEl) return;

    this.observer = new MutationObserver((mutations) => {
      const dominated = mutations.every((m) => {
        if (m.type === "childList") {
          for (const node of m.addedNodes) {
            if (
              node.nodeType === 1 &&
              (node.classList?.contains("checka-wrap") ||
                node.classList?.contains("checka-cb") ||
                node.classList?.contains("checka-badge"))
            ) {
              return true;
            }
          }
        }
        if (m.type === "attributes" && m.attributeName === "class") return true;
        return false;
      });

      if (!dominated) this.debouncedInject();
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

class CheckaSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Checka" });
    containerEl.createEl("h3", { text: "Appearance" });

    new Setting(containerEl)
      .setName("Strikethrough reviewed notes")
      .setDesc("Show a strikethrough on the file name when reviewed.")
      .addToggle((t) => t.setValue(this.plugin.settings.showStrikethrough).onChange(async (v) => {
        this.plugin.settings.showStrikethrough = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Reviewed note opacity")
      .setDesc("How faded reviewed notes appear (0.1 = very faded, 1.0 = normal).")
      .addSlider((s) => s.setLimits(0.1, 1.0, 0.05).setValue(this.plugin.settings.checkedOpacity).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.checkedOpacity = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Unchecked checkbox opacity")
      .setDesc("How visible unchecked checkboxes are.")
      .addSlider((s) => s.setLimits(0.1, 1.0, 0.05).setValue(this.plugin.settings.uncheckedCheckboxOpacity).setDynamicTooltip().onChange(async (v) => {
        this.plugin.settings.uncheckedCheckboxOpacity = v;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Show due badges")
      .setDesc("Show ! or ~ indicators on notes that are due or nearly due for review.")
      .addToggle((t) => t.setValue(this.plugin.settings.showDueBadges).onChange(async (v) => {
        this.plugin.settings.showDueBadges = v;
        await this.plugin.saveSettings();
      }));

    containerEl.createEl("h3", { text: "Spaced repetition" });
    containerEl.createEl("p", {
      text: "Hard = 1 day first review, x1.2 growth. Meh = 2 days, x1.5. Great = 4 days, x2. Intervals compound each review.",
      cls: "setting-item-description",
    });

    containerEl.createEl("h3", { text: "Data" });

    new Setting(containerEl)
      .setName("Clear all review data")
      .setDesc("Remove all review history. Cannot be undone.")
      .addButton((b) => b.setButtonText("Clear all").setWarning().onClick(async () => {
        this.plugin.fileData = {};
        await this.plugin.savePersistedState();
        this.plugin.forceReinject();
        new Notice("All review data cleared");
      }));

    new Setting(containerEl)
      .setName("Reset hidden files")
      .setDesc("Show checkboxes on all files again.")
      .addButton((b) => b.setButtonText("Reset").setWarning().onClick(async () => {
        this.plugin.hiddenFiles = {};
        await this.plugin.savePersistedState();
        this.plugin.forceReinject();
        new Notice("All checkboxes restored");
      }));
  }
}

module.exports = Checka;
