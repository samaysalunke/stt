import { getDb } from './db';
import { geocodeCity, haversine } from './geocode';
import { findTripByName, readTrip } from './content';

interface RegRow {
  city: string;
  trip_name: string;
  trip_slug: string | null;
  batch_id: string | null;
}

function findTripSlug(tripName: string): string | null {
  try {
    return findTripByName(tripName)?.slug ?? null;
  } catch {
    return null;
  }
}

function readTripSafe(slug: string) {
  try {
    return readTrip(slug);
  } catch {
    return null;
  }
}

function batchDays(tripSlug: string, batchId: string): number {
  try {
    const trip = readTrip(tripSlug);
    const batch = (trip?.batches as any[])?.find((b: any) => b.id === batchId);
    if (!batch?.startDate || !batch?.endDate) return 0;
    const ms = new Date(batch.endDate).getTime() - new Date(batch.startDate).getTime();
    return Math.max(0, Math.round(ms / 86_400_000) + 1);
  } catch {
    return 0;
  }
}

async function computeStats(regs: RegRow[]) {
  let kmsFromHome = 0;
  let daysOutdoors = 0;
  const destinations = new Set<string>();

  for (const reg of regs) {
    // A registration whose trip title no longer matches any YAML (the title was
    // edited after the booking, and trip_slug predates that column) used to be
    // skipped outright — it still counted towards tripsCount, so a traveller
    // showed up with N trips and nothing to show for them. Fall back to the
    // booked trip name, exactly as the backfill script does.
    const slug = reg.trip_slug ?? findTripSlug(reg.trip_name);
    const trip = slug ? readTripSafe(slug) : null;
    const tripLocation = ((trip?.location as string | undefined) ?? reg.trip_name ?? '').trim();

    // Sequential geocode calls to respect Nominatim 1 req/sec limit
    const homeCoords = await geocodeCity(reg.city);
    const destCoords = await geocodeCity(tripLocation);

    if (homeCoords && destCoords) {
      kmsFromHome += haversine(homeCoords.lat, homeCoords.lng, destCoords.lat, destCoords.lng);
    }

    if (slug && reg.batch_id) daysOutdoors += batchDays(slug, reg.batch_id);

    if (tripLocation) destinations.add(tripLocation.toLowerCase());
  }

  return {
    kmsFromHome: Math.round(kmsFromHome),
    daysOutdoors,
    destinationsCount: destinations.size,
    tripsCount: regs.length,
  };
}

// Callers pass whatever email the booking or session carried, and the two
// tables disagree on casing often enough that both carry a lower(trim(email))
// index. Matching on that normalised form throughout is what keeps a traveller
// who booked as Priya@Gmail.com and signed in as priya@gmail.com from showing
// an empty leaderboard row.
export async function recalculateUserLeaderboard(email: string): Promise<void> {
  const db = getDb();

  const user = db
    .prepare(
      'SELECT id, email, displayName, username, avatarUrl, homeCityLatLng FROM users WHERE lower(trim(email)) = lower(trim(?))'
    )
    .get(email) as {
      id: string;
      email: string;
      displayName: string | null;
      username: string | null;
      avatarUrl: string | null;
      homeCityLatLng: string | null;
    } | undefined;

  if (!user) return;

  const regs = db
    .prepare(
      "SELECT city, trip_name, trip_slug, batch_id FROM registrations WHERE lower(trim(email)) = lower(trim(?)) AND status = 'confirmed'"
    )
    .all(user.email) as RegRow[];

  const stats = await computeStats(regs);

  db.prepare(`
    INSERT OR REPLACE INTO leaderboard_cache
      (userId, email, displayName, username, avatarUrl, homeCityLatLng, kmsFromHome, daysOutdoors, destinationsCount, tripsCount, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
  `).run(
    user.id,
    user.email,
    user.displayName,
    user.username,
    user.avatarUrl,
    user.homeCityLatLng,
    stats.kmsFromHome,
    stats.daysOutdoors,
    stats.destinationsCount,
    stats.tripsCount,
  );

  // Keep homeCityLatLng updated to most recent confirmed booking city
  const lastReg = db
    .prepare(
      "SELECT city FROM registrations WHERE lower(trim(email)) = lower(trim(?)) AND status = 'confirmed' ORDER BY created_at DESC LIMIT 1"
    )
    .get(user.email) as { city: string } | undefined;

  if (lastReg?.city) {
    const coords = await geocodeCity(lastReg.city);
    if (coords) {
      const latLng = JSON.stringify({ lat: coords.lat, lng: coords.lng, city: lastReg.city });
      db.prepare('UPDATE users SET homeCityLatLng = ? WHERE id = ?').run(latLng, user.id);
      db.prepare('UPDATE leaderboard_cache SET homeCityLatLng = ? WHERE userId = ?').run(latLng, user.id);
    }
  }
}
