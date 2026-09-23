import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  ATTRIBUTION_FIELDS,
  attributionChip,
  attributionFilterModels,
  attributionMatches,
  attributionPredicate,
  clientAttributionFields,
  DEFAULT_TOUCH_SCOPE,
  distinctValues,
  isHistoricalDeparture,
  regCampaign,
  regSource,
  tallyRegs,
  toTouchScope,
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

  it.each(['completed', 'draft'])('treats an explicitly %s departure as history', (status) => {
    expect(isHistoricalDeparture({
      startDate: '2026-09-15',
      status,
    }, today)).toBe(true);
  });
});

const touch = (over: Record<string, string> = {}) => JSON.stringify({
  landingPage: '/', referrer: '', utmSource: '', utmMedium: '', utmCampaign: '',
  utmTerm: '', utmContent: '', capturedAt: '', ...over,
});

describe('attribution accessors', () => {
  it('normalises source to lowercase', () => {
    expect(regSource({ source: 'Instagram' })).toBe('instagram');
  });

  it('returns empty for a row that predates attribution', () => {
    expect(regSource({})).toBe('');
    expect(regCampaign({})).toBe('');
  });

  it('reads the campaign out of the first touch, not the latest', () => {
    expect(regCampaign({
      first_touch_json: touch({ utmCampaign: 'Diwali-IG' }),
      latest_touch_json: touch({ utmCampaign: 'newyear' }),
    })).toBe('diwali-ig');
  });

  it('survives a malformed stored touch instead of throwing', () => {
    expect(regCampaign({ first_touch_json: '{not json' })).toBe('');
  });
});

describe('ATTRIBUTION_FIELDS', () => {
  it('keeps key, dataAttr, param and label unique', () => {
    for (const pick of ['key', 'dataAttr', 'param', 'label'] as const) {
      const seen = ATTRIBUTION_FIELDS.map((f) => f[pick]);
      expect(new Set(seen).size, `duplicate ${pick}`).toBe(seen.length);
    }
  });

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

  // These two params shipped before the unified panel. Renaming one silently
  // breaks every bookmarked export URL and the trip page's own export link.
  it('preserves the params that already shipped', () => {
    const params = ATTRIBUTION_FIELDS.map((f) => f.param);
    expect(params).toContain('source');
    expect(params).toContain('campaign');
  });

  it('gives every exact field the labels its <select> needs', () => {
    for (const f of ATTRIBUTION_FIELDS.filter((f) => f.match === 'exact')) {
      expect(f.allLabel, f.key).toBeTruthy();
      expect(f.noneLabel, f.key).toBeTruthy();
    }
  });

  it.each(ATTRIBUTION_FIELDS.filter((f) => f.param !== 'source'))(
    'reads $key out of the first touch, lowercased',
    (field) => {
      const key = field.sqlExpr.match(/\$\.(\w+)/)![1];
      const row = {
        first_touch_json: touch({ [key]: '  MiXeD-Case  ' }),
        latest_touch_json: touch({ [key]: 'from-latest' }),
      };
      expect(field.read(row)).toBe('mixed-case');
    },
  );

  it.each(ATTRIBUTION_FIELDS)('returns empty for $key on a malformed or absent touch', (field) => {
    expect(field.read({ first_touch_json: '{not json' })).toBe('');
    expect(field.read({})).toBe('');
  });

  // regCampaign predates the field list and is still imported elsewhere; if the
  // two ever disagree the row data attribute and the filter option diverge.
  it('keeps regCampaign and the campaign field in step', () => {
    const row = { first_touch_json: touch({ utmCampaign: 'Diwali-IG' }) };
    const field = ATTRIBUTION_FIELDS.find((f) => f.param === 'campaign')!;
    expect(field.read(row)).toBe(regCampaign(row));
  });

  // Deliberate: `source` is the derived channel (utm_source, else referrer
  // host, else 'direct'), not the raw utm_source. Do not "fix" this.
  it('lets the derived channel differ from utm_source', () => {
    const row = { source: 'google.com', first_touch_json: touch({ referrer: 'https://www.google.com/search' }) };
    const utmSource = ATTRIBUTION_FIELDS.find((f) => f.param === 'utm_source')!;
    expect(regSource(row)).toBe('google.com');
    expect(utmSource.read(row)).toBe('');
  });

  it('projects to the client without the reader functions', () => {
    const projected = clientAttributionFields();
    expect(projected).toHaveLength(ATTRIBUTION_FIELDS.length);
    expect(JSON.parse(JSON.stringify(projected))).toEqual(projected);
    for (const f of projected) {
      expect(Object.keys(f).sort()).toEqual(['dataAttr', 'key', 'latestDataAttr', 'match', 'param']);
    }
  });

  it.each(ATTRIBUTION_FIELDS.filter((f) => f.scoped))(
    'reads $key out of the latest touch too',
    (field) => {
      const key = field.sqlExpr.match(/\$\.(\w+)/)![1];
      const row = {
        first_touch_json: touch({ [key]: 'from-first' }),
        latest_touch_json: touch({ [key]: '  FROM-Latest ' }),
      };
      expect(field.read(row)).toBe('from-first');
      expect(field.readLatest(row)).toBe('from-latest');
      expect(field.latestSqlExpr).toContain('latest_touch_json');
    },
  );

  // The derived channel is a flat column written once from the first touch;
  // there is no latest-touch equivalent to read, and inventing one would need a
  // referrer-hostname parser the export's SQL cannot have.
  it('leaves the derived channel unscoped, and says so in its label', () => {
    const source = ATTRIBUTION_FIELDS.find((f) => f.param === 'source')!;
    expect(source.scoped).toBe(false);
    expect(source.label).toMatch(/first touch/i);
    const row = { source: 'instagram', latest_touch_json: touch({ utmSource: 'google' }) };
    expect(source.readLatest(row)).toBe('instagram');
  });
});

