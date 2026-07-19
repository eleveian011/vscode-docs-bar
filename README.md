# Docs Bar

A lightweight, standalone **document navigator** for VS Code — a second tree that lives beside the built-in Explorer and gives you the two things the native Explorer can't:

- 🎨 **Emoji folder icons**, set per *exact path* (not just by folder name)
- ↕️ **Custom drag-to-reorder**, persisted per folder

Plus display-name aliases, hidden entries, and git status — all without touching your real files or your existing icon theme.

> **This does not replace the Explorer.** It's a focused companion view for browsing and editing a documentation tree. Keep using the built-in Explorer for heavy file work (and for dragging files out to Finder — see [Limitations](#limitations)).

## Features

| | |
|---|---|
| **Emoji icons** | Right-click a folder → *设置图标 (emoji)* → search a Twemoji picker. Stored by exact path, so `a/utils` and `b/utils` can differ. |
| **Display names** | Right-click → *设置显示名* to show an alias while the real filename stays put. |
| **Manual sort** | Drag items to reorder; the order is saved per folder. Drag onto a folder to move into it. |
| **Hide entries** | Hide doc-irrelevant files/folders from this view (they stay on disk). |
| **Git status** | M / U / A decorations and colors, inherited from VS Code's git provider. |
| **Icons for everything else** | Non-emoji items keep whatever your active file-icon theme (e.g. Material Icon Theme) draws. |
| **Toolbar** | New file · New folder · Expand all · Collapse all · Refresh. |
| **Context menu** | Rename · Copy · Paste · Duplicate · Copy path · Copy relative path · Set icon · Set alias · Hide · Reveal in Finder · Delete. |
| **Shortcuts** (view focused) | `F2` rename · `⌘C`/`⌘V` copy/paste · `⌘D` duplicate · `⌘⌫` delete · `⌘⌥C` copy path. |

## How it works

Docs Bar is a `TreeView`. Each row carries its own `iconPath`, so emoji icons attach to individual paths — there's no all-or-nothing icon theme to fight with. Rows also set `resourceUri`, which is what lets git decorations and your file-icon theme apply to everything that *doesn't* have a custom emoji. Icons, aliases, order and hidden lists are stored in your workspace's `.vscode/settings.json` under `docsBar.*`, so they travel with the repo.

## Limitations

Honest boundaries, because it's a `TreeView` and not the real Explorer:

- **Dragging files *out* to other apps (Finder, browser, …) is not supported.** That's a native ability only the built-in Explorer has; no extension can do it. Use the built-in Explorer for that one action.
- The context menu is a **hand-built subset** of the Explorer's. Menu items contributed by *other* extensions (GitLens, etc.) won't appear here.
- Icons match by exact path, but VS Code has no per-path API for the built-in explorer — this view sidesteps that by drawing its own tree.
- Dragging files *in* from the OS is best-effort and varies by VS Code version.

## Settings

| Setting | Description |
|---|---|
| `docsBar.root` | Subfolder (relative to the workspace root) to show as the tree root. Empty = whole workspace. |
| `docsBar.icons` | `{ path: emoji }` map (managed via right-click). |
| `docsBar.aliases` | `{ path: displayName }` map. |
| `docsBar.order` | `{ parentPath: [names…] }` manual order. |
| `docsBar.hidden` | Paths hidden in this view. |
| `docsBar.alwaysHide` | Names always hidden (default `.git`, `.DS_Store`). |

## Develop

```bash
npm install        # installs deps + copies Twemoji svgs into assets/
npm run watch      # esbuild in watch mode
# press F5 in VS Code to launch the Extension Development Host
npm run package    # build a .vsix
```

## License

MIT. Bundles [Twemoji](https://github.com/jdecked/twemoji) graphics (CC-BY 4.0).
