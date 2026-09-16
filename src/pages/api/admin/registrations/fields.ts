import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { requireRole } from '../../../../lib/requireRole';
import { jsonOk, jsonFail } from '../../../../lib/apiResponse';
import { logAction } from '../../../../lib/audit';
import { normalizeIndiaState } from '../../../../lib/indiaStates';
import { recalculateUserLeaderboard } from '../../../../lib/stats';

// Patch a small whitelist of demographic fields on a registration — primarily so
// ops can add a missing `state` and re-run a stuck Zoho document.
const WHITELIST = ['state', 'city', 'pincode'] as const;
type Key = (typeof WHITELIST)[number];

export const PATCH: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  try {
    const body = await request.json();
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return jsonFail('A valid registration id is required.');

    const patch = body.patch && typeof body.patch === 'object' ? body.patch : {};
    const clean: Partial<Record<Key, string>> = {};
    for (const key of WHITELIST) {
      if (patch[key] === undefined || patch[key] === null) continue;
      // `state` is canonicalised against INDIA_STATES rather than stored as
      // typed, so this endpoint agrees with the checkout, the admin create
      // form and the CSV importer on one spelling per state. An unrecognised
      // value is rejected outright rather than written as noise.
      if (key === 'state') {
        const state = normalizeIndiaState(patch.state);
        if (!state) return jsonFail(`"${String(patch.state).slice(0, 40)}" is not an Indian state or union territory.`);
        clean.state = state;
        continue;
      }
      const value = String(patch[key]).trim().slice(0, 120);
      if (value) clean[key] = value;
    }
    if (!Object.keys(clean).length) return jsonFail('Nothing to update.');

    const db = getDb();
    const reg = db.prepare('SELECT id, email, state, city, pincode FROM registrations WHERE id=?').get(id) as any;
    if (!reg) return jsonFail('Registration not found.', 404);

    const cols = Object.keys(clean);
    db.prepare(
      `UPDATE registrations SET ${cols.map((c) => `${c}=?`).join(', ')}, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    ).run(...cols.map((c) => (clean as any)[c]), id);

    logAction({
      actorUserId: locals.adminUser?.userId,
      actorEmail: locals.adminUser?.email,
      actorRole: locals.adminUser?.role,
      action: 'booking.fields_patched',
      targetType: 'registration',
      targetId: String(id),
      previousValue: Object.fromEntries(cols.map((c) => [c, reg[c] ?? null])),
      newValue: clean,
    });

    // Same reason as the customer drawer: city is the home point the whole km
    // column is measured from.
    if (clean.city !== undefined && clean.city !== reg.city && reg.email) {
      recalculateUserLeaderboard(String(reg.email)).catch((err) => console.error('[leaderboard recalc]', err));
    }

    return jsonOk({ success: true, patch: clean });
  } catch (err) {
    console.error('[registrations/fields]', err);
    return jsonFail('Server error.', 500);
  }
};
