# Changelog

## 0.5.0

- Dividers: add one from the toolbar's 更多 menu, drag it anywhere, delete it via its right-click menu. Stored as tokens inside the per-folder order.
- Glyph icons (folder/file) muted further toward a Notion-like light grey; emoji left at full color.
- Panel title restored (the native view header strip can't be removed by an extension).

## 0.4.0

- In-webview centered toolbar; per-row chevron removed; icons muted.

## 0.3.0

- Native context menu (webview/context), Lucide icons, jump-free drag indicator.

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
