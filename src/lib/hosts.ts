import { YAML, fs, path, HOSTS_DIR, ensureDir, assertSafeSlug, deleteImageByUrl } from './_contentBase';
import { cachedRead, bumpContentVersion } from './contentCache';
import { listTrips } from './trips';

export interface Host {
  slug: string;
  name: string;
  /** Free-text line under the name. Deliberately not an enum. */
  subtitle: string;
  photo: string | null;
  bio: string;
}

function shape(slug: string, data: Record<string, any>): Host {
  return {
    slug,
    name: String(data?.name ?? ''),
    subtitle: String(data?.subtitle ?? ''),
    photo: data?.photo ? String(data.photo) : null,
    bio: String(data?.bio ?? ''),
  };
}

/** Cached. The returned array and its objects are shared and read-only. */
export function listHosts(): Host[] {
  return cachedRead('hosts', () => {
    ensureDir(HOSTS_DIR);
    return fs
      .readdirSync(HOSTS_DIR)
      .filter(f => f.endsWith('.yaml'))
      .map(f => shape(f.replace('.yaml', ''), YAML.parse(fs.readFileSync(path.join(HOSTS_DIR, f), 'utf-8')) ?? {}))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

export function readHost(slug: string): Host | null {
  assertSafeSlug(slug);
  const filePath = path.join(HOSTS_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  return shape(slug, YAML.parse(fs.readFileSync(filePath, 'utf-8')) ?? {});
}

export function writeHost(slug: string, data: Record<string, any>): void {
  assertSafeSlug(slug);
  ensureDir(HOSTS_DIR);
  fs.writeFileSync(path.join(HOSTS_DIR, `${slug}.yaml`), YAML.stringify(data), 'utf-8');
  bumpContentVersion();
}

export function deleteHost(slug: string): void {
  assertSafeSlug(slug);
  const existing = readHost(slug);
  if (existing?.photo) deleteImageByUrl(existing.photo);
  const filePath = path.join(HOSTS_DIR, `${slug}.yaml`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  bumpContentVersion();
}

/** Resolve a departure's hostIds to records, in the order given. Unknown slugs drop out. */
export function resolveHosts(ids: unknown): Host[] {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const bySlug = new Map(listHosts().map(h => [h.slug, h]));
  const seen = new Set<string>();
  const out: Host[] = [];
  for (const raw of ids) {
    const slug = String(raw ?? '').trim();
    if (!slug || seen.has(slug)) continue;
    const host = bySlug.get(slug);
    if (host) { out.push(host); seen.add(slug); }
  }
  return out;
}

/** Trip slugs with any departure referencing this host. Powers the delete guard. */
export function tripsUsingHost(slug: string): string[] {
  return listTrips()
    .filter(t => (Array.isArray(t.batches) ? t.batches : [])
      .some((b: any) => Array.isArray(b?.hostIds) && b.hostIds.includes(slug)))
    .map(t => String(t.slug));
}
