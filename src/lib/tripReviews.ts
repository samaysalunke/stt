import { getDb } from './db';
import { listTrips, readTrip, tripName, tripPublicationStatus } from './trips';
import { indiaDateOnly, todayInIndia } from './profileTrips';
import { now as clockNow } from './clock';
import { siteUrl } from './siteUrl';
import { sendTripReviewRequest } from './emailTemplates';
import { formatDateIN } from './utils';

/**
 * Post-trip reviews.
 *
 * A traveller with a CONFIRMED booking reviews their departure once it has
 * ended, on /profile/review/<registration id>. The page sits behind Google
 * sign-in and accepts only the account whose email made the booking, so every
 * review is from someone who actually travelled.
 *
 * The day after a departure ends, the job scheduler emails each of its
 * confirmed travellers a link straight to that form (see dueReviewRequests).
 * Admins read the reviews departure by departure on /admin/reviews.
 */

/** Ratings asked on the form. `overall` is required; the rest are optional. */
export const REVIEW_RATINGS = [
  { key: 'overall', column: 'overall_rating', label: 'Overall, how was the trip?', required: true },
  { key: 'itinerary', column: 'itinerary_rating', label: 'Itinerary & places', required: false },
  { key: 'stay', column: 'stay_rating', label: 'Stays', required: false },
  { key: 'food', column: 'food_rating', label: 'Food', required: false },
  { key: 'host', column: 'host_rating', label: 'Trip lead & team', required: false },
] as const;

export const REVIEW_TEXT_MAX = 2000;
export const TESTIMONIAL_MAX = 400;

/** Automatic emails go out from this hour (India time) on the day after the trip ends. */
export const REVIEW_SEND_HOUR_IST = 10;
/**
 * How far back the automatic email reaches. It is a catch-up window for a day
 * the server was down, and also the reason switching this on does not email
 * every traveller of every trip ever run. Older departures are sent from admin.
 */
export const REVIEW_AUTO_WINDOW_DAYS = 7;
const MAX_ATTEMPTS = 3;

export interface TripReview {
  id: number;
  registration_id: number;
  user_id: string | null;
  trip_slug: string | null;
  batch_id: string | null;
  overall_rating: number;
  itinerary_rating: number | null;
  stay_rating: number | null;
  food_rating: number | null;
  host_rating: number | null;
  recommend_score: number | null;
  highlight: string | null;
  improve: string | null;
  testimonial: string | null;
  can_feature: number;
  created_at: string;
  updated_at: string;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** India-time hour of `now`, 0–23. */
function indiaHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(now));
}

/** A trip's departure, by slug and batch id, with its dates as YYYY-MM-DD. */
export function findDeparture(slug: string | null | undefined, batchId: string | null | undefined) {
  if (!slug || !batchId) return null;
  let trip: Record<string, any> | null = null;
  try { trip = readTrip(slug); } catch { trip = null; }
  const batch = Array.isArray(trip?.batches) ? trip!.batches.find((b: any) => String(b?.id) === String(batchId)) : null;
  if (!trip || !batch) return null;
  const startDate = indiaDateOnly(batch.startDate);
  const endDate = indiaDateOnly(batch.endDate) ?? startDate;
  return { trip, batch, name: tripName({ slug, ...trip }), startDate, endDate };
}

export type ReviewAccess =
  | { ok: true; registration: Record<string, any>; departure: NonNullable<ReturnType<typeof findDeparture>>; review: TripReview | null }
  | { ok: false; reason: 'not-found' | 'wrong-account' | 'not-confirmed' | 'not-ended'; registration?: Record<string, any>; endDate?: string | null };

/**
 * May this signed-in user review this booking? Only the account whose email
 * made it, only a confirmed booking, and only once the departure has ended.
 */
