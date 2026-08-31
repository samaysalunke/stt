import { getDb } from './db';
import { listTrips, readTrip, writeTrip, findTripByName } from './content';
import { recalculateUserLeaderboard } from './stats';
import { sendRegistrationPaymentConfirmed } from './email';
import { recordPayment, zohoMode } from './paymentLedger';
import { processZohoDocument } from './zohoBooks';
import { derivePaymentStatus } from './registrationStatus';
import { enqueueTelegramEvent } from './telegram';

export type RegStatus = 'wishlist' | 'lead' | 'pending' | 'confirmed' | 'rejected';

/** The advance (paymentAmount) configured on the trip — the amount collected on confirm. */
export function tripAdvanceAmountBySlug(tripSlug: string): number {
  try {
    const tripData = readTrip(tripSlug);
    const advance = tripData?.paymentAmount;
    return Number.isFinite(Number(advance)) ? Math.round(Number(advance)) : 0;
  } catch {
    return 0;
  }
}

export function tripAdvanceAmount(tripName: string): number {
  const matched = findTripByName(tripName);
  return matched ? tripAdvanceAmountBySlug(matched.slug) : 0;
}

/**
 * Adjust the booked count on the specific departure (batch) a booking is for.
 *
 * `bookedSpots` is an admin-maintained counter (seeded/edited by hand to reflect
 * offline bookings); confirm/un-confirm nudge it by ±1. When `tierId` is given
 * and the batch uses the per-offer schema, also updates that `offer.booked`.
 *
 * ATOMICITY INVARIANT — keep this fully SYNCHRONOUS. Node is single-threaded, so
 * a synchronous read-modify-write (readTrip → mutate → writeTrip) runs to
 * completion in one tick and cannot interleave with another confirmation. Do NOT
 * introduce `await` here — doing so reopens the race.
 */
export function adjustBookingCount(
  tripName: string,
  batchId: string | null,
  delta: 1 | -1,
  tierId?: string | null,
) {
  try {
    const matched = findTripByName(tripName);
    if (!matched) return;
    const tripData = readTrip(matched.slug);
    if (!tripData) return;

    const batches = Array.isArray(tripData.batches) ? tripData.batches : [];
    if (batches.length > 0 && batchId) {
      const b = batches.find((x: any) => x.id === batchId);
      if (b) {
        const cur = typeof b.bookedSpots === 'number' ? b.bookedSpots : 0;
        b.bookedSpots = Math.max(0, cur + delta);
        if (tierId && Array.isArray(b.offers)) {
          const offer = b.offers.find((o: any) => o.tierId === tierId);
          if (offer) {
            const curBooked = typeof offer.booked === 'number' ? offer.booked : 0;
            offer.booked = Math.max(0, curBooked + delta);
          }
        }
        writeTrip(matched.slug, tripData);
        return;
      }
    }
    // Legacy fallback: trip-level counter (old trips without departures).
    const current = typeof tripData.currentBookings === 'number' ? tripData.currentBookings : 0;
    tripData.currentBookings = Math.max(0, current + delta);
    writeTrip(matched.slug, tripData);
  } catch (err) {
    console.error('[adjustBookingCount]', err);
  }
}

/**
 * Move one confirmed seat between two tiers on the same departure, in a single
 * read-modify-write.
 *
 * Same ATOMICITY INVARIANT as adjustBookingCount — keep this fully SYNCHRONOUS,
 * no `await` anywhere inside, so the readTrip → mutate → writeTrip runs to
 * completion in one tick and cannot interleave with a concurrent confirmation.
 * Doing this as adjustBookingCount(-1) then adjustBookingCount(+1) would be two
 * separate read-modify-writes: a crash between them permanently loses a seat.
 *
 * `bookedSpots` (the departure total) is deliberately left untouched — a move
 * doesn't change how many people are on the trip. Legacy batches with no
 * `offers[]` array are a no-op (their counter is batch-level only).
 */
