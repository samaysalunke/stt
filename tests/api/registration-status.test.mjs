// TC-044 to TC-048 — Registration status model (lead / pending / capacity)
//
// Verifies the Confirmed-Seats Capacity Spec:
//   - No screenshot → status = 'lead' (holds nothing)
//   - Screenshot uploaded → status = 'pending' (holds nothing)
//   - Admin can set status back to 'lead'
//   - Confirming beyond tier cap → 400 (last-spot race guard)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { apiPost, apiGet, adminLogin, BASE } from './helpers.mjs';

// Reset the capacity fixture before this suite so offer.booked=0 regardless of prior runs.
before(async () => {
  await fetch(`${BASE}/api/test/cleanup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId: 'qa-cap-2099', tierId: 'solo', tripTitle: 'QA Test — Capacity Check' }),
  });
});

const CAP_BASE = {
  tripSlug:       'qa-test-capacity',
  tripName:       'QA Test — Capacity Check',
  batchId:        'qa-cap-2099',
  tierId:         'solo',
  fullName:       'QA Cap User',
  phone:          '9876543210',
  age:            '28',
  city:           'Delhi',
  state:          'Delhi',
  instagram:      '@qa_cap',
  emergencyName:  'QA Emergency',
  emergencyPhone: '9123456789',
  whyJoin:        'Capacity QA test.',
  agreeTerms:     'on',
  agreeCancel:    'on',
};

async function getRegByEmail(email) {
  const res = await fetch(`${BASE}/api/test/reg-by-email?email=${encodeURIComponent(email)}`);
  return res.json();
}

async function adminUpdateStatus(id, status, cookie, extra = {}) {
  const res = await fetch(`${BASE}/api/admin/update-registration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ id, status, admin_notes: 'QA test', requestId: `qa-${id}-${status}-${Date.now()}-${Math.random()}`, ...extra }),
  });
  return { status: res.status, data: await res.json() };
}

// ── TC-044: No screenshot → status = 'lead' ────────────────────────────────
test('TC-044 registration without screenshot is stored as lead', async () => {
  const email = `qa-lead-${Date.now()}@example.invalid`;
  const { status, data } = await apiPost('/api/register', {
    ...CAP_BASE,
    email,
    // no paymentScreenshotUrl
  });
  assert.equal(status, 200, `Register failed: ${JSON.stringify(data)}`);
  assert.equal(data.success, true);

  const row = await getRegByEmail(email);
  assert.ok(row, 'Registration row not found in DB');
  assert.equal(row.status, 'lead', `Expected status=lead, got ${row.status}`);
  assert.equal(row.tier_id, 'solo', `Expected tier_id=solo, got ${row.tier_id}`);
  assert.equal(row.batch_id, 'qa-cap-2099', `Expected batch_id=qa-cap-2099, got ${row.batch_id}`);
});

// ── TC-045: Screenshot present → status = 'pending' ───────────────────────
test('TC-045 registration with screenshot is stored as pending', async () => {
  const email = `qa-pending-${Date.now()}@example.invalid`;
  const { status, data } = await apiPost('/api/register', {
    ...CAP_BASE,
    email,
    paymentScreenshotUrl: 'https://example.invalid/fake-screenshot.jpg',
  });
  assert.equal(status, 200, `Register failed: ${JSON.stringify(data)}`);
  assert.equal(data.success, true);

  const row = await getRegByEmail(email);
  assert.ok(row, 'Registration row not found in DB');
  assert.equal(row.status, 'pending', `Expected status=pending, got ${row.status}`);
});

