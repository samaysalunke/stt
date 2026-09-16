/**
 * Repairs `geocode_cache`, which feeds both the leaderboard's km column and the
 * pins on public profile maps.
 *
 * Two jobs, in order:
 *
 *  1. Purge entries that landed outside India. Nominatim searched the whole
 *     planet, so typos resolved to wherever the best fuzzy match happened to
 *     be — "banglore" to Karachi, "hyderbad" to Cincinnati, "nomad" to
 *     Manhattan. Every trip is in India and every registration so far declares
 *     India, so anything outside the box is wrong by construction. This rule
 *     stops being safe the day a traveller books from abroad; it is a one-off
 *     repair, deliberately not a recurring job.
 *
 *  2. Geocode every city and trip location that has no entry yet. The live path
 *     only geocodes when a booking is created or confirmed, so the cities of
 *     everyone who booked before that existed were never looked up at all —
 *     which is why travellers with real trips were sitting on 0 km.
 *
 * Mirrors src/lib/geocode.ts and reads the same geocodeTables.json. Run
 * `npm run backfill:profile-stats -- --all` afterwards to turn the new
 * coordinates into leaderboard rows.
 *
 * Usage: node scripts/warm-geocode-cache.mjs [--dry-run]
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const db = new Database(path.join(process.env.DATA_DIR ?? path.join(root, 'data'), 'seekthethrill.db'));
const tripsDir = path.join(process.env.CONTENT_DIR ?? path.join(root, 'src', 'content'), 'trips');
const tables = JSON.parse(fs.readFileSync(path.join(root, 'src', 'lib', 'geocodeTables.json'), 'utf8'));
const dryRun = process.argv.includes('--dry-run');

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'SeekTheThrill/1.0 (samaysalunke@gmail.com)';
// Rounded outward from mainland India plus the island territories.
const INDIA_BOX = { minLat: 6, maxLat: 37.5, minLng: 68, maxLng: 97.5 };
const inIndia = (r) => r.lat >= INDIA_BOX.minLat && r.lat <= INDIA_BOX.maxLat
  && r.lng >= INDIA_BOX.minLng && r.lng <= INDIA_BOX.maxLng;

const key = (s) => String(s ?? '').trim().toLowerCase();
const countryCode = (c) => (key(c) ? tables.countryCodes[key(c)] : tables.defaultCountryCode);

let lastFetchAt = 0;
async function nominatim(query, cc) {
  const wait = 1100 - (Date.now() - lastFetchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  try {
    const params = new URLSearchParams({ q: query, format: 'json', limit: '1', addressdetails: '0' });
    if (cc) params.set('countrycodes', cc);
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.length) return null;
    const lat = parseFloat(data[0].lat), lng = parseFloat(data[0].lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, name: data[0].display_name } : null;
  } catch { return null; }
}

// ---- 1. purge ----------------------------------------------------------
const purged = [];
for (const row of db.prepare('SELECT query, lat, lng FROM geocode_cache').all()) {
  if (inIndia(row)) continue;
  purged.push(row);
  if (!dryRun) db.prepare('DELETE FROM geocode_cache WHERE query = ?').run(row.query);
}
for (const p of purged) console.log(`[geocode] ${dryRun ? 'would purge' : 'purged'} "${p.query}" -> ${p.lat.toFixed(2)},${p.lng.toFixed(2)} (outside India)`);

// ---- 2. collect every query the stats path will ask for ----------------
const wanted = new Map(); // key -> country for the bias
for (const r of db.prepare(`SELECT city, country FROM registrations WHERE status='confirmed'`).all()) {
  if (key(r.city)) wanted.set(key(r.city), r.country);
}
const loadTrip = (slug) => {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  try { return YAML.parse(fs.readFileSync(path.join(tripsDir, `${slug}.yaml`), 'utf8')); } catch { return null; }
};
const slugByTitle = new Map();
const deleted = (() => { try { return new Set(db.prepare('SELECT slug FROM deleted_trips').all().map((r) => r.slug)); } catch { return new Set(); } })();
try {
  for (const f of fs.readdirSync(tripsDir).filter((f) => f.endsWith('.yaml'))) {
    const slug = f.replace(/\.yaml$/, '');
    if (deleted.has(slug)) continue;
    const t = loadTrip(slug)?.title ?? loadTrip(slug)?.name;
    if (t && !slugByTitle.has(String(t))) slugByTitle.set(String(t), slug);
  }
} catch { /* no trips dir */ }
for (const r of db.prepare(`SELECT DISTINCT trip_name, trip_slug FROM registrations WHERE status='confirmed'`).all()) {
  const trip = loadTrip(r.trip_slug ?? slugByTitle.get(String(r.trip_name ?? '')));
  const loc = key(trip?.location ?? r.trip_name);
  // A trip location is Indian whoever booked it.
  if (loc) wanted.set(loc, 'India');
}

// On a real run the purge above has already deleted these, so they read as
// uncached and get looked up again. A dry run has to subtract them by hand,
// or it reports a purged entry as still covered.
const purgedKeys = new Set(purged.map((p) => p.query));
const missing = [...wanted].filter(([q]) =>
  purgedKeys.has(q) || !db.prepare('SELECT 1 FROM geocode_cache WHERE query=?').get(q));
console.log(`\n[geocode] ${wanted.size} distinct queries in play, ${missing.length} not cached`);
if (dryRun) {
  for (const [q, c] of missing) console.log(`[geocode] would look up "${tables.queryOverrides[q] ?? q}"${tables.queryOverrides[q] ? ` (for "${q}")` : ''} in ${countryCode(c) ?? 'any country'}`);
  console.log(JSON.stringify({ dryRun: true, purged: purged.length, wouldLookUp: missing.length }));
  db.close();
  process.exit(0);
}

let resolved = 0, unresolved = 0;
for (const [q, country] of missing) {
  const hit = await nominatim(tables.queryOverrides[q] ?? q, countryCode(country));
  if (hit) {
    db.prepare('INSERT OR REPLACE INTO geocode_cache (query,lat,lng,fetchedAt) VALUES (?,?,?,unixepoch())').run(q, hit.lat, hit.lng);
    try { db.prepare('DELETE FROM geocode_failures WHERE query=?').run(q); } catch {}
    resolved++;
    console.log(`  OK   ${q.padEnd(28)} -> ${hit.lat.toFixed(2)},${hit.lng.toFixed(2)}  ${String(hit.name ?? '').slice(0, 55)}`);
  } else {
    try {
      db.prepare(`INSERT INTO geocode_failures (query,attempts,lastAttemptAt) VALUES (?,1,unixepoch())
        ON CONFLICT(query) DO UPDATE SET attempts=attempts+1, lastAttemptAt=unixepoch()`).run(q);
    } catch {}
    unresolved++;
    console.log(`  MISS ${q}`);
  }
}
console.log(JSON.stringify({ purged: purged.length, resolved, unresolved }));
db.close();
