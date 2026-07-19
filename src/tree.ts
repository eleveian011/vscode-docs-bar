import * as vscode from 'vscode';
import * as store from './store';

export interface DocNode {
  key: string; // workspace-relative posix path (stable id, matches settings keys)
  parentKey: string; // key of the containing folder ('' = workspace root)
  name: string; // real basename
  label: string; // display text (alias, or name with optional extension stripped)
  emoji?: string;
  isDir: boolean;
  git?: string; // single-letter status
  children?: DocNode[];
}

const MD = /\.(md|markdown)$/i;

interface Opts {
  git: Map<string, string>;
  markdownOnly: boolean;
  stripExt: boolean;
}

export async function buildForest(roots: vscode.Uri[], opts: Opts): Promise<DocNode[]> {
  const forest: DocNode[] = [];
  for (const root of roots) {
    forest.push(...(await buildChildren(root, opts)));
  }
  return forest;
}

async function buildChildren(dir: vscode.Uri, opts: Opts): Promise<DocNode[]> {
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

  const nodes: DocNode[] = [];
  for (const e of visible) {
    const isDir = !!(e.type & vscode.FileType.Directory);
    const parentKey = store.relKey(dir);
    if (isDir) {
      const children = await buildChildren(e.uri, opts);
      if (opts.markdownOnly && children.length === 0) {
        continue; // prune folders that contain no markdown
      }
      nodes.push(makeNode(e.uri, e.name, true, opts, parentKey, children));
    } else {
      if (opts.markdownOnly && !MD.test(e.name)) {
        continue;
      }
      nodes.push(makeNode(e.uri, e.name, false, opts, parentKey));
    }
  }
  return nodes;
}

function makeNode(
  uri: vscode.Uri,
  name: string,
  isDir: boolean,
  opts: Opts,
  parentKey: string,
  children?: DocNode[],
): DocNode {
  const alias = store.getAlias(uri);
  const display = alias ?? (!isDir && opts.stripExt ? name.replace(MD, '') : name);
  return {
    key: store.relKey(uri),
    parentKey,
    name,
    label: display,
    emoji: store.getIcon(uri),
    isDir,
    git: opts.git.get(uri.fsPath),
    children,
  };
}

export function sortEntries(
  entries: { name: string; type: vscode.FileType }[],
  order: string[],
): void {
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
