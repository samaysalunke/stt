// TC-400 to TC-414 — Departure finance: RBAC, cost upsert, line items, audit, orphans
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { BASE } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DB_PATH = path.resolve(__dirname, '../../data/seekthethrill.db');

// The QA fixture departure (src/content/trips/qa-test-bookable.yaml).
const TRIP = 'qa-test-bookable';
const BATCH = 'qa-bookable-2099';

function db() {
  return new (require('better-sqlite3'))(DB_PATH);
}

/** Same approach as rbac.test.mjs: seed a session directly, no OAuth round-trip. */
function seedAdminSession({ role }) {
  const conn = db();
  const id = crypto.randomUUID();
  const email = `finance-${role}-${id.slice(0, 8)}@example.invalid`;
  const token = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  conn.prepare(`
    INSERT OR IGNORE INTO users (id, email, displayName, googleId, createdAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, email, `Finance ${role}`, `google-finance-${id}`, now);
  conn.prepare(`
    INSERT OR REPLACE INTO user_roles (userId, role, tripIds, assignedAt)
    VALUES (?, ?, ?, ?)
  `).run(id, role, '[]', now);
  conn.prepare(`
    INSERT INTO admin_sessions (id, userId, token, expiresAt, lastActivityAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), id, token, now + 8 * 3600, now);
  conn.close();
  return { cookie: `admin_token=${token}`, email };
}

async function call(method, path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
}

