import { slugify } from './utils';

// Editor-facing view of a trip's occupancy catalog + departures-with-offers.
// Mirrors resolveBooking's synthesis (src/lib/content.ts) BUT keeps every
// departure (no upcoming/draft filtering) so the admin editor round-trips all
// dates. Opening a legacy trip here synthesizes offers from sharingOptions or a
// flat price, so the first save migrates it to the new schema.

export interface EditorTier { id: string; label: string; helperText: string }
export interface EditorOffer { tierId: string; price: number | null; cap: number | null; booked: number }
export interface EditorDeparture {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  offers: EditorOffer[];
}

export type EditorBookingErrorCode =
  | 'invalid-catalog'
  | 'invalid-departures'
  | 'missing-start-date'
  | 'missing-offer'
  | 'missing-price';

export interface EditorBookingError {
  code: EditorBookingErrorCode;
  departureIndex?: number;
}

/**
 * Normalize a tier/stay/accommodation string for fuzzy comparison:
 * NFKC, smart-quotes → ', lowercase, strip a trailing price suffix like
 * "(Rs 22,000)", collapse non-alphanumerics to single spaces, trim.
 */
export function normalizeTierText(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .toLowerCase()
    .replace(/\(\s*(?:rs\.?|₹|inr)[^)]*\)/g, ' ') // drop "(Rs 22,000)" style suffix
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Resolve a free-text stay/accommodation answer to a tier id, validated against
 * THIS trip's catalog. Matches an entry's id or label (normalized), exact first,
 * then a contains-either-way fallback (so "Triple sharing - Mudhouse (Rs 22,000)"
 * matches a label like "Mudhouse Triple"). Returns '' when nothing matches.
 */
export function matchTierFromStay(stayRaw: string, catalog: EditorTier[]): string {
  const want = normalizeTierText(stayRaw);
  if (!want) return '';
  const wantTokens = new Set(want.split(' ').filter(Boolean));
  const entries = catalog.map((c) => ({
    id: c.id,
    keys: [normalizeTierText(c.id), normalizeTierText(c.label)].filter(Boolean),
  }));
  // 1. exact normalized match on id or label.
  for (const e of entries) if (e.keys.includes(want)) return e.id;
  // 2. token-subset either way (handles reordered words + a "(Rs …)"/"sharing"
  //    extra token), e.g. "Triple sharing - Mudhouse" ⊇ key "Mudhouse Triple".
  for (const e of entries) {
    for (const k of e.keys) {
      const keyTokens = k.split(' ').filter(Boolean);
      if (!keyTokens.length) continue;
      const keySubsetOfWant = keyTokens.every((t) => wantTokens.has(t));
      const wantSubsetOfKey = [...wantTokens].every((t) => keyTokens.includes(t));
      if (keySubsetOfWant || wantSubsetOfKey) return e.id;
    }
  }
  return '';
}

export function editableBooking(trip: Record<string, any>): {
  editorCatalog: EditorTier[];
  editorDepartures: EditorDeparture[];
} {
  const catalog = buildCatalog(trip);
  const batches = Array.isArray(trip?.batches) ? trip.batches : [];
  const sharing = Array.isArray(trip?.sharingOptions) ? trip.sharingOptions : [];

  const editorDepartures: EditorDeparture[] = batches.map((b: any) => {
    let offers: EditorOffer[];
    if (Array.isArray(b?.offers) && b.offers.length > 0) {
      offers = b.offers
        .filter((o: any) => o && o.tierId != null)
        .map((o: any) => ({
          tierId: String(o.tierId),
          price: numOrNull(o.price),
          cap: numOrNull(o.cap),
          booked: Number(o.booked) || 0,
        }));
    } else if (sharing.length > 0) {
      // Legacy: each sharing tier offered on this date, sharing the date's stock.
      offers = sharing
        .filter((o: any) => o && o.label)
        .map((o: any) => ({
          tierId: String(o.id ?? slugify(o.label)),
          price: numOrNull(o.price),
          cap: numOrNull(b?.totalSpots),
          booked: Number(b?.bookedSpots) || 0,
        }));
    } else {
      offers = [{
        tierId: 'standard',
        price: numOrNull(b?.price),
        cap: numOrNull(b?.totalSpots),
        booked: Number(b?.bookedSpots) || 0,
      }];
    }
    return {
      id: String(b?.id ?? ''),
      startDate: String(b?.startDate ?? ''),
      endDate: String(b?.endDate ?? ''),
      status: String(b?.status ?? 'booking-open'),
      offers,
    };
  });

  return { editorCatalog: catalog, editorDepartures };
}

