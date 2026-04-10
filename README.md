# Checka

An Obsidian plugin that adds checkboxes to your file explorer with built-in spaced repetition. Check off a note, rate how well you know it, and Checka schedules when you should review it next.

## How it works

Every note in your file explorer gets a checkbox. When you check one off, a popup asks you to rate your confidence:

- **Hard** - you struggled with it. Review again in 1 day, growing by x1.2 each time.
- **Meh** - you sort of know it. Review in 2 days, growing by x1.5.
- **Great** - you've got it down. Review in 4 days, growing by x2.

The intervals compound on each review, so a note you keep rating "Great" spaces out to 4, 8, 16, 32 days and so on. Rating "Hard" pulls it back in.

Notes that are due for review get a red `!` badge. Notes due within 24 hours get a `~` badge. Reviewed notes that aren't due yet fade out with a strikethrough so you can focus on what's left.

## Features

- Checkbox next to every note in the file explorer
- Spaced repetition with three confidence levels (Hard, Meh, Great)
- Due/overdue badges on notes that need reviewing
- Clicking the checkbox does not open the note
- Right-click any note to hide its checkbox or reset its review data
- State follows file renames and cleans up after deletions
- Stale entries from deleted files are pruned automatically on startup
- Auto-migrates data from earlier versions of the plugin

### Commands

Open the command palette and search for "Checka":

- **Show review progress** - how many notes reviewed, how many due, percentage complete
- **Show notes due for review** - lists notes that are due right now
- **Clear all review data** - reset everything

### Settings

In Settings > Checka:

- Toggle strikethrough on reviewed notes
- Adjust opacity for reviewed notes and unchecked checkboxes
- Toggle due badges on/off
- Clear all review data or reset hidden files

## Installation

### Via BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from community plugins
2. In BRAT settings, click "Add Beta plugin"
3. Enter the GitHub repo URL
4. Enable Checka in Settings > Community plugins

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the latest release
2. Create `YOUR_VAULT/.obsidian/plugins/checka/`
3. Drop the three files in
4. Reload Obsidian and enable the plugin

## Known limitations

- The plugin injects checkboxes into the file explorer DOM directly because Obsidian has no public API for adding sidebar elements. If a future Obsidian update changes internal class names (`nav-file-title`, `nav-files-container`), the plugin may need updating.
- Checkboxes appear on files only, not folders.
- Spaced repetition intervals are not currently user-configurable (planned for a future release).

## License

MIT
