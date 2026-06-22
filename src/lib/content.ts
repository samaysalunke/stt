import YAML from 'yaml';
import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';
import sharp from 'sharp';

const CWD = process.cwd();
const CONTENT_BASE = process.env.CONTENT_DIR ?? path.join(CWD, 'src', 'content');
const TRIPS_DIR = path.join(CONTENT_BASE, 'trips');
const ALBUMS_DIR = path.join(CONTENT_BASE, 'albums');
const TESTIMONIALS_DIR = path.join(CONTENT_BASE, 'testimonials');
const FAQS_DIR = path.join(CONTENT_BASE, 'faqs');
const SITE_SETTINGS_FILE = path.join(CONTENT_BASE, 'site-settings.yaml');

// ── YAML helpers ─────────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function assertSafeSlug(slug: string): void {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`Invalid slug: "${slug}"`);
  }
}

// ── Trips ─────────────────────────────────────────────────────────────────────

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
  // Sort by state derived from departures (trip-level status is gone): trips with
  // bookable upcoming departures first, then fully sold-out, then those with no
  // upcoming dates. Rank is precomputed so resolveBooking runs once per trip.
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
  // Remove the trip's uploaded images (featured, QR, etc.) before deleting the YAML.
  try {
    const data = readTrip(slug);
    if (data) for (const url of collectImageUrls(data)) deleteImageByUrl(url);
  } catch { /* best-effort */ }
  fs.unlinkSync(filePath);
}

// Batches (departure dates) that should be visible on the public site:
//  - not departed (startDate is today or later), and
//  - not hidden by per-batch status (draft / completed).
// Sorted soonest-first. Evaluated at request time (pages are SSR).
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
      if (start < today) return false;            // departed / commenced
      if (b.status === 'draft' || b.status === 'completed') return false;
      return true;
    })
    .sort((a: any, b: any) => String(a.startDate).localeCompare(String(b.startDate)));
}

// A trip that defines batches is "live" only if it has at least one upcoming
// batch. Trips without a batches array (legacy single-date) are always live
// and fall back to trip-level status.
export function tripHasUpcomingDates(trip: Record<string, any>): boolean {
  const hasBatchArray = Array.isArray(trip?.batches) && trip.batches.length > 0;
  if (!hasBatchArray) return true;
  return upcomingBatches(trip).length > 0;
}

// ── Booking resolution (single normalization boundary) ──────────────────────
// resolveBooking(trip) is the ONE place that turns whatever a trip's YAML holds
// — new per-departure `offers`, legacy trip-wide `sharingOptions`, or a flat
// per-batch price — into a single canonical shape. Every downstream consumer
// (public booking panel, register API, trip card, listings) reads this shape so
// price/occupancy/stock logic can never disagree across the codebase.
//
// New schema (authored shape):
//   trip.occupancyCatalog: [{ id, label, helperText }]    — tier identity only
//   trip.batches[i].offers: [{ tierId, price, cap, booked }] — per date × tier
// Legacy schema (still read):
//   trip.sharingOptions: [{ id, label, price }] applied to every date, OR
//   a flat trip/batch price with no occupancy options at all.

export interface ResolvedOffer {
  tierId: string;
  label: string;
  helperText: string;
  price: number;
  cap: number | null;     // null = unmetered stock for this tier
  booked: number;
  available: boolean;     // cap == null || cap - booked > 0
}

export interface ResolvedDeparture {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  offers: ResolvedOffer[];
  totalCap: number | null;  // null when any offered tier is unmetered
  spotsLeft: number | null; // Σ(cap - booked); null when unmetered
  soldOut: boolean;
}

export interface ResolvedBooking {
  occupancyCatalog: Array<{ id: string; label: string; helperText: string }>;
  departures: ResolvedDeparture[];
  advanceAmount: number;
  balanceDueRule: string;
  currency: string;
  fromPrice: number | null; // min available offer price across all departures
}

const DEFAULT_ADVANCE = 3000;
const DEFAULT_BALANCE_RULE = '15 days before trip';

// Build the trip-level tier catalog. Prefer an explicit occupancyCatalog; else
// derive it from legacy sharingOptions; else a single implicit "standard" tier.
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

