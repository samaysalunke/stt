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

  const categories = body.getAll('categories').map(c => String(c));
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
    difficulty: sanitizeInput(body.get('difficulty')) || null,
    categories,
    minGroupSize: body.get('minGroupSize') ? Number(body.get('minGroupSize')) : null,
    maxGroupSize: body.get('maxGroupSize') ? Number(body.get('maxGroupSize')) : null,
    currentBookings: Number(body.get('currentBookings') ?? 0),
    registrationEnabled: body.get('registrationEnabled') === 'true',
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
  };

  if (newSlug !== oldSlug) {
    deleteTrip(oldSlug);
  }
  writeTrip(newSlug, data);
  return redirect(`/admin/trips/${newSlug}`);
};