export function reviewAccess(registrationId: number, userEmail: string, now = new Date(clockNow())): ReviewAccess {
  if (!Number.isInteger(registrationId) || registrationId <= 0) return { ok: false, reason: 'not-found' };
  const db = getDb();
  const registration = db.prepare(`
    SELECT id, email, full_name, trip_name, trip_slug, batch_id, status
      FROM registrations WHERE id = ?
  `).get(registrationId) as Record<string, any> | undefined;
  if (!registration) return { ok: false, reason: 'not-found' };
  const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  if (!same(registration.email, userEmail)) return { ok: false, reason: 'wrong-account', registration };
  if (registration.status !== 'confirmed') return { ok: false, reason: 'not-confirmed', registration };
  const departure = findDeparture(registration.trip_slug, registration.batch_id);
  if (!departure?.endDate) return { ok: false, reason: 'not-found', registration };
  if (departure.endDate >= todayInIndia(now)) return { ok: false, reason: 'not-ended', registration, endDate: departure.endDate };
  const review = db.prepare('SELECT * FROM trip_reviews WHERE registration_id = ?').get(registrationId) as TripReview | undefined;
  return { ok: true, registration, departure, review: review ?? null };
}

export interface ReviewInput {
  ratings: Record<string, number | null>;
  recommend: number | null;
  highlight: string;
  improve: string;
  testimonial: string;
  canFeature: boolean;
}

