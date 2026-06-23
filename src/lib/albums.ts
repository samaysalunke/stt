import { YAML, fs, path, ALBUMS_DIR, TRIPS_DIR, ensureDir, assertSafeSlug, deleteImageByUrl, collectImageUrls } from './_contentBase';

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

export function isAlbumPublic(album: Record<string, any>): boolean {
  const status = String(album?.publicationStatus ?? '').toLowerCase();
  if (status) return status === 'published' || status === 'archived';
  return album?.published === true;
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
  if (!fs.existsSync(filePath)) return;
  try {
    const data = readAlbum(slug);
    if (data) for (const url of collectImageUrls(data)) deleteImageByUrl(url);
  } catch { /* best-effort */ }
  fs.unlinkSync(filePath);
}

export function contentLastmod(kind: 'trips' | 'albums', slug: string): string | undefined {
  const dir = kind === 'trips' ? TRIPS_DIR : ALBUMS_DIR;
  try {
    return fs.statSync(path.join(dir, `${slug}.yaml`)).mtime.toISOString().slice(0, 10);
  } catch {
    return undefined;
  }
}
