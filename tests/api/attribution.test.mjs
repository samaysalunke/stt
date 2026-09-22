// UTM attribution capture → booking. Proves the whole path end to end:
// POST /api/attribution parks the campaign in cookies, and POST /api/register
// reads those cookies back onto the registration row.
//
// Attribution is first-touch primary: register.ts derives source/source_detail
// from the FIRST touch and COALESCEs them, so a later campaign can never
// rewrite the one that originally found the traveller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminLogin, BASE, VALID_REG } from './helpers.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/seekthethrill.db');

/**
 * Fire the capture beacon. Returns the cookie jar the browser would keep AND the
 * echoed first touch, which is what the page mirrors into localStorage.
 *
 * `cookie` models a visitor who still has their cookies; `firstTouch` models the
 * mirror they replay when they do not.
 */
async function captureRaw({ landingPage = '/trips/qa-test-bookable', search = '', referrer = '', firstTouch = null, cookie = '' } = {}) {
  const res = await fetch(`${BASE}/api/attribution`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ landingPage, search, referrer, firstTouch }),
  });
  assert.equal(res.status, 200, 'attribution beacon should accept the touch');
  // getSetCookie() keeps the cookies separate; a joined set-cookie string cannot
  // be split safely because the JSON values contain commas.
  const jar = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .filter((c) => c.startsWith('stt_first_touch=') || c.startsWith('stt_latest_touch='));
  return { cookie: jar.join('; '), ...(await res.json()) };
}

/** The common case: just the two touch cookies, as a Cookie header. */
async function capture(options = {}) {
  return (await captureRaw(options)).cookie;
}

function utm({ source = '', medium = '', campaign = '', term = '', content = '' }) {
  const p = new URLSearchParams();
  if (source) p.set('utm_source', source);
  if (medium) p.set('utm_medium', medium);
  if (campaign) p.set('utm_campaign', campaign);
  if (term) p.set('utm_term', term);
  if (content) p.set('utm_content', content);
  return p.size ? `?${p}` : '';
}

async function register(email, cookie) {
  const res = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ ...VALID_REG, email }),
  });
  const data = await res.json();
  assert.equal(data.success, true, `registration should succeed: ${data.error ?? ''}`);
  return data;
}

function rowFor(email) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare(
    'SELECT source, source_detail, first_touch_json, latest_touch_json FROM registrations WHERE lower(email)=lower(?) ORDER BY id DESC LIMIT 1',
  ).get(email);
  db.close();
  assert.ok(row, `no registration stored for ${email}`);
  return row;
}

test('UTM params on the landing URL reach the booking row', async () => {
  const email = 'qa-attr-utm@example.invalid';
  const cookie = await capture({
    search: utm({ source: 'instagram', medium: 'paid', campaign: 'diwali-test', term: 'trek', content: 'story-1' }),
    referrer: 'https://www.instagram.com/',
  });
  await register(email, cookie);

  const row = rowFor(email);
  assert.equal(row.source, 'instagram');
  assert.equal(row.source_detail, 'paid / diwali-test');

  const first = JSON.parse(row.first_touch_json);
  assert.equal(first.utmSource, 'instagram');
  assert.equal(first.utmMedium, 'paid');
  assert.equal(first.utmCampaign, 'diwali-test');
  assert.equal(first.utmTerm, 'trek');
  assert.equal(first.utmContent, 'story-1');
  assert.equal(first.referrer, 'https://www.instagram.com/');
  assert.match(first.landingPage, /^\/trips\/qa-test-bookable\?utm_source=instagram/);
});

test('no attribution at all → source is direct, never blank', async () => {
  const email = 'qa-attr-direct@example.invalid';
  await register(email, await capture({ landingPage: '/' }));

  const row = rowFor(email);
  assert.equal(row.source, 'direct');
  assert.equal(row.source_detail, null);
});

test('off-site referrer without UTMs → source falls back to the hostname', async () => {
  const email = 'qa-attr-referrer@example.invalid';
  const cookie = await capture({ landingPage: '/', referrer: 'https://www.google.com/search' });
  await register(email, cookie);

  assert.equal(rowFor(email).source, 'google.com');
});

test('a later campaign updates latest touch but never rewrites first touch', async () => {
  const email = 'qa-attr-firsttouch@example.invalid';

  const firstVisit = await capture({ search: utm({ source: 'instagram', medium: 'paid', campaign: 'campaign-a' }) });
  await register(email, firstVisit);

  // A fresh beacon with no prior cookies is a brand new visitor session; sending
  // the existing jar back would hit the write-once guard inside /api/attribution
  // rather than exercising the guard in register.ts, which is what we care about.
  const secondVisit = await capture({ search: utm({ source: 'google', medium: 'cpc', campaign: 'campaign-b' }) });
  await register(email, secondVisit);

  const row = rowFor(email);
  assert.equal(JSON.parse(row.first_touch_json).utmCampaign, 'campaign-a', 'first touch must survive a later campaign');
  assert.equal(JSON.parse(row.latest_touch_json).utmCampaign, 'campaign-b', 'latest touch must track the newest campaign');
  assert.equal(row.source, 'instagram', 'source stays on the campaign that originally converted');
  assert.equal(row.source_detail, 'paid / campaign-a');
});

