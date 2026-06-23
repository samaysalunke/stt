import { YAML, fs, path, TESTIMONIALS_DIR, ensureDir, assertSafeSlug } from './_contentBase';

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
}

export function deleteTestimonial(slug: string): void {
  assertSafeSlug(slug);
  const filePath = path.join(TESTIMONIALS_DIR, `${slug}.yaml`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
