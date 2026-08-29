import type { APIRoute } from 'astro';
import { readTrip } from '../../../../lib/content';
import { editableBooking } from '../../../../lib/tripEditor';
import { sanitizeInput, isValidEmail, isValidPhone, formatDateIN } from '../../../../lib/utils';
import { logAction } from '../../../../lib/audit';
import { createRegistration, type RegStatus } from '../../../../lib/registrationWrite';
import { jsonOk, jsonFail as fail } from '../../../../lib/apiResponse';
import { dispatchTelegramEvent } from '../../../../lib/telegram';

const CREATE_STATUSES: RegStatus[] = ['lead', 'pending', 'confirmed'];

export interface ResolvedSelection {
  trip_name: string; trip_slug: string; trip_date: string;
  batch_id: string; tier_id: string;
  sharing_option: string | null; total_amount: number;
  is_past: boolean;
}

/**
 * Resolve a trip + departure + occupancy selection into the fields a
 * registration row needs. Uses editableBooking (every departure, past included)
 * so historical back-fill works; `is_past` lets callers skip capacity for it.
 * Shared by single-create and bulk-import.
 */
export function resolveSelection(tripSlug: string, batchId: string, tierId: string):
  | { error: string }
  | ResolvedSelection {
  const trip = tripSlug ? readTrip(tripSlug) : null;
  if (!trip || trip.status === 'draft') return { error: 'Trip not found.' };

  const { editorCatalog, editorDepartures } = editableBooking(trip);
  const departure = editorDepartures.find((d) => d.id === batchId);
  if (!departure) return { error: 'Departure not found for this trip.' };

  const offer = tierId
    ? departure.offers.find((o) => o.tierId === tierId)
    : departure.offers.length === 1 ? departure.offers[0] : undefined;
  if (!offer) return {
    error: tierId
      ? 'Occupancy option not found for this departure.'
      : 'Multiple occupancy options — please specify a tier.',
  };

  const label = editorCatalog.find((c) => c.id === offer.tierId)?.label ?? offer.tierId;
  const endMs = new Date(departure.endDate || departure.startDate).getTime();

  return {
    trip_name: (trip.title as string) || (trip.name as string) || tripSlug,
    trip_slug: tripSlug,
    trip_date: `${formatDateIN(departure.startDate)} – ${formatDateIN(departure.endDate || departure.startDate)}`,
    batch_id: departure.id,
    tier_id: offer.tierId,
    sharing_option: editorCatalog.length > 1 ? label : null,
    total_amount: offer.price ?? 0,
    is_past: Number.isFinite(endMs) && endMs < Date.now(),
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
      { sendEmail, skipCapacity: sel.is_past, notifyTelegram: !sel.is_past },
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

    if (result.id && result.telegramEvent) {
      await dispatchTelegramEvent(result.id, result.telegramEvent).catch((err) => console.error('[Telegram admin create]', err));
    }

    return jsonOk({ success: true, id: result.id });
  } catch (err) {
    console.error('[registrations/create]', err);
    return fail('Server error.', 500);
  }
};
