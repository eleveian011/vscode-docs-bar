import * as vscode from 'vscode';
import * as path from 'path';

const SECTION = 'docsBar';

function cfg() {
  return vscode.workspace.getConfiguration(SECTION);
}

function target(): vscode.ConfigurationTarget {
  return vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

/** Path relative to the containing workspace folder, posix-normalised. '' for the folder root. */
export function relKey(uri: vscode.Uri): string {
  const wf = vscode.workspace.getWorkspaceFolder(uri);
  const base = wf ? wf.uri.fsPath : path.dirname(uri.fsPath);
  const rel = path.relative(base, uri.fsPath);
  return rel.split(path.sep).join('/');
}

// ---- roots ----

export function getRoots(): vscode.Uri[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const sub = cfg().get<string>('root', '').trim();
  if (sub && folders.length) {
    return [vscode.Uri.joinPath(folders[0].uri, ...sub.split('/').filter(Boolean))];
  }
  return folders.map((f) => f.uri);
}

// ---- icons ----

export function getIcon(uri: vscode.Uri): string | undefined {
  return cfg().get<Record<string, string>>('icons', {})[relKey(uri)];
}

export async function setIcon(uri: vscode.Uri, emoji: string | undefined): Promise<void> {
  const map = { ...cfg().get<Record<string, string>>('icons', {}) };
  const k = relKey(uri);
  if (emoji) {
    map[k] = emoji;
  } else {
    delete map[k];
  }
  await cfg().update('icons', map, target());
}

// ---- aliases (display names) ----

export function getAlias(uri: vscode.Uri): string | undefined {
  return cfg().get<Record<string, string>>('aliases', {})[relKey(uri)];
}

export async function setAlias(uri: vscode.Uri, name: string | undefined): Promise<void> {
  const map = { ...cfg().get<Record<string, string>>('aliases', {}) };
  const k = relKey(uri);
  if (name) {
    map[k] = name;
  } else {
    delete map[k];
  }
  await cfg().update('aliases', map, target());
}

// ---- hidden ----

export function isHidden(uri: vscode.Uri): boolean {
  const name = path.basename(uri.fsPath);
  const always = cfg().get<string[]>('alwaysHide', ['.git', '.DS_Store']);
  if (always.includes(name)) {
    return true;
  }
  return cfg().get<string[]>('hidden', []).includes(relKey(uri));
}

export async function addHidden(uri: vscode.Uri): Promise<void> {
  const list = cfg().get<string[]>('hidden', []);
  const k = relKey(uri);
  if (!list.includes(k)) {
    await cfg().update('hidden', [...list, k], target());
  }
}

export async function clearHidden(): Promise<void> {
  await cfg().update('hidden', [], target());
}

// ---- manual order ----

export function getOrderNames(parent: vscode.Uri): string[] {
  return cfg().get<Record<string, string[]>>('order', {})[relKey(parent)] ?? [];
}

export async function setOrderNames(parent: vscode.Uri, names: string[]): Promise<void> {
  const map = { ...cfg().get<Record<string, string[]>>('order', {}) };
  map[relKey(parent)] = names;
  await cfg().update('order', map, target());
}

// ---- key migration (on rename/move) ----

/** Rewrite settings keys that referenced `oldUri` (and its descendants) to `newUri`. */
export async function rekey(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
  const oldK = relKey(oldUri);
  const newK = relKey(newUri);
  if (oldK === newK) {
    return;
  }
  const remap = (k: string) => (k === oldK ? newK : k.startsWith(oldK + '/') ? newK + k.slice(oldK.length) : k);

  const c = cfg();
  const rewriteObj = <T>(obj: Record<string, T>) => {
    const out: Record<string, T> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[remap(k)] = v;
    }
    return out;
  };

  await c.update('icons', rewriteObj(c.get<Record<string, string>>('icons', {})), target());
  await c.update('aliases', rewriteObj(c.get<Record<string, string>>('aliases', {})), target());
  await c.update('order', rewriteObj(c.get<Record<string, string[]>>('order', {})), target());
  const hidden = c.get<string[]>('hidden', []).map(remap);
  await c.update('hidden', hidden, target());
}
