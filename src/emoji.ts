import * as vscode from 'vscode';
import * as fs from 'fs';
import ordered from 'unicode-emoji-json/data-ordered-emoji.json';
import byEmoji from 'unicode-emoji-json/data-by-emoji.json';

const EMOJI_LIST = ordered as string[];
const EMOJI_INFO = byEmoji as Record<string, { name: string; group: string }>;

let extensionUri: vscode.Uri;
const svgCache = new Map<string, vscode.Uri | undefined>();

export function initEmoji(uri: vscode.Uri): void {
  extensionUri = uri;
}

/** Twemoji codepoint filename algorithm (surrogate-pair aware). */
function toCodePoint(chars: string): string {
  const parts: string[] = [];
  let high = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars.charCodeAt(i);
    if (high) {
      parts.push((0x10000 + ((high - 0xd800) << 10) + (c - 0xdc00)).toString(16));
      high = 0;
    } else if (c >= 0xd800 && c <= 0xdbff) {
      high = c;
    } else {
      parts.push(c.toString(16));
    }
  }
  return parts.join('-');
}

/** Twemoji drops the FE0F variation selector from most filenames; try both. */
function codeCandidates(emoji: string): string[] {
  const full = toCodePoint(emoji);
  const stripped = toCodePoint(emoji.replace(/️/g, ''));
  return stripped === full ? [full] : [stripped, full];
}

/** Resolve an emoji to a bundled Twemoji SVG Uri, or undefined if none ships. */
export function resolveEmojiSvg(emoji: string): vscode.Uri | undefined {
  if (svgCache.has(emoji)) {
    return svgCache.get(emoji);
  }
  let found: vscode.Uri | undefined;
  for (const code of codeCandidates(emoji)) {
    const uri = vscode.Uri.joinPath(extensionUri, 'assets', 'twemoji', `${code}.svg`);
    if (fs.existsSync(uri.fsPath)) {
      found = uri;
      break;
    }
  }
  svgCache.set(emoji, found);
  return found;
}

type PickResult = { emoji?: string; clear?: boolean } | undefined;

/** Show a searchable emoji picker; returns the chosen emoji, a clear request, or undefined. */
export async function pickEmoji(current?: string): Promise<PickResult> {
  type Item = vscode.QuickPickItem & { emoji?: string; action?: 'custom' | 'clear' };
  const items: Item[] = [{ label: '$(edit) 输入自定义 emoji…', alwaysShow: true, action: 'custom' }];
  if (current) {
    items.push({ label: '$(close) 清除图标', alwaysShow: true, action: 'clear' });
  }
  for (const e of EMOJI_LIST) {
    if (!resolveEmojiSvg(e)) {
      continue;
    }
    items.push({ label: e, description: EMOJI_INFO[e]?.name ?? '', emoji: e });
  }

  const pick = await vscode.window.showQuickPick(items, {
    title: '选择文件夹图标',
    placeHolder: '搜索 emoji（按英文名，如 fire / book / star / heart）',
    matchOnDescription: true,
  });
  if (!pick) {
    return undefined;
  }
  if (pick.action === 'clear') {
    return { clear: true };
  }
  if (pick.action === 'custom') {
    const input = await vscode.window.showInputBox({
      title: '输入 emoji',
      prompt: '粘贴一个 emoji 字符',
    });
    if (!input) {
      return undefined;
    }
    const e = [...input.trim()][0];
    if (!e || !resolveEmojiSvg(e)) {
      void vscode.window.showWarningMessage('这个 emoji 没有对应的 Twemoji 图标，换一个试试～');
      return undefined;
    }
    return { emoji: e };
  }
  return { emoji: pick.emoji };
}
