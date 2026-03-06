import type { APIRoute } from 'astro';
import { writeTrip, saveImageFile } from '../../../../lib/content';
import { sanitizeInput, slugify } from '../../../../lib/utils';

export const POST: APIRoute = async ({ request, redirect }) => {
  const body = await request.formData();

  const name = sanitizeInput(body.get('name'));
  const slug = slugify(sanitizeInput(body.get('slug') as string) || name);

  if (!slug) return redirect('/admin/trips/new?error=slug');

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
    featuredImage: featuredImage || null,
    paymentQrCode: paymentQrCode || null,
    paymentAmount: body.get('paymentAmount') ? Number(body.get('paymentAmount')) : null,
    fullPaymentAmount: body.get('fullPaymentAmount') ? Number(body.get('fullPaymentAmount')) : null,
    paymentInstructions: sanitizeInput(body.get('paymentInstructions')) || null,
  };

  writeTrip(slug, data);
  return redirect(`/admin/trips/${slug}`);
};
