// TC-100 to TC-101 — Admin trip update with occupancyCatalog_json + departures_json
// Tests that parseEditorBooking is correctly wired through the update API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminLogin, BASE } from './helpers.mjs';

const VALID_CATALOG = JSON.stringify([
  { id: 'economy', label: 'Economy', helperText: 'Budget option.' },
  { id: 'premium', label: 'Premium', helperText: 'Private room.' },
]);

const VALID_DEPARTURES = JSON.stringify([
  {
    id: 'qa-v2-both-2099',
    startDate: '2099-01-01',
    endDate: '2099-01-03',
    status: 'booking-open',
    offers: [
      { tierId: 'economy', price: 5000, cap: 20, booked: 0 },
      { tierId: 'premium', price: 8000, cap: 5,  booked: 0 },
    ],
  },
  {
    id: 'qa-v2-economy-only-2099',
    startDate: '2099-02-01',
    endDate: '2099-02-03',
    status: 'booking-open',
    offers: [
      { tierId: 'economy', price: 5000, cap: 20, booked: 0 },
    ],
  },
]);

async function updateTrip(slug, catalogJson, departuresJson, cookie) {
  const fd = new FormData();
  fd.append('slug', slug);
  fd.append('status', 'booking-open');
  fd.append('paymentAmount', '1000');
  fd.append('balanceDueRule', '15 days before trip');
  fd.append('occupancyCatalog_json', catalogJson);
  fd.append('departures_json', departuresJson);
  fd.append('itinerary_json', '[]');
  return fetch(`${BASE}/api/admin/trips/update`, {
    method: 'POST',
    body: fd,
    headers: { cookie },
    redirect: 'manual',
  });
}

test('TC-100 authenticated update with valid catalog+departures JSON → redirect (success)', async () => {
  const { cookie } = await adminLogin();
  const res = await updateTrip('qa-test-v2', VALID_CATALOG, VALID_DEPARTURES, cookie);
  assert.ok(
    res.status >= 300 && res.status < 400,
    `Expected redirect, got ${res.status}`,
  );
  assert.match(
    res.headers.get('location') ?? '',
    /\/admin\/trips/,
    'Should redirect back to admin trips',
  );
});

test('TC-101 malformed departures_json → rejected without a false success redirect', async () => {
  const { cookie } = await adminLogin();
  const res = await updateTrip('qa-test-v2', VALID_CATALOG, 'NOT VALID JSON', cookie);
  assert.ok(
    res.status >= 300 && res.status < 400,
    `Expected redirect, got ${res.status} — server must not crash on malformed input`,
  );
  assert.match(
    res.headers.get('location') ?? '',
    /error=incomplete-departure/,
    'Malformed departures must not be reported as saved',
  );
});

test('TC-102 unauthenticated update → redirect to login (not 200)', async () => {
  const res = await updateTrip('qa-test-v2', VALID_CATALOG, VALID_DEPARTURES, '');
  assert.ok(
    res.status >= 300 && res.status < 400,
    `Expected redirect, got ${res.status}`,
  );
  assert.match(
    res.headers.get('location') ?? '',
    /\/admin\/login/,
    'Should redirect to login, not proceed',
  );
});

// Restore the qa-test-v2 fixture after admin tests so register-v2 tests remain stable.
// This test runs last in the file and re-saves the original data.
test('TC-103 restore qa-test-v2 fixture after admin tests', async () => {
  const { cookie } = await adminLogin();
  const res = await updateTrip('qa-test-v2', VALID_CATALOG, VALID_DEPARTURES, cookie);
  assert.ok(res.status >= 300 && res.status < 400, 'Restore should succeed');
});