// ── TC-046: Admin can set status to 'lead' ─────────────────────────────────
test('TC-046 admin can update a registration status to lead', async () => {
  // Create a pending registration first
  const email = `qa-to-lead-${Date.now()}@example.invalid`;
  await apiPost('/api/register', {
    ...CAP_BASE,
    email,
    paymentScreenshotUrl: 'https://example.invalid/fake-screenshot.jpg',
  });
  const row = await getRegByEmail(email);
  assert.ok(row, 'Registration not found');

  const { cookie } = await adminLogin('changeme');
  const { status, data } = await adminUpdateStatus(row.id, 'lead', cookie);
  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`);
  assert.equal(data.success, true);

  // Verify DB updated
  const updated = await getRegByEmail(email);
  assert.equal(updated.status, 'lead', `Expected lead after update, got ${updated.status}`);
});

// ── TC-047: Cap=1 tier — second confirm is blocked ─────────────────────────
test('TC-047 confirming beyond tier cap returns 400 (last-spot race guard)', async () => {
  const { cookie } = await adminLogin('changeme');

  // Reset any previously-confirmed bookings for this fixture so the test is idempotent
  await fetch(`${BASE}/api/test/cleanup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId: 'qa-cap-2099', tierId: 'solo', tripTitle: 'QA Test — Capacity Check' }),
  });

  // Register two separate users for the same cap=1 tier
  const email1 = `qa-cap-a-${Date.now()}@example.invalid`;
  const email2 = `qa-cap-b-${Date.now() + 1}@example.invalid`;

  await apiPost('/api/register', {
    ...CAP_BASE, email: email1,
    paymentScreenshotUrl: 'https://example.invalid/ss1.jpg',
  });
  await apiPost('/api/register', {
    ...CAP_BASE, email: email2,
    paymentScreenshotUrl: 'https://example.invalid/ss2.jpg',
  });

  const row1 = await getRegByEmail(email1);
  const row2 = await getRegByEmail(email2);
  assert.ok(row1 && row2, 'One or both registrations not found');

  // Confirm first → should succeed
  const first = await adminUpdateStatus(row1.id, 'confirmed', cookie, { payment_status: 'advance_paid' });
  assert.equal(first.status, 200, `First confirm failed: ${JSON.stringify(first.data)}`);
  assert.equal(first.data.success, true);

  // Confirm second for same tier — cap=1 already filled → should fail
  const second = await adminUpdateStatus(row2.id, 'confirmed', cookie, { payment_status: 'advance_paid' });
  assert.equal(second.status, 400, `Expected 400 for over-confirm, got ${second.status}: ${JSON.stringify(second.data)}`);
  assert.equal(second.data.success, false);
  assert.match(second.data.error, /full|cap/i);
});

// ── Phase 2: payment_status + cancelled + refunds ─────────────────────────
const BK = {
  tripSlug: 'qa-test-bookable', tripName: 'QA Test — Bookable Trip', batchId: 'qa-bookable-2099', tierId: 'standard',
  fullName: 'QA P2 User', phone: '9876543210', age: '30', city: 'Pune', state: 'Maharashtra',
  instagram: '@qa_p2', emergencyName: 'QA Emg', emergencyPhone: '9123456789',
  whyJoin: 'Phase 2 QA.', agreeTerms: 'on', agreeCancel: 'on',
};

