import { getDb } from './db';
import { canonicalizeProfileTrips, type ProfileRegistrationRow, type ProfileTripRecord } from './profileTrips';
import { LEADERBOARD_ELIGIBLE_JOIN } from './stats';

/**
 * One signed-in traveller's registrations, shaped for display. Loaded at most
 * once per request: the header, the page and its cards all ask for it, and
 * keying on the request's `locals` object means they share the one query.
 */
const perRequest = new WeakMap<object, ProfileTripRecord[]>();

export function loadUserTripRows(email: string): ProfileRegistrationRow[] {
  return getDb().prepare(`
    SELECT id, trip_name, trip_slug, trip_date, batch_id, status, created_at, updated_at, status_changed_at,
           full_name, phone, age, date_of_birth, gender, city, state, instagram,
           emergency_name, emergency_phone, emergency_relationship, why_join,
           sharing_option, tier_id, total_amount, amount_paid, amount_refunded, payment_status, balance_reported_at
      FROM registrations WHERE lower(trim(email)) = lower(trim(?)) ORDER BY created_at DESC, id DESC
  `).all(email) as ProfileRegistrationRow[];
}

export function getUserTrips(locals: App.Locals): ProfileTripRecord[] {
  if (!locals.user) return [];
  let records = perRequest.get(locals);
  if (!records) {
    records = canonicalizeProfileTrips(loadUserTripRows(locals.user.email));
    perRequest.set(locals, records);
  }
  return records;
}

export interface TripAction { href: string; label: string; kind: 'pay' | 'continue' | 'view' }

/**
 * The one thing a traveller should do next about a trip. When money is owed it
 * is the money action. Once they have said they paid, no "Pay" button: it would
 * invite a second payment, the same reason `pending` never gets one (see
 * balanceActionable in profileTrips.ts).
 */
export function tripPrimaryAction(record: ProfileTripRecord): TripAction | null {
  const tripPage = record.tripExists && record.tripSlug ? `/trips/${record.tripSlug}/` : null;
  if (record.details.balanceActionable && !record.details.balanceReportedAt) {
    return { href: `/profile/pay/${record.id}`, label: 'Pay balance', kind: 'pay' };
  }
  if (record.status === 'lead' && record.bookable && record.tripSlug) {
    const batch = record.batchId ? `?batch=${encodeURIComponent(record.batchId)}` : '';
    return { href: `/trips/${record.tripSlug}/book${batch}`, label: 'Continue booking', kind: 'continue' };
  }
  if (record.status === 'wishlist' && tripPage) return { href: tripPage, label: 'View trip', kind: 'view' };
  return null;
}

const isLive = (r: ProfileTripRecord) => r.period === 'ongoing' || r.period === 'upcoming';
const byStart = (a: ProfileTripRecord, b: ProfileTripRecord) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999');

/** Seats held on trips that have not finished, soonest first. */
export function upcomingTrips(records: ProfileTripRecord[]): ProfileTripRecord[] {
  return records.filter((r) => (r.status === 'confirmed' || r.status === 'pending') && isLive(r)).sort(byStart);
}

/** A booking started and not finished, on a departure that can still be booked. */
export function unfinishedBooking(records: ProfileTripRecord[]): ProfileTripRecord | null {
  return records.filter((r) => r.status === 'lead' && r.bookable && isLive(r)).sort(byStart)[0] ?? null;
}

/** The first booking that needs paying for, if any: drives the header reminder. */
export function balanceDue(records: ProfileTripRecord[]): ProfileTripRecord | null {
  return records.find((r) => tripPrimaryAction(r)?.kind === 'pay') ?? null;
}

export type UserTripState = 'going' | 'went' | 'saved';

/**
 * What a trip card should say about this traveller and that trip. A trip they
 * are booked on outranks one they went on, which outranks one they saved.
 */
