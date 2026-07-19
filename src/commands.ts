import * as vscode from 'vscode';
import * as path from 'path';
import * as store from './store';
import { DocsProvider } from './provider';
import { pickEmoji } from './emoji';
import { exists, isDirectory, uniqueDest } from './util';

let clipboard: vscode.Uri[] = [];

export function registerCommands(
  context: vscode.ExtensionContext,
  provider: DocsProvider,
  treeView: vscode.TreeView<vscode.Uri>,
): void {
  const warn = (msg: string) => void vscode.window.showWarningMessage(msg);

  /** The folder a create/paste should land in, given the invoked node. */
  async function folderContext(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (!uri) {
      return store.getRoots()[0];
    }
    return (await isDirectory(uri)) ? uri : vscode.Uri.joinPath(uri, '..');
  }

  /** Resolve the set of nodes a command operates on (respects multi-select). */
  function targets(uri?: vscode.Uri, uris?: vscode.Uri[]): vscode.Uri[] {
    if (uris?.length) {
      return uris;
    }
    if (uri) {
      return [uri];
    }
    return [...treeView.selection];
  }

  const register = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  register('docsBar.newFile', async (uri?: vscode.Uri) => {
    const folder = await folderContext(uri);
    if (!folder) {
      return;
    }
    const name = await vscode.window.showInputBox({ title: '新建文件', prompt: '文件名（可含子路径）' });
    if (!name) {
      return;
    }
    const dest = vscode.Uri.joinPath(folder, name);
    if (await exists(dest)) {
      return warn('已存在同名文件');
    }
    await vscode.workspace.fs.writeFile(dest, new Uint8Array());
    provider.refresh();
    await vscode.window.showTextDocument(dest);
  });

  register('docsBar.newFolder', async (uri?: vscode.Uri) => {
    const folder = await folderContext(uri);
    if (!folder) {
      return;
    }
    const name = await vscode.window.showInputBox({ title: '新建目录', prompt: '目录名（可含子路径）' });
    if (!name) {
      return;
    }
    const dest = vscode.Uri.joinPath(folder, name);
    if (await exists(dest)) {
      return warn('已存在同名目录');
    }
    await vscode.workspace.fs.createDirectory(dest);
    provider.refresh();
  });

  register('docsBar.rename', async (uri?: vscode.Uri) => {
    if (!uri) {
      return;
    }
    const oldName = path.basename(uri.fsPath);
    const ext = path.extname(oldName);
    const name = await vscode.window.showInputBox({
      title: '重命名',
      value: oldName,
      valueSelection: [0, oldName.length - ext.length],
    });
    if (!name || name === oldName) {
      return;
    }
    const dest = vscode.Uri.joinPath(uri, '..', name);
    if (await exists(dest)) {
      return warn('目标名称已存在');
    }
    await vscode.workspace.fs.rename(uri, dest, { overwrite: false });
    await store.rekey(uri, dest);
    provider.refresh();
  });

  register('docsBar.copy', (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
    clipboard = targets(uri, uris);
  });

  register('docsBar.paste', async (uri?: vscode.Uri) => {
    if (!clipboard.length) {
      return;
    }
    const folder = await folderContext(uri);
    if (!folder) {
      return;
    }
    for (const src of clipboard) {
      const dest = await uniqueDest(folder, path.basename(src.fsPath));
      try {
        await vscode.workspace.fs.copy(src, dest, { overwrite: false });
      } catch {
        /* ignore */
      }
    }
    provider.refresh();
  });

  register('docsBar.duplicate', async (uri?: vscode.Uri) => {
    if (!uri) {
      return;
    }
    const parent = vscode.Uri.joinPath(uri, '..');
    const dest = await uniqueDest(parent, path.basename(uri.fsPath));
    await vscode.workspace.fs.copy(uri, dest, { overwrite: false });
    provider.refresh();
  });

  register('docsBar.copyPath', async (uri?: vscode.Uri) => {
    if (uri) {
      await vscode.env.clipboard.writeText(uri.fsPath);
    }
  });

  register('docsBar.copyRelativePath', async (uri?: vscode.Uri) => {
    if (uri) {
      await vscode.env.clipboard.writeText(store.relKey(uri));
    }
  });

  register('docsBar.setIcon', async (uri?: vscode.Uri) => {
    if (!uri) {
      return;
    }
    const result = await pickEmoji(store.getIcon(uri));
    if (!result) {
      return;
    }
    await store.setIcon(uri, result.clear ? undefined : result.emoji);
    provider.refresh();
  });

  register('docsBar.setAlias', async (uri?: vscode.Uri) => {
    if (!uri) {
      return;
    }
    const name = await vscode.window.showInputBox({
      title: '设置显示名',
      prompt: '留空则恢复真实文件名',
      value: store.getAlias(uri) ?? '',
    });
    if (name === undefined) {
      return;
    }
    await store.setAlias(uri, name.trim() || undefined);
    provider.refresh();
  });

  register('docsBar.hide', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
    for (const t of targets(uri, uris)) {
      await store.addHidden(t);
    }
    provider.refresh();
  });

  register('docsBar.unhideAll', async () => {
    await store.clearHidden();
    provider.refresh();
  });

  register('docsBar.revealInFinder', async (uri?: vscode.Uri) => {
    if (uri) {
      await vscode.commands.executeCommand('revealFileInOS', uri);
    }
  });

  register('docsBar.delete', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
    const items = targets(uri, uris);
    if (!items.length) {
      return;
    }
    const label = items.length === 1 ? `“${path.basename(items[0].fsPath)}”` : `选中的 ${items.length} 项`;
    const ok = await vscode.window.showWarningMessage(
      `确定要删除 ${label} 吗？会移入废纸篓。`,
      { modal: true },
      '删除',
    );
    if (ok !== '删除') {
      return;
    }
    for (const t of items) {
      try {
        await vscode.workspace.fs.delete(t, { recursive: true, useTrash: true });
      } catch {
        /* ignore */
      }
    }
    provider.refresh();
  });

  register('docsBar.expandAll', async () => {
    const folders: vscode.Uri[] = [];
    const walk = async (dir: vscode.Uri) => {
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(dir);
      } catch {
        return;
      }
      for (const [name, type] of entries) {
        const u = vscode.Uri.joinPath(dir, name);
        if (type & vscode.FileType.Directory && !store.isHidden(u)) {
          folders.push(u);
          await walk(u);
        }
      }
    };
    for (const r of store.getRoots()) {
      await walk(r);
    }
    for (const f of folders) {
      try {
        await treeView.reveal(f, { expand: true, focus: false, select: false });
      } catch {
        /* best effort */
      }
    }
  });

  register('docsBar.collapseAll', () =>
    vscode.commands.executeCommand('workbench.actions.treeView.docsBar.collapseAll'),
  );

  register('docsBar.refresh', () => provider.refresh());
}
