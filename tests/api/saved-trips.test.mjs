// /api/saved-trips — the heart on a trip card, plus the signed-in pages it feeds
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
// A real published trip: the API server runs without ALLOW_TEST_CONTENT, so
// the qa-test-* fixtures are not public there and cannot be saved.
const TRIP = 'ladakh-high-passes';

function db() { return new (require('better-sqlite3'))(DB_PATH); }

function seedUser() {
  const conn = db();
  const id = crypto.randomUUID();
  const email = `saved-${id.slice(0, 8)}@example.invalid`;
  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  conn.prepare(`INSERT INTO users (id, email, displayName, googleId, createdAt, username, showTripsPublicly, leaderboardOptOut)
    VALUES (?, ?, 'Saved Tester', ?, ?, ?, 0, 0)`).run(id, email, `google-saved-${id}`, now, `saved-${id.slice(0, 8)}`);
  conn.prepare('INSERT INTO user_sessions (id, userId, token, expiresAt) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), id, token, now + 86400);
  conn.close();
  return { id, email, cookie: `user_session=${token}` };
}

function savedCount(userId) {
  const conn = db();
  const n = conn.prepare('SELECT COUNT(*) n FROM saved_trips WHERE userId = ?').get(userId).n;
  conn.close();
  return n;
}

async function call(method, body, cookie) {
  const res = await fetch(`${BASE}/api/saved-trips`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: BASE, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test('signed out → 401, nothing stored', async () => {
  const { status, data } = await call('POST', { slug: TRIP });
  assert.equal(status, 401);
  assert.equal(data.success, false);
});

test('save is idempotent; unsave removes it', async () => {
  const user = seedUser();
  assert.equal((await call('POST', { slug: TRIP }, user.cookie)).status, 200);
  assert.equal((await call('POST', { slug: TRIP }, user.cookie)).status, 200);
  assert.equal(savedCount(user.id), 1);
  const { status, data } = await call('DELETE', { slug: TRIP }, user.cookie);
  assert.equal(status, 200);
  assert.equal(data.saved, false);
  assert.equal(savedCount(user.id), 0);
});

test('unknown, malformed and non-public slugs → 404', async () => {
  const user = seedUser();
  assert.equal((await call('POST', { slug: 'no-such-trip' }, user.cookie)).status, 404);
  assert.equal((await call('POST', { slug: '../etc/passwd' }, user.cookie)).status, 404);
  assert.equal((await call('POST', { slug: 'qa-test-bookable' }, user.cookie)).status, 404);
  assert.equal(savedCount(user.id), 0);
});

test('unsaving a trip that was never saved still succeeds', async () => {
  const user = seedUser();
  assert.equal((await call('DELETE', { slug: 'no-such-trip' }, user.cookie)).status, 200);
});

// The listing itself is covered in tests/e2e/personalisation.spec.ts: the repo
// has no published trip with future dates, so /trips/ is empty on this server.
test('a saved trip shows in the profile', async () => {
  const user = seedUser();
  await call('POST', { slug: TRIP }, user.cookie);
  const profile = await (await fetch(`${BASE}/profile?tab=trips`, { headers: { cookie: user.cookie } })).text();
  assert.match(profile, new RegExp(`data-saved-row="${TRIP}"`));
});

test('signed-out home and listing stay publicly cacheable and impersonal', async () => {
  for (const page of ['/', '/trips/']) {
    const res = await fetch(`${BASE}${page}`, { headers: { accept: 'text/html' } });
    const html = await res.text();
    assert.equal(res.headers.get('set-cookie'), null, page);
    assert.match(res.headers.get('cache-control') ?? '', /public/, page);
    assert.doesNotMatch(html, /data-save-trip=|data-state=|data-testid="hero-personal"/, page);
  }
});

test('signed-in pages are private', async () => {
  const user = seedUser();
  for (const page of ['/', '/trips/']) {
    const res = await fetch(`${BASE}${page}`, { headers: { accept: 'text/html', cookie: user.cookie } });
    assert.match(res.headers.get('cache-control') ?? '', /private/, page);
  }
});
