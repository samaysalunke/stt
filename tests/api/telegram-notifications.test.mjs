import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiPost, adminLogin, BASE } from './helpers.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/seekthethrill.db');
const LIVE = { tripSlug: 'qa-test-bookable', batchId: 'qa-bookable-2099', tierId: 'standard', tripTitle: 'QA Test — Bookable Trip' };
const PAST = { tripSlug: 'qa-test-backfill', batchId: 'qa-backfill-2000', tierId: 'standard', tripTitle: 'QA Test — Backfill (Past)' };
let cookie = '';

async function cleanup(fixture) {
  await fetch(`${BASE}/api/test/cleanup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batchId: fixture.batchId, tierId: fixture.tierId, tripTitle: fixture.tripTitle }),
  });
}

function eventRows(email) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(`
    SELECT e.event_type, e.status, e.attempts
    FROM telegram_notification_events e
    JOIN registrations r ON r.id=e.registration_id
    WHERE lower(r.email)=lower(?) ORDER BY e.id
  `).all(email);
  db.close();
  return rows;
}

function seedWishlist(email) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  db.prepare(`
    INSERT INTO registrations (
      trip_name, trip_slug, trip_date, full_name, email, phone,
      emergency_name, emergency_phone, batch_id, tier_id, status, wishlisted_at
    ) VALUES (?, ?, ?, ?, ?, ?, '', '', ?, ?, 'wishlist', CURRENT_TIMESTAMP)
  `).run(LIVE.tripTitle, LIVE.tripSlug, '1 Jan – 5 Jan 2099', 'Wish Lister', email, '9876543210', LIVE.batchId, LIVE.tierId);
  db.close();
}

function adminPost(pathname, body) {
  return apiPost(pathname, body, { headers: { cookie } });
}

before(async () => {
  cookie = (await adminLogin()).cookie;
  await cleanup(LIVE);
  await cleanup(PAST);
});

after(async () => {
  await cleanup(LIVE);
  await cleanup(PAST);
});

test('public lead creation queues once and repeated saves do not backfill another event', async () => {
  const email = `qa-telegram-public-${Date.now()}@example.invalid`;
  const payload = {
    ...LIVE, tripName: LIVE.tripTitle, fullName: 'Telegram Public', email,
    phone: '9876543210', age: '28', city: 'Mumbai', state: 'Maharashtra',
    emergencyName: 'Emergency', emergencyPhone: '9123456789', whyJoin: 'Testing notifications',
    intent: 'details',
  };
  const first = await apiPost('/api/register', payload);
  const second = await apiPost('/api/register', payload);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.deepEqual(eventRows(email), [{ event_type: 'lead', status: 'queued', attempts: 0 }]);
});

test('public checkout upgrades wishlist to lead and queues that transition', async () => {
  const email = `qa-telegram-wishlist-${Date.now()}@example.invalid`;
  seedWishlist(email);
  const result = await apiPost('/api/register', {
    ...LIVE, tripName: LIVE.tripTitle, fullName: 'Wish Lister', email,
    phone: '9876543210', age: '28', city: 'Mumbai', state: 'Maharashtra',
    emergencyName: 'Emergency', emergencyPhone: '9123456789', whyJoin: 'Now booking',
    intent: 'details',
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.status, 'lead');
  assert.deepEqual(eventRows(email).map((row) => row.event_type), ['lead']);
});

test('live single-admin lead/confirmed creates notify, pending and historical creates do not', async () => {
  for (const status of ['lead', 'pending', 'confirmed']) {
    const email = `qa-telegram-create-${status}-${Date.now()}@example.invalid`;
    const made = await adminPost('/api/admin/registrations/create', {
      ...LIVE, status, full_name: `Telegram ${status}`, email, phone: '9876543210', sendEmail: false,
    });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    assert.deepEqual(eventRows(email).map((row) => row.event_type), status === 'pending' ? [] : [status]);
  }

  const historicalEmail = `qa-telegram-history-${Date.now()}@example.invalid`;
  const historical = await adminPost('/api/admin/registrations/create', {
    ...PAST, status: 'confirmed', full_name: 'Historical', email: historicalEmail, phone: '9876543210', sendEmail: false,
  });
  assert.equal(historical.status, 200, JSON.stringify(historical.data));
  assert.deepEqual(eventRows(historicalEmail), []);
});

test('admin transitions queue each lifecycle event once across status re-entry', async () => {
  const email = `qa-telegram-transition-${Date.now()}@example.invalid`;
  const made = await adminPost('/api/admin/registrations/create', {
    ...LIVE, status: 'pending', full_name: 'Transition', email, phone: '9876543210', sendEmail: false,
  });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const id = made.data.id;
  assert.equal((await adminPost('/api/admin/update-registration', { id, status: 'lead' })).status, 200);
  assert.equal((await adminPost('/api/admin/update-registration', { id, status: 'pending' })).status, 200);
  assert.equal((await adminPost('/api/admin/update-registration', { id, status: 'lead' })).status, 200);
  assert.deepEqual(eventRows(email).map((row) => row.event_type), ['lead']);
});

test('pending, rejected, and cancelled bookings queue confirmation on first entry', async () => {
  for (const origin of ['pending', 'rejected', 'cancelled']) {
    const email = `qa-telegram-confirm-${origin}-${Date.now()}@example.invalid`;
    const made = await adminPost('/api/admin/registrations/create', {
      ...LIVE, status: 'pending', full_name: `Confirm ${origin}`, email, phone: '9876543210', sendEmail: false,
    });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const id = made.data.id;
    if (origin === 'rejected' || origin === 'cancelled') {
      const moved = await adminPost('/api/admin/update-registration', { id, status: origin });
      assert.equal(moved.status, 200, JSON.stringify(moved.data));
    }
    const confirmed = await adminPost('/api/admin/update-registration', {
      id, status: 'confirmed', payment_status: 'advance_paid', requestId: `telegram-confirm-${id}`,
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.deepEqual(eventRows(email).map((row) => row.event_type), ['confirmed']);
  }
});

test('bulk imports suppress Telegram events for lead and confirmed rows', async () => {
  for (const status of ['lead', 'confirmed']) {
    const email = `qa-telegram-import-${status}-${Date.now()}@example.invalid`;
    const csv = ['full_name,email,phone', `Imported,${email},9876543210`].join('\n');
    const result = await adminPost('/api/admin/registrations/import', {
      ...LIVE, status, csv, dryRun: false, sendEmail: false, capacityOverride: true,
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.deepEqual(eventRows(email), []);
  }
});
