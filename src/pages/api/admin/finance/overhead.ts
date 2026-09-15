import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { requireRole } from '../../../../lib/requireRole';
import { jsonOk, jsonFail } from '../../../../lib/apiResponse';
import { logAction } from '../../../../lib/audit';
import { sanitizeInput } from '../../../../lib/utils';
import {
  OVERHEAD_CATEGORIES,
  clearCompanyCost,
  copyCompanyCosts,
  parseCategory,
  parseMonth,
  parseOverheadAmount,
  readCompanyCosts,
  upsertCompanyCost,
} from '../../../../lib/companyCosts';

// Monthly company overheads. OWNER ONLY, and for a stronger reason than the
// departure costs next door: this table holds salaries. /admin/finance is
// readable by ops, which is why the P&L that renders these lives on its own
// owner-gated page rather than as a section there.
//
// Three verbs in one file, one auth block: PUT upserts a cell, DELETE returns it
// to "not entered" (which is NOT the same as zero — the P&L's completeness
// signal counts months with no rows), POST copies a whole month forward.

function actor(locals: App.Locals) {
  return {
    actorUserId: locals.adminUser?.userId,
    actorEmail: locals.adminUser?.email,
    actorRole: locals.adminUser?.role,
  };
}

function identify(body: any): { month: string; category: string } | { error: string } {
  const month = parseMonth(body?.month);
  if (!month) return { error: 'Month must be in YYYY-MM form.' };
  const category = parseCategory(body?.category);
  if (!category) return { error: `Category must be one of: ${OVERHEAD_CATEGORIES.join(', ')}.` };
  return { month, category };
}

export const PUT: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner']);
  if (denied) return denied;

  try {
    const body = await request.json();
    const id = identify(body);
    if ('error' in id) return jsonFail(id.error);

    const amount = parseOverheadAmount(body.amount);
    if (amount === null) {
      return jsonFail('Enter the amount as a whole rupee value. A negative amount records a credit.');
    }
    const note = sanitizeInput(body.note).slice(0, 500) || null;

    const db = getDb();
    const before = readCompanyCosts(db, [id.month]).find((row) => row.category === id.category) ?? null;
    const saved = upsertCompanyCost({
      month: id.month, category: id.category as any, amount, note,
      actorEmail: locals.adminUser?.email ?? null, db,
    });

    logAction({
      ...actor(locals),
      action: 'company_cost.set',
      targetType: 'company_cost',
      targetId: `${id.month}:${id.category}`,
      previousValue: before ? { amount: before.amount, note: before.note } : null,
      newValue: { amount, note },
    });

    // Echo the stored (rounded) value so the input shows what was actually saved.
    return jsonOk({ success: true, row: saved });
  } catch {
    return jsonFail('Could not save the overhead.', 500);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner']);
  if (denied) return denied;

  try {
    const body = await request.json();
    const id = identify(body);
    if ('error' in id) return jsonFail(id.error);

    const db = getDb();
    const before = readCompanyCosts(db, [id.month]).find((row) => row.category === id.category) ?? null;
    if (!before) return jsonFail('Nothing is recorded for that month and category.', 404);

    clearCompanyCost(id.month, id.category, db);

    logAction({
      ...actor(locals),
      action: 'company_cost.cleared',
      targetType: 'company_cost',
      targetId: `${id.month}:${id.category}`,
      previousValue: { amount: before.amount, note: before.note },
      newValue: null,
    });

    return jsonOk({ success: true });
  } catch {
    return jsonFail('Could not clear the overhead.', 500);
  }
};

/** Copy every category from one month to another — the answer to recurring costs. */
export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner']);
  if (denied) return denied;

  try {
    const body = await request.json();
    const from = parseMonth(body?.from);
    const to = parseMonth(body?.to);
    if (!from || !to) return jsonFail('Both months must be in YYYY-MM form.');
    if (from === to) return jsonFail('Choose two different months.');

    const db = getDb();
    const result = copyCompanyCosts({
      from, to, overwrite: body.overwrite === true,
      actorEmail: locals.adminUser?.email ?? null, db,
    });

    logAction({
      ...actor(locals),
      action: 'company_cost.copied',
      targetType: 'company_cost',
      targetId: to,
      // The whole prior state of the target month, so an overwrite is undoable
      // from the audit log alone.
      previousValue: result.previous.length ? result.previous : null,
      newValue: { from, to, copied: result.copied },
    });

    return jsonOk({ success: true, copied: result.copied, rows: readCompanyCosts(db, [to]) });
  } catch (error) {
    // copyCompanyCosts throws for an empty source and for a non-empty target
    // without overwrite — both are the caller's mistake, not a server fault.
    return jsonFail((error as Error).message || 'Could not copy the overheads.');
  }
};
