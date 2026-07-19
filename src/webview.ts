import * as vscode from 'vscode';
import * as path from 'path';
import * as store from './store';
import { pickEmoji } from './emoji';
import { gitStatusMap } from './git';
import { buildForest, currentOrderTokens, reorderTokens, removeToken } from './tree';
import { exists, isDirectory, uniqueDest } from './util';

const EXPANDED_KEY = 'docsBar.expanded';

export class DocsBarView implements vscode.WebviewViewProvider {
  public static readonly viewId = 'docsBar';

  private view?: vscode.WebviewView;
  private clipboard: vscode.Uri[] = [];
  private refreshTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'media')],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m));
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        this.refresh();
      }
    });
    this.refresh();
  }

  // ---- refresh / rendering ----

  refreshSoon(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => this.refresh(), 150);
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const config = vscode.workspace.getConfiguration('docsBar');
    const forest = await buildForest(store.getRoots(), {
      git: gitStatusMap(),
      markdownOnly: config.get('markdownOnly', true),
      stripExt: config.get('stripMarkdownExtension', true),
    });
    this.post({
      type: 'render',
      forest,
      expanded: this.ctx.workspaceState.get<string[]>(EXPANDED_KEY, []),
    });
  }

  private post(msg: unknown): void {
    void this.view?.webview.postMessage(msg);
  }

  // ---- title-bar command entrypoints ----

  expandAll(): void {
    this.post({ type: 'expandAll' });
  }
  collapseAll(): void {
    void this.ctx.workspaceState.update(EXPANDED_KEY, []);
    this.post({ type: 'collapseAll' });
  }
  newFileTop(): Promise<void> {
    return this.newEntry(store.getRoots()[0], false);
  }
  newFolderTop(): Promise<void> {
    return this.newEntry(store.getRoots()[0], true);
  }

  /** Invoked by native webview/context menu commands. */
  runAction(name: string, key: string): Promise<void> {
    return this.action(name, key);
  }

  // ---- messaging ----

  private keyToUri(key: string): vscode.Uri {
    const base = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!base) {
      return vscode.Uri.file(key);
    }
    return key ? vscode.Uri.joinPath(base, ...key.split('/')) : base;
  }

  private async onMessage(m: any): Promise<void> {
    switch (m?.type) {
      case 'ready':
        return void this.refresh();
      case 'open':
        return void (await vscode.commands.executeCommand('vscode.open', this.keyToUri(m.key)));
      case 'saveExpanded':
        return void this.ctx.workspaceState.update(EXPANDED_KEY, m.expanded ?? []);
      case 'action':
        await this.action(m.action, m.key);
        return;
      case 'reorder':
        await this.handleReorder(
          m.moved ?? [],
          m.parentKey ?? '',
          m.beforeKey ?? undefined,
          m.movedParentKey ?? '',
        );
        return;
      case 'renameTo':
        await this.renameTo(m.key, m.newName);
        return;
      case 'setAliasTo':
        await store.setAlias(this.keyToUri(m.key), (m.alias ?? '').trim() || undefined);
        await this.refresh();
        return;
    }
  }

  private async renameTo(key: string, newName: string): Promise<void> {
    const name = (newName ?? '').trim();
    const uri = this.keyToUri(key);
    if (!name || name === path.basename(uri.fsPath)) {
      await this.refresh();
      return;
    }
    const dest = vscode.Uri.joinPath(uri, '..', name);
    if (await exists(dest)) {
      void vscode.window.showWarningMessage('目标名称已存在');
      await this.refresh();
      return;
    }
    try {
      await vscode.workspace.fs.rename(uri, dest, { overwrite: false });
      await store.rekey(uri, dest);
    } catch {
      /* ignore */
    }
    await this.refresh();
  }

  /** Toolbar "更多" → native menu item. Inserts a divider at the top of the root. */
  async newDivider(): Promise<void> {
    const folder = store.getRoots()[0];
    const tokens = await currentOrderTokens(folder);
    await store.setOrderNames(folder, [store.newDividerToken(), ...tokens]);
    await this.refresh();
  }

  /** Invoked by the divider's native context-menu "删除分割线". */
  async deleteDivider(parentKey: string, token: string): Promise<void> {
    await removeToken(this.keyToUri(parentKey), token);
    await this.refresh();
  }

  // ---- actions ----

  private async folderOf(uri: vscode.Uri): Promise<vscode.Uri> {
    return (await isDirectory(uri)) ? uri : vscode.Uri.joinPath(uri, '..');
  }

  private async newEntry(anchor: vscode.Uri, dir: boolean): Promise<void> {
    const folder = await this.folderOf(anchor);
    const name = await vscode.window.showInputBox({
      title: dir ? '新建目录' : '新建文件',
      prompt: dir ? '目录名（可含子路径）' : '文件名，如 note.md',
    });
    if (!name) {
      return;
    }
    const dest = vscode.Uri.joinPath(folder, name);
    if (await exists(dest)) {
      void vscode.window.showWarningMessage('已存在同名项');
      return;
    }
    if (dir) {
      await vscode.workspace.fs.createDirectory(dest);
    } else {
      await vscode.workspace.fs.writeFile(dest, new Uint8Array());
      await vscode.commands.executeCommand('vscode.open', dest);
    }
    await this.refresh();
  }

  private async action(name: string, key: string): Promise<void> {
    const uri = this.keyToUri(key);
    switch (name) {
      case 'newFile':
        return this.newEntry(uri, false);
      case 'newFolder':
        return this.newEntry(uri, true);
      case 'open':
        await vscode.commands.executeCommand('vscode.open', uri);
        return;

      case 'rename':
        this.post({ type: 'beginRename', key });
        return;

      case 'copy':
        this.clipboard = [uri];
        return; // no refresh needed

      case 'paste': {
        if (!this.clipboard.length) {
          return;
        }
        const folder = await this.folderOf(uri);
        for (const src of this.clipboard) {
          const dest = await uniqueDest(folder, path.basename(src.fsPath));
          try {
            await vscode.workspace.fs.copy(src, dest, { overwrite: false });
          } catch {
            /* ignore */
          }
        }
        break;
      }

      case 'duplicate': {
        const parent = vscode.Uri.joinPath(uri, '..');
        const dest = await uniqueDest(parent, path.basename(uri.fsPath));
        await vscode.workspace.fs.copy(uri, dest, { overwrite: false });
        break;
      }

      case 'copyPath':
        await vscode.env.clipboard.writeText(uri.fsPath);
        return;
      case 'copyRelativePath':
        await vscode.env.clipboard.writeText(store.relKey(uri));
        return;

      case 'setIcon': {
        const result = await pickEmoji(store.getIcon(uri));
        if (!result) {
          return;
        }
        await store.setIcon(uri, result.clear ? undefined : result.emoji);
        break;
      }

      case 'setAlias':
        this.post({ type: 'beginAlias', key });
        return;

      case 'hide':
        await store.addHidden(uri);
        break;
      case 'unhideAll':
        await store.clearHidden();
        break;

      case 'reveal':
        await vscode.commands.executeCommand('revealFileInOS', uri);
        return;

      case 'delete': {
        const ok = await vscode.window.showWarningMessage(
          `确定要删除 “${path.basename(uri.fsPath)}” 吗？会移入废纸篓。`,
          { modal: true },
          '删除',
        );
        if (ok !== '删除') {
          return;
        }
        try {
          await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
        } catch {
          /* ignore */
        }
        break;
      }

      default:
        return;
    }
    await this.refresh();
  }

  private async handleReorder(
    movedKeys: string[],
    parentKey: string,
    beforeKey: string | undefined,
    movedParentKey: string,
  ): Promise<void> {
    if (!movedKeys.length) {
      return;
    }
    const targetFolder = this.keyToUri(parentKey);
    const sourceFolder = this.keyToUri(movedParentKey);
    const crossParent = movedParentKey !== parentKey;

    const movedTokens: string[] = [];
    for (const key of movedKeys) {
      if (store.isDividerToken(key)) {
        if (crossParent) {
          await removeToken(sourceFolder, key);
        }
        movedTokens.push(key);
        continue;
      }
      const src = this.keyToUri(key);
      let name = path.basename(src.fsPath);
      if (crossParent) {
        if (
          targetFolder.toString() === src.toString() ||
          targetFolder.fsPath.startsWith(src.fsPath + path.sep)
        ) {
          continue; // don't move a folder into itself/descendant
        }
        const dest = await uniqueDest(targetFolder, name);
        try {
          await vscode.workspace.fs.rename(src, dest, { overwrite: false });
        } catch {
          continue;
        }
        name = path.basename(dest.fsPath);
        await store.rekey(src, dest);
        await removeToken(sourceFolder, path.basename(src.fsPath));
      }
      movedTokens.push(name);
    }

    let beforeToken: string | undefined;
    if (!beforeKey) {
      beforeToken = undefined;
    } else if (store.isDividerToken(beforeKey)) {
      beforeToken = beforeKey;
    } else {
      beforeToken = path.basename(this.keyToUri(beforeKey).fsPath);
    }

    await reorderTokens(targetFolder, movedTokens, beforeToken);
    await this.refresh();
  }

  // ---- html ----

  private html(webview: vscode.Webview): string {
    const nonce = getNonce();
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'main.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'main.js'));
    return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${cssUri}" rel="stylesheet">
</head>
<body>
<div id="app"></div>
<div id="toolbar"></div>
<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
