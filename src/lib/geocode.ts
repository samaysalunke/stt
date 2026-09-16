import { getDb } from './db';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'SeekTheThrill/1.0 (samaysalunke@gmail.com)';

/**
 * Place names that Nominatim resolves badly or not at all, the country codes
 * we bias by, and the default — all in `geocodeTables.json`, so that the
 * repair script reads the same tables rather than its own copy.
 *
 * Two kinds of override live there, and both were found in live data:
 *
 *  - Our own trip locations. "Kashmir" resolves to a village in Barmer,
 *    Rajasthan — 900km from the valley — and "Mulki & Agumbe, Karnataka"
 *    resolves to nothing, because the ampersand names two places at once.
 *  - Spellings travellers actually type into the city field. These matter more
 *    than they look: the same coordinates place the pins on a public profile
 *    map, so a bad match is visible, not just arithmetic.
 *
 * The cache is still keyed by what was asked for, so callers and the map look
 * up the original string.
 *
 * Nominatim searches the whole planet and ranks by relevance, so a typo lands
 * wherever the best fuzzy match happens to be: "banglore" returned Banglore
 * Town in Karachi, "hyderbad" a restaurant in Cincinnati, "nomad" the NoMad
 * district of Manhattan. Restricting to the country the traveller gave keeps a
 * misspelling wrong by a district rather than by a continent.
 */
import tables from './geocodeTables.json';

const QUERY_OVERRIDES = tables.queryOverrides as Record<string, string>;
const COUNTRY_CODES = tables.countryCodes as Record<string, string>;

/** Every trip is in India and every traveller so far has declared India. */
const DEFAULT_COUNTRY_CODE = tables.defaultCountryCode;

export function countryCodeFor(country?: string | null): string | undefined {
  const key = String(country ?? '').trim().toLowerCase();
  if (!key) return DEFAULT_COUNTRY_CODE;
  return COUNTRY_CODES[key];
}

/** A lookup that found nothing is retried, but not on every recalculation. */
const FAILURE_RETRY_S = 7 * 24 * 60 * 60;

// Module-level rate limiter — Nominatim requires max 1 req/sec
let lastFetchAt = 0;

async function nominatimFetch(
  query: string,
  countryCode?: string,
): Promise<{ lat: number; lng: number } | null> {
  const wait = 1100 - (Date.now() - lastFetchAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastFetchAt = Date.now();

  try {
    const params = new URLSearchParams({ q: query, format: 'json', limit: '1', addressdetails: '0' });
    if (countryCode) params.set('countrycodes', countryCode);
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!data.length) return null;
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export async function geocodeCity(
  city: string,
  opts: { country?: string | null } = {},
): Promise<{ lat: number; lng: number } | null> {
  if (!city?.trim()) return null;
  const key = city.trim().toLowerCase();

  const db = getDb();
  const cached = db
    .prepare('SELECT lat, lng FROM geocode_cache WHERE query = ?')
    .get(key) as { lat: number; lng: number } | undefined;
  if (cached) return { lat: cached.lat, lng: cached.lng };

  // A miss used to be forgotten immediately, so every unresolvable city — and
  // there are plenty, the field is free text — hit the network again on every
  // single recalculation, spending the 1 req/sec budget on queries already
  // known to fail.
  const failed = db
    .prepare('SELECT lastAttemptAt FROM geocode_failures WHERE query = ?')
    .get(key) as { lastAttemptAt: number } | undefined;
  if (failed && Date.now() / 1000 - failed.lastAttemptAt < FAILURE_RETRY_S) return null;

  const result = await nominatimFetch(QUERY_OVERRIDES[key] ?? key, countryCodeFor(opts.country));

  try {
    if (result) {
      db.prepare(
        'INSERT OR REPLACE INTO geocode_cache (query, lat, lng, fetchedAt) VALUES (?, ?, ?, unixepoch())'
      ).run(key, result.lat, result.lng);
      db.prepare('DELETE FROM geocode_failures WHERE query = ?').run(key);
    } else {
      db.prepare(`
        INSERT INTO geocode_failures (query, attempts, lastAttemptAt) VALUES (?, 1, unixepoch())
        ON CONFLICT(query) DO UPDATE SET attempts = attempts + 1, lastAttemptAt = unixepoch()
      `).run(key);
    }
  } catch { /* non-fatal */ }
  return result;
}

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
