import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const db = new Database(path.join(process.env.DATA_DIR ?? path.join(root, 'data'), 'seekthethrill.db'));
const tripsDir = path.join(process.env.CONTENT_DIR ?? path.join(root, 'src', 'content'), 'trips');
// Default: only users with no cache row at all. With --all, recompute everyone —
// the cache is otherwise only refreshed when a booking is created or confirmed,
// so a row that went stale (a trip renamed, a location added to a YAML) stays
// wrong indefinitely and there is no other way to repair it.
const recomputeAll = process.argv.includes('--all');
// --dry-run reports what would change and writes nothing. Worth having: --all
// rewrites rows that are already serving the public leaderboard.
const dryRun = process.argv.includes('--dry-run');
const candidates = db.prepare(`
  SELECT id, email, displayName, username, avatarUrl, homeCityLatLng
  FROM users u ${recomputeAll ? '' : 'WHERE NOT EXISTS (SELECT 1 FROM leaderboard_cache c WHERE c.userId=u.id)'}
`).all();
const existing = db.prepare('SELECT kmsFromHome,daysOutdoors,destinationsCount,tripsCount FROM leaderboard_cache WHERE userId=?');
const loadTrip = (slug) => {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  try { return YAML.parse(fs.readFileSync(path.join(tripsDir, `${slug}.yaml`), 'utf8')); } catch { return null; }
};

// trip_slug is a late-added column, so older registrations only carry the trip
// title they were booked under. stats.ts resolves those through findTripByName;
// mirror it here (same exact-title match, same exclusion of soft-deleted trips)
// so a --all repair run agrees with the live recalc instead of fighting it.
const deletedSlugs = (() => {
  try { return new Set(db.prepare('SELECT slug FROM deleted_trips').all().map((r) => r.slug)); }
  catch { return new Set(); }
})();
const slugByTitle = new Map();
try {
  for (const file of fs.readdirSync(tripsDir).filter((f) => f.endsWith('.yaml'))) {
    const slug = file.replace(/\.yaml$/, '');
    if (deletedSlugs.has(slug)) continue;
    const data = loadTrip(slug);
    const title = data?.title ?? data?.name;
    if (title && !slugByTitle.has(String(title))) slugByTitle.set(String(title), slug);
  }
} catch { /* no trips dir — every reg falls back to its booked name */ }
const resolveSlug = (reg) => reg.trip_slug ?? slugByTitle.get(String(reg.trip_name ?? '')) ?? null;
const dateOnly = (value) => typeof value === 'string' ? value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null : null;
const days = (start, end) => {
  const a = dateOnly(start), b = dateOnly(end); if (!a || !b) return 0;
  return Math.max(0, Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000) + 1);
};
const radians = (n) => n * Math.PI / 180;
const distance = (a, b) => {
  const dLat=radians(b.lat-a.lat), dLng=radians(b.lng-a.lng);
  const h=Math.sin(dLat/2)**2+Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(dLng/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
};
const cachedCoords = (query) => query ? db.prepare('SELECT lat,lng FROM geocode_cache WHERE query=?').get(String(query).trim().toLowerCase()) : null;
const upsert = db.prepare(`INSERT OR REPLACE INTO leaderboard_cache
  (userId,email,displayName,username,avatarUrl,homeCityLatLng,kmsFromHome,daysOutdoors,destinationsCount,tripsCount,updatedAt)
  VALUES (?,?,?,?,?,?,?,?,?,?,unixepoch())`);
let processed=0, failed=0, kmsPreserved=0; const changes=[];
for (const user of candidates) {
  try {
    const regs=db.prepare("SELECT city,trip_name,trip_slug,batch_id FROM registrations WHERE lower(trim(email))=lower(trim(?)) AND status='confirmed'").all(user.email);
    let kms=0, outdoorDays=0, geocodeMissed=false; const destinations=new Set();
    for (const reg of regs) {
      const slug=resolveSlug(reg); const trip=loadTrip(slug);
      const location=String(trip?.location ?? reg.trip_name ?? '').trim();
      if (location) destinations.add(location.toLowerCase());
      const home=cachedCoords(reg.city), dest=cachedCoords(location);
      if(home&&dest) kms+=distance(home,dest); else geocodeMissed=true;
      const batch=Array.isArray(trip?.batches)?trip.batches.find((b)=>String(b.id)===String(reg.batch_id)):null;
      if(batch) outdoorDays+=days(batch.startDate,batch.endDate);
    }
    // This script geocodes from the local cache only, never the network, so a
    // cache miss yields a km total that is too low rather than wrong-by-a-little.
    // Destinations, days and trips come from content and the DB and are always
    // safe to rewrite; km is only written when every leg resolved, otherwise the
    // stored value (computed live, with network geocoding) is kept.
    const prior = existing.get(user.id);
    const kmsToWrite = geocodeMissed && prior ? prior.kmsFromHome : Math.round(kms);
    if (geocodeMissed && prior) kmsPreserved++;
    const next={kmsFromHome:kmsToWrite,daysOutdoors:outdoorDays,destinationsCount:destinations.size,tripsCount:regs.length};
    const diff=Object.keys(next).filter((k)=>!prior||Math.round(prior[k]??0)!==Math.round(next[k]));
    if (diff.length) changes.push({ userId:user.id, email:user.email, new:prior?undefined:true,
      ...Object.fromEntries(diff.map((k)=>[k, prior?`${Math.round(prior[k]??0)} -> ${Math.round(next[k])}`:Math.round(next[k])])) });
    if (!dryRun) upsert.run(user.id,user.email,user.displayName,user.username,user.avatarUrl,user.homeCityLatLng,kmsToWrite,outdoorDays,destinations.size,regs.length);
    processed++;
  } catch (error) { failed++; console.error(`[profile-stats] ${user.id}:`, error); }
}
for (const c of changes) console.log(`[profile-stats] ${dryRun?'would update':'updated'} ${JSON.stringify(c)}`);
console.log(JSON.stringify({ mode:recomputeAll?'all':'missing-only', dryRun, candidates:candidates.length, processed, changed:changes.length, kmsPreserved, failed }));
db.close();
if (failed) process.exitCode=1;
