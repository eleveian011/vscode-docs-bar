import * as vscode from 'vscode';
import * as path from 'path';
import * as store from './store';
import { pickEmoji } from './emoji';
import { gitStatusMap } from './git';
import { buildForest, reorderWithin } from './tree';
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
        return void (await vscode.window.showTextDocument(this.keyToUri(m.key)));
      case 'saveExpanded':
        return void this.ctx.workspaceState.update(EXPANDED_KEY, m.expanded ?? []);
      case 'action':
        await this.action(m.action, m.key);
        return;
      case 'reorder':
        await this.handleReorder(m.moved ?? [], m.parentKey ?? '', m.beforeKey ?? undefined);
        return;
      case 'more':
        await this.showMore();
        return;
    }
  }

  private async showMore(): Promise<void> {
    type Item = vscode.QuickPickItem & { act: string };
    const items: Item[] = [
      { label: '$(refresh) 刷新', act: 'refresh' },
      { label: '$(eye) 取消所有隐藏', act: 'unhide' },
    ];
    const pick = await vscode.window.showQuickPick(items, { title: 'Docs Bar', placeHolder: '更多操作' });
    if (!pick) {
      return;
    }
    if (pick.act === 'unhide') {
      await store.clearHidden();
    }
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
      await vscode.window.showTextDocument(dest);
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
        await vscode.window.showTextDocument(uri);
        return;

      case 'rename': {
        const oldName = path.basename(uri.fsPath);
        const ext = path.extname(oldName);
        const input = await vscode.window.showInputBox({
          title: '重命名',
          value: oldName,
          valueSelection: [0, oldName.length - ext.length],
        });
        if (!input || input === oldName) {
          return;
        }
        const dest = vscode.Uri.joinPath(uri, '..', input);
        if (await exists(dest)) {
          void vscode.window.showWarningMessage('目标名称已存在');
          return;
        }
        await vscode.workspace.fs.rename(uri, dest, { overwrite: false });
        await store.rekey(uri, dest);
        break;
      }

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

      case 'setAlias': {
        const input = await vscode.window.showInputBox({
          title: '设置显示名',
          prompt: '留空则恢复真实文件名',
          value: store.getAlias(uri) ?? '',
        });
        if (input === undefined) {
          return;
        }
        await store.setAlias(uri, input.trim() || undefined);
        break;
      }

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
  ): Promise<void> {
    if (!movedKeys.length) {
      return;
    }
    const sources = movedKeys.map((k) => this.keyToUri(k));
    const folder = this.keyToUri(parentKey);
    const before = beforeKey ? path.basename(this.keyToUri(beforeKey).fsPath) : undefined;

    const movedNames: string[] = [];
    for (const src of sources) {
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
<div id="toolbar"></div>
<div id="app"></div>
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
