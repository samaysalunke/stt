// TC-200+ — Admin-side registrations (single create + bulk CSV import)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { apiPost, adminLogin, BASE } from './helpers.mjs';

const BOOKABLE = { tripSlug: 'qa-test-bookable', batchId: 'qa-bookable-2099', tierId: 'standard', tripTitle: 'QA Test — Bookable Trip' };
const CAP = { tripSlug: 'qa-test-capacity', batchId: 'qa-cap-2099', tierId: 'solo', tripTitle: 'QA Test — Capacity Check' };
const PAST = { tripSlug: 'qa-test-backfill', batchId: 'qa-backfill-2000', tierId: 'standard', tripTitle: 'QA Test — Backfill (Past)' };

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
  await cleanup(PAST);
});

// Restore tracked YAML fixtures: a confirmed create bumps bookedSpots (committed
// as 0); reset so the working tree stays clean.
after(async () => {
  await cleanup(BOOKABLE);
  await cleanup(CAP);
  await cleanup(PAST);
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

test('TC-210a import dry-run can infer occupancy from the CSV tier column', async () => {
  const email = `qa-import-tier-${Date.now()}@example.invalid`;
  const csv = ['full_name,email,phone,tier_id', `Tier Row,${email},9876543210,standard`].join('\n');
  const { status, data } = await adminPost('/api/admin/registrations/import', {
    tripSlug: BOOKABLE.tripSlug, batchId: BOOKABLE.batchId,
    status: 'pending', csv, dryRun: true,
  });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.counts.create, 1);
  assert.equal(data.preview[0].tierId, 'standard');
});

test('TC-210b stay answer resolves against the trip catalog (label match)', async () => {
  // CAP trip catalog: { id: solo, label: "Solo Tent" }. The stay column carries
  // the label, not the id — must still resolve to `solo` trip-aware.
  const email = `qa-import-stay-${Date.now()}@example.invalid`;
  const csv = ['full_name,email,phone,stay', `Stay Row,${email},9876543210,Solo Tent`].join('\n');
  const { status, data } = await adminPost('/api/admin/registrations/import', {
    tripSlug: CAP.tripSlug, batchId: CAP.batchId,
    status: 'pending', csv, dryRun: true,
  });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.counts.create, 1, JSON.stringify(data));
  assert.equal(data.preview[0].tierId, 'solo');
});

test('TC-210c unmatched stay answer errors trip-aware (no UI fallback)', async () => {
  const email = `qa-import-badstay-${Date.now()}@example.invalid`;
  const csv = ['full_name,email,phone,stay', `Bad Stay,${email},9876543210,Penthouse`].join('\n');
  const { status, data } = await adminPost('/api/admin/registrations/import', {
    tripSlug: CAP.tripSlug, batchId: CAP.batchId,
    status: 'pending', csv, dryRun: true,
  });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.counts.error, 1, JSON.stringify(data));
  assert.equal(data.preview[0].action, 'error');
  assert.match(data.preview[0].reason, /doesn't match any occupancy option/);
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

test('TC-212 capacity mismatch rejects all writes unless explicitly overridden', async () => {
  await cleanup(CAP); // cap = 1, booked reset to 0
  const a = `qa-cap-a-${Date.now()}@example.invalid`;
  const b = `qa-cap-b-${Date.now()}@example.invalid`;
  const csv = ['full_name,email,phone', `Cap A,${a},9876543210`, `Cap B,${b},9876543210`].join('\n');
  const rejected = await adminPost('/api/admin/registrations/import', {
    tripSlug: CAP.tripSlug, batchId: CAP.batchId, tierId: CAP.tierId,
    status: 'confirmed', csv, dryRun: false, sendEmail: false,
  });
  assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
  assert.equal((await getRegByEmail(a)).found, false);
  assert.equal((await getRegByEmail(b)).found, false);

  const overridden = await adminPost('/api/admin/registrations/import', {
    tripSlug: CAP.tripSlug, batchId: CAP.batchId, tierId: CAP.tierId,
    status: 'confirmed', csv, dryRun: false, sendEmail: false, capacityOverride: true,
  });
  assert.equal(overridden.status, 200, JSON.stringify(overridden.data));
  assert.equal(overridden.data.created, 2);
});

// ── Historical back-fill (past departures) ───────────────────────────────────
test('TC-213 confirmed back-fill onto a past departure succeeds', async () => {
  const email = `qa-backfill-${Date.now()}@example.invalid`;
  const { status, data } = await adminPost('/api/admin/registrations/create', {
    tripSlug: PAST.tripSlug, batchId: PAST.batchId, tierId: PAST.tierId,
    status: 'confirmed', full_name: 'Past Goer', email, phone: '9876543210', sendEmail: false,
  });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal((await getRegByEmail(email)).status, 'confirmed');
});

test('TC-214 capacity is NOT enforced for past departures (back-fill beyond cap)', async () => {
  await cleanup(PAST); // cap = 1
  const a = `qa-bf-a-${Date.now()}@example.invalid`;
  const b = `qa-bf-b-${Date.now()}@example.invalid`;
  const csv = ['full_name,email,phone', `BF A,${a},9876543210`, `BF B,${b},9876543210`].join('\n');
  const { status, data } = await adminPost('/api/admin/registrations/import', {
    tripSlug: PAST.tripSlug, batchId: PAST.batchId, tierId: PAST.tierId,
    status: 'confirmed', csv, dryRun: false, sendEmail: false,
  });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.created, 2);       // both recorded despite cap = 1
  assert.equal(data.counts.error, 0);
});

test('TC-215 payment actions do not change status and status changes preserve payment', async () => {
  const email = `qa-payment-${Date.now()}@example.invalid`;
  const made = await adminPost('/api/admin/registrations/create', {
    tripSlug: BOOKABLE.tripSlug, batchId: BOOKABLE.batchId, tierId: BOOKABLE.tierId,
    status: 'pending', full_name: 'Payment User', email, phone: '9876543210',
  });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const id = made.data.id;
  const paymentRequestId = `qa-full-${id}`;
  const full = await adminPost('/api/admin/registrations/payment', { ids: [id], action: 'full', requestId: paymentRequestId, method: 'upi', transactionReference: 'QA-TXN-1' });
  assert.equal(full.status, 200, JSON.stringify(full.data));
  assert.equal(full.data.results[0].state, 'full');
  let reg = await getRegByEmail(email);
  assert.equal(reg.status, 'pending');
  assert.equal(reg.amount_paid, 5000);
  const duplicate = await adminPost('/api/admin/registrations/payment', { ids: [id], action: 'full', requestId: paymentRequestId, method: 'upi', transactionReference: 'QA-TXN-1' });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.results[0].duplicate, true);
  assert.equal((await getRegByEmail(email)).amount_paid, 5000, 'idempotent retry must not overstate payment');

  assert.equal((await adminPost('/api/admin/update-registration', { id, status: 'confirmed' })).status, 200);
  reg = await getRegByEmail(email);
  assert.equal(reg.amount_paid, 5000, 'confirming must not reduce full payment to advance');
  assert.equal((await adminPost('/api/admin/update-registration', { id, status: 'lead' })).status, 200);
  reg = await getRegByEmail(email);
  assert.equal(reg.amount_paid, 5000, 'unconfirming must not clear payment');

  const unpaid = await adminPost('/api/admin/registrations/payment', { ids: [id], action: 'unpaid' });
  assert.equal(unpaid.status, 200);
  reg = await getRegByEmail(email);
  assert.equal(reg.status, 'lead');
  assert.equal(reg.amount_paid, 0);
});
