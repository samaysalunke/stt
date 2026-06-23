import { YAML, fs, path, TRIPS_DIR, ensureDir, assertSafeSlug, deleteImageByUrl, collectImageUrls } from './_contentBase';

export function listTrips(): Array<Record<string, any>> {
  ensureDir(TRIPS_DIR);
  const trips = fs
    .readdirSync(TRIPS_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const slug = f.replace('.yaml', '');
      const raw = fs.readFileSync(path.join(TRIPS_DIR, f), 'utf-8');
      const data = YAML.parse(raw) ?? {};
      return { slug, ...data };
    });
  const ranked = trips.map((t) => ({
    t,
    rank: !tripHasUpcomingDates(t) ? 2 : (tripCardSummary(t).soldOut ? 1 : 0),
  }));
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map((r) => r.t);
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

export function deleteTrip(slug: string): void {
  assertSafeSlug(slug);
  const filePath = path.join(TRIPS_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return;
  try {
    const data = readTrip(slug);
    if (data) for (const url of collectImageUrls(data)) deleteImageByUrl(url);
  } catch { /* best-effort */ }
  fs.unlinkSync(filePath);
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
  const mk = (tierId: string, price: number, cap: number | null, booked: number): ResolvedOffer => {
    const meta = labelOf(tierId);
    const c = cap == null ? null : Math.max(0, cap);
    const b = Math.max(0, booked || 0);
    return {
      tierId,
      label: meta?.label ?? tierId,
      helperText: meta?.helperText ?? '',
      price: Math.round(price),
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
    const offers = resolveOffers(b, trip, catalog);
    const metered = offers.every((o) => o.cap != null);
    const spotsLeft = metered
      ? offers.reduce((sum, o) => sum + Math.max(0, (o.cap as number) - o.booked), 0)
      : null;
    const totalCap = metered
      ? offers.reduce((sum, o) => sum + (o.cap as number), 0)
      : null;
    const statusSoldOut = b.status === 'sold-out' || b.status === 'sold_out';
    const soldOut = statusSoldOut || (spotsLeft != null && spotsLeft <= 0);
    return {
      id: String(b.id),
      startDate: String(b.startDate),
      endDate: String(b.endDate ?? b.startDate),
      status: String(b.status ?? 'booking-open'),
      offers,
      totalCap,
      spotsLeft,
      soldOut,
    };
  });

  const availablePrices: number[] = [];
  const allPrices: number[] = [];
  for (const d of departures) {
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
  multiPrice: boolean;
  spotsLeft: number | null;
  soldOut: boolean;
} {
  const booking = resolveBooking(trip);
  const prices = new Set<number>();
  for (const d of booking.departures) for (const o of d.offers) prices.add(o.price);
  const soonest = booking.departures.find((d) => !d.soldOut) ?? booking.departures[0] ?? null;
  const allSoldOut = booking.departures.length > 0 && booking.departures.every((d) => d.soldOut);
  return {
    fromPrice: booking.fromPrice,
    multiPrice: prices.size > 1,
    spotsLeft: soonest?.spotsLeft ?? null,
    soldOut: allSoldOut,
  };
}

export function findTripByName(tripName: string) {
  return listTrips().find((t: any) => (t.title || t.name) === tripName) ?? null;
}
