import type { APIRoute } from 'astro';
import { readTrip, writeTrip, deleteTrip, saveImageFile } from '../../../../lib/content';
import { sanitizeInput, slugify } from '../../../../lib/utils';

export const POST: APIRoute = async ({ request, redirect }) => {
  const body = await request.formData();

  const oldSlug = sanitizeInput(body.get('slug'));
  if (!oldSlug) return redirect('/admin/trips');

  const existing = readTrip(oldSlug);
  if (!existing) return redirect('/admin/trips');

  const rawNewSlug = sanitizeInput(body.get('newSlug'));
  const newSlug = rawNewSlug ? slugify(rawNewSlug) : oldSlug;

  // Departure dates (batches): parallel arrays -> objects. Filter out blank rows.
  const bStart = body.getAll('batchStart[]').map(s => sanitizeInput(s));
  const bEnd = body.getAll('batchEnd[]').map(s => sanitizeInput(s));
  const bPrice = body.getAll('batchPrice[]').map(s => Number(s));
  const bTotal = body.getAll('batchTotal[]').map(s => Number(s));
  const bBooked = body.getAll('batchBooked[]').map(s => Number(s));
  const bId = body.getAll('batchId[]').map(s => sanitizeInput(s));
  const bStatus = body.getAll('batchStatus[]').map(s => sanitizeInput(s));
  const batches = bStart
    .map((startDate, i) => ({
      id: bId[i] || (startDate ? `${newSlug}-${startDate}` : ''),
      startDate,
      endDate: bEnd[i] || '',
      price: Number.isFinite(bPrice[i]) ? Math.round(bPrice[i]) : null,
      totalSpots: Number.isFinite(bTotal[i]) ? bTotal[i] : null,
      bookedSpots: Number.isFinite(bBooked[i]) ? bBooked[i] : 0,
      status: bStatus[i] || 'booking-open',
    }))
    .filter(b => b.startDate);

  // Occupancy / room-sharing options: parallel label[] + price[] arrays -> objects
  const sharingLabels = body.getAll('sharingLabel[]').map(s => sanitizeInput(s));
  const sharingPrices = body.getAll('sharingPrice[]').map(s => Number(s));
  const sharingOptions = sharingLabels
    .map((label, i) => ({ label, price: sharingPrices[i] }))
    .filter(o => o.label && Number.isFinite(o.price) && o.price > 0)
    .map(o => ({ id: slugify(o.label), label: o.label, price: Math.round(o.price) }));

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
    startDate: sanitizeInput(body.get('startDate')) || null,
    endDate: sanitizeInput(body.get('endDate')) || null,
    duration: sanitizeInput(body.get('duration')) || null,
    pricePerPerson: body.get('pricePerPerson') ? Number(body.get('pricePerPerson')) : null,
    minGroupSize: body.get('minGroupSize') ? Number(body.get('minGroupSize')) : null,
    maxGroupSize: body.get('maxGroupSize') ? Number(body.get('maxGroupSize')) : null,
    currentBookings: Number(body.get('currentBookings') ?? 0),
    registrationDeadline: sanitizeInput(body.get('registrationDeadline')) || null,
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
    fullPaymentAmount: body.get('fullPaymentAmount') ? Number(body.get('fullPaymentAmount')) : null,
    paymentInstructions: sanitizeInput(body.get('paymentInstructions')) || null,
    linkedAlbumSlug: sanitizeInput(body.get('linkedAlbumSlug')) || null,
    sharingOptions,
    batches,
  };

  if (newSlug !== oldSlug) {
    deleteTrip(oldSlug);
  }
  writeTrip(newSlug, data);
  return redirect(`/admin/trips/${newSlug}`);
};
