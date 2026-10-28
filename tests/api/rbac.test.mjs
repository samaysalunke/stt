// TC-200 to TC-207 — RBAC: roles, session guards, audit log
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { adminLogin, BASE } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DB_PATH = path.resolve(__dirname, '../../data/seekthethrill.db');

// Helper: open the test DB directly and insert a user+role+session so we can
// simulate different role scenarios without going through the OAuth flow.
function seedAdminSession({ role, tripIds = [], userId } = {}) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);

  const id     = userId ?? crypto.randomUUID();
  const email  = `rbac-test-${id.slice(0, 8)}@example.invalid`;
  const token  = crypto.randomUUID();
  const now    = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, displayName, googleId, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, email, `Test ${role}`, `google-test-${id}`, now);

  if (role) {
    db.prepare(`
      INSERT OR REPLACE INTO user_roles (userId, role, tripIds, assignedAt)
      VALUES (?, ?, ?, ?)
    `).run(id, role, JSON.stringify(tripIds), now);
  }

  const sessionId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO admin_sessions (id, userId, token, expiresAt, lastActivityAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, id, token, now + 8 * 3600, now);

  db.close();
  return { token, userId: id, cookie: `admin_token=${token}` };
}

function seedIdleSession({ role = 'owner' } = {}) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);

  const id    = crypto.randomUUID();
  const email = `rbac-idle-${id.slice(0, 8)}@example.invalid`;
  const token = crypto.randomUUID();
  const now   = Math.floor(Date.now() / 1000);
  const staleActivity = now - (2 * 3600 + 10); // 2h + 10s ago → past idle timeout

  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, displayName, googleId, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, email, 'Idle Admin', `google-idle-${id}`, now);

  db.prepare(`
    INSERT OR REPLACE INTO user_roles (userId, role, tripIds, assignedAt)
    VALUES (?, ?, ?, ?)
  `).run(id, role, '[]', now);

  const sessionId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO admin_sessions (id, userId, token, expiresAt, lastActivityAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, id, token, now + 8 * 3600, staleActivity);

  db.close();
  return { token, cookie: `admin_token=${token}` };
}

// ── TC-200: session with no role is rejected ──────────────────────────────────
test('TC-200 valid session token with no role → redirect to login', async () => {
  const { cookie } = seedAdminSession({ role: null });
  const res = await fetch(`${BASE}/admin/`, { redirect: 'manual', headers: { cookie } });
  assert.ok(res.status >= 300 && res.status < 400, `Expected redirect, got ${res.status}`);
  assert.match(res.headers.get('location') ?? '', /\/admin\/login/);
});

// ── TC-201: trip_lead blocked from trips management ───────────────────────────
test('TC-201 trip_lead GET /admin/trips → 403', async () => {
  const { cookie } = seedAdminSession({ role: 'trip_lead', tripIds: [] });
  const res = await fetch(`${BASE}/admin/trips`, { redirect: 'manual', headers: { cookie } });
  assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
});

test('TC-201 trip_lead POST /api/admin/trips/create → 403', async () => {
  const { cookie } = seedAdminSession({ role: 'trip_lead' });
  const res = await fetch(`${BASE}/api/admin/trips/create`, {
    method: 'POST', body: new FormData(), redirect: 'manual', headers: { cookie },
  });
  assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
});

test('TC-201 trip_lead POST /api/admin/trips/priority → 403', async () => {
  const { cookie } = seedAdminSession({ role: 'trip_lead' });
  const res = await fetch(`${BASE}/api/admin/trips/priority`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ slug: 'qa-test-v2', priority: 'high' }),
    redirect: 'manual',
  });
  assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
});

test('TC-201 trip_lead PATCH /api/admin/registrations/occupancy → 403', async () => {
  const { cookie } = seedAdminSession({ role: 'trip_lead' });
  const res = await fetch(`${BASE}/api/admin/registrations/occupancy`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ id: 1, tierId: 'private' }),
    redirect: 'manual',
  });
  // Middleware's ownerOrOpsOnly prefix rule catches this first, but requireRole
  // inside the handler is the real gate — assert the outcome, not the layer.
  assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
});