/** Parse the posted form. Returns field errors rather than throwing. */
export function parseReviewForm(form: FormData): { input: ReviewInput; errors: string[] } {
  const errors: string[] = [];
  const rating = (name: string, min: number, max: number) => {
    const raw = String(form.get(name) ?? '').trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
  };
  const ratings: Record<string, number | null> = {};
  for (const r of REVIEW_RATINGS) {
    const value = rating(r.key, 1, 5);
    if (Number.isNaN(value)) errors.push(`${r.label}: pick 1 to 5.`);
    else if (value == null && r.required) errors.push('Please give the trip an overall rating.');
    ratings[r.key] = Number.isNaN(value) ? null : value;
  }
  const recommend = rating('recommend', 0, 10);
  if (Number.isNaN(recommend)) errors.push('Recommendation: pick 0 to 10.');
  const text = (name: string, max: number) => String(form.get(name) ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
  return {
    input: {
      ratings,
      recommend: Number.isNaN(recommend) ? null : recommend,
      highlight: text('highlight', REVIEW_TEXT_MAX),
      improve: text('improve', REVIEW_TEXT_MAX),
      testimonial: text('testimonial', TESTIMONIAL_MAX),
      canFeature: form.get('canFeature') === 'on',
    },
    errors,
  };
}

/** Create or update the review for a booking. */
export function saveReview(registration: Record<string, any>, userId: string, input: ReviewInput): void {
  const r = input.ratings;
  getDb().prepare(`
    INSERT INTO trip_reviews (
      registration_id, user_id, trip_slug, batch_id,
      overall_rating, itinerary_rating, stay_rating, food_rating, host_rating,
      recommend_score, highlight, improve, testimonial, can_feature
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(registration_id) DO UPDATE SET
      user_id=excluded.user_id, overall_rating=excluded.overall_rating,
      itinerary_rating=excluded.itinerary_rating, stay_rating=excluded.stay_rating,
      food_rating=excluded.food_rating, host_rating=excluded.host_rating,
      recommend_score=excluded.recommend_score, highlight=excluded.highlight,
      improve=excluded.improve, testimonial=excluded.testimonial,
      can_feature=excluded.can_feature, updated_at=CURRENT_TIMESTAMP
  `).run(
    registration.id, userId, registration.trip_slug, registration.batch_id,
    r.overall, r.itinerary ?? null, r.stay ?? null, r.food ?? null, r.host ?? null,
    input.recommend, input.highlight || null, input.improve || null,
    input.testimonial || null,
    // Consent only means something with a quote to feature.
    input.canFeature && input.testimonial ? 1 : 0,
  );
}

export function reviewUrl(registrationId: number): string {
  return siteUrl(`/profile/review/${registrationId}`);
}

interface DueRow { id: number; email: string; full_name: string | null; trip_slug: string; batch_id: string }

/**
 * Confirmed bookings whose review email is due now: the departure ended
 * yesterday or up to REVIEW_AUTO_WINDOW_DAYS ago, it is past the send hour in
 * India, they have not been emailed or reviewed, and earlier attempts have not
 * run out. QA fixture trips are skipped.
 */
export function dueReviewRequests(now = new Date(clockNow()), limit = 20): DueRow[] {
  if (indiaHour(now) < REVIEW_SEND_HOUR_IST) return [];
  const today = todayInIndia(now);
  const earliestEnd = addDays(today, -REVIEW_AUTO_WINDOW_DAYS);
  const departures: Array<{ slug: string; batchId: string }> = [];
  for (const trip of listTrips()) {
    if (tripPublicationStatus(trip) === 'test') continue;
    for (const b of Array.isArray(trip.batches) ? trip.batches : []) {
      const end = indiaDateOnly(b?.endDate) ?? indiaDateOnly(b?.startDate);
      if (end && end < today && end >= earliestEnd) departures.push({ slug: trip.slug, batchId: String(b.id) });
    }
  }
  if (departures.length === 0) return [];
  return pendingRecipients(departures, limit);
}

/** Confirmed, not yet emailed, not yet reviewed, attempts left — for these departures. */
function pendingRecipients(departures: Array<{ slug: string; batchId: string }>, limit: number): DueRow[] {
  const pairs = departures.map(() => '(trip_slug = ? AND batch_id = ?)').join(' OR ');
  return getDb().prepare(`
    SELECT id, email, full_name, trip_slug, batch_id FROM registrations r
     WHERE status = 'confirmed' AND (${pairs})
       AND review_requested_at IS NULL AND review_request_attempts < ${MAX_ATTEMPTS}
       AND trim(coalesce(email, '')) <> ''
       AND NOT EXISTS (SELECT 1 FROM trip_reviews t WHERE t.registration_id = r.id)
     ORDER BY id LIMIT ?
  `).all(...departures.flatMap((d) => [d.slug, d.batchId]), limit) as DueRow[];
}

/** Recipients an admin's "send now" would reach for one departure. */
export function pendingForDeparture(slug: string, batchId: string): DueRow[] {
  return pendingRecipients([{ slug, batchId }], 500);
}

/**
 * Email one traveller their review link. Claims the row first, so a second
 * pass (the next tick, or an admin pressing the button) cannot send it twice;
 * a failure releases it with the attempt counted.
 */
export async function sendReviewRequest(row: DueRow): Promise<boolean> {
  const db = getDb();
  const claimed = db.prepare(`
    UPDATE registrations SET review_requested_at = CURRENT_TIMESTAMP, review_request_error = NULL
     WHERE id = ? AND review_requested_at IS NULL
  `).run(row.id).changes === 1;
  if (!claimed) return false;
  const departure = findDeparture(row.trip_slug, row.batch_id);
  try {
    await sendTripReviewRequest({
      email: row.email,
      firstName: String(row.full_name ?? '').trim().split(/\s+/)[0] || 'there',
      tripName: departure?.name ?? row.trip_slug,
      dates: departure?.startDate
        ? `${formatDateIN(departure.startDate)}${departure.endDate && departure.endDate !== departure.startDate ? ` – ${formatDateIN(departure.endDate)}` : ''}`
        : '',
      url: reviewUrl(row.id),
    });
    return true;
  } catch (error) {
    db.prepare(`
      UPDATE registrations SET review_requested_at = NULL,
        review_request_attempts = review_request_attempts + 1, review_request_error = ?
       WHERE id = ?
    `).run(String((error as any)?.message ?? error).slice(0, 500), row.id);
    return false;
  }
}

/** One scheduler pass: email everyone whose review request is due. */
export async function runReviewRequests(now = new Date(clockNow())): Promise<number> {
  const due = dueReviewRequests(now);
  let sent = 0;
  for (const row of due) if (await sendReviewRequest(row)) sent++;
  return sent;
}

// ── Admin ────────────────────────────────────────────────────────────────────

export interface DepartureReviewSummary {
  slug: string;
  batchId: string;
  tripName: string;
  startDate: string | null;
  endDate: string | null;
  travellers: number;
  emailed: number;
  reviews: number;
  avgOverall: number | null;
  /** Net Promoter Score (−100…100) from the 0–10 answers, or null with none. */
  nps: number | null;
}

/** Net Promoter Score: % promoters (9–10) minus % detractors (0–6). */
export function npsScore(scores: Array<number | null | undefined>): number | null {
  const valid = scores.filter((s): s is number => Number.isInteger(s));
  if (valid.length === 0) return null;
  const promoters = valid.filter((s) => s >= 9).length;
  const detractors = valid.filter((s) => s <= 6).length;
  return Math.round(((promoters - detractors) / valid.length) * 100);
}

/**
 * Every departure that has ended and had confirmed travellers, newest first,
 * with its review numbers. `allowedBatchIds` scopes a trip-lead admin.
 */
export function departureReviewSummaries(allowedBatchIds: string[] | null = null, now = new Date(clockNow())): DepartureReviewSummary[] {
  const today = todayInIndia(now);
  const db = getDb();
  const counts = db.prepare(`
    SELECT trip_slug, batch_id, COUNT(*) AS travellers,
           SUM(CASE WHEN review_requested_at IS NOT NULL THEN 1 ELSE 0 END) AS emailed
      FROM registrations WHERE status = 'confirmed' AND trip_slug IS NOT NULL AND batch_id IS NOT NULL
     GROUP BY trip_slug, batch_id
  `).all() as Array<{ trip_slug: string; batch_id: string; travellers: number; emailed: number }>;
  const reviews = db.prepare(`
    SELECT t.trip_slug, t.batch_id, t.overall_rating, t.recommend_score
      FROM trip_reviews t JOIN registrations r ON r.id = t.registration_id
  `).all() as Array<{ trip_slug: string; batch_id: string; overall_rating: number; recommend_score: number | null }>;

  const out: DepartureReviewSummary[] = [];
  for (const c of counts) {
    if (allowedBatchIds && !allowedBatchIds.includes(c.batch_id)) continue;
    const dep = findDeparture(c.trip_slug, c.batch_id);
    const endDate = dep?.endDate ?? null;
    if (!endDate || endDate >= today) continue;
    const mine = reviews.filter((r) => r.trip_slug === c.trip_slug && r.batch_id === c.batch_id);
    out.push({
      slug: c.trip_slug,
      batchId: c.batch_id,
      tripName: dep?.name ?? c.trip_slug,
      startDate: dep?.startDate ?? null,
      endDate,
      travellers: c.travellers,
      emailed: c.emailed,
      reviews: mine.length,
      avgOverall: mine.length ? Math.round((mine.reduce((s, r) => s + r.overall_rating, 0) / mine.length) * 10) / 10 : null,
      nps: npsScore(mine.map((r) => r.recommend_score)),
    });
  }
  return out.sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)));
}

/** One departure's confirmed travellers, each with their review if any. */
export function departureReviews(slug: string, batchId: string) {
  return getDb().prepare(`
    SELECT r.id AS registration_id, r.full_name, r.email, r.phone, r.city,
           r.review_requested_at, r.review_request_error,
           t.id AS review_id, t.overall_rating, t.itinerary_rating, t.stay_rating, t.food_rating,
           t.host_rating, t.recommend_score, t.highlight, t.improve, t.testimonial, t.can_feature,
           t.created_at AS reviewed_at, t.updated_at AS review_updated_at
      FROM registrations r LEFT JOIN trip_reviews t ON t.registration_id = r.id
     WHERE r.status = 'confirmed' AND r.trip_slug = ? AND r.batch_id = ?
     ORDER BY (t.id IS NULL), t.updated_at DESC, r.full_name COLLATE NOCASE
  `).all(slug, batchId) as Array<Record<string, any>>;
}
