import { getDb } from './db';
import { geocodeCity, haversine } from './geocode';
import { listTrips, readTrip } from './content';

interface RegRow {
  city: string;
  trip_name: string;
  trip_slug: string | null;
  batch_id: string | null;
}

function findTripSlug(tripName: string): string | null {
  try {
    const trips = listTrips();
    return trips.find((t: any) => (t.title || t.name) === tripName)?.slug ?? null;
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
    const slug = reg.trip_slug ?? findTripSlug(reg.trip_name);
    if (!slug) continue;

    const trip = readTrip(slug);
    const tripLocation = (trip?.location as string | undefined) ?? reg.trip_name;

    // Sequential geocode calls to respect Nominatim 1 req/sec limit
    const homeCoords = await geocodeCity(reg.city);
    const destCoords = await geocodeCity(tripLocation);

    if (homeCoords && destCoords) {
      kmsFromHome += haversine(homeCoords.lat, homeCoords.lng, destCoords.lat, destCoords.lng);
    }

    if (reg.batch_id) daysOutdoors += batchDays(slug, reg.batch_id);

    if (tripLocation) destinations.add(tripLocation.toLowerCase().trim());
  }

  return {
    kmsFromHome: Math.round(kmsFromHome),
    daysOutdoors,
    destinationsCount: destinations.size,
    tripsCount: regs.length,
  };
}

export async function recalculateUserLeaderboard(email: string): Promise<void> {
  const db = getDb();

  const user = db
    .prepare(
      'SELECT id, email, displayName, username, avatarUrl, homeCityLatLng, leaderboardOptOut FROM users WHERE email = ?'
    )
    .get(email) as {
      id: string;
      email: string;
      displayName: string | null;
      username: string | null;
      avatarUrl: string | null;
      homeCityLatLng: string | null;
      leaderboardOptOut: number;
    } | undefined;

  if (!user) return;

  if (user.leaderboardOptOut) {
    db.prepare('DELETE FROM leaderboard_cache WHERE userId = ?').run(user.id);
    return;
  }

  const regs = db
    .prepare(
      "SELECT city, trip_name, trip_slug, batch_id FROM registrations WHERE email = ? AND status = 'confirmed'"
    )
    .all(email) as RegRow[];

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
      "SELECT city FROM registrations WHERE email = ? AND status = 'confirmed' ORDER BY created_at DESC LIMIT 1"
    )
    .get(email) as { city: string } | undefined;

  if (lastReg?.city) {
    const coords = await geocodeCity(lastReg.city);
    if (coords) {
      const latLng = JSON.stringify({ lat: coords.lat, lng: coords.lng, city: lastReg.city });
      db.prepare('UPDATE users SET homeCityLatLng = ? WHERE id = ?').run(latLng, user.id);
      db.prepare('UPDATE leaderboard_cache SET homeCityLatLng = ? WHERE userId = ?').run(latLng, user.id);
    }
  }
}
