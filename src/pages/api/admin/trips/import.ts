import type { APIRoute } from 'astro';
import YAML from 'yaml';
import { readTrip, writeTrip, tripHasUpcomingDates, tripCardSummary } from '../../../../lib/content';
import { slugify } from '../../../../lib/utils';

// Bulk import trips from a YAML or JSON document. The `yaml` parser accepts
// JSON too (JSON is a subset of YAML), so one parse path handles both.
// The document may be a single trip object or a list of trip objects.
//
// POST JSON body: { content: string, dryRun?: boolean }
//  - dryRun: parse + validate + report what would happen, write nothing
//  - commit: write each valid trip via writeTrip (overwrites existing slugs)

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Expected a JSON request body.' }, 400);
  }

  const content = (body?.content ?? '').toString().trim();
  const dryRun = body?.dryRun === true;
  if (!content) return json({ success: false, error: 'No content provided.' }, 400);

  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch (e: any) {
    return json({ success: false, error: `Could not parse YAML/JSON: ${e?.message ?? 'invalid format'}` }, 400);
  }

  // Normalize to an array. Accept either a top-level list, or { trips: [...] }.
  let items: any[];
  if (Array.isArray(parsed)) items = parsed;
  else if (parsed && Array.isArray((parsed as any).trips)) items = (parsed as any).trips;
  else if (parsed && typeof parsed === 'object') items = [parsed];
  else return json({ success: false, error: 'Document must be a trip object or a list of trips.' }, 400);

  if (items.length === 0) return json({ success: false, error: 'No trips found in the document.' }, 400);

  const preview: Array<{ slug: string; title: string; status: string; action: 'create' | 'overwrite' }> = [];
  const errors: string[] = [];
  const toWrite: Array<{ slug: string; data: Record<string, any> }> = [];

  items.forEach((item, i) => {
    const label = `Item ${i + 1}`;
    if (!item || typeof item !== 'object') { errors.push(`${label}: not a valid trip object.`); return; }

    const title = (item.title ?? item.name ?? '').toString().trim();
    if (!title) { errors.push(`${label}: missing "title" (or "name").`); return; }

    const rawSlug = (item.slug ?? title).toString();
    const slug = slugify(rawSlug);
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) { errors.push(`${label} ("${title}"): could not derive a valid slug.`); return; }

    // Write the trip object largely as-is — it already matches the trip YAML
    // schema, including nested arrays (batches, itinerary, highlights, …).
    // Ensure slug + title are present and consistent.
    // The editor/create/update layer keys off `name`; content/import uses
    // `title`. Write both (identical) so imported trips show their name in admin.
    const data: Record<string, any> = { ...item, slug, title, name: title };
    // Trip-level status was removed — visibility/sold-out derive from departures.
    // Strip any legacy top-level status carried in the YAML.
    delete data.status;

    // Preview state is derived from the departures, same as the live site.
    const derivedStatus = !tripHasUpcomingDates(data)
      ? 'no upcoming dates'
      : (tripCardSummary(data).soldOut ? 'sold-out' : 'booking-open');

    const exists = readTrip(slug) !== null;
    preview.push({ slug, title, status: derivedStatus, action: exists ? 'overwrite' : 'create' });
    toWrite.push({ slug, data });
  });

  if (dryRun) {
    return json({ success: true, dryRun: true, preview, errors });
  }

  // Commit
  if (toWrite.length === 0) {
    return json({ success: false, error: 'Nothing valid to import.', errors }, 400);
  }
  let created = 0, overwritten = 0;
  for (const { slug, data } of toWrite) {
    const existed = readTrip(slug) !== null;
    writeTrip(slug, data);
    if (existed) overwritten++; else created++;
  }
  return json({ success: true, dryRun: false, created, overwritten, errors });
};
