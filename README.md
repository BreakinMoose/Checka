# File Explorer Checkboxes

An Obsidian plugin that adds checkboxes next to your notes in the file explorer sidebar. Click them to track which notes you've reviewed, revised, or finished with.

![Obsidian](https://img.shields.io/badge/Obsidian-v1.0.0+-7C3AED)

## What it does

Each note in your file explorer gets a small checkbox. Checking it crosses the note name out and fades it, so you can see at a glance what you've been through and what's left. The checked state persists across sessions.

You can hide checkboxes on specific notes via the right-click menu if you don't want them cluttering up non-relevant files (templates, config notes, etc.).

## Features

- Checkbox next to every note in the file explorer
- Checked notes get a strikethrough and fade (both configurable)
- Right-click any note to hide/show its checkbox
- Clicking the checkbox does not open the note
- State follows file renames and cleans up after deletions
- Command palette: "Show file explorer checkbox progress" for a quick count
- Command palette: "Clear all file explorer checkboxes" to reset
- Settings tab to tweak strikethrough, opacity, and manage data

## Installation

### Via BRAT (recommended for now)

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin from Obsidian community plugins
2. In BRAT settings, click "Add Beta plugin"
3. Enter the GitHub repo URL
4. Enable the plugin in Settings > Community plugins

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the latest release
2. Create a folder at `YOUR_VAULT/.obsidian/plugins/file-explorer-checkboxes/`
3. Drop the three files in
4. Reload Obsidian
5. Enable the plugin in Settings > Community plugins

## Settings

In Settings > File Explorer Checkboxes you can:

- **Strikethrough checked notes** - toggle the line-through on/off
- **Checked note opacity** - how faded checked notes appear (0.1 very faded, 1.0 normal)
- **Unchecked checkbox opacity** - how visible unchecked checkboxes are (lower = more subtle until you hover)
- **Clear all checkboxes** - uncheck everything at once
- **Reset hidden files** - re-enable checkboxes on notes you previously hid

## Known limitations

- This plugin manipulates the file explorer DOM directly because Obsidian doesn't expose a public API for adding elements to the sidebar. If a future Obsidian update changes the internal CSS class names (`nav-file-title`, `nav-files-container`), the plugin may need updating.
- Checkboxes only appear on files, not folders.

## License

MIT
