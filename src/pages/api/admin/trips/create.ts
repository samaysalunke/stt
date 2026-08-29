import type { APIRoute } from 'astro';
import { writeTrip, saveImageFile, clearTripSlugAlias, normalizeItineraryPhotos, tripPriority } from '../../../../lib/content';
import { submitToIndexNow } from '../../../../lib/indexnow';
import { purgeUrls, tripPaths } from '../../../../lib/cachePurge';
import { sanitizeInput, slugify } from '../../../../lib/utils';
import { parseEditorBooking, parseGallery, parseTripFaqs } from '../../../../lib/tripEditor';
import { withAdminTripUpdate } from '../../../../lib/tripAdminMetadata';
import { generateTripSeo } from '../../../../lib/tripSeo';

export const POST: APIRoute = async ({ request, redirect }) => {
  const body = await request.formData();

  const name = sanitizeInput(body.get('name'));
  const slug = slugify(sanitizeInput(body.get('slug') as string) || name);

  if (!slug) return redirect('/admin/trips/new?error=slug');

  // Occupancy catalog + departures-with-offers come in as serialized JSON.
  const { occupancyCatalog, batches, errors: bookingErrors } = parseEditorBooking(
    sanitizeInput(body.get('occupancyCatalog_json')),
    sanitizeInput(body.get('departures_json')),
  );
  if (bookingErrors.length > 0) {
    return redirect('/admin/trips/new?error=incomplete-departure');
  }
  for (const b of batches) {
    if (!b.id && b.startDate) b.id = `${slug}-${b.startDate}`;
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
  normalizeItineraryPhotos(itinerary);

  let featuredImage = '';
  const featuredFile = body.get('featuredImage') as File | null;
  if (featuredFile && featuredFile.size > 0) {
    featuredImage = await saveImageFile(featuredFile, 'images/trips', `${slug}-featured`);
    // Deterministic filename: this overwrites any existing cover at the same
    // URL, so the edge copy of that URL has to go with it.
    await purgeUrls([featuredImage]);
  }

  const gallery = parseGallery(body.get('gallery_json'));
  const accommodationGallery = parseGallery(body.get('accommodationGallery_json'), {
    totalLimit: 10,
    removeDuplicates: true,
  });
  const { tripFaqOverrides, tripFaqs } = parseTripFaqs(
    body.get('tripFaqOverrides_json'), body.get('tripFaqs_json'),
  );

  const location = sanitizeInput(body.get('location')) || null;
  const shortDescription = sanitizeInput(body.get('shortDescription')) || null;
  const description = sanitizeInput(body.get('description')) || null;
  const generatedSeo = generateTripSeo({ name, location, shortDescription, description });

  const data: Record<string, any> = withAdminTripUpdate({
    // Keep both fields in sync: editor posts `name`, content/public read `title`.
    name,
    title: name,
    publicationStatus: sanitizeInput(body.get('publicationStatus')) || 'draft',
    priority: tripPriority(body.get('priority')),
    location,
    duration: sanitizeInput(body.get('duration')) || null,
    shortDescription,
    description,
    ...generatedSeo,
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
    featuredImage: featuredImage || null,
    gallery,
    accommodationGallery,
    tripFaqOverrides,
    tripFaqs,
    paymentAmount: body.get('paymentAmount') ? Number(body.get('paymentAmount')) : null,
    balanceDueRule: sanitizeInput(body.get('balanceDueRule')) || null,
    occupancyCatalog,
    batches,
  });

  // If this slug used to be a redirect alias, it's a real trip again now.
  clearTripSlugAlias(slug);
  writeTrip(slug, data);
  await submitToIndexNow([`/trips/${slug}/`]);
  await purgeUrls(tripPaths(slug));
  return redirect(`/admin/trips/${slug}`);
};