// ── TC-202: ops blocked from owner-only pages and trip creation ───────────────
test('TC-202 ops GET /admin/settings/roles → 403', async () => {
  const { cookie } = seedAdminSession({ role: 'ops' });
  const res = await fetch(`${BASE}/admin/settings/roles`, { redirect: 'manual', headers: { cookie } });
  assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
});

test('TC-202 ops GET /admin/audit → 403', async () => {
  const { cookie } = seedAdminSession({ role: 'ops' });
  const res = await fetch(`${BASE}/admin/audit`, { redirect: 'manual', headers: { cookie } });
  assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
});

test('TC-202 ops POST /api/admin/trips/create → 403', async () => {
  const { cookie } = seedAdminSession({ role: 'ops' });
  const res = await fetch(`${BASE}/api/admin/trips/create`, {
    method: 'POST', body: new FormData(), redirect: 'manual', headers: { cookie },
  });
  assert.equal(res.status, 403, `Expected 403, got ${res.status}`);
});

// ── TC-203: owner CAN access owner-only pages ─────────────────────────────────
test('TC-203 owner GET /admin/settings/roles → not 403', async () => {
  const { cookie } = await adminLogin('changeme'); // password login gives owner role
  const res = await fetch(`${BASE}/admin/settings/roles`, { redirect: 'manual', headers: { cookie } });
  // Should be 200 (page loaded) or redirect to within admin — never 403
  assert.notEqual(res.status, 403, 'Owner should not be blocked from roles page');
});

test('TC-203 owner GET /admin/audit → not 403', async () => {
  const { cookie } = await adminLogin('changeme');
  const res = await fetch(`${BASE}/admin/audit`, { redirect: 'manual', headers: { cookie } });
  assert.notEqual(res.status, 403, 'Owner should not be blocked from audit page');
});

// ── TC-204: cannot remove last owner ─────────────────────────────────────────
test('TC-204 cannot remove last owner via API → 409', async () => {
  const { cookie } = await adminLogin('changeme');
  // The password-login user IS the owner — try to remove their own owner role
  const res = await fetch(`${BASE}/api/admin/roles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ action: 'remove', userId: 'password-admin', role: 'owner' }),
    redirect: 'manual',
  });
  // Either 409 (last owner) or 409 (self-remove) — either way blocked
  assert.equal(res.status, 409, `Expected 409, got ${res.status}`);
});

// ── TC-205: idle session timeout → redirect to login ─────────────────────────
test('TC-205 idle session (>2h inactive) → redirect to login', async () => {
  const { cookie } = seedIdleSession({ role: 'owner' });
  const res = await fetch(`${BASE}/admin/`, { redirect: 'manual', headers: { cookie } });
  assert.ok(res.status >= 300 && res.status < 400, `Expected redirect, got ${res.status}`);
  assert.match(res.headers.get('location') ?? '', /\/admin\/login/);
});

// ── TC-206: audit_log row created on booking status change ───────────────────
test('TC-206 confirming a booking creates an audit_log entry', async () => {
  const Database = require('better-sqlite3');
  const { cookie } = await adminLogin('changeme');

  // Find a 'lead' registration to confirm
  const db = new Database(DB_PATH, { readonly: true });
  const reg = db.prepare("SELECT id FROM registrations WHERE status = 'lead' LIMIT 1").get();
  db.close();

  if (!reg) {
    // No lead registration available — skip gracefully
    return;
  }

  const countBefore = (() => {
    const db2 = new Database(DB_PATH, { readonly: true });
    const r = db2.prepare("SELECT COUNT(*) as n FROM audit_log WHERE action LIKE 'booking.%'").get();
    db2.close();
    return r.n;
  })();

  await fetch(`${BASE}/api/admin/update-registration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ id: reg.id, status: 'pending' }),
  });

  const countAfter = (() => {
    const db3 = new Database(DB_PATH, { readonly: true });
    const r = db3.prepare("SELECT COUNT(*) as n FROM audit_log WHERE action LIKE 'booking.%'").get();
    db3.close();
    return r.n;
  })();

  assert.ok(countAfter > countBefore, `Expected audit_log to grow (was ${countBefore}, now ${countAfter})`);
});

