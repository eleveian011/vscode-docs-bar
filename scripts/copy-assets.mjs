// Copy Twemoji SVGs from the (dev) dependency into assets/twemoji so they ship
// inside the .vsix. Keeps ~3700 svgs out of git while making them available at
// runtime and to contributors after `npm install`.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@twemoji', 'svg');
const dst = join(root, 'assets', 'twemoji');

if (!existsSync(src)) {
  console.warn('[copy-assets] @twemoji/svg not found — run `npm install` first. Skipping.');
  process.exit(0);
}

mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
const count = readdirSync(dst).filter((f) => f.endsWith('.svg')).length;
console.log(`[copy-assets] copied ${count} twemoji svgs -> assets/twemoji`);
