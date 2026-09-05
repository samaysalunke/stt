import YAML from 'yaml';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import sharp from 'sharp';

export { YAML, fs, path, uuid, sharp };

export const CWD = process.cwd();
export const CONTENT_BASE = process.env.CONTENT_DIR ?? path.join(CWD, 'src', 'content');
export const TRIPS_DIR = path.join(CONTENT_BASE, 'trips');
export const ALBUMS_DIR = path.join(CONTENT_BASE, 'albums');
export const TESTIMONIALS_DIR = path.join(CONTENT_BASE, 'testimonials');
export const FAQS_DIR = path.join(CONTENT_BASE, 'faqs');
export const HOSTS_DIR = path.join(CONTENT_BASE, 'hosts');
export const SITE_SETTINGS_FILE = path.join(CONTENT_BASE, 'site-settings.yaml');
export const IMAGES_BASE = path.join(CONTENT_BASE, 'images');

export function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function assertSafeSlug(slug: string): void {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid slug: "${slug}"`);
  }
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export async function saveImageFile(
  file: File,
  destSubDir: string,
  namePart?: string,
): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`Invalid image type: ${file.type}`);
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error('Image too large (max 10 MB)');
  }
  const rawExt = file.name.split('.').pop()?.toLowerCase() ?? '';
  const optimizeForWeb = !destSubDir.includes('/qr');
  const ext = optimizeForWeb ? 'webp' : (ALLOWED_IMAGE_EXTS.includes(rawExt) ? rawExt : 'jpg');
  const filename = namePart ? `${namePart}.${ext}` : `${uuid()}.${ext}`;
  const subPath = destSubDir.replace(/^images\//, '');
  const destDir = path.join(IMAGES_BASE, subPath);
  ensureDir(destDir);
  const buffer = Buffer.from(await file.arrayBuffer());
  const destination = path.join(destDir, filename);
  if (optimizeForWeb) {
    await sharp(buffer)
      .rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toFile(destination);
  } else {
    fs.writeFileSync(destination, buffer);
  }
  return `/${destSubDir}/${filename}`;
}

export async function saveImageFileWithMeta(
  file: File,
  destSubDir: string,
  namePart?: string,
): Promise<{ url: string; width: number | null; height: number | null }> {
  const url = await saveImageFile(file, destSubDir, namePart);
  let width: number | null = null;
  let height: number | null = null;
  try {
    const rel = url.replace(/^\/images\//, '');
    const meta = await sharp(path.join(IMAGES_BASE, rel)).metadata();
    const rotated = meta.orientation && meta.orientation >= 5;
    width = (rotated ? meta.height : meta.width) ?? null;
    height = (rotated ? meta.width : meta.height) ?? null;
  } catch {
    /* dimensions unavailable */
  }
  return { url, width, height };
}

export function deleteImageByUrl(publicUrl: unknown): void {
  if (typeof publicUrl !== 'string' || !publicUrl.startsWith('/images/')) return;
  const rel = publicUrl.replace(/^\/images\//, '');
  if (!rel || rel.includes('..')) return;
  const filePath = path.join(IMAGES_BASE, rel);
  if (!filePath.startsWith(IMAGES_BASE + path.sep)) return;
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
  } catch {
    /* best-effort cleanup */
  }
}

export function collectImageUrls(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (value.startsWith('/images/')) acc.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectImageUrls(v, acc);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectImageUrls(v, acc);
  }
  return acc;
}
