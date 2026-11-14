import crypto from 'node:crypto';
import type { AstroCookies } from 'astro';
import { getDb } from './db';
import { resolveBooking, upcomingBatches } from './trips';

/**
 * "Register to see the full plan" — a per-departure switch that hides most of a
 * trip's itinerary until the visitor has registered for that trip.
 *
 * WHY THE DECISION IS TRIP-LEVEL. The switch lives on each departure
 * (`batches[].itineraryGated`), but a trip has ONE itinerary shared by all its
 * dates. So the page is locked when ANY upcoming departure asks for it: if one
 * open date showed the plan, every gated date would be leaking the same text.
 *
 * WHAT UNLOCKS IT. A live registration of any status but cancelled, on any
 * departure of the trip: the details form (`lead`), a payment (`pending`,
 * `confirmed`), or a wishlist sign-up for a coming-soon date. The visitor is
 * recognised by their signed-in email, or by an access cookie the register and
 * wishlist endpoints set, so registering without signing in still unlocks.
 *
 * WHY THE FULL PLAN NEVER REACHES THE PAGE HTML. Anonymous trip pages are
 * cached at the edge (see middleware.ts), so a page that varied on this cookie
 * would hand one visitor's unlocked render to everyone. The locked render
 * carries only the preview days; the rest comes from a no-store API call.
 */

/** Days shown in full before the lock. */
export const ITINERARY_PREVIEW_DAYS = 1;

/** Readable by the page script (it only decides whether to ask); the server checks the token. */
export const ITINERARY_ACCESS_COOKIE = 'stt_itinerary_access';
const ACCESS_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/** Statuses that count as "registered for this trip". */
export const ITINERARY_ACCESS_STATUSES = ['wishlist', 'lead', 'pending', 'confirmed'] as const;

export interface ItineraryDay {
  day: number;
  title: string;
  description: string;
  stay: string;
  meals: string[];
  transport: string;
  note: string;
  photos: Array<{ image: string; width?: number | null; height?: number | null }>;
}

/** The one itinerary shape, from the new (day/title) and legacy (dayNumber/dayTitle) schemas. */
export function normalizeItinerary(trip: Record<string, any>): ItineraryDay[] {
  const raw = Array.isArray(trip?.itinerary) ? trip.itinerary : [];
  return raw.map((d: any) => ({
    day: d.day ?? d.dayNumber ?? 1,
    title: d.title ?? d.dayTitle ?? '',
    description: d.description ?? d.activities ?? '',
    stay: d.stay ?? d.accommodation ?? '',
    meals: d.meals ?? [
      ...(d.breakfast ? ['B'] : []),
      ...(d.lunch ? ['L'] : []),
      ...(d.dinner ? ['D'] : []),
    ],
    transport: d.transport ?? '',
    note: d.note ?? d.specialNotes ?? '',
    photos: Array.isArray(d.photos) ? d.photos.slice(0, 3) : [],
  }));
}

export interface ItineraryGate {
  /** The trip page hides everything after the preview days. */
  locked: boolean;
  /** How many days stay visible when locked. */
  previewDays: number;
  /** How a visitor unlocks: book a date (details form) or join a coming-soon wishlist. */
  unlockMode: 'book' | 'wishlist' | null;
  /** The departure the unlock call to action points at. */
  unlockBatchId: string | null;
}

const OPEN: ItineraryGate = { locked: false, previewDays: 0, unlockMode: null, unlockBatchId: null };

/**
 * Decide whether the trip page locks its itinerary.
 *
 * Only upcoming, non-draft departures count, so a gated date that has passed
 * or been pulled back to draft stops locking the page by itself. And the lock
 * needs a way out: if every upcoming date is sold out there is nothing to
 * register for, so the plan is shown rather than locked behind a dead end.
 */