describe('attributionFilterModels', () => {
  const rows = [
    { source: 'instagram', first_touch_json: touch({ utmSource: 'instagram', utmMedium: 'paid', utmContent: 'story-1' }) },
    { source: 'google', first_touch_json: touch({ utmSource: 'google', utmMedium: 'cpc' }) },
    {},
  ];

  it('shows an exact filter only when it can split the rows', () => {
    const models = Object.fromEntries(attributionFilterModels(rows).map((m) => [m.field.param, m]));
    expect(models.source.show).toBe(true);
    expect(models.source.options).toEqual(['google', 'instagram']);
    expect(models.source.hasNone).toBe(true);
    // Only one row carries content, but a contains filter still earns its input.
    expect(models.utm_content.show).toBe(true);
    // Nothing carries a campaign, so the dropdown would be empty.
    expect(models.campaign.show).toBe(false);
  });

  it('hides every control when no row carries attribution', () => {
    expect(attributionFilterModels([{}, {}]).some((m) => m.show)).toBe(false);
  });
});

describe('attributionChip', () => {
  it('reads channel/medium · campaign', () => {
    const chip = attributionChip({
      source: 'instagram',
      first_touch_json: touch({ utmMedium: 'paid', utmCampaign: 'diwali' }),
    });
    expect(chip.label).toBe('instagram/paid · diwali');
    expect(chip.attributed).toBe(true);
  });

  it('falls back to the channel alone', () => {
    expect(attributionChip({ source: 'direct' }).label).toBe('direct');
  });

  // An admin-entered row IS attributed — to manual entry. Flattening it to
  // "not attributed" would hide how the booking actually arrived.
  it('shows admin rows as admin, not as unattributed', () => {
    const chip = attributionChip({ source: 'admin' });
    expect(chip.label).toBe('admin');
    expect(chip.attributed).toBe(true);
  });

  it('falls back only for a genuinely empty row', () => {
    const chip = attributionChip({});
    expect(chip.label).toBe('not attributed');
    expect(chip.attributed).toBe(false);
    expect(chip.title).toMatch(/No attribution/);
  });
});

