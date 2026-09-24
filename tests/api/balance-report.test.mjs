// TC-260 to TC-270 — Traveller reports paying their balance (a claim, never a payment)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { BASE, apiPost, adminLogin } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DATA_DIR = path.resolve(__dirname, '../../data');
const DB_PATH = path.join(DATA_DIR, 'seekthethrill.db');
const ENDPOINT = '/api/profile/report-balance-payment';
const uploaded = [];

function db() { return new (require('better-sqlite3'))(DB_PATH); }

function seedUser() {
  const conn = db();
  const id = crypto.randomUUID();
  const email = `balrep-${id.slice(0, 8)}@example.invalid`;
  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  conn.prepare(`INSERT INTO users (id, email, displayName, googleId, createdAt, username, showTripsPublicly, leaderboardOptOut)
    VALUES (?, ?, 'Balance Tester', ?, ?, ?, 0, 0)`).run(id, email, `google-balrep-${id}`, now, `balrep-${id.slice(0, 8)}`);
  conn.prepare('INSERT INTO user_sessions (id, userId, token, expiresAt) VALUES (?, ?, ?, ?)')
    .run(crypto.randomUUID(), id, token, now + 86400);
  conn.close();
  return { email, cookie: `user_session=${token}` };
}

function seedReg(email, { status = 'confirmed', total = 30000, paid = 6000, paymentStatus = 'advance_paid' } = {}) {
  const conn = db();
  const { lastInsertRowid } = conn.prepare(`INSERT INTO registrations
      (trip_name, full_name, email, phone, emergency_name, emergency_phone, status, total_amount, amount_paid, payment_status)
    VALUES ('Balance Test Trip', 'Balance Tester', ?, '9999999999', 'EC', '9999999998', ?, ?, ?, ?)`)
    .run(email, status, total, paid, paymentStatus);
  conn.close();
  return Number(lastInsertRowid);
}

function readReg(id) {
  const conn = db();
  const row = conn.prepare(`SELECT status, amount_paid, payment_status, total_amount, payment_screenshot_url,
      balance_reported_at, balance_payment_screenshot_url FROM registrations WHERE id = ?`).get(id);
  const events = conn.prepare('SELECT COUNT(*) n FROM payment_events WHERE registration_id = ?').get(id).n;
  conn.close();
  return { ...row, events };
}

// A real file written by the real upload endpoint, so the URL shape and the
// on-disk check are both exercised.
async function uploadPng() {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'proof.png');
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: form });
  const data = await res.json();
  assert.equal(data.success, true, `upload failed: ${JSON.stringify(data)}`);
  uploaded.push(path.join(DATA_DIR, 'uploads', path.basename(data.url)));
  return data.url;
}

after(() => { for (const file of uploaded) fs.rmSync(file, { force: true }); });

test('TC-260 rejects an unauthenticated report', async () => {
  const { status } = await apiPost(ENDPOINT, { registrationId: 1 });
  assert.equal(status, 401);
});

test("TC-261 rejects another traveller's booking with 404", async () => {
  const owner = seedUser();
  const other = seedUser();
  const id = seedReg(owner.email);
  const { status } = await apiPost(ENDPOINT, { registrationId: id }, { headers: { cookie: other.cookie } });
  assert.equal(status, 404);
  assert.equal(readReg(id).balance_reported_at, null);
});

test('TC-262 rejects lead, pending and cancelled bookings, and ones with nothing owing', async () => {
  const user = seedUser();
  const cases = [
    seedReg(user.email, { status: 'lead', paid: 0, paymentStatus: 'unpaid' }),
    seedReg(user.email, { status: 'pending' }),
    seedReg(user.email, { status: 'cancelled', paymentStatus: 'no_refund' }),
    seedReg(user.email, { paid: 30000, paymentStatus: 'fully_paid' }),
    seedReg(user.email, { total: null }),
  ];
  for (const id of cases) {
    const { status } = await apiPost(ENDPOINT, { registrationId: id }, { headers: { cookie: user.cookie } });
    assert.equal(status, 404, `registration ${id} should be refused`);
    assert.equal(readReg(id).balance_reported_at, null);
  }
});