export function tripStates(records: ProfileTripRecord[], savedSlugs: Iterable<string> = []): Map<string, UserTripState> {
  const rank: Record<UserTripState, number> = { going: 3, went: 2, saved: 1 };
  const states = new Map<string, UserTripState>();
  const offer = (slug: string | null, state: UserTripState) => {
    if (!slug) return;
    const current = states.get(slug);
    if (!current || rank[state] > rank[current]) states.set(slug, state);
  };
  for (const slug of savedSlugs) offer(slug, 'saved');
  for (const r of records) {
    if ((r.status === 'confirmed' || r.status === 'pending') && isLive(r)) offer(r.tripSlug, 'going');
    else if (r.status === 'confirmed' && r.period === 'completed') offer(r.tripSlug, 'went');
    else if (r.status === 'wishlist') offer(r.tripSlug, 'saved');
  }
  return states;
}

// ── Saved trips ─────────────────────────────────────────────────────────────
// A heart on a trip card: "remember this trip". Separate from the wishlist,
// which is a lead on one coming-soon departure that ops follow up on.

export function savedTripSlugs(userId: string): string[] {
  return (getDb().prepare('SELECT trip_slug FROM saved_trips WHERE userId = ? ORDER BY created_at DESC').all(userId) as { trip_slug: string }[])
    .map((r) => r.trip_slug);
}

export function saveTrip(userId: string, slug: string): void {
  getDb().prepare('INSERT OR IGNORE INTO saved_trips (userId, trip_slug, created_at) VALUES (?, ?, ?)')
    .run(userId, slug, Math.floor(Date.now() / 1000));
}

export function unsaveTrip(userId: string, slug: string): void {
  getDb().prepare('DELETE FROM saved_trips WHERE userId = ? AND trip_slug = ?').run(userId, slug);
}

// ── Travel stats ────────────────────────────────────────────────────────────

export interface UserTravelStats { kmsFromHome: number; tripsCount: number; destinationsCount: number; rank: number | null }

/**
 * The traveller's own stats, with their km rank only when they appear on the
 * public leaderboard. Null until they have a finished trip on record.
 */
export function userTravelStats(userId: string): UserTravelStats | null {
  const db = getDb();
  const stats = db.prepare('SELECT kmsFromHome, tripsCount, destinationsCount FROM leaderboard_cache WHERE userId = ?')
    .get(userId) as Omit<UserTravelStats, 'rank'> | undefined;
  if (!stats || stats.tripsCount <= 0) return null;
  return { ...stats, rank: leaderboardRank(userId, 'kmsFromHome') };
}

const RANK_COLUMNS = ['kmsFromHome', 'daysOutdoors', 'destinationsCount'] as const;
export type RankColumn = (typeof RANK_COLUMNS)[number];

/**
 * A traveller's place on the public leaderboard, or null when they are not on
 * it (opted out, staff, or no stats). Same tie-break as the leaderboard's own
 * ROW_NUMBER(): value DESC, then userId ASC, so a pinned rank matches the list.
 */
export function leaderboardRank(userId: string, column: RankColumn): number | null {
  if (!RANK_COLUMNS.includes(column)) return null;
  const db = getDb();
  const eligible = LEADERBOARD_ELIGIBLE_JOIN;
  const mine = db.prepare(`SELECT c.${column} AS value FROM leaderboard_cache c ${eligible} WHERE c.userId = ?`)
    .get(userId) as { value: number } | undefined;
  if (!mine) return null;
  const row = db.prepare(`
    SELECT COUNT(*) + 1 AS rank FROM leaderboard_cache c ${eligible}
     WHERE c.${column} > ? OR (c.${column} = ? AND c.userId < ?)
  `).get(mine.value, mine.value, userId) as { rank: number };
  return row.rank;
}

// ── Newsletter ──────────────────────────────────────────────────────────────

const subscribedPerRequest = new WeakMap<object, boolean>();

/** Whether the signed-in traveller already gets the newsletter. Checked once per request. */
export function isNewsletterSubscriber(locals: App.Locals): boolean {
  if (!locals.user) return false;
  let subscribed = subscribedPerRequest.get(locals);
  if (subscribed === undefined) {
    subscribed = Boolean(getDb().prepare("SELECT 1 FROM newsletter_subscribers WHERE email = ? AND active = 1 AND coalesce(status, 'active') = 'active'")
      .get(locals.user.email.trim().toLowerCase()));
    subscribedPerRequest.set(locals, subscribed);
  }
  return subscribed;
}
