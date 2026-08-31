// TC-260+ — Admin: change a registration's occupancy tier on the same departure.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { apiPost, apiPatch, adminLogin, BASE } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DB_PATH = path.resolve(__dirname, '../../data/seekthethrill.db');
const YAML_PATH = path.resolve(__dirname, '../../src/content/trips/qa-test-occupancy.yaml');

const OCC = { tripSlug: 'qa-test-occupancy', tripTitle: 'QA Test — Occupancy Change', batchId: 'qa-occ-2099' };
const TIERS = ['dorm', 'private', 'solo'];

let cookie = '';
const adminPost = (path, body) => apiPost(path, body, { headers: { cookie } });
const patchOcc = (id, tierId) =>
  apiPatch('/api/admin/registrations/occupancy',
    { id, tierId, requestId: `qa-occ-${id}-${Math.random()}` },
    { headers: { cookie } });

async function cleanupTier(tierId) {
  await fetch(`${BASE}/api/test/cleanup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId: OCC.batchId, tierId, tripTitle: OCC.tripTitle }),
  });
}
const cleanupAll = () => Promise.all(TIERS.map(cleanupTier));

async function getRegByEmail(email) {
  const res = await fetch(`${BASE}/api/test/reg-by-email?email=${encodeURIComponent(email)}`);
  return res.json();
}

async function createReg(email, tierId, status) {
  const { status: st, data } = await adminPost('/api/admin/registrations/create', {
    tripSlug: OCC.tripSlug, batchId: OCC.batchId, tierId, status,
    full_name: 'QA Occ', email, phone: '9876543210', sendEmail: false,
  });
  assert.equal(st, 200, JSON.stringify(data));
  return (await getRegByEmail(email)).id;
}

function readBatch() {
  const doc = YAML.parse(fs.readFileSync(YAML_PATH, 'utf8'));
  const b = doc.batches.find((x) => x.id === OCC.batchId);
  return {
    booked: Object.fromEntries(b.offers.map((o) => [o.tierId, Number(o.booked) || 0])),
    bookedSpots: Number(b.bookedSpots) || 0,
  };
}

function withDb(fn) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  try { return fn(db); } finally { db.close(); }
}

const seedRow = (id, patch) => withDb((db) => {
  const cols = Object.keys(patch);
  db.prepare(`UPDATE registrations SET ${cols.map((c) => `${c}=?`).join(', ')} WHERE id=?`)
    .run(...cols.map((c) => patch[c]), id);
});

const auditRows = (action, targetId) => withDb((db) =>
  db.prepare('SELECT previousValue, newValue FROM audit_log WHERE action=? AND targetId=? ORDER BY createdAt DESC')
    .all(action, targetId));

const uniq = (tag) => `qa-occ-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.invalid`;

before(async () => { cookie = (await adminLogin()).cookie; });
beforeEach(cleanupAll);
after(cleanupAll);

test('TC-260 unauthenticated PATCH is rejected (no 200)', async () => {
  const { status } = await apiPatch(
    '/api/admin/registrations/occupancy', { id: 1, tierId: 'private' }, { redirect: 'manual' });
  assert.notEqual(status, 200);
});

test('TC-261 pending booking: dorm → private updates tier, label and price; counters untouched', async () => {
  const email = uniq('pending');
  const id = await createReg(email, 'dorm', 'pending');
  const before = readBatch();

  const { status, data } = await patchOcc(id, 'private');
  assert.equal(status, 200, JSON.stringify(data));

  const reg = await getRegByEmail(email);
  assert.equal(reg.tier_id, 'private');
  assert.equal(reg.total_amount, 7000);
  assert.equal(reg.sharing_option, 'Private Room');
  assert.deepEqual(readBatch(), before); // not confirmed → no seat held
});

test('TC-262 confirmed booking: dorm → private moves one seat, departure total unchanged', async () => {
  const email = uniq('confirmed');
  const id = await createReg(email, 'dorm', 'confirmed');
  const before = readBatch();
  assert.ok(before.booked.dorm >= 1, 'confirmed create should have bumped dorm');

  const { status, data } = await patchOcc(id, 'private');
  assert.equal(status, 200, JSON.stringify(data));

  const after = readBatch();
  assert.equal(after.booked.dorm, before.booked.dorm - 1);
  assert.equal(after.booked.private, before.booked.private + 1);
  assert.equal(after.bookedSpots, before.bookedSpots);
});

test('TC-263 confirmed + fully paid ₹5,000 → ₹7,000 tier: re-derives to advance_paid, warns balance due', async () => {
  const email = uniq('upgrade');
  const id = await createReg(email, 'dorm', 'confirmed');
  await adminPost('/api/admin/registrations/payment', {
    ids: [id], action: 'full', method: 'bank_transfer', requestId: `qa-fp-${id}`,
  });
  let reg = await getRegByEmail(email);
  assert.equal(reg.payment_status, 'fully_paid');
  assert.equal(reg.amount_paid, 5000);

  const { status, data } = await patchOcc(id, 'private');
  assert.equal(status, 200, JSON.stringify(data));
  assert.ok(data.warnings.some((w) => /balance/i.test(w)), JSON.stringify(data.warnings));

  reg = await getRegByEmail(email);
  assert.equal(reg.payment_status, 'advance_paid');
  assert.equal(reg.total_amount, 7000);
});

test('TC-264 downgrade ₹7,000 → ₹5,000 with ₹7,000 paid: stays fully_paid, warns overpayment', async () => {
  const email = uniq('downgrade');
  const id = await createReg(email, 'private', 'confirmed');
  await adminPost('/api/admin/registrations/payment', {
    ids: [id], action: 'full', method: 'bank_transfer', requestId: `qa-fp-${id}`,
  });
  assert.equal((await getRegByEmail(email)).amount_paid, 7000);

  const { status, data } = await patchOcc(id, 'dorm');
  assert.equal(status, 200, JSON.stringify(data));
  assert.ok(data.warnings.some((w) => /exceeds/i.test(w)), JSON.stringify(data.warnings));

  const reg = await getRegByEmail(email);
  assert.equal(reg.payment_status, 'fully_paid');
  assert.equal(reg.total_amount, 5000);
});

test('TC-265 a refund payment_status is preserved, not re-derived', async () => {
  const email = uniq('refund');
  const id = await createReg(email, 'dorm', 'pending');
  seedRow(id, { status: 'confirmed', payment_status: 'partial_refund', amount_paid: 3000 });

  const { status, data } = await patchOcc(id, 'private');
  assert.equal(status, 200, JSON.stringify(data));

  assert.equal((await getRegByEmail(email)).payment_status, 'partial_refund');
});

test('TC-266 confirmed booking → a full (cap 0) tier is refused; counters untouched', async () => {
  const email = uniq('full');
  const id = await createReg(email, 'dorm', 'confirmed');
  const before = readBatch();

  const { status, data } = await patchOcc(id, 'solo');
  assert.equal(status, 400, JSON.stringify(data));
  assert.match(data.error, /full/i);

  assert.deepEqual(readBatch(), before);
  assert.equal((await getRegByEmail(email)).tier_id, 'dorm');
});

test('TC-267 unknown tier → 400, unchanged tier → noop, cancelled row → 400', async () => {
  const email = uniq('guards');
  const id = await createReg(email, 'dorm', 'pending');

  assert.equal((await patchOcc(id, 'does-not-exist')).status, 400);

  const same = await patchOcc(id, 'dorm');
  assert.equal(same.status, 200);
  assert.equal(same.data.noop, true);

  await adminPost('/api/admin/update-registration', { id, status: 'cancelled', requestId: `qa-cancel-${id}` });
  const cancelled = await patchOcc(id, 'private');
  assert.equal(cancelled.status, 400);
  assert.match(cancelled.data.error, /re-instate/i);
});

test('TC-268 writes a booking.occupancy_changed audit row with old + new values', async () => {
  const email = uniq('audit');
  const id = await createReg(email, 'dorm', 'pending');
  await patchOcc(id, 'private');

  const rows = auditRows('booking.occupancy_changed', String(id));
  assert.ok(rows.length >= 1, 'expected an audit row');
  const prev = JSON.parse(rows[0].previousValue);
  const next = JSON.parse(rows[0].newValue);
  assert.equal(prev.tier_id, 'dorm');
  assert.equal(next.tier_id, 'private');
  assert.equal(next.total_amount, 7000);
});