export function itineraryGate(trip: Record<string, any>): ItineraryGate {
  const days = Array.isArray(trip?.itinerary) ? trip.itinerary.length : 0;
  if (days === 0) return OPEN;

  const gatedIds = new Set(
    upcomingBatches(trip).filter((b) => b?.itineraryGated === true).map((b) => String(b.id)),
  );
  if (gatedIds.size === 0) return OPEN;

  const departures = resolveBooking(trip).departures;
  const bookable = departures.filter((d) => !d.comingSoon && !d.soldOut);
  const wishlistable = departures.filter((d) => d.comingSoon);
  // Prefer a gated date for the call to action, but any registration unlocks.
  const pick = <T extends { id: string }>(list: T[]) => list.find((d) => gatedIds.has(d.id)) ?? list[0];

  const bookTarget = pick(bookable);
  const wishlistTarget = bookTarget ? undefined : pick(wishlistable);
  if (!bookTarget && !wishlistTarget) return OPEN;

  return {
    locked: true,
    // A one-day plan previewed in full is not locked at all.
    previewDays: Math.min(ITINERARY_PREVIEW_DAYS, Math.max(0, days - 1)),
    unlockMode: bookTarget ? 'book' : 'wishlist',
    unlockBatchId: (bookTarget ?? wishlistTarget)!.id,
  };
}

/**
 * Every slug this trip has been known by: registrations keep the slug they were
 * made under, so after a rename they sit on the old one.
 */
function slugsFor(slug: string): string[] {
  const rows = getDb()
    .prepare('SELECT alias FROM trip_slug_aliases WHERE target = ?')
    .all(slug) as Array<{ alias: string }>;
  return [slug, ...rows.map((r) => r.alias)];
}

/** True when any of `emails` holds a registration that unlocks this trip. */
export function hasItineraryAccess(emails: Array<string | null | undefined>, slug: string): boolean {
  const wanted = [...new Set(emails.map((e) => String(e ?? '').trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0 || !slug) return false;
  const slugs = slugsFor(slug);
  const row = getDb().prepare(`
    SELECT 1 FROM registrations
     WHERE lower(trim(email)) IN (${wanted.map(() => '?').join(',')})
       AND trip_slug IN (${slugs.map(() => '?').join(',')})
       AND status IN (${ITINERARY_ACCESS_STATUSES.map(() => '?').join(',')})
     LIMIT 1
  `).get(...wanted, ...slugs, ...ITINERARY_ACCESS_STATUSES);
  return !!row;
}

/** The email an access token was issued for, or null. */
export function emailForAccessToken(token: string | null | undefined): string | null {
  if (!token || !/^[0-9a-f-]{36}$/.test(token)) return null;
  const row = getDb()
    .prepare('SELECT email FROM itinerary_access WHERE token = ?')
    .get(token) as { email: string } | undefined;
  return row?.email ?? null;
}

/**
 * Remember on this browser that `email` has registered, so the trip page can
 * unlock without a sign-in. Reuses the visitor's token when it already belongs
 * to this email; a different email replaces it (signing in still covers both).
 *
 * The token only ever proves "this browser submitted a form with this email",
 * and only unlocks trips that email has registered for. Anyone can type any
 * email into a public form, so it must never be treated as a login.
 */
export function grantItineraryAccess(cookies: AstroCookies, email: string): void {
  const clean = String(email ?? '').trim().toLowerCase();
  if (!clean) return;
  try {
    const current = cookies.get(ITINERARY_ACCESS_COOKIE)?.value;
    let token = current && emailForAccessToken(current) === clean ? current : null;
    if (!token) {
      token = crypto.randomUUID();
      getDb().prepare('INSERT INTO itinerary_access (token, email) VALUES (?, ?)').run(token, clean);
    }
    cookies.set(ITINERARY_ACCESS_COOKIE, token, {
      path: '/',
      maxAge: ACCESS_COOKIE_MAX_AGE,
      sameSite: 'lax',
      secure: import.meta.env.PROD,
      httpOnly: false,
    });
  } catch (err) {
    // Never fail a registration over this; signing in still unlocks.
    console.error('[itinerary access] could not grant', err);
  }
}
