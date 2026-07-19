import * as vscode from 'vscode';
import * as path from 'path';

export async function statType(uri: vscode.Uri): Promise<vscode.FileType | undefined> {
  try {
    return (await vscode.workspace.fs.stat(uri)).type;
  } catch {
    return undefined;
  }
}

export async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  const t = await statType(uri);
  return !!(t && t & vscode.FileType.Directory);
}

export async function exists(uri: vscode.Uri): Promise<boolean> {
  return (await statType(uri)) !== undefined;
}

/** A non-colliding destination Uri inside `folder` for a given base name. */
export async function uniqueDest(folder: vscode.Uri, name: string): Promise<vscode.Uri> {
  let candidate = vscode.Uri.joinPath(folder, name);
  if (!(await exists(candidate))) {
    return candidate;
  }
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? ' copy' : ` copy ${i}`;
    candidate = vscode.Uri.joinPath(folder, `${stem}${suffix}${ext}`);
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
}