const getPage = async (cookie) => {
  const res = await fetch(`${BASE}/admin/finance`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  return { status: res.status, body: await res.text() };
};

function resetFixture() {
  const conn = db();
  conn.prepare('DELETE FROM departure_costs WHERE trip_slug = ?').run(TRIP);
  conn.prepare('DELETE FROM departure_cost_items WHERE trip_slug = ?').run(TRIP);
  conn.close();
}

const OWNER = seedAdminSession({ role: 'owner' });
const OPS = seedAdminSession({ role: 'ops' });
const LEAD = seedAdminSession({ role: 'trip_lead' });

// ── RBAC ─────────────────────────────────────────────────────────────────────

test('TC-400 trip_lead cannot reach the finance page', async () => {
  const { status } = await getPage(LEAD.cookie);
  assert.equal(status, 403);
});

test('TC-401 ops sees the page read-only, owner sees editors', async () => {
  const ops = await getPage(OPS.cookie);
  assert.equal(ops.status, 200);
  assert.match(ops.body, /data-cost-readonly="1"/);
  assert.doesNotMatch(ops.body, /data-cost-editor/);

  const owner = await getPage(OWNER.cookie);
  assert.equal(owner.status, 200);
  assert.match(owner.body, /data-cost-editor="1"/);
});

test('TC-402 only an owner may write', async () => {
  const payload = { tripSlug: TRIP, batchId: BATCH, baseAmount: 1000 };
  assert.equal((await call('PUT', '/api/admin/finance/cost', payload, OPS.cookie)).status, 403);
  assert.equal((await call('PUT', '/api/admin/finance/cost', payload, LEAD.cookie)).status, 403);
  assert.equal((await call('POST', '/api/admin/finance/item', { ...payload, label: 'x', amount: 1 }, OPS.cookie)).status, 403);

  // With no session the middleware redirects to /admin/login before any handler
  // runs. That is the site-wide behaviour for every admin API except analytics,
  // so assert the property that matters: it is blocked, and it wrote nothing.
  const before = db().prepare('SELECT COUNT(*) n FROM departure_costs').get().n;
  const anon = await call('PUT', '/api/admin/finance/cost', payload, null);
  assert.ok(anon.status !== 200, `unauthenticated write must not succeed, got ${anon.status}`);
  assert.equal(db().prepare('SELECT COUNT(*) n FROM departure_costs').get().n, before);
});

// ── Base cost ────────────────────────────────────────────────────────────────

test('TC-403 owner upserts the base cost idempotently', async () => {
  resetFixture();
  const first = await call('PUT', '/api/admin/finance/cost',
    { tripSlug: TRIP, batchId: BATCH, baseAmount: 90000, note: 'vendor total' }, OWNER.cookie);
  assert.equal(first.status, 200);
  assert.equal(first.data.cost.base, 90000);
  assert.equal(first.data.cost.costed, true);

  const second = await call('PUT', '/api/admin/finance/cost',
    { tripSlug: TRIP, batchId: BATCH, baseAmount: 95000 }, OWNER.cookie);
  assert.equal(second.data.cost.base, 95000);

  const conn = db();
  const rows = conn.prepare('SELECT COUNT(*) n FROM departure_costs WHERE trip_slug=? AND batch_id=?').get(TRIP, BATCH);
  conn.close();
  assert.equal(rows.n, 1, 'upsert must not duplicate the row');
});

test('TC-404 base cost validation', async () => {
  const bad = async (baseAmount) =>
    (await call('PUT', '/api/admin/finance/cost', { tripSlug: TRIP, batchId: BATCH, baseAmount }, OWNER.cookie)).status;
  assert.equal(await bad('abc'), 400);
  assert.equal(await bad(-1), 400);
  assert.equal(await bad(2e12), 400);

  // A fraction is rounded, not rejected — and the stored value is echoed back.
  const rounded = await call('PUT', '/api/admin/finance/cost',
    { tripSlug: TRIP, batchId: BATCH, baseAmount: 1500.6 }, OWNER.cookie);
  assert.equal(rounded.status, 200);
  assert.equal(rounded.data.cost.base, 1501);
});

test('TC-405 an unknown departure is refused and writes nothing', async () => {
  const before = db().prepare('SELECT COUNT(*) n FROM departure_costs').get().n;
  const res = await call('PUT', '/api/admin/finance/cost',
    { tripSlug: TRIP, batchId: 'no-such-departure', baseAmount: 5000 }, OWNER.cookie);
  assert.equal(res.status, 404);
  const after = db().prepare('SELECT COUNT(*) n FROM departure_costs').get().n;
  assert.equal(after, before, 'a typo must not mint an orphan cost row');
});

test('TC-406 clearing the base cost returns the departure to not-costed', async () => {
  resetFixture();
  await call('PUT', '/api/admin/finance/cost', { tripSlug: TRIP, batchId: BATCH, baseAmount: 0 }, OWNER.cookie);
  // An explicit zero is a real state: costed, not missing.
  const zero = await call('PUT', '/api/admin/finance/cost', { tripSlug: TRIP, batchId: BATCH, baseAmount: 0 }, OWNER.cookie);
  assert.equal(zero.data.cost.costed, true);
  assert.equal(zero.data.cost.hasBaseRow, true);

  const cleared = await call('DELETE', '/api/admin/finance/cost', { tripSlug: TRIP, batchId: BATCH }, OWNER.cookie);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.cost.costed, false);
  assert.equal(cleared.data.cost.hasBaseRow, false);
});

// ── Line items ───────────────────────────────────────────────────────────────

test('TC-407 line item create, update and delete round-trip', async () => {
  resetFixture();
  const created = await call('POST', '/api/admin/finance/item',
    { tripSlug: TRIP, batchId: BATCH, label: 'Extra vehicle day', amount: 15000 }, OWNER.cookie);
  assert.equal(created.status, 200);
  assert.ok(Number.isInteger(created.data.id));
  assert.equal(created.data.cost.total, 15000);
  // A line item alone makes the departure costed, with no base row.
  assert.equal(created.data.cost.costed, true);
  assert.equal(created.data.cost.hasBaseRow, false);

  const page = await getPage(OWNER.cookie);
  assert.match(page.body, /Extra vehicle day/);

  const patched = await call('PATCH', '/api/admin/finance/item',
    { id: created.data.id, label: 'Extra vehicle days', amount: 18000 }, OWNER.cookie);
  assert.equal(patched.status, 200);
  assert.equal(patched.data.cost.total, 18000);

  const removed = await call('DELETE', '/api/admin/finance/item', { id: created.data.id }, OWNER.cookie);
  assert.equal(removed.status, 200);
  assert.equal(removed.data.cost.costed, false);
  assert.doesNotMatch((await getPage(OWNER.cookie)).body, /Extra vehicle days/);
});