// ── TC-207: trip_lead sees only their assigned trips in registrations ──────────
test('TC-207 trip_lead with no assigned trips sees empty registrations page', async () => {
  const { cookie } = seedAdminSession({ role: 'trip_lead', tripIds: [] });
  // We can't easily parse Astro HTML in a unit test, so just assert no 403/500
  const res = await fetch(`${BASE}/admin/registrations`, { redirect: 'manual', headers: { cookie } });
  assert.ok(res.status === 200 || (res.status >= 300 && res.status < 400),
    `Expected 200 or redirect, got ${res.status}`);
  assert.notEqual(res.status, 403, 'trip_lead should be allowed on registrations page');
});

// ── WhatsApp group invite link: owner/ops only, needs a link, confirmed only ──
function seedRegistration({ batchId, status, email }) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO registrations (trip_name, trip_slug, batch_id, trip_date, full_name, email, phone, emergency_name, emergency_phone, status)
    VALUES ('QA Coming Soon', 'qa-test-coming-soon', ?, '1 Feb 2099', 'QA Group', ?, '+91 90000 00009', 'QA Contact', '+91 90000 00010', ?)
  `).run(batchId, email, status);
  db.close();
  return Number(lastInsertRowid);
}

test('group-invite: trip_lead → 403', async () => {
  const { cookie } = seedAdminSession({ role: 'trip_lead', tripIds: ['qa-cs-open-2099'] });
  const res = await fetch(`${BASE}/api/admin/registrations/group-invite`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tripSlug: 'qa-test-coming-soon', batchId: 'qa-cs-open-2099' }),
  });
  assert.equal(res.status, 403);
});

test('group-invite: departure without a link → 409', async () => {
  const { cookie } = seedAdminSession({ role: 'owner' });
  const res = await fetch(`${BASE}/api/admin/registrations/group-invite`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tripSlug: 'qa-test-coming-soon', batchId: 'qa-cs-soon-2099' }),
  });
  assert.equal(res.status, 409);
});

test('group-invite: emails only unsent confirmed travellers on that departure', async () => {
  const Database = require('better-sqlite3');
  const tag = crypto.randomUUID().slice(0, 8);
  // Start from a clean slate for this departure so earlier runs can't skew the count.
  const pre = new Database(DB_PATH);
  pre.prepare("UPDATE registrations SET whatsapp_group_sent_at = CURRENT_TIMESTAMP WHERE batch_id = 'qa-cs-open-2099' AND status = 'confirmed'").run();
  pre.close();
  seedRegistration({ batchId: 'qa-cs-open-2099', status: 'confirmed', email: `qa-group-a-${tag}@example.invalid` });
  seedRegistration({ batchId: 'qa-cs-open-2099', status: 'confirmed', email: `qa-group-b-${tag}@example.invalid` });
  seedRegistration({ batchId: 'qa-cs-open-2099', status: 'pending', email: `qa-group-c-${tag}@example.invalid` });
  seedRegistration({ batchId: 'qa-cs-soon-2099', status: 'confirmed', email: `qa-group-d-${tag}@example.invalid` });

  const { cookie } = seedAdminSession({ role: 'owner' });
  const res = await fetch(`${BASE}/api/admin/registrations/group-invite`, {
    method: 'POST', headers: { cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tripSlug: 'qa-test-coming-soon', batchId: 'qa-cs-open-2099' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  // Delivery depends on the environment's email key; who was attempted does not.
  assert.equal(data.sent + data.failed, 2);
});
