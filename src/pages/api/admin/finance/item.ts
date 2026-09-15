import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { requireRole } from '../../../../lib/requireRole';
import { jsonOk, jsonFail } from '../../../../lib/apiResponse';
import { logAction } from '../../../../lib/audit';
import { sanitizeInput } from '../../../../lib/utils';
import {
  listDepartureMeta,
  parseItemLabel,
  parseRupees,
  readDepartureCost,
  MAX_LABEL_LENGTH,
} from '../../../../lib/departureFinance';

// Miscellaneous expenditure on a departure: any number of free-text line items
// on top of the base operating cost. Owner-only, same reasoning as cost.ts.
//
// Amounts may be NEGATIVE — a vendor credit, a recovered deposit, a supplier
// refund. Without that the owner has to quietly shave the base cost instead,
// which destroys the record of why the number moved. Zero is rejected: a ₹0
// line item is always a mistake.

function actor(locals: App.Locals) {
  return {
    actorUserId: locals.adminUser?.userId,
    actorEmail: locals.adminUser?.email,
    actorRole: locals.adminUser?.role,
  };
}

const AMOUNT_ERROR = 'Enter the amount as a whole rupee value. Use a negative amount for a credit.';

export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner']);
  if (denied) return denied;

  try {
    const body = await request.json();
    const tripSlug = sanitizeInput(body?.tripSlug);
    const batchId = sanitizeInput(body?.batchId);
    if (!tripSlug || !batchId) return jsonFail('A trip and departure are required.');

    // Same guard as cost.ts: a typo must not mint an orphan.
    if (!listDepartureMeta().some((d) => d.tripSlug === tripSlug && d.batchId === batchId)) {
      return jsonFail('That departure no longer exists.', 404);
    }

    const label = parseItemLabel(body.label);
    if (!label) return jsonFail(`Give the line item a name of up to ${MAX_LABEL_LENGTH} characters.`);
    const amount = parseRupees(body.amount, { allowZero: false });
    if (amount === null) return jsonFail(AMOUNT_ERROR);

    const db = getDb();
    const next = db.prepare(
      'SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM departure_cost_items WHERE trip_slug = ? AND batch_id = ?',
    ).get(tripSlug, batchId) as { n: number };
    const result = db.prepare(`
      INSERT INTO departure_cost_items (trip_slug, batch_id, label, amount, sort_order, updated_by_email)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tripSlug, batchId, label, amount, next.n, locals.adminUser?.email ?? null);

    logAction({
      ...actor(locals),
      action: 'departure_cost_item.added',
      targetType: 'departure',
      targetId: `${tripSlug}:${batchId}`,
      previousValue: null,
      newValue: { id: Number(result.lastInsertRowid), label, amount },
    });

    return jsonOk({ success: true, id: Number(result.lastInsertRowid), cost: readDepartureCost(tripSlug, batchId, db) });
  } catch {
    return jsonFail('Could not add the line item.', 500);
  }
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner']);
  if (denied) return denied;

  try {
    const body = await request.json();
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) return jsonFail('A valid line item id is required.');

    const db = getDb();
    const row = db.prepare('SELECT * FROM departure_cost_items WHERE id = ?').get(id) as any;
    if (!row) return jsonFail('Line item not found.', 404);

    const label = body.label === undefined ? String(row.label) : parseItemLabel(body.label);
    if (!label) return jsonFail(`Give the line item a name of up to ${MAX_LABEL_LENGTH} characters.`);
    const amount = body.amount === undefined ? Number(row.amount) : parseRupees(body.amount, { allowZero: false });
    if (amount === null) return jsonFail(AMOUNT_ERROR);

    db.prepare(`
      UPDATE departure_cost_items
      SET label = ?, amount = ?, updated_at = CURRENT_TIMESTAMP, updated_by_email = ?
      WHERE id = ?
    `).run(label, amount, locals.adminUser?.email ?? null, id);

    logAction({
      ...actor(locals),
      action: 'departure_cost_item.updated',
      targetType: 'departure',
      targetId: `${row.trip_slug}:${row.batch_id}`,
      previousValue: { id, label: row.label, amount: row.amount },
      newValue: { id, label, amount },
    });

    return jsonOk({ success: true, cost: readDepartureCost(row.trip_slug, row.batch_id, db) });
  } catch {
    return jsonFail('Could not update the line item.', 500);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner']);
  if (denied) return denied;

  try {
    const body = await request.json();
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) return jsonFail('A valid line item id is required.');

    const db = getDb();
    const row = db.prepare('SELECT * FROM departure_cost_items WHERE id = ?').get(id) as any;
    if (!row) return jsonFail('Line item not found.', 404);

    db.prepare('DELETE FROM departure_cost_items WHERE id = ?').run(id);

    logAction({
      ...actor(locals),
      action: 'departure_cost_item.deleted',
      targetType: 'departure',
      targetId: `${row.trip_slug}:${row.batch_id}`,
      // Full prior row — the audit log is the only history these numbers have.
      previousValue: { id, label: row.label, amount: row.amount, sortOrder: row.sort_order },
      newValue: null,
    });

    return jsonOk({ success: true, cost: readDepartureCost(row.trip_slug, row.batch_id, db) });
  } catch {
    return jsonFail('Could not delete the line item.', 500);
  }
};
