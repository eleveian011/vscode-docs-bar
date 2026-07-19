import * as vscode from 'vscode';
import * as store from './store';

export interface DocNode {
  key: string; // workspace-relative posix path, or a divider token
  parentKey: string; // key of the containing folder ('' = workspace root)
  name: string; // real basename (or the token, for dividers)
  label: string; // display text
  emoji?: string;
  isDir: boolean;
  isDivider?: boolean;
  git?: string;
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
  const parentKey = store.relKey(dir);
  const visible = entries
    .map(([name, type]) => ({ name, type, uri: vscode.Uri.joinPath(dir, name) }))
    .filter((e) => !store.isHidden(e.uri));

  // Build nodes for entries that survive the markdown filter / pruning.
  const nodeByName = new Map<string, DocNode>();
  const forSort: { name: string; type: vscode.FileType }[] = [];
  for (const e of visible) {
    const isDir = !!(e.type & vscode.FileType.Directory);
    if (isDir) {
      const children = await buildChildren(e.uri, opts);
      if (opts.markdownOnly && children.length === 0) {
        continue;
      }
      nodeByName.set(e.name, makeNode(e.uri, e.name, true, opts, parentKey, children));
    } else {
      if (opts.markdownOnly && !MD.test(e.name)) {
        continue;
      }
      nodeByName.set(e.name, makeNode(e.uri, e.name, false, opts, parentKey));
    }
    forSort.push({ name: e.name, type: e.type });
  }

  // Interleave with the saved order, injecting dividers at their positions.
  const out: DocNode[] = [];
  const used = new Set<string>();
  for (const token of store.getOrderNames(dir)) {
    if (store.isDividerToken(token)) {
      out.push(dividerNode(token, parentKey));
    } else if (nodeByName.has(token)) {
      out.push(nodeByName.get(token)!);
      used.add(token);
    }
  }
  const remaining = forSort.filter((e) => !used.has(e.name));
  sortEntries(remaining, []);
  for (const e of remaining) {
    out.push(nodeByName.get(e.name)!);
  }
  return out;
}

function dividerNode(token: string, parentKey: string): DocNode {
  return { key: token, parentKey, name: token, label: '', isDir: false, isDivider: true };
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

// ---- token-based ordering (files + divider tokens) ----

/** The full ordered token list for a folder: saved order (dividers + real names)
 *  first, then any remaining real entries in default order. */
export async function currentOrderTokens(folder: vscode.Uri): Promise<string[]> {
  let raw: [string, vscode.FileType][];
  try {
    raw = await vscode.workspace.fs.readDirectory(folder);
  } catch {
    return store.getOrderNames(folder);
  }
  const existing = new Set(raw.map(([n]) => n));
  const kept = store.getOrderNames(folder).filter((t) => store.isDividerToken(t) || existing.has(t));
  const keptSet = new Set(kept);
  const remaining = raw.filter(([n]) => !keptSet.has(n)).map(([name, type]) => ({ name, type }));
  sortEntries(remaining, []);
  return [...kept, ...remaining.map((e) => e.name)];
}

/** Move `movedTokens` before `beforeToken` (or to the end) within `folder`. */
export async function reorderTokens(
  folder: vscode.Uri,
  movedTokens: string[],
  beforeToken?: string,
): Promise<void> {
  let tokens = await currentOrderTokens(folder);
  tokens = tokens.filter((t) => !movedTokens.includes(t));
  let at = beforeToken ? tokens.indexOf(beforeToken) : tokens.length;
  if (at < 0) {
    at = tokens.length;
  }
  tokens.splice(at, 0, ...movedTokens);
  await store.setOrderNames(folder, tokens);
}

/** Remove a single token (e.g. a moved-away file or a deleted divider) from a folder's order. */
export async function removeToken(folder: vscode.Uri, token: string): Promise<void> {
  const tokens = (await currentOrderTokens(folder)).filter((t) => t !== token);
  await store.setOrderNames(folder, tokens);
}