// A confirmed booking bumps bookedSpots in the tracked YAML fixture — reset it
// before and after so the working tree stays clean.
async function resetBookable() {
  await fetch(`${BASE}/api/test/cleanup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId: 'qa-bookable-2099', tierId: 'standard', tripTitle: 'QA Test — Bookable Trip' }),
  });
}
before(resetBookable);
after(resetBookable);

async function makePending(email) {
  await apiPost('/api/register', { ...BK, email, paymentScreenshotUrl: 'https://example.invalid/p2.jpg' });
  return getRegByEmail(email);
}

test('P2 confirm without payment_status → 400', async () => {
  const { cookie } = await adminLogin('changeme');
  const row = await makePending(`qa-p2-nops-${Date.now()}@example.invalid`);
  const res = await adminUpdateStatus(row.id, 'confirmed', cookie);
  assert.equal(res.status, 400, JSON.stringify(res.data));
});

test('P2 confirm advance_paid records the advance and stores payment_status', async () => {
  const { cookie } = await adminLogin('changeme');
  const email = `qa-p2-adv-${Date.now()}@example.invalid`;
  const row = await makePending(email);
  const res = await adminUpdateStatus(row.id, 'confirmed', cookie, { payment_status: 'advance_paid' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const reg = await getRegByEmail(email);
  assert.equal(reg.status, 'confirmed');
  assert.equal(reg.payment_status, 'advance_paid');
  assert.ok(reg.amount_paid > 0);
});

test('P2 confirmed → lead while paid → 400; confirmed → rejected → 400', async () => {
  const { cookie } = await adminLogin('changeme');
  const email = `qa-p2-block-${Date.now()}@example.invalid`;
  const row = await makePending(email);
  await adminUpdateStatus(row.id, 'confirmed', cookie, { payment_status: 'advance_paid' });
  assert.equal((await adminUpdateStatus(row.id, 'lead', cookie)).status, 400);
  assert.equal((await adminUpdateStatus(row.id, 'rejected', cookie)).status, 400);
});

test('P2 confirmed → cancelled with a full refund clears the balance', async () => {
  const { cookie } = await adminLogin('changeme');
  const email = `qa-p2-refund-${Date.now()}@example.invalid`;
  const row = await makePending(email);
  await adminUpdateStatus(row.id, 'confirmed', cookie, { payment_status: 'advance_paid' });
  const paid = (await getRegByEmail(email)).amount_paid;
  const res = await adminUpdateStatus(row.id, 'cancelled', cookie, { refund: { kind: 'full', amount: paid } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const reg = await getRegByEmail(email);
  assert.equal(reg.status, 'cancelled');
  assert.equal(reg.amount_paid, 0);
  assert.equal(reg.amount_refunded, paid);
  assert.equal(reg.payment_status, 'full_refund');
});

test('P2 cancelled → confirmed re-instates and resets amount_refunded', async () => {
  const { cookie } = await adminLogin('changeme');
  const email = `qa-p2-reinstate-${Date.now()}@example.invalid`;
  const row = await makePending(email);
  await adminUpdateStatus(row.id, 'confirmed', cookie, { payment_status: 'advance_paid' });
  const paid = (await getRegByEmail(email)).amount_paid;
  await adminUpdateStatus(row.id, 'cancelled', cookie, { refund: { kind: 'full', amount: paid } });
  const res = await adminUpdateStatus(row.id, 'confirmed', cookie, { payment_status: 'advance_paid' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const reg = await getRegByEmail(email);
  assert.equal(reg.status, 'confirmed');
  assert.equal(reg.amount_refunded, 0);
  assert.equal(reg.payment_status, 'advance_paid');
});

test('P2 cancelled → lead is blocked', async () => {
  const { cookie } = await adminLogin('changeme');
  const email = `qa-p2-canlead-${Date.now()}@example.invalid`;
  const row = await makePending(email);
  await adminUpdateStatus(row.id, 'cancelled', cookie);
  assert.equal((await adminUpdateStatus(row.id, 'lead', cookie)).status, 400);
});

test('P2 rejected → confirmed is allowed', async () => {
  const { cookie } = await adminLogin('changeme');
  const email = `qa-p2-unreject-${Date.now()}@example.invalid`;
  const row = await makePending(email);
  await adminUpdateStatus(row.id, 'lead', cookie); // pending → lead (unpaid)
  await adminUpdateStatus(row.id, 'rejected', cookie);
  const res = await adminUpdateStatus(row.id, 'confirmed', cookie, { payment_status: 'advance_paid' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal((await getRegByEmail(email)).status, 'confirmed');
});

// ── TC-048: 'lead' invalid for unsupported old status values ───────────────
test('TC-048 posting invalid status to update-registration returns 400', async () => {
  const { cookie } = await adminLogin('changeme');
  const res = await fetch(`${BASE}/api/admin/update-registration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ id: 1, status: 'unknown-status', admin_notes: '' }),
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.success, false);
});
