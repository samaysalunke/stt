import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const root = process.cwd();
const db = new Database(path.join(process.env.DATA_DIR ?? path.join(root, 'data'), 'seekthethrill.db'));
const tripsDir = path.join(process.env.CONTENT_DIR ?? path.join(root, 'src', 'content'), 'trips');
const candidates = db.prepare(`
  SELECT id, email, displayName, username, avatarUrl, homeCityLatLng
  FROM users u WHERE NOT EXISTS (SELECT 1 FROM leaderboard_cache c WHERE c.userId=u.id)
`).all();
const loadTrip = (slug) => {
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) return null;
  try { return YAML.parse(fs.readFileSync(path.join(tripsDir, `${slug}.yaml`), 'utf8')); } catch { return null; }
};
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
let processed=0, failed=0;
for (const user of candidates) {
  try {
    const regs=db.prepare("SELECT city,trip_name,trip_slug,batch_id FROM registrations WHERE lower(trim(email))=lower(trim(?)) AND status='confirmed'").all(user.email);
    let kms=0, outdoorDays=0; const destinations=new Set();
    for (const reg of regs) {
      const trip=loadTrip(reg.trip_slug); const location=String(trip?.location ?? reg.trip_name ?? '').trim();
      if (location) destinations.add(location.toLowerCase());
      const home=cachedCoords(reg.city), dest=cachedCoords(location); if(home&&dest) kms+=distance(home,dest);
      const batch=Array.isArray(trip?.batches)?trip.batches.find((b)=>String(b.id)===String(reg.batch_id)):null;
      if(batch) outdoorDays+=days(batch.startDate,batch.endDate);
    }
    upsert.run(user.id,user.email,user.displayName,user.username,user.avatarUrl,user.homeCityLatLng,Math.round(kms),outdoorDays,destinations.size,regs.length);
    processed++;
  } catch (error) { failed++; console.error(`[profile-stats] ${user.id}:`, error); }
}
console.log(JSON.stringify({ candidates:candidates.length, processed, failed }));
db.close();
if (failed) process.exitCode=1;