test('TC-263 rejects a screenshot URL that our upload endpoint did not write', async () => {
  const user = seedUser();
  const id = seedReg(user.email);
  for (const screenshotUrl of [
    'https://evil.example/proof.png',
    '/api/uploads/../seekthethrill.db',
    `/api/uploads/${crypto.randomUUID()}.png`, // right shape, no such file
  ]) {
    const { status } = await apiPost(ENDPOINT, { registrationId: id, screenshotUrl }, { headers: { cookie: user.cookie } });
    assert.equal(status, 400, `${screenshotUrl} should be refused`);
  }
  assert.equal(readReg(id).balance_reported_at, null);
});

test('TC-264 succeeds without a screenshot and never touches the money', async () => {
  const user = seedUser();
  const id = seedReg(user.email);
  const before = readReg(id);
  const { status, data } = await apiPost(ENDPOINT, { registrationId: id }, { headers: { cookie: user.cookie } });
  assert.equal(status, 200);
  assert.equal(data.success, true);
  const afterRow = readReg(id);
  assert.ok(afterRow.balance_reported_at, 'claim date recorded');
  assert.equal(afterRow.balance_payment_screenshot_url, null);
  for (const field of ['status', 'amount_paid', 'payment_status', 'total_amount', 'payment_screenshot_url', 'events']) {
    assert.deepEqual(afterRow[field], before[field], `${field} must not change`);
  }
});

test('TC-265 a second report keeps the first claim date and replaces the screenshot', async () => {
  const user = seedUser();
  const id = seedReg(user.email);
  const conn = db();
  conn.prepare("UPDATE registrations SET balance_reported_at = '2026-01-02 03:04:05' WHERE id = ?").run(id);
  conn.close();

  const first = await uploadPng();
  await apiPost(ENDPOINT, { registrationId: id, screenshotUrl: first }, { headers: { cookie: user.cookie } });
  assert.equal(readReg(id).balance_payment_screenshot_url, first);

  const second = await uploadPng();
  const { status } = await apiPost(ENDPOINT, { registrationId: id, screenshotUrl: second }, { headers: { cookie: user.cookie } });
  assert.equal(status, 200);
  let row = readReg(id);
  assert.equal(row.balance_reported_at, '2026-01-02 03:04:05');
  assert.equal(row.balance_payment_screenshot_url, second);

  // Resending without a file keeps the screenshot already sent.
  await apiPost(ENDPOINT, { registrationId: id }, { headers: { cookie: user.cookie } });
  row = readReg(id);
  assert.equal(row.balance_payment_screenshot_url, second);
});

test('TC-266 pay page: owner sees it, another traveller gets 404', async () => {
  const owner = seedUser();
  const other = seedUser();
  const id = seedReg(owner.email);
  const mine = await fetch(`${BASE}/profile/pay/${id}`, { headers: { cookie: owner.cookie, accept: 'text/html' }, redirect: 'manual' });
  assert.equal(mine.status, 200);
  assert.match(await mine.text(), /₹24,000/);
  const theirs = await fetch(`${BASE}/profile/pay/${id}`, { headers: { cookie: other.cookie, accept: 'text/html' }, redirect: 'manual' });
  assert.equal(theirs.status, 404);
  assert.doesNotMatch(await theirs.text(), /₹24,000/);
});

test('TC-267 admin can clear a report; the ledger is untouched', async () => {
  const user = seedUser();
  const id = seedReg(user.email);
  await apiPost(ENDPOINT, { registrationId: id, screenshotUrl: await uploadPng() }, { headers: { cookie: user.cookie } });
  const before = readReg(id);
  assert.ok(before.balance_reported_at);

  // Middleware bounces a signed-out admin request to the login page.
  const unauth = await apiPost('/api/admin/registrations/balance-report', { id }, { redirect: 'manual' });
  assert.equal(unauth.status, 302);
  assert.ok(readReg(id).balance_reported_at, 'an unauthenticated request must not clear the report');

  const { cookie } = await adminLogin();
  const { status, data } = await apiPost('/api/admin/registrations/balance-report', { id }, { headers: { cookie } });
  assert.equal(status, 200);
  assert.equal(data.success, true);
  const cleared = readReg(id);
  assert.equal(cleared.balance_reported_at, null);
  assert.equal(cleared.balance_payment_screenshot_url, null);
  assert.equal(cleared.amount_paid, before.amount_paid);
  assert.equal(cleared.payment_status, before.payment_status);
  assert.equal(cleared.events, before.events);
});
