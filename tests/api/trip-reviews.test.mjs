// Post-trip reviews: /profile/review/<id>, POST /api/profile/review, /admin/reviews.
// Fixture: src/content/trips/qa-test-reviews.yaml (a finished and an upcoming departure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { BASE, adminLogin } from './helpers.mjs';

const require = createRequire(import.meta.url);
const DB_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/seekthethrill.db');
const db = () => new (require('better-sqlite3'))(DB_PATH);
const SLUG = 'qa-test-reviews';

function seedTraveller({ batch = 'qa-reviews-done', status = 'confirmed' } = {}) {
  const conn = db();
  const userId = crypto.randomUUID();
  const email = `review-${userId.slice(0, 8)}@example.invalid`;
  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  conn.prepare(`INSERT INTO users (id, email, displayName, googleId, createdAt, username, showTripsPublicly, leaderboardOptOut)
    VALUES (?, ?, 'Review Tester', ?, ?, ?, 0, 0)`).run(userId, email, `google-review-${userId}`, now, `review-${userId.slice(0, 8)}`);
  conn.prepare('INSERT INTO user_sessions (id, userId, token, expiresAt) VALUES (?, ?, ?, ?)').run(crypto.randomUUID(), userId, token, now + 86400);
  const regId = Number(conn.prepare(`INSERT INTO registrations (trip_name, trip_slug, batch_id, tier_id, full_name, email, phone, city, emergency_name, emergency_phone, status)
    VALUES ('QA Test — Reviews Trip', ?, ?, 'standard', 'Review Tester', ?, '9999999999', 'Pune', 'x', 'y', ?)`).run(SLUG, batch, email, status).lastInsertRowid);
  conn.close();
  return { regId, email, cookie: `user_session=${token}` };
}

const get = (p, cookie) => fetch(`${BASE}${p}`, { redirect: 'manual', headers: { Accept: 'text/html', ...(cookie ? { cookie } : {}) } });
const post = (fields, cookie) => fetch(`${BASE}/api/profile/review`, {
  method: 'POST', redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE, ...(cookie ? { cookie } : {}) },
  body: new URLSearchParams(fields).toString(),
});

test('signed out: the email link goes to sign-in and comes back to the form', async () => {
  const { regId } = seedTraveller();
  const res = await get(`/profile/review/${regId}`);
  assert.equal(res.status, 302);
  const location = res.headers.get('location');
  assert.equal(location, `/login?next=${encodeURIComponent(`/profile/review/${regId}`)}`);
  const login = await (await get(location)).text();
  assert.match(login, /login-review-note/);
  assert.match(login, new RegExp(`/api/auth/google\\?next=${encodeURIComponent(`/profile/review/${regId}`)}`));
});

test('the traveller sees the form, and saving it works and can be updated', async () => {
  const t = seedTraveller();
  const page = await (await get(`/profile/review/${t.regId}`, t.cookie)).text();
  assert.match(page, /data-testid="review-form"/);
  assert.match(page, /QA Test — Reviews Trip/);

  const missing = await post({ registrationId: String(t.regId), highlight: 'x' }, t.cookie);
  assert.equal(missing.status, 303);
  assert.match(missing.headers.get('location'), /error=overall/);

  const saved = await post({ registrationId: String(t.regId), overall: '5', food: '4', recommend: '9', highlight: 'Night sky', improve: 'Longer stops', testimonial: 'Go with them.', canFeature: 'on' }, t.cookie);
  assert.equal(saved.status, 303);
  assert.match(saved.headers.get('location'), /saved=1/);
  await post({ registrationId: String(t.regId), overall: '4', recommend: '9', testimonial: 'Go with them.', canFeature: 'on' }, t.cookie);

  const conn = db();
  const rows = conn.prepare('SELECT * FROM trip_reviews WHERE registration_id = ?').all(t.regId);
  conn.close();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].overall_rating, 4);
  assert.equal(rows[0].can_feature, 1);

  const again = await (await get(`/profile/review/${t.regId}?saved=1`, t.cookie)).text();
  assert.match(again, /review-saved/);
  assert.match(again, /Update my review/);
});

test('another account cannot read or write it', async () => {
  const owner = seedTraveller();
  const other = seedTraveller();
  const page = await (await get(`/profile/review/${owner.regId}`, other.cookie)).text();
  assert.match(page, /review-wrong-account/);
  assert.ok(!page.includes(owner.email), 'the owner email must be masked');
  await post({ registrationId: String(owner.regId), overall: '1' }, other.cookie);
  const conn = db();
  assert.equal(conn.prepare('SELECT COUNT(*) n FROM trip_reviews WHERE registration_id = ?').get(owner.regId).n, 0);
  conn.close();
});

test('not yet: upcoming trips and unconfirmed bookings', async () => {
  const upcoming = seedTraveller({ batch: 'qa-reviews-2099' });
  assert.match(await (await get(`/profile/review/${upcoming.regId}`, upcoming.cookie)).text(), /review-not-ended/);
  const lead = seedTraveller({ status: 'lead' });
  assert.match(await (await get(`/profile/review/${lead.regId}`, lead.cookie)).text(), /review-unavailable/);
});

test('admins read reviews by departure', async () => {
  const t = seedTraveller();
  await post({ registrationId: String(t.regId), overall: '5', highlight: 'QA-REVIEW-HIGHLIGHT' }, t.cookie);
  const { cookie } = await adminLogin();
  const list = await (await get('/admin/reviews', cookie)).text();
  assert.match(list, /reviews-departures/);
  assert.match(list, new RegExp(`trip=${SLUG}&amp;batch=qa-reviews-done`));
  const detail = await (await get(`/admin/reviews?trip=${SLUG}&batch=qa-reviews-done`, cookie)).text();
  assert.match(detail, /QA-REVIEW-HIGHLIGHT/);
});
