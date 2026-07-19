import * as vscode from 'vscode';

// Minimal typing over the built-in vscode.git extension API.
let api: any;

export function initGit(onReady: () => void): void {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext) {
    return;
  }
  const grab = () => {
    try {
      api = ext.exports?.getAPI?.(1);
    } catch {
      api = undefined;
    }
    if (api) {
      onReady();
    }
  };
  if (ext.isActive) {
    grab();
  } else {
    ext.activate().then(grab, () => undefined);
  }
}

function letterFor(status: number): string | undefined {
  switch (status) {
    case 0: // INDEX_MODIFIED
    case 5: // MODIFIED
      return 'M';
    case 1: // INDEX_ADDED
    case 9: // INTENT_TO_ADD
    case 10: // ADDED_BY_US
      return 'A';
    case 2: // INDEX_DELETED
    case 6: // DELETED
      return 'D';
    case 3: // INDEX_RENAMED
      return 'R';
    case 7: // UNTRACKED
      return 'U';
    default:
      return undefined;
  }
}

/** Map of fsPath -> single-letter git status for all repositories. */
export function gitStatusMap(): Map<string, string> {
  const map = new Map<string, string>();
  if (!api) {
    return map;
  }
  for (const repo of api.repositories ?? []) {
    const st = repo.state ?? {};
    const groups = [st.workingTreeChanges, st.indexChanges, st.untrackedChanges];
    for (const group of groups) {
      for (const change of group ?? []) {
        const l = letterFor(change.status);
        if (l && change.uri) {
          const p = (change.uri as vscode.Uri).fsPath;
          if (!map.has(p)) {
            map.set(p, l);
          }
        }
      }
    }
  }
  return map;
}

/** Subscribe to any git state change; returns a disposable. */
export function onGitChange(cb: () => void): vscode.Disposable {
  const subs: vscode.Disposable[] = [];
  const hookRepos = () => {
    for (const repo of api?.repositories ?? []) {
      subs.push(repo.state.onDidChange(cb));
    }
  };
  if (api) {
    hookRepos();
    if (api.onDidOpenRepository) {
      subs.push(
        api.onDidOpenRepository(() => {
          hookRepos();
          cb();
        }),
      );
    }
  }
  return new vscode.Disposable(() => subs.forEach((d) => d.dispose()));
}