// Resolve a single departure's offers, synthesizing them from legacy data when
// the batch has no explicit `offers` array.
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

  // New schema: explicit per-departure offers.
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

  // Legacy: trip-wide sharingOptions priced per tier; the date's single
  // totalSpots/bookedSpots count is shared across all tiers (best we can do).
  const sharing = Array.isArray(trip?.sharingOptions) ? trip.sharingOptions : [];
  const dateCap = Number.isFinite(Number(batch?.totalSpots)) ? Number(batch.totalSpots) : null;
  const dateBooked = Number.isFinite(Number(batch?.bookedSpots)) ? Number(batch.bookedSpots) : 0;
  if (sharing.length > 0) {
    return sharing
      .filter((o: any) => o && o.label && Number.isFinite(Number(o.price)))
      .map((o: any) => mk(String(o.id ?? slugifyTier(o.label)), Number(o.price), dateCap, dateBooked));
  }

  // Legacy flat price: a single implicit "standard" tier.
  const flat = Number.isFinite(Number(batch?.price))
    ? Number(batch.price)
    : Number((trip as any)?.pricePerPerson);
  if (!Number.isFinite(flat)) return [];
  return [mk('standard', flat, dateCap, dateBooked)];
}

export function resolveBooking(trip: Record<string, any>): ResolvedBooking {
  const catalog = resolveCatalog(trip);

  // Which departures are visible/bookable. Reuse the existing upcoming filter
  // for batch-array trips; fall back to a synthetic single departure for legacy
  // flat-date trips.
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

  // fromPrice: cheapest price among offers that are available on a not-sold-out
  // departure. Falls back to the cheapest offer overall so a header still shows.
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

// Compact summary for the listing/trip card: the "from" floor, whether more than
// one price exists (so "from" is honest), the soonest departure's stock (for a
// low-stock signal), and whether the whole trip is sold out.
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

// ── Albums ────────────────────────────────────────────────────────────────────

export function listAlbums(): Array<Record<string, any>> {
  ensureDir(ALBUMS_DIR);
  return fs
    .readdirSync(ALBUMS_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const slug = f.replace('.yaml', '');
      const raw = fs.readFileSync(path.join(ALBUMS_DIR, f), 'utf-8');
      const data = YAML.parse(raw) ?? {};
      return { slug, ...data };
    });
}

