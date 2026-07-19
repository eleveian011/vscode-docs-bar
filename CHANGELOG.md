# Changelog

## 0.2.0

Reborn as a Notion-style webview.

- Rewrote the view as a webview for full visual control (airy rows, rounded selection, native color emoji).
- Markdown-only by default: shows folders + `.md` files, prunes empty folders, hides everything else.
- Emoji icons now apply to files too (not just folders); `.md` extension hidden in labels.
- Dropped the Twemoji dependency — emoji render as native OS color emoji.
- Git status (M/U/A/D/R) via the built-in git extension API.
- Custom HTML context menu, drag-to-reorder with before/after/into zones, keyboard shortcuts inside the view.

## 0.1.0

First release — native TreeView with emoji folder icons, aliases, manual sort, hidden entries, git status.
