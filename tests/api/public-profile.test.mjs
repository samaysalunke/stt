// TC-230 to TC-240 — Public profile + share banner
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { BASE } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DB_PATH = path.resolve(__dirname, '../../data/seekthethrill.db');

// ── helpers ──────────────────────────────────────────────────────────────────

function seedPublicUser({ username, showTripsPublicly = 0, leaderboardOptOut = 0 } = {}) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  const id = crypto.randomUUID();
  const uname = username ?? `pub-${crypto.randomBytes(4).toString('hex')}`;
  const email = `pubtest-${id.slice(0, 8)}@example.invalid`;
  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, displayName, googleId, createdAt, username, showTripsPublicly, leaderboardOptOut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, email, 'Public Test', `google-pub-${id}`, now, uname, showTripsPublicly, leaderboardOptOut);

  const sessionId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO user_sessions (id, userId, token, expiresAt)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, id, token, now + 30 * 86400);

  db.close();
  return { userId: id, email, username: uname, token, cookie: `user_session=${token}` };
}

function seedConfirmedReg({ email, tripName = 'Test Trip', sharedAt = null, tripSlug = null, batchId = null } = {}) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  const result = db.prepare(`
    INSERT INTO registrations
      (trip_name, trip_slug, batch_id, full_name, email, phone, emergency_name, emergency_phone, status, sharedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
  `).run(tripName, tripSlug, batchId, 'Test User', email, '9999999999', 'EC', '9999999998', sharedAt);
  db.close();
  return { regId: result.lastInsertRowid };
}

// ── TC-230: unknown username → 404 ───────────────────────────────────────────
test('TC-230 GET /u/nonexistent-user → 404', async () => {
  const res = await fetch(`${BASE}/u/definitely-does-not-exist-${crypto.randomBytes(4).toString('hex')}`, {
    redirect: 'manual',
  });
  assert.equal(res.status, 404, `Expected 404, got ${res.status}`);
});

// ── TC-231: valid username → 200 ─────────────────────────────────────────────
test('TC-231 GET /u/{username} for existing user → 200', async () => {
  const { username } = seedPublicUser();
  const res = await fetch(`${BASE}/u/${username}`, { redirect: 'manual' });
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
});

// ── TC-232: public profile never exposes email ────────────────────────────────
test('TC-232 public profile HTML does not contain email address', async () => {
  const { username, email } = seedPublicUser();
  const res = await fetch(`${BASE}/u/${username}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes(email), `Page should not expose email: ${email}`);
});

// ── TC-233: public profile shows only first name ──────────────────────────────
test('TC-233 public profile shows first name only (not full name)', async () => {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  const id = crypto.randomUUID();
  const uname = `nametest-${crypto.randomBytes(3).toString('hex')}`;
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, displayName, googleId, createdAt, username)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, `nametest-${id.slice(0,6)}@example.invalid`, 'Samay Salunke', `google-nametest-${id}`, now, uname);
  db.close();

  const res = await fetch(`${BASE}/u/${uname}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Samay'), 'Should show first name');
  assert.ok(!html.includes('Salunke'), 'Should NOT show surname');
});

// ── TC-234: pending/lead registrations not shown in trip list ────────────────
test('TC-234 lead/pending registrations not visible on public profile', async () => {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  const id = crypto.randomUUID();
  const uname = `pending-${crypto.randomBytes(3).toString('hex')}`;
  const email = `pending-${id.slice(0,6)}@example.invalid`;
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, displayName, googleId, createdAt, username, showTripsPublicly)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(id, email, 'Pending Test', `google-pending-${id}`, now, uname);

  const secretTripName = `SECRET_PENDING_${crypto.randomBytes(4).toString('hex')}`;
  db.prepare(`
    INSERT INTO registrations (trip_name, full_name, email, phone, emergency_name, emergency_phone, status)
    VALUES (?, ?, ?, ?, ?, ?, 'lead')
  `).run(secretTripName, 'Test', email, '9999999999', 'EC', '9999999998');
  db.close();

  const res = await fetch(`${BASE}/u/${uname}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes(secretTripName), 'Lead registration trip name should not appear on public profile');
});

// ── TC-235: showTripsPublicly=false → trip names not in HTML ─────────────────
test('TC-235 showTripsPublicly=false hides trip list', async () => {
  const { username, email } = seedPublicUser({ showTripsPublicly: 0 });
  const secretTrip = `HIDDEN_TRIP_${crypto.randomBytes(4).toString('hex')}`;
  seedConfirmedReg({ email, tripName: secretTrip });

  const res = await fetch(`${BASE}/u/${username}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes(secretTrip), 'Trip list should be hidden when showTripsPublicly=0');
  assert.ok(!html.includes('Map of India'), 'Map payload should be absent when trip sharing is disabled');
});