export function moveBookingTier(
  tripName: string,
  batchId: string | null,
  fromTierId: string,
  toTierId: string,
) {
  if (!batchId || !fromTierId || !toTierId || fromTierId === toTierId) return;
  try {
    const matched = findTripByName(tripName);
    if (!matched) return;
    const tripData = readTrip(matched.slug);
    if (!tripData) return;

    const batches = Array.isArray(tripData.batches) ? tripData.batches : [];
    const b = batches.find((x: any) => x.id === batchId);
    if (!b || !Array.isArray(b.offers)) return;

    const from = b.offers.find((o: any) => o.tierId === fromTierId);
    const to = b.offers.find((o: any) => o.tierId === toTierId);
    if (!from && !to) return;

    if (from) {
      const cur = typeof from.booked === 'number' ? from.booked : 0;
      from.booked = Math.max(0, cur - 1);
    }
    if (to) {
      const cur = typeof to.booked === 'number' ? to.booked : 0;
      to.booked = Math.max(0, cur + 1);
    }
    writeTrip(matched.slug, tripData);
  } catch (err) {
    console.error('[moveBookingTier]', err);
  }
}

/** Count of confirmed registrations on a given batch + tier. */
export function confirmedCountForTier(batchId: string, tierId: string): number {
  return (getDb()
    .prepare('SELECT COUNT(*) as n FROM registrations WHERE batch_id=? AND tier_id=? AND status=?')
    .get(batchId, tierId, 'confirmed') as { n: number }).n;
}

/** Tier cap from the trip YAML (null = unmetered). */
export function tierCapFor(tripName: string, batchId: string, tierId: string): number | null {
  try {
    const matched = findTripByName(tripName);
    if (!matched) return null;
    const trip = readTrip(matched.slug);
    const batch = (trip?.batches as any[])?.find((b: any) => b.id === batchId);
    const offer = (batch?.offers as any[])?.find((o: any) => o.tierId === tierId);
    return offer?.cap != null ? Number(offer.cap) : null;
  } catch {
    return null;
  }
}

/** Does an active (pending/confirmed) registration already exist for this person + departure? */
export function hasActiveRegistration(email: string, tripSlug: string, batchId: string): boolean {
  const row = getDb()
    .prepare("SELECT id FROM registrations WHERE lower(trim(email))=? AND trip_slug=? AND batch_id=? LIMIT 1")
    .get(email, tripSlug, batchId);
  return !!row;
}

export interface CreateRegistrationInput {
  trip_name: string;
  trip_slug: string;
  trip_date: string;
  batch_id: string;
  tier_id: string;
  sharing_option: string | null;
  total_amount: number;
  full_name: string;
  email: string;
  phone: string;
  age?: string | null;
  gender?: string | null;
  city?: string | null;
  instagram?: string | null;
  emergency_name?: string | null;
  emergency_phone?: string | null;
  why_join?: string | null;
  status: RegStatus;
  admin_notes?: string | null;
  created_at?: string | null;
  consent_at?: string | null;
}

export interface CreateResult {
  ok: boolean;
  id?: number;
  telegramEvent?: 'lead' | 'pending' | 'confirmed';
  error?: 'duplicate' | 'capacity_full' | 'db_error';
  message?: string;
}

/**
 * Insert an admin-created registration, applying the same confirm-time side
 * effects as the status-update flow when status==='confirmed' (booked count,
 * recorded advance, leaderboard recalc, optional email).
 *
 * `extraConfirmedInTier` lets a bulk import account for rows it has already
 * committed for the same tier in this run, so the capacity check stays correct.
 */
