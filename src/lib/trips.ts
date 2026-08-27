import { YAML, fs, path, TRIPS_DIR, ensureDir, assertSafeSlug, deleteImageByUrl, collectImageUrls } from './_contentBase';
import { listDeletedSlugs } from './tripDeletions';

/** Raw, unfiltered slugs of every trip file on disk (includes soft-deleted). */
export function listTripSlugs(): string[] {
  ensureDir(TRIPS_DIR);
  return fs.readdirSync(TRIPS_DIR).filter(f => f.endsWith('.yaml')).map(f => f.replace('.yaml', ''));
}

export function listTrips(): Array<Record<string, any>> {
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
}

export type PublicationStatus = 'draft' | 'published' | 'archived' | 'test';

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

export function resolveBooking(trip: Record<string, any>): ResolvedBooking {
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