test('CSV export filters by campaign and carries flat UTM columns', async () => {
  const target = 'qa-attr-export-a@example.invalid';
  const other = 'qa-attr-export-b@example.invalid';
  await register(target, await capture({ search: utm({ source: 'instagram', medium: 'paid', campaign: 'export-a' }) }));
  await register(other, await capture({ search: utm({ source: 'google', medium: 'cpc', campaign: 'export-b' }) }));

  const { cookie } = await adminLogin();
  const res = await fetch(`${BASE}/api/admin/export?type=registrations&campaign=export-a`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const csv = await res.text();

  assert.ok(csv.includes(target), 'the matching campaign row should be exported');
  assert.ok(!csv.includes(other), 'a row from another campaign must not leak into a filtered export');

  // Flat columns, not just the raw first_touch_json blob. toCSV() writes the
  // header row unquoted, so match whole names rather than substrings.
  const headers = csv.split('\r\n')[0].replace(/^\ufeff/, '').split(',');
  for (const column of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'landing_page', 'referrer']) {
    assert.ok(headers.includes(column), `export is missing the ${column} column`);
  }
  assert.ok(csv.includes('"export-a"'), 'utm_campaign should be populated, not blank');
});

test('CSV export filters by every attribution dimension', async () => {
  const paid = 'qa-attr-dim-paid@example.invalid';
  const organic = 'qa-attr-dim-organic@example.invalid';
  await register(paid, await capture({
    landingPage: '/trips/qa-test-bookable',
    search: utm({ source: 'instagram', medium: 'paid', campaign: 'dim-a', term: 'himalaya', content: 'story-variant-7' }),
  }));
  await register(organic, await capture({
    landingPage: '/trips/qa-test-bookable',
    search: utm({ source: 'google', medium: 'organic', campaign: 'dim-b', term: 'trek', content: 'banner-3' }),
  }));

  const { cookie } = await adminLogin();
  const exportRows = async (query) => {
    const res = await fetch(`${BASE}/api/admin/export?type=registrations&${query}`, { headers: { cookie } });
    assert.equal(res.status, 200, `${query} should not error`);
    return res.text();
  };

  // The four exact dimensions match on the whole value.
  for (const query of ['utm_source=instagram', 'utm_medium=paid', 'campaign=dim-a', 'source=instagram']) {
    const csv = await exportRows(query);
    assert.ok(csv.includes(paid), `${query} should return the matching row`);
    assert.ok(!csv.includes(organic), `${query} must not leak a non-matching row`);
  }

  // The free-text dimensions match on a substring.
  for (const query of ['utm_content=variant', 'utm_term=himal', 'landing_page=qa-test-bookable']) {
    const csv = await exportRows(query);
    assert.ok(csv.includes(paid), `${query} should return the matching row`);
  }
  const bySubstring = await exportRows('utm_content=variant');
  assert.ok(!bySubstring.includes(organic), 'a substring filter must still exclude other rows');

  // Referrer needs a row that actually has one.
  const referred = 'qa-attr-dim-referred@example.invalid';
  await register(referred, await capture({ referrer: 'https://blog.example.com/gear-guide' }));
  const byReferrer = await exportRows('referrer=blog.example.com');
  assert.ok(byReferrer.includes(referred), 'referrer should substring-match');
  assert.ok(!byReferrer.includes(paid), 'a row with no referrer must not match');
});