function buildCatalog(trip: Record<string, any>): EditorTier[] {
  const cat = Array.isArray(trip?.occupancyCatalog) ? trip.occupancyCatalog : [];
  if (cat.length > 0) {
    return cat
      .filter((c: any) => c && (c.id || c.label))
      .map((c: any) => ({
        id: String(c.id ?? slugify(c.label)),
        label: String(c.label ?? c.id ?? ''),
        helperText: String(c.helperText ?? ''),
      }));
  }
  const sharing = Array.isArray(trip?.sharingOptions) ? trip.sharingOptions : [];
  if (sharing.length > 0) {
    return sharing
      .filter((o: any) => o && o.label)
      .map((o: any) => ({
        id: String(o.id ?? slugify(o.label)),
        label: String(o.label),
        helperText: String(o.helperText ?? ''),
      }));
  }
  return [{ id: 'standard', label: 'Standard', helperText: '' }];
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Parse the editor's serialized JSON fields back into trip YAML shape. Shared by
// the create + update API routes so authoring and persistence stay in lockstep.
export function parseEditorBooking(catalogJson: string, departuresJson: string): {
  occupancyCatalog: EditorTier[];
  batches: Array<{ id: string; startDate: string; endDate: string; status: string; offers: Array<{ tierId: string; price: number; cap: number | null; booked: number }> }>;
  errors: EditorBookingError[];
} {
  let cat: any[] = [];
  let deps: any[] = [];
  const errors: EditorBookingError[] = [];
  try {
    const parsed = JSON.parse(catalogJson || '[]');
    if (Array.isArray(parsed)) cat = parsed;
    else errors.push({ code: 'invalid-catalog' });
  } catch {
    errors.push({ code: 'invalid-catalog' });
  }
  try {
    const parsed = JSON.parse(departuresJson || '[]');
    if (Array.isArray(parsed)) deps = parsed;
    else errors.push({ code: 'invalid-departures' });
  } catch {
    errors.push({ code: 'invalid-departures' });
  }

  const occupancyCatalog: EditorTier[] = (Array.isArray(cat) ? cat : [])
    .map((c: any) => ({
      id: String(c?.id || slugify(c?.label || '')),
      label: String(c?.label ?? '').trim(),
      helperText: String(c?.helperText ?? '').trim(),
    }))
    .filter((c) => c.label && c.id);

  const validTierIds = new Set(occupancyCatalog.map((c) => c.id));

  deps.forEach((departure: any, departureIndex) => {
    const startDate = String(departure?.startDate ?? '').trim();
    const rawOffers = Array.isArray(departure?.offers) ? departure.offers : [];
    const knownOffers = rawOffers.filter((offer: any) => offer && validTierIds.has(String(offer.tierId)));

    if (!startDate) errors.push({ code: 'missing-start-date', departureIndex });
    if (knownOffers.length === 0) {
      errors.push({ code: 'missing-offer', departureIndex });
    } else if (knownOffers.some((offer: any) =>
      offer.price == null || offer.price === '' || !Number.isFinite(Number(offer.price)))) {
      errors.push({ code: 'missing-price', departureIndex });
    }
  });

  const batches = deps
    .map((d: any) => {
      const startDate = String(d?.startDate ?? '').trim();
      const offers = (Array.isArray(d?.offers) ? d.offers : [])
        .filter((o: any) =>
          o &&
          validTierIds.has(String(o.tierId)) &&
          o.price != null &&
          o.price !== '' &&
          Number.isFinite(Number(o.price)))
        .map((o: any) => ({
          tierId: String(o.tierId),
          price: Math.round(Number(o.price)),
          cap: o.cap == null || o.cap === '' ? null : Math.max(0, Number(o.cap)),
          booked: Math.max(0, Number(o.booked) || 0),
        }));
      return {
        id: String(d?.id || (startDate ? slugify(startDate) : '')).trim(),
        startDate,
        endDate: String(d?.endDate ?? '').trim() || startDate,
        status: String(d?.status ?? 'booking-open').trim() || 'booking-open',
        offers,
      };
    })
    .filter((b) => b.startDate && b.offers.length > 0);

  return { occupancyCatalog, batches, errors };
}

export interface GalleryImage {
  image: string;
  width: number | null;
  height: number | null;
  source: 'album' | 'trip';
}

// Parse the trip editor's serialized gallery (album-picked + trip-only uploads).
// Validates each entry has an image URL; coerces dims to numbers or null. Caps
// album-sourced images at 10 (trip-only uploads are unlimited). Shared by the
// create + update API routes.
export function parseGallery(galleryJson: unknown): GalleryImage[] {
  let raw: any[] = [];
  try { raw = JSON.parse(typeof galleryJson === 'string' ? galleryJson : '[]'); } catch { /* ignore */ }
  if (!Array.isArray(raw)) return [];

  let albumCount = 0;
  const out: GalleryImage[] = [];
  for (const g of raw) {
    const image = String(g?.image ?? '').trim();
    if (!image) continue;
    const source: 'album' | 'trip' = g?.source === 'trip' ? 'trip' : 'album';
    if (source === 'album') {
      if (albumCount >= 10) continue;
      albumCount++;
    }
    const w = Number(g?.width);
    const h = Number(g?.height);
    out.push({
      image,
      width: Number.isFinite(w) && w > 0 ? w : null,
      height: Number.isFinite(h) && h > 0 ? h : null,
      source,
    });
  }
  return out;
}
