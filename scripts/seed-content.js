import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT_DIR = process.env.CONTENT_DIR;
const DATA_DIR = process.env.DATA_DIR;

// Ensure uploads directory exists inside DATA_DIR
if (DATA_DIR) {
  const uploadsDir = path.join(DATA_DIR, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log('[seed] Created uploads directory at', uploadsDir);
  }
}

if (!CONTENT_DIR) {
  process.exit(0);
}

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../');
const SEED_DIR = path.join(ROOT, 'dist', 'content-seed');
const TRIPS_DIR = path.join(CONTENT_DIR, 'trips');

if (!fs.existsSync(SEED_DIR)) {
  console.warn('[seed] No seed directory found at', SEED_DIR, '— skipping');
  process.exit(0);
}

const alreadySeeded = fs.existsSync(TRIPS_DIR) && fs.readdirSync(TRIPS_DIR).length > 0;

if (alreadySeeded) {
  console.log('[seed] Content already exists in volume, skipping seed');
  process.exit(0);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (!fs.existsSync(d)) fs.copyFileSync(s, d);
  }
}

copyDir(SEED_DIR, CONTENT_DIR);
console.log('[seed] Seeded content from', SEED_DIR, 'to', CONTENT_DIR);
