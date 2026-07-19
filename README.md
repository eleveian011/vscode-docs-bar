# Docs Bar

A **Notion-style Markdown navigator** for VS Code — a webview sidebar that lives beside the built-in Explorer and turns a folder of `.md` files into a clean, emoji-tagged page list.

- 🎨 **Emoji page icons**, native color emoji, set per exact path
- 🏷️ **Display-name aliases** — show a pretty name without renaming the file
- ↕️ **Custom drag-to-reorder**, persisted per folder
- 📄 **Markdown-only** — folders + `.md` files, empty folders pruned, extensions hidden
- 🌿 **Git status** (M / U / A / D / R) inline
- 🙈 **Hide** doc-irrelevant entries

> A focused companion, not a replacement. Keep using the built-in Explorer for heavy file work and dragging files out to Finder.

## Why a webview

VS Code's native `TreeView` locks down row height, font size, spacing and selection styling — so it can't look like Notion. Docs Bar renders its own tree in a webview, which buys the airy layout, rounded selection, and native emoji (including skin tones) that the screenshot-perfect look needs. The trade-off is that a few things the native tree gives for free are rebuilt here by hand: git status, the context menu, and drag-and-drop.

## Usage

- **Click** a page to open it; click a folder (or its chevron) to expand.
- **Right-click** for the full menu: new file/folder, set icon, set alias, rename, duplicate, copy/paste, copy path, hide, reveal in Finder, delete.
- **Drag** to reorder within a folder, or onto a folder to move into it.
- **Keyboard** (view focused): `F2` rename · `↵` open · `⌫`/`⌘⌫` delete · `⌘C`/`⌘V` copy/paste · `⌘D` duplicate.
- **Toolbar**: new file · new folder · expand all · collapse all · refresh.

Icons, aliases, order and hidden lists are stored in the workspace's `.vscode/settings.json` under `docsBar.*`, so they travel with the repo.

## Settings

| Setting | Default | Description |
|---|---|---|
| `docsBar.root` | `""` | Subfolder to show as the root. Empty = whole workspace. |
| `docsBar.markdownOnly` | `true` | Only `.md` files and folders that contain them. |
| `docsBar.stripMarkdownExtension` | `true` | Hide the `.md` suffix in labels. |
| `docsBar.icons` | `{}` | `{ path: emoji }` (managed via right-click). |
| `docsBar.aliases` | `{}` | `{ path: displayName }`. |
| `docsBar.order` | `{}` | `{ parentPath: [names…] }` manual order. |
| `docsBar.hidden` | `[]` | Paths hidden in this view. |
| `docsBar.alwaysHide` | `.git`, `.DS_Store`, `node_modules` | Names always hidden. |

## Develop

```bash
npm install
npm run watch      # esbuild in watch mode
# press F5 to launch the Extension Development Host
npm run package    # build a .vsix
```

Host code is in `src/` (extension entry, webview provider, git + tree helpers); the webview UI is plain HTML/CSS/JS in `media/`.

## License

MIT.