export function readAlbum(slug: string): Record<string, any> | null {
  assertSafeSlug(slug);
  const filePath = path.join(ALBUMS_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return YAML.parse(raw) ?? null;
}

export function writeAlbum(slug: string, data: Record<string, any>): void {
  assertSafeSlug(slug);
  ensureDir(ALBUMS_DIR);
  const filePath = path.join(ALBUMS_DIR, `${slug}.yaml`);
  fs.writeFileSync(filePath, YAML.stringify(data), 'utf-8');
}

// Last-modified date (YYYY-MM-DD) of a trip/album YAML file, for sitemap freshness.
// Returns undefined if the file can't be stat'd.
export function contentLastmod(kind: 'trips' | 'albums', slug: string): string | undefined {
  const dir = kind === 'trips' ? TRIPS_DIR : ALBUMS_DIR;
  try {
    return fs.statSync(path.join(dir, `${slug}.yaml`)).mtime.toISOString().slice(0, 10);
  } catch {
    return undefined;
  }
}

export function deleteAlbum(slug: string): void {
  assertSafeSlug(slug);
  const filePath = path.join(ALBUMS_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return;
  // Remove the album's cover + all photo files before deleting the YAML.
  try {
    const data = readAlbum(slug);
    if (data) for (const url of collectImageUrls(data)) deleteImageByUrl(url);
  } catch { /* best-effort */ }
  fs.unlinkSync(filePath);
}

// ── Site Settings ────────────────────────────────────────────────────────────

export function readSiteSettings(): Record<string, any> {
  if (!fs.existsSync(SITE_SETTINGS_FILE)) return {};
  const raw = fs.readFileSync(SITE_SETTINGS_FILE, 'utf-8');
  return YAML.parse(raw) ?? {};
}

export function writeSettings(data: Record<string, any>): void {
  ensureDir(CONTENT_BASE);
  fs.writeFileSync(SITE_SETTINGS_FILE, YAML.stringify(data), 'utf-8');
}

// ── Testimonials ─────────────────────────────────────────────────────────────

export function listTestimonials(): Array<Record<string, any>> {
  ensureDir(TESTIMONIALS_DIR);
  return fs
    .readdirSync(TESTIMONIALS_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const slug = f.replace('.yaml', '');
      const raw = fs.readFileSync(path.join(TESTIMONIALS_DIR, f), 'utf-8');
      const data = YAML.parse(raw) ?? {};
      return { slug, ...data };
    });
}

export function readTestimonial(slug: string): Record<string, any> | null {
  assertSafeSlug(slug);
  const filePath = path.join(TESTIMONIALS_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return YAML.parse(raw) ?? null;
}

export function writeTestimonial(slug: string, data: Record<string, any>): void {
  assertSafeSlug(slug);
  ensureDir(TESTIMONIALS_DIR);
  const filePath = path.join(TESTIMONIALS_DIR, `${slug}.yaml`);
  fs.writeFileSync(filePath, YAML.stringify(data), 'utf-8');
}

export function deleteTestimonial(slug: string): void {
  assertSafeSlug(slug);
  const filePath = path.join(TESTIMONIALS_DIR, `${slug}.yaml`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── FAQs ───────────────────────────────────────────────────────────────────

export function listFaqs(): Array<Record<string, any>> {
  ensureDir(FAQS_DIR);
  return fs
    .readdirSync(FAQS_DIR)
    .filter(f => f.endsWith('.yaml'))
    .map(f => {
      const slug = f.replace('.yaml', '');
      const raw = fs.readFileSync(path.join(FAQS_DIR, f), 'utf-8');
      const data = YAML.parse(raw) ?? {};
      return { slug, ...data };
    })
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

export function readFaq(slug: string): Record<string, any> | null {
  assertSafeSlug(slug);
  const filePath = path.join(FAQS_DIR, `${slug}.yaml`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return YAML.parse(raw) ?? null;
}

export function writeFaq(slug: string, data: Record<string, any>): void {
  assertSafeSlug(slug);
  ensureDir(FAQS_DIR);
  const filePath = path.join(FAQS_DIR, `${slug}.yaml`);
  fs.writeFileSync(filePath, YAML.stringify(data), 'utf-8');
}

export function deleteFaq(slug: string): void {
  assertSafeSlug(slug);
  const filePath = path.join(FAQS_DIR, `${slug}.yaml`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

// ── Image upload ──────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

// Images go to CONTENT_DIR/images/ (persistent on Railway volume).
// Falls back to public/images/ in local dev when CONTENT_DIR is not set.
const IMAGES_BASE = path.join(CONTENT_BASE, 'images');

export async function saveImageFile(
  file: File,
  destSubDir: string,   // e.g. 'images/trips' — relative to content base
  namePart?: string     // optional prefix, e.g. slug; otherwise uses uuid
): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`Invalid image type: ${file.type}`);
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error('Image too large (max 10 MB)');
  }

  const rawExt = file.name.split('.').pop()?.toLowerCase() ?? '';
  const ext = ALLOWED_IMAGE_EXTS.includes(rawExt) ? rawExt : 'jpg';
  const filename = namePart ? `${namePart}.${ext}` : `${uuid()}.${ext}`;

  // Strip the leading 'images/' prefix if present so we store under IMAGES_BASE
  const subPath = destSubDir.replace(/^images\//, '');
  const destDir = path.join(IMAGES_BASE, subPath);
  ensureDir(destDir);

  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(destDir, filename), buffer);

  return `/${destSubDir}/${filename}`; // public URL via /images/[...path].ts
}

// Same as saveImageFile, but also returns the image's pixel dimensions (read via
// sharp) so galleries can lay out portrait + landscape images without cropping or
// layout shift. Dimension read is best-effort: returns null w/h if it fails.
export async function saveImageFileWithMeta(
  file: File,
  destSubDir: string,
  namePart?: string,
): Promise<{ url: string; width: number | null; height: number | null }> {
  const url = await saveImageFile(file, destSubDir, namePart);
  let width: number | null = null;
  let height: number | null = null;
  try {
    const rel = url.replace(/^\/images\//, '');
    const meta = await sharp(path.join(IMAGES_BASE, rel)).metadata();
    // Respect EXIF orientation: swap dims for rotated portraits.
    const rotated = meta.orientation && meta.orientation >= 5;
    width = (rotated ? meta.height : meta.width) ?? null;
    height = (rotated ? meta.width : meta.height) ?? null;
  } catch {
    /* dimensions unavailable — gallery falls back to natural sizing */
  }
  return { url, width, height };
}

// Delete a single uploaded image by its public URL (e.g. "/images/albums/photos/x.jpg").
// No-ops for external URLs (http…), non-image paths, or anything resolving outside
// IMAGES_BASE. Best-effort: never throws.
export function deleteImageByUrl(publicUrl: unknown): void {
  if (typeof publicUrl !== 'string' || !publicUrl.startsWith('/images/')) return;
  const rel = publicUrl.replace(/^\/images\//, '');
  if (!rel || rel.includes('..')) return;
  const filePath = path.join(IMAGES_BASE, rel);
  if (!filePath.startsWith(IMAGES_BASE + path.sep)) return; // traversal guard
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) fs.unlinkSync(filePath);
  } catch {
    /* best-effort cleanup */
  }
}

// Recursively collect every "/images/…" URL referenced anywhere in a record
// (top-level fields, arrays, nested objects). Used to clean up a record's
// uploaded images on delete. References to *other* records are plain slug
// strings, so this never reaches across to another record's images.
export function collectImageUrls(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (value.startsWith('/images/')) acc.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectImageUrls(v, acc);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectImageUrls(v, acc);
  }
  return acc;
}
