// Phase 2 — standalone refund entry point (POST /api/admin/registrations/payment action:'refund').
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { apiPost, adminLogin, BASE } from './helpers.mjs';

const BK = {
  tripSlug: 'qa-test-bookable', tripName: 'QA Test — Bookable Trip', batchId: 'qa-bookable-2099', tierId: 'standard',
  fullName: 'QA Refund User', phone: '9876543210', age: '30', city: 'Pune', state: 'Maharashtra',
  instagram: '@qa_refund', emergencyName: 'QA Emg', emergencyPhone: '9123456789',
  whyJoin: 'Refund QA.', agreeTerms: 'on', agreeCancel: 'on',
};

async function resetBookable() {
  await fetch(`${BASE}/api/test/cleanup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId: 'qa-bookable-2099', tierId: 'standard', tripTitle: 'QA Test — Bookable Trip' }),
  });
}
before(resetBookable);
after(resetBookable);

async function getRegByEmail(email) {
  const res = await fetch(`${BASE}/api/test/reg-by-email?email=${encodeURIComponent(email)}`);
  return res.json();
}

let cookie;
before(async () => { cookie = (await adminLogin('changeme')).cookie; });
const adminPost = (path, body) => apiPost(path, body, { headers: { cookie } });
const update = (id, body) => adminPost('/api/admin/update-registration', { id, requestId: `qa-${id}-${Math.random()}`, ...body });

async function confirmedThenCancelled(email) {
  await apiPost('/api/register', { ...BK, email, paymentScreenshotUrl: 'https://example.invalid/r.jpg' });
  const row = await getRegByEmail(email);
  await update(row.id, { status: 'confirmed', payment_status: 'advance_paid' });
  await update(row.id, { status: 'cancelled' }); // no bundled refund
  return getRegByEmail(email);
}

test('refund on a non-cancelled row fails', async () => {
  const email = `qa-refund-live-${Date.now()}@example.invalid`;
  await apiPost('/api/register', { ...BK, email, paymentScreenshotUrl: 'https://example.invalid/r.jpg' });
  const row = await getRegByEmail(email);
  await update(row.id, { status: 'confirmed', payment_status: 'advance_paid' });
  const res = await adminPost('/api/admin/registrations/payment', {
    ids: [row.id], action: 'refund', refundKind: 'full', amount: 1, requestId: `qa-nc-${row.id}`,
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.results[0].success, false);
  assert.match(res.data.results[0].error, /cancelled/i);
});

test('standalone refund on a cancelled row records the refund', async () => {
  const email = `qa-refund-ok-${Date.now()}@example.invalid`;
  const reg = await confirmedThenCancelled(email);
  const paid = reg.amount_paid;
  const res = await adminPost('/api/admin/registrations/payment', {
    ids: [reg.id], action: 'refund', refundKind: 'full', amount: paid, requestId: `qa-ok-${reg.id}`,
  });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.results[0].success, true);
  const after = await getRegByEmail(email);
  assert.equal(after.amount_paid, 0);
  assert.equal(after.amount_refunded, paid);
  assert.equal(after.payment_status, 'full_refund');
});

test('duplicate requestId does not double-decrement', async () => {
  const email = `qa-refund-dup-${Date.now()}@example.invalid`;
  const reg = await confirmedThenCancelled(email);
  const paid = reg.amount_paid;
  const rid = `qa-dup-${reg.id}`;
  const body = { ids: [reg.id], action: 'refund', refundKind: 'partial', amount: Math.floor(paid / 2), requestId: rid };
  const a = await adminPost('/api/admin/registrations/payment', body);
  const b = await adminPost('/api/admin/registrations/payment', body);
  assert.equal(a.data.results[0].success, true);
  assert.equal(b.data.results[0].success, true);
  assert.equal(b.data.results[0].duplicate, true);
  const after = await getRegByEmail(email);
  assert.equal(after.amount_refunded, Math.floor(paid / 2));
});

test('partial refund >= amount_paid is rejected', async () => {
  const email = `qa-refund-big-${Date.now()}@example.invalid`;
  const reg = await confirmedThenCancelled(email);
  const res = await adminPost('/api/admin/registrations/payment', {
    ids: [reg.id], action: 'refund', refundKind: 'partial', amount: reg.amount_paid, requestId: `qa-big-${reg.id}`,
  });
  assert.equal(res.data.results[0].success, false);
  assert.match(res.data.results[0].error, /less than the amount paid/i);
});
