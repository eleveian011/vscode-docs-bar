import * as vscode from 'vscode';
import * as path from 'path';
import * as store from './store';
import { resolveEmojiSvg } from './emoji';
import { statType, uniqueDest } from './util';

export const VIEW_ID = 'docsBar';
const TREE_MIME = 'application/vnd.code.tree.docsbar';

export class DocsProvider
  implements vscode.TreeDataProvider<vscode.Uri>, vscode.TreeDragAndDropController<vscode.Uri>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.Uri | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  readonly dropMimeTypes = [TREE_MIME, 'text/uri-list'];
  readonly dragMimeTypes = ['text/uri-list'];

  refresh(uri?: vscode.Uri): void {
    this._onDidChangeTreeData.fire(uri);
  }

  async getChildren(element?: vscode.Uri): Promise<vscode.Uri[]> {
    if (!element) {
      const roots = store.getRoots();
      return roots.length === 1 ? this.readDir(roots[0]) : roots;
    }
    return this.readDir(element);
  }

  private async readDir(dir: vscode.Uri): Promise<vscode.Uri[]> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return [];
    }
    const visible = entries
      .map(([name, type]) => ({ name, type, uri: vscode.Uri.joinPath(dir, name) }))
      .filter((e) => !store.isHidden(e.uri));
    sortEntries(visible, store.getOrderNames(dir));
    return visible.map((e) => e.uri);
  }

  async getTreeItem(uri: vscode.Uri): Promise<vscode.TreeItem> {
    const type = await statType(uri);
    const isDir = !!(type && type & vscode.FileType.Directory);
    const name = path.basename(uri.fsPath);
    const alias = store.getAlias(uri);

    const item = new vscode.TreeItem(
      alias ?? name,
      isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    item.id = uri.toString();
    item.resourceUri = uri; // file-icon-theme icon + git decorations, for free
    item.contextValue = isDir ? 'folder' : 'file';
    item.tooltip = uri.fsPath + (alias ? `\n显示名: ${alias}` : '');

    if (isDir) {
      const emoji = store.getIcon(uri);
      const svg = emoji ? resolveEmojiSvg(emoji) : undefined;
      if (svg) {
        item.iconPath = svg;
      }
    } else {
      item.command = { command: 'vscode.open', title: 'Open', arguments: [uri] };
    }
    if (alias) {
      item.description = name;
    }
    return item;
  }

  getParent(uri: vscode.Uri): vscode.Uri | undefined {
    const roots = store.getRoots();
    if (roots.some((r) => r.toString() === uri.toString())) {
      return undefined;
    }
    const parent = vscode.Uri.joinPath(uri, '..');
    if (roots.length === 1 && parent.toString() === roots[0].toString()) {
      return undefined;
    }
    return parent;
  }

  // ---- drag & drop ----

  handleDrag(source: readonly vscode.Uri[], data: vscode.DataTransfer): void {
    const uris = source.map((u) => u.toString());
    data.set(TREE_MIME, new vscode.DataTransferItem(uris));
    data.set('text/uri-list', new vscode.DataTransferItem(uris.join('\r\n')));
  }

  async handleDrop(target: vscode.Uri | undefined, data: vscode.DataTransfer): Promise<void> {
    const internal = data.get(TREE_MIME);
    if (internal) {
      const uris = (internal.value as string[]).map((s) => vscode.Uri.parse(s));
      await this.moveOrReorder(uris, target);
      return;
    }
    const list = data.get('text/uri-list');
    if (list) {
      const uris = (await list.asString())
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('#'))
        .map((s) => vscode.Uri.parse(s));
      await this.dropExternal(uris, target);
    }
  }

  private async destOf(target: vscode.Uri | undefined): Promise<{ folder: vscode.Uri; before?: string }> {
    const roots = store.getRoots();
    if (!target) {
      return { folder: roots[0] };
    }
    const type = await statType(target);
    if (type && type & vscode.FileType.Directory) {
      return { folder: target };
    }
    return { folder: vscode.Uri.joinPath(target, '..'), before: path.basename(target.fsPath) };
  }

  private async moveOrReorder(sources: vscode.Uri[], target: vscode.Uri | undefined): Promise<void> {
    const { folder, before } = await this.destOf(target);
    const movedNames: string[] = [];
    for (const src of sources) {
      // never drop a folder into itself or a descendant
      if (folder.toString() === src.toString() || folder.fsPath.startsWith(src.fsPath + path.sep)) {
        continue;
      }
      const srcParent = vscode.Uri.joinPath(src, '..');
      let finalName = path.basename(src.fsPath);
      if (srcParent.toString() !== folder.toString()) {
        const dest = await uniqueDest(folder, finalName);
        try {
          await vscode.workspace.fs.rename(src, dest, { overwrite: false });
        } catch {
          continue;
        }
        finalName = path.basename(dest.fsPath);
        await store.rekey(src, dest);
      }
      movedNames.push(finalName);
    }
    if (movedNames.length) {
      await reorderWithin(folder, movedNames, before);
    }
    this.refresh();
  }

  private async dropExternal(sources: vscode.Uri[], target: vscode.Uri | undefined): Promise<void> {
    const { folder } = await this.destOf(target);
    for (const src of sources) {
      if (src.scheme !== 'file') {
        continue;
      }
      const dest = await uniqueDest(folder, path.basename(src.fsPath));
      try {
        await vscode.workspace.fs.copy(src, dest, { overwrite: false });
      } catch {
        /* ignore individual failures */
      }
    }
    this.refresh();
  }
}

function sortEntries(entries: { name: string; type: vscode.FileType }[], order: string[]): void {
  const idx = new Map(order.map((n, i) => [n, i] as const));
  entries.sort((a, b) => {
    const ai = idx.has(a.name) ? idx.get(a.name)! : Infinity;
    const bi = idx.has(b.name) ? idx.get(b.name)! : Infinity;
    if (ai !== bi) {
      return ai - bi;
    }
    const ad = a.type & vscode.FileType.Directory;
    const bd = b.type & vscode.FileType.Directory;
    if (!!ad !== !!bd) {
      return ad ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/** Persist a full explicit order for `folder`, placing `movedNames` before `before` (or at end). */
export async function reorderWithin(
  folder: vscode.Uri,
  movedNames: string[],
  before?: string,
): Promise<void> {
  let raw: [string, vscode.FileType][];
  try {
    raw = await vscode.workspace.fs.readDirectory(folder);
  } catch {
    return;
  }
  const entries = raw.map(([name, type]) => ({ name, type }));
  sortEntries(entries, store.getOrderNames(folder));
  const current = entries.map((e) => e.name).filter((n) => !movedNames.includes(n));
  let at = before ? current.indexOf(before) : current.length;
  if (at < 0) {
    at = current.length;
  }
  current.splice(at, 0, ...movedNames);
  await store.setOrderNames(folder, current);
}
