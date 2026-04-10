const { Plugin, Notice, Menu } = require("obsidian");

class FileExplorerCheckboxes extends Plugin {
  checkedFiles = {};
  hiddenFiles = {};
  observer = null;
  styleEl = null;
  debounceTimer = null;
  isInjecting = false;

  async onload() {
    await this.loadData().then((data) => {
      if (data) {
        this.checkedFiles = data.checkedFiles || data || {};
        this.hiddenFiles = data.hiddenFiles || {};
      }
    });

    this.injectStyles();

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

    // Register the right-click context menu on files
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
              this.saveAllData();
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
        this.saveAllData();
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
        new Notice(
          `Progress: ${checked} / ${total - hiddenCount} notes checked (${hiddenCount} hidden)`
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
    if (this.styleEl) {
      this.styleEl.remove();
    }
  }

  injectStyles() {
    this.styleEl = document.createElement("style");
    this.styleEl.textContent = `
      .nav-file-title {
        display: flex !important;
        align-items: center !important;
      }
      .fec-checkbox-wrap {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        margin-right: 2px;
        position: relative;
        z-index: 50;
      }
      .fec-checkbox {
        width: 14px;
        height: 14px;
        cursor: pointer;
        accent-color: var(--interactive-accent);
        opacity: 0.5;
        transition: opacity 0.15s ease;
        margin: 0;
        padding: 0;
      }
      .fec-checkbox:hover {
        opacity: 1;
      }
      .fec-checkbox:checked {
        opacity: 1;
      }
      .nav-file-title.fec-checked .nav-file-title-content {
        opacity: 0.45;
        text-decoration: line-through;
        text-decoration-color: var(--text-faint);
      }
    `;
    document.head.appendChild(this.styleEl);
  }

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

        // If this file has checkboxes hidden, remove any existing and skip
        if (this.hiddenFiles[path]) {
          const existing = titleEl.querySelector(".fec-checkbox-wrap");
          if (existing) existing.remove();
          titleEl.classList.remove("fec-checked");
          return;
        }

        const existing = titleEl.querySelector(".fec-checkbox-wrap");
        if (existing) {
          const cb = existing.querySelector(".fec-checkbox");
          if (cb) {
            cb.checked = !!this.checkedFiles[path];
            titleEl.classList.toggle("fec-checked", !!this.checkedFiles[path]);
          }
          return;
        }

        // Create a wrapper div that eats all click/mouse events
        const wrapper = document.createElement("div");
        wrapper.className = "fec-checkbox-wrap";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "fec-checkbox";
        checkbox.checked = !!this.checkedFiles[path];

        if (this.checkedFiles[path]) {
          titleEl.classList.add("fec-checked");
        }

        // Block every event phase from reaching the nav-file-title
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
          this.saveAllData();
        });

        wrapper.appendChild(checkbox);
        titleEl.insertBefore(wrapper, titleEl.firstChild);
      });
    } finally {
      this.isInjecting = false;
      this.startObserver();
    }
  }

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

  async saveAllData() {
    await this.saveData({
      checkedFiles: this.checkedFiles,
      hiddenFiles: this.hiddenFiles,
    });
  }
}

module.exports = FileExplorerCheckboxes;