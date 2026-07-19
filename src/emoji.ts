import * as vscode from 'vscode';
import ordered from 'unicode-emoji-json/data-ordered-emoji.json';
import byEmoji from 'unicode-emoji-json/data-by-emoji.json';

const EMOJI_LIST = ordered as string[];
const EMOJI_INFO = byEmoji as Record<string, { name: string; group: string }>;

export type PickResult = { emoji?: string; clear?: boolean } | undefined;

/** A searchable emoji picker (native color emoji). Returns chosen emoji, clear, or undefined. */
export async function pickEmoji(current?: string): Promise<PickResult> {
  type Item = vscode.QuickPickItem & { emoji?: string; action?: 'custom' | 'clear' };
  const items: Item[] = [{ label: '$(edit) 输入自定义 emoji…', alwaysShow: true, action: 'custom' }];
  if (current) {
    items.push({ label: '$(close) 清除图标', alwaysShow: true, action: 'clear' });
  }
  for (const e of EMOJI_LIST) {
    items.push({ label: e, description: EMOJI_INFO[e]?.name ?? '', emoji: e });
  }

  const pick = await vscode.window.showQuickPick(items, {
    title: '选择图标',
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
    const input = await vscode.window.showInputBox({ title: '输入 emoji', prompt: '粘贴一个 emoji 字符' });
    if (!input) {
      return undefined;
    }
    const e = [...input.trim()][0];
    return e ? { emoji: e } : undefined;
  }
  return { emoji: pick.emoji };
}
