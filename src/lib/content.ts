import YAML from 'yaml';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';

const CWD = process.cwd();
const CONTENT_BASE = process.env.CONTENT_DIR ?? path.join(CWD, 'src', 'content');
const TRIPS_DIR = path.join(CONTENT_BASE, 'trips');
const ALBUMS_DIR = path.join(CONTENT_BASE, 'albums');
const TESTIMONIALS_DIR = path.join(CONTENT_BASE, 'testimonials');
const SITE_SETTINGS_FILE = path.join(CONTENT_BASE, 'site-settings.yaml');

// ── YAML helpers ─────────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function assertSafeSlug(slug: string): void {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid slug: "${slug}"`);
  }
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
      const order = ['booking-open', 'sold-out', 'draft'];
      const ai = order.indexOf(a.status); const bi = order.indexOf(b.status);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
}

export function readTrip(slug: string): Record<string, any> | null {
  assertSafeSlug(slug);
  const filePath = path.join(TRIPS_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return YAML.parse(raw) ?? null;
}

export function writeTrip(slug: string, data: Record<string, any>): void {
  assertSafeSlug(slug);
  ensureDir(TRIPS_DIR);
  const filePath = path.join(TRIPS_DIR, `${slug}.yaml`);
  fs.writeFileSync(filePath, YAML.stringify(data), 'utf-8');
}

export function deleteTrip(slug: string): void {
  assertSafeSlug(slug);
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
  assertSafeSlug(slug);
  const filePath = path.join(ALBUMS_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return YAML.parse(raw) ?? null;
}

export function writeAlbum(slug: string, data: Record<string, any>): void {
  assertSafeSlug(slug);
  ensureDir(ALBUMS_DIR);
  const filePath = path.join(ALBUMS_DIR, `${slug}.yaml`);
  fs.writeFileSync(filePath, YAML.stringify(data), 'utf-8');
}

export function deleteAlbum(slug: string): void {
  assertSafeSlug(slug);
  const filePath = path.join(ALBUMS_DIR, `${slug}.yaml`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── Site Settings ────────────────────────────────────────────────────────────

export function readSiteSettings(): Record<string, any> {
  if (!fs.existsSync(SITE_SETTINGS_FILE)) return {};
  const raw = fs.readFileSync(SITE_SETTINGS_FILE, 'utf-8');
  return YAML.parse(raw) ?? {};
}

// ── Testimonials ─────────────────────────────────────────────────────────────

export function listTestimonials(): Array<Record<string, any>> {
  ensureDir(TESTIMONIALS_DIR);
  return fs
    .readdirSync(TESTIMONIALS_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const slug = f.replace('.yaml', '');
      const raw = fs.readFileSync(path.join(TESTIMONIALS_DIR, f), 'utf-8');
      const data = YAML.parse(raw) ?? {};
      return { slug, ...data };
    });
}

// ── Image upload ──────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

// Images go to CONTENT_DIR/images/ (persistent on Railway volume).
// Falls back to public/images/ in local dev when CONTENT_DIR is not set.
const IMAGES_BASE = path.join(CONTENT_BASE, 'images');

export async function saveImageFile(
  file: File,
  destSubDir: string,   // e.g. 'images/trips' — relative to content base
  namePart?: string     // optional prefix, e.g. slug; otherwise uses uuid
): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`Invalid image type: ${file.type}`);
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error('Image too large (max 10 MB)');
  }

  const rawExt = file.name.split('.').pop()?.toLowerCase() ?? '';
  const ext = ALLOWED_IMAGE_EXTS.includes(rawExt) ? rawExt : 'jpg';
  const filename = namePart ? `${namePart}.${ext}` : `${uuid()}.${ext}`;

  // Strip the leading 'images/' prefix if present so we store under IMAGES_BASE
  const subPath = destSubDir.replace(/^images\//, '');
  const destDir = path.join(IMAGES_BASE, subPath);
  ensureDir(destDir);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(destDir, filename), buffer);

  return `/${destSubDir}/${filename}`; // public URL via /images/[...path].ts
}
