import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { getDb } from '../../lib/db';
import { readTrip, resolveBooking, tripPublicationStatus } from '../../lib/content';
import { sanitizeInput, isValidEmail, isValidPhone } from '../../lib/utils';
import { rateLimit } from '../../lib/rateLimit';
import { assignAutoUsername } from '../../lib/usernames';
import { jsonOk, jsonFail } from '../../lib/apiResponse';

export const prerender = false;

/**
 * Join the wishlist for a coming-soon departure. Captures name + email + phone.
 * - Signed-in: email/name come from the session; phone is required and backfilled
 *   onto users.phone if not already stored.
 * - Signed-out: name + email + phone all required. Links to an existing users row
 *   by email, or creates a 'contact' account (no session) that a later Google
 *   sign-in claims (see src/pages/api/auth/callback.ts).
 * Idempotent per (lower(email), trip_slug, batch_id).
 */
export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  if (!rateLimit(`wishlist:${clientAddress}`, 10, 60 * 60 * 1000)) {
    return jsonFail('Too many requests. Please try again later.', 429);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return jsonFail('Invalid request body.', 400);
  }
  if (body._honey) return jsonFail('Invalid submission.', 400);

  const tripSlug = sanitizeInput(body.tripSlug);
  const trip = tripSlug ? readTrip(tripSlug) : null;
  if (!trip || tripPublicationStatus({ slug: tripSlug, ...trip }) === 'draft') {
    return jsonFail('Trip not found.', 404);
  }

  const batchId = sanitizeInput(body.batchId);
  const booking = resolveBooking(trip);
  const departure = booking.departures.find((d) => d.id === batchId);
  if (!departure) return jsonFail('That date is not available.', 404);
  if (!departure.comingSoon) return jsonFail('This date is open for booking — no wishlist needed.', 409);

  // Identity + contact fields
  const signedIn = !!locals.user?.id;
  const email = sanitizeInput(signedIn ? locals.user!.email : body.email);
  const name = sanitizeInput(signedIn ? (locals.user!.displayName ?? body.name) : body.name);
  const phone = sanitizeInput(body.phone);

  if (!email || !isValidEmail(email)) return jsonFail('A valid email is required.', 400);
  if (!name) return jsonFail('Your name is required.', 400);
  if (!phone || !isValidPhone(phone)) return jsonFail('A valid phone number is required.', 400);

  const db = getDb();

  try {
    // ── Resolve / create the user record ────────────────────────────────────
    if (signedIn) {
      db.prepare('UPDATE users SET phone = COALESCE(phone, ?) WHERE id = ?').run(phone, locals.user!.id);
    } else {
      const existing = db
        .prepare('SELECT id, phone FROM users WHERE lower(email) = lower(?)')
        .get(email) as { id: string; phone: string | null } | undefined;
      if (existing) {
        if (!existing.phone) db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, existing.id);
      } else {
        const id = crypto.randomUUID();
        db.prepare(`
          INSERT INTO users (id, email, displayName, googleId, accountState, phone, createdAt)
          VALUES (?, ?, ?, ?, 'contact', ?, unixepoch())
        `).run(id, email, name, `contact:${id}`, phone);
        assignAutoUsername(id, name); // best-effort; swallows unique-index collisions
      }
    }

    // ── Idempotent wishlist row ─────────────────────────────────────────────
    const already = db.prepare(`
      SELECT id, status FROM registrations
      WHERE lower(trim(email)) = lower(trim(?)) AND trip_slug = ? AND batch_id = ?
      LIMIT 1
    `).get(email, tripSlug, batchId) as { id: number; status: string } | undefined;

    if (already) {
      // A wishlist (or any) row already exists for this identity+departure — do
      // not duplicate and never downgrade a lead/pending/confirmed row.
      return jsonOk({ success: true, status: already.status });
    }

    const tripName = String(trip.title || trip.name || tripSlug);
    const tripDate = `${departure.startDate} – ${departure.endDate}`;
    db.prepare(`
      INSERT INTO registrations (
        trip_name, trip_slug, trip_date, full_name, email, phone,
        emergency_name, emergency_phone, batch_id, tier_id,
        source, status, amount_paid, wishlisted_at, consent_at, status_changed_at
      ) VALUES (?,?,?,?,?,?, '', '', ?, ?, 'wishlist', 'wishlist', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(tripName, tripSlug, tripDate, name, email, phone, batchId, departure.offers[0]?.tierId ?? null);

    return jsonOk({ success: true, status: 'wishlist' });
  } catch (err) {
    console.error('[wishlist] failed', err);
    return jsonFail('Server error. Please try again.', 500);
  }
};
