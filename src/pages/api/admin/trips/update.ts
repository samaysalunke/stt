import type { APIRoute } from 'astro';
import { readTrip, writeTrip, deleteTrip, saveImageFile } from '../../../../lib/content';
import { sanitizeInput, slugify } from '../../../../lib/utils';
import { parseEditorBooking } from '../../../../lib/tripEditor';

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

  let paymentQrCode = sanitizeInput(body.get('existingPaymentQrCode')) || null;
  const qrFile = body.get('paymentQrCode') as File | null;
  if (qrFile && qrFile.size > 0) {
    paymentQrCode = await saveImageFile(qrFile, 'images/qr');
  }

  const data: Record<string, any> = {
    name: sanitizeInput(body.get('name')),
    status: sanitizeInput(body.get('status')) || 'draft',
    duration: sanitizeInput(body.get('duration')) || null,
    shortDescription: sanitizeInput(body.get('shortDescription')) || null,
    description: sanitizeInput(body.get('description')) || null,
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
    paymentQrCode,
    paymentAmount: body.get('paymentAmount') ? Number(body.get('paymentAmount')) : null,
    paymentInstructions: sanitizeInput(body.get('paymentInstructions')) || null,
    linkedAlbumSlug: sanitizeInput(body.get('linkedAlbumSlug')) || null,
    balanceDueRule: sanitizeInput(body.get('balanceDueRule')) || null,
    occupancyCatalog,
    batches,
  };

  if (newSlug !== oldSlug) {
    deleteTrip(oldSlug);
  }
  writeTrip(newSlug, data);
  return redirect(`/admin/trips/${newSlug}`);
};
