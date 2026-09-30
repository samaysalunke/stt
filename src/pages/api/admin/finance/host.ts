import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { requireRole } from '../../../../lib/requireRole';
import { jsonOk, jsonFail } from '../../../../lib/apiResponse';
import { logAction } from '../../../../lib/audit';
import { sanitizeInput } from '../../../../lib/utils';
import {
  listDepartureMeta,
  parseRupees,
  readDepartureCost,
} from '../../../../lib/departureFinance';

// The trip host's fee for one departure: a flat amount on top of the cost price
// (base + items), counted only while `enabled` is on. Owner-only, same as
// cost.ts — middleware gates the /api/admin/finance prefix too.
//
// PUT upserts amount + toggle together. Turning the toggle off keeps the amount,
// so it can be switched back on without re-entry. DELETE removes the row.

function departureExists(tripSlug: string, batchId: string): boolean {
  return listDepartureMeta().some((d) => d.tripSlug === tripSlug && d.batchId === batchId);
}

function identify(body: any): { tripSlug: string; batchId: string } | null {
  const tripSlug = sanitizeInput(body?.tripSlug);
  const batchId = sanitizeInput(body?.batchId);
  if (!tripSlug || !batchId) return null;
  return { tripSlug, batchId };
}

export const PUT: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner']);
  if (denied) return denied;

  try {
    const body = await request.json();
    const id = identify(body);
    if (!id) return jsonFail('A trip and departure are required.');

    if (!departureExists(id.tripSlug, id.batchId)) {
      return jsonFail('That departure no longer exists.', 404);
    }

    const amount = parseRupees(body.amount, { min: 0 });
    if (amount === null) {
      return jsonFail('Enter the host cost as a whole rupee amount of zero or more.');
    }
    if (typeof body.enabled !== 'boolean') {
      return jsonFail('Say whether the host cost is included.');
    }
    const enabled = body.enabled;

    const db = getDb();
    const before = readDepartureCost(id.tripSlug, id.batchId, db);
    db.prepare(`
      INSERT INTO departure_host_costs (trip_slug, batch_id, amount, enabled, updated_by_email)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(trip_slug, batch_id) DO UPDATE SET
        amount = excluded.amount,
        enabled = excluded.enabled,
        updated_at = CURRENT_TIMESTAMP,
        updated_by_email = excluded.updated_by_email
    `).run(id.tripSlug, id.batchId, amount, enabled ? 1 : 0, locals.adminUser?.email ?? null);

    logAction({
      actorUserId: locals.adminUser?.userId,
      actorEmail: locals.adminUser?.email,
      actorRole: locals.adminUser?.role,
      action: 'departure_cost.host_set',
      targetType: 'departure',
      targetId: `${id.tripSlug}:${id.batchId}`,
      previousValue: before.host,
      newValue: { amount, enabled },
    });

    // Echo the stored (rounded) value so the input shows what was actually saved.
    return jsonOk({ success: true, cost: readDepartureCost(id.tripSlug, id.batchId, db) });
  } catch {
    return jsonFail('Could not save the host cost.', 500);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner']);
  if (denied) return denied;

  try {
    const body = await request.json();
    const id = identify(body);
    if (!id) return jsonFail('A trip and departure are required.');
    // No existence check: an orphaned host row must stay removable.

    const db = getDb();
    const before = readDepartureCost(id.tripSlug, id.batchId, db);
    if (!before.host.hasRow) return jsonFail('There is no host cost recorded for that departure.', 404);

    db.prepare('DELETE FROM departure_host_costs WHERE trip_slug = ? AND batch_id = ?').run(id.tripSlug, id.batchId);

    logAction({
      actorUserId: locals.adminUser?.userId,
      actorEmail: locals.adminUser?.email,
      actorRole: locals.adminUser?.role,
      action: 'departure_cost.host_cleared',
      targetType: 'departure',
      targetId: `${id.tripSlug}:${id.batchId}`,
      previousValue: before.host,
      newValue: null,
    });

    return jsonOk({ success: true, cost: readDepartureCost(id.tripSlug, id.batchId, db) });
  } catch {
    return jsonFail('Could not clear the host cost.', 500);
  }
};
