import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../');
const SRC = path.join(ROOT, 'src', 'content');
const DEST = path.join(ROOT, 'dist', 'content-seed');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // qa-test-* fixtures exist only for local/CI e2e runs (status: test).
    // Never ship them in the seed bundle — they'd land on the prod volume
    // and clutter the admin trip list forever.
    if (entry.name.startsWith('qa-test-')) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

copyDir(SRC, DEST);
console.log('[build] Copied content seed to dist/content-seed/');
