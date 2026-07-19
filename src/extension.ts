import * as vscode from 'vscode';
import { DocsProvider, VIEW_ID } from './provider';
import { initEmoji } from './emoji';
import { registerCommands } from './commands';

export function activate(context: vscode.ExtensionContext): void {
  initEmoji(context.extensionUri);

  const provider = new DocsProvider();
  const treeView = vscode.window.createTreeView(VIEW_ID, {
    treeDataProvider: provider,
    dragAndDropController: provider,
    showCollapseAll: true,
    canSelectMany: true,
  });
  context.subscriptions.push(treeView);

  // Refresh (debounced) when the filesystem structure changes.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refreshSoon = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => provider.refresh(), 150);
  };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  watcher.onDidCreate(refreshSoon);
  watcher.onDidDelete(refreshSoon);
  context.subscriptions.push(watcher);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('docsBar')) {
        provider.refresh();
      }
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => provider.refresh()),
  );

  registerCommands(context, provider, treeView);
}

export function deactivate(): void {
  /* nothing to clean up beyond disposables */
}
