import type { APIRoute } from 'astro';
import { readTrip, resolveBooking } from '../../../../lib/content';
import { sanitizeInput, isValidEmail, isValidPhone } from '../../../../lib/utils';
import { logAction } from '../../../../lib/audit';
import { createRegistration, type RegStatus } from '../../../../lib/registrationWrite';

const CREATE_STATUSES: RegStatus[] = ['lead', 'pending', 'confirmed'];

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const fail = (error: string, status = 400) =>
  new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Resolve a trip + departure + occupancy selection into the fields a
 * registration row needs. Shared by single-create and bulk-import.
 */
export function resolveSelection(tripSlug: string, batchId: string, tierId: string):
  | { error: string }
  | {
      trip_name: string; trip_slug: string; trip_date: string;
      batch_id: string; tier_id: string;
      sharing_option: string | null; total_amount: number;
    } {
  const trip = tripSlug ? readTrip(tripSlug) : null;
  if (!trip || trip.status === 'draft') return { error: 'Trip not found.' };

  const booking = resolveBooking(trip);
  const departure = booking.departures.find((d) => d.id === batchId);
  if (!departure) return { error: 'Departure not found for this trip.' };

  const offer = departure.offers.find((o) => o.tierId === tierId);
  if (!offer) return { error: 'Occupancy option not found for this departure.' };

  return {
    trip_name: (trip.title as string) || (trip.name as string) || tripSlug,
    trip_slug: tripSlug,
    trip_date: `${fmtDate(departure.startDate)} – ${fmtDate(departure.endDate)}`,
    batch_id: departure.id,
    tier_id: offer.tierId,
    sharing_option: booking.occupancyCatalog.length > 1 ? offer.label : null,
    total_amount: offer.price,
  };
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();

    const tripSlug = sanitizeInput(body.tripSlug);
    const batchId = sanitizeInput(body.batchId);
    const tierId = sanitizeInput(body.tierId);
    const status = sanitizeInput(body.status) as RegStatus;
    const sendEmail = body.sendEmail === true || body.sendEmail === 'true';

    if (!CREATE_STATUSES.includes(status)) return fail('Pick a valid status (lead, pending, or confirmed).');

    const sel = resolveSelection(tripSlug, batchId, tierId);
    if ('error' in sel) return fail(sel.error);

    const full_name = sanitizeInput(body.full_name);
    const email = sanitizeInput(body.email);
    const phone = sanitizeInput(body.phone);

    if (!full_name || !email || !phone) return fail('Name, email and phone are required.');
    if (!isValidEmail(email)) return fail('Invalid email address.');
    if (!isValidPhone(phone)) return fail('Invalid phone number.');

    const result = createRegistration(
      {
        ...sel,
        full_name, email, phone,
        age: sanitizeInput(body.age) || null,
        gender: sanitizeInput(body.gender) || null,
        city: sanitizeInput(body.city) || null,
        instagram: sanitizeInput(body.instagram) || null,
        emergency_name: sanitizeInput(body.emergency_name) || null,
        emergency_phone: sanitizeInput(body.emergency_phone) || null,
        why_join: sanitizeInput(body.why_join) || null,
        status,
        admin_notes: sanitizeInput(body.admin_notes) || 'Added by admin',
      },
      { sendEmail },
    );

    if (!result.ok) {
      const code = result.error === 'duplicate' ? 409 : 400;
      return fail(result.message ?? 'Could not create registration.', code);
    }

    logAction({
      actorUserId: locals.adminUser?.userId,
      actorEmail: locals.adminUser?.email,
      actorRole: locals.adminUser?.role,
      action: 'booking.created',
      targetType: 'registration',
      targetId: String(result.id),
      newValue: { trip: sel.trip_name, status, source: 'admin-single' },
    });

    return new Response(JSON.stringify({ success: true, id: result.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[registrations/create]', err);
    return fail('Server error.', 500);
  }
};
