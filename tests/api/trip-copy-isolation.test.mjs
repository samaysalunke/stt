// TC-900+ — Two trips sharing a batch id must not share bookings or capacity.
//
// A duplicated trip used to keep its source's departure ids. The registrations
// page grouped by batch id alone and the capacity check counted by batch id
// alone, so a copy showed its source's travellers and inherited its seat count.
// The qa-test-shared-a / -b fixtures reproduce that shape on purpose.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { apiPost, adminLogin, BASE } from './helpers.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB_PATH = path.join(ROOT, 'data/seekthethrill.db');
const tripPath = (slug) => path.join(ROOT, 'src/content/trips', `${slug}.yaml`);

const BATCH = 'qa-shared-2099';
const TIER = 'solo';
const A = { tripSlug: 'qa-test-shared-a', tripTitle: 'QA Test — Shared Batch Id A' };
const B = { tripSlug: 'qa-test-shared-b', tripTitle: 'QA Test — Shared Batch Id B' };
const COPY_SLUG = `${A.tripSlug}-copy`;

let cookie = '';
const adminPost = (p, body) => apiPost(p, body, { headers: { cookie } });

async function cleanup() {
  for (const trip of [A, B]) {
    await fetch(`${BASE}/api/test/cleanup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId: BATCH, tierId: TIER, tripTitle: trip.tripTitle }),
    });
  }
}

const confirm = (trip, name, email) => adminPost('/api/admin/registrations/create', {
  tripSlug: trip.tripSlug, batchId: BATCH, tierId: TIER,
  status: 'confirmed', full_name: name, email, phone: '9876543210', sendEmail: false,
});

const booked = (slug) => parse(readFileSync(tripPath(slug), 'utf8')).batches[0].offers[0].booked;

async function adminPage(slug) {
  const res = await fetch(`${BASE}/admin/registrations/${slug}`, { headers: { cookie }, redirect: 'manual' });
  return { status: res.status, html: await res.text() };
}

function removeCopy() {
  if (existsSync(tripPath(COPY_SLUG))) unlinkSync(tripPath(COPY_SLUG));
}

before(async () => {
  cookie = (await adminLogin()).cookie;
  removeCopy();
  await cleanup();
});

after(async () => {
  await cleanup();
  removeCopy();
});

test('TC-900 a full departure does not close its twin on another trip', async () => {
  const stamp = Date.now();
  const first = await confirm(A, 'Shared Alpha', `qa-shared-a-${stamp}@example.invalid`);
  assert.equal(first.status, 200, JSON.stringify(first.data));

  // Cap is 1 per trip. Counted by batch id alone this was refused as full.
  const second = await confirm(B, 'Shared Bravo', `qa-shared-b-${stamp}@example.invalid`);
  assert.equal(second.status, 200, JSON.stringify(second.data));

  // Each trip's own cap still holds.
  const third = await confirm(B, 'Shared Charlie', `qa-shared-c-${stamp}@example.invalid`);
  assert.notEqual(third.status, 200, 'A second confirmed booking on a cap-1 tier must be refused');
});

test('TC-901 each confirmation moves only its own trip\'s seat counter', () => {
  assert.equal(booked(A.tripSlug), 1);
  assert.equal(booked(B.tripSlug), 1);
});

test('TC-902 the registrations page lists only the trip\'s own travellers', async () => {
  const a = await adminPage(A.tripSlug);
  const b = await adminPage(B.tripSlug);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.ok(a.html.includes('Shared Alpha'), 'Trip A must show its own booking');
  assert.ok(!a.html.includes('Shared Bravo'), 'Trip A must not show trip B\'s booking');
  assert.ok(b.html.includes('Shared Bravo'), 'Trip B must show its own booking');
  assert.ok(!b.html.includes('Shared Alpha'), 'Trip B must not show trip A\'s booking');
});

test('TC-903 the per-trip export carries only that trip\'s rows', async () => {
  const res = await fetch(`${BASE}/api/admin/export?type=registrations&trip_slug=${B.tripSlug}`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const csv = await res.text();
  assert.ok(csv.includes('Shared Bravo'));
  assert.ok(!csv.includes('Shared Alpha'));
});

test('TC-904 duplicating a trip gives the copy its own departure ids and is audited', async () => {
  const res = await adminPost('/api/admin/trips/duplicate', { slug: A.tripSlug });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  // The endpoint answers JSON without a JSON content type, so apiPost hands back text.
  const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
  assert.equal(data.newSlug, COPY_SLUG);

  const copy = parse(readFileSync(tripPath(COPY_SLUG), 'utf8'));
  const ids = copy.batches.map((b) => String(b.id));
  assert.deepEqual(ids, [`${COPY_SLUG}-2099-04-01`]);
  assert.ok(!ids.includes(BATCH), 'A copy must never reuse its source\'s batch id');
  assert.equal(copy.batches[0].offers[0].booked, 0);

  const db = require('better-sqlite3')(DB_PATH, { readonly: true });
  try {
    const row = db.prepare(
      "SELECT newValue FROM audit_log WHERE action = 'trip.duplicate' AND targetId = ? ORDER BY createdAt DESC LIMIT 1",
    ).get(COPY_SLUG);
    assert.ok(row, 'Duplication must leave an audit row');
    assert.equal(JSON.parse(row.newValue).sourceSlug, A.tripSlug);
  } finally {
    db.close();
  }

  // The copy starts empty even though its source has a confirmed booking.
  const page = await adminPage(COPY_SLUG);
  assert.ok(!page.html.includes('Shared Alpha'), 'A fresh copy must not show its source\'s bookings');
});
