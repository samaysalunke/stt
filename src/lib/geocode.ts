import { getDb } from './db';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'SeekTheThrill/1.0 (samaysalunke@gmail.com)';

// Module-level rate limiter — Nominatim requires max 1 req/sec
let lastFetchAt = 0;

async function nominatimFetch(query: string): Promise<{ lat: number; lng: number } | null> {
  const wait = 1100 - (Date.now() - lastFetchAt);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastFetchAt = Date.now();

  try {
    const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=0`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

export async function geocodeCity(city: string): Promise<{ lat: number; lng: number } | null> {
  if (!city?.trim()) return null;
  const key = city.trim().toLowerCase();

  const db = getDb();
  const cached = db
    .prepare('SELECT lat, lng FROM geocode_cache WHERE query = ?')
    .get(key) as { lat: number; lng: number } | undefined;
  if (cached) return { lat: cached.lat, lng: cached.lng };

  const result = await nominatimFetch(key);
  if (result) {
    try {
      db.prepare(
        'INSERT OR REPLACE INTO geocode_cache (query, lat, lng, fetchedAt) VALUES (?, ?, ?, unixepoch())'
      ).run(key, result.lat, result.lng);
    } catch { /* non-fatal */ }
  }
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