export function createRegistration(
  input: CreateRegistrationInput,
  opts: { sendEmail?: boolean; skipCapacity?: boolean; extraConfirmedInTier?: number; notifyTelegram?: boolean } = {},
): CreateResult {
  const db = getDb();

  if (hasActiveRegistration(input.email, input.trip_slug, input.batch_id)) {
    return { ok: false, error: 'duplicate', message: 'Already has a registration for these dates.' };
  }

  // Capacity is enforced for live departures, but skipped for historical
  // back-fill (the trip already happened — we're recording who actually went).
  if (input.status === 'confirmed' && !opts.skipCapacity) {
    const cap = tierCapFor(input.trip_name, input.batch_id, input.tier_id);
    if (cap != null) {
      const count = confirmedCountForTier(input.batch_id, input.tier_id) + (opts.extraConfirmedInTier ?? 0);
      if (count >= cap) {
        return { ok: false, error: 'capacity_full', message: `This tier is full (${count}/${cap} confirmed).` };
      }
    }
  }

  const configuredAdvance = input.status === 'confirmed' ? tripAdvanceAmountBySlug(input.trip_slug) : 0;
  const advance = input.total_amount > 0 ? Math.min(configuredAdvance, input.total_amount) : configuredAdvance;

  try {
    const { id, telegramEvent } = db.transaction(() => {
      const res = db.prepare(`
        INSERT INTO registrations (
          trip_name, trip_slug, trip_date, full_name, email, phone, gender,
          age, city, instagram, emergency_name, emergency_phone,
          why_join, sharing_option, total_amount, batch_id, tier_id,
          amount_paid, payment_date, status, status_changed_at, admin_notes, source, created_at, consent_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,?,?,?,?)
      `).run(
        input.trip_name, input.trip_slug, input.trip_date,
        input.full_name, input.email, input.phone, input.gender ?? null,
        input.age ?? null, input.city ?? null, input.instagram ?? null,
        // emergency_name/phone are NOT NULL in the schema — admin rows may omit them.
        input.emergency_name ?? '', input.emergency_phone ?? '',
        input.why_join ?? null, input.sharing_option, input.total_amount,
        input.batch_id, input.tier_id,
        0, null,
        input.status, input.admin_notes ?? null, 'admin', input.created_at ?? new Date().toISOString(), input.consent_at ?? null,
      );
      const id = Number(res.lastInsertRowid);

      // payment_status: derived from what this create records (advance on the
      // confirmed path, nothing otherwise) vs the trip total.
      const recordedAmount = input.status === 'confirmed' ? Math.max(0, advance) : 0;
      db.prepare('UPDATE registrations SET payment_status=? WHERE id=?')
        .run(derivePaymentStatus({ amount_paid: recordedAmount, total_amount: input.total_amount }), id);
      const event = opts.notifyTelegram && (input.status === 'lead' || input.status === 'pending' || input.status === 'confirmed')
        && enqueueTelegramEvent(db, id, input.status) ? input.status : undefined;
      return { id, telegramEvent: event as 'lead' | 'pending' | 'confirmed' | undefined };
    })();

    if (input.status === 'confirmed') {
      let queuedDoc = false;
      if (advance > 0) {
        const recorded = recordPayment({
          registrationId: id, amount: advance, receivedAt: input.created_at ?? new Date().toISOString(),
          method: 'other', eventType: 'advance', idempotencyKey: `registration-created-confirmed:${id}`,
          source: opts.skipCapacity ? 'historical-admin' : 'admin-create',
          documentType: opts.skipCapacity ? undefined : 'advance',
        });
        if (recorded.document?.status === 'queued') {
          queuedDoc = true;
          void processZohoDocument(recorded.document.id).catch((e) => console.error('[Zoho advance]', e));
        }
      }
      adjustBookingCount(input.trip_name, input.batch_id, 1, input.tier_id);
      recalculateUserLeaderboard(input.email).catch((e) => console.error('[leaderboard recalc]', e));
      // Worker sends the branded email (with PDF) when a document is queued;
      // otherwise send it inline, no attachment.
      if (opts.sendEmail && !(zohoMode() !== 'disabled' && queuedDoc)) {
        const totalAmount = Number(input.total_amount) || 0;
        sendRegistrationPaymentConfirmed({
          full_name: input.full_name,
          email: input.email,
          trip_name: input.trip_name,
          trip_date: input.trip_date,
          kind: 'advance',
          amountPaid: advance,
          totalAmount,
          balanceDue: Math.max(0, totalAmount - advance),
        }).catch((e) => console.error('[Email confirmed]', e));
      }
    }

    return { ok: true, id, telegramEvent };
  } catch (e) {
    console.error('[createRegistration]', e);
    return { ok: false, error: 'db_error', message: 'Database error.' };
  }
}
