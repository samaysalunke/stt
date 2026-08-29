import { YAML, fs, path, FAQS_DIR, ensureDir, assertSafeSlug } from './_contentBase';
import { cachedRead, bumpContentVersion } from './contentCache';

/**
 * Cached. The sort happens inside the loader, so the cached array is already
 * ordered and no caller sorts it again in place — `resolveTripFaqs` below
 * builds fresh copies rather than reordering this one, and must stay that way.
 */
export function listFaqs(): Array<Record<string, any>> {
  return cachedRead('faqs', () => {
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
  });
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
  bumpContentVersion();
}

export function deleteFaq(slug: string): void {
  assertSafeSlug(slug);
  const filePath = path.join(FAQS_DIR, `${slug}.yaml`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  bumpContentVersion();
}

export interface ResolvedTripFaq {
  question: string;
  answer: string;
  source: 'global' | 'trip';
  slug?: string;
}

/**
 * Resolve the FAQs shown on a trip from the current global defaults and the
 * trip's explicit overrides. Legacy trips with no FAQ fields inherit all live
 * defaults. References to global FAQs that no longer exist are ignored.
 */
export function resolveTripFaqs(
  trip: Record<string, any>,
  globalFaqs: Array<Record<string, any>> = listFaqs(),
): ResolvedTripFaq[] {
  const include = new Set(
    Array.isArray(trip?.tripFaqOverrides?.include) ? trip.tripFaqOverrides.include.map(String) : [],
  );
  const exclude = new Set(
    Array.isArray(trip?.tripFaqOverrides?.exclude) ? trip.tripFaqOverrides.exclude.map(String) : [],
  );

  const globals = [...globalFaqs]
    .sort((a, b) => (Number(a.order) || 999) - (Number(b.order) || 999))
    .filter((faq) => {
      const slug = String(faq?.slug ?? '');
      return slug && ((faq?.defaultOnTripPages === true && !exclude.has(slug)) || include.has(slug));
    })
    .filter((faq) => String(faq?.question ?? '').trim() && String(faq?.answer ?? '').trim())
    .map((faq) => ({
      slug: String(faq.slug),
      question: String(faq.question).trim(),
      answer: String(faq.answer).trim(),
      source: 'global' as const,
    }));

  const custom = (Array.isArray(trip?.tripFaqs) ? trip.tripFaqs : [])
    .filter((faq: any) => String(faq?.question ?? '').trim() && String(faq?.answer ?? '').trim())
    .map((faq: any) => ({
      question: String(faq.question).trim(),
      answer: String(faq.answer).trim(),
      source: 'trip' as const,
    }));

  return [...globals, ...custom];
}
