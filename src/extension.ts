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
        void vscode.commands.executeCommand(
          'setContext',
          'docsBarMdOnly',
          vscode.workspace.getConfiguration('docsBar').get('markdownOnly', true),
        );
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
  cmd('docsBar.unhideAll', () => void view.runAction('unhideAll', ''));

  // Native context-menu items (contributed to webview/context). VS Code passes
  // the row's data-vscode-context object as the first argument.
  const CTX_ACTIONS = [
    'open', 'newFile', 'newFolder', 'setIcon', 'setAlias', 'rename',
    'duplicate', 'copy', 'paste', 'copyPath', 'copyRelativePath',
    'hide', 'reveal', 'delete',
  ];
  for (const action of CTX_ACTIONS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`docsBar.ctx.${action}`, (ctx?: { docKey?: string }) => {
        if (ctx?.docKey !== undefined) {
          void view.runAction(action, ctx.docKey);
        }
      }),
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'docsBar.ctx.deleteDivider',
      (ctx?: { docKey?: string; docParentKey?: string }) => {
        if (ctx?.docKey !== undefined) {
          void view.deleteDivider(ctx.docParentKey ?? '', ctx.docKey);
        }
      },
    ),
  );

  // Toolbar "更多" native-menu items.
  cmd('docsBar.ctx.newDivider', () => void view.newDivider());
  cmd('docsBar.ctx.refresh', () => void view.refresh());
  cmd('docsBar.ctx.unhideAll', () => void view.runAction('unhideAll', ''));

  // Markdown-only toggle (reflected as a checkmark via the docsBarMdOnly context key).
  void vscode.commands.executeCommand(
    'setContext',
    'docsBarMdOnly',
    vscode.workspace.getConfiguration('docsBar').get('markdownOnly', true),
  );
  const toggleMdOnly = async () => {
    const config = vscode.workspace.getConfiguration('docsBar');
    const tgt = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await config.update('markdownOnly', !config.get('markdownOnly', true), tgt);
  };
  cmd('docsBar.ctx.showAll', () => void toggleMdOnly());
  cmd('docsBar.ctx.mdOnly', () => void toggleMdOnly());
}

export function deactivate(): void {
  /* disposables handle cleanup */
}
