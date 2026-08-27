// POST /api/wishlist — coming-soon departure wishlists
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiPost } from './helpers.mjs';

const TRIP = 'qa-test-coming-soon';
const COMING_SOON_BATCH = 'qa-cs-soon-2099';
const BOOKABLE_BATCH = 'qa-cs-open-2099';

const base = (over = {}) => ({
  tripSlug: TRIP,
  batchId: COMING_SOON_BATCH,
  name: 'QA Wishlister',
  email: 'qa-wishlist@example.invalid',
  phone: '+91 90000 00001',
  ...over,
});

test('valid signed-out submission → 200, status wishlist', async () => {
  const { status, data } = await apiPost('/api/wishlist', base({ email: 'qa-wl-ok@example.invalid' }));
  assert.equal(status, 200);
  assert.equal(data.success, true);
  assert.equal(data.status, 'wishlist');
});

test('missing phone → 400', async () => {
  const { status, data } = await apiPost('/api/wishlist', base({ email: 'qa-wl-nophone@example.invalid', phone: '' }));
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /phone/i);
});

test('missing name → 400', async () => {
  const { status, data } = await apiPost('/api/wishlist', base({ email: 'qa-wl-noname@example.invalid', name: '' }));
  assert.equal(status, 400);
  assert.match(data.error, /name/i);
});

test('invalid email → 400', async () => {
  const { status, data } = await apiPost('/api/wishlist', base({ email: 'not-an-email' }));
  assert.equal(status, 400);
  assert.match(data.error, /email/i);
});

test('honeypot filled → 400', async () => {
  const { status } = await apiPost('/api/wishlist', base({ email: 'qa-wl-bot@example.invalid', _honey: 'x' }));
  assert.equal(status, 400);
});

test('batchId that is open for booking → 409', async () => {
  const { status, data } = await apiPost('/api/wishlist', base({ email: 'qa-wl-open@example.invalid', batchId: BOOKABLE_BATCH }));
  assert.equal(status, 409);
  assert.equal(data.success, false);
});

test('unknown trip → 404', async () => {
  const { status } = await apiPost('/api/wishlist', base({ tripSlug: 'no-such-trip', email: 'qa-wl-404@example.invalid' }));
  assert.equal(status, 404);
});

test('duplicate submission is idempotent → 200 success, no error', async () => {
  const body = base({ email: 'qa-wl-dup@example.invalid' });
  await apiPost('/api/wishlist', body);
  const { status, data } = await apiPost('/api/wishlist', body);
  assert.equal(status, 200);
  assert.equal(data.success, true);
});

test('POST /api/register for a coming-soon departure → 400', async () => {
  const { status, data } = await apiPost('/api/register', {
    tripSlug: TRIP,
    tripName: 'QA Test — Coming Soon Trip',
    batchId: COMING_SOON_BATCH,
    fullName: 'QA Person',
    email: 'qa-reg-cs@example.invalid',
    phone: '+91 90000 00002',
    age: '28',
    city: 'Pune',
    state: 'Maharashtra',
    emergencyName: 'QA Kin',
    emergencyPhone: '+91 90000 00003',
    whyJoin: 'testing',
    intent: 'details',
  });
  assert.equal(status, 400);
  assert.equal(data.success, false);
  assert.match(data.error, /not open|wishlist/i);
});
