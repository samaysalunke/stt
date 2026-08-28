import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { requireRole } from '../../../../lib/requireRole';
import { jsonOk, jsonFail } from '../../../../lib/apiResponse';
import { logAction } from '../../../../lib/audit';

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
      const value = String(patch[key]).trim().slice(0, 120);
      if (value) clean[key] = value;
    }
    if (!Object.keys(clean).length) return jsonFail('Nothing to update.');

    const db = getDb();
    const reg = db.prepare('SELECT id, state, city, pincode FROM registrations WHERE id=?').get(id) as any;
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

    return jsonOk({ success: true, patch: clean });
  } catch (err) {
    console.error('[registrations/fields]', err);
    return jsonFail('Server error.', 500);
  }
};
