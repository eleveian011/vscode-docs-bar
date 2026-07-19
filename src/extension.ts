import * as vscode from 'vscode';
import { DocsBarView } from './webview';
import { initGit, onGitChange } from './git';

export function activate(context: vscode.ExtensionContext): void {
  const view = new DocsBarView(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DocsBarView.viewId, view, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Refresh (debounced) on filesystem structure changes.
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  watcher.onDidCreate(() => view.refreshSoon());
  watcher.onDidDelete(() => view.refreshSoon());
  context.subscriptions.push(watcher);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('docsBar')) {
        void view.refresh();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => view.refreshSoon()),
  );

  // Git status: init the git extension API, then refresh on any change.
  let gitSub: vscode.Disposable | undefined;
  initGit(() => {
    gitSub?.dispose();
    gitSub = onGitChange(() => view.refreshSoon());
    context.subscriptions.push(gitSub);
    void view.refresh();
  });

  const cmd = (id: string, fn: () => void) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  cmd('docsBar.newFile', () => void view.newFileTop());
  cmd('docsBar.newFolder', () => void view.newFolderTop());
  cmd('docsBar.expandAll', () => view.expandAll());
  cmd('docsBar.collapseAll', () => view.collapseAll());
  cmd('docsBar.refresh', () => void view.refresh());
}

export function deactivate(): void {
  /* disposables handle cleanup */
}