test('TC-408 a credit is allowed, a zero amount is not', async () => {
  resetFixture();
  const zero = await call('POST', '/api/admin/finance/item',
    { tripSlug: TRIP, batchId: BATCH, label: 'nothing', amount: 0 }, OWNER.cookie);
  assert.equal(zero.status, 400);

  const blank = await call('POST', '/api/admin/finance/item',
    { tripSlug: TRIP, batchId: BATCH, label: '   ', amount: 100 }, OWNER.cookie);
  assert.equal(blank.status, 400);

  const long = await call('POST', '/api/admin/finance/item',
    { tripSlug: TRIP, batchId: BATCH, label: 'x'.repeat(81), amount: 100 }, OWNER.cookie);
  assert.equal(long.status, 400);

  const credit = await call('POST', '/api/admin/finance/item',
    { tripSlug: TRIP, batchId: BATCH, label: 'Vendor credit', amount: -5000 }, OWNER.cookie);
  assert.equal(credit.status, 200);
  assert.equal(credit.data.cost.total, -5000);
});

test('TC-409 base cost and line items sum together', async () => {
  resetFixture();
  await call('PUT', '/api/admin/finance/cost', { tripSlug: TRIP, batchId: BATCH, baseAmount: 90000 }, OWNER.cookie);
  await call('POST', '/api/admin/finance/item', { tripSlug: TRIP, batchId: BATCH, label: 'a', amount: 15000 }, OWNER.cookie);
  const last = await call('POST', '/api/admin/finance/item', { tripSlug: TRIP, batchId: BATCH, label: 'b', amount: -5000 }, OWNER.cookie);
  assert.equal(last.data.cost.base, 90000);
  assert.equal(last.data.cost.itemsTotal, 10000);
  assert.equal(last.data.cost.total, 100000);
});

// ── Audit ────────────────────────────────────────────────────────────────────

test('TC-410 every mutation writes a distinct audit action', async () => {
  resetFixture();
  // Earlier tests in this file have already audited the same departure, and
  // audit_log.id is a UUID so it carries no ordering. Clear this departure's
  // finance entries first so the assertions below can only see our own.
  const cleanup = db();
  cleanup.prepare("DELETE FROM audit_log WHERE targetId = ? AND action LIKE 'departure_cost%'").run(`${TRIP}:${BATCH}`);
  cleanup.close();

  await call('PUT', '/api/admin/finance/cost', { tripSlug: TRIP, batchId: BATCH, baseAmount: 1234 }, OWNER.cookie);
  const item = await call('POST', '/api/admin/finance/item',
    { tripSlug: TRIP, batchId: BATCH, label: 'audited', amount: 500 }, OWNER.cookie);
  await call('PATCH', '/api/admin/finance/item', { id: item.data.id, amount: 600 }, OWNER.cookie);
  await call('DELETE', '/api/admin/finance/item', { id: item.data.id }, OWNER.cookie);

  const conn = db();
  const rows = conn.prepare(
    "SELECT action, previousValue, newValue FROM audit_log WHERE targetId = ? AND action LIKE 'departure_cost%' ORDER BY createdAt",
  ).all(`${TRIP}:${BATCH}`);
  conn.close();

  const actions = new Set(rows.map((r) => r.action));
  for (const expected of ['departure_cost.set', 'departure_cost_item.added', 'departure_cost_item.updated', 'departure_cost_item.deleted']) {
    assert.ok(actions.has(expected), `missing audit action ${expected}`);
  }
  // The delete must carry the whole prior row — it is the only undo record.
  const deleted = rows.find((r) => r.action === 'departure_cost_item.deleted');
  assert.match(deleted.previousValue, /"label":"audited"/);
});