describe('distinctValues', () => {
  it('returns sorted unique non-empty values', () => {
    const regs = [{ source: 'Instagram' }, { source: 'google' }, { source: 'instagram' }, { source: '' }, {}];
    expect(distinctValues(regs, regSource)).toEqual(['google', 'instagram']);
  });

  it('works over a first-touch reader, not just the flat column', () => {
    const medium = ATTRIBUTION_FIELDS.find((f) => f.param === 'utm_medium')!;
    const regs = [
      { first_touch_json: touch({ utmMedium: 'CPC' }) },
      { first_touch_json: touch({ utmMedium: 'cpc' }) },
      { first_touch_json: touch({ utmMedium: 'paid' }) },
      {},
    ];
    expect(distinctValues(regs, medium.read)).toEqual(['cpc', 'paid']);
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

  it('counts every status bucket', () => {
    const t = tallyRegs(rows);
    expect(t.count).toBe(6);
    expect(t.confirmed).toBe(1);
    expect(t.pending).toBe(1);
    expect(t.lead).toBe(1);
    expect(t.cancelled).toBe(1);
    expect(t.rejected).toBe(1);
    expect(t.wishlist).toBe(1);
  });

  it('excludes cancelled, rejected and wishlist from revenue', () => {
    expect(tallyRegs(rows).revenue).toBe(7000);
  });

  it('tallies an empty filtered set to zeroes rather than NaN', () => {
    expect(tallyRegs([])).toMatchObject({ count: 0, revenue: 0, confirmed: 0 });
  });
});

describe('touch scope', () => {
  const campaign = ATTRIBUTION_FIELDS.find((f) => f.param === 'campaign')!;
  const content = ATTRIBUTION_FIELDS.find((f) => f.param === 'utm_content')!;

  // The visitor this exists for: found some other way, came back through a DM.
  const dmSecond = {
    source: 'google',
    first_touch_json: touch({ utmSource: 'google' }),
    latest_touch_json: touch({ utmCampaign: 'goa-sept', utmContent: 'reel-ferry' }),
  };
  const dmFirst = {
    source: 'instagram',
    first_touch_json: touch({ utmCampaign: 'goa-sept', utmContent: 'reel-ferry' }),
    latest_touch_json: touch({ utmCampaign: 'goa-sept', utmContent: 'reel-ferry' }),
  };

  it('defaults to the first touch, whatever the URL says', () => {
    expect(toTouchScope(undefined)).toBe('first');
    expect(toTouchScope('sideways')).toBe('first');
    expect(toTouchScope('latest')).toBe('latest');
    expect(toTouchScope('either')).toBe('either');
    expect(DEFAULT_TOUCH_SCOPE).toBe('first');
  });

  it('finds a campaign that only the latest touch carries', () => {
    expect(attributionMatches(campaign, dmSecond, 'goa-sept', 'first')).toBe(false);
    expect(attributionMatches(campaign, dmSecond, 'goa-sept', 'latest')).toBe(true);
    expect(attributionMatches(campaign, dmSecond, 'goa-sept', 'either')).toBe(true);
    // And the row that arrived through the campaign still matches every scope.
    for (const scope of TOUCH_SCOPES) {
      expect(attributionMatches(campaign, dmFirst, 'goa-sept', scope), scope).toBe(true);
    }
  });

  it('substring-matches under every scope', () => {
    expect(attributionMatches(content, dmSecond, 'ferry', 'first')).toBe(false);
    expect(attributionMatches(content, dmSecond, 'ferry', 'latest')).toBe(true);
    expect(attributionMatches(content, dmSecond, 'ferry', 'either')).toBe(true);
  });

  /**
   * The asymmetry that makes "either" usable: a VALUE matches when either touch
   * carries it, but "(no campaign)" means NEITHER does. Reading the bucket as
   * "some touch is blank" would drop almost every row into it — including the
   * ones whose campaign is the reason you are looking.
   */
  it('reads the unattributed bucket as neither touch, not either touch', () => {
    expect(attributionMatches(campaign, dmSecond, UNATTRIBUTED, 'first')).toBe(true);
    expect(attributionMatches(campaign, dmSecond, UNATTRIBUTED, 'latest')).toBe(false);
    expect(attributionMatches(campaign, dmSecond, UNATTRIBUTED, 'either')).toBe(false);
    expect(attributionMatches(campaign, {}, UNATTRIBUTED, 'either')).toBe(true);
  });

  it('offers values from both touches, so the scope switch has something to select', () => {
    const models = Object.fromEntries(attributionFilterModels([dmSecond, {}]).map((m) => [m.field.param, m]));
    expect(models.campaign.options).toEqual(['goa-sept']);
    expect(models.campaign.hasNone).toBe(true);
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
