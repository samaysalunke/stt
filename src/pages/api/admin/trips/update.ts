import type { APIRoute } from 'astro';
import { readTrip, writeTrip, deleteTrip, saveImageFile } from '../../../../lib/content';
import { submitToIndexNow } from '../../../../lib/indexnow';
import { sanitizeInput, slugify } from '../../../../lib/utils';
import { parseEditorBooking, parseGallery } from '../../../../lib/tripEditor';

export const POST: APIRoute = async ({ request, redirect }) => {
  const body = await request.formData();

  const oldSlug = sanitizeInput(body.get('slug'));
  if (!oldSlug) return redirect('/admin/trips');

  const existing = readTrip(oldSlug);
  if (!existing) return redirect('/admin/trips');

  const rawNewSlug = sanitizeInput(body.get('newSlug'));
  const newSlug = rawNewSlug ? slugify(rawNewSlug) : oldSlug;

  // Occupancy catalog + departures-with-offers come in as serialized JSON from
  // the editor (nested data; parallel form arrays don't fit). parseEditorBooking
  // validates + normalizes both into trip YAML shape.
  const { occupancyCatalog, batches } = parseEditorBooking(
    sanitizeInput(body.get('occupancyCatalog_json')),
    sanitizeInput(body.get('departures_json')),
  );
  // Backfill any blank departure id from the (possibly new) slug + start date.
  for (const b of batches) {
    if (!b.id && b.startDate) b.id = `${newSlug}-${b.startDate}`;
  }

  const highlights = body.getAll('highlights[]').map(h => sanitizeInput(h)).filter(Boolean);
  const included = body.getAll('included[]').map(h => sanitizeInput(h)).filter(Boolean);
  const notIncluded = body.getAll('notIncluded[]').map(h => sanitizeInput(h)).filter(Boolean);
  const packingList = body.getAll('packingList[]').map(h => sanitizeInput(h)).filter(Boolean);

  let itinerary: object[] = [];
  try {
    const raw = body.get('itinerary_json')?.toString() ?? '[]';
    itinerary = JSON.parse(raw);
  } catch { /* ignore */ }

  // Featured image: use new if uploaded, else keep existing
  let featuredImage = sanitizeInput(body.get('existingFeaturedImage')) || null;
  const featuredFile = body.get('featuredImage') as File | null;
  if (featuredFile && featuredFile.size > 0) {
    featuredImage = await saveImageFile(featuredFile, 'images/trips', `${newSlug}-featured`);
  }

  const gallery = parseGallery(body.get('gallery_json'));

  const tripName = sanitizeInput(body.get('name'));
  // NOTE: writeTrip does a full overwrite — every field that must survive a save
  // MUST be listed here. Any YAML field absent from this object is destroyed on
  // save. See the round-trip test in the admin trips suite.
  const data: Record<string, any> = {
    // Keep both fields in sync: editor posts `name`, content/public read `title`.
    name: tripName,
    title: tripName,
    // Explicit boolean so a missing value never re-appears (missing ⇒ closed).
    registrationEnabled: body.get('registrationEnabled') === 'true',
    publicationStatus: sanitizeInput(body.get('publicationStatus')) || existing.publicationStatus || 'draft',
    location: sanitizeInput(body.get('location')) || null,
    duration: sanitizeInput(body.get('duration')) || null,
    shortDescription: sanitizeInput(body.get('shortDescription')) || null,
    description: sanitizeInput(body.get('description')) || null,
    seoTitle: sanitizeInput(body.get('seoTitle')) || null,
    seoDescription: sanitizeInput(body.get('seoDescription')) || null,
    imageAlt: sanitizeInput(body.get('imageAlt')) || null,
    whoShouldJoin: sanitizeInput(body.get('whoShouldJoin')) || null,
    highlights,
    included,
    notIncluded,
    packingList,
    itinerary,
    meetingPoint: sanitizeInput(body.get('meetingPoint')) || null,
    meetingTime: sanitizeInput(body.get('meetingTime')) || null,
    importantNotes: sanitizeInput(body.get('importantNotes')) || null,
    cancellationPolicy: sanitizeInput(body.get('cancellationPolicy')) || null,
    featuredImage,
    gallery,
    paymentAmount: body.get('paymentAmount') ? Number(body.get('paymentAmount')) : null,
    balanceDueRule: sanitizeInput(body.get('balanceDueRule')) || null,
    occupancyCatalog,
    batches,
  };

  if (newSlug !== oldSlug) {
    deleteTrip(oldSlug);
  }
  writeTrip(newSlug, data);
  // Ping the new URL; on a slug change also ping the old one so engines drop it.
  await submitToIndexNow([`/trips/${newSlug}/`, ...(newSlug !== oldSlug ? [`/trips/${oldSlug}/`] : [])]);
  return redirect(`/admin/trips/${newSlug}?saved=1`);
};
