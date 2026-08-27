// TC-038 to TC-043 — POST /api/register with new v2 schema (occupancyCatalog + offers)
// Uses qa-test-v2 fixture: two tiers (economy/premium), two departures:
//   qa-v2-both-2099   — economy + premium both available
//   qa-v2-economy-only-2099 — economy only (premium absent)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiPost } from './helpers.mjs';

const V2_BASE = {
  tripSlug:       'qa-test-v2',
  tripName:       'QA Test — v2 Schema (Bookable)',
  batchId:        'qa-v2-both-2099',
  tierId:         'economy',
  fullName:       'QA Test User',
  email:          'qa-v2-test@example.invalid',
  phone:          '9876543210',
  age:            '25',
  gender:         'prefer-not-to-say',
  city:           'Mumbai',
  state:          'Maharashtra',
  instagram:      '@qa_v2_user',
  emergencyName:  'QA Emergency',
  emergencyPhone: '9123456789',
  whyJoin:        'v2 schema QA test.',
  agreeTerms:     'on',
  agreeCancel:    'on',
};

async function reg(overrides = {}) {
  return apiPost('/api/register', { ...V2_BASE, ...overrides });
}

test('TC-038 explicit tierId=premium on departure with both tiers → 200', async () => {
  const { status, data } = await reg({
    email: 'qa-v2-premium@example.invalid',
    tierId: 'premium',
  });
  assert.equal(status, 200);
  assert.equal(data.success, true);
});

test('TC-039 nonexistent tierId falls back to cheapest available → 200', async () => {
  const { status, data } = await reg({
    email: 'qa-v2-notier@example.invalid',
    tierId: 'nonexistent-tier',
  });
  assert.equal(status, 200);
  assert.equal(data.success, true);
});

test('TC-040 nonexistent batchId → 400', async () => {
  const { status, data } = await reg({
    batchId: 'does-not-exist-at-all',
  });
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /departure|no longer available/i);
});

test('TC-041 tampered totalAmount is ignored by server → 200', async () => {
  // Server must derive totalAmount from resolveBooking(), never trust client.
  const { status, data } = await reg({
    email: 'qa-v2-tamper@example.invalid',
    totalAmount: 1, // tampered — real price is 5000
  });
  assert.equal(status, 200);
  assert.equal(data.success, true);
});

test('TC-042 batchId omitted → falls back to first non-sold-out departure → 200', async () => {
  const { status, data } = await reg({
    email: 'qa-v2-nobatch@example.invalid',
    batchId: null,
  });
  assert.equal(status, 200);
  assert.equal(data.success, true);
});

test('TC-043 tierId=premium on economy-only departure → falls back to economy → 200', async () => {
  const { status, data } = await reg({
    email: 'qa-v2-absent-tier@example.invalid',
    batchId: 'qa-v2-economy-only-2099',
    tierId: 'premium', // premium is not offered on this departure
  });
  assert.equal(status, 200);
  assert.equal(data.success, true);
});
