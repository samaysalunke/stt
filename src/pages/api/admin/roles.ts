import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { assignRole, removeRole, countOwners, getUserRoles } from '../../../lib/admin-session';
import { logAction } from '../../../lib/audit';

export const prerender = false;

const VALID_ROLES = ['owner', 'ops', 'trip_lead'];

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const actor = locals.adminUser;
  if (!actor || actor.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const ct = request.headers.get('content-type') ?? '';
  const isForm = ct.includes('application/x-www-form-urlencoded') || ct.includes('multipart/form-data');

  let action: string, userId: string, role: string, tripIds: string[];

  if (isForm) {
    const fd = await request.formData();
    const formAction = (fd.get('action') ?? '').toString();
    role = (fd.get('role') ?? '').toString();
    tripIds = fd.getAll('tripIds').map(String);

    if (formAction === 'remove-form') {
      userId = (fd.get('userId') ?? '').toString();
      action = 'remove';
    } else {
      // assign-form: look up userId by email
      const email = (fd.get('email') ?? '').toString().trim().toLowerCase();
      const user = getDb().prepare('SELECT id FROM users WHERE lower(email) = ?').get(email) as any;
      if (!user) return redirect('/admin/settings/roles?error=not_found');
      userId = user.id;
      action = 'assign';
    }
  } else {
    const body = await request.json() as any;
    ({ action, userId, role } = body);
    tripIds = Array.isArray(body.tripIds) ? body.tripIds : [];
  }

  if (!userId || !role || !VALID_ROLES.includes(role)) {
    return new Response(JSON.stringify({ error: 'Invalid params' }), { status: 400 });
  }

  // Verify target user exists
  const user = getDb().prepare('SELECT id, email FROM users WHERE id = ?').get(userId) as any;
  if (!user) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });

  if (action === 'assign') {
    const parsedTripIds: string[] = Array.isArray(tripIds) ? tripIds : [];
    assignRole({ userId, role, tripIds: parsedTripIds, assignedBy: actor.userId });
    logAction({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'role.assign',
      targetType: 'user',
      targetId: userId,
      newValue: { role, tripIds: parsedTripIds },
    });
    return isForm
      ? redirect('/admin/settings/roles?saved=1')
      : new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (action === 'remove') {
    // Cannot remove last owner
    if (role === 'owner' && countOwners() <= 1) {
      return isForm
        ? redirect('/admin/settings/roles?error=last_owner')
        : new Response(JSON.stringify({ error: 'Cannot remove last owner' }), { status: 409 });
    }
    // Cannot remove your own owner role
    if (userId === actor.userId && role === 'owner') {
      return isForm
        ? redirect('/admin/settings/roles?error=self')
        : new Response(JSON.stringify({ error: 'Cannot remove your own owner role' }), { status: 409 });
    }
    removeRole(userId, role);
    logAction({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'role.remove',
      targetType: 'user',
      targetId: userId,
      previousValue: { role },
    });
    return isForm
      ? redirect('/admin/settings/roles?removed=1')
      : new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
};

// Search users (for the "add role" form autocomplete)
export const GET: APIRoute = async ({ url, locals }) => {
  if (!locals.adminUser || locals.adminUser.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  const q = url.searchParams.get('q') ?? '';
  if (q.length < 2) return new Response(JSON.stringify([]), { status: 200 });

  const rows = getDb().prepare(`
    SELECT id, email, displayName FROM users
    WHERE email LIKE ? OR displayName LIKE ?
    LIMIT 10
  `).all(`%${q}%`, `%${q}%`);

  return new Response(JSON.stringify(rows), { status: 200 });
};
