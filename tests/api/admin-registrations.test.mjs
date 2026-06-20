// TC-200+ — Admin-side registrations (single create + bulk CSV import)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { apiPost, adminLogin, BASE } from './helpers.mjs';

const BOOKABLE = { tripSlug: 'qa-test-bookable', batchId: 'qa-bookable-2099', tierId: 'standard', tripTitle: 'QA Test — Bookable Trip' };
const CAP = { tripSlug: 'qa-test-capacity', batchId: 'qa-cap-2099', tierId: 'solo', tripTitle: 'QA Test — Capacity Check' };

let cookie = '';

async function cleanup(fix) {
  await fetch(`${BASE}/api/test/cleanup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId: fix.batchId, tierId: fix.tierId, tripTitle: fix.tripTitle }),
  });
}

async function getRegByEmail(email) {
  const res = await fetch(`${BASE}/api/test/reg-by-email?email=${encodeURIComponent(email)}`);
  return res.json();
}

function adminPost(path, body) {
  return apiPost(path, body, { headers: { cookie } });
}

before(async () => {
  cookie = (await adminLogin()).cookie;
  await cleanup(BOOKABLE);
  await cleanup(CAP);
});

// Restore the tracked YAML fixture: a confirmed create bumps qa-test-bookable's
// bookedSpots (committed as 0); reset it so the working tree stays clean.
after(async () => {
  await cleanup(BOOKABLE);
});

// ── Auth gate ───────────────────────────────────────────────────────────────
test('TC-200 unauthenticated create is rejected (no 200)', async () => {
  const { status } = await apiPost('/api/admin/registrations/create', { tripSlug: BOOKABLE.tripSlug }, { redirect: 'manual' });
  assert.notEqual(status, 200);
});

// ── Single create ────────────────────────────────────────────────────────────
test('TC-201 single create (pending) stores a registration', async () => {
  const email = `qa-admin-pending-${Date.now()}@example.invalid`;
  const { status, data } = await adminPost('/api/admin/registrations/create', {
    tripSlug: BOOKABLE.tripSlug, batchId: BOOKABLE.batchId, tierId: BOOKABLE.tierId,
    status: 'pending', full_name: 'Admin Pending', email, phone: '9876543210',
  });
  assert.equal(status, 200, JSON.stringify(data));
  const reg = await getRegByEmail(email);
  assert.equal(reg.status, 'pending');
  assert.equal(reg.source, 'admin');
});

test('TC-202 single create (confirmed) records the advance as amount_paid', async () => {
  const email = `qa-admin-confirmed-${Date.now()}@example.invalid`;
  const { status, data } = await adminPost('/api/admin/registrations/create', {
    tripSlug: BOOKABLE.tripSlug, batchId: BOOKABLE.batchId, tierId: BOOKABLE.tierId,
    status: 'confirmed', full_name: 'Admin Confirmed', email, phone: '9876543210', sendEmail: false,
  });
  assert.equal(status, 200, JSON.stringify(data));
  const reg = await getRegByEmail(email);
  assert.equal(reg.status, 'confirmed');
  assert.equal(reg.amount_paid, 1000); // paymentAmount on qa-test-bookable
});

test('TC-203 invalid email is rejected', async () => {
  const { status } = await adminPost('/api/admin/registrations/create', {
    tripSlug: BOOKABLE.tripSlug, batchId: BOOKABLE.batchId, tierId: BOOKABLE.tierId,
    status: 'pending', full_name: 'Bad Email', email: 'not-an-email', phone: '9876543210',
  });
  assert.equal(status, 400);
});

test('TC-204 duplicate active registration is blocked (409)', async () => {
  const email = `qa-admin-dup-${Date.now()}@example.invalid`;
  const payload = {
    tripSlug: BOOKABLE.tripSlug, batchId: BOOKABLE.batchId, tierId: BOOKABLE.tierId,
    status: 'pending', full_name: 'Dup User', email, phone: '9876543210',
  };
  const first = await adminPost('/api/admin/registrations/create', payload);
  assert.equal(first.status, 200);
  const second = await adminPost('/api/admin/registrations/create', payload);
  assert.equal(second.status, 409);
});

// ── Bulk import ──────────────────────────────────────────────────────────────
test('TC-210 import dry-run classifies create / skip / error without inserting', async () => {
  const good = `qa-import-good-${Date.now()}@example.invalid`;
  const dupExisting = `qa-import-dup-${Date.now()}@example.invalid`;
  // Pre-create an active registration so the CSV row for it is classified "skip".
  await adminPost('/api/admin/registrations/create', {
    tripSlug: BOOKABLE.tripSlug, batchId: BOOKABLE.batchId, tierId: BOOKABLE.tierId,
    status: 'pending', full_name: 'Already There', email: dupExisting, phone: '9876543210',
  });

  const csv = [
    'full_name,email,phone',
    `Good Row,${good},9876543210`,
    `Bad Email,not-an-email,9876543210`,
    `Existing,${dupExisting},9876543210`,
  ].join('\n');

  const { status, data } = await adminPost('/api/admin/registrations/import', {
    tripSlug: BOOKABLE.tripSlug, batchId: BOOKABLE.batchId, tierId: BOOKABLE.tierId,
    status: 'pending', csv, dryRun: true,
  });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.counts.create, 1);
  assert.equal(data.counts.error, 1);
  assert.equal(data.counts.skip, 1);
  // Dry run must not insert the good row.
  const reg = await getRegByEmail(good);
  assert.equal(reg.found, false);
});

test('TC-211 import commit inserts only the valid new rows', async () => {
  const a = `qa-commit-a-${Date.now()}@example.invalid`;
  const b = `qa-commit-b-${Date.now()}@example.invalid`;
  const csv = ['full_name,email,phone', `Commit A,${a},9876543210`, `Commit B,${b},9876543210`].join('\n');
  const { status, data } = await adminPost('/api/admin/registrations/import', {
    tripSlug: BOOKABLE.tripSlug, batchId: BOOKABLE.batchId, tierId: BOOKABLE.tierId,
    status: 'pending', csv, dryRun: false,
  });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.created, 2);
  assert.equal((await getRegByEmail(a)).status, 'pending');
  assert.equal((await getRegByEmail(b)).status, 'pending');
});

test('TC-212 confirmed import respects tier capacity', async () => {
  await cleanup(CAP); // cap = 1, booked reset to 0
  const a = `qa-cap-a-${Date.now()}@example.invalid`;
  const b = `qa-cap-b-${Date.now()}@example.invalid`;
  const csv = ['full_name,email,phone', `Cap A,${a},9876543210`, `Cap B,${b},9876543210`].join('\n');
  const { status, data } = await adminPost('/api/admin/registrations/import', {
    tripSlug: CAP.tripSlug, batchId: CAP.batchId, tierId: CAP.tierId,
    status: 'confirmed', csv, dryRun: false, sendEmail: false,
  });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.created, 1);       // only one fits
  assert.equal(data.counts.error, 1);  // the second is over capacity
});
