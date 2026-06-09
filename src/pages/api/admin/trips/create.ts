import type { APIRoute } from 'astro';
import { writeTrip, saveImageFile } from '../../../../lib/content';
import { sanitizeInput, slugify } from '../../../../lib/utils';
import { parseEditorBooking } from '../../../../lib/tripEditor';

export const POST: APIRoute = async ({ request, redirect }) => {
  const body = await request.formData();

  const name = sanitizeInput(body.get('name'));
  const slug = slugify(sanitizeInput(body.get('slug') as string) || name);

  if (!slug) return redirect('/admin/trips/new?error=slug');

  // Occupancy catalog + departures-with-offers come in as serialized JSON.
  const { occupancyCatalog, batches } = parseEditorBooking(
    sanitizeInput(body.get('occupancyCatalog_json')),
    sanitizeInput(body.get('departures_json')),
  );
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

  let featuredImage = '';
  const featuredFile = body.get('featuredImage') as File | null;
  if (featuredFile && featuredFile.size > 0) {
    featuredImage = await saveImageFile(featuredFile, 'images/trips', `${slug}-featured`);
  }

  let paymentQrCode = '';
  const qrFile = body.get('paymentQrCode') as File | null;
  if (qrFile && qrFile.size > 0) {
    paymentQrCode = await saveImageFile(qrFile, 'images/qr');
  }

  const data: Record<string, any> = {
    name,
    status: sanitizeInput(body.get('status')) || 'draft',
    duration: sanitizeInput(body.get('duration')) || null,
    registrationEnabled: body.get('registrationEnabled') === 'true',
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
    featuredImage: featuredImage || null,
    paymentQrCode: paymentQrCode || null,
    paymentAmount: body.get('paymentAmount') ? Number(body.get('paymentAmount')) : null,
    paymentInstructions: sanitizeInput(body.get('paymentInstructions')) || null,
    linkedAlbumSlug: sanitizeInput(body.get('linkedAlbumSlug')) || null,
    balanceDueRule: sanitizeInput(body.get('balanceDueRule')) || null,
    occupancyCatalog,
    batches,
  };

  writeTrip(slug, data);
  return redirect(`/admin/trips/${slug}`);
};
