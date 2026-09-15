import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_FIELDS,
  attributionChip,
  attributionFilterModels,
  clientAttributionFields,
  distinctValues,
  isHistoricalDeparture,
  regCampaign,
  regSource,
  tallyRegs,
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
      expect(f.dataAttr, f.key).toBe(f.dataAttr.toLowerCase());
      expect(f.dataAttr, f.key).toMatch(/^attr-[a-z0-9-]+$/);
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
    for (const f of projected) expect(Object.keys(f).sort()).toEqual(['dataAttr', 'key', 'match', 'param']);
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
