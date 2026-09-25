import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  ATTRIBUTION_FIELDS,
  attributionMatches,
  attributionPredicate,
  isHistoricalDeparture,
  tallyRegs,
  TOUCH_SCOPES,
  UNATTRIBUTED,
} from '../../src/lib/registrationsView';

const today = new Date('2026-09-01T12:00:00+05:30');

describe('registrations view history', () => {
  it('keeps a future sold-out departure out of history', () => {
    expect(isHistoricalDeparture({
      startDate: '2026-09-15',
      status: 'sold-out',
    }, today)).toBe(false);
  });

  it('treats a past departure as history regardless of availability', () => {
    expect(isHistoricalDeparture({
      startDate: '2026-08-31',
      status: 'booking-open',
    }, today)).toBe(true);
  });
});

const touch = (over: Record<string, string> = {}) => JSON.stringify({
  landingPage: '/', referrer: '', utmSource: '', utmMedium: '', utmCampaign: '',
  utmTerm: '', utmContent: '', capturedAt: '', ...over,
});

describe('ATTRIBUTION_FIELDS', () => {
  /**
   * HTML lowercases attribute names, so `data-attr-utmMedium` is served back as
   * `data-attr-utmmedium` and every camelCase lookup misses — the filter then
   * matches nothing, silently, with no error anywhere. dataAttr must survive
   * that round-trip unchanged.
   */
  it('gives every field a data attribute that survives HTML lowercasing', () => {
    for (const f of ATTRIBUTION_FIELDS) {
      for (const attr of [f.dataAttr, f.latestDataAttr]) {
        expect(attr, f.key).toBe(attr.toLowerCase());
        expect(attr, f.key).toMatch(/^attr-[a-z0-9-]+$/);
      }
      // A scoped field must not write both touches to one attribute, and an
      // unscoped one must not claim two readings it does not have.
      expect(f.dataAttr === f.latestDataAttr, f.key).toBe(!f.scoped);
    }
  });
});

describe('tallyRegs', () => {
  const rows = [
    { status: 'confirmed', amount_paid: 5000 },
    { status: 'pending', amount_paid: 2000 },
    { status: 'lead', amount_paid: 0 },
    { status: 'cancelled', amount_paid: 1500 },
    { status: 'rejected', amount_paid: 900 },
    { status: 'wishlist', amount_paid: 100 },
  ];

  it('excludes cancelled, rejected and wishlist from revenue', () => {
    expect(tallyRegs(rows).revenue).toBe(7000);
  });
});

/**
 * The screen filters rows in JS; the CSV export filters them in SQL. They are
 * two implementations of one rule, and when they drift the download quietly
 * holds a different set of rows than the admin was looking at — with nothing on
 * screen to say so. Run both over the same rows.
 */
describe('export SQL agrees with the client matcher', () => {
  const rows = [
    { id: 1, source: 'instagram', first_touch_json: touch({ utmSource: 'instagram', utmCampaign: 'goa-sept', utmContent: 'reel-ferry' }), latest_touch_json: touch({ utmCampaign: 'goa-sept' }) },
    { id: 2, source: 'google', first_touch_json: touch({ utmSource: 'google' }), latest_touch_json: touch({ utmCampaign: 'goa-sept', utmContent: 'reel-sunset' }) },
    { id: 3, source: 'direct', first_touch_json: touch({}), latest_touch_json: touch({}) },
    { id: 4, source: 'admin', first_touch_json: null, latest_touch_json: null },
    // A malformed blob 500'd the whole download once; json_valid() guards it.
    { id: 5, source: 'instagram', first_touch_json: '{not json', latest_touch_json: '{not json' },
  ];

  const db = new Database(':memory:');
  db.exec('CREATE TABLE registrations (id INTEGER PRIMARY KEY, source TEXT, first_touch_json TEXT, latest_touch_json TEXT)');
  const insert = db.prepare('INSERT INTO registrations VALUES (?, ?, ?, ?)');
  for (const r of rows) insert.run(r.id, r.source, r.first_touch_json, r.latest_touch_json);

  const cases = [
    { param: 'campaign', value: 'goa-sept' },
    { param: 'campaign', value: UNATTRIBUTED },
    { param: 'utm_content', value: 'reel' },
    { param: 'utm_content', value: 'sunset' },
    { param: 'utm_source', value: 'instagram' },
    { param: 'utm_source', value: UNATTRIBUTED },
    { param: 'source', value: 'instagram' },
  ];

  it.each(TOUCH_SCOPES.flatMap((scope) => cases.map((c) => ({ ...c, scope }))))(
    'matches the same rows for $param=$value under $scope',
    ({ param, value, scope }) => {
      const field = ATTRIBUTION_FIELDS.find((f) => f.param === param)!;
      const predicate = attributionPredicate(field, value, scope)!;
      const fromSql = db.prepare(`SELECT id FROM registrations WHERE ${predicate.sql} ORDER BY id`)
        .all(...predicate.params).map((r: any) => r.id);
      const fromJs = rows.filter((r) => attributionMatches(field, r, value, scope)).map((r) => r.id);
      expect(fromSql).toEqual(fromJs);
    },
  );
});
