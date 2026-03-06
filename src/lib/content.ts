import YAML from 'yaml';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';

const CWD = process.cwd();
const TRIPS_DIR = path.join(CWD, 'src', 'content', 'trips');
const ALBUMS_DIR = path.join(CWD, 'src', 'content', 'albums');

// ── YAML helpers ─────────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Trips ─────────────────────────────────────────────────────────────────────

export function listTrips(): Array<Record<string, any>> {
  ensureDir(TRIPS_DIR);
  return fs
    .readdirSync(TRIPS_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const slug = f.replace('.yaml', '');
      const raw = fs.readFileSync(path.join(TRIPS_DIR, f), 'utf-8');
      const data = YAML.parse(raw) ?? {};
      return { slug, ...data };
    })
    .sort((a, b) => {
      const order = ['booking-open', 'upcoming', 'draft', 'sold-out', 'completed'];
      return (order.indexOf(a.status) ?? 99) - (order.indexOf(b.status) ?? 99);
    });
}

export function readTrip(slug: string): Record<string, any> | null {
  const filePath = path.join(TRIPS_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return YAML.parse(raw) ?? null;
}

export function writeTrip(slug: string, data: Record<string, any>): void {
  ensureDir(TRIPS_DIR);
  const filePath = path.join(TRIPS_DIR, `${slug}.yaml`);
  fs.writeFileSync(filePath, YAML.stringify(data), 'utf-8');
}

export function deleteTrip(slug: string): void {
  const filePath = path.join(TRIPS_DIR, `${slug}.yaml`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── Albums ────────────────────────────────────────────────────────────────────

export function listAlbums(): Array<Record<string, any>> {
  ensureDir(ALBUMS_DIR);
  return fs
    .readdirSync(ALBUMS_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const slug = f.replace('.yaml', '');
      const raw = fs.readFileSync(path.join(ALBUMS_DIR, f), 'utf-8');
      const data = YAML.parse(raw) ?? {};
      return { slug, ...data };
    });
}

export function readAlbum(slug: string): Record<string, any> | null {
  const filePath = path.join(ALBUMS_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return YAML.parse(raw) ?? null;
}

export function writeAlbum(slug: string, data: Record<string, any>): void {
  ensureDir(ALBUMS_DIR);
  const filePath = path.join(ALBUMS_DIR, `${slug}.yaml`);
  fs.writeFileSync(filePath, YAML.stringify(data), 'utf-8');
}

export function deleteAlbum(slug: string): void {
  const filePath = path.join(ALBUMS_DIR, `${slug}.yaml`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── Image upload ──────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function saveImageFile(
  file: File,
  destSubDir: string,   // e.g. 'images/trips' — relative to public/
  namePart?: string     // optional prefix, e.g. slug; otherwise uses uuid
): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`Invalid image type: ${file.type}`);
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error('Image too large (max 10 MB)');
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const filename = namePart ? `${namePart}.${ext}` : `${uuid()}.${ext}`;
  const destDir = path.join(CWD, 'public', destSubDir);
  ensureDir(destDir);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(destDir, filename), buffer);

  return `/${destSubDir}/${filename}`; // public URL
}
