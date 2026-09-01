import { YAML, fs, path, TRIPS_DIR, ensureDir, assertSafeSlug, deleteImageByUrl, collectImageUrls } from './_contentBase';
import { listDeletedSlugs } from './tripDeletions';
import { cachedRead, bumpContentVersion, getContentVersion } from './contentCache';

/** Raw, unfiltered slugs of every trip file on disk (includes soft-deleted). */
export function listTripSlugs(): string[] {
  ensureDir(TRIPS_DIR);
  return fs.readdirSync(TRIPS_DIR).filter(f => f.endsWith('.yaml')).map(f => f.replace('.yaml', ''));
}

/**
 * Cached. The returned array and every trip object in it are SHARED and
 * read-only — mutate a trip and every later reader in the cache generation sees
 * it. Anything that needs to modify a trip must go through readTrip(), which is
 * deliberately uncached for exactly that reason.
 */
export function listTrips(): Array<Record<string, any>> {
  return cachedRead('trips', () => {
    ensureDir(TRIPS_DIR);
    const deleted = listDeletedSlugs();
    const trips = fs
      .readdirSync(TRIPS_DIR)
      .filter(f => f.endsWith('.yaml'))
      .map(f => {
        const slug = f.replace('.yaml', '');
        const raw = fs.readFileSync(path.join(TRIPS_DIR, f), 'utf-8');
        const data = YAML.parse(raw) ?? {};
        // Filename is the authoritative identity (readTrip/writeTrip/deleteTrip all
        // key by it). Spread data first so a stale in-YAML `slug:` can never override
        // it — otherwise two files sharing an internal slug collide, and delete/edit
        // hit the wrong file.
        return { ...data, slug };
      })
      .filter(t => !deleted.has(t.slug));
    const ranked = trips.map((t) => ({
      t,
      rank: !tripHasUpcomingDates(t) ? 2 : (tripCardSummary(t).soldOut ? 1 : 0),
    }));
    ranked.sort((a, b) => a.rank - b.rank);
    return ranked.map((r) => r.t);
  });
}

export type PublicationStatus = 'draft' | 'published' | 'archived' | 'test';

export const TRIP_PRIORITIES = ['high', 'medium', 'low'] as const;
export type TripPriority = (typeof TRIP_PRIORITIES)[number];

/** Legacy, absent, and malformed values intentionally receive normal placement. */
export function tripPriority(value: unknown): TripPriority {
  return typeof value === 'string' && (TRIP_PRIORITIES as readonly string[]).includes(value.toLowerCase())
    ? value.toLowerCase() as TripPriority
    : 'medium';
}

/**
 * Group trips by manually managed priority and independently shuffle each group.
 * Call this after a page's visibility filters; listTrips() retains its workflow-safe order.
 */
export function sortTripsByPriority<T extends Record<string, any>>(
  trips: readonly T[],
  random: () => number = Math.random,
): T[] {
  const buckets: Record<TripPriority, T[]> = { high: [], medium: [], low: [] };
  for (const trip of trips) buckets[tripPriority(trip?.priority)].push(trip);

  const shuffle = (items: T[]) => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  };

  return [...shuffle(buckets.high), ...shuffle(buckets.medium), ...shuffle(buckets.low)];
}

/**
 * A deterministic `random` for sortTripsByPriority, seeded from the content
 * version so the shuffle only changes when the content does.
 *
 * Without a seed each render picks a fresh order, which means different
 * Cloudflare PoPs cache different orders of the same page and every
 * revalidation reshuffles it. Seeding makes the order stable for a given
 * content version and rotate on the next admin edit. mulberry32: 32-bit, fast,
 * good enough for a shuffle — this is presentation order, not security.
 */
