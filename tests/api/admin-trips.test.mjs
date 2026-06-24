// TC-100 to TC-101 — Admin trip update with occupancyCatalog_json + departures_json
// Tests that parseEditorBooking is correctly wired through the update API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { adminLogin, BASE } from './helpers.mjs';

// Mirror src/lib/_contentBase.ts so we can read back the YAML the handler wrote.
const CONTENT_BASE = process.env.CONTENT_DIR ?? path.join(process.cwd(), 'src', 'content');
const TRIPS_DIR = path.join(CONTENT_BASE, 'trips');
const readTripYaml = (slug) =>
  YAML.parse(readFileSync(path.join(TRIPS_DIR, `${slug}.yaml`), 'utf-8'));

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

test('TC-101 malformed departures_json → graceful 302 redirect (no 500 crash)', async () => {
  const { cookie } = await adminLogin();
  const res = await updateTrip('qa-test-v2', VALID_CATALOG, 'NOT VALID JSON', cookie);
  // parseEditorBooking silently catches JSON errors → saves with empty batches → redirect
  assert.ok(
    res.status >= 300 && res.status < 400,
    `Expected redirect, got ${res.status} — server must not crash on malformed input`,
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

// ── registrationEnabled round-trip (regression: field was dropped on save) ──────
// The update handler rebuilds trip YAML from a fixed whitelist and writeTrip does
// a full overwrite. Before the fix, `registrationEnabled` was absent from that
// whitelist, so every admin save silently erased it — admin showed "Booking Open"
// while the public page treated the missing value as closed.
const ROUNDTRIP_SLUG = 'qa-test-reg-roundtrip';

async function createTrip(slug, registrationEnabled, cookie) {
  const fd = new FormData();
  fd.append('name', 'QA Reg Roundtrip');
  fd.append('slug', slug);
  fd.append('publicationStatus', 'test');
  if (registrationEnabled) fd.append('registrationEnabled', 'true');
  fd.append('occupancyCatalog_json', VALID_CATALOG);
  fd.append('departures_json', VALID_DEPARTURES);
  fd.append('itinerary_json', '[]');
  return fetch(`${BASE}/api/admin/trips/create`, {
    method: 'POST', body: fd, headers: { cookie }, redirect: 'manual',
  });
}

// Like updateTrip, but with explicit control over the registrationEnabled checkbox.
async function updateTripReg(slug, registrationEnabled, cookie) {
  const fd = new FormData();
  fd.append('slug', slug);
  fd.append('name', 'QA Reg Roundtrip');
  fd.append('publicationStatus', 'test');
  if (registrationEnabled) fd.append('registrationEnabled', 'true');
  fd.append('occupancyCatalog_json', VALID_CATALOG);
  fd.append('departures_json', VALID_DEPARTURES);
  fd.append('itinerary_json', '[]');
  return fetch(`${BASE}/api/admin/trips/update`, {
    method: 'POST', body: fd, headers: { cookie }, redirect: 'manual',
  });
}

async function deleteTripApi(slug, cookie) {
  return fetch(`${BASE}/api/admin/trips/delete`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ slug }),
    redirect: 'manual',
  });
}

test('TC-104 registrationEnabled survives create + edit round-trip', async () => {
  const { cookie } = await adminLogin();
  try {
    // Create with the box ticked → persisted as true.
    await createTrip(ROUNDTRIP_SLUG, true, cookie);
    assert.equal(readTripYaml(ROUNDTRIP_SLUG).registrationEnabled, true, 'create should persist true');

    // Edit with the box unticked → persisted as explicit false (not dropped).
    await updateTripReg(ROUNDTRIP_SLUG, false, cookie);
    assert.equal(readTripYaml(ROUNDTRIP_SLUG).registrationEnabled, false, 'edit must persist false, not drop the field');

    // Edit again with the box ticked → back to true (this is the original bug).
    await updateTripReg(ROUNDTRIP_SLUG, true, cookie);
    assert.equal(readTripYaml(ROUNDTRIP_SLUG).registrationEnabled, true, 'edit must preserve true across save');
  } finally {
    await deleteTripApi(ROUNDTRIP_SLUG, cookie);
    assert.ok(!existsSync(path.join(TRIPS_DIR, `${ROUNDTRIP_SLUG}.yaml`)), 'cleanup should remove the throwaway trip');
  }
});

// Restore the qa-test-v2 fixture after admin tests so register-v2 tests remain stable.
// This test runs last in the file and re-saves the original data.
test('TC-103 restore qa-test-v2 fixture after admin tests', async () => {
  const { cookie } = await adminLogin();
  const res = await updateTrip('qa-test-v2', VALID_CATALOG, VALID_DEPARTURES, cookie);
  assert.ok(res.status >= 300 && res.status < 400, 'Restore should succeed');
});
