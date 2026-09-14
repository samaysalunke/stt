import { describe, expect, it } from 'vitest';
import {
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

describe('distinctValues', () => {
  it('returns sorted unique non-empty values', () => {
    const regs = [{ source: 'Instagram' }, { source: 'google' }, { source: 'instagram' }, { source: '' }, {}];
    expect(distinctValues(regs, regSource)).toEqual(['google', 'instagram']);
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
