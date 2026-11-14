// Itinerary gate — a departure can lock its trip's itinerary until the visitor
// registers. Fixture: src/content/trips/qa-test-itinerary-gate.yaml.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { BASE, apiPost, adminLogin, VALID_REG } from './helpers.mjs';

const SLUG = 'qa-test-itinerary-gate';
// QA fixtures 404 in this suite (no ALLOW_TEST_CONTENT, which saved-trips
// relies on), so publish this one for the run and restore it afterwards —
// the same rewrite-and-restore admin-trips.test.mjs does to its fixture.
const FIXTURE = `src/content/trips/${SLUG}.yaml`;
const ORIGINAL = readFileSync(FIXTURE, 'utf8');
before(() => writeFileSync(FIXTURE, ORIGINAL.replace('publicationStatus: test', 'publicationStatus: published'), 'utf8'));
after(() => writeFileSync(FIXTURE, ORIGINAL, 'utf8'));
const SECRET = 'QA-GATE-SECRET-DAY-TWO';
const reg = (email) => ({ ...VALID_REG, tripSlug: SLUG, tripName: 'QA Test — Itinerary Gate Trip', batchId: 'qa-gate-2099', email, intent: 'details' });

const accessCookie = (headers) => headers.get('set-cookie')?.match(/stt_itinerary_access=[^;]+/)?.[0] ?? '';
const getItinerary = (cookie = '') =>
  fetch(`${BASE}/api/trip-itinerary?slug=${SLUG}`, { headers: cookie ? { cookie } : {} });
const pageHtml = async (cookie = '') =>
  (await fetch(`${BASE}/trips/${SLUG}/`, { headers: { Accept: 'text/html', ...(cookie ? { cookie } : {}) } })).text();

test('anonymous: page shows only the preview, the API refuses the rest', async () => {
  const html = await pageHtml();
  assert.match(html, /QA gate preview day/);
  assert.match(html, /itinerary-locked|Register to see the full plan/);
  assert.ok(!html.includes(SECRET), 'a hidden day leaked into the locked page HTML');

  const res = await getItinerary();
  assert.equal(res.status, 403);
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);
  const data = await res.json();
  assert.equal(data.locked, true);
  assert.equal(data.itinerary, undefined);
});

test('the details form unlocks it on that browser', async () => {
  const { status, data, headers } = await apiPost('/api/register', reg('qa-gate-lead@example.invalid'));
  assert.equal(status, 200);
  assert.equal(data.status, 'lead');
  const cookie = accessCookie(headers);
  assert.ok(cookie, 'register should set the itinerary access cookie');

  const res = await getItinerary(cookie);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.itinerary.length, 3);
  assert.ok(body.itinerary.some((d) => d.description.includes(SECRET)));

  // The page HTML itself never varies on this cookie — it stays edge-cacheable.
  assert.ok(!(await pageHtml(cookie)).includes(SECRET));
});

test('a forged or unknown token unlocks nothing', async () => {
  for (const cookie of ['stt_itinerary_access=not-a-token', `stt_itinerary_access=${crypto.randomUUID()}`]) {
    assert.equal((await getItinerary(cookie)).status, 403);
  }
});

test('a token only covers trips its email registered for', async () => {
  const { headers } = await apiPost('/api/register', { ...VALID_REG, email: 'qa-gate-other@example.invalid', intent: 'details' });
  const cookie = accessCookie(headers);
  assert.ok(cookie);
  assert.equal((await getItinerary(cookie)).status, 403);
});

test('an admin sees the full plan on the page', async () => {
  const { cookie } = await adminLogin();
  assert.ok(cookie, 'admin login failed');
  const html = await pageHtml(cookie);
  assert.ok(html.includes(SECRET));
  assert.match(html, /itinerary-admin-note/);
});
