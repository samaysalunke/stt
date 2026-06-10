// TC-210 to TC-220 — Gamification: usernames, leaderboard, profile settings
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

function seedUserWithSession({ leaderboardOptOut = 0, showTripsPublicly = 0, username = null } = {}) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  const id = crypto.randomUUID();
  const email = `gamification-${id.slice(0, 8)}@example.invalid`;
  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, displayName, googleId, createdAt, leaderboardOptOut, showTripsPublicly, username)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, email, 'Test User', `google-gamification-${id}`, now, leaderboardOptOut, showTripsPublicly, username);

  const sessionId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO user_sessions (id, userId, token, expiresAt)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, id, token, now + 30 * 86400);

  db.close();
  return { userId: id, email, token, cookie: `user_session=${token}` };
}

function seedLeaderboardEntry({ userId, email, kmsFromHome = 500, daysOutdoors = 7, destinationsCount = 1 } = {}) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  db.prepare(`
    INSERT OR REPLACE INTO leaderboard_cache
      (userId, email, displayName, kmsFromHome, daysOutdoors, destinationsCount, tripsCount, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
  `).run(userId, email, 'Test User', kmsFromHome, daysOutdoors, destinationsCount, 1);
  db.close();
}

// ── TC-210: leaderboard page is publicly accessible ───────────────────────────
test('TC-210 GET /leaderboard → 200 (public)', async () => {
  const res = await fetch(`${BASE}/leaderboard`, { redirect: 'manual' });
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
});

// ── TC-211: leaderboard tabs render without error ─────────────────────────────
test('TC-211 leaderboard tabs km / days / destinations → all 200', async () => {
  for (const tab of ['km', 'days', 'destinations']) {
    const res = await fetch(`${BASE}/leaderboard?tab=${tab}`, { redirect: 'manual' });
    assert.equal(res.status, 200, `Tab ${tab}: expected 200, got ${res.status}`);
  }
});

// ── TC-212: /api/profile/settings requires auth ───────────────────────────────
test('TC-212 POST /api/profile/settings without auth → 401', async () => {
  const res = await fetch(`${BASE}/api/profile/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'setLeaderboard', value: true }),
  });
  assert.equal(res.status, 401, `Expected 401, got ${res.status}`);
});

// ── TC-213: setLeaderboard opt-out removes from leaderboard_cache ─────────────
test('TC-213 setLeaderboard opt-out removes from leaderboard_cache', async () => {
  const { userId, email, cookie } = seedUserWithSession({ leaderboardOptOut: 0 });
  seedLeaderboardEntry({ userId, email, kmsFromHome: 300 });

  const Database = require('better-sqlite3');
  const before = new Database(DB_PATH, { readonly: true })
    .prepare('SELECT COUNT(*) as n FROM leaderboard_cache WHERE userId = ?').get(userId).n;
  new Database(DB_PATH, { readonly: true }).close();
  assert.equal(before, 1, 'Entry should exist before opt-out');

  const res = await fetch(`${BASE}/api/profile/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ action: 'setLeaderboard', value: false }),
  });
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const data = await res.json();
  assert.equal(data.success, true);

  const after = new Database(DB_PATH, { readonly: true })
    .prepare('SELECT COUNT(*) as n FROM leaderboard_cache WHERE userId = ?').get(userId).n;
  assert.equal(after, 0, 'Entry should be removed from leaderboard_cache after opt-out');
});

// ── TC-214: setUsername — valid, first-time change succeeds ───────────────────
test('TC-214 setUsername first-time → success', async () => {
  const { cookie } = seedUserWithSession({ username: 'auto-generated-name' });
  const newName = `traveller-${crypto.randomBytes(3).toString('hex')}`;

  const res = await fetch(`${BASE}/api/profile/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ action: 'setUsername', username: newName }),
  });
  assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
  const data = await res.json();
  assert.equal(data.success, true, `Expected success, got: ${JSON.stringify(data)}`);
});

// ── TC-215: setUsername — second change is rejected ───────────────────────────
test('TC-215 setUsername second attempt → 400 (one-change limit)', async () => {
  const Database = require('better-sqlite3');
  const { userId, cookie } = seedUserWithSession({ username: 'already-set' });

  // Mark as already changed manually
  const db = new Database(DB_PATH);
  db.prepare('UPDATE users SET usernameChangedAt = unixepoch() WHERE id = ?').run(userId);
  db.close();

  const res = await fetch(`${BASE}/api/profile/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ action: 'setUsername', username: 'another-name' }),
  });
  assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
  const data = await res.json();
  assert.equal(data.success, false);
  assert.match(data.error, /once/i, 'Error should mention one-change limit');
});

// ── TC-216: setUsername — reserved word rejected ──────────────────────────────
test('TC-216 setUsername with reserved word → 400', async () => {
  const { cookie } = seedUserWithSession();
  const res = await fetch(`${BASE}/api/profile/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ action: 'setUsername', username: 'admin' }),
  });
  assert.equal(res.status, 400, `Expected 400, got ${res.status}`);
  const data = await res.json();
  assert.equal(data.success, false);
  assert.match(data.error ?? '', /reserved/i);
});

// ── TC-217: setUsername — too short rejected ──────────────────────────────────
test('TC-217 setUsername too short (< 3 chars) → 400', async () => {
  const { cookie } = seedUserWithSession();
  const res = await fetch(`${BASE}/api/profile/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ action: 'setUsername', username: 'ab' }),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.success, false);
});

// ── TC-218: setUsername — duplicate rejected ──────────────────────────────────
test('TC-218 setUsername duplicate → 400', async () => {
  const Database = require('better-sqlite3');
  const taken = `taken-${crypto.randomBytes(3).toString('hex')}`;

  // Seed the taken username into another user
  const db = new Database(DB_PATH);
  const otherId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, email, displayName, googleId, createdAt, username)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(otherId, `other-${otherId.slice(0,6)}@example.invalid`, 'Other', `g-other-${otherId}`, now, taken);
  db.close();

  const { cookie } = seedUserWithSession();
  const res = await fetch(`${BASE}/api/profile/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ action: 'setUsername', username: taken }),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.success, false);
  assert.match(data.error ?? '', /taken/i);
});

// ── TC-219: setShowTrips toggle persists in DB ────────────────────────────────
test('TC-219 setShowTrips persists in users table', async () => {
  const Database = require('better-sqlite3');
  const { userId, cookie } = seedUserWithSession({ showTripsPublicly: 0 });

  const res = await fetch(`${BASE}/api/profile/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ action: 'setShowTrips', value: true }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);

  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare('SELECT showTripsPublicly FROM users WHERE id = ?').get(userId);
  db.close();
  assert.equal(row.showTripsPublicly, 1, 'showTripsPublicly should be 1 in DB');
});

// ── TC-220: leaderboard shows data when cache is populated ───────────────────
test('TC-220 leaderboard shows seeded user when leaderboard_cache has data', async () => {
  const { userId, email } = seedUserWithSession();
  seedLeaderboardEntry({ userId, email, kmsFromHome: 1234, daysOutdoors: 14, destinationsCount: 2 });

  const res = await fetch(`${BASE}/leaderboard`);
  assert.equal(res.status, 200);
  const html = await res.text();
  // The leaderboard page should contain the km stat somewhere
  assert.ok(html.includes('1,234') || html.includes('1234'), 'Page should show kmsFromHome value');
});