// ── Orphans ──────────────────────────────────────────────────────────────────

test('TC-411 orphaned costs are listed, excluded from totals, and purgeable', async () => {
  const conn = db();
  conn.prepare('DELETE FROM departure_costs WHERE trip_slug = ?').run('ghost-trip');
  conn.prepare('DELETE FROM departure_cost_items WHERE trip_slug = ?').run('ghost-trip');
  conn.prepare('INSERT INTO departure_costs (trip_slug, batch_id, base_amount) VALUES (?, ?, ?)')
    .run('ghost-trip', 'ghost-departure', 77777);
  conn.close();

  const page = await getPage(OWNER.cookie);
  assert.match(page.body, /Orphaned costs/);
  assert.match(page.body, /ghost-departure/);

  const purged = await call('DELETE', '/api/admin/finance/cost',
    { tripSlug: 'ghost-trip', batchId: 'ghost-departure', purgeItems: true }, OWNER.cookie);
  assert.equal(purged.status, 200);

  const left = db().prepare('SELECT COUNT(*) n FROM departure_costs WHERE trip_slug = ?').get('ghost-trip').n;
  assert.equal(left, 0);
});

test('TC-412 clearing a departure with nothing recorded is a 404', async () => {
  resetFixture();
  const res = await call('DELETE', '/api/admin/finance/cost', { tripSlug: TRIP, batchId: BATCH }, OWNER.cookie);
  assert.equal(res.status, 404);
});

// ── P&L, overheads and receivables ───────────────────────────────────────────

// FY 2099 keeps every overhead out of a real month; qa-bookable-2099 already
// establishes that year as the fixture sandbox.
const M1 = '2099-04';
const M2 = '2099-05';

function resetOverheads() {
  const conn = db();
  conn.prepare("DELETE FROM company_costs WHERE month LIKE '2099-%'").run();
  conn.close();
}

const overhead = (method, body, cookie) => call(method, '/api/admin/finance/overhead', body, cookie);

test('TC-414 ops cannot reach the P&L, and no salary figure leaks to them', async () => {
  resetOverheads();
  await overhead('PUT', { month: M1, category: 'salaries', amount: 987654 }, OWNER.cookie);

  const res = await fetch(`${BASE}/admin/finance/pnl`, { headers: { cookie: OPS.cookie }, redirect: 'manual' });
  const body = await res.text();
  assert.equal(res.status, 403);
  assert.ok(!body.includes('987654'), 'the salary figure must not appear in an ops response');
  assert.ok(!body.includes('9,87,654'), 'nor formatted');

  // ops must KEEP its margin view — the guard must not have over-reached.
  const finance = await fetch(`${BASE}/admin/finance`, { headers: { cookie: OPS.cookie }, redirect: 'manual' });
  assert.equal(finance.status, 200);
  assert.ok(!(await finance.text()).includes('9,87,654'));
});

test('TC-415 trip_lead cannot reach the P&L; owner can and sees the editor', async () => {
  assert.equal((await fetch(`${BASE}/admin/finance/pnl`, { headers: { cookie: LEAD.cookie }, redirect: 'manual' })).status, 403);
  const owner = await fetch(`${BASE}/admin/finance/pnl`, { headers: { cookie: OWNER.cookie }, redirect: 'manual' });
  assert.equal(owner.status, 200);
  assert.match(await owner.text(), /data-overhead-editor="1"/);
});