test('TC-235a public HTML excludes private traveller and financial fields', async () => {
  const Database = require('better-sqlite3');
  const { username, email } = seedPublicUser({ showTripsPublicly: 1 });
  const secrets = {
    phone: `PHONE_${crypto.randomBytes(4).toString('hex')}`,
    emergency: `EMERGENCY_${crypto.randomBytes(4).toString('hex')}`,
    why: `WHY_${crypto.randomBytes(4).toString('hex')}`,
    transaction: `TXN_${crypto.randomBytes(4).toString('hex')}`,
  };
  const db = new Database(DB_PATH);
  db.prepare(`INSERT INTO registrations
    (trip_name,full_name,email,phone,emergency_name,emergency_phone,why_join,transaction_id,amount_paid,total_amount,status)
    VALUES ('Safe public trip','Private Surname',?,?,?,?,?,?,9000,20000,'confirmed')`)
    .run(email,secrets.phone,secrets.emergency,'0000000000',secrets.why,secrets.transaction);
  db.close();
  const html = await (await fetch(`${BASE}/u/${username}`)).text();
  for (const secret of Object.values(secrets)) assert.ok(!html.includes(secret), `Public HTML leaked ${secret}`);
  assert.ok(!html.includes('Private Surname'));
  assert.ok(!html.includes('20,000') && !html.includes('20000'));
});

// ── TC-236: showTripsPublicly=true → trip names appear ───────────────────────
test('TC-236 showTripsPublicly=true shows confirmed trip list', async () => {
  const { username, email } = seedPublicUser({ showTripsPublicly: 1 });
  const publicTrip = `PUBLIC_TRIP_${crypto.randomBytes(4).toString('hex')}`;
  seedConfirmedReg({ email, tripName: publicTrip });

  const res = await fetch(`${BASE}/u/${username}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes(publicTrip), 'Trip should appear when showTripsPublicly=1');
});

// ── TC-237: share-dismiss requires auth ──────────────────────────────────────
test('TC-237 POST /api/profile/share-dismiss without auth → 401', async () => {
  const res = await fetch(`${BASE}/api/profile/share-dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registrationId: 1, action: 'dismiss' }),
  });
  assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
});

// ── TC-238: share-dismiss marks sharedAt in DB ────────────────────────────────
test('TC-238 share-dismiss dismiss sets sharedAt in registrations', async () => {
  const Database = require('better-sqlite3');
  const { email, cookie } = seedPublicUser();
  const { regId } = seedConfirmedReg({ email });

  const res = await fetch(`${BASE}/api/profile/share-dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ registrationId: Number(regId), action: 'dismiss' }),
  });
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const data = await res.json();
  assert.equal(data.success, true);

  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare('SELECT sharedAt FROM registrations WHERE id = ?').get(Number(regId));
  db.close();
  assert.ok(row?.sharedAt, 'sharedAt should be set after dismiss');
  assert.equal(row.sharedAt, 'dismissed', 'sharedAt should equal "dismissed"');
});

// ── TC-239: share action sets ISO timestamp ───────────────────────────────────
test('TC-239 share action sets ISO timestamp in sharedAt', async () => {
  const Database = require('better-sqlite3');
  const { email, cookie } = seedPublicUser();
  const { regId } = seedConfirmedReg({ email });

  await fetch(`${BASE}/api/profile/share-dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ registrationId: Number(regId), action: 'share' }),
  });

  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare('SELECT sharedAt FROM registrations WHERE id = ?').get(Number(regId));
  db.close();
  assert.ok(row?.sharedAt, 'sharedAt should be set');
  assert.notEqual(row.sharedAt, 'dismissed', 'share action should set a timestamp, not "dismissed"');
  // Should be a valid ISO date
  assert.ok(!isNaN(Date.parse(row.sharedAt)), `sharedAt should be parseable as date: ${row.sharedAt}`);
});

// ── TC-240: leaderboard opt-out hides rank on public profile ─────────────────
test('TC-240 leaderboard opt-out → no rank line on public profile', async () => {
  const Database = require('better-sqlite3');
  const { userId, username, email } = seedPublicUser({ leaderboardOptOut: 1 });

  // Seed leaderboard cache so there IS a rank available
  const db = new Database(DB_PATH);
  db.prepare(`
    INSERT OR REPLACE INTO leaderboard_cache (userId, email, kmsFromHome, daysOutdoors, destinationsCount, tripsCount)
    VALUES (?, ?, 500, 7, 1, 1)
  `).run(userId, email);
  db.close();

  const res = await fetch(`${BASE}/u/${username}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  // The rank text should NOT appear since user opted out
  assert.ok(!html.includes('on the km from home board'), 'Rank line should be hidden for opted-out users');
});
