import { YAML, fs, path, TESTIMONIALS_DIR, ensureDir, assertSafeSlug } from './_contentBase';
import { cachedRead, bumpContentVersion } from './contentCache';

/** Cached. The returned array and its objects are shared and read-only. */
export function listTestimonials(): Array<Record<string, any>> {
  return cachedRead('testimonials', () => {
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
  });
}

export function selectFeaturedTestimonials(
  testimonials: Array<Record<string, any>>,
  limit = 4,
): Array<Record<string, any>> {
  return testimonials.filter(testimonial => testimonial.featured === true).slice(0, limit);
}

export function readTestimonial(slug: string): Record<string, any> | null {
  assertSafeSlug(slug);
  const filePath = path.join(TESTIMONIALS_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return YAML.parse(raw) ?? null;
}

export function writeTestimonial(slug: string, data: Record<string, any>): void {
  assertSafeSlug(slug);
  ensureDir(TESTIMONIALS_DIR);
  const filePath = path.join(TESTIMONIALS_DIR, `${slug}.yaml`);
  fs.writeFileSync(filePath, YAML.stringify(data), 'utf-8');
  bumpContentVersion();
}

export function deleteTestimonial(slug: string): void {
  assertSafeSlug(slug);
  const filePath = path.join(TESTIMONIALS_DIR, `${slug}.yaml`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  bumpContentVersion();
}