test('TC-416 only an owner may write an overhead', async () => {
  const payload = { month: M1, category: 'software', amount: 1000 };
  assert.equal((await overhead('PUT', payload, OPS.cookie)).status, 403);
  assert.equal((await overhead('PUT', payload, LEAD.cookie)).status, 403);
  assert.equal((await overhead('POST', { from: M1, to: M2 }, OPS.cookie)).status, 403);

  const before = db().prepare("SELECT COUNT(*) n FROM company_costs WHERE month LIKE '2099-%'").get().n;
  const anon = await overhead('PUT', payload, null);
  assert.ok(anon.status !== 200);
  assert.equal(db().prepare("SELECT COUNT(*) n FROM company_costs WHERE month LIKE '2099-%'").get().n, before);
});

test('TC-417 upsert is idempotent on (month, category)', async () => {
  resetOverheads();
  const first = await overhead('PUT', { month: M1, category: 'salaries', amount: 50000 }, OWNER.cookie);
  assert.equal(first.status, 200);
  assert.equal(first.data.row.amount, 50000);

  await overhead('PUT', { month: M1, category: 'salaries', amount: 60000 }, OWNER.cookie);
  const rows = db().prepare('SELECT COUNT(*) n, MAX(amount) a FROM company_costs WHERE month=? AND category=?').get(M1, 'salaries');
  assert.equal(rows.n, 1, 'upsert must not duplicate');
  assert.equal(rows.a, 60000);
});

test('TC-418 overhead validation', async () => {
  const status = async (body) => (await overhead('PUT', body, OWNER.cookie)).status;
  assert.equal(await status({ month: '2099-13', category: 'salaries', amount: 1 }), 400);
  assert.equal(await status({ month: '2099-4', category: 'salaries', amount: 1 }), 400);
  assert.equal(await status({ month: 'abc', category: 'salaries', amount: 1 }), 400);
  assert.equal(await status({ month: M1, category: 'payroll', amount: 1 }), 400);
  assert.equal(await status({ month: M1, category: 'salaries', amount: 'abc' }), 400);
  assert.equal(await status({ month: M1, category: 'salaries', amount: 2e12 }), 400);

  // Fractions round and the stored value is echoed.
  const rounded = await overhead('PUT', { month: M1, category: 'office', amount: 1500.6 }, OWNER.cookie);
  assert.equal(rounded.data.row.amount, 1501);
  // A negative overhead is a credit and is allowed.
  const credit = await overhead('PUT', { month: M1, category: 'software', amount: -2000 }, OWNER.cookie);
  assert.equal(credit.status, 200);
  assert.equal(credit.data.row.amount, -2000);
});

test('TC-419 clearing a cell returns it to not-entered, not zero', async () => {
  resetOverheads();
  await overhead('PUT', { month: M1, category: 'salaries', amount: 1000 }, OWNER.cookie);
  const cleared = await overhead('DELETE', { month: M1, category: 'salaries' }, OWNER.cookie);
  assert.equal(cleared.status, 200);
  assert.equal(db().prepare('SELECT COUNT(*) n FROM company_costs WHERE month=? AND category=?').get(M1, 'salaries').n, 0);
  // Clearing something that is not there is a 404, not a silent success.
  assert.equal((await overhead('DELETE', { month: M1, category: 'salaries' }, OWNER.cookie)).status, 404);
});

test('TC-420 copy-forward copies, refuses an empty source and guards a non-empty target', async () => {
  resetOverheads();
  assert.equal((await overhead('POST', { from: M1, to: M2 }, OWNER.cookie)).status, 400, 'empty source');

  await overhead('PUT', { month: M1, category: 'salaries', amount: 50000 }, OWNER.cookie);
  await overhead('PUT', { month: M1, category: 'software', amount: 8000 }, OWNER.cookie);

  const copied = await overhead('POST', { from: M1, to: M2 }, OWNER.cookie);
  assert.equal(copied.status, 200);
  assert.equal(copied.data.copied, 2);

  // A second copy would stamp over hand-entered figures, so it is refused.
  assert.equal((await overhead('POST', { from: M1, to: M2 }, OWNER.cookie)).status, 400);
  const forced = await overhead('POST', { from: M1, to: M2, overwrite: true }, OWNER.cookie);
  assert.equal(forced.status, 200);
  assert.equal(db().prepare('SELECT COUNT(*) n FROM company_costs WHERE month=?').get(M2).n, 2);
});

