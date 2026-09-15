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

// The base operating cost of one departure. Owner-only: vendor rates and margins
// are a different sensitivity class from the booking payments ops already
// handles. Middleware gates the whole /api/admin/finance prefix to owner too —
// this is the second layer, per the convention in requireRole.ts.
//
// PUT upserts, DELETE clears. DELETE matters more than it looks: a departure
// with no base row and no items reads as "not costed", while a row holding an
// explicit 0 reads as costed at zero (a comped departure, 100% margin). Those
// are different states, so there has to be a way back to the first one.

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

    // Refuse to write against a departure that does not exist, so a typo cannot
    // mint an orphan cost row that nothing will ever reconcile.
    if (!departureExists(id.tripSlug, id.batchId)) {
      return jsonFail('That departure no longer exists.', 404);
    }

    const baseAmount = parseRupees(body.baseAmount, { min: 0 });
    if (baseAmount === null) {
      return jsonFail('Enter the operating cost as a whole rupee amount of zero or more.');
    }
    const note = sanitizeInput(body.note).slice(0, 500) || null;

    const db = getDb();
    const before = readDepartureCost(id.tripSlug, id.batchId, db);
    db.prepare(`
      INSERT INTO departure_costs (trip_slug, batch_id, base_amount, note, updated_by_email)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(trip_slug, batch_id) DO UPDATE SET
        base_amount = excluded.base_amount,
        note = excluded.note,
        updated_at = CURRENT_TIMESTAMP,
        updated_by_email = excluded.updated_by_email
    `).run(id.tripSlug, id.batchId, baseAmount, note, locals.adminUser?.email ?? null);

    logAction({
      actorUserId: locals.adminUser?.userId,
      actorEmail: locals.adminUser?.email,
      actorRole: locals.adminUser?.role,
      action: 'departure_cost.set',
      targetType: 'departure',
      targetId: `${id.tripSlug}:${id.batchId}`,
      previousValue: { base: before.base, hasBaseRow: before.hasBaseRow, note: before.note },
      newValue: { base: baseAmount, note },
    });

    // Echo the stored (rounded) value so the input shows what was actually saved.
    return jsonOk({ success: true, cost: readDepartureCost(id.tripSlug, id.batchId, db) });
  } catch {
    return jsonFail('Could not save the operating cost.', 500);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner']);
  if (denied) return denied;

  try {
    const body = await request.json();
    const id = identify(body);
    if (!id) return jsonFail('A trip and departure are required.');
    // Deliberately no existence check: an orphan is precisely a cost row whose
    // departure is gone, and it must stay purgeable.
    const purgeItems = body.purgeItems === true;

    const db = getDb();
    const before = readDepartureCost(id.tripSlug, id.batchId, db);
    if (!before.costed) return jsonFail('There is nothing recorded for that departure.', 404);

    db.transaction(() => {
      db.prepare('DELETE FROM departure_costs WHERE trip_slug = ? AND batch_id = ?').run(id.tripSlug, id.batchId);
      if (purgeItems) {
        db.prepare('DELETE FROM departure_cost_items WHERE trip_slug = ? AND batch_id = ?').run(id.tripSlug, id.batchId);
      }
    })();

    logAction({
      actorUserId: locals.adminUser?.userId,
      actorEmail: locals.adminUser?.email,
      actorRole: locals.adminUser?.role,
      action: purgeItems ? 'departure_cost.purged' : 'departure_cost.cleared',
      targetType: 'departure',
      targetId: `${id.tripSlug}:${id.batchId}`,
      // The whole prior state, so the audit log doubles as the undo record.
      previousValue: { base: before.base, note: before.note, items: before.items },
      newValue: null,
    });

    return jsonOk({ success: true, cost: readDepartureCost(id.tripSlug, id.batchId, db) });
  } catch {
    return jsonFail('Could not clear the operating cost.', 500);
  }
};
