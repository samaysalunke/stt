// TC-044 to TC-048 — Registration status model (lead / pending / capacity)
//
// Verifies the Confirmed-Seats Capacity Spec:
//   - No screenshot → status = 'lead' (holds nothing)
//   - Screenshot uploaded → status = 'pending' (holds nothing)
//   - Admin can set status back to 'lead'
//   - Confirming beyond tier cap → 400 (last-spot race guard)
import { test, before } from 'node:test';
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

async function adminUpdateStatus(id, status, cookie) {
  const res = await fetch(`${BASE}/api/admin/update-registration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ id, status, admin_notes: 'QA test' }),
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
  const first = await adminUpdateStatus(row1.id, 'confirmed', cookie);
  assert.equal(first.status, 200, `First confirm failed: ${JSON.stringify(first.data)}`);
  assert.equal(first.data.success, true);

  // Confirm second for same tier — cap=1 already filled → should fail
  const second = await adminUpdateStatus(row2.id, 'confirmed', cookie);
  assert.equal(second.status, 400, `Expected 400 for over-confirm, got ${second.status}: ${JSON.stringify(second.data)}`);
  assert.equal(second.data.success, false);
  assert.match(second.data.error, /full|cap/i);
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
