// TC-100 to TC-101 — Admin trip update with occupancyCatalog_json + departures_json
// Tests that parseEditorBooking is correctly wired through the update API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import { adminLogin, BASE } from './helpers.mjs';

const QA_TRIP_PATH = 'src/content/trips/qa-test-v2.yaml';
const ORIGINAL_QA_TRIP = readFileSync(QA_TRIP_PATH, 'utf8');
const RICH_DESCRIPTION = '## A vivid route\n\nTravel **slowly**, follow *quiet trails*, and read the [trip notes](https://example.com).\n\n- Waterfalls\n- Villages\n\n1. Arrive\n2. Explore';

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
    discountAmount: 1250,
    discountEndsAt: '2098-12-20T18:30:00+05:30',
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

async function updateTrip(slug, catalogJson, departuresJson, cookie, faqFields = null, accommodationField = undefined) {
  const fd = new FormData();
  fd.append('slug', slug);
  fd.append('status', 'booking-open');
  fd.append('paymentAmount', '1000');
  fd.append('balanceDueRule', '15 days before trip');
  fd.append('description', RICH_DESCRIPTION);
  fd.append('occupancyCatalog_json', catalogJson);
  fd.append('departures_json', departuresJson);
  fd.append('itinerary_json', '[]');
  if (faqFields) {
    fd.append('tripFaqOverrides_json', JSON.stringify(faqFields.tripFaqOverrides));
    fd.append('tripFaqs_json', JSON.stringify(faqFields.tripFaqs));
  }
  if (accommodationField !== undefined) {
    fd.append('accommodationGallery_json', JSON.stringify(accommodationField));
  }
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
  const saved = parse(readFileSync(QA_TRIP_PATH, 'utf8'));
  // Multipart form encoding canonicalizes textarea line endings to CRLF.
  assert.equal(saved.description.replace(/\r\n/g, '\n'), RICH_DESCRIPTION, 'Markdown description should round-trip unchanged');
  assert.equal(saved.batches[0].discountAmount, 1250);
  assert.equal(saved.batches[0].discountEndsAt, '2098-12-20T13:00:00.000Z');
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

test('TC-103 trip FAQ fields round-trip and survive an older-client update', async () => {
  const { cookie } = await adminLogin();
  const faqFields = {
    tripFaqOverrides: { include: ['qa-non-default'], exclude: ['how-do-i-reserve-a-spot'] },
    tripFaqs: [{ question: 'What is the QA-only answer?', answer: 'It survives the full-file overwrite.' }],
  };
  let res = await updateTrip('qa-test-v2', VALID_CATALOG, VALID_DEPARTURES, cookie, faqFields);
  assert.ok(res.status >= 300 && res.status < 400);

  let saved = parse(readFileSync(QA_TRIP_PATH, 'utf8'));
  assert.deepEqual(saved.tripFaqOverrides, faqFields.tripFaqOverrides);
  assert.deepEqual(saved.tripFaqs, faqFields.tripFaqs);

  res = await updateTrip('qa-test-v2', VALID_CATALOG, VALID_DEPARTURES, cookie);
  assert.ok(res.status >= 300 && res.status < 400);
  saved = parse(readFileSync(QA_TRIP_PATH, 'utf8'));
  assert.deepEqual(saved.tripFaqOverrides, faqFields.tripFaqOverrides);
  assert.deepEqual(saved.tripFaqs, faqFields.tripFaqs);
});

test('TC-103a accommodation gallery normalizes, survives an omitted field, and clears explicitly', async () => {
  const { cookie } = await adminLogin();
  const submitted = [
    { image: '/images/trips/qa-test-v2/stay-a.webp', width: '1200', height: 800, source: 'trip' },
    { image: '/images/trips/qa-test-v2/stay-a.webp', width: 20, height: 20, source: 'album' },
    { image: '/images/trips/qa-test-v2/stay-b.webp', width: 0, height: 'bad', source: 'album' },
  ];

  let res = await updateTrip('qa-test-v2', VALID_CATALOG, VALID_DEPARTURES, cookie, null, submitted);
  assert.ok(res.status >= 300 && res.status < 400);
  let saved = parse(readFileSync(QA_TRIP_PATH, 'utf8'));
  assert.deepEqual(saved.accommodationGallery, [
    { image: '/images/trips/qa-test-v2/stay-a.webp', width: 1200, height: 800, source: 'trip' },
    { image: '/images/trips/qa-test-v2/stay-b.webp', width: null, height: null, source: 'album' },
  ]);

  res = await updateTrip('qa-test-v2', VALID_CATALOG, VALID_DEPARTURES, cookie);
  assert.ok(res.status >= 300 && res.status < 400);
  saved = parse(readFileSync(QA_TRIP_PATH, 'utf8'));
  assert.equal(saved.accommodationGallery.length, 2, 'older clients preserve the stored gallery');

  res = await updateTrip('qa-test-v2', VALID_CATALOG, VALID_DEPARTURES, cookie, null, []);
  assert.ok(res.status >= 300 && res.status < 400);
  saved = parse(readFileSync(QA_TRIP_PATH, 'utf8'));
  assert.deepEqual(saved.accommodationGallery, [], 'an explicit empty array clears the gallery');
});

test('TC-103b itinerary day photos round-trip and are clamped/sanitised on save', async () => {
  const { cookie } = await adminLogin();
  const itineraryJson = JSON.stringify([
    {
      dayNumber: 1, dayTitle: 'Day with photos', activities: 'Explore', accommodation: '', transport: '',
      breakfast: false, lunch: false, dinner: false, specialNotes: '',
      photos: [
        { image: '/images/trips/qa/a.webp', width: 800, height: 600 },
        { image: '/images/trips/qa/b.webp' },
        { image: '/images/trips/qa/c.webp' },
        { image: '/images/trips/qa/d.webp' },
        { image: 'https://evil.example/x.jpg' },
      ],
    },
  ]);
  const fd = new FormData();
  fd.append('slug', 'qa-test-v2');
  fd.append('status', 'booking-open');
  fd.append('paymentAmount', '1000');
  fd.append('description', RICH_DESCRIPTION);
  fd.append('occupancyCatalog_json', VALID_CATALOG);
  fd.append('departures_json', VALID_DEPARTURES);
  fd.append('itinerary_json', itineraryJson);
  const res = await fetch(`${BASE}/api/admin/trips/update`, { method: 'POST', body: fd, headers: { cookie }, redirect: 'manual' });
  assert.ok(res.status >= 300 && res.status < 400, `Expected redirect, got ${res.status}`);

  const saved = parse(readFileSync(QA_TRIP_PATH, 'utf8'));
  const photos = saved.itinerary?.[0]?.photos ?? [];
  assert.equal(photos.length, 3, 'clamped to 3 photos, external URL dropped');
  assert.deepEqual(photos[0], { image: '/images/trips/qa/a.webp', width: 800, height: 600 });
  assert.equal(photos[1].width, null, 'missing dimensions become null');
  assert.ok(photos.every((p) => p.image.startsWith('/images/')), 'only local images kept');
  // Unrelated fields still survive the full-file overwrite.
  assert.equal(saved.description.replace(/\r\n/g, '\n'), RICH_DESCRIPTION);
});

// Restore the qa-test-v2 fixture after admin tests so register-v2 tests remain stable.
// This test runs last in the file and re-saves the original data.
test('TC-104 restore qa-test-v2 fixture after admin tests', async () => {
  const { cookie } = await adminLogin();
  const res = await updateTrip('qa-test-v2', VALID_CATALOG, VALID_DEPARTURES, cookie, {
    tripFaqOverrides: { include: [], exclude: [] }, tripFaqs: [],
  });
  writeFileSync(QA_TRIP_PATH, ORIGINAL_QA_TRIP, 'utf8');
  assert.ok(res.status >= 300 && res.status < 400, 'Restore should succeed');
});