export function contentSeededRandom(seed: number = getContentVersion()): () => number {
  let a = (seed + 0x6d2b79f5) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Public detail pages may include useful archived trips; listings only use published trips. */
export function tripPublicationStatus(trip: Record<string, any>): PublicationStatus {
  const explicit = String(trip?.publicationStatus ?? '').toLowerCase();
  if (['draft', 'published', 'archived', 'test'].includes(explicit)) {
    return explicit as PublicationStatus;
  }
  // Safe legacy fallback: QA fixtures must never leak into production SEO surfaces.
  const slug = String(trip?.slug ?? '');
  if (slug.startsWith('qa-test-')) return 'test';
  return 'published';
}

export function isTripPublic(trip: Record<string, any>): boolean {
  const status = tripPublicationStatus(trip);
  if (status === 'test' && process.env.ALLOW_TEST_CONTENT === 'true') return true;
  return status === 'published' || status === 'archived';
}

export function isTripListable(trip: Record<string, any>): boolean {
  const status = tripPublicationStatus(trip);
  const publishable = status === 'published' || (status === 'test' && process.env.ALLOW_TEST_CONTENT === 'true');
  return publishable && tripHasUpcomingDates(trip);
}

/**
 * DELIBERATELY NOT CACHED — do not wrap this in cachedRead().
 *
 * This is the read half of a read-modify-write: `adjustBookingCount`
 * (src/lib/registrationWrite.ts) does readTrip → mutate the returned object in
 * place → writeTrip, and carries an ATOMICITY INVARIANT requiring that to
 * complete synchronously in one tick. Handing it a shared cached object breaks
 * that two ways: two confirmations would mutate the same instance and silently
 * lose a seat increment, and the dev-mode deep-freeze would throw on the
 * mutation outright. Every caller of readTrip gets its own fresh parse.
 */
export function readTrip(slug: string): Record<string, any> | null {
  assertSafeSlug(slug);
  const filePath = path.join(TRIPS_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return YAML.parse(raw) ?? null;
}

export function writeTrip(slug: string, data: Record<string, any>): void {
  assertSafeSlug(slug);
  ensureDir(TRIPS_DIR);
  const filePath = path.join(TRIPS_DIR, `${slug}.yaml`);
  fs.writeFileSync(filePath, YAML.stringify(data), 'utf-8');
  // Hooked here rather than at the call sites so that every write path
  // invalidates — including the booking one, which reaches writeTrip through
  // adjustBookingCount. Synchronous, so that function's invariant holds.
  bumpContentVersion();
}

/**
 * Clamp/sanitise per-day itinerary photos in place: at most 3 per day, only
 * locally-hosted `/images/...` URLs, `width`/`height` coerced to number|null.
 * A day with no valid photos loses the `photos` key entirely (keeps YAML clean).
 * Called on every admin write path (update / create / import) — the client cap
 * is cosmetic.
 */
export function normalizeItineraryPhotos(itinerary: unknown): void {
  if (!Array.isArray(itinerary)) return;
  for (const day of itinerary) {
    if (!day || typeof day !== 'object') continue;
    const raw = Array.isArray((day as any).photos) ? (day as any).photos : [];
    const clean = raw
      .filter((p: any) => p && typeof p.image === 'string' && p.image.startsWith('/images/'))
      .slice(0, 3)
      .map((p: any) => ({
        image: p.image,
        width: Number.isFinite(p.width) ? p.width : null,
        height: Number.isFinite(p.height) ? p.height : null,
      }));
    if (clean.length) (day as any).photos = clean;
    else delete (day as any).photos;
  }
}

export function deleteTrip(slug: string, opts: { keepImages?: boolean } = {}): void {
  assertSafeSlug(slug);
  const filePath = path.join(TRIPS_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return;
  // On a slug rename the renamed trip reuses the same image files, so the
  // caller passes keepImages to drop only the YAML.
  if (!opts.keepImages) {
    try {
      const data = readTrip(slug);
      if (data) for (const url of collectImageUrls(data)) deleteImageByUrl(url);
    } catch { /* best-effort */ }
  }
  fs.unlinkSync(filePath);
  bumpContentVersion();
}

/**
 * The departure `status` values the admin editor offers. There is no CHECK
 * constraint — `parseEditorBooking` stores the string as-is — so this is the
 * single source the UI and Badge should read instead of re-listing literals.
 * `coming-soon`: the date is public but not yet open for booking; its price is
 * concealed and the CTA becomes "Wishlist now".
 */
export const DEPARTURE_STATUSES = [
  'booking-open',
  'filling_fast',
  'coming-soon',
  'sold-out',
  'draft',
  'completed',
] as const;

/** True for a departure that is published-but-not-yet-sellable. */
export function isComingSoon(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase();
  return s === 'coming-soon' || s === 'coming_soon';
}

/** True when a bookable departure should carry the manual urgency label. */
export function isFillingFast(status: unknown): boolean {
  const s = String(status ?? '').toLowerCase();
  return s === 'filling-fast' || s === 'filling_fast';
}

export function upcomingBatches(trip: Record<string, any>): Array<Record<string, any>> {
  const batches = Array.isArray(trip?.batches) ? trip.batches : [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return batches
    .filter((b: any) => {
      if (!b?.startDate) return false;
      const start = new Date(b.startDate);
      if (isNaN(start.getTime())) return false;
      start.setHours(0, 0, 0, 0);
      if (start < today) return false;
      if (b.status === 'draft' || b.status === 'completed') return false;
      return true;
    })
    .sort((a: any, b: any) => String(a.startDate).localeCompare(String(b.startDate)));
}

export function tripHasUpcomingDates(trip: Record<string, any>): boolean {
  const hasBatchArray = Array.isArray(trip?.batches) && trip.batches.length > 0;
  if (!hasBatchArray) return true;
  return upcomingBatches(trip).length > 0;
}

export interface ResolvedOffer {
  tierId: string;
  label: string;
  helperText: string;
  price: number;
  /** Base price before a currently-active departure discount. */
  originalPrice: number | null;
  cap: number | null;
  booked: number;
  available: boolean;
}

export interface ResolvedDeparture {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  offers: ResolvedOffer[];
  totalCap: number | null;
  spotsLeft: number | null;
  soldOut: boolean;
  /** Published but not open for booking — price concealed, wishlist instead. */
  comingSoon: boolean;
  /** Bookable departure carrying an admin-controlled urgency label. */
  fillingFast: boolean;
  discountAmount?: number;
  discountEndsAt?: string | null;
  discountActive?: boolean;
}

export interface ResolvedBooking {
  occupancyCatalog: Array<{ id: string; label: string; helperText: string }>;
  departures: ResolvedDeparture[];
  advanceAmount: number;
  balanceDueRule: string;
  currency: string;
  fromPrice: number | null;
}

const DEFAULT_ADVANCE = 3000;
const DEFAULT_BALANCE_RULE = '15 days before trip';

function resolveCatalog(trip: Record<string, any>): ResolvedBooking['occupancyCatalog'] {
  const cat = Array.isArray(trip?.occupancyCatalog) ? trip.occupancyCatalog : [];
  if (cat.length > 0) {
    return cat
      .filter((c: any) => c && (c.id || c.label))
      .map((c: any) => ({
        id: String(c.id ?? slugifyTier(c.label)),
        label: String(c.label ?? c.id ?? ''),
        helperText: String(c.helperText ?? ''),
      }));
  }
  const sharing = Array.isArray(trip?.sharingOptions) ? trip.sharingOptions : [];
  if (sharing.length > 0) {
    return sharing
      .filter((o: any) => o && o.label && Number.isFinite(Number(o.price)))
      .map((o: any) => ({
        id: String(o.id ?? slugifyTier(o.label)),
        label: String(o.label),
        helperText: String(o.helperText ?? ''),
      }));
  }
  return [{ id: 'standard', label: 'Standard', helperText: '' }];
}

function slugifyTier(label: unknown): string {
  return String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tier';
}

function resolveOffers(
  batch: Record<string, any>,
  trip: Record<string, any>,
  catalog: ResolvedBooking['occupancyCatalog'],
): ResolvedOffer[] {
  const labelOf = (tierId: string) => catalog.find((c) => c.id === tierId);
  const discountAmount = activeDepartureDiscount(batch);
  const mk = (tierId: string, price: number, cap: number | null, booked: number): ResolvedOffer => {
    const meta = labelOf(tierId);
    const c = cap == null ? null : Math.max(0, cap);
    const b = Math.max(0, booked || 0);
    return {
      tierId,
      label: meta?.label ?? tierId,
      helperText: meta?.helperText ?? '',
      price: Math.max(0, Math.round(price) - discountAmount),
      originalPrice: discountAmount > 0 ? Math.round(price) : null,
      cap: c,
      booked: b,
      available: c == null ? true : c - b > 0,
    };
  };

  if (Array.isArray(batch?.offers) && batch.offers.length > 0) {
    return batch.offers
      .filter((o: any) => o && o.tierId != null && Number.isFinite(Number(o.price)))
      .map((o: any) => mk(
        String(o.tierId),
        Number(o.price),
        o.cap == null || o.cap === '' ? null : Number(o.cap),
        Number(o.booked),
      ));
  }

  const sharing = Array.isArray(trip?.sharingOptions) ? trip.sharingOptions : [];
  const dateCap = Number.isFinite(Number(batch?.totalSpots)) ? Number(batch.totalSpots) : null;
  const dateBooked = Number.isFinite(Number(batch?.bookedSpots)) ? Number(batch.bookedSpots) : 0;
  if (sharing.length > 0) {
    return sharing
      .filter((o: any) => o && o.label && Number.isFinite(Number(o.price)))
      .map((o: any) => mk(String(o.id ?? slugifyTier(o.label)), Number(o.price), dateCap, dateBooked));
  }

  const flat = Number.isFinite(Number(batch?.price))
    ? Number(batch.price)
    : Number((trip as any)?.pricePerPerson);
  if (!Number.isFinite(flat)) return [];
  return [mk('standard', flat, dateCap, dateBooked)];
}

/** Returns the fixed rupee discount that is active for this departure right now. */
export function activeDepartureDiscount(batch: Record<string, any>, now = Date.now()): number {
  const amount = Math.max(0, Math.round(Number(batch?.discountAmount) || 0));
  if (amount <= 0) return 0;
  const rawEndsAt = String(batch?.discountEndsAt ?? '').trim();
  if (!rawEndsAt) return amount;
  const endsAt = new Date(rawEndsAt).getTime();
  return Number.isFinite(endsAt) && endsAt > now ? amount : 0;
}

/**
 * Memo for resolveBooking, keyed on the trip object's identity.
 *
 * resolveBooking ran 4x per trip on `/` (the listTrips ranking pass, the
 * listable filter, the card summary, and the departures prop) and 3x on
 * `/trips/`. It is pure over the trip object, so one resolve per object is
 * enough. A WeakMap means entries die with the trips that key them.
 *
 * STALENESS: because listTrips() is cached, the same trip objects now persist
 * for a cache generation, so a memoized result does too. resolveBooking depends
 * on wall-clock time through activeDepartureDiscount() and upcomingBatches(),
 * which makes a discount expiry or a departure rolling into the past visible up
 * to `30s + s-maxage` late — about 5.5 minutes once edge caching is on. That is
 * acceptable for a trips site, and the countdown UI is client-side anyway.
 * (Without the listTrips cache this memo would introduce no staleness at all,
 * since listTrips would rebuild the key objects on every call.)
 */
const bookingMemo = new WeakMap<object, ResolvedBooking>();

export function resolveBooking(trip: Record<string, any>): ResolvedBooking {
  const memoized = bookingMemo.get(trip);
  if (memoized) return memoized;
  const resolved = resolveBookingUncached(trip);
  bookingMemo.set(trip, resolved);
  return resolved;
}

function resolveBookingUncached(trip: Record<string, any>): ResolvedBooking {
  const catalog = resolveCatalog(trip);
  const hasBatchArray = Array.isArray(trip?.batches) && trip.batches.length > 0;
  const rawDepartures: Array<Record<string, any>> = hasBatchArray
    ? upcomingBatches(trip)
    : trip?.startDate
    ? [{
        id: 'default',
        startDate: trip.startDate,
        endDate: trip.endDate ?? trip.startDate,
        price: trip.pricePerPerson ?? 0,
        totalSpots: trip.maxGroupSize ?? null,
        bookedSpots: trip.currentBookings ?? 0,
        status: 'booking-open',
      }]
    : [];

  const departures: ResolvedDeparture[] = rawDepartures.map((b) => {
    const discountAmount = activeDepartureDiscount(b);
    const offers = resolveOffers(b, trip, catalog);
    const metered = offers.every((o) => o.cap != null);
    const spotsLeft = metered
      ? offers.reduce((sum, o) => sum + Math.max(0, (o.cap as number) - o.booked), 0)
      : null;
    const totalCap = metered
      ? offers.reduce((sum, o) => sum + (o.cap as number), 0)
      : null;
    const comingSoon = isComingSoon(b.status);
    const fillingFast = isFillingFast(b.status);
    const statusSoldOut = b.status === 'sold-out' || b.status === 'sold_out';
    const soldOut = !comingSoon && (statusSoldOut || (spotsLeft != null && spotsLeft <= 0));
    return {
      id: String(b.id),
      startDate: String(b.startDate),
      endDate: String(b.endDate ?? b.startDate),
      status: String(b.status ?? 'booking-open'),
      offers,
      totalCap,
      spotsLeft,
      soldOut,
      comingSoon,
      fillingFast,
      discountAmount,
      discountEndsAt: discountAmount > 0 && b.discountEndsAt ? String(b.discountEndsAt) : null,
      discountActive: discountAmount > 0,
    };
  });

  // Coming-soon departures never contribute to the public "from ₹X" — their
  // price is concealed everywhere it would otherwise surface.
  const availablePrices: number[] = [];
  const allPrices: number[] = [];
  for (const d of departures) {
    if (d.comingSoon) continue;
    for (const o of d.offers) {
      allPrices.push(o.price);
      if (!d.soldOut && o.available) availablePrices.push(o.price);
    }
  }
  const pool = availablePrices.length > 0 ? availablePrices : allPrices;
  const fromPrice = pool.length > 0 ? Math.min(...pool) : null;

  return {
    occupancyCatalog: catalog,
    departures,
    advanceAmount: Number.isFinite(Number(trip?.paymentAmount)) ? Number(trip.paymentAmount) : DEFAULT_ADVANCE,
    balanceDueRule: typeof trip?.balanceDueRule === 'string' && trip.balanceDueRule.trim()
      ? trip.balanceDueRule
      : DEFAULT_BALANCE_RULE,
    currency: 'INR',
    fromPrice,
  };
}

export function tripCardSummary(trip: Record<string, any>): {
  fromPrice: number | null;
  originalFromPrice: number | null;
  discountEndsAt: string | null;
  multiPrice: boolean;
  spotsLeft: number | null;
  soldOut: boolean;
  /** At least one upcoming departure is coming-soon. */
  hasComingSoon: boolean;
  /** Every upcoming departure is coming-soon (so there is no public price). */
  allComingSoon: boolean;
  /**
   * The resolved departures this summary was computed from. Exposed so a card
   * render that needs both the summary and the departures makes one call
   * instead of two — it is the same array reference resolveBooking() returns,
   * so treat it as read-only, like everything else on the read path.
   */
  departures: ResolvedDeparture[];
} {
  const booking = resolveBooking(trip);
  // Coming-soon departures are excluded from every price computation — the card
  // must not reveal a number sourced from a not-yet-open date.
  const sellable = booking.departures.filter((d) => !d.comingSoon);
  const prices = new Set<number>();
  const candidates: Array<{ price: number; originalPrice: number | null; discountEndsAt: string | null }> = [];
  for (const d of sellable) for (const o of d.offers) prices.add(o.price);
  for (const d of sellable) {
    if (d.soldOut) continue;
    for (const o of d.offers) if (o.available) candidates.push({
      price: o.price,
      originalPrice: o.originalPrice,
      discountEndsAt: d.discountEndsAt ?? null,
    });
  }
  if (candidates.length === 0) {
    for (const d of sellable) for (const o of d.offers) candidates.push({
      price: o.price,
      originalPrice: o.originalPrice,
      discountEndsAt: d.discountEndsAt ?? null,
    });
  }
  const lead = candidates.sort((a, b) => a.price - b.price)[0] ?? null;
  const soonest = sellable.find((d) => !d.soldOut) ?? sellable[0] ?? null;
  const comingSoonCount = booking.departures.filter((d) => d.comingSoon).length;
  // "Sold out" only when there is genuinely nothing to do: sellable dates exist,
  // all are full, and there is no coming-soon date left to wishlist.
  const allSoldOut = sellable.length > 0 && sellable.every((d) => d.soldOut) && comingSoonCount === 0;
  return {
    fromPrice: booking.fromPrice,
    originalFromPrice: lead?.originalPrice ?? null,
    discountEndsAt: lead?.originalPrice != null ? lead.discountEndsAt : null,
    multiPrice: prices.size > 1,
    spotsLeft: soonest?.spotsLeft ?? null,
    soldOut: allSoldOut,
    hasComingSoon: comingSoonCount > 0,
    allComingSoon: booking.departures.length > 0 && comingSoonCount === booking.departures.length,
    departures: booking.departures,
  };
}

// Admin-only: a "from" price even when every departure is in the past.
// resolveBooking() deliberately ignores past batches (public site hides them),
// but the admin trip list still wants a number instead of "—".
export function tripCardSummaryAnyBatch(trip: Record<string, any>): {
  fromPrice: number | null;
  multiPrice: boolean;
} {
  const all = Array.isArray(trip?.batches) ? trip.batches : [];
  if (all.length === 0) {
    const s = tripCardSummary(trip);
    return { fromPrice: s.fromPrice, multiPrice: s.multiPrice };
  }
  const catalog = resolveCatalog(trip);
  const prices = new Set<number>();
  for (const b of all) for (const o of resolveOffers(b, trip, catalog)) prices.add(o.price);
  return {
    fromPrice: prices.size > 0 ? Math.min(...prices) : null,
    multiPrice: prices.size > 1,
  };
}

export function findTripByName(tripName: string) {
  return listTrips().find((t: any) => (t.title || t.name) === tripName) ?? null;
}