test('TC-421 every overhead mutation is audited with its prior state', async () => {
  resetOverheads();
  const conn = db();
  conn.prepare("DELETE FROM audit_log WHERE action LIKE 'company_cost%'").run();
  conn.close();

  await overhead('PUT', { month: M1, category: 'salaries', amount: 4242 }, OWNER.cookie);
  await overhead('POST', { from: M1, to: M2 }, OWNER.cookie);
  await overhead('DELETE', { month: M1, category: 'salaries' }, OWNER.cookie);

  const rows = db().prepare("SELECT action, previousValue FROM audit_log WHERE action LIKE 'company_cost%'").all();
  const actions = new Set(rows.map((r) => r.action));
  for (const expected of ['company_cost.set', 'company_cost.copied', 'company_cost.cleared']) {
    assert.ok(actions.has(expected), `missing audit action ${expected}`);
  }
  const cleared = rows.find((r) => r.action === 'company_cost.cleared');
  assert.match(cleared.previousValue, /4242/);
});

test('TC-422 the P&L renders, and counts overheads entered ahead of time', async () => {
  resetOverheads();
  resetFixture();
  await call('PUT', '/api/admin/finance/cost', { tripSlug: TRIP, batchId: BATCH, baseAmount: 10000 }, OWNER.cookie);
  await overhead('PUT', { month: M1, category: 'salaries', amount: 3000 }, OWNER.cookie);

  const res = await fetch(`${BASE}/admin/finance/pnl?fy=2099`, { headers: { cookie: OWNER.cookie }, redirect: 'manual' });
  const body = await res.text();
  assert.equal(res.status, 200);

  const kpi = (name) => {
    const m = new RegExp(`data-kpi="${name}"[^>]*>\\s*([^<]+)`).exec(body);
    return m ? m[1].trim() : null;
  };

  // FY 2099 has not begun, so no month can be "missing" and the figure is not
  // flagged indicative. The overhead entered ahead of time must STILL be counted
  // — summing only elapsed months silently dropped it, which is the regression
  // this asserts against.
  assert.match(kpi('overheads') ?? '', /3,000/);
  assert.match(body, /period not yet begun/);
  assert.ok(kpi('net'), 'net profit renders as a figure, never an em-dash');
  assert.ok(!body.includes('data-indicative-banner'), 'a period that has not begun is not "incomplete"');
});

test('TC-423 receivables exclude leads and appear on the ops-visible page', async () => {
  const res = await fetch(`${BASE}/admin/finance?fy=all`, { headers: { cookie: OPS.cookie }, redirect: 'manual' });
  const body = await res.text();
  assert.equal(res.status, 200);
  // The section is on /admin/finance precisely so ops can act on it.
  if (body.includes('id="receivables"')) {
    assert.match(body, /Not filtered by financial year/);
    // Leads are reported separately, never inside the aged total.
    if (body.includes('data-lead-advances')) {
      assert.match(body, /committed to no seat/);
    }
  }
});

test('TC-424 teardown', async () => {
  resetOverheads();
  const conn = db();
  conn.prepare("DELETE FROM audit_log WHERE action LIKE 'company_cost%'").run();
  conn.close();
  assert.ok(true);
});

test('TC-413 teardown', async () => {
  resetFixture();
  const conn = db();
  conn.prepare("DELETE FROM audit_log WHERE actorEmail LIKE 'finance-%@example.invalid'").run();
  conn.prepare("DELETE FROM audit_log WHERE targetId = ? AND action LIKE 'departure_cost%'").run(`${TRIP}:${BATCH}`);
  conn.close();
  assert.ok(true);
});