test('an exact filter can select the rows carrying no attribution', async () => {
  const { cookie } = await adminLogin();
  const res = await fetch(`${BASE}/api/admin/export?type=registrations&utm_medium=__none__`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const csv = await res.text();
  assert.ok(!csv.includes('qa-attr-dim-paid@example.invalid'), 'a row with a medium must not land in the unattributed bucket');
});

// json_extract() throws on a malformed blob, so before the json_valid() guard a
// single bad row took down the entire filtered download with a 500.
test('a malformed stored touch does not break a filtered export', async () => {
  const email = 'qa-attr-malformed@example.invalid';
  await register(email, await capture({ search: utm({ source: 'instagram', campaign: 'malformed-probe' }) }));

  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  db.prepare('UPDATE registrations SET first_touch_json=? WHERE lower(email)=lower(?)').run('{not json', email);
  db.close();

  const { cookie } = await adminLogin();
  const csvFor = async (query) => {
    const res = await fetch(`${BASE}/api/admin/export?type=registrations&${query}`, { headers: { cookie } });
    assert.equal(res.status, 200, `${query} must survive a malformed stored touch`);
    return res.text();
  };

  // An unreadable touch carries no value, so it fails every positive filter...
  for (const query of ['campaign=dim-a', 'utm_content=variant']) {
    assert.ok(!(await csvFor(query)).includes(email), `${query} must not match an unreadable touch`);
  }
  // ...and belongs in the unattributed bucket rather than disappearing entirely.
  assert.ok((await csvFor('utm_medium=__none__')).includes(email), 'an unreadable touch is unattributed, not invisible');
});

// The Instagram DM path. UTMs answer which reel; the subscriber id the flow
// appends answers which conversation — and it is the only identifier that can
// survive the hop out of Instagram's in-app browser, because it does not live
// in the browser at all.
test('a DM subscriber id on the landing URL reaches the booking row', async () => {
  const email = 'qa-attr-subscriber@example.invalid';
  const cookie = await capture({
    landingPage: '/trips/qa-test-bookable',
    search: '?utm_source=instagram&utm_medium=dm&utm_campaign=goa-sept&utm_content=reel-ferry&subscriber_id=ig-88421',
    referrer: 'https://l.instagram.com/',
  });
  await register(email, cookie);

  const first = JSON.parse(rowFor(email).first_touch_json);
  assert.equal(first.subscriberId, 'ig-88421');
  assert.equal(first.utmCampaign, 'goa-sept');

  const { cookie: adminCookie } = await adminLogin();
  const res = await fetch(`${BASE}/api/admin/export?type=registrations&subscriber_id=ig-884`, { headers: { cookie: adminCookie } });
  assert.equal(res.status, 200);
  const csv = await res.text();
  assert.ok(csv.split('\r\n')[0].replace(/^﻿/, '').split(',').includes('subscriber_id'),
    'export is missing the subscriber_id column');
  assert.ok(csv.includes(email), 'a subscriber id should be searchable in the export');
});

// A ₹20-30k trip is booked days after the DM that started it, so the 90-day
// cookie is the thing most likely to be missing at the moment that matters.
// Losing it used to mean the booking read as direct.
test('a lost first-touch cookie is refilled from the page mirror', async () => {
  const email = 'qa-attr-replay@example.invalid';

  // Visit one: the campaign lands, and the page mirrors what the server settled on.
  const visit = await captureRaw({
    search: utm({ source: 'instagram', medium: 'dm', campaign: 'replay-a', content: 'reel-7' }),
    referrer: 'https://l.instagram.com/',
  });
  assert.equal(visit.firstTouch.utmCampaign, 'replay-a', 'the beacon should echo the first touch back to the page');

  // Visit two: cookies gone (cleared, expired, another storage partition), only
  // the mirror left. It replays, and the campaign is restored rather than lost.
  const restored = await captureRaw({ landingPage: '/trips/qa-test-bookable', firstTouch: visit.firstTouch });
  await register(email, restored.cookie);

  const row = rowFor(email);
  const first = JSON.parse(row.first_touch_json);
  assert.equal(first.utmCampaign, 'replay-a', 'the mirrored campaign should survive the cookie');
  assert.equal(first.capturedAt, visit.firstTouch.capturedAt, 'a restored touch keeps the time it actually happened');
  assert.equal(row.source, 'instagram', 'a restored first touch still drives the derived channel');
  // The visit itself is still the latest touch — a replay restores history, it
  // does not rewrite the present.
  assert.equal(JSON.parse(row.latest_touch_json).utmCampaign, '');
});

test('a mirror can neither overwrite a live cookie nor forge a touch', async () => {
  const live = await captureRaw({ search: utm({ source: 'instagram', campaign: 'genuine' }) });

  // A page replaying a different first touch while the cookie is present must
  // not move it — the cookie is the source of truth for conversions.
  const forged = { ...live.firstTouch, utmSource: 'not-instagram', utmCampaign: 'forged' };
  const second = await captureRaw({ firstTouch: forged, cookie: live.cookie });
  assert.ok(!second.cookie.includes('stt_first_touch='), 'an existing first touch must not be rewritten');
  // And the stored touch is not handed back either: the echo is for the visit
  // that wrote the cookie. Otherwise any script on the page could read what
  // httpOnly hides, for the price of an empty POST.
  assert.equal(second.firstTouch, undefined, 'a held first touch must not be echoed to the page');

  // A replay dated in the future would outrank every genuine touch in any
  // chronological report, so it is refused outright and this visit stands.
  const future = await captureRaw({
    search: utm({ source: 'google', campaign: 'this-visit' }),
    firstTouch: { ...live.firstTouch, capturedAt: new Date(Date.now() + 864e5).toISOString() },
  });
  assert.equal(future.firstTouch.utmCampaign, 'this-visit', 'a future-dated replay must be refused');

  // localStorage has no expiry of its own, so without an age bound a mirror
  // would make first touch immortal — past the 90 days /privacy promises.
  const stale = await captureRaw({
    search: utm({ source: 'google', campaign: 'this-visit-too' }),
    firstTouch: { ...live.firstTouch, capturedAt: new Date(Date.now() - 91 * 864e5).toISOString() },
  });
  assert.equal(stale.firstTouch.utmCampaign, 'this-visit-too', 'a replay older than the window must be refused');
});
