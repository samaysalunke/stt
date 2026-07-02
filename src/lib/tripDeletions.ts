import { getDb } from './db';
import { logAction } from './audit';

/** Slugs of trips that are soft-deleted (hidden but recoverable). */
export function listDeletedSlugs(): Set<string> {
  const rows = getDb().prepare('SELECT slug FROM deleted_trips').all() as Array<{ slug: string }>;
  return new Set(rows.map((r) => r.slug));
}

export function isTripDeleted(slug: string): boolean {
  return !!getDb().prepare('SELECT 1 FROM deleted_trips WHERE slug=?').get(slug);
}

/**
 * Soft-delete a trip: mark it deleted in the DB. The YAML file and its images
 * are intentionally left on disk so the trip can be restored by deleting the
 * row (`DELETE FROM deleted_trips WHERE slug=?`).
 */
export function softDeleteTrip(
  slug: string,
  actor?: { actorUserId?: string | null; actorEmail?: string | null; actorRole?: string | null },
): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO deleted_trips (slug, actorEmail, actorRole) VALUES (?, ?, ?)')
    .run(slug, actor?.actorEmail ?? null, actor?.actorRole ?? null);
  logAction({
    actorUserId: actor?.actorUserId,
    actorEmail: actor?.actorEmail,
    actorRole: actor?.actorRole,
    action: 'trip.delete',
    targetType: 'trip',
    targetId: slug,
  });
}
