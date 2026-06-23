import { YAML, fs, path, FAQS_DIR, ensureDir, assertSafeSlug } from './_contentBase';

export function listFaqs(): Array<Record<string, any>> {
  ensureDir(FAQS_DIR);
  return fs
    .readdirSync(FAQS_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const slug = f.replace('.yaml', '');
      const raw = fs.readFileSync(path.join(FAQS_DIR, f), 'utf-8');
      const data = YAML.parse(raw) ?? {};
      return { slug, ...data };
    })
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

export function readFaq(slug: string): Record<string, any> | null {
  assertSafeSlug(slug);
  const filePath = path.join(FAQS_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return YAML.parse(raw) ?? null;
}

export function writeFaq(slug: string, data: Record<string, any>): void {
  assertSafeSlug(slug);
  ensureDir(FAQS_DIR);
  const filePath = path.join(FAQS_DIR, `${slug}.yaml`);
  fs.writeFileSync(filePath, YAML.stringify(data), 'utf-8');
}

export function deleteFaq(slug: string): void {
  assertSafeSlug(slug);
  const filePath = path.join(FAQS_DIR, `${slug}.yaml`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
